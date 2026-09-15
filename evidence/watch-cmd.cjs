// 观测工具：写入一条演示命令，然后连续查询 /cmd 观察 (a) 客户端是否在轮询（cmdHits 增量）(b) 命令是否被消费。
// 用法：node evidence/watch-cmd.cjs <run> [seconds]
const fs = require('fs')
const path = require('path')
const base = path.join(__dirname, '..', '..')
const run = process.argv[2] || 'help-demo'
const seconds = Number(process.argv[3] || 45)
let live = null
for (const d of fs.readdirSync(base).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  const f = path.join(base, d, 'package', 'evidence', 'client-beacon.jsonl')
  if (!fs.existsSync(f)) continue
  const st = fs.statSync(f)
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, ev: path.join(base, d, 'package', 'evidence'), file: f }
}
if (!live) { console.error('no live instance'); process.exit(1) }
const token = 'diag-' + Date.now()
const cmdFile = path.join(live.ev, 'cmd.json')
fs.writeFileSync(cmdFile, JSON.stringify({ run, token }, null, 2), 'utf8')
console.log('live=' + live.name + '  wrote run=' + run + ' token=' + token)
const url = 'http://127.0.0.1:3080/prompt-optimizer/api/cmd'
const size0 = fs.statSync(live.file).size
let first = null
const t0 = Date.now()
const step = () => {
  fetch(url, { cache: 'no-store' }).then((r) => r.json()).then((d) => {
    const el = ((Date.now() - t0) / 1000).toFixed(1)
    if (first === null) first = d.cmdHits
    const cmd = d.cmd || {}
    console.log('t=' + el + 's hits=' + d.cmdHits + ' (client≈' + (d.cmdHits - first) + ') cmd.run=' + cmd.run + ' token=' + (cmd.token === token ? 'MINE' : cmd.token) + ' ageMs=' + Math.round(d.cmdAgeMs || 0))
    if (Date.now() - t0 > seconds * 1000) {
      const added = fs.statSync(live.file).size - size0
      console.log('beacon bytes added during window: ' + added)
      const tail = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean).slice(-6)
      for (const l of tail) console.log('  tail: ' + l.slice(0, 300))
      process.exit(0)
    }
    setTimeout(step, 3000)
  }).catch((e) => { console.error('poll err ' + String(e)); setTimeout(step, 3000) })
}
step()
