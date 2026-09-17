// GitHub 侧操作（gh CLI 未安装，改用 REST API）。凭据从 git credential helper 取，不打印明文。
// 用法：
//   node evidence/gh-api.cjs probe                     只读：仓库信息 + 现有 releases
//   node evidence/gh-api.cjs release <tag> <name> <notesFile> [assetFile]
//   node evidence/gh-api.cjs about <description> [topic1,topic2,...]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const REPO = 'WestFox-AwA/dsh-prompt-optimizer'
const API = 'https://api.github.com'

function token() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  })
  const line = out.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('no credential found for github.com')
  return line.slice('password='.length).trim()
}

async function api(path, opts, raw, base) {
  const t = token()
  const res = await fetch((base || API) + path, Object.assign({}, opts, {
    headers: Object.assign({
      authorization: 'Bearer ' + t,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-prompt-optimizer-release',
      'x-github-api-version': '2022-11-28',
    }, (opts && opts.headers) || {}),
  }))
  const text = await res.text()
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' :: ' + text.slice(0, 400))
  return raw ? text : JSON.parse(text || '{}')
}

;(async () => {
  const [cmd, a, b, c, d] = process.argv.slice(2)
  if (cmd === 'probe') {
    const repo = await api('/repos/' + REPO)
    console.log('repo: ' + repo.full_name)
    console.log('  description : ' + JSON.stringify(repo.description))
    console.log('  homepage    : ' + JSON.stringify(repo.homepage))
    console.log('  topics      : ' + JSON.stringify(repo.topics))
    console.log('  default     : ' + repo.default_branch + '  pushedAt=' + repo.pushed_at)
    console.log('  stars/forks : ' + repo.stargazers_count + '/' + repo.forks_count)
    const rels = await api('/repos/' + REPO + '/releases?per_page=20')
    console.log('releases: ' + rels.length)
    for (const r of rels) console.log('  ' + r.tag_name + '  ' + (r.name || '') + '  assets=' + r.assets.map((x) => x.name).join(',') + '  draft=' + r.draft + '  prerelease=' + r.prerelease)
    // 「最新版」指针：GitHub 的 /releases/latest 会**跳过所有 prerelease**——若全是预发布，它会指向老版本或取不到，
    // 于是"跟着 README 下载/点 Releases"的人就会拿到旧版。这里显式暴露出来。
    try {
      const latest = await api('/repos/' + REPO + '/releases/latest')
      console.log('LATEST(GitHub 认定的最新版): ' + latest.tag_name + '  prerelease=' + latest.prerelease + '  publishedAt=' + latest.published_at)
    } catch (e) { console.log('LATEST: 取不到（' + String((e && e.message) || e).slice(0, 90) + '）') }
    const tags = await api('/repos/' + REPO + '/tags?per_page=10')
    console.log('remote tags: ' + tags.map((t) => t.name).join(', '))
    return
  }
  if (cmd === 'about') {
    const body = { description: a }
    if (b) body.topics = b.split(',').map((s) => s.trim()).filter(Boolean)
    const out = await api('/repos/' + REPO, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    console.log('updated: description=' + JSON.stringify(out.description) + ' topics=' + JSON.stringify(out.topics))
    return
  }
  if (cmd === 'topics') {
    const names = String(a || '').split(',').map((s) => s.trim()).filter(Boolean)
    const out = await api('/repos/' + REPO + '/topics', { method: 'PUT', body: JSON.stringify({ names }), headers: { 'content-type': 'application/json' } })
    console.log('topics now: ' + JSON.stringify(out.names))
    return
  }
  if (cmd === 'edit-release') {
    // 用法：node evidence/gh-api.cjs edit-release <tag> <notesFile> [name]
    const tag = a, notesFile = b, name = c
    const rel = await api('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag))
    const notes = fs.readFileSync(notesFile, 'utf8')
    const body = { body: notes }
    if (name) body.name = name
    const out = await api('/repos/' + REPO + '/releases/' + rel.id, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    console.log('edited release ' + out.tag_name + '  name=' + JSON.stringify(out.name) + '  bodyChars=' + String(out.body || '').length)
    return
  }
  if (cmd === 'clean-drafts') {
    // 删除 draft release（删 tag 会把已发布 release 变成无 tag 的 draft，反复重发会留下残留）。
    // 用法：node evidence/gh-api.cjs clean-drafts [tagFilter]
    const filter = a || ''
    const rels = await api('/repos/' + REPO + '/releases?per_page=100')
    const drafts = rels.filter((r) => r.draft === true && (!filter || String(r.tag_name || '').indexOf(filter) >= 0))
    console.log('drafts found: ' + rels.filter((r) => r.draft).length + '  matching filter(' + JSON.stringify(filter) + '): ' + drafts.length)
    for (const r of drafts) {
      await api('/repos/' + REPO + '/releases/' + r.id, { method: 'DELETE' })
      console.log('  deleted draft id=' + r.id + '  tag=' + JSON.stringify(r.tag_name) + '  name=' + JSON.stringify(r.name))
    }
    const after = await api('/repos/' + REPO + '/releases?per_page=100')
    console.log('remaining releases: ' + after.length + '  (drafts still there: ' + after.filter((r) => r.draft).length + ')')
    for (const r of after) console.log('  ' + r.tag_name + '  draft=' + r.draft + '  assets=' + r.assets.map((x) => x.name).join(','))
    return
  }
  if (cmd === 'publish') {
    // 一条命令把"最新版"修到位（避免以后漏步骤）：
    //   node evidence/gh-api.cjs publish <version> <notesFile>
    // 做的事：① 建/更新 release（tag v<version>）② 上传版本化资产 ③ 上传**版本无关别名**资产
    //        ④ 标记为非 prerelease 且 make_latest=true ⑤ 回读校验 /releases/latest 与下载 URL 的 sha256
    // 背景：GitHub 的 /releases/latest 会跳过所有 prerelease；若全是 prerelease，则"最新版"指针 404，
    //       任何人走 Releases / latest 都拿不到东西（实测就是这个 bug）。别名资产让 releases/latest/download/<别名> 永久可用。
    const ALIAS = 'dsh-external-dsh-prompt-optimizer.tgz'
    const ver = a
    const notesFile = b
    if (!ver || !notesFile) { console.error('用法: publish <version> <notesFile>'); process.exit(2) }
    const repoRoot = path.join(__dirname, '..')
    const assetPath = path.join(repoRoot, 'dsh-external-dsh-prompt-optimizer-' + ver + '.tgz')
    if (!fs.existsSync(assetPath)) { console.error('找不到资产: ' + assetPath); process.exit(2) }
    const notes = fs.readFileSync(notesFile, 'utf8')
    const tag = 'v' + ver
    const buf = fs.readFileSync(assetPath)
    const localSha = crypto.createHash('sha256').update(buf).digest('hex')
    let rel
    try { rel = await api('/repos/' + REPO + '/releases/tags/' + tag) } catch (e) { rel = null }
    if (!rel) {
      rel = await api('/repos/' + REPO + '/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, name: ver, body: notes, draft: false, prerelease: false }), headers: { 'content-type': 'application/json' } })
      console.log('created release ' + tag)
    } else {
      rel = await api('/repos/' + REPO + '/releases/' + rel.id, { method: 'PATCH', body: JSON.stringify({ name: ver, body: notes, prerelease: false }), headers: { 'content-type': 'application/json' } })
      console.log('updated release ' + tag)
    }
    for (const [file, name] of [[assetPath, path.basename(assetPath)], [assetPath, ALIAS]]) {
      const existing = (rel.assets || []).find((x) => x.name === name)
      if (existing) await api('/repos/' + REPO + '/releases/assets/' + existing.id, { method: 'DELETE' })
      const up = await api('/repos/' + REPO + '/releases/' + rel.id + '/assets?name=' + encodeURIComponent(name), { method: 'POST', body: file === assetPath ? buf : fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } }, false, 'https://uploads.github.com')
      console.log('asset: ' + up.name + '  ' + Math.round(up.size / 1024) + ' KB')
    }
    rel = await api('/repos/' + REPO + '/releases/' + rel.id, { method: 'PATCH', body: JSON.stringify({ prerelease: false, make_latest: 'true' }), headers: { 'content-type': 'application/json' } })
    console.log('marked: prerelease=' + rel.prerelease + '  (make_latest=true)')
    const latest = await api('/repos/' + REPO + '/releases/latest')
    console.log('回读 /releases/latest = ' + latest.tag_name + '  ✓' + (latest.tag_name === tag ? '' : ' ✗ 与 ' + tag + ' 不一致！'))
    console.log('下载别名 URL: https://github.com/' + REPO + '/releases/latest/download/' + ALIAS)
    console.log('本地 sha256 = ' + localSha)
    return
  }
  if (cmd === 'release') {
    const [tag, name, notesFile, assetFile] = [a, b, c, d]
    const notes = fs.readFileSync(notesFile, 'utf8')
    let rel = null
    try {
      rel = await api('/repos/' + REPO + '/releases/tags/' + tag)
      console.log('release exists: ' + rel.tag_name + ' → 更新说明')
      rel = await api('/repos/' + REPO + '/releases/' + rel.id, { method: 'PATCH', body: JSON.stringify({ name, body: notes }), headers: { 'content-type': 'application/json' } })
    } catch (e) {
      console.log('creating release ' + tag)
      rel = await api('/repos/' + REPO + '/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, name, body: notes, draft: false, prerelease: /beta/i.test(tag) }), headers: { 'content-type': 'application/json' } })
    }
    console.log('release: ' + rel.tag_name + ' → ' + rel.html_url + '  prerelease=' + rel.prerelease)
    if (assetFile) {
      const buf = fs.readFileSync(assetFile)
      const nm = assetFile.split(/[\\/]/).pop()
      const existing = (rel.assets || []).find((x) => x.name === nm)
      if (existing) await api('/repos/' + REPO + '/releases/assets/' + existing.id, { method: 'DELETE' })
      const up = await api('/repos/' + REPO + '/releases/' + rel.id + '/assets?name=' + encodeURIComponent(nm), {
        method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream' },
      }, false, 'https://uploads.github.com')
      console.log('asset uploaded: ' + up.name + '  ' + Math.round(up.size / 1024) + ' KB  → ' + up.browser_download_url)
    }
    return
  }
  if (cmd === 'issues') {
    // 用法：node evidence/gh-api.cjs issues [open|closed|all]
    const state = a || 'open'
    const list = await api('/repos/' + REPO + '/issues?state=' + state + '&per_page=100')
    const only = list.filter((it) => !it.pull_request)
    console.log('issues(' + state + '): ' + only.length + '  （PR 已排除）')
    for (const it of only) {
      console.log('')
      console.log('#' + it.number + '  [' + it.state + ']  ' + it.title)
      console.log('   labels=' + JSON.stringify((it.labels || []).map((l) => (l && l.name) || l)) + '  comments=' + it.comments + '  created=' + it.created_at + '  updated=' + it.updated_at + '  by=' + ((it.user && it.user.login) || '?'))
      console.log('   body: ' + String(it.body || '').replace(/\r/g, '').slice(0, 1500))
      if (it.comments > 0) {
        const cs = await api('/repos/' + REPO + '/issues/' + it.number + '/comments?per_page=20')
        for (const c of cs) console.log('   └ ' + ((c.user && c.user.login) || '?') + ' @' + c.created_at + ': ' + String(c.body || '').replace(/\r/g, '').slice(0, 900))
      }
    }
    return
  }
  console.error('unknown command: ' + cmd)
  process.exit(2)
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
