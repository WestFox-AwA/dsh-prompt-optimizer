// 只读查证开关验证：node evidence/verify-readtools.cjs
// 做法：同一请求在开关 ON / OFF 下各跑一次（tier=extreme），读 /runs 的 toolCalls/toolNames 与产出内容，
// 判断"是否真的读了项目"（产出应出现本项目真实文件路径/事实）。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const REQ = '把这个插件的版本号在所有地方统一一下。'

const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } }
const setState = (patch) => j(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })

async function runOnce(label, tier) {
  const t0 = Date.now()
  const r = await j(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: REQ, tier }) })
  const id = r.runId || r.id
  if (!id) return { label, error: JSON.stringify(r).slice(0, 120) }
  for (let i = 0; i < 180; i++) {
    await new Promise((s) => setTimeout(s, 1000))
    const list = await j(API + '/runs')
    const rec = (list.runs || []).find((x) => x.id === id)
    if (rec && rec.status !== 'running') {
      const text = String(rec.text || '')
      return {
        label, status: rec.status, ms: Date.now() - t0,
        readTools: rec.readTools, toolCalls: rec.toolCalls, toolNames: rec.toolNames,
        chars: text.length,
        // 是否出现本项目真实事实（只有读过项目才可能写对）
        facts: ['lib/index.js', 'lib/client.js', 'package.json', '0.4.6-beta.1', 'evidence/'].filter((k) => text.includes(k)),
        head: text.replace(/\s+/g, ' ').slice(0, 220),
      }
    }
  }
  return { label, error: 'timeout' }
}

;(async () => {
  const rows = []
  await setState({ readTools: false })
  rows.push(await runOnce('开关 OFF', 'extreme'))
  await setState({ readTools: true })
  rows.push(await runOnce('开关 ON', 'extreme'))
  await setState({ readTools: false })
  console.log('请求：' + REQ + '（tier=extreme）')
  console.log('')
  for (const r of rows) {
    if (r.error) { console.log(r.label + ' → ❌ ' + r.error); continue }
    console.log(r.label + '：readTools=' + r.readTools + '  工具调用=' + r.toolCalls + ' 次 ' + JSON.stringify(r.toolNames || []) + '  产出=' + r.chars + ' 字  耗时=' + Math.round(r.ms / 1000) + 's')
    console.log('   产出里出现的真实项目事实：' + (r.facts.length ? JSON.stringify(r.facts) : '（无）'))
    console.log('   开头：' + r.head)
    console.log('')
  }
  console.log('判定：开关 ON 时 toolCalls > 0 且产出出现真实文件路径 ⇒ 只读查证真的生效。')
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
