// P7 · 花钱前预检脚本（`scripts/preflight-e001.mjs`）的单测。
//
// 运行：node po06/test/preflight-e001.test.mjs
//
// 为什么必须给它配单测（EV-0118）：它的**用途是拦住一次错误的花钱**——
// 它自己要是不准，就等于"闸门看起来在，其实没拦"。最该被钉住的一条是：
// **S1 那一期测不到「约束守住」**（0/6 题适用）——那是花掉 103k **之后**才发现的事。
// 现在它必须在花钱**之前**、以退出码 2 说出来。本套件不调模型、不花钱。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'preflight-e001.mjs')
const REPO = join(HERE, '..')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'po06-pre-')); DIRS.push(d); return d }

/** 跑预检。outDir 默认给一个空临时目录（避免读到真实 home 里的缓存）。 */
function run(args = [], { outDir = null, json = false } = {}) {
  const od = outDir || tmp()
  const argv = [SCRIPT, '--out-dir', od, ...args]
  const jsonPath = join(od, 'pre.json')
  if (json) argv.push('--json', jsonPath)
  try {
    return { exit: 0, stdout: execFileSync(process.execPath, argv, { encoding: 'utf8', cwd: REPO }), outDir: od, jsonPath }
  } catch (e) {
    return { exit: e.status, stdout: String(e.stdout || ''), outDir: od, jsonPath }
  }
}

// ── ① S4：前置条件成立 ───────────────────────────────────────────────
t('S4 预检：封存可验（含负向自检）、2/2 题适用「约束守住」、退出码 0', () => {
  const r = run(['--stage', 'S4'])
  eq(r.exit, 0, 'S4 前置条件应成立；输出：\n' + r.stdout)
  ok(r.stdout.includes('负向自检'), '必须有负向自检那一行（否则"校验通过"没有意义）：\n' + r.stdout)
  ok(/本期 \*\*2\/2\*\* 题适用/.test(r.stdout), '应报 2/2 适用：\n' + r.stdout)
  ok(r.stdout.includes('H-19') && r.stdout.includes('H-20'), '应列出题号')
})

// ── ② 最关键的一条：S1 测不到「约束守住」⇒ 必须拦下来 ────────────────────
// （这本该在花那 103k **之前**就说出来）
t('S1 预检：明说"这一期测不到「约束守住」"并以退出码 2 拦住', () => {
  const r = run(['--stage', 'S1'])
  eq(r.exit, 2, 'S1 缺少该判据的适用题，应当拦住；输出：\n' + r.stdout)
  ok(r.stdout.includes('本期 **0/6** 题适用'), '应报 0/6 适用：\n' + r.stdout)
  ok(r.stdout.includes('这一期测不到「约束守住」'), '应明说测不到：\n' + r.stdout)
  ok(r.stdout.includes('不建议现在跑'), '结论必须是"不建议现在跑"：\n' + r.stdout)
  ok(r.stdout.includes('已判无效'), '应提示 H-11 已判无效：\n' + r.stdout)
})

// ── ③ 未知分期不静默退回全部 ─────────────────────────────────────────
t('未知分期 ⇒ UNKNOWN-STAGE，不静默退回全部', () => {
  const r = run(['--stage', 'S99'])
  eq(r.exit, 2, '未知分期应拒绝')
  ok(r.stdout.includes('UNKNOWN-STAGE'), '应报 UNKNOWN-STAGE：\n' + r.stdout)
})

// ── ④ 预算闸门：低于上界 ⇒ 拒绝；不低于 ⇒ 放行 ────────────────────────
t('预算低于上界 ⇒ 拦住；给足上界 ⇒ 放行', () => {
  const low = run(['--stage', 'S4', '--budget', '20000'])
  eq(low.exit, 2, '低于上界应拦住')
  ok(low.stdout.includes('预算低于上界'), '应说明原因：\n' + low.stdout)
  const enough = run(['--stage', 'S4', '--budget', '40000'])
  eq(enough.exit, 0, '给足上界应放行；输出：\n' + enough.stdout)
  ok(/判定：\*\*(execute|dry-run)\*\*/.test(enough.stdout), '应给出判定模式：\n' + enough.stdout)
})

// ── ⑤ 包缓存：说清哪些题不再花解释层的钱 ──────────────────────────────
t('包缓存：已缓存的题报"不再花钱"，未缓存的报"仍需编译"', () => {
  const od = tmp()
  mkdirSync(join(od, 'packets'), { recursive: true })
  writeFileSync(join(od, 'packets', 'H-19.md'), 'x', 'utf8')
  const r = run(['--stage', 'S4'], { outDir: od })
  ok(/不再花解释层的钱\*\*：H-19/.test(r.stdout), '应报 H-19 已缓存：\n' + r.stdout)
  ok(/仍需解释层编译：H-20/.test(r.stdout), '应报 H-20 仍需编译：\n' + r.stdout)
})

t('包目录里有缓存但**一个都不匹配本期题号** ⇒ 明确警告（别把"有缓存"读成"不花钱"）', () => {
  const od = tmp()
  mkdirSync(join(od, 'packets'), { recursive: true })
  writeFileSync(join(od, 'packets', 'H-07.md'), 'x', 'utf8')
  const r = run(['--stage', 'S4'], { outDir: od })
  ok(r.stdout.includes('一个都不匹配本期的题号'), '应给出该警告：\n' + r.stdout)
})

// ── ⑥ --json 可机器读 ────────────────────────────────────────────────
t('--json 输出结构化结果（判据适用数 / 预算判定 / 缓存清单）', () => {
  const r = run(['--stage', 'S4'], { json: true })
  const j = JSON.parse(readFileSync(r.jsonPath, 'utf8'))
  eq(j.stage, 'S4', '分期')
  eq(j.tasks, ['H-19', 'H-20'], '题号')
  eq(j.dependencyApplicable, 2, '适用题数')
  eq(j.seal.ok, true, '封存')
  eq(j.packets.needCompile, ['H-19', 'H-20'], '待编译')
  eq(j.problems, [], '不该有阻断项')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-preflight-e001', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '花钱前预检：封存（含负向自检）、判据适用性、预算闸门、包缓存、产物落盘。不调模型、不花钱。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
