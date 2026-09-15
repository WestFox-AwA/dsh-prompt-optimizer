// 复杂任务测量台报告：逐题、逐要点、逐档位汇总（含命令长度与配对差值），用于定位"还差哪几条"。
// 用法：node evidence/cx-report.cjs [results.json] [gradeRows.json]
const fs = require('fs')
const path = require('path')
const ev = __dirname
const resPath = process.argv[2] || 'cx-results.json'
const spec = JSON.parse(fs.readFileSync(path.join(ev, 'lab-cx.json'), 'utf8'))
const res = JSON.parse(fs.readFileSync(path.join(ev, resPath), 'utf8'))
const graded = JSON.parse(fs.readFileSync(path.join(ev, 'cx-grade.json'), 'utf8'))
const byKey = {}
for (const r of graded.rows) byKey[r.variant + '|' + r.task] = r

const variants = [...new Set(res.cells.map((c) => c.variantId))]
const tasks = spec.tasks.map((t) => t.id)
const pad = (s, n) => String(s).padEnd(n)

console.log('=== 每题得分（满分 18） ===')
console.log(pad('题目', 24) + variants.map((v) => pad(v, 18)).join(''))
for (const t of tasks) {
  const row = variants.map((v) => {
    const g = byKey[v + '|' + t]
    return pad(g ? g.total + '/18' : '-', 18)
  })
  console.log(pad(t, 24) + row.join(''))
}
console.log('')
console.log('=== 每档位汇总 ===')
for (const v of variants) {
  const cells = res.cells.filter((c) => c.variantId === v && !c.skipped)
  const lens = cells.map((c) => (c.command || '').length)
  const avgLen = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0
  const total = graded.rows.filter((r) => r.variant === v).reduce((a, b) => a + b.total, 0)
  const max = graded.rows.filter((r) => r.variant === v).reduce((a, b) => a + b.max, 0)
  const avgMs = cells.length ? Math.round(cells.reduce((a, b) => a + (b.ms || 0), 0) / cells.length) : 0
  console.log('  ' + pad(v, 16) + total + '/' + max + '  ' + (max ? Math.round((total / max) * 1000) / 10 : 0) + '%   平均命令 ' + avgLen + ' 字符   平均 ' + avgMs + 'ms/格')
}
console.log('')
console.log('=== 逐要点命中率（V3 未拿满的用 ! 标出） ===')
const v3 = 'V3-extreme'
const ship = 'SHIP-extreme'
for (const t of spec.tasks) {
  const a = byKey[v3 + '|' + t.id]
  const b = byKey[ship + '|' + t.id]
  if (!a) continue
  const line = t.criteria.map((c, i) => (a.points[i] === 3 ? '.' : String(a.points[i]))).join('')
  const shipLine = b ? t.criteria.map((c, i) => b.points[i]).join('') : '------'
  console.log('  ' + pad(t.id, 24) + 'V3=' + line + '  SHIP=' + shipLine + '  (3=满分档)')
}
console.log('')
console.log('=== V3 缺口清单（得分 ≤2 的要点） ===')
for (const t of spec.tasks) {
  const a = byKey[v3 + '|' + t.id]
  if (!a) continue
  t.criteria.forEach((c, i) => {
    if (a.points[i] <= 2) console.log('  ' + pad(t.id, 24) + '[' + a.points[i] + '] ' + c.zh)
  })
}
