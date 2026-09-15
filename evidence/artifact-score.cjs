// 产物级 0~3 分档指标（第二主指标）：对每份产物给出细粒度得分，便于看到"部分做到"的进展。
//   3 = 统一自检入口齐备 + 独立法线审计通过 + 其余判据全过（即 VERDICT PASS）
//   2 = 统一自检入口齐备 + 独立法线审计通过，但仍有其它判据未过
//   1 = 有统一自检入口，但独立审计无法完成（几何取不到）或法线审计未过
//   0 = 连统一自检入口都没有（第三方无法复跑）
// 用法：node evidence/artifact-score.cjs [--json]
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const ev = __dirname
const dir = path.join(ev, 'artifacts')
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort() : []
const rows = []
for (const f of files) {
  const m = /^(.*?)__(.*?)__r(\d+)\.html$/.exec(f) || []
  const variant = m[1] || '(unknown)'
  const task = m[2] || f
  const taskArg = /H2/.test(task) ? 'H2' : 'H1'
  const r = spawnSync(process.execPath, [path.join(ev, 'html-verify.cjs'), path.join(dir, f), '--json', '--task=' + taskArg], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  let j = null
  try { j = JSON.parse(r.stdout || '{}') } catch (e) { j = null }
  const checks = (j && j.checks) || []
  const unified = checks.some((c) => /统一自检入口/.test(c.name) && c.ok)
  const audit = j && j.independentAudit
  const auditOk = Boolean(audit && audit.inwardFaces === 0 && audit.facesOutwardRatio >= 0.98)
  const pass = Boolean(j && j.pass)
  const score = pass ? 3 : (unified && auditOk ? 2 : (unified ? 1 : 0))
  rows.push({ file: f, variant, task, unified, auditOk, pass, score, inwardFaces: audit ? audit.inwardFaces : null, failed: (j && j.failed) || ['无法解析'] })
}
const groups = {}
for (const r of rows) {
  const k = r.variant + ' | ' + r.task
  groups[k] = groups[k] || { variant: r.variant, task: r.task, n: 0, sum: 0, dist: { 0: 0, 1: 0, 2: 0, 3: 0 } }
  groups[k].n += 1; groups[k].sum += r.score; groups[k].dist[r.score] += 1
}
const summary = Object.values(groups).map((g) => ({ ...g, max: g.n * 3, pct: g.n ? Math.round((g.sum / (g.n * 3)) * 1000) / 10 : 0 }))
const byVariant = {}
for (const g of summary) {
  byVariant[g.variant] = byVariant[g.variant] || { variant: g.variant, n: 0, sum: 0, max: 0, dist: { 0: 0, 1: 0, 2: 0, 3: 0 } }
  const b = byVariant[g.variant]
  b.n += g.n; b.sum += g.sum; b.max += g.max
  for (const k of [0, 1, 2, 3]) b.dist[k] += g.dist[k]
}
const variantSummary = Object.values(byVariant).map((b) => ({ ...b, pct: b.max ? Math.round((b.sum / b.max) * 1000) / 10 : 0 })).sort((a, b) => b.pct - a.pct)
const out = { at: new Date().toISOString(), rubric: '0 无入口 / 1 有入口但审计未过 / 2 入口+法线审计过 / 3 全部判据过', files: files.length, variantSummary, summary, rows }
fs.writeFileSync(path.join(ev, 'artifact-score.json'), JSON.stringify(out, null, 1), 'utf8')
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }
console.log('=== 产物级 0~3 分档（第二主指标）===')
console.log('  规则：' + out.rubric)
for (const v of variantSummary) console.log('  ' + v.variant.padEnd(16) + v.sum + '/' + v.max + '  ' + v.pct + '%   分布 0/1/2/3 = ' + v.dist[0] + '/' + v.dist[1] + '/' + v.dist[2] + '/' + v.dist[3] + '   份数 ' + v.n)
console.log('')
console.log('=== 分题 ===')
for (const g of summary) console.log('  ' + (g.variant + ' | ' + g.task).padEnd(40) + g.sum + '/' + g.max + '  分布 ' + g.dist[0] + '/' + g.dist[1] + '/' + g.dist[2] + '/' + g.dist[3])
console.log('')
console.log('WROTE evidence/artifact-score.json')
