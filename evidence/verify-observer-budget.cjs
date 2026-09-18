// 第 3 步验证：预算 + 分级压缩 + 声明
// 判据：observer.chars ≤ 预算（12000）；stage 字段显示压缩到哪一级（且注入文本里确有该声明）
//      同时确认压缩后产出仍引用真实历史（信号没被压没）
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const BUDGET = 12000
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } }
const set = (p) => j(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
const REQ = '接着我们之前聊的那个问题继续，把它整理成一条可执行的命令。'

async function runOnce(label, patch) {
  await set(patch)
  const r = await j(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: REQ, tier: 'basic' }) })
  const id = r.runId || r.id
  for (let i = 0; i < 180; i++) {
    await new Promise((s) => setTimeout(s, 1000))
    const l = await j(API + '/runs')
    const c = (l.runs || []).find((x) => x.id === id)
    if (c && c.status !== 'running') {
      const t = String(c.text || '')
      const o = c.observer || {}
      return {
        label, mode: o.mode, chars: o.chars, rows: o.rows, stage: o.stage || null,
        overBudget: typeof o.chars === 'number' ? o.chars > BUDGET : null,
        marks: ['履带', '观察者', '只读', '压缩', 'V5', '蟑螂'].filter((k) => t.includes(k)),
        outChars: t.length,
      }
    }
  }
  return { label, error: 'timeout' }
}

;(async () => {
  const turns = await runOnce('turns(预算内应压缩)', { historyMode: 'turns', turns: 10, fullOn: false })
  const full = await runOnce('full(超得更狠)', { historyMode: 'full', fullOn: true })
  console.log('预算 = ' + BUDGET + ' 字符（可用 DSH_PO_OBSERVER_BUDGET 覆盖）')
  console.log('')
  for (const r of [turns, full]) {
    if (r.error) { console.log(r.label + ' → ❌ ' + r.error); continue }
    console.log(r.label + '：mode=' + r.mode + '  注入 ' + r.chars + ' 字符 / ' + r.rows + ' 行  超预算=' + r.overBudget)
    console.log('   压缩声明(stage) = ' + JSON.stringify(r.stage))
    console.log('   压缩后产出 ' + r.outChars + ' 字，命中历史话题：' + (r.marks.length ? JSON.stringify(r.marks) : '（无）'))
    console.log('')
  }
  console.log('判定：chars ≤ 预算、stage 非空（说明注入文本里写明了压缩情况）、且产出仍命中历史话题。')
  await set({ historyMode: 'turns', fullOn: false, turns: 10 })
})()
