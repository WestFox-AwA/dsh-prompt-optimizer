// 发布完整性核对：0.1.6-alpha.1 launcher 声明的每个兄弟包，是否都真的发布了该版本。
// 用法：node evidence/dsh-release-check.cjs <launcher package.json> <version>
const fs = require('fs')
const [file, version] = process.argv.slice(2)
if (!file || !version) { console.error('usage: dsh-release-check.cjs <package.json> <version>'); process.exit(2) }
const j = JSON.parse(fs.readFileSync(file, 'utf8'))
const deps = Object.entries(j.dependencies || {}).filter(([, v]) => String(v).includes(version))
console.log('launcher ' + j.name + '@' + j.version + ' 声明 ' + deps.length + ' 个依赖指向 ' + version)

const cache = new Map()
async function versionsOf(name) {
  if (cache.has(name)) return cache.get(name)
  const p = fetch('https://registry.npmjs.org/' + encodeURIComponent(name), { headers: { accept: 'application/vnd.npm.install-v1+json' } })
    .then((r) => r.json())
    .then((x) => Object.keys(x.versions || {}))
    .catch(() => [])
  cache.set(name, p)
  return p
}

;(async () => {
  const missing = []
  const ok = []
  const CONC = 8
  for (let i = 0; i < deps.length; i += CONC) {
    const slice = deps.slice(i, i + CONC)
    const res = await Promise.all(slice.map(async ([name, range]) => {
      const vs = await versionsOf(name)
      return { name, range, has: vs.includes(version), latest: vs[vs.length - 1] || null }
    }))
    for (const r of res) (r.has ? ok : missing).push(r)
  }
  console.log('  已发布 ' + version + ': ' + ok.length + ' 个')
  console.log('  缺失  ' + version + ': ' + missing.length + ' 个')
  for (const m of missing) console.log('    ✗ ' + m.name.padEnd(46) + ' 需求 ' + m.range + '  该包最新=' + m.latest)
  console.log('')
  console.log(missing.length === 0 ? 'RELEASE COMPLETE —— 该版本可从 npm 完整安装' : 'RELEASE INCOMPLETE —— 直接安装会 ETARGET 失败')
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
