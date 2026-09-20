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
import { parseHoldout, tasksForStage, HOLDOUT_SEAL, STAGES } from '../lib/eval-plan.js'
import { auditAnswer, auditQuestions, userProhibitions, auditConstraintHold, questionSentences, DEPENDENCY_CONSTRAINT_RE } from '../lib/answer-audit.js'

const REPO = join(import.meta.dirname, '..')
const UNITS = process.argv[2]
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null })()
if (!UNITS) { console.error('usage: node analyze-e001.mjs <unitsDir> [--json out.json]'); process.exit(2) }

const tasks = parseHoldout(readFileSync(join(REPO, 'eval', HOLDOUT_SEAL.file), 'utf8'))
const allById = new Map(tasks.map((t) => [t.id, t]))

/**
 * **分析哪些题，由"units 目录里实际有什么"决定，不由写死的分期决定。**（EV-0113）
 *
 * ⚠ 这里原来写死 `tasksForStage(tasks, 'S1')`，然后用它当白名单**静默跳过**别的题。
 * 后果：S4（v2 追加的两题）跑完之后，分析器会把那些单元**一声不响地全丢掉**，
 * 输出 `units analysed = 0`——而"0"很容易被读成"没东西可看"，而不是"仪器不认这些题"。
 * 这正是本项目反复吃过的同一类亏：**花钱买来的东西没被仪器覆盖**（EV-0078 的近亲）。
 */
const UNIT_RE = /^(H-\d+)-(A|C)-r(\d)\.md$/
const unitFiles = readdirSync(UNITS).filter((f) => UNIT_RE.test(f))
const idsInUnits = [...new Set(unitFiles.map((f) => f.match(UNIT_RE)[1]))].sort()
const unknownIds = idsInUnits.filter((id) => !allById.has(id))
// 分期名只用来**标注**，不用来筛。
const stageOf = (id) => Object.values(STAGES).filter((s) => s.ids.includes(id)).map((s) => s.key).join('/') || '?'
const ANALYSED = idsInUnits.filter((id) => allById.has(id)).map((id) => allById.get(id))

/** "引依赖"类禁令的判据词（只有命中才用 ③，避免把噪声当结论）。
 *  ⚠ 定义已移到 `lib/answer-audit.js` 的 `DEPENDENCY_CONSTRAINT_RE`：
 *  "哪题适用"决定了判据有没有仪器，评估脚本与测试**必须共用一份定义**。 */
const DEP_PROHIBITION = DEPENDENCY_CONSTRAINT_RE

/**
 * **已判定无效的题**（EV-0093）：在"无工具单次补全"下判据无法被满足。
 * 汇总统计必须把它们排除——实测教训：H-11 上 A 臂的"高稳定性"其实来自
 * "每次都很稳定地说我读不到仓库"，那是**稳定地无用**，会**虚高** A 臂的稳定性得分。
 * 结论表与稳定性表都要给"含/不含无效题"两个口径，且**以不含的为准**。
 */
const INVALID_ITEMS = Object.freeze(['H-11'])

const rows = []
for (const f of readdirSync(UNITS)) {
  const m = f.match(UNIT_RE)
  if (!m || !allById.has(m[1])) continue
  const [, taskId, arm] = m
  const answerText = readFileSync(join(UNITS, f), 'utf8')
  const userText = allById.get(taskId).body

  const a = auditAnswer({ userText, answerText, label: f })
  const q = auditQuestions({ answerText, label: f })
  const qs = q.questions || q.items || []
  const proh = userProhibitions(userText)
  // ⚠ 必须取 `.clause`：`userProhibitions` 返回的是**对象**。
  // 直接 `DEP_PROHIBITION.test(p)` 会被强制转成 "[object Object]" ⇒ 恒为假 ⇒
  // 该判据**永远显示"不适用"**（EV-0113 实测：S4 的两题也照样"不适用"，等于白花钱）。
  const depProh = proh.filter((p) => DEP_PROHIBITION.test(p.clause))

  rows.push({
    unit: f, taskId, arm,
    amplification: (a.suspectAmplifications || a.hits || []).length,
    needsHumanRead: a.needsHumanRead === true,
    questions: qs.length,
    prefQuestions: qs.filter((x) => /pref/i.test(String(x.class || x.kind || ''))).length,
    implQuestions: qs.filter((x) => /impl/i.test(String(x.class || x.kind || ''))).length,
    prohibitions: proh.length,
    // ③ 只在题面有"引依赖"类禁令时才计（否则 null = 不适用，而不是 0 = 没违反）
    depViolations: depProh.length ? depProh.map((p) => auditConstraintHold({ constraintText: p.clause, answerText, label: f }).violationCount).reduce((s, n) => s + n, 0) : null,
  })
}

const arms = [...new Set(rows.map((r) => r.arm))].sort()
const sum = (arm, key) => rows.filter((r) => r.arm === arm).reduce((s, r) => s + (r[key] || 0), 0)
const count = (arm) => rows.filter((r) => r.arm === arm).length
const applicable = (arm) => rows.filter((r) => r.arm === arm && r.depViolations !== null)

const out = { unitsDir: UNITS, tasks: ANALYSED.map((t) => t.id), byArm: {}, perTask: {} }
console.log('units analysed =', rows.length, '| tasks =', ANALYSED.map((t) => t.id).join(','),
  '| 分期 =', [...new Set(ANALYSED.map((t) => stageOf(t.id)))].join(','))
// **不得静默跳过**：凡是没有被分析的单元文件，都要说清为什么。
const skipped = unitFiles.length - rows.length
if (skipped > 0) {
  console.log('⚠ 跳过 ' + skipped + ' 个单元文件：' + (unknownIds.length
    ? '题号不在留出集里 → ' + unknownIds.join(', ')
    : '文件名匹配但内容缺失'))
}
if (unknownIds.length > 0) {
  console.log('⚠ 有题号不在封存的留出集里：' + unknownIds.join(', ')
    + '——若这是别的题集，本脚本不认；请先确认你分析的是哪一份。')
}
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
for (const task of ANALYSED) {
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
for (const task of ANALYSED) {
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

// ── 稳定性（EV-0099）───────────────────────────────────────────────────
// 宗旨里明写"**次次稳定于自己的上限**"——稳定性是**声称的目标**，而 S1 里每个
// (题, 臂) 恰好有 3 次独立采样 ⇒ 可以**零成本**量一次。
// 指标：同一 (题, 臂) 三次答案之间的**词集 Jaccard 相似度**（两两平均）＋ 长度变异系数。
// ⚠ 边界：这是**表层**一致性，不是质量——"稳定地答错"同样得高分；
// 且 n=3 采样太少。所以它只能与 EV-0095 的正确性检查**一起**读。
const toks = (t) => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2))
const jac = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter += 1; const uni = a.size + b.size - inter; return uni === 0 ? 0 : inter / uni }
console.log('')
console.log('稳定性（同一题同一臂的 3 次采样之间；表层指标，非质量）：')
out.stability = {}
out.stabilityPerTask = {}
{
  const avg = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0)
  // ★ 关键细化（EV-0100）：把**题面自身的词**排除掉再算相似度。
  // 为什么必须排除：两臂的答案都会大量复述题面（"private"/"true"/"MODES"…），
  // 这些共有词**等量地抬高两臂**的相似度；而 C 的答案更短 ⇒ 题面词占比更高 ⇒
  // 可能**被抬高得更多**，从而掩盖真实差异。只看"模型自己的措辞"才是干净的量。
  const cells = []
  for (const a of arms) {
    const perTask = {}
    const simsRaw = []; const simsClean = []; const cvs = []
    for (const task of ANALYSED) {
      const rs = rows.filter((r) => r.taskId === task.id && r.arm === a)
      if (rs.length < 2) continue
      const texts = rs.map((r) => readFileSync(join(UNITS, r.unit), 'utf8'))
      const promptToks = toks(task.body)
      const setsRaw = texts.map((t) => toks(t))
      const setsClean = setsRaw.map((s) => new Set([...s].filter((w) => !promptToks.has(w))))
      const pairAvg = (sets) => {
        let s = 0; let n = 0
        for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { s += jac(sets[i], sets[j]); n += 1 }
        return n ? s / n : 0
      }
      const lens = texts.map((t) => t.length)
      const mean = avg(lens)
      const sd = Math.sqrt(avg(lens.map((x) => (x - mean) ** 2)))
      perTask[task.id] = { jaccardRaw: Number(pairAvg(setsRaw).toFixed(3)), jaccardTaskExcluded: Number(pairAvg(setsClean).toFixed(3)), lengthCV: Number((mean ? sd / mean : 0).toFixed(3)) }
      simsRaw.push(pairAvg(setsRaw)); simsClean.push(pairAvg(setsClean)); cvs.push(mean ? sd / mean : 0)
    }
    out.stabilityPerTask[a] = perTask
    out.stability[a] = {
      tasks: simsRaw.length,
      meanJaccard: Number(avg(simsRaw).toFixed(3)),
      meanJaccardTaskExcluded: Number(avg(simsClean).toFixed(3)),
      meanLengthCV: Number(avg(cvs).toFixed(3)),
    }
    // 排除**无效题**后的口径（以这个为准，见 INVALID_ITEMS 的说明）
    const keep = (id) => !INVALID_ITEMS.includes(id)
    const raw2 = []; const cl2 = []; const cv2 = []
    for (const task of ANALYSED) {
      if (!keep(task.id)) continue
      const p = perTask[task.id]
      if (!p) continue
      raw2.push(p.jaccardRaw); cl2.push(p.jaccardTaskExcluded); cv2.push(p.lengthCV)
    }
    out.stability[a].validOnly = {
      tasks: raw2.length,
      meanJaccard: Number(avg(raw2).toFixed(3)),
      meanJaccardTaskExcluded: Number(avg(cl2).toFixed(3)),
      meanLengthCV: Number(avg(cv2).toFixed(3)),
    }
    cells.push(`${a}: 原始 ${avg(simsRaw).toFixed(3)} / 去题面词 ${avg(simsClean).toFixed(3)} / 长度CV ${avg(cvs).toFixed(3)}`
      + ` ｜ **仅有效题** ${avg(raw2).toFixed(3)} / ${avg(cl2).toFixed(3)} / ${avg(cv2).toFixed(3)}`)
  }
  console.log('  ' + cells.join('   '))
  console.log('  注：相似度越**高**越稳定；但它不区分"稳定地对"与"稳定地错"（须与上面的机械检查合看）。')
  console.log('  注：「去题面词」= 排除题面自身出现的词后再算——只看模型自己的措辞，更干净。')
  console.log('')
  console.log('  按题（各臂的 原始相似度 / 去题面词相似度 / 长度CV）：')
  for (const task of ANALYSED) {
    const cells2 = arms.map((a) => {
      const p = out.stabilityPerTask[a][task.id]
      return p ? `${a}:${p.jaccardRaw}/${p.jaccardTaskExcluded}/${p.lengthCV}` : `${a}:—`
    })
    console.log('    ' + task.id + '  ' + cells2.join('   '))
  }
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(out, null, 2), 'utf8'); console.log('\nwrote ' + JSON_OUT) }

// ── 可选：生成**打分表**供人判读（EV-0096 / EV-0105）─────────────────────
// 设计目标是**把人的工作量压到最小**：
//   ① 只需要一个判断——「这条**不该问**」；其余默认"没问题"，**不用管**；
//   ② 每条一个复选框 + 稳定编号（A01/C07），勾一下就行，不必数、不必写分类；
//   ③ 拿不准的写 `?`（可选），不当成必须分类的负担；
//   ④ 每臂给出**总数**，所以哪怕只勾了几条，两臂的比较也能算出来。
// ⚠ **故意不打分类标签**：我自己那个分类器正是出错的东西，把它当"提示"会污染判断（锚定）。
const Q_OUT = (() => { const i = process.argv.indexOf('--questions'); return i > 0 ? process.argv[i + 1] : null })()
if (Q_OUT) {
  const L = []
  const perArm = {}
  const lines = { A: [], C: [] }
  for (const task of ANALYSED) {
    for (const a of arms) {
      const rs = rows.filter((r) => r.taskId === task.id && r.arm === a).sort((x, y) => x.unit.localeCompare(y.unit))
      for (const r of rs) {
        const txt = readFileSync(join(UNITS, r.unit), 'utf8')
        for (const q of questionSentences(txt)) {
          perArm[a] = (perArm[a] || 0) + 1
          const id = a + String(perArm[a]).padStart(2, '0')
          lines[a].push(`- [ ] **${id}** · ${task.id} · ${q.replace(/\s+/g, ' ').trim()}`)
          lines[a].push('')
        }
      }
    }
  }

  L.push('# E-001 / S1 · 问句打分表')
  L.push('')
  L.push('## 怎么打分（只需一个动作）')
  L.push('')
  L.push('**只勾「不该问」的。其余一律不用管。**')
  L.push('')
  L.push('- **不该问** = 属于**可查事实**（有工具就该自己去查）或**可逆实现细节**（用哪个库、怎么封装）——')
  L.push('  这些应当自己决定，丢回用户就是增加负担。→ 把 `[ ]` 改成 `[x]`')
  L.push('- 拿不准的：把 `[ ]` 改成 `[?]`（可选，不勾也行）')
  L.push('- **其余什么都不用做**（不勾 = "没问题"）')
  L.push('')
  L.push('> 注意区分「**请你决定 X**」与「**提醒你 X 会有后果**」——后者即使写成问句，')
  L.push('> 按宗旨（不造成虚假的、有信息差就回问）通常是**想要的行为**，不该勾。')
  L.push('')
  L.push('## 回给我什么')
  L.push('')
  L.push('最省事：**两个数字**（A 勾了几条 / C 勾了几条）。')
  L.push('也可以：把这份勾好的文件整个发我，我来数。')
  L.push('')
  L.push('## 两个臂的总数（分母，供对照）')
  L.push('')
  L.push('| 臂 | 问句总数 | 你勾了「不该问」几条 |')
  L.push('|---|---|---|')
  L.push(`| **A**（无插件） | **${perArm.A || 0}** |  |`)
  L.push(`| **C**（0.6） | **${perArm.C || 0}** |  |`)
  L.push('')
  L.push('> 两臂总数不同（A 少、C 多），所以**也请留意比例**：')
  L.push('> 例如 A 勾 3 / 共 ' + (perArm.A || 0) + ' 与 C 勾 5 / 共 ' + (perArm.C || 0) + '，含义并不相同。')
  L.push('')
  L.push('---')
  L.push('')
  for (const a of arms) {
    L.push(`## ${a} 臂（共 ${perArm[a] || 0} 条）`)
    L.push('')
    for (const task of ANALYSED) {
      const rs = rows.filter((r) => r.taskId === task.id && r.arm === a).sort((x, y) => x.unit.localeCompare(y.unit))
      const items = []
      for (const r of rs) {
        const txt = readFileSync(join(UNITS, r.unit), 'utf8')
        for (const q of questionSentences(txt)) items.push(q.replace(/\s+/g, ' ').trim())
      }
      // 每题给一行**用户原话**：否则判不了"这条是不是可查事实"——判据需要题目上下文。
      L.push(`**${task.id}** · 用户原话：${String(task.body).trim().replace(/\s+/g, ' ')}`)
      L.push('')
      for (const q of items) {
        const idx = lines[a].findIndex((x) => x.includes('· ' + q) && x.startsWith('- [ ]'))
        L.push(lines[a][idx])
        L.push('')
      }
      if (items.length === 0) { L.push('*（该题没有问句）*'); L.push('') }
    }
  }
  writeFileSync(Q_OUT, L.join('\n'), 'utf8')
  console.log('wrote ' + Q_OUT + ' (A=' + (perArm.A || 0) + ' C=' + (perArm.C || 0) + ')')
}
