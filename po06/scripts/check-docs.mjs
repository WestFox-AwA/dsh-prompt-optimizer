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
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const REPO = join(ROOT, '..')
const strict = process.argv.includes('--strict')

const rc = JSON.parse(readFileSync(join(ROOT, 'eval', 'release-check.json'), 'utf8'))
const AUTHORITATIVE = {
  suites: Object.keys(rc.tests || {}).length,
  pass: Object.values(rc.tests || {}).reduce((s, t) => s + (t.pass || 0), 0),
  mutants: rc.mutation ? rc.mutation.total : null,
}

// ⚠ **一轮延迟的坑（EV-0107）**：`release-check.json` 是**上一次**跑门时才写的，
// 所以本脚本默认比的是"上一轮"的权威值——本次刚涨上去的计数**当轮查不出来**，
// 要等下一轮才报。后果：发版门可能带着**过期文档通过一次**（本轮实测就撞上了：
// 文档写 377 项 / 127 变异，实际已是 380 / 129，而门禁报 PASS）。
// ⇒ 由 `check-release.mjs` 把**本轮**实测值用 `--suites/--pass/--mutants` 传进来覆盖它。
const argNum = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? Number(process.argv[i + 1]) : NaN }
for (const [key, flag] of [['suites', '--suites'], ['pass', '--pass'], ['mutants', '--mutants']]) {
  const v = argNum(flag)
  if (Number.isFinite(v)) AUTHORITATIVE[key] = v
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
]

const findings = []
for (const doc of DOCS) {
  if (!existsSync(doc)) continue
  const lines = readFileSync(doc, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { re, key, what } of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        const n = Number(m[1])
        // 跳过**括注型**局部叙述：`EV-0035（23 项）` 说的是**那条证据当时**的用例数，
        // 不是项目总数。宽化模式（认裸 `N 项`）后立刻冒出 2 条这种假警报——
        // 它们的共同形状是"数字紧跟左括号"，所以按这个形状排除，而不是把模式再收窄
        // （收窄会让 `26 套 / 376 项` 这种**真漂移**再次逃掉，EV-0107）。
        const before = line[m.index - 1]
        if (before === '（' || before === '(') continue
        const expected = AUTHORITATIVE[key]
        if (expected === null) continue
        // 只报**比权威值小**的（本项目计数只增不减 ⇒ 过期就是把旧的、更小的数留在文档里）。
        // 再加一个下限：本项目**全局**计数都 ≥20，而"某个特性有 3 个变异守卫"这类
        // **局部**叙述都是个位数 ⇒ 用 n<20 把它们排除。这是**针对本项目的经验阈值**，
        // 不是通用规则；写在这里是为了让假警报降到可读的程度。
        // 仍会有假警报（如"12 项测试全绿"讲的是当时那个套件），所以本检查默认**只提示**、
        // 不影响退出码；`--strict` 才当门禁。宁可是提示，也不要一个满屏假警报的门禁。
        if (n < 20) continue
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
  const CLAIM = /(上界|期望|预算)\s*[:：]?\s*\*{0,2}\s*(\d{1,3}(?:,\d{3})+|\d{4,})/g
  for (const doc of DOCS) {
    if (!existsSync(doc)) continue
    readFileSync(doc, 'utf8').split('\n').forEach((line, i) => {
      const stagesHere = ['S1', 'S2', 'S3'].filter((s) => line.includes(s))
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
const total = findings.length + budgetFindings.length
if (strict && total > 0) process.exit(1)
