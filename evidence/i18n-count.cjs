// 统计 EN_TEXT 条目数（词典区内的 `  "键": "值",` 行）。
// 用法：node evidence/i18n-count.cjs
const fs = require('fs')
const path = require('path')
const t = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
const s = t.indexOf('const EN_TEXT = {')
const e = t.indexOf('\n};', s)
const body = t.slice(s, e)
const lines = body.split('\n').filter((l) => /^  ".*":\s"/.test(l))
console.log('EN_TEXT entries: ' + lines.length)
const dup = {}
for (const l of lines) { const k = l.match(/^  "(.*)":/)[1]; dup[k] = (dup[k] || 0) + 1 }
const dups = Object.keys(dup).filter((k) => dup[k] > 1)
console.log('duplicate keys: ' + (dups.length ? JSON.stringify(dups) : 'none'))
