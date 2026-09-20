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
// 信息项（**不参与判定**，只记录事实；原因是它们各自都有合法反例）：
//   · render-activity      提交了多少绘制调用/三角形/点线、顶点数据是否含 NaN
//                          （2D 画布、Worker/OffscreenCanvas 渲染看不见 ⇒ 不能据此判 fail）
//   · external-resources   引用了哪些外部地址、成功/失败各几个
//                          （网络故障不是产物缺陷 ⇒ 不能据此判 fail，但「断网就白屏」是稳定性事实）
//   · canvas-content-sampled 中心像素颜色（恒定色可能是合法设计）
//
// 采样纪律（踩过坑，见 EVIDENCE EV-0049/0050）：**画布尺寸非零 ≠ 渲染器装配过**。
// canvas 的 width/height 默认就是 300×150，据此提前收工会把「DOM 还在 loading」读成结论。
// 提前收工必须同时满足：DOM 就绪 **且** 后备缓冲已被设成非默认尺寸。
//
// 磁盘纪律（EV-0052）：profile 用完必须真删掉。Windows 上 kill 之后句柄不会立刻释放，
// 删除要等进程退出 + 重试；删不掉要**如实记录**，不能 catch 掉——
// 静默失败会让每次验证漏 3-15MB，几十次就是几百 MB。
//
// 依赖：只用 node 内置（child_process / fs / net / 全局 WebSocket）。
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { RESULT, createRecord } from './verifier.js'

export const VALIDATOR = Object.freeze({ name: 'html-deliverable', version: '1.1.0', configHash: 'cdp-v2' })

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
  // 绘制活动：0 次 = 只清屏没画东西（见 GL_COUNTER 的说明）
  const g = window.__po06gl;
  out.gl = g ? { calls: g.calls, tris: g.tris, verts: g.verts, points: g.points, lines: g.lines, firstAtMs: g.firstAtMs, kinds: g.kinds, modes: g.modes, nanBuffers: g.nanBuffers, nanUniforms: g.nanUniforms } : null;
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

// canvas 的 width/height **默认值**就是 300×150（HTML 规范）。
// 「缓冲等于默认值」= 没有任何渲染器给它设过尺寸 —— 这不是「有尺寸」，是「没装配」。
// 这三个判定是「什么时候可以停止采样」的全部依据，导出以便被单独检验（见 test/verifier-html.test.mjs）。
const DEFAULT_BUF_W = 300
const DEFAULT_BUF_H = 150

export function isDomReady(v) {
  return Boolean(v) && (v.ready === 'complete' || v.ready === 'interactive')
}

export function hasSizedBuffer(v) {
  const list = (v && v.canvases) || []
  return list.some((c) => c.w > 0 && c.h > 0 && !(c.w === DEFAULT_BUF_W && c.h === DEFAULT_BUF_H))
}

/** 缓冲仍是默认 300×150 却被 CSS 拉大 → 渲染器从未设置后备缓冲（会被拉伸模糊） */
export function isDefaultStretched(v) {
  const list = (v && v.canvases) || []
  return list.some((c) => c.w === DEFAULT_BUF_W && c.h === DEFAULT_BUF_H && (c.cw > c.w || c.ch > c.h))
}

/** 注入式 GL 计数：统计页面**真的提交了多少次绘制、多少个三角形**。
 *
 *  为什么需要它：「画布有尺寸」只证明渲染器装配过，**不证明画了东西**。
 *  D-01 臂 D.html 就是这样：WebGL 上下文建好了、画布 1250x658、中心像素有颜色，
 *  但屏幕上只有天空渐变——没有任何车体。只测「能不能跑」的验证器会把它判成通过。
 *  包住 drawElements/drawArrays 就能把「清了个屏」和「真的画了几何」分开。
 *  在页面脚本执行**之前**注入（addScriptToEvaluateOnNewDocument），否则包不住。 */
const GL_COUNTER = `(() => {
  // 参数位次**因函数而异**，这里踩过坑：
  //   drawElements(mode, count, type, offset)        → count 在 [1]
  //   drawArrays(mode, first, count)                 → count 在 [2]  ← 不是 [1]！
  // 手写的 WebGL 常用非索引 drawArrays，若按 [1] 取会把 first(通常 0) 当顶点数，
  // 于是「画了一大堆几何」被读成「0 个三角形」。差点据此写出错误结论。
  const S = { calls: 0, verts: 0, tris: 0, points: 0, lines: 0, firstAtMs: null, kinds: {}, modes: {},
              nanBuffers: 0, nanUniforms: 0, scanned: 0 };
  window.__po06gl = S;
  const t0 = Date.now();
  // 顶点/矩阵里出现 NaN ⇒ 图元会被光栅化器整个丢掉：**提交了但什么都不显示**。
  // 手写几何最常见的静默失败（除零、未初始化、矩阵乘错），而且不抛异常。
  const hasNaN = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) return true; return false };
  const scan = (a) => {
    if (!a || typeof a.length !== 'number' || S.scanned > 400) return;
    S.scanned++;
    try { if (hasNaN(a)) S.nanBuffers++; } catch (e) { /* ignore */ }
  };
  for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const P = window[name] && window[name].prototype;
    if (!P) continue;
    for (const fn of ['bufferData', 'bufferSubData']) {
      if (typeof P[fn] !== 'function') continue;
      const orig = P[fn];
      P[fn] = function () {
        try { for (let i = 1; i < arguments.length; i++) { const a = arguments[i]; if (a && a.BYTES_PER_ELEMENT) { scan(a); break } } } catch (e) { /* ignore */ }
        return orig.apply(this, arguments);
      };
    }
    for (const fn of ['uniformMatrix4fv', 'uniformMatrix3fv', 'uniform3fv', 'uniform4fv', 'uniform1fv', 'uniform2fv']) {
      if (typeof P[fn] !== 'function') continue;
      const orig = P[fn];
      P[fn] = function () {
        try {
          const a = arguments[arguments.length - 1];
          if (a && typeof a.length === 'number' && hasNaN(a)) S.nanUniforms++;
        } catch (e) { /* ignore */ }
        return orig.apply(this, arguments);
      };
    }
  }
  // 注意：**绝不**包装 getError —— 它会清除错误标志，包装即改变页面行为。

  const SPEC = [
    ['drawElements', 1], ['drawElementsInstanced', 1],
    ['drawArrays', 2], ['drawArraysInstanced', 2],
  ];
  for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const P = window[name] && window[name].prototype;
    if (!P) continue;
    for (const [fn, countIdx] of SPEC) {
      if (typeof P[fn] !== 'function') continue;
      const orig = P[fn];
      P[fn] = function () {
        try {
          S.calls++;
          if (S.firstAtMs === null) S.firstAtMs = Date.now() - t0;
          S.kinds[fn] = (S.kinds[fn] || 0) + 1;
          const mode = arguments[0] | 0, n = arguments[countIdx] | 0;
          if (n > 0) S.verts += n;
          S.modes[mode] = (S.modes[mode] || 0) + 1;
          // 按图元模式分别累计，避免把 POINTS/LINES 误算成三角形
          if (mode === 4) S.tris += Math.floor(n / 3);          // TRIANGLES
          else if (mode === 5 || mode === 6) S.tris += Math.max(0, n - 2); // STRIP / FAN
          else if (mode === 0) S.points += n;                    // POINTS
          else if (mode === 1) S.lines += Math.floor(n / 2);      // LINES
          else if (mode === 2 || mode === 3) S.lines += Math.max(0, n - 1); // LOOP / STRIP
        } catch (e) { /* 计数绝不影响页面 */ }
        return orig.apply(this, arguments);
      };
    }
  }
})()`

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
export async function verifyHtmlFile({ file, waitMs = 18000, holdMs = 1200, settleMs = 8000, offline = false }) {
  const checks = []
  // 上一次被强杀留下的 profile 先扫掉（只动 10 分钟以上的，不误伤并发验证）
  sweepStaleProfiles()
  const raw = {
    file, at: new Date().toISOString(), samples: [], pageErrors: [], browser: null,
    // 外部依赖可观测性：单文件 HTML 常常仍从 CDN 取 three.js 之类，
    // 于是「页面能不能跑」里混进了「网通不通」。不记录这些，验证器就会把
    // 网络故障说成产物缺陷（或反过来）。见 D-01 对照的教训。
    consoleErrors: [], networkFailures: [], externals: [], responses: [], reqUrls: {},
  }

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
  let gracefulClose = null   // CDP Browser.close（能真正关掉整个浏览器，不只是发信号）
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
    // 真正能关掉整个浏览器的方式：CDP 的 Browser.close。
    // 只靠 child.kill() 不够 —— Windows 上 kill 掉的是我们 spawn 的那个进程，
    // 它的 renderer/gpu/crashpad 子进程会变成孤儿继续活着、继续占着 profile。
    // 实测这曾让 595 个无头 Edge 进程堆积、吃掉 12GB 磁盘（EV-0052）。
    gracefulClose = async () => {
      try { await send('Browser.close') } catch { /* 通道可能已断 */ }
    }
    ws.addEventListener('message', (ev) => {
      let m
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        raw.pageErrors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300))
      }
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        raw.consoleErrors.push({
          type: m.params.type,
          text: (m.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(' ').slice(0, 300),
        })
      }
      if (m.method === 'Network.requestWillBeSent') {
        const u = (m.params.request && m.params.request.url) || ''
        if (/^https?:/i.test(u)) { raw.reqUrls[m.params.requestId] = u; raw.externals.push(u) }
      }
      if (m.method === 'Network.responseReceived') {
        const r0 = m.params.response || {}
        if (/^https?:/i.test(r0.url || '')) raw.responses.push({ url: r0.url, status: r0.status, fromCache: Boolean(r0.fromDiskCache) })
      }
      if (m.method === 'Network.loadingFailed') {
        const u = raw.reqUrls[m.params.requestId] || ''
        raw.networkFailures.push({
          url: u, error: String(m.params.errorText || '').slice(0, 120),
          blocked: Boolean(m.params.blockedReason), type: m.params.type,
        })
      }
    })
    await new Promise((r) => { ws.addEventListener('open', r); setTimeout(r, 5000) })
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Network.enable')
    // 必须在导航前注入，才能包住页面自己的绘制调用
    await send('Page.addScriptToEvaluateOnNewDocument', { source: GL_COUNTER })
    // offline=true：切断网络（file:// 不受影响），用来把「产物自身的缺陷」
    // 与「产物依赖外部地址、而外部地址不通」彻底分开。
    // 一个把 three.js 挂在 CDN 上的单文件 HTML，在断网时就是一片空白——
    // 这是**稳定性事实**，online 检测看不出来。
    if (offline) {
      await send('Network.emulateNetworkConditions', {
        offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      })
      raw.offline = true
    }

    const fileUrl = 'file:///' + String(file).replace(/\\/g, '/').replace(/^\//, '')
    await send('Page.navigate', { url: fileUrl })

    // 采样：多帧，直到**页面就绪且渲染器真的装配过**，或超时。
    //
    // ⚠ 这里曾经只看「画布尺寸非零」就收工，而 HTML 规范规定 canvas 的
    // width/height 默认就是 300×150 —— 于是一个**从未被渲染器碰过**的画布
    // 也会被判为「有尺寸」，循环在第一次采样（约 1.2s）就退出。
    // 后果：page-loads 拿到的是 1.2s 时的 readyState（可能还是 loading），
    // 中心像素拿到的是未绘制缓冲。**这是仪器的错，不是产物的错。**
    // 现在必须同时满足「DOM 就绪」+「缓冲已被设置成非默认尺寸」才提前收工；
    // 若 DOM 已就绪但缓冲始终是默认尺寸，再给 settleMs 观察窗口后收工（不判 fail，只如实记录）。
    const deadline = Date.now() + waitMs
    let last = null
    let readyAt = 0
    while (Date.now() < deadline) {
      await sleep(holdMs)
      const r = await send('Runtime.evaluate', { expression: SAMPLE_EXPR, returnByValue: true })
      const v = r && r.result && r.result.value
      if (v) {
        const px = await send('Runtime.evaluate', { expression: PIXEL_EXPR, returnByValue: true, awaitPromise: true })
        v.pixel = px && px.result ? px.result.value : null
        v.tMs = Date.now() - (deadline - waitMs)
        raw.samples.push(v)
        last = v
        if (isDomReady(v) && hasSizedBuffer(v)) break          // 成品：DOM 就绪 + 缓冲已被设置
        if (isDomReady(v) && !readyAt) readyAt = Date.now()
        if (readyAt && Date.now() - readyAt >= settleMs) break  // DOM 就绪但缓冲仍默认 → 观察窗口用尽
      }
    }
    raw.waitedMs = Date.now() - (deadline - waitMs)

    // ── 页面加载 ────────────────────────────────────────────────
    // fail 必须意味着**真的等满了**：等待时长与采样次数一并写进 observation，
    // 否则「早退导致的 loading」会被误读成「页面永远加载不完」。
    const loaded = isDomReady(last)
    checks.push({
      id: 'page-loads', property: '页面加载完成（DOM ready）',
      result: loaded ? RESULT.PASS : RESULT.FAIL,
      observation: 'document.readyState = ' + String(last && last.ready)
        + '（等待 ' + (raw.waitedMs || 0) + 'ms，采样 ' + raw.samples.length + ' 次）',
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
      const stretched = isDefaultStretched(last)
      checks.push({
        id: 'canvas-nonzero', property: '画布（若有）后备缓冲尺寸非零',
        result: zero.length === 0 ? RESULT.PASS : RESULT.FAIL,
        // 尺寸非零 ≠ 装配成功：默认 300×150 被 CSS 拉大是「渲染器从未设过尺寸」的指纹。
        // 但小块画布用 CSS 放大**也可能是有意为之**（像素风 / 低分辨率渲染），故只标注不判 fail。
        observation: canvases.map((c) => c.w + 'x' + c.h + (c.cw !== c.w || c.ch !== c.h ? '（CSS ' + c.cw + 'x' + c.ch + '）' : '')).join(', ')
          + (stretched ? ' —— 后备缓冲仍为默认 300x150，疑未设置 width/height' : ''),
        evidenceRefs: [file],
        suspectedCause: zero.length > 0
          ? '画布尺寸可能由布局决定，绘制前未设置 width/height'
          : (stretched ? '后备缓冲保持 HTML 默认值 300x150：渲染器可能从未装配或被拉伸显示' : null),
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
        informational: true,      // 且**不参与** pass/verdict 判定
        observation: '中心像素 rgba=' + JSON.stringify(px.rgba) + (same ? '，且多帧采样结果相同' : ''),
        evidenceRefs: [],
      })
    }

    // ── 渲染活动：到底画没画几何（**信息项**）──────────────────
    // 「画布有尺寸」只说明装配过。0 次绘制调用 = 只清了屏。
    // 但注意：2D 画布走 fillRect、或渲染发生在 Web Worker/OffscreenCanvas 里，
    // 本计数器都看不见 ⇒ **不能**据此判 fail，只如实记录。
    const glStat = (last && last.gl) || null
    if (canvases.length > 0 && glStat) {
      checks.push({
        id: 'render-activity', property: '是否真的提交过绘制调用（而非只清屏）',
        result: RESULT.UNKNOWN,
        informational: true,
        observation: glStat.calls > 0
          ? '提交绘制 ' + glStat.calls + ' 次：' + glStat.tris + ' 个三角形'
            + (glStat.points ? ' / ' + glStat.points + ' 个点' : '')
            + (glStat.lines ? ' / ' + glStat.lines + ' 条线' : '')
            + '，顶点合计 ' + glStat.verts + '（首帧 t+' + glStat.firstAtMs + 'ms）'
            + '，调用方式 ' + Object.keys(glStat.kinds || {}).join('/')
            + ((glStat.nanBuffers || glStat.nanUniforms)
              ? ' ⚠ 含 NaN 的顶点缓冲 ' + glStat.nanBuffers + ' 个、含 NaN 的 uniform 上传 ' + glStat.nanUniforms + ' 次'
                + '——NaN 会让图元被整体丢弃：**提交了却什么都不显示**，且不抛异常'
              : '')
            + '（自页面加载起累计，非单帧；跨臂比较须注意观察窗口不同）'
          : '画布已建立，但采样期内**从未提交绘制调用**——只有清屏，没有几何',
        evidenceRefs: [],
      })
    }

    // ── 外部依赖：**信息项**，不参与判定 ────────────────────────
    // 「单文件 HTML」经常仍从 CDN 取 three.js。此时页面能否跑起来取决于网络，
    // 而这不是产物的缺陷、也不是产物的优点——它是一条**稳定性事实**：
    // 依赖外部地址的产物，渲染结果不再只由自己决定。
    // 只如实记录（含失败原因），把判定留给需要它的人。
    const externals = [...new Set(raw.externals)]
    if (externals.length > 0) {
      const netFails = raw.networkFailures.filter((f) => /^https?:/i.test(f.url || ''))
      const okCount = raw.responses.filter((r0) => r0.status >= 200 && r0.status < 400).length
      checks.push({
        id: 'external-resources', property: '外部资源（CDN 等）依赖与加载结果',
        result: RESULT.UNKNOWN,
        informational: true,
        observation: '引用 ' + externals.length + ' 个外部地址，成功响应 ' + okCount + '，失败 ' + netFails.length
          + (netFails.length ? '：' + netFails.map((f) => f.url + ' → ' + f.error).join('; ').slice(0, 240) : '')
          + ' ｜ ' + externals.slice(0, 4).join(', '),
        evidenceRefs: [],
      })
    }

    delete raw.reqUrls
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
    // 关浏览器的顺序很重要：先请它自己关（Browser.close），
    // 再树杀进程（/T 连子进程），最后才动 profile 目录。
    // 这里**绝不**静默吞掉失败：漏一个 profile 是 3-15MB，
    // 漏一个活着的浏览器进程还会连带锁住目录、拖慢后续测量（EV-0052）。
    if (gracefulClose) await gracefulClose()
    try { if (ws) ws.close() } catch { /* best effort */ }
    raw.profileCleanup = await cleanupProfile(profile, child)
  }
}

/** 关掉浏览器进程树并删除 profile；返回 'ok' 或失败原因（供记录，不静默）。 */
async function cleanupProfile(profile, child) {
  const pid = child && child.pid
  // 1) 树杀：/T 连子孙一起，/F 强制。只用 child.kill() 会留下孤儿子进程。
  if (pid) await killTree(pid)
  // 2) 等进程真的消失（profile 的锁要等句柄释放）
  for (let i = 0; i < 30 && pid && isAlive(pid); i++) await sleep(100)
  // 3) 带重试地删，删不掉就如实上报。
  //    重试之间**再树杀一次**：残留的子进程可能在第一次 kill 之后才拿到句柄。
  //    实测出现过"无进程持有、却仍删不掉"的 13.5MB 残留，所以这里退避到 ~12 次。
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      rmSync(profile, { recursive: true, force: true })
      return 'ok'
    } catch {
      if (pid && attempt % 3 === 0) await killTree(pid)
      await sleep(250 * (attempt + 1))
    }
  }
  return 'failed:' + profile
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** 杀掉进程及其整棵子树（Windows 用 taskkill /T /F，其它平台退回 kill）。 */
async function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = await import('node:child_process')
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 8000 })
      return
    } catch { /* 进程可能已退出，或无 taskkill */ }
  }
  try { process.kill(pid, 'SIGKILL') } catch { /* 已退出 */ }
}

/** 清理**上一次残留**的 profile（进程被强杀时留下的）。只删 10 分钟以上的，
 *  避免误伤并发进行的验证。返回删掉的数量。 */
export function sweepStaleProfiles(dir = tmpdir(), olderThanMs = 10 * 60 * 1000) {
  let removed = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!/^po06-verify-/.test(name)) continue
      const p = join(dir, name)
      try {
        if (Date.now() - statSync(p).mtimeMs < olderThanMs) continue
        rmSync(p, { recursive: true, force: true })
        removed++
      } catch { /* 占用中，下次再说 */ }
    }
  } catch { /* best effort */ }
  return removed
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
