// 配对统计与方差：把同一批（题 × 档位）的重复采样做平均，算出 V3 相对发布版的配对胜负数与波动范围。
// 用法：node evidence/cx-stats.cjs [results.json] [gradeRows.json] [A] [B]
const fs = require('fs')
const path = require('path')
const ev = __dirname
const resPath = process.argv[2] || 'cx-results.json'
const spec = JSON.parse(fs.readFileSync(path.join(ev, 'lab-cx.json'), 'utf8'))
const res = JSON.parse(fs.readFileSync(path.join(ev, resPath), 'utf8'))
const graded = JSON.parse(fs.readFileSync(path.join(ev, 'cx-grade.json'), 'utf8'))
const A = process.argv[4] || 'V3-extreme'   // 候选
const B = process.argv[5] || 'SHIP-extreme' // 对照

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const cellVals = {}
for (const r of graded.rows) {
  const k = r.variant + '|' + r.task
  cellVals[k] = cellVals[k] || []
  cellVals[k].push(r.total)
}
const tasks = spec.tasks.map((t) => t.id)
let wins = 0, losses = 0, ties = 0
const paired = []
for (const t of tasks) {
  const a = mean(cellVals[A + '|' + t] || [])
  const b = mean(cellVals[B + '|' + t] || [])
  if (a > b) wins += 1; else if (a < b) losses += 1; else ties += 1
  paired.push({ task: t, A: Math.round(a * 100) / 100, B: Math.round(b * 100) / 100, d: Math.round((a - b) * 100) / 100 })
}
console.log('=== 配对（每题在重复采样上的平均分，满分 18）===')
for (const p of paired) console.log('  ' + p.task.padEnd(24) + A + '=' + p.A + '   ' + B + '=' + p.B + '   Δ=' + (p.d > 0 ? '+' : '') + p.d)
console.log('  配对结果：' + A + ' 胜 ' + wins + ' / 负 ' + losses + ' / 平 ' + ties + '（共 ' + tasks.length + ' 题）')

// 方差：同一格多次采样的极差
let maxSpread = 0, spreads = []
for (const k of Object.keys(cellVals)) {
  const v = cellVals[k]
  if (v.length < 2) continue
  const s = Math.max(...v) - Math.min(...v)
  spreads.push(s); if (s > maxSpread) maxSpread = s
}
console.log('')
console.log('=== 噪声（同格重复采样极差，单位：分/18）===')
console.log('  样本格数 ' + spreads.length + '  平均极差 ' + (spreads.length ? Math.round(mean(spreads) * 100) / 100 : 0) + '  最大极差 ' + maxSpread)

// 命令长度（是否变啰嗦）
const lens = {}
for (const c of res.cells || []) {
  if (c.skipped) continue
  lens[c.variantId] = lens[c.variantId] || []
  lens[c.variantId].push(String(c.command || '').length)
}
console.log('')
console.log('=== 命令长度 ===')
for (const v of Object.keys(lens)) console.log('  ' + v.padEnd(16) + '平均 ' + Math.round(mean(lens[v])) + ' 字符   最长 ' + Math.max(...lens[v]) + '   最短 ' + Math.min(...lens[v]))
