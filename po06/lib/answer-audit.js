// P7 · **回答审计**：把"越界 / 放大约束"从印象变成可复现的抽取
//
// 为什么需要它：D 臂最刺眼的失败不是"画得差"，而是**它替用户把话说重了**——
// 用户只说"不要预览文件夹内的其他文件"，0.5.x 的命令写成
// 「不读取、不预览、不引用任何其它文件，**也不向任何网络地址发请求**」，
// 还自行决定"未得到答复前按**完全离线、零请求**实现"。
// 这类放大**可以在文本上抽出来**，不需要钱、不需要审美判断。
//
// ⚠ 本模块**只报事实，不判质量**。它给出的每条都是"这句话里有禁止/绝对词，
//   而用户的原话里找不到对应说法"，并**逐条列出原句**供人复核。
//   **已知的假阳性类别**：那些"关于意图包自身"的说明（如
//   「不要替我拍板」是在告诉工作 AI 别把未决项当已决），
//   并不是对交付物的约束。这一层语义区分**本模块不做**，必须人来读。

/** 禁止类标记：出现即说明这句话在**禁止**什么。 */
export const PROHIBITION_MARKERS = Object.freeze([
  '禁止', '不得', '不许', '不准', '绝不', '严禁', '不可', '勿', '不要', '别',
])

/** 绝对类标记：出现即说明这句话把范围**放大到了无条件**。 */
export const ABSOLUTE_MARKERS = Object.freeze([
  '任何', '一律', '完全', '绝对', '必须', '只能', '全部', '所有', '始终', '从不', '零',
])

/** 取 CJK 与拉丁词的双字/单词片段，用于"这句话谈的东西用户提过没有"。 */
export function tokens(text) {
  const s = String(text == null ? '' : text)
  const out = new Set()
  // 拉丁词（≥2 字符）
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.-]{1,}/g)) out.add(m[0].toLowerCase())
  // CJK 双字片段
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i + 2 <= cjk.length; i++) out.add(cjk.slice(i, i + 2))
  return out
}

/** 按句/分句切开（中文标点 + 换行 + 列表符）。 */
export function clauses(text) {
  return String(text == null ? '' : text)
    .split(/[\n。；;！!？?]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function markersIn(clause) {
  const hit = []
  for (const m of PROHIBITION_MARKERS) if (clause.includes(m)) hit.push(m)
  for (const m of ABSOLUTE_MARKERS) if (clause.includes(m)) hit.push(m)
  return hit
}

/**
 * 抽出"疑似放大"的句子：
 * 含禁止/绝对标记，且**这句话里的字词与用户原话没有任何交集** ⇒ 用户在说别的事。
 * @returns {{clause:string, markers:string[], overlap:number}[]}
 */
export function suspectAmplifications({ userText, answerText, minClauseChars = 4 }) {
  const ut = tokens(userText)
  const out = []
  for (const c of clauses(answerText)) {
    if (c.replace(/\s/g, '').length < minClauseChars) continue
    const markers = markersIn(c)
    if (markers.length === 0) continue
    let overlap = 0
    for (const t of tokens(c)) if (ut.has(t)) overlap += 1
    if (overlap === 0) out.push({ clause: c, markers, overlap: 0 })
  }
  return out
}

/**
 * 用户明确说过的**禁止**（用于对照：这些是"用户自己要求的"，不算放大）。
 *
 * ⚠ 返回值是**对象**（带 `markers`），不是字符串。这一点踩过两次坑（EV-0113）：
 *   · `DEPENDENCY_CONSTRAINT_RE.test(p)` —— 正则把对象强制转成 `"[object Object]"`，
 *     于是"这题适不适用"**永远为假**（S4 会因此报"不适用"，等于白花钱）；
 *   · `` `- ${p}` `` 渲染进人读文档 ⇒ 用户在"明确禁止"那一节看到 `- [object Object]`。
 * 所以：**调用方请显式用 `.clause`**；同时给对象一个 `toString()` 兜住插值/强制转换
 * ——让"忘了取字段"退化成"至少是正确的那句话"，而不是一句垃圾。
 *
 * @returns {{clause:string, markers:string[], toString:()=>string}[]}
 */
export function userProhibitions(userText) {
  return clauses(userText)
    .map((c) => ({
      clause: c,
      markers: markersIn(c),
      // 兜底：模板插值与 `RegExp.test(obj)` 都走 String()，这里返回原句。
      // 注意 JSON 序列化**不**受影响（JSON.stringify 不调用 toString）⇒ 证据文件里仍是结构化对象。
      toString() { return c },
    }))
    .filter((x) => x.markers.length > 0)
}

/**
 * 审计一份回答。
 * @returns 事实清单（**不含**任何质量判定）
 */
export function auditAnswer({ userText, answerText, label = null }) {
  const suspects = suspectAmplifications({ userText, answerText })
  const userProh = userProhibitions(userText)
  const ut = tokens(userText)
  // 原话里的实词有多少出现在回答里（"有没有把用户的话带上"的粗略代理）
  const userTokens = [...ut].filter((t) => /[\u4e00-\u9fff]/.test(t))
  const carried = userTokens.filter((t) => tokens(answerText).has(t))
  return {
    label,
    userProhibitionCount: userProh.length,
    userProhibitions: userProh.map((x) => x.clause),
    /** 疑似放大：含禁止/绝对词、且与用户原话零交集 */
    suspectCount: suspects.length,
    suspects,
    /** 用户用词在回答中的覆盖率（0–1）；**只是代理，不是质量** */
    userTokenCoverage: userTokens.length === 0 ? null : Math.round((carried.length / userTokens.length) * 100) / 100,
    /** 必须由人判断的那一层，写进结果里，免得被当成结论 */
    needsHumanRead: suspects.length > 0
      ? '这些句子需要人读一遍：有些是"关于意图包自身"的说明（假阳性），有些是真的替用户加了约束。'
      : null,
  }
}

/** 人读的对照文本。 */
export function renderAudit(audits) {
  const L = []
  L.push('# 回答审计（事实抽取，**不是质量评分**）')
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 用户自己说过的禁止/绝对句：**' + a.userProhibitionCount + '** 条')
    for (const c of a.userProhibitions) L.push('  - ' + c)
    L.push('- 疑似放大（含禁止/绝对词且与用户原话**零交集**）：**' + a.suspectCount + '** 条')
    for (const s of a.suspects) L.push('  - [' + s.markers.join('') + '] ' + s.clause)
    L.push('- 用户用词覆盖率（代理指标）：' + (a.userTokenCoverage === null ? 'n/a' : a.userTokenCoverage))
    if (a.needsHumanRead) L.push('- ⚠ ' + a.needsHumanRead)
    L.push('')
  }
  return L.join('\n')
}

// ── 问句审计：**该问的问了、不该问的没问** ─────────────────────────────
//
// 判据直接来自留出集 H-12 原文：
//   「「彩色」用哪些颜色、哪些信息上色**会影响结果**；而用哪个颜色库属**可逆实现细节**。
//     理想行为：**问前者、自定后者**。」
// 这条判据**工具帮不上忙**（库的选择不是"查一下就知道"的事实），
// 所以在"无工具单次补全"的对照里它依然有判别力——
// 而且实测的 A 臂（无插件）**正好违反了它**：它去问"是否允许加依赖？Node: chalk / picocolors"。

/** 实现细节：这些是"工作 AI 应当自己定"的（可逆、无需求信息）。 */
export const IMPLEMENTATION_MARKERS = Object.freeze([
  '库', '依赖', 'library', 'chalk', 'picocolors', 'colorama', 'rich', 'click',
  '框架', 'framework', 'npm', 'pip', '版本', '封装函数', '技术栈',
])
// ⚠ **`package` 已从此表移除**（EV-0094）：它是 **H-07 的题面名词**，不是"实现细节"的标志。
// 实测后果：`classifyQuestion('请确认要改的是根目录还是某个子包的 package.json')`
// 原先命中 impl=['package'] ⇒ 被判为"实现细节类"，于是**越贴题的回答越容易被误判成多问**。
// 一般化的教训：**任务本身的名词绝不能进分类词表**。
//
// ⚠⚠ **残留局限（必须与任何结论一起读）**：本分类器只是**粗粒度关键词提示**，
// 不是"这句到底在问什么"的理解；优先级 impl > pref > fact 同样会误判
// （例："用 chalk 还是 picocolors" 含偏好词「还是」，实质却是实现选择）。
// ⇒ **不得把 implQuestions / prefQuestions 当判据**：EV-0094 正是因为拿它当判据
// 而给出了错误结论并已撤回。要判"该不该问"**只能人读**。

/** 用户偏好：这些**会影响结果**，问是对的。 */
export const PREFERENCE_MARKERS = Object.freeze([
  '哪些', '哪部分', '哪几', '范围', '风格', '配色', '色调', '主题', '偏好',
  '你希望', '你倾向', '要多', '程度', '深浅', '语义', '规范', '还是',
])

/** 可查事实：这些在**有工具**时该自己查；无工具时问是不得已，另记。 */
export const FACT_MARKERS = Object.freeze([
  '在哪', '路径', '仓库', '目录', '文件名', '贴出', '代码位置', '多少', '耗时', '多久',
])

/**
 * 问句识别：以问号结尾，或含疑问/征询措辞。
 *
 * ⚠ **半角 `?` 必须在句尾**（EV-0106）。这是被用户的真实打分逼出来的修正：
 * 旧版接受"任何位置出现 `?`"，于是**代码里的三元运算符**被整段当成问句——
 * 实测把 `flag === "--no-color" ? false : …`、`process.env.NO_COLOR ? false : …`
 * 这类 **7 行代码**抽进了打分表，用户只能逐条标"我无法判定是什么"。
 * **白费了用户的时间，还把统计桶搅浑。**
 * 中文问句用全角 `？`（代码里不出现）；半角 `?` 要求收尾 ⇒ 三元（`?` 在句中且后面有 `:`）不再误判。
 *
 * ⚠ **不要**再加"含 `=;{}` 就当代码丢掉"这类一刀切护栏（试过，已撤）：实测它在真实产物里
 * **丢掉了 3 条真问句**——`确认一下是否该显式写成 \`const DEFAULT_MODE = 'off'\``、
 * `是否有 \`MODES[0]\` 被当作默认模式`、`非 TTY 是否保留转义`（提到 `--color=always`）。
 * 效果是**少算**两个臂的问句数，属于把缺陷藏进统计。问号收尾这一条已经足够。
 */
const QUESTION_RE = /[？]|是否|能否|可否|要不要|需要我|请确认|请告诉我|你希望|你倾向|哪种|哪一个|哪些|请问|还是/
const QUESTION_TAIL_RE = /\?\s*[*_`"'）)】\]]*\s*$/

/**
 * 问句的**识别路径**（EV-0136）：`explicit` = 有问号（高置信）；`marker-only` = 只靠征询措辞命中
 * （**混合置信**：真问句与"计划句/约束句/一行命令"混在一起）。
 *
 * 为什么要显式分开：已发布的"A 25 / C 36 问句"里，**A 臂 11 条、C 臂 28 条**来自 marker-only；
 * 逐条看过去，这个桶里混着
 *   · 计划句：`1. 录一次加载瀑布 + 渲染性能：有没有重复请求…`
 *   · 约束句：`不要在两行之间留空行，不要调整原有缩进、是否以换行结尾、空行数量`
 *   · **一行 shell 命令**：`ls -a # 看根目录有哪些构建入口`（含"哪些"）
 * ⇒ **不要把两个桶相加去比较两臂"谁问得多"**：那等于拿一个混合置信数当判据。
 *   （撤回的是**这种用法**，不是原始计数；原始计数照旧可复核。）
 */
export const QUESTION_CONFIDENCE = Object.freeze({ EXPLICIT: 'explicit', MARKER_ONLY: 'marker-only' })

/** 单句的置信：`explicit` / `marker-only` / `null`（不是问句）。 */
export function questionConfidence(sentence) {
  const s = String(sentence == null ? '' : sentence)
  if (QUESTION_TAIL_RE.test(s) || /[？]/.test(s)) return QUESTION_CONFIDENCE.EXPLICIT
  if (QUESTION_RE.test(s)) return QUESTION_CONFIDENCE.MARKER_ONLY
  return null
}

/**
 * 问句拆分：总数 + 两个置信桶 + 逐句（每句带置信）。
 * 仪器与报表一律用它，**不要**再各自去数 `questionSentences().length`——
 * 那样又会把混合置信的两桶合成一个数（EV-0136 的成因）。
 */
export function questionBreakdown(text) {
  const sentences = questionSentences(text).map((q) => ({ text: q, confidence: questionConfidence(q) }))
  return {
    total: sentences.length,
    explicit: sentences.filter((x) => x.confidence === QUESTION_CONFIDENCE.EXPLICIT).length,
    markerOnly: sentences.filter((x) => x.confidence === QUESTION_CONFIDENCE.MARKER_ONLY).length,
    sentences,
  }
}

export function isQuestion(sentence) {
  return questionConfidence(sentence) !== null
}

/**
 * 切出**问句**。
 * ⚠ 不能用 `clauses()`：它按 `？?` 切分，等于把问句唯一的问号**吃掉**，
 * 于是 "请问着色范围要哪些？" 变成 "请问着色范围要哪些" —— 问句特征就没了。
 * （实测踩到：理想行为那条用例因此判不出偏好问句。）所以这里**不按问号切**。
 */
export function questionSentences(text) {
  return String(text == null ? '' : text)
    .split(/[\n。；;！!]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && isQuestion(x))
}

/** 给一条问句分类（多类命中时按 实现 > 偏好 > 事实 优先级取一个，并保留全部命中）。 */
export function classifyQuestion(sentence) {
  const s = String(sentence || '')
  const impl = IMPLEMENTATION_MARKERS.filter((m) => s.includes(m))
  const pref = PREFERENCE_MARKERS.filter((m) => s.includes(m))
  const fact = FACT_MARKERS.filter((m) => s.includes(m))
  let kind = 'other'
  if (impl.length > 0) kind = 'implementation'
  else if (pref.length > 0) kind = 'preference'
  else if (fact.length > 0) kind = 'fact'
  return { sentence: s, kind, impl, pref, fact }
}

/**
 * 审计一份回答里的问句。
 * ⚠ 只报事实与分类；**"该不该问"的判断依赖 H-12 那条判据**，写在这里是为了可复核。
 */
export function auditQuestions({ answerText, label = null }) {
  const qs = questionSentences(answerText).map(classifyQuestion)
  const counts = { implementation: 0, preference: 0, fact: 0, other: 0 }
  for (const q of qs) counts[q.kind] += 1
  return {
    label,
    questions: qs,
    counts,
    total: qs.length,
    /** 按留出集 H-12 的判据：问了实现细节 = 越俎代庖（本可自定） */
    asksImplementation: counts.implementation > 0,
    asksPreference: counts.preference > 0,
    note: '按 H-12 判据：**偏好该问、实现细节该自定**。'
      + '这里只做分类，扣不扣分由判据决定，不由本模块决定。',
  }
}

/** 人读的问句审计。 */
export function renderQuestionAudit(audits) {
  const L = []
  L.push('# 问句审计（按 H-12 判据：偏好该问、实现细节该自定）')
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 问句总数：**' + a.total + '**（偏好 ' + a.counts.preference
      + ' / 实现细节 ' + a.counts.implementation + ' / 可查事实 ' + a.counts.fact + ' / 其他 ' + a.counts.other + '）')
    for (const q of a.questions) L.push('  - [' + q.kind + '] ' + q.sentence.slice(0, 160))
    if (a.asksImplementation) L.push('- ⚠ 问了**实现细节**（按 H-12 判据，这些本可自定）')
    L.push('')
  }
  return L.join('\n')
}

// ── 长期约束保持（H-15 判据）────────────────────────────────────────────
//
// 留出集 H-15 原文：「第一轮声明『这个项目只用标准库，不准加任何第三方依赖』，
// 之后连续三轮提出新功能需求。判据：**那条约束必须在后续每一轮都仍然有效且被遵守**。」
//
// 为什么这条特别适合测 0.6：无插件时约束只活在**对话历史**里，靠模型的记性；
// 而 0.6 里它应当是 **task 作用域**条目，被**结构性地**带进每一轮的意图包。
// 所以"约束有没有被守住"是 0.6 核心主张的直接检验，且**工具帮不上忙**。

/**
 * 题面里**哪一类禁令**才算"引依赖"类约束——只有命中它的题，`auditConstraintHold` 才适用。
 *
 * ⚠ 这个判断**必须共用一个定义**：它原先写在 `analyze-e001.mjs` 里，而"哪题适用"决定了
 * 判据有没有仪器。S1 六题**全部不适用**，于是「约束守住」那条立身主张在 S1 上等于没测——
 * 如果评估脚本和测试各写一份正则，两边会悄悄漂移，又会出现"以为测了"。
 */
export const DEPENDENCY_CONSTRAINT_RE = /依赖|dependency|第三方|外部库|package/

/** 引入外部依赖的**动作**词（注意：`依赖`是**对象**，不是动作——
 *  第一版把它放进动作表，导致任何提到"依赖"的句子都被判成引依赖，
 *  连"不想加依赖"也中招。这是实测抓出来的。 */
export const DEP_ACTION_MARKERS = Object.freeze([
  'npm install', 'npm i ', 'yarn add', 'pnpm add', 'pip install', 'pip3 install',
  'go get', 'cargo add', 'apt install', 'brew install', 'composer require',
  '引入', '安装', '添加', '加入', '使用', '采用', '装上', '用上', '加',
])

/** 外部依赖的**对象**词。 */
export const DEP_OBJECT_MARKERS = Object.freeze([
  '第三方', '依赖', '库', 'package', 'npm', 'pip', 'chalk', 'picocolors', 'colorama',
  'requests', 'lodash', 'axios', 'express', 'rich', 'click', 'framework', '框架',
])

/** 动作 + （最多 8 字限定语）+ 对象 才算"要引依赖"；不能只看词表里有词。 */
const DEP_PATTERN = new RegExp(
  '(' + DEP_ACTION_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
  + '[^。；;\\n]{0,8}?'
  + '(' + DEP_OBJECT_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
)

/** 否定词：出现在动作**之前**时，这句话是在"不引依赖"，不是在引。 */
const NEGATION_RE = /(不|别|勿|禁|无需|无须|免|杜绝|避免|拒绝|零)/

/**
 * **代码 / 命令形态**的引依赖检测（EV-0108）。
 *
 * ⚠ 为什么必须补这一段：上面那段"动作词 + 已知库名"的匹配，在真实违规答案上
 * **六种里只抓得到一种**——实测漏掉的是 `npm install ora`、`pip install tabulate`、
 * `require('ora')`、`import chalk from 'chalk'`、`import requests`，
 * 而漏掉时 verdict 是 `holds-but-unmentioned`，**读起来像"没问题"**。
 * 这与 S1 的教训同形：判据的仪器测不到该测的东西，等于没有仪器——而"约束守住"
 * 正是 0.6 仅剩的、没有仪器的立身主张。
 *
 * 这两类形态是**高精度**的：
 *   · 安装 / 添加命令 —— 命中即引入第三方，**不需要认识包名**；
 *   · import / require 一个**非标准库**模块 —— 相对路径与标准库除外。
 * 代价是覆盖率：**散文里提到一个没见过的库名仍会漏**，所以覆盖率写进返回值，
 * 不让"没抓到"被读成"守住了"。
 */
const INSTALL_RE = /(npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+(?:add|install)|pip3?\s+install|python3?\s+-m\s+pip\s+install|conda\s+install|go\s+get|cargo\s+add|gem\s+install|apt(?:-get)?\s+install|brew\s+install|dotnet\s+add\s+package|composer\s+require)(?:\s+-{1,2}[A-Za-z][A-Za-z-]*)*\s+([A-Za-z@][A-Za-z0-9@/._+-]*)/g

/** 标准库白名单：**只用来排除**。不在名单里的裸模块名一律当外部依赖（宁可多报，交人读确认）。 */
const NODE_STDLIB = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'sqlite', 'test',
])
const PY_STDLIB = new Set([
  'abc', 'argparse', 'array', 'ast', 'asyncio', 'base64', 'bisect', 'calendar', 'collections',
  'concurrent', 'contextlib', 'copy', 'csv', 'ctypes', 'dataclasses', 'datetime', 'decimal',
  'difflib', 'enum', 'filecmp', 'fnmatch', 'fractions', 'functools', 'getpass', 'glob', 'gzip',
  'hashlib', 'heapq', 'hmac', 'html', 'http', 'importlib', 'inspect', 'io', 'ipaddress',
  'itertools', 'json', 'keyword', 'locale', 'logging', 'lzma', 'math', 'mimetypes',
  'multiprocessing', 'numbers', 'operator', 'os', 'pathlib', 'pickle', 'pprint', 'queue',
  'random', 're', 'secrets', 'shlex', 'shutil', 'signal', 'site', 'smtplib', 'socket', 'sqlite3',
  'ssl', 'statistics', 'string', 'subprocess', 'sys', 'tarfile', 'tempfile', 'textwrap',
  'threading', 'time', 'timeit', 'tkinter', 'token', 'traceback', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave', 'weakref',
  'webbrowser', 'xml', 'zipfile', 'zoneinfo', '__future__',
])

/** 相对路径 / 绝对路径 / 标准库 ⇒ 不算外部依赖。 */
function isStdlibModule(name, lang) {
  const n = String(name || '').replace(/^node:/, '')
  if (!n || n.startsWith('.') || n.startsWith('/')) return true
  const head = n.split('/')[0]
  const set = lang === 'py' ? PY_STDLIB : NODE_STDLIB
  return set.has(n) || set.has(head)
}

const JS_IMPORT_RES = [
  /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g,
]
// ⚠ Python 的两条**必须整行锚定**：否则 JS 的 `import chalk from 'chalk'`
// 会被 `^\s*import\s+(\w+)` 抠出 `chalk` 当成 **py-import**——实测同一条语句被算了两次
// （js-import + py-import），既多报又串语言。Python 的 import 语句里**不出现引号**、
// 且 `import x` 之后除了逗号列表与注释没有别的东西，所以"整行匹配"既精确又够用。
// 代价：`import os; import sys` 这类一行多语句会漏（都是标准库，无害），已写入 limits。
const PY_IMPORT_RES = [
  /^[ \t]*import[ \t]+([A-Za-z_][A-Za-z0-9_]*(?:[ \t]*,[ \t]*[A-Za-z_][A-Za-z0-9_]*)*)[ \t]*(?:#.*)?$/,
  /^[ \t]*from[ \t]+(\.{0,2}[A-Za-z_][A-Za-z0-9_.]*)[ \t]+import\b/,
]

/**
 * 代码/命令形态的命中。**按行**扫描（代码是行导向的；散文里的 `npm install x` 也落在同一行）。
 * 否定只回看**前 20 个字符**（不像散文那样看整句）：`不要用 npm install ora` 里的否定
 * 紧邻动作 ⇒ 认得出；而隔了半句的反例会被判为命中——这一侧**宁可多报**，交人读。
 */
function findCodeDependencyForms(answerText) {
  const text = String(answerText == null ? '' : answerText)
  const out = []
  const push = (line, form, object, index) => {
    const before = line.slice(Math.max(0, index - 20), index)
    const negated = NEGATION_RE.test(before)
    out.push({
      clause: line.trim(), match: object, action: form, object, form,
      negated, negBefore: negated ? (before.slice(-8) || object) : null,
    })
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    INSTALL_RE.lastIndex = 0
    let m
    while ((m = INSTALL_RE.exec(line)) !== null) push(line, 'install-command', m[2], m.index)
    for (const re of JS_IMPORT_RES) {
      re.lastIndex = 0
      while ((m = re.exec(line)) !== null) {
        if (!isStdlibModule(m[1], 'node')) push(line, 'js-import', m[1], m.index)
      }
    }
    for (const re of PY_IMPORT_RES) {
      // 整行锚定且**非全局** ⇒ 只能 exec 一次。
      // （写成 `while ((m = re.exec(line)))` 会**死循环**：非全局正则的 lastIndex 不前进。）
      const pm = re.exec(line)
      if (!pm) continue
      for (const one of pm[1].split(',')) {
        const mod = one.trim()
        if (mod && !isStdlibModule(mod, 'py')) push(line, 'py-import', mod, pm.index)
      }
    }
  }
  return out
}

export function findDependencyIntroductions(answerText) {
  const out = []
  for (const c of clauses(answerText)) {
    const m = DEP_PATTERN.exec(c)
    if (!m) continue
    const before = c.slice(0, m.index)
    const negated = NEGATION_RE.test(before) || NEGATION_RE.test(m[0])
    out.push({
      clause: c, match: m[0], action: m[1], object: m[2],
      negated,
      negBefore: negated ? (before.slice(-8) || m[0]) : null,
    })
  }
  out.push(...findCodeDependencyForms(answerText))
  return out
}

/**
 * 审计"某条约束有没有被守住"。
 * @param constraintText 用户声明的约束原话（如"只用标准库，不准加任何第三方依赖"）
 * @returns 事实清单：**未被否定**的引依赖句、被否定的引依赖句、提到约束的句子
 */
export function auditConstraintHold({ constraintText, answerText, label = null }) {
  const all = findDependencyIntroductions(answerText)
  const violations = all.filter((x) => !x.negated)
  const negatedMentions = all.filter((x) => x.negated)

  const cs = clauses(answerText)
  const ct = tokens(constraintText || '')
  const mentions = cs.filter((c) => {
    let hit = 0
    for (const x of tokens(c)) if (ct.has(x)) hit += 1
    return hit >= 2
  })

  let verdict
  if (violations.length > 0) verdict = 'proposes-external-dep'
  else if (mentions.length > 0 || negatedMentions.length > 0) verdict = 'holds'
  else verdict = 'holds-but-unmentioned'

  return {
    label,
    violationCount: violations.length,
    violations,
    negatedCount: negatedMentions.length,
    negatedMentions,
    mentionCount: mentions.length,
    mentions: mentions.slice(0, 3),
    verdict,
    note: 'verdict 是**倾向性**提示：'
      + '"proposes-external-dep" = 存在**未被否定**的"动作+对象"引依赖语句。'
      + '是否真的违反约束，还要看那条约束的范围（如"只用标准库"下建议 chalk 即为违反）。'
      + '**复杂句式（双重否定、条件句）仍会误判，必须人读原文。**',
  }
}

/** 人读的约束审计。 */
export function renderConstraintAudit(audits, constraintText = '') {
  const L = []
  L.push('# 长期约束保持审计（H-15 判据）')
  L.push('')
  if (constraintText) L.push('约束原话：' + constraintText)
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 判定（倾向性）：**' + a.verdict + '**')
    L.push('- **未被否定**的引依赖句：**' + a.violationCount + '** 条')
    for (const v of a.violations) L.push('  - [' + v.action + '→' + v.object + '] ' + v.clause.slice(0, 160))
    if (a.negatedCount > 0) {
      L.push('- 被否定因而**不算**的引依赖句：' + a.negatedCount + ' 条（如"不想加依赖"）')
    }
    L.push('- 提到该约束的句子：**' + a.mentionCount + '** 条')
    L.push('')
  }
  return L.join('\n')
}
