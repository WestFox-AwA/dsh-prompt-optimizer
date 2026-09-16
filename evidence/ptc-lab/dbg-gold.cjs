// 单题 gold 调试：node evidence/ptc-lab/dbg-gold.cjs mesh-volume
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process')
const { TASKS } = require(path.join(__dirname, 'tasks.cjs'))
const id = process.argv[2]
const t = TASKS.filter((x) => x.id === id)[0]
if (!t) { console.log('no task ' + id); process.exit(1) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbggold-'))
t.gold(dir, { name: 'demo', retries: 3 })
console.log('files=' + JSON.stringify(fs.readdirSync(dir)))
for (const f of fs.readdirSync(dir)) {
  if (!/\.(js|cjs|mjs)$/.test(f)) continue
  const r = cp.spawnSync(process.execPath, [f], { cwd: dir, encoding: 'utf8', timeout: 20000 })
  console.log('-- ' + f + ' exit=' + r.status)
  console.log('stdout=' + JSON.stringify(String(r.stdout).slice(0, 300)))
  console.log('stderr=' + JSON.stringify(String(r.stderr).slice(0, 300)))
}
const v = t.check(dir, { name: 'demo', retries: 3 })
console.log('verdict pass=' + v.pass + ' failed=' + JSON.stringify(v.checks.filter((c) => !c.pass).map((c) => c.name + ' :: ' + c.evidence)))
