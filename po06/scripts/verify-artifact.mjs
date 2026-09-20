// 发布完整性核对：把**已经发出的那个 tgz**与**某个 git 提交**钉在一起。
//
//   node po06/scripts/verify-artifact.mjs --tag v0.6.0-beta.4 --tgz <path>
//        [--repo <仓库根>] [--checklist po06/RELEASE-CHECKLIST.md] [--json]
//
// 为什么需要它（EV-0133）：`install-drill` 证明的是"**现在** pack 出来的东西自足"，
// 而用户手里拿到的是**打包那一刻**的 tgz。两者之间有一整类"说了但没验"的断言：
//   · "这个包就是 tag 里那份代码" —— 此前只靠我**手工** tar 出 README 比一次哈希；
//   · "包名/版本号/文件名/tag 四处一致" —— 出过一次 `0.6.0-beta.3` 的包配上 beta.3 的话、
//     而 checklist 里写着 beta.4 的名字（同类漂移在文档里我们已经栽过几次）；
//   · "checklist 上记的 sha256 就是这个文件" —— 记的是**上一次**打包的哈希时，
//     没人会发现（发出去的附件与登记值不符 = 无法复核的发布）。
// 任一为假，都会让"我验过了"变成**假话**——这正是本项目最忌讳的那类问题。
//
// 判据（全部字节级、不依赖网络）：
//   ① tgz 存在且可读，算出 sha256 / 字节数；
//   ② `git rev-parse <ref>^{commit}` 能解析（tag 或提交号都行）；
//   ③ 包内成员集合 == **tag 里那份 `package.json` 的 `files` 声明**（多一个少一个都算错）；
//   ④ 每个成员与 `git show <ref>:po06/<成员>` **逐字节相同**（CRLF/LF 差异单独记为
//      `normalized-lf` 而不是静默放过——见下）；
//   ⑤ tag 名 == `v` + tag 内 package.json 的 version == tgz 文件名里的版本；
//   ⑥ checklist 里若登记了这个文件名的 sha256（完整或缩写），必须与实测一致；
//   ⑦ 不得夹带 `test/`、`scripts/`，`eval/` 下只允许封存题集（同 install-drill 的纪律）。
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')          // po06/
const REPO_DEFAULT = join(ROOT, '..')  // 仓库根

function opt(name, dflt = null) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt
}
const AS_JSON = process.argv.includes('--json')

const report = { probe: 'po06-verify-artifact', phase: 'P8', at: new Date().toISOString(), steps: {}, ok: false }

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** `git show <ref>:<path>` → Buffer；不存在返回 null（不抛，交给调用方判定）。 */
function gitShow(repo, ref, path) {
  const r = spawnSync('git', ['show', `${ref}:${path}`], { cwd: repo, maxBuffer: 1e8 })
  if (r.status !== 0) return null
  return r.stdout
}

/** tgz 内的成员名（`package/...`；目录条目被 tar -t 列出时以 / 结尾，这里过滤掉）。 */
function tarMembers(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 1e8 })
  if (r.status !== 0) throw new Error('tar -tzf 失败：' + String(r.stderr || '').trim())
  return String(r.stdout).split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/')).sort()
}

/** 从 tgz 里取出一个成员的**原始字节**（不要走文本解码：这里要的是字节相等）。 */
function tarExtract(tgz, member) {
  const r = spawnSync('tar', ['-xzOf', tgz, member], { maxBuffer: 1e8 })
  if (r.status !== 0) throw new Error('tar -xzOf 失败：' + member + ' ' + String(r.stderr || '').trim())
  return r.stdout
}

/** 与 install-drill 同一条规则：允许清单从 `files` 推导，不写死。 */
function declaredPaths(pkg) {
  return Array.isArray(pkg && pkg.files) ? pkg.files : []
}
function expectedFromDeclared(declared, tagFiles) {
  const want = new Set(['package.json'])
  const missingInTag = []
  for (const d of declared) {
    if (d.endsWith('/')) {
      const hit = tagFiles.filter((f) => f.startsWith(d))
      if (hit.length === 0) missingInTag.push(d)
      for (const h of hit) want.add(h)
      continue
    }
    if (tagFiles.includes(d)) { want.add(d); continue }
    // 目录式声明（`lib`）或通配（`eval/HOLDOUT-v*.md`）：`files` 两种写法都合法
    const asDir = tagFiles.filter((f) => f.startsWith(d + '/'))
    const re = new RegExp('^' + d.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
    const asGlob = tagFiles.filter((f) => re.test(f))
    const hit = [...new Set([...asDir, ...asGlob])]
    if (hit.length === 0) missingInTag.push(d)
    for (const h of hit) want.add(h)
  }
  return { want, missingInTag }
}

const REQUIRED_ARGS = ['tag', 'tgz']
const MISSING = REQUIRED_ARGS.filter((k) => !opt(k))
if (MISSING.length > 0) {
  console.log('用法：node po06/scripts/verify-artifact.mjs --tag <tag|commit> --tgz <path> [--repo <dir>] [--checklist <path>] [--json]')
  console.log('缺少参数：' + MISSING.map((k) => '--' + k).join(', '))
  process.exit(2)
}

const REF = opt('tag')
const TGZ = opt('tgz')
const REPO = opt('repo', REPO_DEFAULT)
const CHECKLIST = opt('checklist', join(ROOT, 'RELEASE-CHECKLIST.md'))
report.ref = REF
report.tgz = TGZ
report.repo = REPO

try {
  // ── ① 文件本身 ─────────────────────────────────────────────────────
  if (!existsSync(TGZ)) throw new Error('找不到 tgz：' + TGZ)
  const bytes = readFileSync(TGZ)
  const actualSha = sha256(bytes)
  report.steps.file = { name: basename(TGZ), bytes: statSync(TGZ).size, sha256: actualSha }

  // ── ② 解析 ref ────────────────────────────────────────────────────
  let commit = null
  try {
    commit = execFileSync('git', ['rev-parse', REF + '^{commit}'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { /* 落到下面的判定 */ }
  report.steps.ref = { ref: REF, commit, resolved: Boolean(commit) }
  if (!commit) throw new Error(`git 里解析不到 ${REF}（仓库：${REPO}）——先把 tag 推上去再核对`)

  // tag 里的文件清单（用来把 `files` 声明展开成具体路径）
  const tagFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, 'po06'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .map((p) => p.replace(/^po06\//, ''))

  // ── ③ 成员集合 == tag 内 `files` 声明 ──────────────────────────────
  const pkgBuf = gitShow(REPO, commit, 'po06/package.json')
  if (!pkgBuf) throw new Error('tag 里没有 po06/package.json')
  const tagPkg = JSON.parse(pkgBuf.toString('utf8'))
  const declared = declaredPaths(tagPkg)
  const { want, missingInTag } = expectedFromDeclared(declared, tagFiles)
  const members = tarMembers(TGZ)
  const memberRel = members.map((m) => m.replace(/^package\//, ''))
  const wrongPrefix = members.filter((m) => !m.startsWith('package/'))
  const missing = [...want].filter((f) => !memberRel.includes(f)).sort()
  const extra = memberRel.filter((f) => !want.has(f)).sort()
  report.steps.contentSet = {
    declared, count: members.length, missing, extra, wrongPrefix, missingInTag,
    libCount: memberRel.filter((f) => /^lib\/.*\.js$/.test(f)).length,
    hasBundleLayer: memberRel.includes('cordis.patch.yml'),
    hasHoldout: memberRel.some((f) => /^eval\/HOLDOUT-v\d+\.md$/.test(f)),
    hasStrayEvalFiles: memberRel.some((f) => f.startsWith('eval/') && !/^eval\/HOLDOUT-v\d+\.md$/.test(f)),
    hasTestDir: memberRel.some((f) => f.startsWith('test/')),
    hasScriptsDir: memberRel.some((f) => f.startsWith('scripts/')),
  }

  // ── ④ 逐成员字节比对 ───────────────────────────────────────────────
  // 差异分两种，**分开记**：`exact` = 字节相等（唯一无条件通过的情形）；
  // `normalized-lf` = 仅换行风格不同（git 的 autocrlf 会把工作区写成 CRLF，
  //   而包是从工作区打的 ⇒ 内容其实一致）。这种**不算失败但要显示出来**，
  //   免得把"换行不同"和"代码不同"混为一谈。
  const diffs = []
  const normalized = []
  const missingInTagFiles = []
  for (const rel of memberRel) {
    if (rel === 'package.json') {
      // 也逐字节比：包里的 package.json 必须就是 tag 里那份
      const inTag = gitShow(REPO, commit, 'po06/package.json')
      const inTgz = tarExtract(TGZ, 'package/package.json')
      if (sha256(inTag) !== sha256(inTgz)) {
        const a = inTag.toString('utf8').replace(/\r\n/g, '\n')
        const b = inTgz.toString('utf8').replace(/\r\n/g, '\n')
        if (a === b) normalized.push(rel)
        else diffs.push(rel)
      }
      continue
    }
    const inTag = gitShow(REPO, commit, 'po06/' + rel)
    if (!inTag) { missingInTagFiles.push(rel); continue }
    const inTgz = tarExtract(TGZ, 'package/' + rel)
    if (sha256(inTag) === sha256(inTgz)) continue
    const a = inTag.toString('utf8').replace(/\r\n/g, '\n')
    const b = inTgz.toString('utf8').replace(/\r\n/g, '\n')
    if (a === b) normalized.push(rel)
    else diffs.push(rel)
  }
  report.steps.byteEqual = { compared: memberRel.length, diffs, normalized, missingInTagFiles }

  // ── ⑤ 版本四处一致：tag 名 / 包内版本 / 文件名 ─────────────────────
  const tagVersion = String(tagPkg.version || '')
  const tagAsVersion = REF.startsWith('v') ? REF.slice(1) : null
  const expectedFile = `${String(tagPkg.name || '').replace(/^@/, '').replace(/\//g, '-')}-${tagVersion}.tgz`
  report.steps.version = {
    packageVersion: tagVersion,
    tagVersion: tagAsVersion,
    fileVersion: (basename(TGZ).match(/-(\d+\.\d+\.\d+[^.]*(?:\.[^.]*)*)\.tgz$/) || [])[1] || null,
    expectedFile,
    fileMatchesExpected: basename(TGZ) === expectedFile,
    tagMatchesPackage: tagAsVersion === null ? null : tagAsVersion === tagVersion,
  }

  // ── ⑥ checklist 里登记的 sha256（完整或缩写）必须与实测一致 ─────────
  let recorded = null
  if (existsSync(CHECKLIST)) {
    const text = readFileSync(CHECKLIST, 'utf8')
    const line = text.split('\n').find((l) => l.includes(basename(TGZ)))
    const full = line && line.match(/\b([0-9a-f]{64})\b/)
    const short = line && line.match(/\b([0-9a-f]{8})…([0-9a-f]{5})\b/)
    if (full) recorded = { kind: 'full', value: full[1], match: full[1] === actualSha }
    else if (short) recorded = { kind: 'short', value: short[1] + '…' + short[2], match: actualSha.startsWith(short[1]) && actualSha.endsWith(short[2]) }
    else recorded = { kind: 'none', value: null, match: null, note: 'checklist 里这一行没有登记 sha256（不影响判定，但发布时应登记）' }
    report.steps.recordedSha = recorded
  } else {
    report.steps.recordedSha = { kind: 'no-checklist', value: null, match: null }
  }

  // ── 判定 ───────────────────────────────────────────────────────────
  const cs = report.steps.contentSet
  const v = report.steps.version
  report.ok = cs.missing.length === 0
    && cs.extra.length === 0
    && cs.wrongPrefix.length === 0
    && cs.missingInTag.length === 0
    && cs.libCount > 0
    && cs.hasBundleLayer
    && cs.hasHoldout
    && !cs.hasStrayEvalFiles
    && !cs.hasTestDir
    && !cs.hasScriptsDir
    && report.steps.byteEqual.diffs.length === 0
    && report.steps.byteEqual.missingInTagFiles.length === 0
    && v.fileMatchesExpected
    && (v.tagMatchesPackage === null || v.tagMatchesPackage === true)
    && (report.steps.recordedSha.match === null || report.steps.recordedSha.match === true)
  report.verdict = report.ok
    ? `PASS: ${basename(TGZ)} 与 ${REF}（${String(commit).slice(0, 8)}）逐字节一致——`
      + `${cs.count} 个成员、${cs.libCount} 个 lib 模块；版本四处一致；`
      + `checklist 登记的 sha256 ${report.steps.recordedSha.kind === 'none' ? '未登记（建议登记）' : '一致'}`
      + (report.steps.byteEqual.normalized.length > 0 ? `；⚠ ${report.steps.byteEqual.normalized.length} 个文件仅换行风格不同（已归一后一致）` : '')
    : 'FAIL: 见各步骤字段（tgz 与 tag / 版本 / 登记值之间有对不上的地方）'
} catch (e) {
  report.error = String((e && e.stack) || e)
  report.verdict = 'ERROR: ' + String((e && e.message) || e)
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const s = report.steps
  console.log('# 发布产物核对：' + basename(TGZ) + '  ⇄  ' + REF)
  console.log('')
  console.log('- 文件：' + (s.file ? `${s.file.name}  ${s.file.bytes} 字节  sha256 ${s.file.sha256}` : '(缺)'))
  console.log('- ref ：' + (s.ref && s.ref.resolved ? s.ref.commit : '解析失败'))
  if (s.contentSet) {
    const c = s.contentSet
    console.log(`- 成员：${c.count} 个（lib ${c.libCount}）｜多 ${c.extra.length} ｜少 ${c.missing.length} ｜声明缺 ${c.missingInTag.length}`)
    if (c.extra.length) console.log('  · 多出来的：' + c.extra.join(', '))
    if (c.missing.length) console.log('  · 少了的  ：' + c.missing.join(', '))
  }
  if (s.byteEqual) {
    console.log(`- 字节：比了 ${s.byteEqual.compared} 个，不同 ${s.byteEqual.diffs.length}`
      + (s.byteEqual.normalized.length ? `，仅换行不同 ${s.byteEqual.normalized.length}` : ''))
    if (s.byteEqual.diffs.length) console.log('  · 内容不同的：' + s.byteEqual.diffs.join(', '))
  }
  if (s.version) console.log('- 版本：包内 ' + s.version.packageVersion + ' ｜ tag ' + s.version.tagVersion
    + ' ｜ 文件名 ' + (s.version.fileMatchesExpected ? '与 name+version 相符' : '应为 ' + s.version.expectedFile))
  if (s.recordedSha) console.log('- 登记：' + (s.recordedSha.kind === 'none' || s.recordedSha.kind === 'no-checklist'
    ? 'checklist 未登记 sha256' : `${s.recordedSha.value} → ${s.recordedSha.match ? '一致' : '**不一致**'}`))
  console.log('')
  console.log(report.verdict)
}
process.exit(report.ok ? 0 : 1)
