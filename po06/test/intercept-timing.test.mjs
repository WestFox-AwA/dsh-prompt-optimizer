// P11 · 前置拦截**宿主侧时序**的定点核对。
//
// 运行：node po06/test/intercept-timing.test.mjs
//
// 为什么单独一个文件（用户 2026-09-21 的真机反馈）：拦截确实触发了，但**跑不出优化**——
// 真机台账逐条照出两条**时序**失败，而它们都不是"逻辑写错"，是"等得不够"：
//   · `gate-disabled`：启用判定是异步懒判定；pipeline 同步读结论 ⇒ 第一次拦截必然读到"判定中"。
//   · `no-model-route`：解释层模型来自 `request/header` 观测；前置拦截发生在消息进宿主**之前**。
// 这类 bug 用真机去试又慢又不可重复 ⇒ 这里用假闸门/假 llm 服务把时序钉死。
import { createEnableGate } from '../lib/assembly-gate.js'
import { __test, __resetObservedModelsForTest, adapter } from '../lib/index.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
async function t(name, fn) { try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const { awaitGateDecision, ensureModelRoute, modelFor, observeModel } = __test

/**
 * 每个用例开头都清干净：`modelFor()` 有一个**粘性的全局兜底**（最近一次观测到的模型），
 * 不清就会让后面的用例误判成 `observed`（第一版就是这么假绿的——夹具没隔离）。
 */
function isolate() { __resetObservedModelsForTest() }

await t('awaitGateDecision：判定"判定中"时必须**等到落地**（真机 gate-disabled 的回锚）', async () => {
  const prev = adapter.enableGate
  try {
    const gate = createEnableGate({ decide: async () => { await new Promise((r) => setTimeout(r, 300)); return { enabled: true, code: 'our-settings' } } })
    adapter.enableGate = gate
    const immediate = gate.ensure('s-wait')
    eq(immediate.status, 'resolving', 'ensure 立刻返回的是"判定中"（这就是 pipeline 会读到的那个值）')
    const st = await awaitGateDecision('s-wait', 5000)
    eq(st.status, 'done', '等到落地')
    eq(st.enabled, true, '拿到真实结论，而不是保守的"不启用"')
    eq(st.code, 'our-settings', '码也带回来')
  } finally { adapter.enableGate = prev }
})

await t('awaitGateDecision：判定一直不落地时**按超时返回**，绝不死等', async () => {
  const prev = adapter.enableGate
  try {
    adapter.enableGate = createEnableGate({ decide: () => new Promise(() => {}) })   // 永不 resolve
    const t0 = Date.now()
    const st = await awaitGateDecision('s-hang', 600)
    const ms = Date.now() - t0
    ok(ms >= 550 && ms < 3000, '应当只等到超时（实测 ' + ms + 'ms）')
    eq(st.status, 'resolving', '超时后如实回"还没判定"，不假装有结论')
  } finally { adapter.enableGate = prev }
})

await t('ensureModelRoute：已观测到模型 ⇒ 直接用（source=observed）', async () => {
  isolate()
  const sid = 's-obs'
  observeModel(sid, { provider: 'p-obs', model: 'm-obs' })
  const r = await ensureModelRoute({ get: () => null }, sid)
  eq(r.source, 'observed', '不用兜底')
  eq(modelFor(sid).model, 'm-obs', '还是原来那条路由')
})

await t('ensureModelRoute：没观测到 ⇒ 先问会话自己的模型选择（source=session）', async () => {
  isolate()
  const sid = 's-sel'
  const prevSvc = adapter.services.sessionController
  try {
    adapter.services.sessionController = { modelSelection: async () => ({ provider: 'p-sel', model: { model: 'm-sel' } }) }
    const r = await ensureModelRoute({ get: () => null }, sid)
    eq(r.source, 'session', '来源是会话选择')
    eq(modelFor(sid), { provider: 'p-sel', model: 'm-sel' }, '已经学会这条路由（后续 pipeline 能用）')
  } finally { adapter.services.sessionController = prevSvc }
})

await t('ensureModelRoute：会话选择也拿不到 ⇒ 退到宿主 llm 第一条可用路由（source=host-default-first）', async () => {
  isolate()
  const sid = 's-host'
  const prevSvc = adapter.services.sessionController
  try {
    adapter.services.sessionController = null
    const ctx = { get: (k) => (k === 'llm' ? { listProviders: async () => [{ id: 'p-host' }], listModels: async () => [{ id: 'm-host' }] } : null) }
    const r = await ensureModelRoute(ctx, sid)
    // ⚠ 这一档是**最后**的兜底：真机实测它挑到过 flash（1 秒回一个"没有改动"），
    //   所以来源必须自报家门（`-first` 后缀），界面据此明说"这轮用的是兜底模型"。
    eq(r.source, 'host-default-first', '来源必须明说是"清单第一条"这条兜底（台账里不许冒充"用户的模型"）')
    eq(r.picked, 'p-host/m-host', '还要记下具体挑中了哪一条（便于排查"为什么结果这么薄"）')
    eq(modelFor(sid), { provider: 'p-host', model: 'm-host' }, '兜底路由已写入，pipeline 能跑')
  } finally { adapter.services.sessionController = prevSvc }
})

await t('ensureModelRoute：宿主的默认模型服务优先于"清单第一条"（真机 noop 的回锚）', async () => {
  isolate()
  const sid = 's-def'
  const prevSvc = adapter.services.sessionController
  try {
    adapter.services.sessionController = null
    const ctx = {
      get: (k) => {
        if (k === 'agentDefaultModel') return { current: async () => ({ provider: 'p-def', model: 'm-def' }) }
        if (k === 'llm') return { listProviders: async () => [{ id: 'p-flash' }], listModels: async () => [{ id: 'deepseek-flash' }] }
        return null
      },
    }
    const r = await ensureModelRoute(ctx, sid)
    eq(r.source, 'host-default', '应当用宿主的默认模型，而不是清单第一条')
    eq(modelFor(sid), { provider: 'p-def', model: 'm-def' }, '拿到的是宿主默认那条')
  } finally { adapter.services.sessionController = prevSvc }
})

await t('ensureModelRoute：连 llm 服务都没有 ⇒ **如实回失败**，不编一条假路由', async () => {
  isolate()
  const sid = 's-nollm'
  const prevSvc = adapter.services.sessionController
  try {
    adapter.services.sessionController = null
    const r = await ensureModelRoute({ get: () => null }, sid)
    eq(r.ok, false, '必须是 ok:false')
    eq(r.reason, 'no-llm-service', '原因要说清')
    eq(modelFor(sid), null, '**不得**留下任何路由（否则下游会拿一条假路由去调用）')
  } finally { adapter.services.sessionController = prevSvc }
})

await t('ensureModelRoute：llm 抛错 ⇒ 不抛给调用方，变成 ok:false + 原因', async () => {
  isolate()
  const sid = 's-throw'
  const prevSvc = adapter.services.sessionController
  try {
    adapter.services.sessionController = null
    const ctx = { get: () => ({ listProviders: async () => { throw new Error('boom') } }) }
    const r = await ensureModelRoute(ctx, sid)
    eq(r.ok, false, '不抛，回 ok:false')
    ok(/route-threw/.test(r.reason), '原因带前缀：' + r.reason)
  } finally { adapter.services.sessionController = prevSvc }
})

console.log(JSON.stringify({
  suite: 'po06-intercept-timing', phase: 'P11', total: pass + failures.length, pass, fail: failures.length, failures,
  note: '前置拦截的宿主侧时序：等到闸门落地、模型路由兜底与"兜底必须自报家门"。不起服务器、不联网、不跑模型。',
}, null, 2))
process.exit(failures.length ? 1 : 0)
