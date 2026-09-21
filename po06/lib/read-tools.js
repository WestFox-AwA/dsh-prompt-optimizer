// P10 步骤 3 · **只读工具循环**（read / glob / grep，给解释层补上"能读项目文件"的能力）。
//
// 为什么单独一个模块：0.6 的解释层是**单次不带工具的补全**（index.js 的 interpretViaLlm），
// 设置里的 `readTools` 字段（settings.js，EV-0148）**没有任何代码读它**。
// 本模块是那个字段的唯一行为落地处：宿主 `GenerateOptions.tools`（dsh-llm 的类型定义
// `ToolSchema`）+ 流里的 `tool-call-delta` / `block-end` 事件 → 执行 → 结果回灌 → 再问一轮。
//
// ── 从 0.5 读懂之后**自己写**的部分（观察点记在这里，免得下次又去翻那份 4094 行）──
//   · 工具调用事件**不是**一个块一次性给的：先 `tool-call-delta`（带 index/id/name/argumentsDelta）
//     增量拼参数，最后 `block-end`（`block.type === 'tool-call'`）给**装配好的** id/name/arguments。
//     只认一边都会出错：只认 delta 会在没有 delta 的适配器上丢调用，只认 block-end 会在
//     分片适配器上拿到半截 JSON。所以两边都收，**block-end 覆盖 delta**（0.5 的做法，验证过）。
//   · 回灌形状：助手消息带 `tool-call` 块（source 是 model），工具结果消息 role 是 **user**、
//     内容是 `tool-result` 块、`source.kind === 'tool'` 且带 `callId`。形状错了模型就看不到结果。
//   · 收敛：模型某轮不再请求工具（或正文已出且已到最后一轮）就停。
//
// ── 与 0.5 的**有意分歧**（都写在这里，免得被当成漏抄）──
//   ① 轮次上限默认 **3**（0.5 正式运行用 5）：每一轮都是一次额外模型调用，成本与时间都要花；
//      要放开就改调用点的 `count`（硬上限 LOOP_HARD_MAX_ROUNDS = 6 是 0.5 的模块常量）。
//   ② 总时限默认 **60 秒**（0.5 是 90 秒）：解释层是**生产路径上的旁路**，
//      它拖住的是一轮真实对话的观感；宁可少读，也不要让用户等一条链路的第二段。
//   ③ **不做** 0.5 的证据账本重写（`renderEvidenceLedger`）：那是把"能引用什么"渲染成一份
//      权威清单交给模型。那是**另一层**语义（依据分类），本步的范围是"把真实文件内容拿给模型看"；
//      只读工具的**拒绝文本本身**已经把"没读到"这件事说清楚了（见下）。
//   ④ 越界拒绝是**第一类返回**：`{ ok:false, rejected:true, text }`，与"读到了但是空的"
//      分得开。0.5 把拒绝和正常结果都塞进同一个字符串里，调用方只能靠前缀猜。
//
// ── 安全：根目录约束 ─────────────────────────────────────────────
// **三重与条件**（P10-0.5-UI-SPEC §5）：`readTools === true` ∧ **能解析到本会话 cwd**。
// 解析不到就**一个工具都不派**——"宁可少读，也不读别的会话的目录"。理由是本项目的
// 一贯教训：查错对象不会报错，只会给错答案（EV-0081 的"查了另一个 profile 的清单"同源）。
// 单条路径走 `resolveInsideRoot`：词法（`..` 越界）+ `realpath`（软链接逃逸）**双校验**；
// 任一步失败一律回明确拒绝文本，不做"尽力而为"的读。
//
// 纯函数为主：只有 `executeReadOnlyTool` 碰文件系统，且它**不抛**（失败一律变成拒绝文本）。

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 文件大小上限：超过直接拒绝（0.5 的 LOOP_MAX_FILE_BYTES）。 */
export const MAX_FILE_BYTES = 200 * 1024
/** 单次工具结果字符上限（超出截断并写明）。 */
export const MAX_RESULT_CHARS = 4000
/** 遍历的文件数上限（0.5 的 LOOP_MAX_FILES）。 */
export const MAX_FILES = 400
/** glob 命中上限。 */
export const MAX_GLOB_HITS = 50
/** grep 命中上限。 */
export const MAX_GREP_HITS = 40
/** 目录遍历深度上限。 */
export const MAX_DEPTH = 6
/** read 默认返回 200 行。 */
export const DEFAULT_READ_LINES = 200
/** grep 每条内容截断。 */
export const GREP_LINE_CHARS = 200
/** 遍历时跳过的目录（0.5 同一份名单）。 */
export const SKIP_DIRS = Object.freeze(['node_modules', '.git', 'dist', 'build', '.next', 'evidence'])
/** 工具循环轮次：默认 3，硬上限 6（0.5 的 LOOP_MAX_ROUNDS）。 */
export const LOOP_DEFAULT_ROUNDS = 3
export const LOOP_HARD_MAX_ROUNDS = 6
/** 工具循环总时限：默认 60 秒（见文件头分歧 ②）。 */
export const LOOP_BUDGET_MS = 60000

/** 越界与拒绝的**统一话术**：调用方与模型看到的必须是同一句（0.5 的原文）。 */
export const REFUSE_OUTSIDE = '拒绝：路径越出项目范围（只读工具限定在项目根内）'

/**
 * 三个只读工具的 schema（照 0.5 的 LOOP_TOOLS 逐字，含描述——描述就是模型的用法说明）。
 * **导出**是为了让定点核对能直接断言"关掉开关时一个工具都不派"。
 */
export const TOOL_SCHEMAS = Object.freeze([
  {
    name: 'read',
    description: '读取项目内某个文件的指定行范围（只读）。返回带行号的文本。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根的路径' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'glob',
    description: '按通配符列出项目内文件路径（只读，最多 ' + MAX_GLOB_HITS + ' 条）。支持 ** 与 *。',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: '例如 **/*.js' } },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: '在项目内按正则搜索，返回 "文件:行号: 内容"（只读，最多 ' + MAX_GREP_HITS + ' 条）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: '可选：限定子路径' },
      },
      required: ['pattern'],
    },
  },
])

/** 给解释层补的**工具用法说明**：只在真的派工具时拼进 system（不派就不拼，一个字都不差）。 */
export const TOOLS_SYSTEM_NOTE = '\n\n【只读查证】你可以调用 read/glob/grep 三个只读工具查证项目的实际情况'
  + '（限定在项目根内、不写盘、不执行命令）。'
  + '要写"项目里现在是怎么做的"这类 observed_fact，**必须先真的读到内容**——'
  + '只 glob 列过目录不算知道内容，没读到就不要写事实。'
  + '本轮最多 ' + LOOP_DEFAULT_ROUNDS + ' 轮查证，到上限会要求你立刻用已有证据给结论。'

/**
 * 路径是否在根内。**词法 + realpath 双校验**。
 * realpath 失败时（目标不存在/越界路径）以**词法校验**为准——这与 0.5 一致：
 * 目的是"不许越界"，不是"必须存在"（存在性由各工具自己回答）。
 * @returns 绝对路径 | null（null = 越界，调用方必须回拒绝文本）
 */
export function resolveInsideRoot(root, rel) {
  try {
    const r = String(root == null ? '' : root)
    const raw = String(rel == null ? '' : rel)
    if (!r || !raw) return null
    // 绝对路径一律拒绝：工具约定里 path 是"相对项目根"的
    if (isAbsolute(raw)) return null
    const abs = resolve(r, raw)
    const back = relative(r, abs)
    if (!back || back.startsWith('..') || isAbsolute(back)) return null
    try {
      const realRoot = realpathSync(r)
      const realAbs = realpathSync(abs)
      const realBack = relative(realRoot, realAbs)
      if (!realBack || realBack.startsWith('..') || isAbsolute(realBack)) return null
    } catch { /* 目标尚不存在（含越界）⇒ 以词法校验为准 */ }
    return abs
  } catch { return null }
}

/**
 * 遍历项目文件。**同步、有上限、可预测**：不返回生成器，也不做异步 IO
 * （解释层是旁路，不能在这里挂住事件循环太久；上限 400 个文件把最坏情况钉死）。
 */
export function walkFiles(root, cap = MAX_FILES) {
  const found = []
  const walk = (dir, depth) => {
    if (found.length >= cap || depth > MAX_DEPTH) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= cap) return
      // 点文件/点目录一律跳过（含 `.git`），加上名单里的重目录
      if (entry.name.startsWith('.') || SKIP_DIRS.includes(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs, depth + 1)
      else if (entry.isFile()) found.push(abs)
    }
  }
  walk(String(root), 1)
  return found
}

/** `.gitignore` 风格的通配符 → 正则。`**\/` 必须匹配**零层或更多层**目录（0.5 踩过的坑）。 */
export function globToRegExp(pattern) {
  const p = String(pattern == null ? '' : pattern)
  return new RegExp('^' + p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')          // 先占位 `**/`（**零层或多层**）
    .replace(/\*\*/g, '\u0002')            // 裸 `**`
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*') + '$')
}

/** 统一的结果形状：`ok`=真的读到/列到；`rejected`=越界或参数不合法（**不是**"没命中"）。 */
const ok = (text) => ({ ok: true, rejected: false, text: String(text) })
const reject = (text) => ({ ok: false, rejected: true, text: String(text) })

/** 截断到结果上限，并把截断事实写在结果末尾。 */
function capText(text) {
  const s = String(text)
  if (s.length <= MAX_RESULT_CHARS) return s
  return s.slice(0, MAX_RESULT_CHARS) + '\n…(截断到 ' + MAX_RESULT_CHARS + ' 字，原 ' + s.length + ' 字)'
}

/** `read`：默认 200 行、>200KB 拒绝、结果 >4000 字截断。 */
export function toolRead(root, args) {
  const a = args || {}
  const abs = resolveInsideRoot(root, a.path)
  if (!abs) return reject(REFUSE_OUTSIDE)
  try {
    if (!existsSync(abs)) return ok('文件不存在：' + String(a.path))
    const info = statSync(abs)
    if (!info.isFile()) return ok('不是文件：' + String(a.path))
    if (info.size > MAX_FILE_BYTES) return ok('拒绝：文件过大（>' + MAX_FILE_BYTES + ' 字节，本次 ' + info.size + ' 字节）')
    const lines = readFileSync(abs, 'utf8').split('\n')
    const startRaw = a.startLine === undefined || a.startLine === null ? 1 : Number(a.startLine)
    const endRaw = a.endLine === undefined || a.endLine === null ? startRaw + DEFAULT_READ_LINES - 1 : Number(a.endLine)
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) return reject('拒绝：startLine/endLine 必须是数字')
    const start = Math.max(1, Math.floor(startRaw))
    const end = Math.min(lines.length, Math.floor(endRaw))
    const slice = end >= start ? lines.slice(start - 1, end) : []
    const body = slice.map((line, i) => String(start + i).padStart(5, ' ') + '| ' + line).join('\n')
    const head = '文件 ' + String(a.path) + '（共 ' + lines.length + ' 行，返回 ' + start + '-' + end + '）'
    return ok(capText(head + '\n' + body))
  } catch (e) {
    return ok('读取失败：' + String((e && e.message) || e))
  }
}

/** `glob`：≤50 命中、≤400 文件、深度 ≤6、跳重目录与点文件。 */
export function toolGlob(root, args) {
  const a = args || {}
  const pattern = String(a.pattern == null ? '' : a.pattern)
  if (!pattern) return reject('拒绝：pattern 不能为空')
  let rx = null
  try { rx = globToRegExp(pattern) } catch (e) { return reject('通配符无效：' + String((e && e.message) || e)) }
  const hits = []
  for (const abs of walkFiles(root)) {
    const rel = relative(String(root), abs).split('\\').join('/')
    if (rx.test(rel)) hits.push(rel)
    if (hits.length >= MAX_GLOB_HITS) break
  }
  if (hits.length === 0) return ok('无匹配（pattern=' + pattern + '）')
  return ok('匹配 ' + hits.length + ' 条：\n' + hits.join('\n'))
}

/** `grep`：≤40 命中，`文件:行号: 内容`，内容截 200 字，跳过二进制与大文件。 */
export function toolGrep(root, args) {
  const a = args || {}
  let rx = null
  try { rx = new RegExp(String(a.pattern == null ? '' : a.pattern)) } catch (e) {
    return reject('正则无效：' + String((e && e.message) || e))
  }
  let scope = String(root)
  if (a.path !== undefined && a.path !== null && String(a.path) !== '') {
    const abs = resolveInsideRoot(root, a.path)
    if (!abs) return reject(REFUSE_OUTSIDE)
    scope = abs
  }
  let files = []
  try {
    files = existsSync(scope) && statSync(scope).isDirectory() ? walkFiles(scope) : [scope]
  } catch { files = [scope] }
  const hits = []
  for (const abs of files) {
    if (hits.length >= MAX_GREP_HITS) break
    let info = null
    try { info = statSync(abs) } catch { continue }
    if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
    let text = ''
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    if (text.indexOf('\u0000') >= 0) continue               // 二进制：跳过（不是错误）
    const rel = relative(String(root), abs).split('\\').join('/')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < MAX_GREP_HITS; i += 1) {
      // 重置 lastIndex：带 /g 的正则与 test 组合会跳行，这里统一用无状态写法
      if (rx.test(lines[i])) hits.push(rel + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, GREP_LINE_CHARS))
    }
  }
  if (hits.length === 0) return ok('无匹配（pattern=' + String(a.pattern) + '）')
  return ok('命中 ' + hits.length + ' 条：\n' + hits.join('\n'))
}

/**
 * 执行一次工具调用。**不抛**：任何异常都变成结果文本（模型看到失败原因比看到"工具崩了"有用）。
 * 未知工具名也回**明确拒绝**，不是静默空结果。
 */
export function executeReadOnlyTool(root, name, args) {
  try {
    const n = String(name == null ? '' : name)
    if (n === 'read') return toolRead(root, args)
    if (n === 'glob') return toolGlob(root, args)
    if (n === 'grep') return toolGrep(root, args)
    return reject('拒绝：不存在的工具（本循环只提供 read/glob/grep，且只读）：' + n)
  } catch (e) {
    return { ok: false, rejected: false, text: '工具执行异常：' + String((e && e.message) || e) }
  }
}

/** 组装一条"助手请求工具"的消息（形状错了模型就看不到自己的调用）。 */
export function assistantToolCallMessage(calls, provider, model) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return {
    id: 'po06-a-' + stamp,
    role: 'assistant',
    content: calls.map((c) => ({ type: 'tool-call', id: c.id, name: c.name, arguments: c.arguments })),
    source: { kind: 'model', provider: String(provider || ''), model: String(model || '') },
  }
}

/** 组装工具结果消息：role 是 **user**，source 是 **tool**（宿主契约，见文件头）。 */
export function toolResultMessages(calls, outputs) {
  return calls.map((c, i) => {
    const out = outputs[i] || { ok: false, text: '' }
    const text = out.text === undefined || out.text === null ? '' : String(out.text)
    return {
      id: 'po06-t-' + String(c.id).slice(0, 40) + '-' + i,
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: c.id, content: [{ type: 'text', text }], ...(out.ok ? {} : { isError: true }) }],
      source: { kind: 'tool', callId: c.id },
    }
  })
}

/**
 * 收干**一轮**带工具的流：返回正文/思考/用量/结束原因/**工具调用清单**。
 *
 * 与 eval-llm.js 的 `drain` 分开写（不复用）的理由：drain 是**无工具**单次补全的收流器，
 * 生产路径上它一个字都不能变（"默认路径逐字节等价"这条约束就落在那几行上）。
 * 本函数多收两样：`tool-call-delta`（增量拼参数）与 `block-end`（装配好的调用）。
 * **不抛**：错误收进 `error` 字段，由调用方决定降级（见 runReadOnlyToolLoop 的回落）。
 */
export async function drainWithTools(stream, t0, sink) {
  const out = {
    text: '', reasoning: '', usage: null, finish: null, error: null,
    ms: 0, calls: [], chunkTypes: {},
  }
  // P11：**思维层要有内容**（用户 2026-09-21："只读工具开启时看不见思维"）。
  // 工具路径此前不接 sink ⇒ 进度面收不到任何流式片段 ⇒ 界面只有一个"已用 N 秒"。
  // sink 只做展示，抛错一律吞掉（界面坏了不能把模型调用带下水）。
  const emit = (dt, dr) => {
    if (typeof sink !== 'function') return
    try { sink({ text: dt, reasoning: dr, textChars: out.text.length, reasoningChars: out.reasoning.length }) } catch { /* 展示层的问题不拖累收集 */ }
  }
  try {
    for await (const chunk of stream) {
      const t = chunk && chunk.type
      if (t) out.chunkTypes[t] = (out.chunkTypes[t] || 0) + 1
      if (t === 'text-delta') { out.text += String(chunk.text || chunk.delta || ''); emit(String(chunk.text || chunk.delta || ''), '') }
      else if (t === 'reasoning-delta') { out.reasoning += String(chunk.text || chunk.delta || ''); emit('', String(chunk.text || chunk.delta || '')) }
      else if (t === 'usage') out.usage = chunk.usage || null
      else if (t === 'tool-call-delta') {
        let call = out.calls.find((c) => c.id === chunk.id)
        if (!call) { call = { id: chunk.id, name: '', arguments: '' }; out.calls.push(call) }
        if (chunk.name) call.name = chunk.name
        call.arguments += String(chunk.argumentsDelta || '')
      } else if (t === 'block-end' && chunk.block && chunk.block.type === 'tool-call') {
        const b = chunk.block
        const hit = out.calls.find((c) => c.id === b.id)
        // block-end 给的是**装配好的**参数 ⇒ 覆盖 delta 拼出来的那份（文件头观察点）
        if (hit) { hit.name = b.name || hit.name; hit.arguments = b.arguments || hit.arguments }
        else out.calls.push({ id: b.id, name: b.name, arguments: b.arguments })
      } else if (t === 'finish') {
        out.finish = chunk.reason || chunk.finish || null
        const kind = out.finish && out.finish.kind
        if (kind === 'error' || kind === 'aborted') {
          out.error = 'llm-' + kind + ': ' + JSON.stringify((out.finish && out.finish.failure) || {})
        }
      }
    }
  } catch (e) {
    out.error = String((e && e.message) || e)
  }
  out.ms = Date.now() - t0
  return out
}

/**
 * **只读工具循环**：模型自己决定读什么/搜什么，直到给出结论或撞上限。
 *
 * `llm.stream` 必须由调用方注入（本模块不碰 ctx，便于用桩做定点核对）。
 * **绝不静默失败**：出错/空产出/超时都如实报进返回值，由调用方决定回落（见 index.js）。
 *
 * @param opts.llm      宿主 llm 服务（只要有 stream）
 * @param opts.cfg       { provider, model }
 * @param opts.system    解释层系统提示词（本函数**追加**工具用法说明）
 * @param opts.messages  已有消息（解释层的 user message）
 * @param opts.root      项目根（**必须由调用方解析出本会话的 cwd**；本函数不猜）
 * @param opts.rootListing 是否预注入顶层清单（默认 true，省掉"先 glob 一遍"的那一轮）
 * @param opts.count     轮次上限（默认 3，硬上限 6）
 * @param opts.budgetMs  总时限（默认 60s）
 * @param opts.now       注入时钟（定点核对用，默认 Date.now）
 * @returns {{ok, text, error, rounds, toolCalls, names, trace, capped, ms, root, empty}}
 */
export async function runReadOnlyToolLoop(opts) {
  const o = opts || {}
  const llm = o.llm
  const cfg = o.cfg || {}
  const now = typeof o.now === 'function' ? o.now : Date.now
  const t0 = now()
  const root = String(o.root == null ? '' : o.root)
  // 硬上限在这里兜住：调用方传 999 也只会跑到 6
  const want = Math.max(1, Math.floor(Number(o.count) || LOOP_DEFAULT_ROUNDS))
  const maxRounds = Math.min(want, LOOP_HARD_MAX_ROUNDS)
  const budgetMs = Math.max(1000, Number(o.budgetMs) || LOOP_BUDGET_MS)
  const deadline = t0 + budgetMs
  const base = { root, maxRounds, budgetMs }
  const fail = (error) => ({
    ...base, ok: false, empty: true, error: String(error), text: '', rounds: 0,
    toolCalls: 0, names: [], trace: [], capped: false, ms: now() - t0,
  })
  if (typeof root !== 'string' || !root) return fail('no-root')
  if (!llm || typeof llm.stream !== 'function') return fail('llm-unavailable')

  const messages = Array.isArray(o.messages) ? o.messages.slice() : []
  const system = String(o.system || '') + TOOLS_SYSTEM_NOTE
  // 顶层清单**预注入**：0.5 实测模型会把整轮预算花在 glob 上、一次都不 read。
  // 清单只声明**存在**，不等于知道内容——这条要写清楚，否则又变成"没读就写事实"。
  if (o.rootListing !== false) {
    try {
      const top = walkFiles(root, 60)
        .map((abs) => relative(root, abs).split('\\').join('/'))
        .filter((p) => p.indexOf('/') < 0)
        .slice(0, 40)
      if (top.length > 0) {
        messages.push({
          role: 'user',
          content: [{
            type: 'text',
            text: '【工具根目录顶层清单（只表示存在，不代表知道内容）】\n' + top.join('\n')
              + '\n\n要引用文件里的东西，仍然必须用 read 真正读它。',
          }],
        })
      }
    } catch { /* 清单拿不到就不给：少一样证据，不是错误 */ }
  }

  const trace = []
  let rounds = 0
  let capped = false
  let error = null
  let text = ''
  for (let round = 1; round <= maxRounds + 1; round += 1) {
    const useTools = round <= maxRounds && now() < deadline
    if (round > 1) {
      // 上一轮的正文是**脚手架**（"我先读一下项目结构…"），到下一轮就作废。
      // 不清掉的话，最终产出会被脚手架污染——这是 0.5 实测踩到的。
      text = ''
    }
    // 到上限这一轮：**明确告诉模型"到此为止，用已有证据给结论"**（不许它继续要工具）
    if (round === maxRounds + 1) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: '【系统】已达本次查证轮次上限，请立即用已获得的证据给出 JSON 产出，不要再请求工具。' }],
      })
    }
    const rt = now()
    let stream = null
    try {
      stream = llm.stream({
        provider: cfg.provider,
        model: cfg.model,
        system,
        messages,
        ...(useTools ? { tools: TOOL_SCHEMAS } : {}),
      })
    } catch (e) {
      return { ...base, ok: false, empty: true, error: 'stream-threw:' + String((e && e.message) || e), text: '',
        rounds, toolCalls: trace.length, names: namesOf(trace), trace, capped, ms: now() - t0 }
    }
    const r = await drainWithTools(stream, rt, typeof opts.onDelta === 'function' ? opts.onDelta : null)
    rounds = round
    if (r.text) text = r.text
    if (r.error) { error = r.error; break }
    const calls = Array.isArray(r.calls) ? r.calls.filter((c) => c && c.id && c.name) : []
    if (!useTools || calls.length === 0) break
    messages.push(assistantToolCallMessage(calls, cfg.provider, cfg.model))
    const outputs = []
    for (const call of calls) {
      let args = {}
      try { args = JSON.parse(call.arguments || '{}') } catch { args = {} }
      const st = now()
      const res = executeReadOnlyTool(root, call.name, args)
      trace.push({
        round, tool: String(call.name), args, ok: res.ok === true && res.rejected !== true,
        rejected: res.rejected === true,
        ms: now() - st,
        resultLines: String(res.text).split('\n').length,
      })
      outputs.push(res)
    }
    messages.push(...toolResultMessages(calls, outputs))
    if (round === maxRounds) capped = true
  }
  const outText = String(text || '')
  return {
    ...base, ok: !error, error, text: outText, rounds, toolCalls: trace.length,
    names: namesOf(trace), trace, capped, ms: now() - t0, empty: outText.trim().length === 0,
  }
}

/** trace → 去重后的工具名清单（台账字段 `toolNames`）。 */
function namesOf(trace) {
  const seen = []
  for (const t of Array.isArray(trace) ? trace : []) {
    const n = String((t && t.tool) || '')
    if (n && !seen.includes(n)) seen.push(n)
  }
  return seen
}
