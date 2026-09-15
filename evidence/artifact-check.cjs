// 产物级一键检查：扫描 evidence/artifacts/*.html，逐个跑 html-verify.cjs（按题型给 --task），
// 汇总成"条件 × 题"的通过率表 + 独立审计数字，写 evidence/artifact-check.json（可复核证据）。
// 用法：node evidence/artifact-check.cjs [--json]
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const ev = __dirname
const dir = path.join(ev, 'artifacts')
if (!fs.existsSync(dir)) { console.error('no artifacts dir'); process.exit(2) }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort()
const rows = []
for (const f of files) {
  const full = path.join(dir, f)
  // 文件名形如 <variant>__<task>__r<rep>.html
  const m = /^(.*?)__(.*?)__r(\d+)\.html$/.exec(f)
  const variant = m ? m[1] : '(unknown)'
  const task = m ? m[2] : f
  const rep = m ? Number(m[3]) : null
  const taskArg = /H2/.test(task) ? 'H2' : 'H1'
  const r = spawnSync(process.execPath, [path.join(ev, 'html-verify.cjs'), full, '--json', '--task=' + taskArg], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  let j = null
  try { j = JSON.parse(r.stdout || '{}') } catch (e) { j = null }
  const bytes = fs.statSync(full).size
  rows.push({
    file: f, variant, task, rep, bytes, taskProfile: taskArg,
    pass: j ? j.pass : false,
    failed: j ? j.failed : ['验证器无法解析产物'],
    audit: j ? j.independentAudit : null,
    auditError: j ? j.auditError : null,
    initError: j ? j.initError : null,
  })
}
// 汇总：按 条件 × 题 统计通过率
const groups = {}
for (const r of rows) {
  const k = r.variant + ' | ' + r.task
  groups[k] = groups[k] || { variant: r.variant, task: r.task, n: 0, pass: 0, inward: [] }
  groups[k].n += 1
  if (r.pass) groups[k].pass += 1
  if (r.audit) groups[k].inward.push(r.audit.inwardFaces)
}
const summary = Object.values(groups).map((g) => ({
  variant: g.variant, task: g.task, n: g.n, pass: g.pass,
  passRate: g.n ? Math.round((g.pass / g.n) * 1000) / 10 : 0,
  audited: g.inward.length, inwardFaces: g.inward.length ? g.inward : null,
}))
const byVariant = {}
for (const s of summary) {
  byVariant[s.variant] = byVariant[s.variant] || { n: 0, pass: 0 }
  byVariant[s.variant].n += s.n
  byVariant[s.variant].pass += s.pass
}
const variantSummary = Object.keys(byVariant).map((v) => ({ variant: v, n: byVariant[v].n, pass: byVariant[v].pass, passRate: byVariant[v].n ? Math.round((byVariant[v].pass / byVariant[v].n) * 1000) / 10 : 0 })).sort((a, b) => b.passRate - a.passRate)

const out = { at: new Date().toISOString(), files: files.length, variantSummary, summary, rows }
fs.writeFileSync(path.join(ev, 'artifact-check.json'), JSON.stringify(out, null, 1), 'utf8')

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }
console.log('=== 产物级通过率（按条件）===')
for (const v of variantSummary) console.log('  ' + v.variant.padEnd(16) + v.pass + '/' + v.n + '  ' + v.passRate + '%')
console.log('')
console.log('=== 分题明细 ===')
for (const s of summary) console.log('  ' + (s.variant + ' | ' + s.task).padEnd(40) + s.pass + '/' + s.n + '  独立审计 inward=' + JSON.stringify(s.inwardFaces))
console.log('')
console.log('=== 失败原因 ===')
for (const r of rows.filter((x) => !x.pass)) console.log('  ' + r.file.slice(0, 48).padEnd(50) + (r.failed.join('；') || r.auditError || '') .slice(0, 90))
console.log('')
console.log('WROTE evidence/artifact-check.json')
