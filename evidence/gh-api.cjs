// GitHub 侧操作（gh CLI 未安装，改用 REST API）。凭据从 git credential helper 取，不打印明文。
// 用法：
//   node evidence/gh-api.cjs probe                     只读：仓库信息 + 现有 releases
//   node evidence/gh-api.cjs release <tag> <name> <notesFile> [assetFile]
//   node evidence/gh-api.cjs about <description> [topic1,topic2,...]
const fs = require('fs')
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
    for (const r of rels) console.log('  ' + r.tag_name + '  ' + (r.name || '') + '  assets=' + r.assets.map((x) => x.name).join(',') + '  draft=' + r.draft)
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
  console.error('unknown command: ' + cmd)
  process.exit(2)
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
