// 版本命名切换：自 0.3.1 起线性迭代（不再用 v0.4 / 0.3.0-beta.N）。
// 用法：node evidence/rename-to-031.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const P = (f) => path.join(root, f)
const ED = [
  ['lib/client.js', '0.3.0beta5', '0.3.1beta1'],
  ['lib/client.js', 'build: "v0.3.0-beta.5"', 'build: "v0.3.1-beta.1"'],
  ['package.json', '"version":  "0.3.0-beta.5"', '"version":  "0.3.1-beta.1"'],
  ['package.json', '（v0.3.0-beta.5 · 复杂任务能力包', '（v0.3.1-beta.1 · 复杂任务能力包'],
]
let n = 0
for (const [f, a, b] of ED) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('SKIP ' + f + ' (' + b.slice(0, 28) + ')'); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('MISS ' + f + '  ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); n += c
  console.log('APPLY ' + f + ' → ' + b.slice(0, 40) + '  (' + c + ')')
}
console.log('共 ' + n + ' 处')
const pkg = JSON.parse(fs.readFileSync(P('package.json'), 'utf8'))
console.log('now: ' + pkg.name + '@' + pkg.version)
