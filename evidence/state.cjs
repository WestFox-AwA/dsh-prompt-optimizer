// 状态自检：打印当前版本、面板署名、build 标记、关键文件与 tgz 是否存在、git 工作区状态。
// 用法：node evidence/state.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
console.log('pkg version   : ' + pkg.version)
const cl = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
const meta = (cl.split('\n').find((l) => l.indexOf('啃轮胎的西狐') >= 0) || '')
console.log('panel version : ' + ((meta.match(/(\d+\.\d+\.\d+beta\d+)/) || [])[1] || '?'))
console.log('build label   : ' + ((cl.match(/build: "([^"]+)"/) || [])[1] || '?'))
for (const f of ['dsh-external-dsh-prompt-optimizer-0.3.0-beta.5.tgz', 'dsh-external-dsh-prompt-optimizer-0.3.0-beta.4.tgz']) {
  console.log((fs.existsSync(path.join(root, f)) ? 'exists  ' : 'missing ') + f)
}
const inst = 'C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer-0.3.0-beta.5/package/package.json'
try { console.log('install 0.3.0-beta.5: ' + JSON.parse(fs.readFileSync(inst, 'utf8')).version) } catch (e) { console.log('install 0.3.0-beta.5: missing') }
const profile = JSON.parse(fs.readFileSync('C:/Users/WestFox/.dsh/profiles/web/package.json', 'utf8'))
console.log('profile dep   : ' + profile.dependencies['@dsh-external/dsh-prompt-optimizer'])
const arts = path.join(__dirname, 'artifacts')
console.log('artifacts     : ' + (fs.existsSync(arts) ? fs.readdirSync(arts).filter((f) => f.endsWith('.html')).length + ' 份' : 'none'))
for (const f of ['artifact-check.json', 'cx-grade.json', 'cx-results.json']) {
  const p = path.join(__dirname, f)
  if (!fs.existsSync(p)) { console.log('evidence      : ' + f + ' 缺失'); continue }
  console.log('evidence      : ' + f + '  ' + new Date(fs.statSync(p).mtimeMs).toISOString())
}
