// P10 · **只读工具路径**的定点核对（`lib/read-tools.js` + `interpretViaLlm` 的工具分支）。
//
// 为什么必须新建这个套件（真机 bug，2026-09-24，用户原话："只读工具开启的情况下,拦截UI不会显示思考.
// 并且no-packet问题,之前似乎只修复了无只读工具模式"）：
//   ① 工具循环里写了一句 `...(signal ? { signal } : {})`，而 `signal` **从来没在这个作用域里定义过**
//      ⇒ 建流当场 ReferenceError ⇒ 工具循环**一轮都没跑**（台账 `rounds:0 calls:0
//      stream-threw:signal is not defined`），全靠无工具回落兜着；
//   ② 回落那次调用 `plainDrain` 漏了思维流的 sink ⇒ 开着工具时界面**一个字都看不到**。
//   两处都在"开着工具才走的那条分支"里，而**这条分支此前没有任何测试**——所以它们安静地活了下来。
// 本套件把这条分支钉住：**一轮真的跑过、信号真的传下去、思维真的到得了界面、回落也不吞思维**。
//
// 做法：**桩 llm**（不花钱、不联网）+ 临时目录里的真文件（工具是真执行的，不打桩）。
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { runReadOnlyToolLoop, drainWithTools, executeReadOnlyTool, toolResultMessages, assistantToolCallMessage } from '../lib/read-tools.js'
import { interpretViaLlm } from '../lib/index.js'
import { loadLlmLib, toolResultShape } from '../lib/llm-lib.js'
import { fileURLToPath } from 'node:url'

// ⚠ **必须在这里就把"宿主 llm 模块"指到夹具上**（在下面任何用例调用之前）：
// 工具结果的形状由该模块决定（0.1.7+ 有 `createToolResultMessage`）。测试环境里解析不到
// 真实宿主安装树，若不指过来，循环会因为"形状不明"不造结果消息、悄悄收敛 ⇒
// 用例就分不清"形状检测坏了"和"模块没装"（2026-09-24 实测撞到过）。
const FIXTURE_LLM = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'llm-lib-017.mjs')
process.env.DSH_PO06_LLM_LIB = FIXTURE_LLM

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
/**
 * ⚠ 用例可以是 **async**（本套件要 await 真跑的循环）。写法必须 **收集 promise 再统一 await**：
 * 第一版直接 `fn()`，于是 async 用例里抛的错变成**未处理的 rejection**——摘要照样打印 `pass 8 / fail 0`，
 * 退出码却是 1（"全绿"和"没跑"看起来一样，正是本项目最防的那种假绿）。
 */
const pending = []
function t(name, fn) { pending.push(Promise.resolve().then(fn).then(() => { pass += 1 }, (e) => { failures.push({ name, error: String((e && e.message) || e) }) })) }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'po06-rt-'))
  DIRS.push(d)
  writeFileSync(join(d, 'note.txt'), 'hello from the tool root\n', 'utf8')
  return d
}

/** 把一串 chunk 包成一个**异步可迭代**的流（宿主 `llm.stream` 的返回形状）。 */
function streamOf(chunks) {
  return (async function* gen() { for (const c of chunks) yield c })()
}
const textDelta = (s) => ({ type: 'text-delta', text: s })
const reasonDelta = (s) => ({ type: 'reasoning-delta', text: s })
const usageChunk = (n) => ({ type: 'usage', usage: { totalTokens: n } })
const toolCall = (id, name, args) => ([
  { type: 'tool-call-delta', id, name, argumentsDelta: JSON.stringify(args) },
  { type: 'block-end', block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
])
const finish = (reason = 'stop') => ({ type: 'finish', reason: { kind: reason } })

/** 桩 llm：按调用次序吐预设的 chunk 序列，并**记下每次调用收到的参数**（形状可核）。 */
function stubLlm(sequences) {
  const calls = []
  return {
    calls,
    stream(opts) {
      calls.push(opts)
      const seq = sequences[Math.min(calls.length - 1, sequences.length - 1)]
      return streamOf(seq)
    },
  }
}

// ── ① 工具路径**真的跑起来了**（`signal is not defined` 那类"整条分支当场死"的回归守卫）──
t('工具循环真的跑了一轮、真的执行了工具（不是 0 轮就抛）', async () => {
  const root = tmpRoot()
  const llm = stubLlm([
    [...toolCall('c1', 'read', { path: 'note.txt' }), finish()],
    [textDelta('{"ops":[]}'), usageChunk(7), finish()],
  ])
  const r = await runReadOnlyToolLoop({ llm, cfg: { provider: 'p', model: 'm' }, system: 'S', messages: [], root, count: 2 })
  eq(r.ok, true, '不应失败：' + JSON.stringify({ error: r.error, rounds: r.rounds }))
  eq(r.error, null, '不该有任何 error（`signal is not defined` 就是从这里冒出来的）')
  ok(r.rounds >= 1, '至少跑过一轮：' + r.rounds)
  eq(r.toolCalls, 1, '应当执行了 1 次工具调用')
  ok(r.trace.some((x) => x.tool === 'read'), '工具轨迹里应看到 read：' + JSON.stringify(r.trace))
})

// ── ② 取消信号**真的传下去了**（用户按「跳过并发送」时模型调用要当场停）──
t('取消信号传到宿主流的参数里（不是只在注释里存在）', async () => {
  const root = tmpRoot()
  const ac = new AbortController()
  const llm = stubLlm([[textDelta('{"ops":[]}'), finish()]])
  await runReadOnlyToolLoop({ llm, cfg: { provider: 'p', model: 'm' }, system: 'S', messages: [], root, count: 1, signal: ac.signal })
  eq(llm.calls.length, 1, '应当调用了一次流')
  ok(llm.calls[0].signal === ac.signal, '流的参数里必须带上调用方给的 signal')
  // 反向确认：没给信号时**不许**凭空造一个（免得宿主以为这次可取消）
  const llm2 = stubLlm([[textDelta('x'), finish()]])
  await runReadOnlyToolLoop({ llm: llm2, cfg: {}, system: 'S', messages: [], root, count: 1 })
  ok(!('signal' in llm2.calls[0]), '没给 signal 时不应传这个字段')
})

// ── ③ 思维片段**到得了 sink**（界面之所以能看到思考，全靠这一条）──
t('工具的思维增量进 sink（开工具时界面才有"思考"可显示）', async () => {
  const seen = []
  const s = streamOf([reasonDelta('先看目录'), textDelta('{"ops":[]}'), finish()])
  const r = await drainWithTools(s, Date.now(), (d) => seen.push(d))
  eq(r.reasoning, '先看目录', 'reasoning 要收全')
  ok(seen.some((d) => d.reasoning === '先看目录'), '思维增量必须流给 sink：' + JSON.stringify(seen))
  ok(seen.some((d) => typeof d.reasoningChars === 'number'), '每条都要带累计字数（界面按它判断有没有新内容）')
})

// ── ④ 回落那次调用**也要喂 sink**（真机 bug：开着工具时主路就是回落）──
t('工具回落（无工具那次）不吞思维：sink 必须一路传下去', async () => {
  const root = tmpRoot()
  // 第一段：工具循环给的是**散文**（不是那份 JSON）⇒ 必然回落；第二段：回落给的也是散文但带思维
  const llm = stubLlm([
    [textDelta('我看了 note.txt，内容是 hello。'), finish()],
    [reasonDelta('回落这次也要能被看见'), textDelta('{"ops":[]}'), finish()],
  ])
  const seen = []
  const r = await interpretViaLlm({
    llm, cfg: { provider: 'p', model: 'm' }, userPrompt: 'x',
    system: 'S+TOOLS', systemNoTools: 'S', tools: { enabled: true, root, count: 2, reason: 'enabled' },
    onDelta: (d) => seen.push(d),
  })
  eq(r.via, 'tools-fallback', '工具产出不是 JSON ⇒ 必须走回落（这条就是开着工具时的主路）')
  ok(seen.some((d) => String(d.reasoning || '').includes('回落这次也要能被看见')),
    '回落那次调用的思维必须到 sink，否则界面只有"已用 N 秒"：' + JSON.stringify(seen))
  ok(llm.calls.length >= 2, '回落确实又调了一次模型（代价要真实发生，不能假装）')
})

// ── ⑤ 工具给的**真是那份 JSON** 时，直接认工具路径（不白跑一次回落）──
t('工具产出是 JSON ⇒ 走 tools 路径，且带得回工具代价', async () => {
  const root = tmpRoot()
  const llm = stubLlm([
    [...toolCall('c1', 'read', { path: 'note.txt' }), finish()],
    [textDelta('{"ops":[{"op":"noop"}]}'), finish()],
  ])
  const r = await interpretViaLlm({
    llm, cfg: { provider: 'p', model: 'm' }, userPrompt: 'x',
    system: 'S+TOOLS', systemNoTools: 'S', tools: { enabled: true, root, count: 2, reason: 'enabled' },
  })
  eq(r.via, 'tools', '是 JSON 就该认工具路径：' + JSON.stringify({ via: r.via, err: r.error }))
  eq(r.context.toolCalls, 1, '工具代价要如实带回（真花掉了）')
  eq(r.context.toolsEnabled, true, '要标明这次开了工具')
})

// ── ⑥ 不给 root / 关掉工具时**不许**走工具路径（三重与条件回归）──
t('没有 root ⇒ 工具路径不启动（错误也要如实回报）', async () => {
  const llm = stubLlm([[textDelta('{"ops":[]}'), finish()]])
  const r = await runReadOnlyToolLoop({ llm, cfg: {}, system: 'S', messages: [], root: '', count: 3 })
  eq(r.ok, false, '没有根目录就该拒绝')
  eq(r.error, 'no-root', '错因要具体：' + r.error)
  eq(llm.calls.length, 0, '一次模型调用都不该发生（不许先花钱再说）')
})

// ── ⑦ 工具执行本身：越界要拒、未知工具要拒（只读边界不能被绕过）──
t('只读边界：越界路径与未知工具都被明确拒绝', () => {
  const root = tmpRoot()
  const out = executeReadOnlyTool(root, 'read', { path: '../secret.txt' })
  eq(out.ok, false, '越界必须拒绝')
  ok(String(out.text).includes('拒绝'), '拒绝理由要能被模型读到：' + out.text)
  const unknown = executeReadOnlyTool(root, 'write', { path: 'note.txt' })
  eq(unknown.ok, false, '未知工具必须拒绝（本循环只有 read/glob/grep）')
})

// ── ⑧ 变异守卫的定点：`drainWithTools` 的 sink 抛错**不许**带垮模型调用 ──
t('sink 抛错不影响收集（展示层坏了不能拖累解释）', async () => {
  const s = streamOf([reasonDelta('r'), textDelta('{"ops":[]}'), finish()])
  const r = await drainWithTools(s, Date.now(), () => { throw new Error('界面炸了') })
  eq(r.text, '{"ops":[]}', '正文仍要收全')
  eq(r.reasoning, 'r', '思维仍要收全')
  eq(r.error, null, 'sink 的问题不该被记成模型错误')
})

// ── ⑨ 工具结果的**消息形状**（0.1.7 真机缺陷的守卫）──────────────────────────
// 为什么必须钉死：旧代码把结果塞进 **user 消息的 `tool-result` 块**，而 0.1.7 起工具结果
// 是**一等 `role:'tool'` 消息**。形状错了**不会报错**，只会让宿主在建流时回一句
// `llm.error: cannot represent user/tool-result content`（台账 `UNSUPPORTED_CONTENT`）
// ⇒ 开了"只读工具"的每一轮，工具循环第 2 轮就断。原来这条路径**一个测试都没有**。
t('工具结果的形状 = 0.1.7 的一等 tool 消息（不是塞进 user 的 tool-result 块）', async () => {
  // `env` 由调用方显式给（`loadLlmLib` 的默认是空表，为的是让候选顺序可单测）
  const loaded = await loadLlmLib({ env: process.env })
  ok(loaded.ok === true, '夹具模块要能被解析到：' + JSON.stringify(loaded.reason || loaded))
  const msgs = toolResultMessages(
    [{ id: 'c1', name: 'read', arguments: '{}' }],
    [{ ok: true, text: 'hello from the tool root' }],
    loaded,
  )
  eq(msgs.length, 1, '一次调用一条结果消息')
  const m = msgs[0]
  eq(m.role, 'tool', '必须是 tool 角色：' + JSON.stringify(m))
  eq(m.toolCallId, 'c1', '要带 provider 给的调用 id')
  eq(m.source && m.source.kind, 'tool', 'source.kind 是 tool')
  eq(m.source && m.source.callId, 'c1', 'source.callId 也要带')
  eq(m.isError, false, '成功不算错')
  eq(m.content.length, 1, '内容块**直接**是 content（不再包一层 tool-result）')
  eq(m.content[0].type, 'text', '结果正文是文本块')
  ok(String(m.content[0].text).includes('hello'), '正文要在：' + JSON.stringify(m.content[0]))
  ok(!JSON.stringify(m.content).includes('tool-result'), '**不得**再出现 tool-result 这种内容块类型')
  const asst = assistantToolCallMessage([{ id: 'c1', name: 'read', arguments: '{"path":"note.txt"}' }], 'p', 'm', loaded.mod)
  eq(asst.role, 'assistant', '助手请求工具仍是 assistant')
  eq(asst.content[0].type, 'tool-call', '带 tool-call 块')
  eq(asst.source.kind, 'model', 'source.kind 是 model')
})

t('只认旧形状的宿主 ⇒ 退回 user + tool-result 块（代次差异只在一处决定）', () => {
  const legacy = { createUserMessage: (i) => ({ role: 'user', content: i.content, source: i.source }) }
  const shape = toolResultShape(legacy)
  eq(shape.shape, 'legacy-user-block', '没有 createToolResultMessage 就用旧形状')
  const msgs = toolResultMessages([{ id: 'c9' }], [{ ok: false, text: '读取被拒绝' }], shape)
  eq(msgs.length, 1, '仍然要产出消息')
  eq(msgs[0].role, 'user', '旧形状是 user 角色')
  eq(msgs[0].content[0].type, 'tool-result', '旧形状用 tool-result 块')
  eq(msgs[0].content[0].toolCallId, 'c9', '块里带调用 id')
  eq(msgs[0].content[0].isError, true, '失败要标 isError')
  eq(toolResultShape({}).shape, 'none', '两个工厂都没有 ⇒ 形状未知（不得猜）')
  eq(toolResultMessages([{ id: 'c' }], [{}], null).length, 0, '形状未知时不造消息（宁可不发，也不发模型读不懂的）')
})

await Promise.all(pending)
console.log(JSON.stringify({
  suite: 'po06-read-tools', phase: 'P10',
  total: pass + failures.length, pass, fail: failures.length, failures,
}, null, 2))
if (failures.length > 0) process.exit(1)
