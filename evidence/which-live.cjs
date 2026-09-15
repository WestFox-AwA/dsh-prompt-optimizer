// 定位"活实例"：扫描各安装目录的 evidence/client-beacon.jsonl，取最近写入者为当前运行的插件实例；
// 并报告它的版本、client.js 关键标记与最后几条 beacon。
// 用法：node evidence/which-live.cjs [lines]
const fs = require('fs')
const path = require('path')
const n = Number(process.argv[2] || 3)
const base = path.join(__dirname, '..', '..')
const dirs = fs.readdirSync(base).filter((d) => d.indexOf('dsh-prompt-optimizer') === 0)
let live = null
for (const d of dirs) {
  const f = path.join(base, d, 'package', 'evidence', 'client-beacon.jsonl')
  if (!fs.existsSync(f)) continue
  const st = fs.statSync(f)
  if (!live || st.mtimeMs > live.mtimeMs) live = { dir: d, file: f, mtimeMs: st.mtimeMs, size: st.size }
}
if (!live) { console.error('no beacon file found'); process.exit(1) }
console.log('LIVE = ' + live.dir)
console.log('  beacon: ' + live.file)
console.log('  mtime : ' + new Date(live.mtimeMs).toISOString() + '  size=' + live.size + '  ageSec=' + Math.round((Date.now() - live.mtimeMs) / 1000))
const pkgDir = path.join(base, live.dir, 'package')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
console.log('  package version: ' + pkg.version)
const c = fs.readFileSync(path.join(pkgDir, 'lib', 'client.js'), 'utf8')
const build = c.match(/build: "([^"]+)"/)
console.log('  client.js: bytes=' + c.length + ' EN_TEXT=' + (c.indexOf('const EN_TEXT') >= 0) + ' v022=' + (c.indexOf('0.2.2beta1') >= 0) + ' rowHasLang=' + (c.indexOf('rowHasLang') >= 0) + ' build=' + (build ? build[1] : '?'))
const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean).slice(-n)
console.log('  last ' + n + ' beacons:')
for (const l of lines) {
  let o = null
  try { o = JSON.parse(l) } catch (e) { o = { raw: l.slice(0, 120) } }
  console.log('    ' + JSON.stringify(o).slice(0, 400))
}
