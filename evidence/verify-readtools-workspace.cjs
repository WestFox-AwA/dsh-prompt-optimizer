// 验证：优化 AI 在 ON 时是否读到「当前工作目录」的真实事实
// 用法：node evidence/verify-readtools-workspace.cjs
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const REQ = '看看当前工作目录里都有哪些东西，据此写一条整理工作目录的命令。'
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } }
const set = (p) => j(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
;(async () => {
  await set({ readTools: true })
  const r = await j(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: REQ, tier: 'extreme' }) })
  const id = r.runId || r.id
  for (let i = 0; i < 180; i++) {
    await new Promise((s) => setTimeout(s, 1000))
    const l = await j(API + '/runs')
    const c = (l.runs || []).find((x) => x.id === id)
    if (c && c.status !== 'running') {
      const t = String(c.text || '')
      const facts = ['attachments', 'plugins', 'profiles', 'evidence', 'sessions', 'cordis', 'package.json'].filter((k) => t.includes(k))
      console.log('ON：工具调用=' + c.toolCalls + ' ' + JSON.stringify(c.toolNames || []) + '  产出=' + t.length + ' 字  耗时=' + Math.round((c.ms || 0) / 1000) + 's')
      console.log('产出中出现的真实目录/文件名：' + JSON.stringify(facts))
      console.log('开头：' + t.replace(/\s+/g, ' ').slice(0, 320))
      break
    }
  }
  await set({ readTools: false })
  console.log('（开关已恢复默认关闭）')
})()
