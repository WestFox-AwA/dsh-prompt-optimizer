// 打印活实例里某个 stage 的最近一条 beacon 的关键字段（默认打印全部字段的短摘要）。
// 用法：node evidence/beacon-last.cjs <stage> [field1,field2,...]
const fs = require('fs')
const path = require('path')
const base = path.join(__dirname, '..', '..')
const stage = process.argv[2]
const fields = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean)
const only = process.argv[4] || ''
if (!stage) { console.error('usage: beacon-last.cjs <stage> [fields] [instanceSubstring]'); process.exit(2) }
let live = null
for (const d of fs.readdirSync(base).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  if (only && d.indexOf(only) < 0) continue
  const f = path.join(base, d, 'package', 'evidence', 'client-beacon.jsonl')
  if (!fs.existsSync(f)) continue
  const st = fs.statSync(f)
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, file: f }
}
if (!live) { console.error('no live instance'); process.exit(1) }
const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean)
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].indexOf('"stage":"' + stage + '"') < 0) continue
  const o = JSON.parse(lines[i])
  console.log('live=' + live.name + '  t=' + new Date(o.t).toISOString())
  if (fields.length === 0) { console.log(JSON.stringify(o).slice(0, 2000)); break }
  for (const k of fields) console.log('  ' + k + ' = ' + JSON.stringify(o[k]))
  break
}
