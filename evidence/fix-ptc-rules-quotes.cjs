// 修复 PTC_RULES 里未转义的引号：把该数组内层的英文双引号换成中文书名号「」。
// 用法：node evidence/fix-ptc-rules-quotes.cjs
const fs = require('fs')
const path = require('path')
const p = path.join(__dirname, '..', 'lib', 'index.js')
let t = fs.readFileSync(p, 'utf8')
const start = t.indexOf('const PTC_RULES = [')
if (start < 0) { console.error('PTC_RULES 未找到'); process.exit(1) }
const end = t.indexOf('].join(', start)
if (end < 0) { console.error('PTC_RULES 结尾未找到'); process.exit(1) }
let block = t.slice(start, end)
const before = block
// 保护行首/行尾的结构性引号：只替换"字符串内部"的引号——即出现在行中间（非行首第一个 " 之前、非行尾最后一个 " 之后）的成对引号
block = block.split('\n').map((line) => {
  const m = /^(\s*"- )(.*)(" ,?)$/.exec(line)
  if (!m) return line.replace(/"/g, (ch, off) => (off === 0 ? ch : '「'))  // 兜底
  const inner = m[2].replace(/"/g, (c, off, s) => {
    // 成对替换：第奇数个 → 「，第偶数个 → 」
    const count = (s.slice(0, off).match(/"/g) || []).length
    return count % 2 === 0 ? '「' : '」'
  })
  return m[1] + inner + m[3]
}).join('\n')
fs.writeFileSync(p, t.slice(0, start) + block + t.slice(end), 'utf8')
console.log('FIXED（改动 ' + (before === block ? 0 : 1) + ' 块）')
console.log(block.split('\n').slice(0, 7).join('\n'))
