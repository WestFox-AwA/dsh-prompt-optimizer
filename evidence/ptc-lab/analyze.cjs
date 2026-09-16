// 结果分析：node evidence/ptc-lab/analyze.cjs [runs/lab-xxx.json]
// 给出两种口径，避免"把截断格剔除去算通过率"这种自欺：
//   ① 宽口径（原样）：只统计未被截断的格子（现有 summary.passRate）
//   ② 严口径（推荐）：把"因输出超上限被截断"的格子记为该策略的**失败**
//      —— 在固定输出预算下，把下游程序撑爆就是策略的代价（真实 PTC 同样按轮次付费）
const fs = require('fs')
const path = require('path')
const f = process.argv[2] || path.join(__dirname, 'latest.json')
const r = JSON.parse(fs.readFileSync(f, 'utf8'))

const rows = {}
for (const c of r.cells) {
  const k = c.strategy
  const s = rows[k] || (rows[k] = { cells: 0, pass: 0, failCapability: 0, failEnv: 0, truncCells: 0, truncRounds: 0, rounds: 0, refineChars: 0, refineMs: 0, failByCheck: {} })
  s.cells++
  if (c.score && c.score.env) { s.failEnv++; continue }
  if (c.rigLimited) { s.truncCells++; s.truncRounds += c.rounds.filter((x) => x.truncated).length }
  else if (c.score && c.score.pass) s.pass++
  else s.failCapability++
  s.rounds += c.rounds.length
  if (c.refine) { s.refineChars += c.refine.chars; s.refineMs += c.refine.ms }
  // 失败检查项只统计"未被截断"的格子——被截断的格子其检查项是"程序没跑完"的余波，不是能力证据
  if (!c.rigLimited) for (const name of ((c.score && c.score.failed) || [])) s.failByCheck[name] = (s.failByCheck[name] || 0) + 1
}

const pct = (a, b) => (b ? (Math.round(1000 * a / b) / 10).toFixed(1) + '%' : '—')
console.log('run ' + r.tag + '  ' + (r.elapsedMs / 1000).toFixed(0) + 's  ' + r.selection.provider + '/' + r.selection.model + '  R=' + r.config.rounds + ' rep=' + r.config.rep)
console.log('')
console.log('策略         格数  通过  能力失败  截断失败  |  宽口径   严口径(截断算失败)  截断轮/总轮  精炼字数(均)')
for (const k of Object.keys(rows)) {
  const s = rows[k]
  const scoredWide = s.cells - s.failEnv - s.truncCells
  const strictDen = s.cells - s.failEnv
  console.log(
    k.padEnd(13) + String(s.cells).padStart(4) + String(s.pass).padStart(6) + String(s.failCapability).padStart(9) +
    String(s.truncCells).padStart(10) + '  |  ' + pct(s.pass, scoredWide).padStart(6) + '   ' + pct(s.pass, strictDen).padStart(8) +
    '              ' + (s.truncRounds + '/' + s.rounds).padStart(7) + '     ' + (s.cells ? Math.round(s.refineChars / s.cells) : 0)
  )
}
console.log('')
console.log('失败检查项分布（能力失败，按出现次数）：')
for (const k of Object.keys(rows)) {
  const names = Object.keys(rows[k].failByCheck)
  console.log('  ' + k + ': ' + (names.length ? names.map((n) => n + '×' + rows[k].failByCheck[n]).join('; ') : '（无）'))
}
console.log('')
console.log('判读提示：格数少时 1 格 = ' + (rows[Object.keys(rows)[0]] ? (100 / (rows[Object.keys(rows)[0]].cells - rows[Object.keys(rows)[0]].failEnv)).toFixed(1) : '?') + ' 个百分点；差 1 格内不得声称差异。')
