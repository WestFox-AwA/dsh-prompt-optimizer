// 宿主 llm 模块的**可移植定位**（EV-0132）。
//
// 为什么需要这一层：`createUserMessage` / `createSystemMessage` 是 dsh-llm 导出的
// **纯构造函数**（给消息生成 identity 并冻结），它们**不在** llm 服务对象上——
// 服务只有 stream / listProviders / resolveModelInfo / prepareCall 这些调用侧能力，
// 而"构造一条 plugin 来源消息"必须有构造函数。所以投递那一环只能 import 模块本身。
//
// 而模块位置**随安装方式变化**：npm 全局前缀、npx 缓存、别的盘符、macOS/Linux 前缀、
// 用户自己改过的 node 目录，全都不一样。曾经这里写死一条**本机绝对路径**——
// `file:///` 接上作者机器上的 npm 全局前缀，再接
// `@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js`。后果是具体的：
// 别人机器上**投递步骤必然失败** → 而自检的 `report.ok` 要求 `deliverNotice.queued === true`
// → 用户跑自检看到的是"插件没通过"，实际坏的是那条写死的路径。
//
// 定位顺序（先到先用）：
//   ① `DSH_PO06_LLM_LIB`：显式覆盖。写成文件 URL 或绝对路径时**必须真实存在**，
//      写错就如实报 `not-found` 并继续下一个候选（不猜、不静默降级）；写成包名则按下面 ② 的基准解析。
//   ② 以**宿主进程自己的入口**（`process.argv[1]`，本机实测是
//      `<npm 前缀>/node_modules/@deepseek-ai/dsh/lib/bin.js`）为基准解析包名——
//      Node 会沿着 dsh 安装树找到它自己的 `node_modules/@deepseek-ai/dsh-llm`。
//      这条不写任何盘符/用户名，所以在任何安装位置都成立；它是**唯一**的自动定位手段。
//
// 全部失败就返回 `{ ok:false, reason:'llm-lib-unresolved', tried:[…] }`，
// 由调用方决定怎么报告（自检记一步失败、评估台直接抛）。
// 反面做法（这里明确不做）：回落到某个"看起来像"的路径、或返回空对象让后面莫名其妙地崩。
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 要找的包名。bare specifier：解析基准由调用环境决定（见文件头 ②）。 */
export const LLM_PKG = '@deepseek-ai/dsh-llm'
/** 显式覆盖环境变量。 */
export const OVERRIDE_ENV = 'DSH_PO06_LLM_LIB'

/** 是不是"文件 URL"（`file://…`）；其余带 scheme 的（http 等）也算 URL，交给 import 处理。 */
function isFileUrl(s) { return /^file:\/\//i.test(s) }

/**
 * 把用户的写法归一成 `import()` 能吃的说明符。
 * URL 原样；本地绝对路径转 file URL（**盘符式路径直接喂给 import 会报
 * "Only URLs with a scheme in Node.js are supported"**，必须先转）；其余原样当包名/相对说明符。
 * @param value 任意写法（可为空）
 * @returns {string|null} 说明符；空值返回 null
 */
export function toImportSpec(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (isAbsolute(s)) return pathToFileURL(s).href
  return s
}

/** 错误 → 一行原因（优先 `code`，取不到就用 message）。 */
function reasonOf(e) {
  if (!e) return 'unknown'
  return String(e.code || e.message || e)
}

/** 默认解析器：以 `base`（绝对路径或 file URL）为基准解析包名。 */
function defaultResolveSpec(base, spec) {
  return createRequire(base).resolve(spec)
}

/**
 * 有序候选清单。**纯函数**（不做 IO、不抛），便于单测钉住顺序与形状。
 *
 * @param opts.env    环境变量表（默认 `{}`：单测可完全控制）
 * @param opts.argv1  宿主入口路径（`process.argv[1]`）
 * @param opts.cwd    argv1 是相对路径时的补全基准
 * @returns {Array<{source:string, spec:string, base?:string}>}
 */
export function llmLibCandidates({ env = {}, argv1 = '', cwd = '' } = {}) {
  const out = []
  const ov = toImportSpec(env[OVERRIDE_ENV])
  if (ov) out.push({ source: 'env:' + OVERRIDE_ENV, spec: ov })
  // createRequire 要求绝对路径或 file URL：相对入口按 cwd 补全，补不出来就不给这个候选
  // （宁缺勿猜：拿一个错基准解析出来的路径比"没找到"更危险）。
  const raw = String(argv1 || '').trim()
  if (raw) {
    let base = ''
    if (isFileUrl(raw)) base = raw
    else if (isAbsolute(raw)) base = raw
    else if (cwd) base = resolve(String(cwd), raw)
    if (base) out.push({ source: 'host-entry', spec: LLM_PKG, base })
  }
  return out
}

/**
 * 解析出可以 `import()` 的说明符（不真的加载）。
 *
 * @param opts.env, opts.argv1, opts.cwd  见 llmLibCandidates
 * @param opts.resolveSpec  注入：`(base, spec) => 绝对路径`（默认 createRequire().resolve）
 * @param opts.exists       注入：存在性检查（默认 fs.existsSync）
 * @returns {{ok:boolean, spec?:string, path?:string, source?:string, reason?:string,
 *            tried:Array<{source:string, spec:string, reason?:string}>}}
 */
export function resolveLlmLib({ env = {}, argv1 = '', cwd = '', resolveSpec, exists = existsSync } = {}) {
  const res = resolveSpec || defaultResolveSpec
  const cands = llmLibCandidates({ env, argv1, cwd })
  const hostBase = (cands.find((c) => c.base) || {}).base
  const tried = []
  for (const c of cands) {
    // 包名形式：必须有解析基准
    if (c.spec === LLM_PKG || (!c.base && !isFileUrl(c.spec) && !isAbsolute(c.spec))) {
      if (!hostBase) { tried.push({ source: c.source, spec: c.spec, reason: 'no-base-to-resolve' }); continue }
      try {
        const p = res(hostBase, c.spec)
        tried.push({ source: c.source, spec: p })
        return { ok: true, spec: pathToFileURL(p).href, path: p, source: c.source, tried }
      } catch (e) {
        tried.push({ source: c.source, spec: c.spec, reason: reasonOf(e) })
        continue
      }
    }
    // 文件形式（显式覆盖写成 URL/绝对路径）：路径写错要能一眼看出来
    const p = isFileUrl(c.spec) ? fileURLToPath(c.spec) : c.spec
    if (!exists(p)) { tried.push({ source: c.source, spec: c.spec, reason: 'not-found' }); continue }
    tried.push({ source: c.source, spec: c.spec })
    return { ok: true, spec: c.spec, path: p, source: c.source, tried }
  }
  return { ok: false, reason: 'llm-lib-unresolved', tried }
}

/**
 * 解析 + 真正 import。
 * @param opts.importMod 注入：`(spec) => Promise<模块>`（默认动态 import）
 * @returns 解析结果 + `mod`；失败时 `ok:false` 且带 `tried`
 */
export async function loadLlmLib(opts = {}) {
  const { importMod, ...rest } = opts
  const r = resolveLlmLib(rest)
  if (!r.ok) return r
  const imp = importMod || ((s) => import(s))
  try {
    const mod = await imp(r.spec)
    return { ...r, mod }
  } catch (e) {
    return { ok: false, reason: 'import-failed:' + reasonOf(e), tried: r.tried }
  }
}

/**
 * 需要"拿到就用"的调用方（评估台）：拿不到就抛，且错误里带**试过哪些**。
 */
export async function requireLlmLib(opts = {}) {
  const r = await loadLlmLib(opts)
  if (!r.ok) {
    const t = (r.tried || []).map((x) => x.source + '=' + x.spec + (x.reason ? '(' + x.reason + ')' : '')).join(' | ')
    throw new Error('llm-lib-unresolved: ' + (r.reason || '') + ' tried: ' + (t || '(none)'))
  }
  return r.mod
}
