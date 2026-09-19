// 真机渲染探针（无依赖，CDP over 内置 WebSocket）——"交付门"的原语
//   node evidence/render-probe.cjs <file|url> [--wait 45000] [--out shot.png] [--port 9333] [--shot-only]
// 为什么不用 --virtual-time-budget：它把定时器按**虚拟时间**快进，页面自己的 watchdog（"25s 无首帧"）
// 会在真实渲染还没做完时就触发 → 测出来的是假失败。这里用真实时间等待 + CDP 截图。
// 输出：PNG + 控制台错误 + 页面可见文本 + 判定（ok / blank / fatal-overlay / error）
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const WAIT = Number(opt('wait', 45000));
const PORT = Number(opt('port', 9333));
const OUT = opt('out', path.join(os.tmpdir(), 'render-probe.png'));
const SHOT_ONLY = argv.includes('--shot-only');
const EDGE = opt('browser', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');

if (!target) { console.log('用法: node render-probe.cjs <file|url> [--wait ms] [--out png] [--port n]'); process.exit(1) }
const url = /^https?:/.test(target) ? target : 'file:///' + path.resolve(target).replace(/\\/g, '/');
const profile = path.join(os.tmpdir(), 'render-probe-profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (u) => (await fetch(u)).json();

(async () => {
  const gpu = argv.includes('--gpu'); // 不用 swiftshader，走真实 GPU（A/B 用：区分"页面 bug"与"软件渲染环境限制"）
  const child = spawn(EDGE, [
    '--headless=new', '--no-sandbox',
    ...(gpu ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800',
    `--user-data-dir=${profile}-${gpu ? 'gpu' : 'sw'}`, `--remote-debugging-port=${PORT}`, url,
  ], { stdio: 'ignore', detached: false });

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break }
    } catch { /* 还没起来 */ }
  }
  if (!wsUrl) { console.log('✗ 连不上调试端口'); try { child.kill() } catch {} process.exit(2) }

  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const consoleErrors = [];
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || a.type).join(' ').slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text).slice(0, 300));
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  // 早退：页面里出现"致命覆盖层"就立刻停（省时间，且这正是我们要抓的）
  const t0 = Date.now();
  let overlay = null;
  while (Date.now() - t0 < WAIT) {
    await sleep(1500);
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const vis = (el) => !!(el && el.offsetParent !== null && el.getBoundingClientRect().width > 0);
        const fatal = ['fatalTitle','fatalMsg','fatalDetail','bootMsg'].map(id => document.getElementById(id)).find(vis);
        const canvas = document.querySelector('canvas');
        let varStd = null, mean = null;
        return { overlay: fatal ? (document.getElementById('fatalTitle')||{}).textContent + ' | ' + ((document.getElementById('fatalMsg')||{}).textContent||'') : null,
                 overlayVisible: !!fatal, canvas: !!canvas, w: canvas ? canvas.width : 0, h: canvas ? canvas.height : 0,
                 body: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 400) };
      })()`,
      returnByValue: true,
    });
    const v = r && r.result && r.result.value;
    if (!v) continue;
    if (v.overlayVisible && v.overlay && !/着色器|编译/.test(v.overlay) === false) { overlay = v.overlay; }
    if (v.overlayVisible && overlay) break;
    if (v.canvas && v.w > 0) { overlay = overlay || null; }
  }
  const evalIdx = argv.indexOf('--eval');
  const evalFileIdx = argv.indexOf('--eval-file');
  let probeValue = null;
  if ((evalIdx > 0 && argv[evalIdx + 1]) || (evalFileIdx > 0 && argv[evalFileIdx + 1])) {
    const expression = evalFileIdx > 0 ? fs.readFileSync(argv[evalFileIdx + 1], 'utf8') : argv[evalIdx + 1];
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    probeValue = r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : null;
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  const dom = await send('Runtime.evaluate', {
    expression: `(document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 600)`,
    returnByValue: true,
  });
  try { ws.close() } catch {}
  try { child.kill() } catch {}

  const bodyText = (dom && dom.result && dom.result.value) || '';
  const fatalOverlay = /初始化失败|编译失败|无法渲染|初始化超时|着色器/.test(bodyText);
  const verdict = pageErrors.length ? 'error' : (fatalOverlay ? 'fatal-overlay' : (/加载|初始化|编译中/.test(bodyText) && bodyText.length < 120 ? 'still-loading' : 'ok'));
  console.log(JSON.stringify({
    url, waitMs: Date.now() - t0, screenshot: fs.existsSync(OUT) ? OUT : null,
    bytes: fs.existsSync(OUT) ? fs.statSync(OUT).size : 0,
    verdict, consoleErrors: consoleErrors.slice(0, 6), pageErrors: pageErrors.slice(0, 6),
    pageText: bodyText.slice(0, 300), probeValue,
  }, null, 1));
  if (!SHOT_ONLY) process.exitCode = verdict === 'ok' ? 0 : 1;
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1) });
