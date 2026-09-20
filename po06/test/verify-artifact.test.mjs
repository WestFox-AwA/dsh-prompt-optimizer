// P8 · 发布产物核对（`scripts/verify-artifact.mjs`）的单测。
//
// 运行：node po06/test/verify-artifact.test.mjs
//
// 为什么给它配单测（EV-0133）：这个脚本存在的理由，就是**替掉"我手工比过一次"**。
// 一个"永远说 PASS"的核对器比没有核对器更糟——它会让人把没验过的发布当成验过的。
// 所以这里每一种**真实会发生的错**都要有一个用例证明它会红：
// 内容被改、多夹带文件、少了声明文件、版本对不上、checklist 登记的哈希不是这个文件、
// tag 根本不存在。另加一条**基线**（全对 ⇒ 必须绿），否则"全都红"也能骗过测试。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'verify-artifact.mjs')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const GITC = ['-c', 'user.name=po06-test', '-c', 'user.email=po06-test@example.invalid']
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * 造一个**真 git 仓库**的迷你 po06 包（与真实 `files` 同形），打 tag。
 * @returns {repo, tag, version, name, tgzName, files}
 */
function fixture({ version = '1.2.3', name = '@dsh-external/dsh-po06', tag = null } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'po06-verify-'))
  DIRS.push(repo)
  const pkgDir = join(repo, 'po06')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  mkdirSync(join(pkgDir, 'eval'), { recursive: true })
  const files = ['lib', 'cordis.patch.yml', 'README.md', 'eval/HOLDOUT-v1.md']
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version, files }, null, 2) + '\n')
  writeFileSync(join(pkgDir, 'lib', 'index.js'), 'export const name = "po06"\nexport const apply = () => {}\n')
  writeFileSync(join(pkgDir, 'lib', 'wire.js'), 'export const tick = (n) => n + 1\n')
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), '# bundle layer\n- id: po06\n')
  writeFileSync(join(pkgDir, 'README.md'), '# po06 fixture\n\n装法：见上。\n')
  writeFileSync(join(pkgDir, 'eval', 'HOLDOUT-v1.md'), '## 封存题集 v1\n\n- H-01 …\n')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', [...GITC, 'add', '-A'], { cwd: repo })
  execFileSync('git', [...GITC, 'commit', '-q', '-m', 'fixture'], { cwd: repo })
  const tagName = tag || ('v' + version)
  execFileSync('git', [...GITC, 'tag', tagName], { cwd: repo })
  const tgzName = `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`
  return { repo, tag: tagName, version, name, tgzName, files, pkgDir }
}

/**
 * 从工作区打一个 tgz（结构 `package/...`，与 npm pack 同形）。
 * @param opts.omit 成员相对路径（`lib/wire.js`）——模拟"声明了却没打进包"
 * @param opts.extra {relPath: text} ——模拟夹带
 * @param opts.modify {relPath: text} ——模拟内容被改
 * @param opts.asName 覆盖 tgz 文件名
 */
function buildTgz(fx, opts = {}) {
  const stage = mkdtempSync(join(tmpdir(), 'po06-stage-'))
  DIRS.push(stage)
  const pkgStage = join(stage, 'package')
  mkdirSync(join(pkgStage, 'lib'), { recursive: true })
  mkdirSync(join(pkgStage, 'eval'), { recursive: true })
  const all = ['package.json', 'lib/index.js', 'lib/wire.js', 'cordis.patch.yml', 'README.md', 'eval/HOLDOUT-v1.md']
  for (const rel of all) {
    if ((opts.omit || []).includes(rel)) continue
    const text = (opts.modify || {})[rel] ?? readFileSync(join(fx.pkgDir, rel), 'utf8')
    writeFileSync(join(pkgStage, rel), text)
  }
  for (const [rel, text] of Object.entries(opts.extra || {})) {
    mkdirSync(dirname(join(pkgStage, rel)), { recursive: true })
    writeFileSync(join(pkgStage, rel), text)
  }
  const out = join(stage, opts.asName || fx.tgzName)
  execFileSync('tar', ['-czf', out, '-C', stage, 'package'])
  return { path: out, sha256: sha256(readFileSync(out)), bytes: readFileSync(out).length }
}

/** 跑核对器；返回 {exit, report}。 */
function run({ repo, tag, tgz, checklist }) {
  const args = [SCRIPT, '--tag', tag, '--tgz', tgz, '--repo', repo, '--json']
  if (checklist) args.push('--checklist', checklist)
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1e8 })
  let report = null
  try { report = JSON.parse(r.stdout) } catch { /* 交给用例断言 */ }
  return { exit: r.status, report, stdout: String(r.stdout), stderr: String(r.stderr) }
}

/** 写一份 checklist（可选登记 sha256）。 */
function checklistFor(fx, { tgzName, sha = null, short = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'po06-check-'))
  DIRS.push(dir)
  const p = join(dir, 'RELEASE-CHECKLIST.md')
  const shaText = sha ? `，sha256 \`${sha}\`` : (short ? `，sha256 \`${short}\`` : '')
  writeFileSync(p, `# checklist\n\n| 2 打包 + sha256 | ✅ | \`${tgzName}\`（**133.4 KB / 32 个文件**${shaText}） |\n`)
  return p
}

// ── ① 基线：全对必须绿（否则"全都红"也能骗过测试）──────────────────────
t('基线：包与 tag 逐字节一致、版本四处一致、登记哈希相符 ⇒ PASS / exit 0', () => {
  const fx = fixture()
  const tgz = buildTgz(fx)
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 0, '应通过；输出：\n' + r.stdout + r.stderr)
  eq(r.report.ok, true, 'ok 应为 true')
  eq(r.report.steps.contentSet.count, 6, '成员数')
  eq(r.report.steps.byteEqual.diffs, [], '不应有内容差异')
  eq(r.report.steps.recordedSha.match, true, '登记哈希应一致')
  ok(/^PASS:/.test(r.report.verdict), 'verdict 以 PASS 开头：' + r.report.verdict)
})

// ── ② 内容被改 ⇒ 必须点名那个文件（这正是"我手工比过一次"要替掉的东西）──
t('包里某个文件内容被改 ⇒ FAIL 且点名该文件', () => {
  const fx = fixture()
  const tgz = buildTgz(fx, { modify: { 'lib/index.js': 'export const name = "po06"\nexport const apply = () => { /*被改*/ }\n' } })
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  eq(r.report.steps.byteEqual.diffs, ['lib/index.js'], '要点名 lib/index.js')
  ok(/^FAIL:/.test(r.report.verdict), 'verdict 以 FAIL 开头：' + r.report.verdict)
})

// ── ③ 夹带未声明文件 ⇒ FAIL（`files` 是白名单，不是建议）──────────────
t('夹带未声明文件（test/secret.test.mjs）⇒ FAIL，且报"多出来的"', () => {
  const fx = fixture()
  const tgz = buildTgz(fx, { extra: { 'test/secret.test.mjs': '// 不该进包\n' } })
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  eq(r.report.steps.contentSet.extra, ['test/secret.test.mjs'], '要点名多出来的文件')
  eq(r.report.steps.contentSet.hasTestDir, true, 'test/ 必须被认出来')
})

// ── ④ 声明了却没打进包 ⇒ FAIL（"源码树全绿、装出来少一个模块"那类事故）──
t('声明了但包里缺失文件（lib/wire.js）⇒ FAIL，且报"少了的"', () => {
  const fx = fixture()
  const tgz = buildTgz(fx, { omit: ['lib/wire.js'] })
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  eq(r.report.steps.contentSet.missing, ['lib/wire.js'], '要点名少了的文件')
})

// ── ⑤ 版本对不上：tag 名 vs 包内 version（"beta.3 的包配 beta.4 的说明"那类）──
t('tag 名与包内 version 不一致 ⇒ FAIL', () => {
  const fx = fixture({ version: '1.2.3', tag: 'v9.9.9' })
  const tgz = buildTgz(fx)
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  eq(r.report.steps.version.tagMatchesPackage, false, 'tag 与 package version 必须被判不一致')
})

// ── ⑥ 文件名与 name+version 不符 ⇒ FAIL ──────────────────────────────
t('tgz 文件名与包内 name+version 不符 ⇒ FAIL，并给出应有的文件名', () => {
  const fx = fixture()
  const tgz = buildTgz(fx, { asName: 'wrong-name-0.0.0.tgz' })
  const cl = checklistFor(fx, { tgzName: 'wrong-name-0.0.0.tgz', sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  eq(r.report.steps.version.fileMatchesExpected, false, '文件名必须被判不符')
  eq(r.report.steps.version.expectedFile, fx.tgzName, '应给出期望文件名：' + r.report.steps.version.expectedFile)
})

// ── ⑦ checklist 登记的哈希不是这个文件 ⇒ FAIL（发布无法复核）──────────
t('checklist 登记的 sha256 与实测不符 ⇒ FAIL（缩写形式同样要比）', () => {
  const fx = fixture()
  const tgz = buildTgz(fx)
  const wrongFull = 'f'.repeat(64)
  const clFull = checklistFor(fx, { tgzName: fx.tgzName, sha: wrongFull })
  const r1 = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: clFull })
  eq(r1.exit, 1, '完整哈希不符应失败')
  eq(r1.report.steps.recordedSha.match, false, '应判不一致')

  const clShort = checklistFor(fx, { tgzName: fx.tgzName, short: 'deadbeef…c0ffee' === '' ? '' : 'deadbeef…abcde' })
  const r2 = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: clShort })
  eq(r2.exit, 1, '缩写哈希不符也应失败')
  eq(r2.report.steps.recordedSha.match, false, '缩写形式要判不一致')
})

// ── ⑧ 没登记哈希：不算失败（但要如实说明"未登记"）──────────────────────
t('checklist 没登记 sha256 ⇒ 不因此判失败，但记录 kind=none', () => {
  const fx = fixture()
  const tgz = buildTgz(fx)
  const cl = checklistFor(fx, { tgzName: fx.tgzName })
  const r = run({ repo: fx.repo, tag: fx.tag, tgz: tgz.path, checklist: cl })
  eq(r.exit, 0, '应通过（未登记是提示，不是错误）')
  eq(r.report.steps.recordedSha.kind, 'none', 'kind 应为 none')
})

// ── ⑨ tag 不存在 ⇒ 必须失败，而不是"没得比，那就过"────────────────────
t('tag 解析不到 ⇒ FAIL（不许把"无从核对"当成通过）', () => {
  const fx = fixture()
  const tgz = buildTgz(fx)
  const cl = checklistFor(fx, { tgzName: fx.tgzName, sha: tgz.sha256 })
  const r = run({ repo: fx.repo, tag: 'v0.0.0-nope', tgz: tgz.path, checklist: cl })
  eq(r.exit, 1, '应失败')
  ok(/解析不到/.test(String(r.report.error)), '错误要说清是 ref 解析不到：' + String(r.report.error))
})

// ── ⑩ 缺参数 ⇒ 退出码 2（与"核对失败"区分开）─────────────────────────
t('缺 --tag / --tgz ⇒ 退出码 2（用法错误 ≠ 核对不通过）', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--tag', 'v1.0.0'], { encoding: 'utf8' })
  eq(r.status, 2, '用法错误应为 2')
  ok(/缺少参数/.test(String(r.stdout)), '要说明缺什么：' + String(r.stdout))
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-verify-artifact', phase: 'P8', total, pass, fail: failures.length, failures,
  note: '把已发出的 tgz 与某个 git 提交钉在一起：成员集合、逐字节内容、版本四处、登记哈希、白名单纪律。不依赖网络、不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
