// 一次性修复：把字面量 `n（反引号+n）换成真实换行（PowerShell 单引号未解释转义导致）
const fs = require('fs')
const path = process.argv[2]
if (!path) { console.error('usage: node fix-literal-backtick-n.cjs <file>'); process.exit(2) }
const before = fs.readFileSync(path, 'utf8')
const needle = String.fromCharCode(96) + 'n'
const count = before.split(needle).length - 1
const after = before.split(needle).join('\n')
fs.writeFileSync(path, after)
console.log('replaced literal backtick-n:', count)
