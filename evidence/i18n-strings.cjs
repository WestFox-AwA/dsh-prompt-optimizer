// 只抽"渲染行"（h(...) 调用 / showNotice / title: / line(...)）里出现的 CJK 字面量 —— 即真正要翻译的 UI 串。
// 用法：node evidence/i18n-strings.cjs
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8').split('\n')
const cjk = /[\u4e00-\u9fff]/
const RENDER = /\bh\(|showNotice\(|title:|aria-label|line\(|label:|placeholder|renderSlot/
const out = new Map()
for (let i = 0; i < src.length; i++) {
  const line = src[i]
  if (!cjk.test(line)) continue
  if (!RENDER.test(line)) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue          // 注释行
  if (/^\s*"\.|"@media|'\./.test(line)) continue          // CSS 行
  for (const m of line.matchAll(/"((?:[^"\\]|\\.){1,120})"/g)) {
    if (cjk.test(m[1]) && !/^(dpo-|data-|aria-)/.test(m[1])) out.set(m[1], (out.get(m[1]) || 0) + 1)
  }
  for (const m of line.matchAll(/'((?:[^'\\]|\\.){1,120})'/g)) {
    if (cjk.test(m[1]) && !/^(dpo-|data-|aria-)/.test(m[1])) out.set(m[1], (out.get(m[1]) || 0) + 1)
  }
}
const list = [...out.keys()].sort()
console.log('渲染行里的 UI 串: ' + list.length)
for (const s of list) console.log('  ' + JSON.stringify(s))
fs.writeFileSync(path.join(__dirname, 'i18n-ui-strings.json'), JSON.stringify(list, null, 1), 'utf8')
