// 结果摘要：node evidence/ptc-lab/digest.cjs [runs/lab-xxx.json]
const fs = require('fs')
const path = require('path')
const f = process.argv[2] || path.join(__dirname, 'latest.json')
const r = JSON.parse(fs.readFileSync(f, 'utf8'))
console.log('run ' + r.tag + '  ' + (r.elapsedMs / 1000).toFixed(1) + 's  ' + r.selection.provider + '/' + r.selection.model)
for (const c of r.cells) {
  console.log('')
  console.log('── ' + c.strategy + ' × ' + c.task + ' r' + c.rep + '  score=' + (c.score ? (c.score.env ? 'SKIP(env)' : (c.score.pass ? 'PASS' : 'FAIL')) : 'null') + (c.err ? '  err=' + c.err : ''))
  if (c.score && c.score.failed && c.score.failed.length) console.log('   failed: ' + JSON.stringify(c.score.failed))
  if (c.refine) console.log('   refine: ' + c.refine.chars + ' 字符 / ' + c.refine.ms + 'ms  → ' + JSON.stringify(String(c.refine.command || '').replace(/\s+/g, ' ').slice(0, 160)))
  for (const rd of c.rounds) {
    console.log('   R' + rd.n + ' ' + (rd.lang || '?').padEnd(6) + ' exit=' + (rd.run ? rd.run.exit : '-') + (rd.done ? ' DONE' : '') + (rd.run ? '  out=' + JSON.stringify(String(rd.run.stdout).replace(/\s+/g, ' ').slice(0, 110)) + ' err=' + JSON.stringify(String(rd.run.stderr).replace(/\s+/g, ' ').slice(0, 90)) : '  ' + (rd.error || '')))
  }
  try { console.log('   dir: ' + c.dir.replace(/\\/g, '/').split('/evidence/')[1] + '  files=' + JSON.stringify(fs.readdirSync(c.dir))) } catch (e) { /* gone */ }
}
