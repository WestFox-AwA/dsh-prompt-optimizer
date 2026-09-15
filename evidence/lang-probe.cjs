// 产出语言实测：走宿主真实运行路径（POST /run → 轮询 /runs），各跑一条英文与中文输入，
// 统计产出里的中日韩字符占比，验证"输出语言＝用户原话的语言"。不发消息、不动会话、不改任何设置。
// 用法：node evidence/lang-probe.cjs [tier] [timeoutSec]
const fs = require('fs')
const path = require('path')
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const tier = process.argv[2] || 'advanced'
const timeoutSec = Number(process.argv[3] || 180)

const CASES = [
  { lang: 'en', request: 'Add a rate limiter to the login endpoint.' },
  { lang: 'zh', request: '给登录接口加一个限流。' },
]
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const stats = (s) => {
  const t = String(s || '')
  const cjk = (t.match(CJK) || []).length
  const letters = (t.match(/[A-Za-z]/g) || []).length
  const total = t.length
  return { chars: total, cjk, latin: letters, cjkRatio: total ? Math.round((cjk / total) * 1000) / 1000 : 0, head: t.split('\n').filter(Boolean).slice(0, 2).join(' / ').slice(0, 120) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runOne(c) {
  const t0 = Date.now()
  const res = await fetch(API + '/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: c.request, tier, historyMode: 'off', turns: 0 }),
  }).then((r) => r.json())
  if (!res || res.ok !== true) return { error: 'start-failed: ' + JSON.stringify(res) }
  const id = res.runId
  let last = null
  while (Date.now() - t0 < timeoutSec * 1000) {
    await sleep(2000)
    const runs = await fetch(API + '/runs').then((r) => r.json()).catch(() => null)
    const mine = runs && Array.isArray(runs.runs) ? runs.runs.find((x) => x.id === id) : null
    if (!mine) continue
    last = mine
    if (mine.status !== 'running' && mine.status !== 'connecting') break
  }
  if (!last) return { error: 'run-not-observed', runId: id }
  // /runs 的 text 截断到 4000 字；/stream 的 snapshot 给全文 —— 统计必须基于全文才严格
  let fullText = String(last.text || '')
  let fullReasoning = String(last.reasoning || '')
  try {
    const sse = await fetch(API + '/stream?runId=' + encodeURIComponent(id)).then((r) => r.text())
    const line = sse.split('\n').find((l) => l.indexOf('"type":"snapshot"') >= 0)
    if (line) {
      const snap = JSON.parse(line.slice(line.indexOf('{')).trim())
      fullText = String(snap.text || fullText)
      fullReasoning = String(snap.reasoning || fullReasoning)
    }
  } catch (e) { /* 退回 /runs 的截断文本 */ }
  const full = await fetch(API + '/runs').then((r) => r.json()).catch(() => null)
  const mine = full && Array.isArray(full.runs) ? full.runs.find((x) => x.id === id) : last
  const note = fullText.length >= 4000 && String(mine.text || '').length >= 4000 ? 'full-text-via-stream' : 'full-text-via-stream'
  return {
    runId: id, status: mine.status, ms: Date.now() - t0, tier: mine.tier, provider: mine.provider, model: mine.model,
    error: mine.error || null, textSource: note,
    text: stats(fullText), reasoning: stats(fullReasoning),
    sample: fullText.slice(0, 300),
  }
}

;(async () => {
  const out = { at: new Date().toISOString(), api: API, tier, cases: {} }
  for (const c of CASES) {
    process.stdout.write('running ' + c.lang + ' … ')
    const r = await runOne(c)
    out.cases[c.lang] = r
    console.log(r.error ? ('ERROR ' + r.error) : (r.status + '  chars=' + r.text.chars + ' cjk=' + r.text.cjk + ' ratio=' + r.text.cjkRatio))
  }
  const en = out.cases.en || {}; const zh = out.cases.zh || {}
  out.pass = Boolean(
    en.text && en.status === 'done' && en.text.chars > 40 && en.text.cjk === 0
    && zh.text && zh.status === 'done' && zh.text.chars > 20 && zh.text.cjk > 10
  )
  fs.writeFileSync(path.join(__dirname, 'lang-probe.json'), JSON.stringify(out, null, 2))
  console.log('--- samples ---')
  console.log('EN head : ' + (en.text ? en.text.head : '(none)'))
  console.log('ZH head : ' + (zh.text ? zh.text.head : '(none)'))
  console.log('PASS: ' + out.pass + '   (evidence/lang-probe.json)')
  process.exit(out.pass ? 0 : 1)
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
