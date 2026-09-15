// 收紧提示模板空格：'已按 {tier} 档优化结果发送' → '已按{tier}档优化结果发送'（中文渲染不再有多余空格；英文翻译不变）。
// 用法：node evidence/tighten-tier-notice.cjs
const fs = require('fs')
const path = require('path')
const p = path.join(__dirname, '..', 'lib', 'client.js')
let t = fs.readFileSync(p, 'utf8')
const PAIRS = [
  ['Lf("已按 {tier} 档优化结果发送"', 'Lf("已按{tier}档优化结果发送"'],
  ['"已按 {tier} 档优化结果发送": "Sent the result optimized at tier {tier}",', '"已按{tier}档优化结果发送": "Sent the result optimized at tier {tier}",'],
]
let n = 0
for (const [a, b] of PAIRS) {
  const c = t.split(a).length - 1
  if (!c) { console.log('MISS ' + JSON.stringify(a.slice(0, 40))); continue }
  t = t.split(a).join(b); n += c
}
fs.writeFileSync(p, t, 'utf8')
console.log('replaced ' + n)
