// 文档漂移检查（EV-0103）：状态类文档里的**数字必须与产物一致**。
//
// 为什么需要：本项目最常见的缺陷类型不是代码错，而是**文档写了过期数字**。
// 实测修过的就有：测试数 340→346→368→376、变异数 96→103→119→125、
// S1 预算 227,775→1,530,366→105,048、以及"0.5.x 仍在装"这类过期断言。
// 每次都是**靠人偶然看到**才修的——那等于没有保障。本脚本把它变成可执行检查。
//
// 口径（重要）：
//   · **检查**：状态/结论类文档——README、RELEASE-CHECKLIST、CHECKPOINT、S1 报告。
//     这些文档描述的是"**现在**是什么状态"，数字过期就是错的。
//   · **不检查**：`EVIDENCE.md`。它是**按时间追加的日志**，里面写着"当时是 340 项"
//     是**正确的历史记录**，不是漂移。把它一起查会把正确的历史判成错误。
//
// 用法：node po06/scripts/check-docs.mjs [--strict]     --strict 时不一致以非零码退出
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const REPO = join(ROOT, '..')
const strict = process.argv.includes('--strict')

const rc = JSON.parse(readFileSync(join(ROOT, 'eval', 'release-check.json'), 'utf8'))
const AUTHORITATIVE = {
  suites: Object.keys(rc.tests || {}).length,
  pass: Object.values(rc.tests || {}).reduce((s, t) => s + (t.pass || 0), 0),
  mutants: rc.mutation ? rc.mutation.total : null,
  // 变异覆盖的**源文件数**：文档里长期写着"20 个源文件"而实际是 24 ——
  // 因为这个数字此前**没有任何检查**（计数检查只认"项测试/套/个变异"）。EV-0115
  sourceFiles: rc.mutation ? (rc.mutation.sourceFiles ?? null) : null,
  // `lib/ 22 个模块` 这类数字同样漂过：写 22 时实际已是 27。数字不查就等于会过期。
  // 这一条**没有默认值**（只有 --lib-modules 传进来才有），因为本脚本自己数不准
  // "什么算一个模块"，得由调用方（门）数完再传。
  libModules: null,
}

// ⚠ **一轮延迟的坑（EV-0107）**：`release-check.json` 是**上一次**跑门时才写的，
// 所以本脚本默认比的是"上一轮"的权威值——本次刚涨上去的计数**当轮查不出来**，
// 要等下一轮才报。后果：发版门可能带着**过期文档通过一次**（本轮实测就撞上了：
// 文档写 377 项 / 127 变异，实际已是 380 / 129，而门禁报 PASS）。
// ⇒ 由 `check-release.mjs` 把**本轮**实测值用 `--suites/--pass/--mutants/--source-files` 传进来覆盖。
const argNum = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? Number(process.argv[i + 1]) : NaN }
for (const [key, flag] of [['suites', '--suites'], ['pass', '--pass'], ['mutants', '--mutants'], ['sourceFiles', '--source-files'], ['libModules', '--lib-modules']]) {
  const v = argNum(flag)
  if (Number.isFinite(v) && v > 0) AUTHORITATIVE[key] = v
}

/**
 * 状态类文档（见顶部口径）。
 * ⚠ **CHECKPOINT.md 也排除**：它同样是**逐轮追加的日志**
 * （"第 12 轮…变异 25 个"记录的是**当时**的数量，正确无误）。
 * 把日志类的文档一起查，会把正确的历史判成漂移——第一版就犯了两次这个错
 * （先漏了 EVIDENCE，又把 CHECKPOINT 算进来）。
 * 真正需要"永远是最新"的只有下面这三份：包 README、根 README、发布检查表。
 */
const DOCS = [
  join(REPO, 'README.md'),
  join(ROOT, 'README.md'),
  join(ROOT, 'RELEASE-CHECKLIST.md'),
  join(ROOT, 'eval', 'E001-S1-REPORT.md'),
]

/**
 * 要核对的模式：**只认全局计数**，不认"某条证据里有 N 项"这类局部叙述。
 * 为什么必须收窄：第一版用 `(\d+)\s*项` 去匹配，结果 82 条里绝大多数是假警报
 * （`EV-0023（18 项）` 说的是**那条证据当时的**用例数，不是项目总数）。
 * 满屏假警报的检查等于没有检查——所以宁可只查最明确的几种写法。
 */
const PATTERNS = [
  // `N 项测试` / `N 项单测` / 裸 `N 项` 都算（EV-0107：只认"项测试"时，
  // `26 套 / 376 项` 和 `377 项单测` 这两种写法**逃过**了检查——而它们正是漂移的那两处）。
  // 裸 `N 项` 会带来局部叙述（如"这条证据里有 18 项"），靠下面的 n<20 下限挡掉。
  { re: /\*{0,2}(\d+)\s*项(?:测试|单测)?/g, key: 'pass', what: '测试项数' },
  { re: /\*{0,2}(\d+)\s*套(?:\s*测试)?/g, key: 'suites', what: '测试套数' },
  { re: /\*{0,2}(\d+)\s*个\s*变异/g, key: 'mutants', what: '变异数' },
  // "N 个源文件"也要查：这个数字**漂了很久没人发现**（文档写 20、实际 24），
  // 因为上面三条模式都不认它。数字同样有 ≥20 的下限保护，不会误伤局部叙述。
  { re: /\*{0,2}(\d+)\s*个\s*源文件/g, key: 'sourceFiles', what: '变异覆盖的源文件数' },
  // `lib/ N 个模块`：**锚在 `lib/` 前缀上**，所以不存在"局部叙述"的歧义 ⇒ 不需要 n≥20 下限
  // （模块数真掉到 19 也照样要查）。这一条是 EV-0132 补的：同一份 README 里
  // "22 个模块"已经漂到 27，而没有任何检查认它。
  { re: /lib\/\s*(\d+)\s*个模块/g, key: 'libModules', what: 'lib 模块数', floor: 1 },
]

const findings = []
for (const doc of DOCS) {
  if (!existsSync(doc)) continue
  const lines = readFileSync(doc, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { re, key, what, floor } of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        const n = Number(m[1])
        // 跳过**括注型**局部叙述：`EV-0035（23 项）` 说的是**那条证据当时**的用例数，
        // 不是项目总数。宽化模式（认裸 `N 项`）后立刻冒出 2 条这种假警报——
        // 它们的共同形状是"数字紧跟左括号"，所以按这个形状排除，而不是把模式再收窄
        // （收窄会让 `26 套 / 376 项` 这种**真漂移**再次逃掉，EV-0107）。
        //
        // ⚠ 但"紧跟左括号"这个形状**本身也会掩盖真漂移**（EV-0132 实测）：README 首屏写着
        // `（393 项测试 / 160 个变异 / …）`——393 紧跟在 `（` 后面 ⇒ 整条被跳过，
        // 而紧邻的 160 因为前面是 `/` 被抓了出来。**同一个括注里一半被查、一半不查**。
        // 所以排除要**再细一层**：括注里的**裸计数**（`（23 项）`，没有单位词）才是局部叙述；
        // 带单位词的（`项测试` / `个变异` / `个源文件` / `套测试`）就是本项目全局计数，一律要查。
        const before = line[m.index - 1]
        const unit = /\d+\s*(?:项测试|项单测|个\s*变异|个\s*源文件|套\s*测试)/.test(m[0])
        if ((before === '（' || before === '(') && !unit) continue
        const expected = AUTHORITATIVE[key]
        if (expected === null) continue
        // 只报**比权威值小**的（本项目计数只增不减 ⇒ 过期就是把旧的、更小的数留在文档里）。
        // 再加一个下限：本项目**全局**计数都 ≥20，而"某个特性有 3 个变异守卫"这类
        // **局部**叙述都是个位数 ⇒ 用 n<20 把它们排除。这是**针对本项目的经验阈值**，
        // 不是通用规则；写在这里是为了让假警报降到可读的程度。
        // 仍会有假警报（如"12 项测试全绿"讲的是当时那个套件），所以本检查默认**只提示**、
        // 不影响退出码；`--strict` 才当门禁。宁可是提示，也不要一个满屏假警报的门禁。
        // 每个模式可以自带 `floor`：锚得足够死的模式（如 `lib/ N 个模块`）把下限放到 1，
        // 免得"数字小就一定安全"这条经验把真正要查的情况挡掉。
        if (n < (floor ?? 20)) continue
        if (n < expected) {
          findings.push({
            doc: doc.replace(REPO, '').replace(/\\/g, '/').replace(/^\//, ''),
            line: i + 1, what, found: n, expected,
            text: line.trim().slice(0, 110),
          })
        }
      }
    }
  })
}

console.log('文档漂移检查（状态类文档；EVIDENCE.md 作为历史日志**不在范围内**）')
console.log('权威值：' + JSON.stringify(AUTHORITATIVE))

// ── 指向检查（EV-0114）：文档里引用的**仓内路径**必须真的存在 ──────────────
// 为什么要有：文档写错数字会被上面的计数检查抓到，但**指错文件**谁也发现不了——
// 用户点进去是 404/不存在，而那正是"这份文档可不可信"的第一印象。
//
// 收窄规则（第一版太天真，一次报了 16 处、其中大多数不是问题）：
//   · **构建产物**（`.tgz`）跳过：它们本来就不在仓里（`.gitignore` 明确忽略）；
//   · **运行时配置文件**（`po06.json` / `prompt-optimizer.json`）跳过：它们住在**用户的 home**，
//     文档提到它们是讲"去哪写配置"，不是"仓里有这个文件"——这一条**显式列出**，不靠猜；
//   · **裸文件名**（`check-release.mjs`）按**全仓同名文件索引**判定：文档里常见简写，
//     要求写全路径是苛求；但同名文件**一个都没有**就一定是错的。
const RUNTIME_ONLY_NAMES = new Set(['po06.json', 'prompt-optimizer.json'])
/**
 * 指向检查**只覆盖 0.6 的文档**（根 README 只查"有没有提当前版本号"）。
 * 为什么不在根 README 的全部正文上查：那一大段是 **0.5 线**的说明，里面引用了
 * `evidence/prompt-*.cjs` 这类**被 .gitignore 明确排除**的文件（作者本机有、仓里没有），
 * 以及若干已搬走的脚本。把那些一起报出来是**真的**，但不属于本轮范围，
 * 而且会淹没 0.6 侧的真问题——"满屏假警报的检查等于没有检查"（EV-0103 的教训）。
 * 根 README 的门面问题由下面的**版本号检查**负责。
 */
const POINTER_DOCS = DOCS.filter((d) => d.includes(`${'po06'}`) || d.includes('RELEASE-CHECKLIST') || d.includes('E001-S1-REPORT'))
const pointerFindings = []
const LOOKS_LIKE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(md|mjs|cjs|js|json|yml|yaml|txt)$/
const SKIP_PREFIX = ['http', 'node:', 'file:', '/', 'C:', '~', '*.', './', '../', 'dsh-']
// 全仓同名文件索引（跳过依赖目录）
const basenameIndex = new Set()
const walkRepo = (dir, depth = 0) => {
  if (depth > 4) return
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkRepo(p, depth + 1)
    else basenameIndex.add(e.name)
  }
}
walkRepo(REPO)
for (const doc of POINTER_DOCS) {
  if (!existsSync(doc)) continue
  readFileSync(doc, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim()
      if (!LOOKS_LIKE_PATH.test(raw)) continue
      if (SKIP_PREFIX.some((p) => raw.startsWith(p))) continue
      if (raw.includes('<') || raw.includes('*') || raw.includes(' ')) continue
      if (raw.endsWith('.tgz')) continue                          // 构建产物，不在仓里
      if (RUNTIME_ONLY_NAMES.has(raw)) continue                   // 用户 home 里的配置文件
      const docDir = dirname(doc)
      const ok = raw.includes('/')
        ? [join(REPO, raw), join(docDir, raw), join(ROOT, raw)].some((p) => existsSync(p))
        : basenameIndex.has(raw)                                  // 裸文件名 ⇒ 全仓同名索引
      if (!ok) {
        pointerFindings.push({
          doc: doc.replace(REPO, '').replace(/\\/g, '/').replace(/^\//, ''),
          line: i + 1, path: raw, text: line.trim().slice(0, 100),
        })
      }
    }
  })
}

// ── 引文检查（EV-0128）：全仓引用的 EV-#### **必须真的存在** ─────────────
// 为什么：EV 编号是这套"可复核证据"的锚点。引用一个不存在的编号，追下去是空的——
// 而**这正是伪造证据最容易发生的方式**（我自己就干过一次：docstring 里写 EV-0108）。
// 首次全仓扫描抓出 **10 处悬空引用**，其中包含**生产代码注释**（`index.js` 引用了
// EV-0087/0089/0101/0102，四个都不存在）⇒ 已全部补登（见 EVIDENCE.md 的"补登"一节）。
const citationFindings = []
/** 引文检查实际扫过多少个文件——**0 表示这个检查什么都没看**（不许再冒充通过）。 */
let CITATION_SCANNED = 0
const evPath = join(REPO, 'EVIDENCE.md')
if (existsSync(evPath)) {
  const evText = readFileSync(evPath, 'utf8')
  const defined = new Set([...evText.matchAll(/^#+\s*(EV-\d{4})/gm)].map((m) => m[1]))
  // 顶层 `## EV-####` 才是"一个条目"；`### EV-#### 补充` 是同一编号的延伸，**不算重复**。
  const topCounts = new Map()
  for (const m of evText.matchAll(/^##\s+(EV-\d{4})/gm)) topCounts.set(m[1], (topCounts.get(m[1]) || 0) + 1)
  for (const [id, n] of topCounts) {
    if (n > 1) citationFindings.push({ file: 'EVIDENCE.md', what: '编号被顶层定义了 ' + n + ' 次', id })
  }
  const walkRepoFiles = (dir, out = [], depth = 0) => {
    if (depth > 6) return out
    let es = []
    try { es = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of es) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'evidence') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walkRepoFiles(p, out, depth + 1)
      else if (/\.(js|mjs|cjs|md)$/.test(e.name)) out.push(p)
    }
    return out
  }
  let scanned = 0
  for (const f of walkRepoFiles(REPO)) {
    let s = ''
    // ⚠ **这里的 catch 曾经把整个检查变成空的**（EV-0128）：`statSync` 忘了 import ⇒
    // 每个文件都在这一行抛错 ⇒ 被 `catch { continue }` 吞掉 ⇒ 扫了 0 个文件却报 ✅。
    // 所以现在**统计扫过的文件数**并打印出来：一个"什么都不看"的检查不许再冒充通过。
    try {
      if (statSync(f).size > 4_000_000) continue
      s = readFileSync(f, 'utf8')
    } catch { continue }
    scanned += 1
    for (const c of new Set([...s.matchAll(/EV-(\d{4})/g)].map((m) => 'EV-' + m[1]))) {
      if (!defined.has(c)) {
        citationFindings.push({
          file: f.replace(REPO, '').replace(/\\/g, '/').replace(/^\//, ''),
          what: '引用了台账里不存在的编号', id: c,
        })
      }
    }
  }
  CITATION_SCANNED = scanned
}

// ── 门面检查（EV-0114）：**根 README 必须提到当前在发的 0.6 版本号** ─────────
// 为什么：根 README 是 GitHub 上的门面。它此前**整页还是 v0.5.1**，
// 于是"0.6.0-beta.1 已经发布"这件事在新访客眼里不存在——而没有任何检查会发现，
// 因为它既不是计数漂移、也不是预算漂移，它只是**首页讲的是另一条产品线**。
const frontFindings = []
const po06PkgPath = join(ROOT, 'package.json')
if (existsSync(po06PkgPath)) {
  const v = JSON.parse(readFileSync(po06PkgPath, 'utf8')).version
  const rootReadme = join(REPO, 'README.md')
  if (existsSync(rootReadme) && !readFileSync(rootReadme, 'utf8').includes(v)) {
    frontFindings.push({ doc: 'README.md', expected: v, why: '根 README（GitHub 门面）里没有当前 0.6 版本号' })
  }
}

// ── 预算类数字（EV-0104）───────────────────────────────────────────────
// 为什么也要查：S1 的预算在本项目里漂移过**三次**
// （227,775 假设 → 1,530,366 跨类借价 → 105,048 修正常量），
// 而"授权上界"是**用户据此掏钱的数字**——写错不是排版问题。
// 权威值取自产物 `po06/eval/plan-E001.json` 的 `stages`（由 plan-e001.mjs 生成）。
const planPath = join(ROOT, 'eval', 'plan-E001.json')
const PLAN = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : null
const budgetFindings = []
if (PLAN && PLAN.stages) {
  const fmt = (n) => n.toLocaleString('en-US')
  // 只认**显式且无歧义**的预算主张：`上界 105,048` / `期望 35,016` / `预算 35,016`。
  // 第一版粗暴地"抓行内所有六位数"，结果把**实测花费**（103,368）也当成预算错误——
  // 假警报的来源又一次是"模式太宽"。所以这里要求：① 数字紧跟在"上界/期望/预算"之后；
  // ② 该行**只提到一个**分期（同时提 S1 与 S2 的行无法判断数字归属，直接跳过）。
  // ⚠ **已知局限**：数字要求 **≥4 位**（或带千分位），所以三位数的预算主张查不到。
  // 本项目所有分期预算都是四位数以上，所以这个限制目前无害；但它**是**一个覆盖缺口，
  // 已由 `test/check-docs.test.mjs` 用四位数 fixture 钉住真实行为（不是靠注释自觉）。
  // ⚠ 分期清单**从 plan-E001.json 推导**，不再写死（EV-0115）。
  // 原先是 `['S1','S2','S3']`，于是 v2 追加的 **S4 从来没被检查过**：
  // 只提到 S4 的行会被 `length !== 1` 直接 `return` 掉——**静默跳过**，
  // 与"分析器写死 S1 白名单"（EV-0113）是同一个毛病的第二例。
  const STAGE_KEYS = Object.keys(PLAN.stages)
  const CLAIM = /(上界|期望|预算)\s*[:：]?\s*\*{0,2}\s*(\d{1,3}(?:,\d{3})+|\d{4,})/g
  for (const doc of DOCS) {
    if (!existsSync(doc)) continue
    readFileSync(doc, 'utf8').split('\n').forEach((line, i) => {
      const stagesHere = STAGE_KEYS.filter((s) => line.includes(s))
      if (stagesHere.length !== 1) return
      const exp = PLAN.stages[stagesHere[0]]
      if (!exp) return
      CLAIM.lastIndex = 0
      let m
      while ((m = CLAIM.exec(line)) !== null) {
        const kind = m[1]
        const n = Number(m[2].replace(/,/g, ''))
        // 跳过"全量/合计"语境的数字：`…全量 18 题为期望 1,600,398` 说的是**整期总量**，
        // 不是该分期的数字。用"匹配位置之前的片段"判断，而不是整行（整行里往往两者都有）。
        const prefix = line.slice(0, m.index)
        if (/全量|合计|全部|总共/.test(prefix.split(/[；;。]/).pop() || '')) continue
        const ok = kind === '上界' ? n === exp.upper
          : kind === '期望' ? n === exp.expected
            : (n === exp.upper || n === exp.expected)
        if (!ok) {
          budgetFindings.push({
            doc: doc.replace(REPO, '').replace(/\\/g, '/').replace(/^\//, ''),
            line: i + 1, stage: stagesHere[0], kind, found: m[2],
            expected: kind === '期望' ? fmt(exp.expected) : fmt(exp.upper),
            text: line.trim().slice(0, 110),
          })
        }
      }
    })
  }
}
console.log('预算口径：' + (PLAN && PLAN.stages
  ? Object.entries(PLAN.stages).map(([k, v]) => `${k} 上界 ${v.upper} / 期望 ${v.expected}`).join('；')
  : '（无 plan-E001.json，跳过）'))
console.log('检查文件：' + DOCS.filter((d) => existsSync(d)).length + ' 份')
console.log('')
if (findings.length === 0) {
  console.log('✅ 计数类数字：未发现过期')
} else {
  console.log('⚠ 发现 ' + findings.length + " 处计数与产物不一致（可能是历史叙述，也可能是真漂移——需人看一眼）：")
  for (const f of findings) {
    console.log(`  ${f.doc}:${f.line}  ${f.what}: 文档写 ${f.found}，产物是 ${f.expected}`)
    console.log(`      ${f.text}`)
  }
}
if (budgetFindings.length === 0) {
  console.log('✅ 预算类数字：未发现与 plan-E001.json 不符的上界/期望值')
} else {
  console.log('⚠ 发现 ' + budgetFindings.length + ' 处预算数字不在该期已知口径内：')
  for (const f of budgetFindings) {
    console.log(`  ${f.doc}:${f.line}  ${f.stage} 行内出现 ${f.found}（该期上界应为 ${f.expected}）`)
    console.log(`      ${f.text}`)
  }
}
if (pointerFindings.length === 0) {
  console.log('✅ 指向：文档里引用的仓内路径都存在')
} else {
  console.log('⚠ 发现 ' + pointerFindings.length + ' 处**指向不存在的文件**（点了就是空的）：')
  for (const f of pointerFindings) {
    console.log(`  ${f.doc}:${f.line}  \`${f.path}\` 不存在`)
    console.log(`      ${f.text}`)
  }
}
if (frontFindings.length === 0) {
  console.log('✅ 门面：根 README 提到了当前 0.6 版本号')
} else {
  console.log('⚠ 门面问题（GitHub 首页讲的不是当前在发的那条线）：')
  for (const f of frontFindings) console.log(`  ${f.doc}：${f.why}（应为 ${f.expected}）`)
}
if (citationFindings.length === 0) {
  if (CITATION_SCANNED === 0) {
    // 一个什么都没扫的检查**不许报通过**（EV-0128 的教训：它曾经就是这样骗过了我）
    console.log('❌ 引文：**一个文件都没扫到**（检查是空的，不能当作通过）')
    citationFindings.push({ file: '(scan)', id: '-', what: '引文检查扫了 0 个文件' })
  } else {
    console.log('✅ 引文：全仓引用的 EV 编号都能在 EVIDENCE.md 里找到（扫过 ' + CITATION_SCANNED + ' 个文件）')
  }
} else {
  console.log('⚠ 发现 ' + citationFindings.length + ' 处**引文问题**（追下去是空的 = 证据链断了）：')
  for (const f of citationFindings) console.log(`  ${f.file}  ${f.id}  ${f.what}`)
}
const total = findings.length + budgetFindings.length + pointerFindings.length + frontFindings.length + citationFindings.length
if (strict && total > 0) process.exit(1)
