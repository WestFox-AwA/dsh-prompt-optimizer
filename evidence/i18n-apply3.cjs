// i18n 第三遍：把"独占一行"的显示串也包成 L("…")（多行 h(...) 调用里的长文案）。
// 过滤：跳过 CSS 行/注释行/字典行；幂等（已是 L( 前缀则跳过）。用法：node evidence/i18n-apply3.cjs
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'lib', 'client.js')
let src = fs.readFileSync(file, 'utf8')
const cjk = /[\u4e00-\u9fff]/

// 从 EN_TEXT 块里取出键集合
const m = src.match(/const EN_TEXT = \{([\s\S]*?)\n\};/)
if (!m) { console.error('EN_TEXT not found'); process.exit(1) }
const keys = []
for (const line of m[1].split('\n')) {
  const mm = line.match(/^\s*"((?:[^"\\]|\\.)*)":/)
  if (mm) keys.push(JSON.parse('"' + mm[1] + '"'))
}
keys.sort((a, b) => b.length - a.length)
console.log('字典键: ' + keys.length)

const lines = src.split('\n')
let wrapped = 0
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  if (!cjk.test(line)) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue                // 注释
  if (/^\s*"\.|^\s*'\.|"@media|"@supports|"@keyframes/.test(line)) continue  // CSS
  if (/const EN_TEXT|EN_TEXT\[|^\s*"[^"]+":\s*"/.test(line)) continue        // 字典自身
  if (/^\s*const .* = \[$/.test(line)) continue                 // 数组字面量定义
  let out = line
  for (const k of keys) {
    const lit = '"' + k + '"'
    let idx = out.indexOf(lit)
    while (idx >= 0) {
      const before = out.slice(0, idx)
      if (before.endsWith('L(') || before.endsWith('Lf(')) { idx = out.indexOf(lit, idx + lit.length); continue }
      out = out.slice(0, idx) + 'L(' + lit + ')' + out.slice(idx + lit.length)
      wrapped += 1
      idx = out.indexOf(lit, idx + lit.length + 3)
    }
  }
  if (out !== line) lines[i] = out
}
src = lines.join('\n')
fs.writeFileSync(file, src, 'utf8')
console.log('第三遍包裹: ' + wrapped + ' 处')
