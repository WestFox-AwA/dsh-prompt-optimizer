// P8 旧插件运行时探测测试：纯桩，无宿主、无浏览器、无模型。
// 运行：node po06/test/detect-old.test.mjs
import { detectOldPluginRuntime, mergeOldPluginSignals, OLD_CONTEXT_NAME } from '../lib/detect-old.js'

let pass = 0
const failures = []
const tests = []
function ta(name, fn) { tests.push({ name, fn }) }
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const agent = { id: 'session-x' }
const spWith = (names) => ({ assemble: async () => ({ contexts: names.map((n) => ({ name: n, text: 'x' })) }) })

// ── 1. 运行时探测 ───────────────────────────────────────────────────
ta('装配结果里有旧上下文 → 判为在装（confidence=runtime）', async () => {
  const r = await detectOldPluginRuntime({ systemPrompt: spWith([OLD_CONTEXT_NAME, 'sandbox:policy']), agent })
  eq(r.active, true, 'active')
  eq(r.confidence, 'runtime', 'confidence must be runtime, not static')
  ok(r.evidence[0].includes(OLD_CONTEXT_NAME), 'evidence must name the context: ' + r.evidence[0])
})

ta('装配结果里没有旧上下文 → 判为不在装（confidence=runtime）', async () => {
  const r = await detectOldPluginRuntime({ systemPrompt: spWith(['sandbox:policy', 'prompt-optimizer:intent']), agent })
  eq(r.active, false, 'not active')
  eq(r.confidence, 'runtime', 'runtime conclusion')
  eq(r.reason, null, 'no reason when the probe succeeded')
})

ta('注意：0.6 自己的上下文名不会被误认成旧插件', async () => {
  const r = await detectOldPluginRuntime({ systemPrompt: spWith(['prompt-optimizer:intent']), agent })
  eq(r.active, false, '0.6 own context must not trigger a false positive')
})

ta('没有 systemPrompt 服务 → 未知，不谎报结论', async () => {
  const r = await detectOldPluginRuntime({ systemPrompt: null, agent })
  eq(r.active, false, 'not active')
  eq(r.confidence, 'unknown', 'unknown')
  eq(r.reason, 'no-systemPrompt-service', 'reason')
})

ta('没有 agent 作用域 → 未知（不猜）', async () => {
  const r = await detectOldPluginRuntime({ systemPrompt: spWith([OLD_CONTEXT_NAME]), agent: null })
  eq(r.confidence, 'unknown', 'unknown')
  eq(r.reason, 'no-agent-scope', 'reason')
  eq(r.active, false, 'must NOT claim active from an unscoped probe')
})

ta('assemble 抛错 → 未知，不抛给调用方', async () => {
  const sp = { assemble: async () => { throw new Error('BOOM') } }
  const r = await detectOldPluginRuntime({ systemPrompt: sp, agent })
  eq(r.confidence, 'unknown', 'unknown')
  ok(r.reason.startsWith('assemble-failed:'), 'reason: ' + r.reason)
})

// ── 2. 合并信号 ─────────────────────────────────────────────────────
ta('运行时命中 + 静态未命中 → 判为在装（保守）', () => {
  const m = mergeOldPluginSignals({ active: true, confidence: 'runtime', evidence: ['rt'] }, { active: false, evidence: [] })
  eq(m.active, true, 'active')
  eq(m.confidence, 'runtime', 'runtime wins')
  ok(m.caveat.includes('保守'), 'caveat present')
})

ta('静态命中 + 运行时未命中 → 仍判为在装（保守方向）', () => {
  const m = mergeOldPluginSignals(
    { active: false, confidence: 'runtime', evidence: [], reason: null },
    { active: true, evidence: ['deps 含旧包'] },
  )
  eq(m.active, true, 'static hit must still block (conservative)')
  ok(m.evidence.some((e) => e.includes('deps')), 'evidence from static')
})

ta('两者都未命中且运行时结论有效 → 不在装，信心为 runtime', () => {
  const m = mergeOldPluginSignals(
    { active: false, confidence: 'runtime', evidence: [], reason: null },
    { active: false, evidence: [] },
  )
  eq(m.active, false, 'not active')
  eq(m.confidence, 'runtime', 'runtime')
  ok(m.caveat.includes('未发现'), 'caveat: ' + m.caveat)
})

ta('运行时证据不完整 → caveat 要求人工确认', () => {
  const m = mergeOldPluginSignals(
    { active: false, confidence: 'unknown', evidence: [], reason: 'no-agent-scope' },
    null,
  )
  eq(m.active, false, 'not active')
  eq(m.confidence, 'unknown', 'unknown')
  ok(m.caveat.includes('人工确认'), 'caveat: ' + m.caveat)
  ok(m.evidence.some((e) => e.includes('no-agent-scope')), 'reason must be carried into evidence')
})

ta('确定性：同输入两次结论一致', async () => {
  const a = await detectOldPluginRuntime({ systemPrompt: spWith([OLD_CONTEXT_NAME]), agent })
  const b = await detectOldPluginRuntime({ systemPrompt: spWith([OLD_CONTEXT_NAME]), agent })
  eq(a, b, 'deterministic')
})

for (const { name, fn } of tests) {
  try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-detect-old', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
