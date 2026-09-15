// 在活实例的 beacon 文件里检索某个 stage 的最近若干条（默认 5 条），按时间倒序打印。
// 用法：node evidence/beacon-find.cjs <stage> [count]
const fs = require('fs')
const path = require('path')
const base = path.join(__dirname, '..', '..')
const stage = process.argv[2]
const count = Number(process.argv[3] || 5)
if (!stage) { console.error('usage: beacon-find.cjs <stage> [count]'); process.exit(2) }
let live = null
for (const d of fs.readdirSync(base).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  const f = path.join(base, d, 'package', 'evidence', 'client-beacon.jsonl')
  if (!fs.existsSync(f)) continue
  const st = fs.statSync(f)
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, file: f, mtimeMs: st.mtimeMs }
}
if (!live) { console.error('no live instance'); process.exit(1) }
console.log('live = ' + live.name)
const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean)
const needle = '"stage":"' + stage + '"'
const hits = []
for (let i = lines.length - 1; i >= 0 && hits.length < count; i--) {
  if (lines[i].indexOf(needle) >= 0) {
    let o = null
    try { o = JSON.parse(lines[i]) } catch (e) { o = { raw: lines[i].slice(0, 200) } }
    hits.push(o)
  }
}
console.log('matched ' + hits.length + ' of stage=' + stage + ' (file lines=' + lines.length + ')')
for (const h of hits) console.log('  ' + new Date(h.t || 0).toISOString() + '  ' + JSON.stringify(h).slice(0, 700))
