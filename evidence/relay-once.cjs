// 用插件当前策略（0.3.9 = 已回退到 0.1.1）对一段用户原话跑一次传话，取出优化后的命令。
// 用法：node evidence/relay-once.cjs <taskTextFile> <outFile> [tier]
const fs = require('fs')
const path = require('path')
const ev = __dirname
const [taskFile, outFile, tier] = process.argv.slice(2)
if (!taskFile || !outFile) { console.error('usage: relay-once.cjs <taskTextFile> <outFile> [tier]'); process.exit(2) }
const task = fs.readFileSync(path.join(ev, taskFile), 'utf8').trim()
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const t0 = Date.now()
  const r = await fetch(API + '/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: task, tier: tier || 'extreme', historyMode: 'off', turns: 0 }),
  }).then((x) => x.json())
  if (!r || r.ok !== true) { console.error('start failed: ' + JSON.stringify(r)); process.exit(1) }
  let mine = null
  while (Date.now() - t0 < 240000) {
    await sleep(3000)
    const runs = await fetch(API + '/runs').then((x) => x.json())
    mine = (runs.runs || []).find((x) => x.id === r.runId)
    if (mine && mine.status !== 'running' && mine.status !== 'connecting') break
  }
  let cmd = String((mine && mine.text) || '')
  try {
    const sse = await fetch(API + '/stream?runId=' + encodeURIComponent(r.runId)).then((x) => x.text())
    const line = sse.split('\n').find((l) => l.indexOf('"type":"snapshot"') >= 0)
    if (line) { const snap = JSON.parse(line.slice(line.indexOf('{'))); cmd = String(snap.text || cmd) }
  } catch (e) { /* 退回 /runs 文本 */ }
  fs.writeFileSync(path.join(ev, outFile), cmd, 'utf8')
  console.log('status=' + (mine && mine.status) + '  ms=' + (Date.now() - t0) + '  chars=' + cmd.length + '  → ' + outFile)
  console.log('--- 命令 ---')
  console.log(cmd)
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
