// 答案侧汇总：把 LLM 严格评分（0~3 档/要点）按档位汇总，并给出配对与噪声；同时报告执行错误/空产出。
// 用法：node evidence/cx-answer-grade.cjs [cx-answer.json]
const fs = require('fs')
const path = require('path')
const ev = __dirname
const resPath = process.argv[2] || 'cx-answer.json'
const spec = JSON.parse(fs.readFileSync(path.join(ev, 'lab-cx.json'), 'utf8'))
const res = JSON.parse(fs.readFileSync(path.join(ev, resPath), 'utf8'))
const A = 'V3-extreme'   // 候选
const B = 'SHIP-extreme' // 对照
const mean = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0

const perCell = {}
let bad = 0, empty = 0, judgeFail = 0
for (const c of res.cells || []) {
  const cmdLen = String(c.command || '').length
  if (c.skipped || c.relayError || c.solveError) bad += 1
  if (cmdLen === 0) empty += 1
  if (!c.judge) { judgeFail += 1; continue }
  const k = c.variantId + '|' + c.taskId
  perCell[k] = perCell[k] || []
  perCell[k].push({ total: c.judge.total, max: c.judge.max || 18, answerLen: String(c.answer || '').length })
}
const variants = [...new Set((res.cells || []).map((c) => c.variantId))]
console.log('=== 答案侧（LLM 严格评分，0~3 档/要点；每题满分 18）===')
console.log('  执行异常 ' + bad + ' 格 · 空命令 ' + empty + ' 格 · 无法解析评分 ' + judgeFail + ' 格 · 总格数 ' + (res.cells || []).length)
const rows = []
for (const v of variants) {
  const all = []
  for (const t of spec.tasks) all.push(...(perCell[v + '|' + t.id] || []))
  const sum = all.reduce((a, b) => a + b.total, 0)
  const max = all.reduce((a, b) => a + b.max, 0)
  rows.push({ v, sum, max, pct: max ? Math.round((sum / max) * 1000) / 10 : 0, n: all.length })
}
rows.sort((a, b) => b.pct - a.pct)
for (const r of rows) console.log('  ' + r.v.padEnd(16) + r.sum + '/' + r.max + '  ' + r.pct + '%  (' + r.n + ' 格)')
console.log('')
console.log('=== 逐题（答案侧平均分 / 18）===')
for (const t of spec.tasks) {
  const a = (perCell[A + '|' + t.id] || []).map((x) => x.total)
  const b = (perCell[B + '|' + t.id] || []).map((x) => x.total)
  if (!a.length && !b.length) continue
  const d = mean(a) - mean(b)
  console.log('  ' + t.id.padEnd(24) + A + '=' + mean(a) + '   ' + B + '=' + mean(b) + '   Δ=' + (d > 0 ? '+' : '') + Math.round(d * 100) / 100)
}
fs.writeFileSync(path.join(ev, 'cx-answer-grade.json'), JSON.stringify({ at: new Date().toISOString(), rows, detail: perCell }, null, 1), 'utf8')
console.log('WROTE evidence/cx-answer-grade.json')
