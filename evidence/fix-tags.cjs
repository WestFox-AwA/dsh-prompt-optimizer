// 标签纠偏：把 v<version> 标签指到"package.json 的 version 字段恰好等于该版本"的提交。
// 用法：node evidence/fix-tags.cjs [--push] [版本...]
// 背景（issue #6）：发布脚本用 GitHub API 建 release 时，tag 会落在**当时的远端 HEAD** 上，
// 而版本号 bump 的提交往往还没推送 → tag 内容里的 version 与 tag 名不一致。
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '..')
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()

const argv = process.argv.slice(2)
const push = argv.includes('--push')
const versions = argv.filter((a) => !a.startsWith('--'))
const wanted = versions.length ? versions : ['0.4.4-beta.1', '0.4.3-beta.1', '0.4.2-beta.1', '0.4.1-beta.1']

const commits = git(['log', '--format=%H', '--', 'package.json']).split('\n').filter(Boolean)
console.log('扫描 ' + commits.length + ' 个动过 package.json 的提交…')
for (const v of wanted) {
  let found = null
  for (const c of commits) {
    let ver = null
    try { ver = JSON.parse(git(['show', c + ':package.json'])).version } catch (e) { continue }
    if (ver === v) { found = c; break }
  }
  if (!found) { console.log('  ' + v + ' : 未找到 version 匹配的提交（跳过）'); continue }
  git(['tag', '-f', 'v' + v, found])
  const short = found.slice(0, 7)
  if (push) {
    try {
      execFileSync('git', ['-c', 'http.proxy=http://127.0.0.1:7890', 'push', '-f', 'origin', 'refs/tags/v' + v], { cwd: REPO, encoding: 'utf8' })
      console.log('  v' + v + ' → ' + short + '  （已推送）')
    } catch (e) { console.log('  v' + v + ' → ' + short + '  ⚠️ 推送失败：' + String(e.message).slice(0, 90)) }
  } else {
    console.log('  v' + v + ' → ' + short + '  （本地已改；加 --push 推送）')
  }
}
