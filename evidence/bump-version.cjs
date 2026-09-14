// 版本号补丁：只改 package.json 的 version 字段，保留原格式，不写 BOM。
// 用法：node evidence/bump-version.cjs <package.json> <newVersion>
const fs = require('fs')
const [file, next] = process.argv.slice(2)
if (!file || !next) { console.error('usage: bump-version.cjs <package.json> <version>'); process.exit(2) }
const raw = fs.readFileSync(file, 'utf8')
const re = /"version"\s*:\s*"[^"]+"/
const found = raw.match(re)
if (!found) { console.error('no version field found'); process.exit(1) }
const out = raw.replace(re, '"version":  "' + next + '"')
fs.writeFileSync(file, out, 'utf8')
const check = JSON.parse(fs.readFileSync(file, 'utf8'))
const buf = fs.readFileSync(file)
console.log('version ' + found[0] + '  ->  ' + out.match(re)[0])
console.log('json parsed: ' + check.name + '@' + check.version + '  bom=' + (buf[0] === 0xef) + '  bytes=' + buf.length)
