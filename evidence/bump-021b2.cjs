// 0.2.1-beta.1 → 0.2.1-beta.2 的版本字符串统一切换（幂等）。
// 用法：node evidence/bump-021b2.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')

const EDITS = [
  ['README.md', 'v0.2.1-beta.1', 'v0.2.1-beta.2'],
  ['README.md', '**0.2.1beta1**', '**0.2.1beta2**'],
  ['README.en.md', 'v0.2.1-beta.1', 'v0.2.1-beta.2'],
  ['README.en.md', 'Version **0.2.1beta1**', 'Version **0.2.1beta2**'],
  ['lib/client.js', '版本 0.2.1beta1', '版本 0.2.1beta2'],
  ['package.json', 'v0.2.1-beta.1', 'v0.2.1-beta.2'],
  ['CHANGELOG.md', '（面板中显示为 `0.1.1beta1`）', '（面板中显示为 `0.2.1beta2`）'],
]
let n = 0
for (const [file, from, to] of EDITS) {
  const p = path.join(root, file)
  let t = fs.readFileSync(p, 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('SKIP  ' + file + '  (' + JSON.stringify(to) + ' 已在)'); continue }
  if (t.indexOf(from) < 0) { console.log('MISS  ' + file + '  ' + JSON.stringify(from)); continue }
  const c = t.split(from).length - 1
  t = t.split(from).join(to)
  fs.writeFileSync(p, t, 'utf8')
  n += c
  console.log('APPLY ' + file + '  ' + from + ' → ' + to + '  (' + c + ' 处)')
}
console.log('共替换 ' + n + ' 处')
