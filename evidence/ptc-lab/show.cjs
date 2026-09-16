// 看某格某轮的程序与完整输出：node evidence/ptc-lab/show.cjs <strategy> <task> <round>
const fs = require('fs')
const path = require('path')
const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'latest.json'), 'utf8'))
const [st, tk, n] = process.argv.slice(2)
for (const c of r.cells) {
  if (c.strategy !== st || c.task !== tk) continue
  for (const rd of c.rounds) {
    if (n && String(rd.n) !== String(n)) continue
    console.log('=== ' + c.strategy + ' × ' + c.task + ' R' + rd.n + ' lang=' + rd.lang + ' exit=' + (rd.run ? rd.run.exit : '-'))
    console.log('--- CODE ---')
    console.log(String(rd.code).slice(0, 1200))
    if (rd.run) { console.log('--- STDOUT ---'); console.log(String(rd.run.stdout).slice(0, 600)); console.log('--- STDERR ---'); console.log(String(rd.run.stderr).slice(0, 900)) }
  }
}
