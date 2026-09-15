// 盘点客户端里出现的可翻译字符串（双引号字面量、含 CJK、看起来是给人看的）。
// 用法：node evidence/i18n-inventory.cjs
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
const cjk = /[\u4e00-\u9fff]/
const skip = /^(dpo-|data-|aria-|#|\/|https?:|[a-z-]+$)|^\s*$/
const found = new Map()
// 抓 "..." 字面量
for (const m of src.matchAll(/"((?:[^"\\]|\\.){1,200})"/g)) {
  const s = m[1]
  if (!cjk.test(s)) continue
  if (skip.test(s)) continue
  found.set(s, (found.get(s) || 0) + 1)
}
// 抓 '...' 字面量
for (const m of src.matchAll(/'((?:[^'\\]|\\.){1,200})'/g)) {
  const s = m[1]
  if (!cjk.test(s)) continue
  if (skip.test(s)) continue
  found.set(s, (found.get(s) || 0) + 1)
}
const list = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
console.log('唯一可翻译串: ' + list.length)
const byLen = { 短: 0, 中: 0, 长: 0 }
for (const [s] of list) { if (s.length <= 8) byLen.短 += 1; else if (s.length <= 24) byLen.中 += 1; else byLen.长 += 1 }
console.log('  长度分布: ' + JSON.stringify(byLen))
console.log('--- 前 80 条（含出现次数）---')
for (const [s, n] of list.slice(0, 80)) console.log('  [' + n + '] ' + s.slice(0, 90))
const out = path.join(__dirname, 'i18n-inventory.json')
fs.writeFileSync(out, JSON.stringify(list.map(([s, n]) => ({ s, n })), null, 1), 'utf8')
console.log('WROTE ' + out)
