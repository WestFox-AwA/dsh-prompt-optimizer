// P7 / E-001 · 把 S1 的**真实产物**导出成一份人能读的对照文档。
//
// 为什么需要：三件自动判据只能给计数（放大 0/0、问句 A27/C41、实现细节类 A5/C12），
// 而"问得多是不是更差""哪个答案更符合我本意"**只能由人判**。宗旨要的是"更理想化"，
// 那是审美与意图的判断，不是标记法能替代的。
// 本脚本不调模型、不花钱，只做整理与留档。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseHoldout, tasksForStage, HOLDOUT_SEAL } from '../lib/eval-plan.js'
import { auditAnswer, auditQuestions, userProhibitions } from '../lib/answer-audit.js'

const REPO = join(import.meta.dirname, '..')
const UNITS = process.argv[2] || 'C:/Users/WestFox/.dsh-po06-iso/po06-e001-run2/units'
const OUT = process.argv[3] || join(REPO, 'eval', 'E001-S1-ANSWERS.md')

const tasks = parseHoldout(readFileSync(join(REPO, 'eval', HOLDOUT_SEAL.file), 'utf8'))
const s1 = tasksForStage(tasks, 'S1')
const byId = new Map(s1.map((t) => [t.id, t]))

const files = existsSync(UNITS) ? readdirSync(UNITS) : []
const read = (taskId, arm, run) => {
  const f = `${taskId}-${arm}-r${run}.md`
  return files.includes(f) ? readFileSync(join(UNITS, f), 'utf8') : null
}

const L = []
L.push('# E-001 / S1 · 两臂真实答案对照（供人判读）')
L.push('')
L.push('> **这份文档是给人看的**：自动判据只能给计数，而"哪个更符合本意"必须由人判。')
L.push('> 生成方式：`node po06/scripts/make-answer-doc.mjs`（不调模型、不花钱）。')
L.push('')
L.push('## 读之前必须知道的事（否则容易读过头）')
L.push('')
L.push('- **A 臂 = 原话直发**（无插件）；**C 臂 = 原话 + 0.6 编译的意图包**。两臂系统提示词相同（23 字符）。')
L.push('- 每题的 A / C **各跑 3 次**（n=3）。同一臂的三次是同一输入的独立采样，**不是三种方案**。')
L.push('- 单一模型、单次运行；温度 0.3。**这是有界的对照，不是终审**。')
L.push('- 自动判据里的"实现细节类问句"是**标记法**分类，可能把反问/设问误计——所以请你直接读。')
L.push('- 想回答的问题：**C 比 A 更容易一次做对吗？更少越界/更少漏项吗？还是只是话更多、问更多？**')
L.push('')

let totalA = 0, totalC = 0
for (const t of s1) {
  const body = byId.get(t.id).body
  L.push('---')
  L.push('')
  L.push(`## ${t.id}${t.title ? ' · ' + t.title : ''}`)
  L.push('')
  L.push('**用户原话：**')
  L.push('')
  L.push('```text')
  L.push(body.trim())
  L.push('```')
  const proh = userProhibitions(body)
  if (proh.length) {
    L.push('')
    L.push(`**用户明确禁止（${proh.length} 条，判"有没有越界"时看这些）：**`)
    // ⚠ 取 `.clause`：不取就会把 "[object Object]" 印进**给人读的**文档（EV-0113 实测发生过）。
    for (const p of proh) L.push(`- ${p.clause}`)
  }
  L.push('')
  for (const arm of ['A', 'C']) {
    const name = arm === 'A' ? 'A 臂 · 原话直发' : 'C 臂 · 原话 + 意图包'
    L.push(`### ${name}`)
    L.push('')
    for (let r = 1; r <= 3; r++) {
      const txt = read(t.id, arm, r)
      if (txt === null) { L.push(`*（缺 r${r}）*`); L.push(''); continue }
      if (arm === 'A') totalA += txt.length; else totalC += txt.length
      const a = auditAnswer({ userText: body, answerText: txt, label: `${t.id}-${arm}-r${r}` })
      const q = auditQuestions({ answerText: txt, label: `${t.id}-${arm}-r${r}` })
      const qs = q.questions || q.items || []
      const amp = (a.suspectAmplifications || a.hits || []).length
      const implQ = qs.filter((x) => /impl/i.test(String(x.class || x.kind || ''))).length
      const prefQ = qs.filter((x) => /pref/i.test(String(x.class || x.kind || ''))).length
      L.push(`<details><summary><b>第 ${r} 次</b> · ${txt.length} 字符 · 可疑放大 ${amp} · 问句 ${qs.length}（偏好 ${prefQ} / 实现细节 ${implQ}）</summary>`)
      L.push('')
      L.push('```text')
      L.push(txt.trim())
      L.push('```')
      L.push('')
      L.push('</details>')
      L.push('')
    }
  }
}

L.splice(1, 0, '', `> 规模：${s1.length} 题 × 2 臂 × 3 次 = ${s1.length * 6} 份答案；正文合计 A ${totalA} 字符 / C ${totalC} 字符。`)

writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT)
console.log('tasks=' + s1.length + ' units=' + files.length + ' answerChars A=' + totalA + ' C=' + totalC)
