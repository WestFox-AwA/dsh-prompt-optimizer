// P7 / E-001 · **可复现的分析脚本**（不调模型、不花钱）
//
// 为什么必须有这个文件：EV-0088 的三判据数字（放大 A0/C0、问句 A27/C41、实现细节类 A5/C12）
// 最初是在一个**临时脚本**里算出来的，而那个脚本被删了 ⇒ 数字**无法被任何人复核**（包括我自己）。
// 那与"每阶段必须有可复核证据"直接冲突。本脚本把它固化下来：
//   node po06/scripts/analyze-e001.mjs <units目录> [--json <输出>]
//
// 三件判据各自的**适用边界**（不能混着用，否则会造出没有意义的指标）：
//   ① 放大      auditAnswer.suspectAmplifications —— 答案是否新增用户没说过的硬约束
//   ② 该问才问  auditQuestions —— 答案里的问句属于"用户偏好"（该问）还是"实现细节"（不该问）
//   ③ 约束守住  auditConstraintHold —— **只适用于"引依赖"类约束**（EV-0074 的那一类）。
//      对别的约束它会一律返回 holds-but-unmentioned，那不是结论、是噪声，所以本脚本**分开统计**，
//      并且只在题面确实含"引依赖"类禁令时才计入。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseHoldout, tasksForStage, HOLDOUT_SEAL } from '../lib/eval-plan.js'
import { auditAnswer, auditQuestions, userProhibitions, auditConstraintHold } from '../lib/answer-audit.js'

const REPO = join(import.meta.dirname, '..')
const UNITS = process.argv[2]
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null })()
if (!UNITS) { console.error('usage: node analyze-e001.mjs <unitsDir> [--json out.json]'); process.exit(2) }

const tasks = parseHoldout(readFileSync(join(REPO, 'eval', HOLDOUT_SEAL.file), 'utf8'))
const s1 = tasksForStage(tasks, 'S1')
const byId = new Map(s1.map((t) => [t.id, t]))

/** "引依赖"类禁令的判据词（只有命中才用 ③，避免把噪声当结论）。 */
const DEP_PROHIBITION = /依赖|dependency|第三方|外部库|package/

const rows = []
for (const f of readdirSync(UNITS)) {
  const m = f.match(/^(H-\d+)-(A|C)-r(\d)\.md$/)
  if (!m || !byId.has(m[1])) continue
  const [, taskId, arm] = m
  const answerText = readFileSync(join(UNITS, f), 'utf8')
  const userText = byId.get(taskId).body

  const a = auditAnswer({ userText, answerText, label: f })
  const q = auditQuestions({ answerText, label: f })
  const qs = q.questions || q.items || []
  const proh = userProhibitions(userText)
  const depProh = proh.filter((p) => DEP_PROHIBITION.test(p))

  rows.push({
    unit: f, taskId, arm,
    amplification: (a.suspectAmplifications || a.hits || []).length,
    needsHumanRead: a.needsHumanRead === true,
    questions: qs.length,
    prefQuestions: qs.filter((x) => /pref/i.test(String(x.class || x.kind || ''))).length,
    implQuestions: qs.filter((x) => /impl/i.test(String(x.class || x.kind || ''))).length,
    prohibitions: proh.length,
    // ③ 只在题面有"引依赖"类禁令时才计（否则 null = 不适用，而不是 0 = 没违反）
    depViolations: depProh.length ? depProh.map((p) => auditConstraintHold({ constraintText: p, answerText, label: f }).violationCount).reduce((s, n) => s + n, 0) : null,
  })
}

const arms = [...new Set(rows.map((r) => r.arm))].sort()
const sum = (arm, key) => rows.filter((r) => r.arm === arm).reduce((s, r) => s + (r[key] || 0), 0)
const count = (arm) => rows.filter((r) => r.arm === arm).length
const applicable = (arm) => rows.filter((r) => r.arm === arm && r.depViolations !== null)

const out = { unitsDir: UNITS, tasks: s1.map((t) => t.id), byArm: {}, perTask: {} }
console.log('units analysed =', rows.length, '| tasks =', s1.map((t) => t.id).join(','))
console.log('')
console.log('判据'.padEnd(26) + arms.map((a) => (a + ' 臂').padEnd(10)).join(''))
const line = (label, fn) => console.log(label.padEnd(24) + arms.map((a) => String(fn(a)).padEnd(10)).join(''))
line('可疑放大（越少越好）', (a) => sum(a, 'amplification'))
line('需人工阅读的单元数', (a) => rows.filter((r) => r.arm === a && r.needsHumanRead).length)
line('答案问句总数', (a) => sum(a, 'questions'))
line('  └ 用户偏好类（该问）', (a) => sum(a, 'prefQuestions'))
line('  └ 实现细节类（不该问）', (a) => sum(a, 'implQuestions'))
line('题面禁令条数（分母）', (a) => sum(a, 'prohibitions'))
line('引依赖类违反（仅适用题）', (a) => {
  const ap = applicable(a)
  if (ap.length === 0) return '不适用'
  return ap.reduce((s, r) => s + r.depViolations, 0) + '/' + ap.length + ' 单元'
})
for (const a of arms) {
  out.byArm[a] = {
    units: count(a),
    amplification: sum(a, 'amplification'),
    questions: sum(a, 'questions'),
    prefQuestions: sum(a, 'prefQuestions'),
    implQuestions: sum(a, 'implQuestions'),
    prohibitions: sum(a, 'prohibitions'),
    dependencyApplicableUnits: applicable(a).length,
    dependencyViolations: applicable(a).length ? applicable(a).reduce((s, r) => s + r.depViolations, 0) : null,
  }
}
for (const task of s1) {
  const id = task.id
  out.perTask[id] = {}
  for (const a of arms) {
    const rs = rows.filter((r) => r.taskId === id && r.arm === a)
    out.perTask[id][a] = {
      units: rs.length,
      amplification: rs.reduce((s, r) => s + r.amplification, 0),
      questions: rs.reduce((s, r) => s + r.questions, 0),
      implQuestions: rs.reduce((s, r) => s + r.implQuestions, 0),
    }
  }
}
console.log('')
console.log('按题（放大 / 问句 / 实现细节类）：')
for (const task of s1) {
  const id = task.id
  const cells = arms.map((a) => `${a}:${out.perTask[id][a].amplification}/${out.perTask[id][a].questions}/${out.perTask[id][a].implQuestions}`)
  console.log('  ' + id + '  ' + cells.join('   '))
}

// ── 完全指定任务的**机械正确性检查**（EV-0095）─────────────────────────
// 为什么单独做这个：问句分类器已被证明不可靠（EV-0094），而 H-07/H-08/H-09 三题的
// **要求是题面完全指定的**（改哪个字段成什么值 / 加哪一行 / 排成什么顺序），
// 于是"答案有没有把这件事说对"可以用**字面包含**判定，不需要任何"理解"。
// 判据在**看结果之前**就写在这里（不是看完答案再挑标准）。
// 局限：字面包含**不等于**答案正确（可能说对了却给了错命令），但**不包含 = 一定没答对**，
// 所以它只能证伪、不能证实——报"未提及"是硬信号，"提及"只是必要条件。
const SPECIFIED = [
  { id: 'H-07', what: '把 private 改成 true', must: [/private/i, /\btrue\b/i] },
  { id: 'H-08', what: '加上 # 项目说明 这一行', must: [/^\s*#\s*项目说明\s*$/m] },
  { id: 'H-09', what: '顺序改为 [all, allowlist, off]', must: [/all['"]?\s*,\s*['"]?allowlist['"]?\s*,\s*['"]?off/i] },
]
console.log('')
console.log('完全指定任务的机械检查（必要条件：题面要求的关键内容必须出现在答案里）：')
out.specified = {}
for (const spec of SPECIFIED) {
  out.specified[spec.id] = { what: spec.what, byArm: {} }
  const cells = []
  for (const a of arms) {
    const rs = rows.filter((r) => r.taskId === spec.id && r.arm === a)
    let mentioned = 0
    for (const r of rs) {
      const txt = readFileSync(join(UNITS, r.unit), 'utf8')
      if (spec.must.every((re) => re.test(txt))) mentioned += 1
    }
    out.specified[spec.id].byArm[a] = { units: rs.length, mentioned }
    cells.push(`${a}: ${mentioned}/${rs.length}`)
  }
  console.log('  ' + spec.id + '（' + spec.what + '）  ' + cells.join('   '))
}
console.log('  注：以上是"必要条件"检查——未提及=一定没答对；提及≠已答对（还需人读）。')
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(out, null, 2), 'utf8'); console.log('\nwrote ' + JSON_OUT) }
