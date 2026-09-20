// 0.6 发版前自检：包清单 / 版本一致性 / 全量测试 / 产物哈希清单
//
// 存在理由（来自 P0 实测的两个真实事故）：
//   · 本地版本目录的 lib 曾被批量覆盖，导致"目录名不再代表版本"（P0-D1）；
//   · 运行实例路径与 profile 依赖曾经互相矛盾（P0-D2）。
// 所以发版前必须能把"源码 → 清单 → 产物"三者对上，且**每一步都有哈希**。
//
// 用法：node po06/scripts/check-release.mjs [--json]
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dirname, '..')          // po06/
const REPO = join(ROOT, '..')                          // 仓库根
const asJson = process.argv.includes('--json')

const problems = []
const notes = []
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const shaFile = (p) => sha(readFileSync(p))

function walk(dir, base = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}

// ── 1. package.json 基本字段 ────────────────────────────────────────
const pkgPath = join(ROOT, 'package.json')
if (!existsSync(pkgPath)) { problems.push('缺少 po06/package.json'); report() }
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

if (pkg.name !== '@dsh-external/dsh-po06') {
  problems.push('包名与预期不符：' + String(pkg.name))
}
if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
  problems.push('版本号不是可解析的三段式：' + String(pkg.version))
}
if (pkg.type !== 'module') problems.push('package.json 缺 "type":"module"')

// ── 2. 入口存在 ─────────────────────────────────────────────────────
const main = pkg.main || './lib/index.js'
if (!existsSync(join(ROOT, main))) problems.push('main 指向的文件不存在：' + main)
const exp = pkg.exports && pkg.exports['.'] && (pkg.exports['.'].default || pkg.exports['.'])
const expPath = typeof exp === 'string' ? exp : null
if (expPath && !existsSync(join(ROOT, expPath))) problems.push('exports["."] 指向的文件不存在：' + expPath)

// ── 3. files 清单与实际文件对得上 ───────────────────────────────────
const files = Array.isArray(pkg.files) ? pkg.files : null
if (!files) {
  notes.push('package.json 未声明 files：npm pack 会把不该进包的东西一起打进去（含测试与脚本）')
} else {
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) problems.push('files 里声明的路径不存在：' + f)
  }
}

// ── 4. lib/ 下的每个文件都必须被 files 覆盖（否则打包会漏文件）──────
const libFiles = walk(join(ROOT, 'lib')).map((f) => 'lib/' + f)
if (files) {
  const covered = (rel) => files.some((f) => rel === f || rel.startsWith(f.replace(/\/$/, '') + '/'))
  const missing = libFiles.filter((f) => !covered(f))
  if (missing.length > 0) problems.push('lib/ 下有文件未被 files 覆盖（打包会漏）：' + missing.join(', '))
}

// ── 5. 版本一致性：README / 代码内版本常量 / package.json ──────────
const readmePath = join(ROOT, 'README.md')
if (!existsSync(readmePath)) notes.push('缺 po06/README.md（发布时应说明版本、已验证项、未验证项、回滚方式）')
else {
  const rmd = readFileSync(readmePath, 'utf8')
  if (!rmd.includes(pkg.version)) notes.push('README 里没有出现当前版本号 ' + pkg.version)
}

// ── 6. 模块契约版本常量（不是包版本，但必须存在且可读）─────────────
const contractVersions = {}
for (const [name, rel] of Object.entries({
  interpreter: 'lib/interpreter.js',
  verifierHtml: 'lib/verifier-html.js',
})) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) { problems.push('缺模块：' + rel); continue }
  const src = readFileSync(p, 'utf8')
  const m = src.match(/version:\s*'([^']+)'/) || src.match(/VERSION\s*=\s*'([^']+)'/)
  contractVersions[name] = m ? m[1] : null
  if (!m) notes.push(rel + ' 没有可识别的版本常量（审计时需要知道用的是哪一版契约）')
}

// ── 7. 全量测试 ─────────────────────────────────────────────────────
const testDir = join(ROOT, 'test')
const suites = existsSync(testDir)
  ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort()
  : []
const testResults = {}
const testFailures = []
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(testDir, s)], { encoding: 'utf8', cwd: REPO, maxBuffer: 2e7 })
  try {
    const j = JSON.parse(r.stdout)
    testResults[s] = { pass: j.pass, fail: j.fail, skipped: j.skipped || 0 }
    if (j.fail > 0) testFailures.push(s + ' → ' + j.fail + ' 失败：' + (j.failures || []).map((f) => f.name).join('; '))
  } catch {
    testResults[s] = { error: 'unparsable-output', exit: r.status }
    testFailures.push(s + ' → 输出无法解析（exit=' + r.status + '）')
  }
}
if (testFailures.length > 0) problems.push(...testFailures.map((t) => '测试失败：' + t))

// 变异检验单独跑（更慢，但它是"测试会不会咬人"的唯一证据）
const mutPath = join(testDir, 'mutate-check.cjs')
let mutation = null
if (existsSync(mutPath)) {
  const r = spawnSync(process.execPath, [mutPath], { encoding: 'utf8', cwd: REPO, maxBuffer: 2e7 })
  try {
    const j = JSON.parse(r.stdout)
    mutation = { total: j.mutants.length, sourceFiles: j.sourceFiles || null, missed: j.mutants.filter((m) => m.caught !== true).map((m) => m.name), verdict: j.verdict }
    if (mutation.missed.length > 0) problems.push('变异未被捕获：' + mutation.missed.join(', '))
  } catch {
    mutation = { error: 'unparsable-output', exit: r.status }
    problems.push('变异检验输出无法解析（exit=' + r.status + '）')
  }
}

// ── 7b. 打包产物自足性（EV-0110）────────────────────────────────────
// 为什么进发版门：这条演练**红了好几轮却没人知道**——因为没有任何东西会跑它。
// **一个没人跑的检查不是检查。** 它只要约 1 秒（npm pack + tar + 仓库外 import）。
let packaging = null
const drillPath = join(ROOT, 'scripts', 'install-drill.mjs')
if (existsSync(drillPath)) {
  const r = spawnSync(process.execPath, [drillPath], { encoding: 'utf8', cwd: REPO, maxBuffer: 2e7 })
  try {
    const j = JSON.parse(r.stdout)
    packaging = { ok: j.ok === true, exit: r.status, verdict: j.verdict }
    if (!packaging.ok) {
      problems.push('打包产物自足性演练未通过：' + String(j.verdict || '').slice(0, 160))
    }
  } catch {
    packaging = { error: 'unparsable-output', exit: r.status }
    problems.push('打包演练输出无法解析（exit=' + r.status + '）')
  }
}

// ── 0) 清扫陈旧临时目录（EV-0129）────────────────────────────────────
// 单测 fixture 靠 `process.on('exit')` 清理，而**进程被强杀时它不会跑**——
// "强杀"在本项目里是**我自己反复犯的操作习惯**（把测试输出管道给会提前关闭管道的消费者）。
// 归因清楚了就用机制兜：开跑前清掉 tmpdir 里够旧的、我们自己的前缀（10 分钟以上，
// 绝不碰正在跑的测试）。清扫失败**不算阻断**（它只是磁盘卫生）。
let tempSweep = null
try {
  const { sweepStaleTemp } = await import('../lib/temp-sweep.js')
  tempSweep = sweepStaleTemp()
  if (tempSweep.removed.length > 0) {
    console.log('清扫陈旧临时目录：' + tempSweep.removed.length + ' 个（' + tempSweep.removed.slice(0, 5).join(', ')
      + (tempSweep.removed.length > 5 ? ', …' : '') + '）')
  }
  if (tempSweep.errors.length > 0) notes.push('临时目录清扫有 ' + tempSweep.errors.length + ' 处失败（不影响判定）')
} catch (e) {
  notes.push('临时目录清扫跳过：' + String((e && e.message) || e).slice(0, 120))
}

// 文档漂移（EV-0103）：状态类文档里的数字必须与产物一致。
// 为什么放进发版门：本项目**反复**出现"文档写了过期数字"（测试数、变异数、预算都出过），
// 而每次都是靠人偶然看到才修——那等于没有保障。
// 只查 README / 发布检查表 / S1 报告；**EVIDENCE 与 CHECKPOINT 是逐轮日志**，
// 里面的旧数字是**正确的历史记录**，不属漂移（口径见 check-docs.mjs 头部）。
let docs = null
const docPath = join(ROOT, 'scripts', 'check-docs.mjs')
if (existsSync(docPath)) {
  // 把**本轮**实测计数传进去：否则 check-docs 比的是 release-check.json 里**上一轮**的值，
  // 本次刚涨上去的计数当轮查不出来（EV-0107，本轮真的撞上：门禁 PASS 而文档已过期）。
  const passTotal = Object.values(testResults).reduce((s, t) => s + (t.pass || 0), 0)
  // lib 模块数也由门**自己数**再传（EV-0132）：这份数字在 README 里漂过（22 → 27）没人发现。
  const libModules = existsSync(join(ROOT, 'lib'))
    ? readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).length
    : 0
  const r = spawnSync(process.execPath, [docPath, '--strict',
    '--suites', String(suites.length),
    '--pass', String(passTotal),
    '--mutants', String((mutation && mutation.total) || 0),
    '--source-files', String((mutation && mutation.sourceFiles) || 0),
    '--lib-modules', String(libModules)], { encoding: 'utf8', cwd: REPO, maxBuffer: 2e7 })
  docs = { ok: r.status === 0, exit: r.status,
    output: String(r.stdout || '').split('\n').filter(Boolean).slice(0, 14) }
  if (r.status !== 0) {
    problems.push('文档数字与产物不一致（跑 `node po06/scripts/check-docs.mjs` 看明细；'
      + '若那处属于**历史叙述**而非现状说明，请改写措辞，而不要关掉这个检查）')
  }
}

// ── 8. 产物哈希清单 ─────────────────────────────────────────────────
const manifest = {
  at: new Date().toISOString(),
  package: { name: pkg.name, version: pkg.version },
  contractVersions,
  files: {},
}
for (const f of libFiles) manifest.files[f] = { sha256: shaFile(join(ROOT, f)), bytes: statSync(join(ROOT, f)).size }
manifest.packageJsonSha256 = shaFile(pkgPath)
manifest.tests = testResults
manifest.mutation = mutation
manifest.packaging = packaging
manifest.problems = problems
manifest.notes = notes
manifest.ok = problems.length === 0

const outDir = join(ROOT, 'eval')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'release-check.json'), JSON.stringify(manifest, null, 2), 'utf8')

function report() {
  if (asJson) { console.log(JSON.stringify(manifest, null, 2)); process.exit(manifest.ok ? 0 : 1) }
  console.log('=== 0.6 发版前自检 ===')
  console.log('包：' + pkg.name + ' @ ' + pkg.version)
  const totalPass = Object.values(testResults).reduce((s, r) => s + (r.pass || 0), 0)
  const totalFail = Object.values(testResults).reduce((s, r) => s + (r.fail || 0), 0)
  console.log('测试：' + suites.length + ' 套 / pass ' + totalPass + ' / fail ' + totalFail)
  if (mutation && !mutation.error) console.log('变异：' + mutation.total + ' 个 / 漏捕 ' + mutation.missed.length)
  if (packaging) console.log('打包自足：' + (packaging.ok ? 'PASS' : 'FAIL') + (packaging.verdict ? '——' + String(packaging.verdict).slice(0, 90) : ''))
  if (notes.length > 0) { console.log('\n--- 提示 ---'); for (const n of notes) console.log('· ' + n) }
  if (problems.length > 0) { console.log('\n--- 阻断项 ---'); for (const p of problems) console.log('✗ ' + p) }
  console.log('\n判定：' + (manifest.ok ? 'PASS（可进入打包）' : 'FAIL（' + problems.length + ' 项阻断）'))
  console.log('清单已写入 po06/eval/release-check.json')
  process.exit(manifest.ok ? 0 : 1)
}
report()
