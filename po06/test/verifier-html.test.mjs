// P6-2 验证器**真机**检验：已知好件 / 已知坏件 / 缺失文件。
// 需要本机有 msedge 或 chrome；无浏览器时相关用例会如实标记为 infrastructure_error 并跳过断言。
// 运行：node po06/test/verifier-html.test.mjs
//
// 这个文件的意义：**不配正反例就无法证明验证器真在检测**。
// 坏件必须是"确定缺陷"（画布 0×0 / 未捕获异常），
// 而"纯色画面"这类**可能合法**的情形必须落在 unknown，不能硬判失败。
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  verifyHtmlFile, findBrowser, VALIDATOR, COVERAGE, NOT_COVERED,
  isDomReady, hasSizedBuffer, isDefaultStretched,
} from '../lib/verifier-html.js'
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

/** 回归件：画布**从未被渲染器碰过**——后备缓冲保持 HTML 默认 300×150，却被 CSS 拉满屏。
 *  这正是 D-01 臂 D.html 的情形（也正是一次仪器误判的受害者）。 */
const NEVER_SIZED_CANVAS = `<!doctype html><html><head><meta charset="utf-8"><title>never-sized</title>
<style>html,body{margin:0;height:100%;background:#b0bed0}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas><div id="hud">操作说明</div></body></html>`

// ── 0. 停止采样的判定（**不依赖浏览器**，纯函数）────────────────────
// 这条用例的存在理由：曾因「画布尺寸非零就收工」而在 1.2s 提前退出，
// 把一个 DOM 尚未就绪的页面误判成 page-loads: fail。
// 默认 300×150 的缓冲**不是**装配成功的证据 —— 这条断言就是那个 bug 的墓碑。
{
  try {
    const def = { ready: 'loading', canvases: [{ w: 300, h: 150, cw: 1250, ch: 658 }] }
    ok(!hasSizedBuffer(def), '默认 300x150 缓冲绝不能被当作「已设置尺寸」')
    ok(!isDomReady(def), 'readyState=loading 不是就绪')
    ok(isDefaultStretched(def), '默认缓冲被 CSS 拉大必须被识别出来')

    ok(hasSizedBuffer({ ready: 'complete', canvases: [{ w: 1250, h: 658, cw: 1250, ch: 658 }] }),
      '真正设置过的缓冲才算已设置尺寸')
    ok(isDomReady({ ready: 'complete' }), 'complete 是就绪')
    ok(isDomReady({ ready: 'interactive' }), 'interactive 是就绪')

    // 合法的 300×150 画布（像素风小图，未被拉大）不算「拉伸」
    ok(!isDefaultStretched({ canvases: [{ w: 300, h: 150, cw: 300, ch: 150 }] }),
      '按原尺寸显示的 300x150 画布是合法的，不得标记为拉伸')

    // 提前收工要求「DOM 就绪 **且** 缓冲已设置」两个条件同时成立
    ok(!(isDomReady(def) && hasSizedBuffer(def)), 'D.html 那种情形绝不允许提前收工')
    pass += 1
  } catch (e) { failures.push({ name: 'sampling-stop-predicates', error: String(e.message || e) }) }
}

const browser = findBrowser()

if (!browser) {
  console.log(JSON.stringify({ suite: 'po06-verifier-html', phase: 'P6', browser: null, total: pass + failures.length + 1, pass, fail: failures.length, skipped: 1, reason: 'no-browser-on-this-machine', failures }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
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

// ── 6. 回归：从未装过尺寸的画布**不得**让采样提前收工，也**不得**被误判 ──
// 这是 D-01 臂 D.html 暴露的仪器缺陷：默认 300×150 被当成「有尺寸」→ 1.2s 就收工
// → page-loads 读到的还是 loading。修正后：必须等到 DOM 就绪 + 观察窗口用尽，
// 页面确实加载完成就该判 pass，且默认缓冲要被**如实披露**（而非静默通过）。
{
  const p = writeFixture('never-sized.html', NEVER_SIZED_CANVAS)
  const { built, raw } = await verifyHtmlFile({ file: p, waitMs: 12000, holdMs: 600, settleMs: 2400 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const byId = (id) => rec.checks.find((c) => c.id === id)

      ok(raw.samples.length >= 2,
        '默认 300x150 缓冲不得结束采样（应至少采样 2 次，实际 ' + raw.samples.length + ' 次）')

      eq(byId('page-loads').result, RESULT.PASS,
        '页面本身加载得动就必须判 pass，绝不能因提前收工读成 loading：' + byId('page-loads').observation)
      ok(byId('page-loads').observation.includes('等待'),
        'observation 必须写出真实等待时长，否则 fail 无法区分「早退」与「真的加载不完」：' + byId('page-loads').observation)

      const cz = byId('canvas-nonzero')
      ok(cz.observation.includes('300x150'),
        '必须如实写出后备缓冲仍是默认值：' + cz.observation)
      ok(cz.suspectedCause && cz.suspectedCause.length > 0,
        '默认缓冲必须给出 suspectedCause（未设置 width/height），不能静默通过')

      // 但「小块画布 CSS 放大」也可能是有意为之 ⇒ 不得升级成可返工失败
      ok(!actionableFailures(rec).some((c) => c.id === 'canvas-nonzero'),
        '默认尺寸缓冲只能是标注，不得成为可返工失败')
    }
    pass += 1
  } catch (e) { failures.push({ name: 'never-sized-canvas-not-misjudged', error: String(e.message || e) }) }
}

// ── 7. 外部依赖可观测性：断网时「依赖 CDN」必须**被看见** ─────────────
// 为什么必须有这条：A/C/D 三臂在「能不能跑」上完全一致（都是 1250x658、无异常），
// 差别只在 A/C 各发了 13 个外部请求、D 发 0 个。不把外部依赖记录下来的话，
// 验证器既会把网络故障说成产物缺陷，也会把「挂 CDN 才能跑」说成产物正常。
// 用 127.0.0.1:1（必然拒连）做确定性的外部依赖，不依赖真实外网。
{
  const p = writeFixture('external-dep.html', `<!doctype html><html><head><meta charset="utf-8"><title>ext</title></head>
<body><div>页面</div><script src="http://127.0.0.1:1/three.min.js"></script></body></html>`)
  const { built, raw } = await verifyHtmlFile({ file: p, waitMs: 8000, holdMs: 600, settleMs: 1500, offline: true })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const ext = rec.checks.find((c) => c.id === 'external-resources')
      ok(ext, '必须记录外部依赖这一项')
      ok(ext.informational, '外部依赖是**信息项**，不得直接翻转判定')
      ok(ext.observation.includes('127.0.0.1'), '必须写出真实外部地址：' + ext.observation)
      ok(raw.networkFailures.some((f) => /127\.0\.0\.1/.test(f.url || '')),
        '失败的外部请求必须被记录：' + JSON.stringify(raw.networkFailures).slice(0, 200))
      ok(!actionableFailures(rec).some((c) => c.id === 'external-resources'),
        '外部依赖不得成为可返工失败（网络故障不是产物缺陷）')
    }
    pass += 1
  } catch (e) { failures.push({ name: 'external-resources-observable', error: String(e.message || e) }) }
}

// ── 8. GL 计数：drawArrays 的 count 在 [2]，不是 [1] ──────────────────
// 这条是**计数器自己的 bug 墓碑**：最初对所有函数都按 arguments[1] 取顶点数，
// 而 drawArrays(mode, first, count) 的 [1] 是 first（通常 0）——
// 于是「用非索引 drawArrays 画了大量几何」会被读成「0 个三角形」。
// 手写 WebGL 恰恰最爱用 drawArrays，所以这个 bug 正好会把最该看清的东西看反。
// 同时必须区分图元模式：POINTS 不是三角形。
{
  const p = writeFixture('gl-drawarrays.html', `<!doctype html><html><head><meta charset="utf-8"><title>gl</title>
<style>canvas{width:400px;height:300px}</style></head>
<body><canvas id="c" width="400" height="300"></canvas><script>
const gl = document.getElementById('c').getContext('webgl2');
function tick() {
  gl.drawArrays(gl.TRIANGLES, 0, 300);   // count 在 [2]：应记 100 个三角形
  gl.drawArrays(gl.POINTS, 0, 50);       // 点不能算成三角形
  requestAnimationFrame(tick);
}
tick();
</script></body></html>`)
  const { built, raw } = await verifyHtmlFile({ file: p, waitMs: 6000, holdMs: 600, settleMs: 1000 })
  try {
    ok(built.ok, 'record valid')
    const rec = built.record
    if (!hasInfrastructureError(rec)) {
      const ra = rec.checks.find((c) => c.id === 'render-activity')
      ok(ra, '必须有渲染活动这一项')
      ok(ra.informational, '渲染活动是信息项（2D 画布/Worker 渲染看不见）')
      const gl = ra.observation
      // 断言用**不变量**而不是固定数字：计数是跨帧累计的，
      // 帧数取决于采样时机。每帧 drawArrays(TRIANGLES,0,300)+drawArrays(POINTS,0,50) ⇒
      //   顶点 = 3×三角形 + 点     （350 = 300 + 50）
      // 若把 drawArrays 的 count 错取成 arguments[1]（=first=0），三项会全为 0。
      const m = /提交绘制 (\d+) 次：(\d+) 个三角形(?: \/ (\d+) 个点)?[^]*?顶点合计 (\d+)/.exec(gl)
      ok(m, 'observation 必须含可解析的计数：' + gl)
      const tris = Number(m[2]), points = Number(m[3] || 0), verts = Number(m[4])
      ok(tris > 0, 'drawArrays(TRIANGLES,0,300) 必须被记成三角形（count 在 [2]）：' + gl)
      ok(points > 0, 'POINTS 必须被记成点，不能漏算也不能算进三角形：' + gl)
      ok(verts === 3 * tris + points,
        `顶点数必须满足 顶点 = 3×三角形 + 点（每帧 350 = 300 + 50），实际 ${verts} vs ${3 * tris + points}：${gl}`)
      ok(/drawArrays/.test(gl), '必须识别出调用方式是 drawArrays：' + gl)
    }
    pass += 1
  } catch (e) { failures.push({ name: 'gl-counter-drawarrays-argindex', error: String(e.message || e) }) }
}

// ── 9. 不许泄漏：验证完必须关掉浏览器进程树并删掉 profile ────────────
// 这条是本次最贵的教训：原来只 child.kill() + `catch {}` 吞掉删除失败，
// 结果 **595 个无头 Edge 进程**堆积、锁住 profile、吃掉 12GB 磁盘，
// 还因为机器被拖慢而让测量结果自相矛盾（见 EVIDENCE EV-0052）。
// profile 删得掉 = 进程真的退出了；删不掉就必须在记录里显形。
{
  const p = writeFixture('cleanup.html', GOOD)
  const { built, raw } = await verifyHtmlFile({ file: p, waitMs: 5000, holdMs: 600 })
  try {
    ok(built.ok, 'record valid')
    // 'ok' 只在 rmSync 真的成功后才返回；rmSync 成功 = 目录锁已释放 = 浏览器进程已退出。
    eq(raw.profileCleanup, 'ok',
      'profile 必须被真正删除（=浏览器进程树已退出）；实际：' + raw.profileCleanup)
    pass += 1
  } catch (e) { failures.push({ name: 'no-leak-cleanup', error: String(e.message || e) }) }
}

// ── 10. 陈旧 profile 清扫：只删 10 分钟以上的，不误伤并发验证 ─────────
{
  try {
    const { sweepStaleProfiles } = await import('../lib/verifier-html.js')
    const fresh = mkdtempSync(join(tmpdir(), 'po06-verify-'))
    const removed = sweepStaleProfiles(tmpdir(), 10 * 60 * 1000)
    ok(existsSync(fresh), '刚建出来的 profile 绝不能被清扫掉（并发验证的目录）')
    ok(removed >= 0, '清扫返回计数')
    rmSync(fresh, { recursive: true, force: true })
    pass += 1
  } catch (e) { failures.push({ name: 'stale-profile-sweep-safe', error: String(e.message || e) }) }
}

// ── 11. 全套件结束后**一个 profile 都不许剩** ─────────────────────────
// 为什么单测「不泄漏」不够：那条只检查**它自己那一次**验证的 profileCleanup。
// 实测确实出现过"某一条验证漏了一个 13.5MB profile、而全部用例仍然全绿"
// ——守卫只覆盖一个样本，就等于没覆盖。这里对**整个套件**收尾核查。
{
  try {
    const left = readdirSync(tmpdir()).filter((n) => /^po06-(verify|tl)-/.test(n))
    ok(left.length === 0,
      '全套件跑完后不得残留 profile，实际残留 ' + left.length + ' 个：' + left.join(', ')
      + '（每个 3-15MB；这正是曾把 C 盘塞满 12GB 的东西）')
    pass += 1
  } catch (e) { failures.push({ name: 'no-profile-left-after-suite', error: String(e.message || e) }) }
}

try { rmSync(DIR, { recursive: true, force: true }) } catch { /* best effort */ }

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-verifier-html', phase: 'P6', browser, total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
