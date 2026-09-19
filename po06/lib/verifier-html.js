// dsh-prompt-optimizer 0.6 · HTML 交付物验证器（真机 CDP，范围刻意收窄）
//
// **适用范围的声明就是本模块的一部分**：只验"单文件 HTML 能不能真的跑起来"，
// 不验审美、不验玩法、不验性能。coverage / notCovered 如实填进记录。
//
// 分类原则（PLAN-0.6.md §12.3）：
//   · 画布后备缓冲 0×0        → **fail**（确定缺陷：什么都渲染不出来）
//   · 浏览器起不来 / 端口没就绪 → **infrastructure_error**（环境问题，不是作品坏了）
//   · 画布有尺寸但采样恒为同一色 → **unknown**（可能是合法的纯色设计，**不硬判黑屏**）
//   · 页面抛未捕获异常         → **fail**（有错误原文作证据）
//
// 依赖：只用 node 内置（child_process / fs / net / 全局 WebSocket）。
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { RESULT, createRecord } from './verifier.js'

export const VALIDATOR = Object.freeze({ name: 'html-deliverable', version: '1.0.0', configHash: 'cdp-v1' })

export const COVERAGE = Object.freeze([
  '文件存在且非空',
  '浏览器能打开该文件',
  '页面加载完成（DOM ready）',
  '无未捕获异常',
  '画布（若有）后备缓冲尺寸非零',
])
export const NOT_COVERED = Object.freeze([
  '审美与构图',
  '玩法/交互正确性',
  '性能',
  '非画布类视觉缺陷',
  '用户是否满意',
])

const CANDIDATE_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

export function findBrowser() {
  for (const p of CANDIDATE_BROWSERS) if (existsSync(p)) return p
  return null
}

export function sha256OfFile(file) {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex') } catch { return null }
}

/** 在页面里采样：画布尺寸 + 帧内中心像素 + 覆盖层文案。 */
const SAMPLE_EXPR = `(() => {
  const out = { canvases: [], overlay: null, ready: document.readyState, title: document.title || '' };
  const cv = document.querySelectorAll('canvas');
  for (const c of cv) {
    out.canvases.push({ w: c.width|0, h: c.height|0, cw: c.clientWidth|0, ch: c.clientHeight|0 });
  }
  // 覆盖层：可见且文案里有"错误/失败/error"之类的提示
  const all = document.querySelectorAll('div,section,aside,p,h1,h2');
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4000) continue;
    const t = (el.innerText || '').trim();
    if (t.length > 0 && t.length < 400 && /(失败|错误|无法|不支持|error|failed|unsupported)/i.test(t)) {
      out.overlay = t.slice(0, 240); break;
    }
  }
  return out;
})()`

/** 帧内读中心像素（在 rAF 里做，避免读到未绘制的缓冲）。 */
const PIXEL_EXPR = `new Promise((resolve) => {
  const c = document.querySelector('canvas');
  if (!c) return resolve({ noCanvas: true });
  const r = () => {
    try {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const px = new Uint8Array(4);
        gl.readPixels(Math.floor(c.width/2), Math.floor(c.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return resolve({ kind: 'webgl', rgba: [px[0],px[1],px[2],px[3]] });
      }
      const c2 = c.getContext('2d');
      if (c2) {
        const d = c2.getImageData(Math.floor(c.width/2), Math.floor(c.height/2), 1, 1).data;
        return resolve({ kind: '2d', rgba: [d[0],d[1],d[2],d[3]] });
      }
      return resolve({ kind: 'none' });
    } catch (e) { return resolve({ error: String(e && e.message || e) }); }
  };
  requestAnimationFrame(() => requestAnimationFrame(r));
})`

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function freePort() {
  const net = await import('node:net')
  return await new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
    srv.on('error', () => resolve(9222 + Math.floor(Math.random() * 500)))
  })
}

/**
 * 打开一个 HTML 文件并采样。
 * @returns {{record:object, raw:object}}
 */
export async function verifyHtmlFile({ file, waitMs = 18000, holdMs = 1200 }) {
  const checks = []
  const raw = { file, at: new Date().toISOString(), samples: [], pageErrors: [], browser: null }

  // ── 0) 文件存在且非空（不需要浏览器就能判的，先判）────────────────
  let size = 0
  try { size = statSync(file).size } catch { /* 见下 */ }
  const exists = existsSync(file)
  checks.push({
    id: 'file-readable', property: '文件存在且非空',
    result: exists && size > 0 ? RESULT.PASS : RESULT.FAIL,
    observation: exists ? ('文件大小 ' + size + ' 字节') : '文件不存在',
    // fail 也必须有证据：证据就是"我们检查了哪个路径"
    evidenceRefs: [file],
  })
  if (!exists) return finish(checks, raw, file)

  const sha = sha256OfFile(file)
  const browser = findBrowser()
  raw.browser = browser
  if (!browser) {
    checks.push({
      id: 'browser-available', property: '浏览器能打开该文件',
      result: RESULT.INFRA_ERROR,
      observation: '未找到可用的 msedge/chrome 可执行文件',
      evidenceRefs: [],
    })
    return finish(checks, raw, file, sha)
  }

  const profile = mkdtempSync(join(tmpdir(), 'po06-verify-'))
  const port = await freePort()
  let child = null
  let ws = null
  try {
    child = spawn(browser, [
      '--headless=new',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profile,
      '--window-size=1280,800',
      'about:blank',
    ], { stdio: 'ignore', detached: false })

    // 等调试端口就绪
    let wsUrl = null
    const t0 = Date.now()
    while (Date.now() - t0 < 12000 && !wsUrl) {
      await sleep(300)
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/json/list')
        const list = await res.json()
        const page = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        if (page) wsUrl = page.webSocketDebuggerUrl
      } catch { /* 还没起来 */ }
    }
    if (!wsUrl) {
      checks.push({
        id: 'browser-available', property: '浏览器能打开该文件',
        result: RESULT.INFRA_ERROR,
        observation: '调试端口在 12 秒内未就绪（浏览器未能启动）',
        evidenceRefs: [],
      })
      return finish(checks, raw, file, sha)
    }

    ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    const send = (method, params) => new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
    ws.addEventListener('message', (ev) => {
      let m
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        raw.pageErrors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300))
      }
    })
    await new Promise((r) => { ws.addEventListener('open', r); setTimeout(r, 5000) })
    await send('Runtime.enable')
    await send('Page.enable')

    const fileUrl = 'file:///' + String(file).replace(/\\/g, '/').replace(/^\//, '')
    await send('Page.navigate', { url: fileUrl })

    // 采样：多帧，直到看见画布有尺寸或超时
    const deadline = Date.now() + waitMs
    let last = null
    while (Date.now() < deadline) {
      await sleep(holdMs)
      const r = await send('Runtime.evaluate', { expression: SAMPLE_EXPR, returnByValue: true })
      const v = r && r.result && r.result.value
      if (v) {
        const px = await send('Runtime.evaluate', { expression: PIXEL_EXPR, returnByValue: true, awaitPromise: true })
        v.pixel = px && px.result ? px.result.value : null
        raw.samples.push(v)
        last = v
        // 已有画布且尺寸非零 → 不必再等
        if (v.canvases && v.canvases.some((c) => c.w > 0 && c.h > 0)) break
      }
    }

    // ── 页面加载 ────────────────────────────────────────────────
    const loaded = Boolean(last && (last.ready === 'complete' || last.ready === 'interactive'))
    checks.push({
      id: 'page-loads', property: '页面加载完成（DOM ready）',
      result: loaded ? RESULT.PASS : RESULT.FAIL,
      observation: 'document.readyState = ' + String(last && last.ready),
      evidenceRefs: [file],
    })

    // ── 未捕获异常 ──────────────────────────────────────────────
    checks.push({
      id: 'no-page-errors', property: '无未捕获异常',
      result: raw.pageErrors.length === 0 ? RESULT.PASS : RESULT.FAIL,
      observation: raw.pageErrors.length === 0
        ? '采样期间未捕获到异常'
        : ('捕获 ' + raw.pageErrors.length + ' 条：' + raw.pageErrors[0]),
      evidenceRefs: raw.pageErrors.length === 0 ? [file] : [file, 'pageErrors:' + raw.pageErrors[0].slice(0, 60)],
    })

    // ── 画布后备缓冲 ────────────────────────────────────────────
    const canvases = (last && last.canvases) || []
    if (canvases.length === 0) {
      checks.push({
        id: 'canvas-nonzero', property: '画布（若有）后备缓冲尺寸非零',
        result: RESULT.UNKNOWN,
        observation: '页面中没有 canvas 元素，本项不适用',
        evidenceRefs: [],
      })
    } else {
      const zero = canvases.filter((c) => !(c.w > 0 && c.h > 0))
      checks.push({
        id: 'canvas-nonzero', property: '画布（若有）后备缓冲尺寸非零',
        result: zero.length === 0 ? RESULT.PASS : RESULT.FAIL,
        observation: canvases.map((c) => c.w + 'x' + c.h).join(', '),
        evidenceRefs: [file],
        suspectedCause: zero.length > 0 ? '画布尺寸可能由布局决定，绘制前未设置 width/height' : null,
      })
    }

    // ── 均匀画面：只报 unknown，**不硬判黑屏** ──────────────────
    const px = canvases.length > 0 ? (last && last.pixel) : null
    if (px && px.rgba) {
      const same = raw.samples.length > 1 && raw.samples.every((s) => s.pixel && s.pixel.rgba
        && JSON.stringify(s.pixel.rgba) === JSON.stringify(px.rgba))
      checks.push({
        id: 'canvas-content-sampled', property: '画布中心像素被采样到',
        result: RESULT.UNKNOWN,   // 恒定色可能是合法设计 ⇒ 只记录，不判失败
        observation: '中心像素 rgba=' + JSON.stringify(px.rgba) + (same ? '，且多帧采样结果相同' : ''),
        evidenceRefs: [],
      })
    }

    return finish(checks, raw, file, sha)
  } catch (e) {
    checks.push({
      id: 'browser-available', property: '浏览器能打开该文件',
      result: RESULT.INFRA_ERROR,
      observation: '验证过程异常：' + String((e && e.message) || e),
      evidenceRefs: [],
    })
    return finish(checks, raw, file, sha)
  } finally {
    try { if (ws) ws.close() } catch { /* best effort */ }
    try { if (child) child.kill() } catch { /* best effort */ }
    await sleep(200)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

function finish(checks, raw, file, sha) {
  const built = createRecord({
    artifact: { path: String(file), sha256: sha || '0'.repeat(64) },
    validator: VALIDATOR,
    environmentRef: raw.browser ? ('cdp:' + raw.browser) : 'no-browser',
    checks,
    coverage: COVERAGE.slice(),
    notCovered: NOT_COVERED.slice(),
    at: raw.at,
  })
  return { built, raw }
}
