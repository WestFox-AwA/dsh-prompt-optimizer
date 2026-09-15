// 版本字符串统一切换（幂等）：0.2.2-beta.1 → 0.3.0-beta.1（面板署名 0.2.2beta1 → 0.3.0beta1、build 标记）。
// 用法：node evidence/bump-030b1.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const EDITS = [
  ['lib/client.js', '0.2.2beta1', '0.3.0beta1'],
  ['lib/client.js', 'build: "v0.2.2-beta.1"', 'build: "v0.3.0-beta.1"'],
]
let n = 0
for (const [file, from, to] of EDITS) {
  const p = path.join(root, file)
  let t = fs.readFileSync(p, 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('SKIP  ' + file + '  (' + to + ' 已在)'); continue }
  const c = t.split(from).length - 1
  if (!c) { console.log('MISS  ' + file + '  ' + from); continue }
  t = t.split(from).join(to)
  fs.writeFileSync(p, t, 'utf8')
  n += c
  console.log('APPLY ' + file + '  ' + from + ' → ' + to + '  (' + c + ' 处)')
}
console.log('共替换 ' + n + ' 处')
