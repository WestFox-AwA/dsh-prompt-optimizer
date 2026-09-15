// 校验发布包内容与版本一致性（避免内联 JS 的引号灾难）。
// 用法：node evidence/verify-pack.cjs <packageDir>
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
const client = fs.readFileSync(path.join(dir, 'lib', 'client.js'), 'utf8')
const host = fs.readFileSync(path.join(dir, 'lib', 'index.js'), 'utf8')
const build = client.match(/build: "(v[^"]+)"/)
// 署名行版本：形如 L("版本") + " 0.2.2beta1 · " —— 直接取署名行上的 x.y.zbetaN
const metaLine = (client.split('\n').find((l) => l.indexOf('啃轮胎的西狐') >= 0) || '')
const helpVer = metaLine.match(/(\d+\.\d+\.\d+beta\d+)/)
const dshCompat = client.indexOf('dsh-0.1.6-alpha.1') >= 0
const substance = host.indexOf('SUBSTANCE_RULES') >= 0
const decideSelf = host.indexOf('能定的自己定') >= 0
const fallback = host.indexOf('查不到也要能推进') >= 0
console.log('  package      : ' + pkg.name + '@' + pkg.version)
console.log('  description  : ' + String(pkg.description).slice(0, 60) + '…')
console.log('  client build : ' + (build ? build[1] : '(未找到)'))
console.log('  help 署名版本 : ' + (helpVer ? helpVer[1] : '(未找到)'))
console.log('  help 含兼容声明: ' + dshCompat)
console.log('  提交物含实质优先段: ' + substance + '  能定的自己定: ' + decideSelf + '  兜底路径: ' + fallback)
console.log('  files 清单   : ' + JSON.stringify(pkg.files))
