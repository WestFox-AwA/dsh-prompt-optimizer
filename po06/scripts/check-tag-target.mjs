// 守卫（EV-0150）：**发布 tag 必须指向"那个版本"的提交**。
//
// 为什么需要它：发 `v0.6.0-beta.16` 时我忘了先推本地 tag，GitHub 的 `POST /releases` 便自动建了一个 tag，
// 而它默认落在**仓库默认分支 `main`（0.5 那条线）**上 —— 于是 Release 的产物、说明、名字全对，
// 指向的却是另一条线的提交。人眼很难发现，因为它"看起来完全正常"。
//
// 判据（不看分支名、不看 tag 消息，只看**那个提交里的代码**）：
//   tag 名里的版本号  ==  该 tag 所指提交的 `po06/package.json` 里的 version
// 若指向 main，那份 package.json 的版本是 0.5.x（或该路径不存在），断言立刻失败。
//
// 用法：
//   node po06/scripts/check-tag-target.mjs v0.6.0-beta.16            # 只查一个
//   node po06/scripts/check-tag-target.mjs --all                     # 查所有 v0.6.* tag
//   node po06/scripts/check-tag-target.mjs --remote                  # 连远端 ref 一起查（需网络）
import { execFileSync } from 'node:child_process'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const tryGit = (args) => { try { return git(args) } catch { return null } }

/** 取 tag 名里的版本号：v0.6.0-beta.16 -> 0.6.0-beta.16 */
const versionOfTag = (tag) => tag.replace(/^v/, '')

function check(tag) {
  const commit = tryGit(['rev-parse', `${tag}^{commit}`])
  if (!commit) return { tag, ok: false, reason: 'tag 不存在或不能解析为提交' }
  const pkgRaw = tryGit(['show', `${commit}:po06/package.json`])
  if (!pkgRaw) return { tag, ok: false, commit, reason: '该提交里没有 po06/package.json（很可能是打到了别的分支/更早的树上）' }
  let version = null
  try { version = JSON.parse(pkgRaw).version } catch { return { tag, ok: false, commit, reason: 'po06/package.json 解析失败' } }
  const want = versionOfTag(tag)
  if (version !== want) return { tag, ok: false, commit, version, want, reason: `该提交里是 ${version}，与 tag 名 ${want} 不符` }
  return { tag, ok: true, commit, version }
}

const argv = process.argv.slice(2)
const wantRemote = argv.includes('--remote')
const all = argv.includes('--all')
const tags = all
  ? git(['tag', '-l', 'v0.6.*']).split('\n').filter(Boolean)
  : argv.filter((a) => !a.startsWith('--'))
if (tags.length === 0) { console.log('用法：node po06/scripts/check-tag-target.mjs <tag>… | --all [--remote]'); process.exit(2) }

let failed = 0
for (const tag of tags) {
  const r = check(tag)
  const line = r.ok ? `PASS ${tag} -> ${r.commit.slice(0, 7)} (${r.version})` : `FAIL ${tag} -> ${r.commit ? r.commit.slice(0, 7) + ' ' : ''}${r.reason}`
  console.log(line)
  if (!r.ok) failed += 1
  if (wantRemote) {
    // 远端 ref 与本地是否同一提交（只读，不改任何东西）
    // ⚠ 这里踩过一次假警报（值得留着）：peel 查询（`tag^{}`）**网络失败**时返回 null，
    //   我原先把它和"没有 peel 行（轻量 tag）"混为一谈，于是退回去比较 **tag 对象 sha**，
    //   报出"远端与本地不同！"——而实际上远端落点是对的（API 复核为 14c6acc）。
    //   **守卫报假警报比没有守卫更糟**：用几次之后人就学会忽略它。所以两者的处置必须分开。
    const local = r.commit
    const remote = tryGit(['ls-remote', '--tags', 'origin', tag])
    if (remote === null) console.log(`  (远端未检查：网络不可用)`)
    else if (!remote) console.log(`  FAIL 远端没有这个 tag`)
    else {
      const sha = remote.split(/\s+/)[0]
      const peelRaw = tryGit(['ls-remote', '--tags', 'origin', `${tag}^{}`])
      if (peelRaw === null) console.log(`  (远端 peel 未检查：网络不可用；上面比较的是本地)`)
      else {
        // peel 有行 ⇒ annotated tag，取 peel 的 sha；peel 无行 ⇒ 轻量 tag，ref 的 sha 就是提交
        const remoteCommit = peelRaw ? peelRaw.split(/\s+/)[0] : sha
        const same = local === remoteCommit
        console.log(`  ${same ? 'PASS' : 'FAIL'} 远端 ${tag} -> ${remoteCommit.slice(0, 7)}${same ? '' : '（与本地不同！）'}`)
        if (!same) failed += 1
      }
    }
  }
}
console.log(failed === 0 ? `\n全部通过（${tags.length} 个 tag）` : `\n有 ${failed} 项不通过`)
process.exit(failed === 0 ? 0 : 1)
