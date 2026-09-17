// 思考强度逻辑验证：node evidence/verify-effort.cjs
// 做法：改一次设置 → 真跑一次优化 → 读 /runs 里记录的 effort 与 usage.reasoningTokens。
// 判定"设置真的生效"的条件：run.effort 等于设置值（未设置时为 null），且思考 token 随档位单调变化。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api'
const REQ = process.env.REQ || '帮我设计一个方案：把现在这个 DSH 插件的设置存储从单文件 JSON 迁到 DSH 的 settings 服务，要求兼容旧文件、支持回滚、并且不影响已有会话；请把要考虑的边界情形、迁移步骤、回滚判据都写清楚。'

const j = async (url, opts) => {
  const r = await fetch(url, opts)
  const t = await r.text()
  try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } }
}
const setEffort = (v) => j(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reasoningEffort: v }) })
const getEfforts = () => j(API + '/efforts')

async function runOnce(label) {
  const started = Date.now()
  const run = await j(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: REQ, tier: 'extreme' }) })
  const id = run && (run.runId || run.id)
  if (!id) return { label, error: 'no-run-id: ' + JSON.stringify(run).slice(0, 120) }
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const list = await j(API + '/runs')
    const rec = (list.runs || []).find((x) => x.id === id)
    if (rec && rec.status !== 'running') {
      return {
        label,
        recorded: rec.effort === undefined ? '(缺字段)' : rec.effort,
        status: rec.status,
        reasoningChars: rec.reasoningChars,
        reasoningTokens: rec.reasoningTokens !== undefined ? rec.reasoningTokens : (rec.usage && (rec.usage.reasoningTokens || rec.usage.reasoning)) || null,
        outChars: rec.chars,
        ms: Date.now() - started,
      }
    }
  }
  return { label, error: 'timeout' }
}

;(async () => {
  const info = await getEfforts()
  console.log('① /efforts 返回：ok=' + info.ok + '  模型=' + (info.selection && info.selection.name) + '  可选档=' + JSON.stringify((info.efforts || []).map((e) => e.id)) + '  默认档=' + info.defaultEffort + '  当前设置=' + JSON.stringify(info.current))
  const rows = []
  const reps = Number(process.env.REPS || 2)
  for (const v of ['off', 'max', null]) {
    const set = await setEffort(v)
    const runs = []
    for (let i = 0; i < reps; i++) runs.push(await runOnce(String(v) + '#' + (i + 1)))
    const ok = runs.filter((r) => !r.error)
    const chars = ok.map((r) => r.reasoningChars)
    const ms = ok.map((r) => r.ms)
    rows.push({
      label: String(v),
      applied: set.state ? JSON.stringify(set.state.reasoningEffort) : '?',
      recorded: ok.map((r) => r.recorded).join('/'),
      chars: chars.join('/'),
      avgChars: chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : null,
      avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 1000) : null,
    })
  }
  console.log('')
  console.log('② 实测（每档真跑 ' + reps + ' 次，读 /runs 记录）：')
  console.log('   设置值   state 写入      记录 effort   思考字数           均值   均值耗时')
  for (const r of rows) {
    console.log('   ' + r.label.padEnd(8) + r.applied.padEnd(16) + r.recorded.padEnd(14) + r.chars.padEnd(19) + String(r.avgChars).padStart(6) + String(r.avgMs + 's').padStart(9))
  }
  console.log('')
  console.log('③ 判定一（逻辑）：每次运行的"记录 effort"都等于设置值 ⇒ 设置确实被传进了模型调用。')
  console.log('   判定二（行为）：思考字数是否随档位单调变化。注意该 provider 不上报 reasoning tokens，且单次噪声大，')
  console.log('   所以只凭 1–2 次不能下结论；要判定强度是否真的改变，需要更多次数或换用上报 reasoning tokens 的 provider。')
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
