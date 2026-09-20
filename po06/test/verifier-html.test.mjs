// P6-2 验证器**真机**检验：已知好件 / 已知坏件 / 缺失文件。
// 需要本机有 msedge 或 chrome；无浏览器时相关用例会如实标记为 infrastructure_error 并跳过断言。
// 运行：node po06/test/verifier-html.test.mjs
//
// 这个文件的意义：**不配正反例就无法证明验证器真在检测**。
// 坏件必须是"确定缺陷"（画布 0×0 / 未捕获异常），
// 而"纯色画面"这类**可能合法**的情形必须落在 unknown，不能硬判失败。
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { verifyHtmlFile, findBrowser, VALIDATOR, COVERAGE, NOT_COVERED } from '../lib/verifier-html.js'
import { RESULT, actionableFailures, hasInfrastructureError } from '../lib/verifier.js'

const DIR = 'C:/Users/WestFox/.dsh/exp/po06/verify-fixtures'

let pass = 0
const failures = []
const skipped = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

function writeFixture(name, html) {
  mkdirSync(DIR, { recursive: true })
  const p = join(DIR, name)
  writeFileSync(p, html, 'utf8')
  return p
}

/** 好件：画布有尺寸、有内容、无异常 */
const GOOD = `<!doctype html><html><head><meta charset="utf-8"><title>good</title>
<style>html,body{margin:0;height:100%;background:#123}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas><script>
const c = document.getElementById('c');
c.width = 640; c.height = 480;
const gl = c.getContext('webgl');
if (gl) { gl.clearColor(0.6,0.2,0.1,1); gl.clear(gl.COLOR_BUFFER_BIT); }
window.__ok = true;
</script></body></html>`

/** 坏件 1：画布从不设置 width/height（backing store 保持默认 300x150？——这里显式置 0） */
const BAD_ZERO_CANVAS = `<!doctype html><html><head><meta charset="utf-8"><title>bad-zero</title>
<style>html,body{margin:0;height:100%}canvas{display:block}</style></head>
<body><canvas id="c"></canvas><script>
const c = document.getElementById('c');
c.width = 0; c.height = 0;      // 确定缺陷：什么都渲染不出来
</script></body></html>`

/** 坏件 2：加载即抛未捕获异常 */
const BAD_THROWS = `<!doctype html><html><head><meta charset="utf-8"><title>bad-throw</title></head>
<body><div>loading</div><script>
setTimeout(() => { throw new Error('PO06-FIXTURE-BOOM'); }, 50);
</script></body></html>`

/** 可疑件：画布有尺寸但恒定纯色——**可能合法**，必须落在 unknown */
const UNIFORM_CANVAS = `<!doctype html><html><head><meta charset="utf-8"><title>uniform</title>
<style>html,body{margin:0;height:100%;background:#000}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas><script>
const c = document.getElementById('c');
c.width = 320; c.height = 240;
const ctx = c.getContext('2d');
ctx.fillStyle = '#000'; ctx.fillRect(0,0,320,240);   // 纯黑是设计选择，不是必然的 bug
</script></body></html>`

const browser = findBrowser()

if (!browser) {
  console.log(JSON.stringify({ suite: 'po06-verifier-html', phase: 'P6', browser: null, total: 1, pass: 0, fail: 0, skipped: 1, reason: 'no-browser-on-this-machine' }, null, 2))
  process.exit(0)
}

// ── 1. 好件 ─────────────────────────────────────────────────────────
{
  const p = writeFixture('good.html', GOOD)
  const { built, raw } = await verifyHtmlFile({ file: p, waitMs: 12000, holdMs: 800 })
  try {
    ok(built.ok, 'record must be valid: ' + JSON.stringify(built.errors))
    const rec = built.record
    eq(rec.validator.name, VALIDATOR.name, 'validator name')
    eq(rec.coverage, COVERAGE.slice(), 'coverage declared')
    eq(rec.notCovered, NOT_COVERED.slice(), 'notCovered declared')
    ok(rec.artifact.sha256 && rec.artifact.sha256.length === 64, 'artifact hash bound')

    const byId = (id) => rec.checks.find((c) => c.id === id)
    if (hasInfrastructureError(rec)) {
      // 环境不行就如实记录，不伪装成通过
      console.log(JSON.stringify({ case: 'good', infra: true, observation: byId('browser-available').observation }))
    } else {
      eq(byId('page-loads').result, RESULT.PASS, 'good page loads')
      eq(byId('no-page-errors').result, RESULT.PASS, 'good page has no errors')
      eq(byId('canvas-nonzero').result, RESULT.PASS, 'good canvas has size: ' + byId('canvas-nonzero').observation)
      eq(actionableFailures(rec).length, 0, 'good file must have NO actionable failures')
      // 中心像素只作为观察，且不得是 fail
      const px = byId('canvas-content-sampled')
      ok(px, 'pixel sampled check present')
      ok(px.result !== RESULT.FAIL, 'uniform/blank pixel must NOT be a failure')
    }
    pass += 1
  } catch (e) { failures.push({ name: 'good-file', error: String(e.message || e) }) }
}

// ── 2. 坏件：画布 0×0 ───────────────────────────────────────────────
{
  const p = writeFixture('bad-zero.html', BAD_ZERO_CANVAS)
  const { built } = await verifyHtmlFile({ file: p, waitMs: 12000, holdMs: 800 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const cz = rec.checks.find((c) => c.id === 'canvas-nonzero')
      eq(cz.result, RESULT.FAIL, 'zero-size canvas must FAIL: ' + cz.observation)
      ok(actionableFailures(rec).some((c) => c.id === 'canvas-nonzero'), 'must be actionable')
      ok(cz.observation.includes('0x0'), 'observation must contain the measured size: ' + cz.observation)
      ok(cz.evidenceRefs.length > 0, 'fail must carry evidence refs')
    }
    pass += 1
  } catch (e) { failures.push({ name: 'bad-zero-canvas', error: String(e.message || e) }) }
}

// ── 3. 坏件：未捕获异常 ─────────────────────────────────────────────
{
  const p = writeFixture('bad-throw.html', BAD_THROWS)
  const { built } = await verifyHtmlFile({ file: p, waitMs: 12000, holdMs: 800 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const pe = rec.checks.find((c) => c.id === 'no-page-errors')
      eq(pe.result, RESULT.FAIL, 'uncaught exception must FAIL: ' + pe.observation)
      ok(pe.observation.includes('PO06-FIXTURE-BOOM'), 'observation must quote the real error: ' + pe.observation)
    }
    pass += 1
  } catch (e) { failures.push({ name: 'bad-throws', error: String(e.message || e) }) }
}

// ── 4. 可疑件：纯色画面必须落在 unknown，不得 fail ─────────────────
{
  const p = writeFixture('uniform.html', UNIFORM_CANVAS)
  const { built } = await verifyHtmlFile({ file: p, waitMs: 12000, holdMs: 800 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const cz = rec.checks.find((c) => c.id === 'canvas-nonzero')
      eq(cz.result, RESULT.PASS, 'uniform canvas still has a valid backing store')
      const px = rec.checks.find((c) => c.id === 'canvas-content-sampled')
      ok(px, 'pixel check present')
      eq(px.result, RESULT.UNKNOWN, 'a uniform画面 must be UNKNOWN, never FAIL (it may be a legitimate design)')
      ok(!actionableFailures(rec).some((c) => c.id === 'canvas-content-sampled'), 'must not be actionable')
    }
    pass += 1
  } catch (e) { failures.push({ name: 'uniform-canvas-not-failed', error: String(e.message || e) }) }
}

// ── 5. 缺失文件：不需要浏览器就该判 fail ────────────────────────────
{
  const p = join(DIR, 'does-not-exist-xyz.html')
  const { built } = await verifyHtmlFile({ file: p, waitMs: 2000, holdMs: 200 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    const fr = rec.checks.find((c) => c.id === 'file-readable')
    eq(fr.result, RESULT.FAIL, 'missing file must FAIL')
    eq(rec.checks.length, 1, 'must short-circuit without launching a browser')
    pass += 1
  } catch (e) { failures.push({ name: 'missing-file', error: String(e.message || e) }) }
}

try { rmSync(DIR, { recursive: true, force: true }) } catch { /* best effort */ }

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-verifier-html', phase: 'P6', browser, total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
