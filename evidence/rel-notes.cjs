// 从 CHANGELOG.md 切出每个版本的说明，供 GitHub Release 使用。
// 用法：node evidence/rel-notes.cjs <CHANGELOG.md> <version> <outFile>
const fs = require('fs')
const [file, version, out] = process.argv.slice(2)
if (!file || !version || !out) { console.error('usage: rel-notes.cjs <CHANGELOG.md> <version> <outFile>'); process.exit(2) }
const lines = fs.readFileSync(file, 'utf8').split('\n')
const start = lines.findIndex((l) => l.startsWith('## v' + version))
if (start < 0) { console.error('version heading not found: v' + version); process.exit(1) }
let end = lines.length
for (let i = start + 1; i < lines.length; i++) { if (lines[i].startsWith('## v')) { end = i; break } }
const body = lines.slice(start + 1, end).join('\n').replace(/^\s+|\s+$/g, '')
const head = '本版本安装包见下方 Assets（`npm pack` 产物）。完整提示词改动与依据：`PROMPT-OPTIMIZATION.md`。'
fs.writeFileSync(out, body + '\n\n---\n\n' + head + '\n', 'utf8')
console.log('wrote ' + out + '  (' + body.length + ' chars, from line ' + (start + 1) + ' to ' + end + ')')
