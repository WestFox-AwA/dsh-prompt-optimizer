// 第 2 步验证：观察者上下文是否真的进了 system，以及产出是否引用了真实的历史内容
// 用法：node evidence/verify-observer.cjs
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } }
const set = (p) => j(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })

async function runOnce(label, patch, req) {
  await set(patch)
  const r = await j(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: req, tier: 'basic' }) })
  const id = r.runId || r.id
  for (let i = 0; i < 180; i++) {
    await new Promise((s) => setTimeout(s, 1000))
    const l = await j(API + '/runs')
    const c = (l.runs || []).find((x) => x.id === id)
    if (c && c.status !== 'running') {
      const t = String(c.text || '')
      // 历史里真实出现过的话题词（本会话确实聊过）
      const marks = ['履带', '坦克', 'V4', 'V5', '观察者', '验证', '蟑螂', '只读'].filter((k) => t.includes(k))
      return { label, observer: c.observer || null, chars: t.length, marks, head: t.replace(/\s+/g, ' ').slice(0, 200) }
    }
  }
  return { label, error: 'timeout' }
}

;(async () => {
  const REQ = '接着我们之前聊的那个问题继续，把它整理成一条可执行的命令。'
  const a = await runOnce('观察者=回合(turns)', { historyMode: 'turns', turns: 10, fullOn: false }, REQ)
  const b = await runOnce('观察者=关闭(off)', { historyMode: 'off' }, REQ)
  for (const r of [a, b]) {
    if (r.error) { console.log(r.label + ' → ❌ ' + r.error); continue }
    console.log(r.label + '：observer=' + JSON.stringify(r.observer) + '  产出=' + r.chars + ' 字')
    console.log('   命中的历史话题词：' + (r.marks.length ? JSON.stringify(r.marks) : '（无）'))
    console.log('   开头：' + r.head)
    console.log('')
  }
  console.log('判定：turns 组 observer.chars>0 且命中历史话题词；off 组 observer 为空 ⇒ 观察者注入生效。')
  await set({ historyMode: 'turns', turns: 10 })
})()
