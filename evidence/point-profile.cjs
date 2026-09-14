// 把 profile 里 dsh-prompt-optimizer 的 file: 依赖指向新版本安装目录。
// 只做定点字符串替换，保留文件其余格式，不写 BOM。
// 用法：node evidence/point-profile.cjs <profile package.json> <newVersionDir>
const fs = require('fs')
const [file, dir] = process.argv.slice(2)
if (!file || !dir) { console.error('usage: point-profile.cjs <package.json> <dir>'); process.exit(2) }
const key = '@dsh-external/dsh-prompt-optimizer'
const raw = fs.readFileSync(file, 'utf8')
const json = JSON.parse(raw)
const before = json.dependencies && json.dependencies[key]
if (typeof before !== 'string' || before.indexOf('file:') !== 0) { console.error('dependency not a file: link -> ' + before); process.exit(1) }
const next = 'file:' + dir.replace(/\\/g, '/')
if (raw.indexOf(before) < 0) { console.error('literal dependency string not found in file'); process.exit(1) }
const out = raw.replace(before, next)
fs.writeFileSync(file, out, 'utf8')
const back = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('dep: ' + before + '  ->  ' + back.dependencies[key])
console.log('json ok  bom=' + (fs.readFileSync(file)[0] === 0xef) + '  bundles=' + JSON.stringify(back.dsh.profile.bundles))
