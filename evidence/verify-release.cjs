// 回读校验：从 GitHub Release 下载附件并与本地 tgz 做 sha256 比对（证明"线上产物 = 本地产物"）。
// 用法：node evidence/verify-release.cjs <tag> <assetName> <localFile>
const fs = require('fs')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const REPO = 'WestFox-AwA/dsh-prompt-optimizer'
const [tag, assetName, localFile] = process.argv.slice(2)
if (!tag || !assetName || !localFile) { console.error('usage: verify-release.cjs <tag> <assetName> <localFile>'); process.exit(2) }
function token() {
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('no credential for github.com')
  return line.slice('password='.length).trim()
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
;(async () => {
  const t = token()
  const hdrs = { authorization: 'Bearer ' + t, accept: 'application/vnd.github+json', 'user-agent': 'dsh-prompt-optimizer-verify' }
  const rel = await (await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + tag, { headers: hdrs })).json()
  if (!rel || !rel.tag_name) throw new Error('release not found: ' + tag + ' :: ' + JSON.stringify(rel).slice(0, 200))
  const asset = (rel.assets || []).find((a) => a.name === assetName)
  if (!asset) throw new Error('asset not found: ' + assetName + ' (have: ' + (rel.assets || []).map((a) => a.name).join(',') + ')')
  const dl = Buffer.from(await (await fetch(asset.url, { headers: Object.assign({}, hdrs, { accept: 'application/octet-stream' }) })).arrayBuffer())
  const local = fs.readFileSync(localFile)
  console.log('release   : ' + rel.tag_name + '  prerelease=' + rel.prerelease + '  name=' + JSON.stringify(rel.name))
  console.log('  published: ' + rel.published_at + '  assets=' + (rel.assets || []).length)
  console.log('asset     : ' + asset.name + '  bytes(api)=' + asset.size + '  downloads=' + asset.download_count)
  console.log('  sha256 remote = ' + sha(dl))
  console.log('  sha256 local  = ' + sha(local))
  console.log('  bytes  remote=' + dl.length + '  local=' + local.length)
  console.log('MATCH: ' + (sha(dl) === sha(local) && dl.length === local.length))
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
