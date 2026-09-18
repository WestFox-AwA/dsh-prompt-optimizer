// 第 2 步验证之二：full 模式（读整个会话投影）+ 真正的"关闭"对照
// 注意：historyMode='full' 且 fullOn=false 时，宿主会把它折成 'off'（见 startLiveRun）
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
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
      return { label, observer: c.observer || null, chars: t.length, marks: ['履带', 'V5', '观察者', '只读', '压缩'].filter((k) => t.includes(k)), head: t.replace(/\s+/g, ' ').slice(0, 160) }
    }
  }
  return { label, error: 'timeout' }
}

;(async () => {
  const full = await runOnce('观察者=全文(full)', { historyMode: 'full', fullOn: true })
  const off = await runOnce('观察者=关闭(off)', { historyMode: 'full', fullOn: false })
  for (const r of [full, off]) {
    if (r.error) { console.log(r.label + ' → ❌ ' + r.error); continue }
    console.log(r.label + '：observer=' + JSON.stringify(r.observer) + '  产出=' + r.chars + ' 字')
    console.log('   命中历史话题词：' + (r.marks.length ? JSON.stringify(r.marks) : '（无）'))
    console.log('   开头：' + r.head)
    console.log('')
  }
  console.log('判定：full 组 observer.rows 应显著大于 turns 组（65）且 mode=full；off 组 observer 的 chars 应为 0。')
  await set({ historyMode: 'turns', fullOn: false, turns: 10 })
})()
