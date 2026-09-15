// 单文件 HTML 进度面板：把测量/产物数据内嵌进 HTML（无需服务器、无需 fetch），
// 浏览器每 3 秒自动刷新同一文件；配合 --watch 由本脚本持续重写，即可看到"测试在动"而不是卡住。
// 用法：
//   node evidence/dashboard.cjs           只生成一次
//   node evidence/dashboard.cjs --watch   持续重写（每 3 秒），配合浏览器打开 evidence/dashboard.html
const fs = require('fs')
const path = require('path')
const ev = __dirname
const outFile = path.join(ev, 'dashboard.html')

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ev, f), 'utf8')) } catch (e) { return null } }
const mtime = (f) => { try { return fs.statSync(path.join(ev, f)).mtimeMs } catch (e) { return 0 } }
const ago = (ms) => { if (!ms) return '—'; const s = Math.round((Date.now() - ms) / 1000); return s < 90 ? s + ' 秒前' : (s < 5400 ? Math.round(s / 60) + ' 分钟前' : Math.round(s / 3600) + ' 小时前') }

function collect() {
  const grade = readJson('cx-grade.json')
  const art = readJson('artifact-check.json')
  const res = readJson('cx-results.json')
  const simple = readJson('cx-simple.json')
  const running = []
  // 正在跑的迹象：结果文件较旧而 artifacts 目录在增长 / 最近的 staging 输出文件
  for (const f of ['cx-results.json', 'cx-answer.json', 'cx-html-h3c.json', 'cx-html-h2b.json', 'cx-smoke.json']) {
    const m = mtime(f)
    if (m && Date.now() - m < 15 * 60 * 1000) running.push({ file: f, mtime: m })
  }
  const arts = fs.existsSync(path.join(ev, 'artifacts')) ? fs.readdirSync(path.join(ev, 'artifacts')).filter((f) => f.endsWith('.html')) : []
  const cells = res && Array.isArray(res.cells) ? res.cells : []
  return {
    at: new Date().toISOString(),
    grade: grade ? { summary: grade.summary || [], rows: (grade.rows || []).length, at: grade.at } : null,
    artifact: art ? { variantSummary: art.variantSummary || [], summary: art.summary || [], files: art.files || 0, at: art.at } : null,
    commandCells: cells.length,
    commandDone: cells.filter((c) => !c.skipped).length,
    simpleCells: simple && Array.isArray(simple.cells) ? simple.cells.length : 0,
    artifacts: arts.length,
    running,
    mtimes: {
      'cx-results.json': mtime('cx-results.json'),
      'cx-grade.json': mtime('cx-grade.json'),
      'artifact-check.json': mtime('artifact-check.json'),
      'dashboard.html': mtime('dashboard.html'),
    },
  }
}

function render(d) {
  const fmtMs = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN') + '（' + ago(ms) + '）' : '—')
  const gradeRows = (d.grade ? d.grade.summary : []).map((s) =>
    '<tr><td>' + s.variant + '</td><td class="num">' + s.sum + '/' + s.max + '</td><td class="num ' + (s.pct >= 83 ? 'good' : s.pct >= 60 ? 'warn' : 'bad') + '">' + s.pct + '%</td><td class="num">' + s.cells + '</td></tr>').join('')
  const artRows = (d.artifact ? d.artifact.summary : []).map((s) =>
    '<tr><td>' + s.variant + '</td><td>' + s.task + '</td><td class="num">' + s.pass + '/' + s.n + '</td><td class="num ' + (s.passRate >= 83 ? 'good' : s.passRate >= 60 ? 'warn' : 'bad') + '">' + s.passRate + '%</td><td class="mono">' + JSON.stringify(s.inwardFaces) + '</td></tr>').join('')
  const artVar = (d.artifact ? d.artifact.variantSummary : []).map((v) =>
    '<tr><td>' + v.variant + '</td><td class="num">' + v.pass + '/' + v.n + '</td><td class="num ' + (v.passRate >= 83 ? 'good' : v.passRate >= 60 ? 'warn' : 'bad') + '">' + v.passRate + '%</td></tr>').join('')
  const runRows = d.running.length ? d.running.map((r) => '<li>' + r.file + ' 更新于 ' + ago(r.mtime) + '</li>').join('') : '<li class="muted">暂无近期活动（若你刚启动测试，请等 10~20 秒）</li>'
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>dsh-prompt-optimizer 测试进度</title>' +
    '<meta http-equiv="refresh" content="3">' +
    '<style>' +
    'body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:18px 22px;background:#0f1115;color:#e6e7ea}' +
    'h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;color:#9aa4b2;font-weight:600}' +
    '.sub{color:#8b95a5;font-size:12px;margin-bottom:14px}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}' +
    'table{border-collapse:collapse;width:100%;max-width:980px}th,td{padding:6px 10px;border-bottom:1px solid #232733;text-align:left}' +
    'th{color:#9aa4b2;font-weight:600;font-size:12px}.num{text-align:right;font-variant-numeric:tabular-nums}' +
    '.good{color:#3ecf8e}.warn{color:#e0a33e}.bad{color:#f2777a}.muted{color:#6b7280}' +
    '.card{background:#151922;border:1px solid #232733;border-radius:10px;padding:12px 14px;margin-bottom:12px}' +
    '.k{display:inline-block;min-width:132px;color:#9aa4b2}.clock{font-size:12px;color:#8b95a5}' +
    'ul{margin:4px 0 0 18px;padding:0}' +
    '</style></head><body>' +
    '<h1>dsh-prompt-optimizer · 测试进度面板</h1>' +
    '<div class="sub">本页由 <span class="mono">evidence/dashboard.cjs --watch</span> 每 3 秒重写，浏览器自动刷新；' +
    '<span class="clock">生成时间 ' + new Date(d.at).toLocaleString('zh-CN') + '（' + ago(Date.parse(d.at)) + '）</span></div>' +
    '<div class="card"><div><span class="k">命令侧（10 题/满分 180）</span>' + (d.grade ? '已判分 ' + d.grade.rows + ' 格' : '暂无数据') + '</div>' +
    '<div><span class="k">最近一次运行格数</span>' + d.commandCells + ' 格（完成 ' + d.commandDone + '）</div>' +
    '<div><span class="k">简单回归格数</span>' + d.simpleCells + '</div>' +
    '<div><span class="k">产物文件数</span>' + d.artifacts + ' 份</div>' +
    '<div><span class="k">近期活动</span></div><ul>' + runRows + '</ul></div>' +
    '<h2>命令侧（确定性判分，0~3 档）</h2><table><tr><th>条件</th><th>得分</th><th>百分比</th><th>格数</th></tr>' + (gradeRows || '<tr><td colspan="4" class="muted">暂无</td></tr>') + '</table>' +
    '<h2>产物级（单文件 HTML，独立审计）</h2><table><tr><th>条件</th><th>通过</th><th>通过率</th></tr>' + (artVar || '<tr><td colspan="3" class="muted">暂无</td></tr>') + '</table>' +
    '<h2>产物级 · 分题</h2><table><tr><th>条件</th><th>题</th><th>通过</th><th>通过率</th><th>独立审计 inwardFaces</th></tr>' + (artRows || '<tr><td colspan="5" class="muted">暂无</td></tr>') + '</table>' +
    '<h2>数据新鲜度</h2><table><tr><th>文件</th><th>更新时间</th></tr>' +
    Object.keys(d.mtimes).map((k) => '<tr><td class="mono">' + k + '</td><td>' + fmtMs(d.mtimes[k]) + '</td></tr>').join('') + '</table>' +
    '<div class="sub" style="margin-top:16px">提示：若"近期活动"长时间为空且时间戳不变，说明当前没有测试在跑（不是卡死）。</div>' +
    '</body></html>'
}

function build() {
  const d = collect()
  fs.writeFileSync(outFile, render(d), 'utf8')
  return d
}

if (process.argv.includes('--watch')) {
  console.log('dashboard watch → ' + outFile + '（每 3 秒重写；Ctrl+C 退出）')
  build()
  setInterval(() => { try { build() } catch (e) { console.error('build error: ' + e.message) } }, 3000)
} else {
  const d = build()
  console.log('WROTE ' + outFile)
  console.log('  命令侧条件数 ' + (d.grade ? d.grade.summary.length : 0) + ' · 产物 ' + d.artifacts + ' 份 · 近期活动 ' + d.running.length)
}
