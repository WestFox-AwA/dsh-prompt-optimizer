// PTC 测试台 · 实时面板服务（零依赖）：node evidence/ptc-lab/server.cjs [port]
//   GET /            → 面板页面
//   GET /api/live    → 当前运行状态（来自 live.jsonl + latest.json + runs/ 清单）
// 只读本地文件，不做任何评分或算分（评分只发生在宿主内的判定器里）。
const http = require('http')
const fs = require('fs')
const path = require('path')

const LAB = __dirname
const RUNS = path.join(LAB, 'runs')
const PORT = Number(process.argv[2]) || 3097

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } }
const stat = (f) => { try { return fs.statSync(f) } catch (e) { return null } }

const state = () => {
  const events = []
  const lf = path.join(LAB, 'live.jsonl')
  const st = stat(lf)
  if (st) {
    const lines = fs.readFileSync(lf, 'utf8').split('\n').filter(Boolean)
    for (const l of lines) { try { events.push(JSON.parse(l)) } catch (e) { /* skip partial line */ } }
  }
  const latest = readJson(path.join(LAB, 'latest.json'), null)
  const strategies = readJson(path.join(LAB, 'strategies.json'), { strategies: {} }).strategies
  const start = events.filter((e) => e.kind === 'start').slice(-1)[0] || null
  const end = events.filter((e) => e.kind === 'end').slice(-1)[0] || null
  const last = events.slice(-1)[0] || null
  const ageMs = st ? Date.now() - st.mtimeMs : null
  const running = Boolean(start && !end && ageMs !== null && ageMs < 300000)
  // 每格最新状态
  const cells = {}
  for (const e of events) {
    if (e.kind === 'cell-start') cells[e.strategy + '|' + e.task + '|r' + e.rep] = { strategy: e.strategy, task: e.task, rep: e.rep, state: 'running', rounds: 0 }
    if (e.kind === 'round') { const c = cells[e.strategy + '|' + e.task + '|r' + e.rep]; if (c) { c.rounds += 1; c.lastExit = e.exit; c.lastErr = e.error || null } }
    if (e.kind === 'cell-end') { const c = cells[e.strategy + '|' + e.task + '|r' + e.rep]; if (c) { c.state = e.env ? 'env' : (e.rigLimited ? 'rig' : (e.pass ? 'pass' : 'fail')); c.failed = e.failed; c.err = e.err } }
  }
  const runs = []
  try {
    for (const f of fs.readdirSync(RUNS).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 12)) {
      const r = readJson(path.join(RUNS, f), null)
      if (r) runs.push({ file: f, tag: r.tag, at: r.at, elapsedMs: r.elapsedMs, summary: r.summary })
    }
  } catch (e) { /* no runs yet */ }
  return { running, tag: start ? start.tag : null, config: start || null, latest, strategies, cells: Object.values(cells), events: events.slice(-120), runs, ageMs, serverTime: new Date().toISOString() }
}

const PAGE = path.join(LAB, 'index.html')
const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api/live')) {
    const body = JSON.stringify(state())
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(body)
  }
  if (url === '/' || url.startsWith('/index')) {
    let html = ''
    try { html = fs.readFileSync(PAGE, 'utf8') } catch (e) { html = '<h1>缺少 index.html</h1>' }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(html)
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})
server.listen(PORT, '127.0.0.1', () => console.log('PTC 测试台面板： http://127.0.0.1:' + PORT + '/'))
