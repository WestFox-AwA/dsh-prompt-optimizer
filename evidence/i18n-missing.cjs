// 静态扫描：找出 client.js 渲染代码里"未被 L()/Lf() 包裹"的中文字面量（漏翻候选）。
// 排除：EN_TEXT 词典区、注释行、已知非 UI 的字面量（逻辑比较值等，用 allowlist 显式列出）。
// 用法：node evidence/i18n-missing.cjs
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'lib', 'client.js')
const src = fs.readFileSync(file, 'utf8')
const lines = src.split('\n')
// 词典区范围
let dictStart = -1, dictEnd = -1
for (let i = 0; i < lines.length; i++) {
  if (dictStart < 0 && /const EN_TEXT = \{/.test(lines[i])) dictStart = i
  else if (dictStart >= 0 && dictEnd < 0 && /^\};/.test(lines[i])) dictEnd = i
}
// 逻辑用值/无需翻译的字面量（显式白名单，必须逐条给理由）
const ALLOW = [
  '真实派发',        // 仅在比较 row.mode === "真实派发" 中使用（逻辑值，非展示）
  'zh', 'en',        // locale id
  '关闭', '普通', '高级', '极端', // 档位 label 由 TIERS 数据提供，L() 包裹发生在调用点
]
const CJK = /[\u4e00-\u9fff]/
const out = []
for (let i = 0; i < lines.length; i++) {
  if (dictStart >= 0 && i >= dictStart && i <= dictEnd) continue
  const raw = lines[i]
  const t = raw.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
  const strRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g
  let m
  while ((m = strRe.exec(raw)) !== null) {
    const lit = m[1] !== undefined ? m[1] : m[2]
    if (!CJK.test(lit)) continue
    if (ALLOW.indexOf(lit) >= 0) continue
    const before = raw.slice(Math.max(0, m.index - 6), m.index)
    const wrapped = /L\($/.test(before) || /Lf\($/.test(before)
    if (wrapped) continue
    out.push({ line: i + 1, lit, ctx: t.slice(0, 150) })
  }
}
console.log('dict region: lines ' + (dictStart + 1) + '-' + (dictEnd + 1) + '  (excluded)')
console.log('unwrapped CJK literals: ' + out.length)
for (const o of out) console.log('  L' + o.line + '  "' + o.lit + '"   | ' + o.ctx)
