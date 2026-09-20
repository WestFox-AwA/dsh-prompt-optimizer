// P8 · **生产接线**（A15）的单测。
//
// 这个文件要守住的是 EV-0078 那类事故：**代码全对，但生产路径上没人调用它**。
// 所以这里不只是测纯函数——最后一组测试**走真实的 apply() 路径**：
// 造一个假 ctx、触发一条真实形状的 user/message 事件，看意图包有没有真的被写进上下文。
// 谁把生产订阅删掉，这组测试就会红。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isRealUserInput, extractUserText, extractMessageId, extractObservedModel,
  resolveInterpreterCfg, decideInterpret, resolveProfileName,
} from '../lib/wire.js'

const HERE = dirname(fileURLToPath(import.meta.url))

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }
const ta = async (name, fn) => { try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const USER_TEXT = '帮我写一个把秒数格式化的函数，用 Python，不要解释。'
// 夹具里的 sourceRefs 必须指向**这一次**的消息（否则 reducer 会拒），
// 所以每个用例先把 SID/MID 设成自己那一次的值，再造假 LLM。
let SID = 'session-a15'
let MID = 'm-1'
const userEvent = (text = USER_TEXT, id = 'm-1') => ({
  type: 'user/message',
  data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
/** 插件自己的投递：形状与宿主实测日志一致（EV-0078 抓到的那条）。 */
const pluginEvent = (text, id = 'm-plugin') => ({
  type: 'user/message',
  data: {
    id, role: 'user',
    source: { kind: 'plugin', plugin: '@dsh-external/dsh-po06', form: 'snapshot' },
    content: [{ type: 'text', text }],
  },
})

// ── 1. 只认"人"的输入：防自激循环 ─────────────────────────────────────
// 投递本身也是一条 user/message。若不过滤来源，包会触发解释、解释产出新包，
// 形成自激循环——这是本模块最容易写错、后果最严重的一处。
t('只有 source.kind=user 才算用户输入（否则会自激循环）', () => {
  eq(isRealUserInput(userEvent()), true, '真人输入')
  eq(isRealUserInput(pluginEvent('意图包')), false,
    '**插件自己的投递绝不能被当成用户输入**（自激循环）')
  eq(isRealUserInput({
    type: 'user/message',
    data: { source: { kind: 'skill-catalog', form: 'catalog' }, content: [{ type: 'text', text: 'x' }] },
  }), false, '技能目录不算')
  eq(isRealUserInput({ type: 'request/header', data: {} }), false, '别的类型不算')
  eq(isRealUserInput({ type: 'user/message', data: {} }), false, '没有 source 不算')
  eq(isRealUserInput(null), false, 'null 不算')
})

t('取文本：只取 text 块、逐块去空白、拼接', () => {
  eq(extractUserText(userEvent()), USER_TEXT, '单块')
  eq(extractUserText({
    type: 'user/message',
    data: { content: [{ type: 'text', text: '  a  ' }, { type: 'image' }, { type: 'text', text: 'b' }] },
  }), 'a\nb', '多块拼接且忽略非文本块（逐块去空白，便于逐字引文比对）')
  eq(extractUserText({ type: 'user/message', data: { content: [{ type: 'text', text: '   ' }] } }),
    '', '全空白 ⇒ 空（会被当成没有输入，不解释）')
  eq(extractUserText({ type: 'user/message', data: { content: 'raw' } }), 'raw', '字符串内容')
  eq(extractUserText({ type: 'user/message', data: { content: [] } }), '', '空')
  eq(extractUserText({ type: 'user/message', data: {} }), '', '没有 content')
})

t('消息 id 是幂等键，缺了必须返回 null（不得用随机值兜底）', () => {
  eq(extractMessageId(userEvent()), 'm-1', '正常')
  eq(extractMessageId({ type: 'user/message', data: { id: '' } }), null, '空串不算')
  eq(extractMessageId({ type: 'user/message', data: {} }), null, '缺失不算')
})

// ── 2. 解释层用哪个模型 ───────────────────────────────────────────────
t('从会话事件里读出宿主自己在用的模型', () => {
  eq(extractObservedModel({
    type: 'request/header',
    data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
  }), { provider: 'deepseek-official', model: 'deepseek-flash' }, 'request/header')
  eq(extractObservedModel({ type: 'request/context', data: { provider: 'p', model: 'm' } }),
    { provider: 'p', model: 'm' }, 'request/context')
  eq(extractObservedModel({ type: 'request/header', data: { header: { config: { provider: 'p' } } } }),
    null, '缺 model ⇒ null（不猜）')
  eq(extractObservedModel({ type: 'user/message', data: {} }), null, '别的类型不提供模型')
})

t('模型解析：显式配置优先，否则用观测到的，都没有 ⇒ 明确失败', () => {
  const cfg = { interpreter: { provider: 'cfg-p', model: 'cfg-m' } }
  eq(resolveInterpreterCfg({ config: cfg, observed: { provider: 'obs-p', model: 'obs-m' } }),
    { ok: true, provider: 'cfg-p', model: 'cfg-m', source: 'config' }, '配置优先')
  eq(resolveInterpreterCfg({ observed: { provider: 'obs-p', model: 'obs-m' } }),
    { ok: true, provider: 'obs-p', model: 'obs-m', source: 'observed' }, '退回观测值')
  eq(resolveInterpreterCfg({}), { ok: false, reason: 'no-model-route' }, '都没有 ⇒ 不解释（不编造）')
  // 半截配置不得把观测值带偏，也不得拼出一个 provider/model 混搭的组合
  eq(resolveInterpreterCfg({ config: { interpreter: { provider: 'cfg-p' } }, observed: { provider: 'obs-p', model: 'obs-m' } }),
    { ok: true, provider: 'obs-p', model: 'obs-m', source: 'observed' }, '半截配置 ⇒ 整体退回观测值')
  eq(resolveInterpreterCfg({ config: { interpreter: { provider: '', model: 'm' } } }).ok, false, '空串不算有效配置')
})

// ── 3. 跳过原因必须说得清（EV-0078 的教训：什么都不发生时查不出原因）──
t('每个跳过原因都有独立代码，且优先级明确', () => {
  const good = { isUserInput: true, text: 'x', gateEnabled: true, cfg: { ok: true }, llmAvailable: true }
  eq(decideInterpret(good), { ok: true, reason: 'ok' }, '全绿才解释')
  eq(decideInterpret({ ...good, isUserInput: false }).reason, 'not-user-input', '非用户输入')
  eq(decideInterpret({ ...good, text: '' }).reason, 'empty-text', '空输入不解释')
  eq(decideInterpret({ ...good, gateEnabled: false }).reason, 'gate-disabled', '闸门未启用')
  eq(decideInterpret({ ...good, gateEnabled: undefined }).reason, 'gate-disabled', '闸门未判定（保守）')
  eq(decideInterpret({ ...good, llmAvailable: false }).reason, 'llm-unavailable', '没有 LLM 服务')
  eq(decideInterpret({ ...good, cfg: { ok: false, reason: 'no-model-route' } }).reason, 'no-model-route', '没有模型路由')
  eq(decideInterpret({ ...good, cfg: null }).reason, 'no-model-route', 'cfg 缺失')
})

// ── 3b. profile 解析（静态探测查的是哪个目录）─────────────────────────
// 写死 `profiles/web` 的后果不是报错，而是**在别的 profile 下回答另一个 profile 的问题**
// ——查错对象的缺陷最阴，因为结论看起来永远有（EV-0081）。
t('profile 解析：--profile / --profile= / 裸子命令 / 兜底', () => {
  eq(resolveProfileName({ argv: ['node', 'dsh', '--profile', 'headless', '任务'] }).name, 'headless', '--profile X')
  eq(resolveProfileName({ argv: ['node', 'dsh', '--profile=headless'] }).name, 'headless', '--profile=X')
  eq(resolveProfileName({ argv: ['node', 'dsh', 'web'] }).name, 'web', '裸子命令 web')
  eq(resolveProfileName({ argv: ['node', 'dsh'] }).name, 'web', '什么都没给 ⇒ 默认 web')
  eq(resolveProfileName({ argv: ['node', 'dsh', '--profile', 'headless'] }).source, 'argv', '来源可复核')
  // profile 不存在 ⇒ 退回 web，但**如实标注**退回过，不假装就是 web
  const fb = resolveProfileName({ argv: ['node', 'dsh', '--profile', 'nope'], profileExists: () => false })
  eq(fb, { name: 'web', source: 'fallback', requested: 'nope' }, '不存在时退回并标注')
  eq(resolveProfileName({ argv: ['node', 'dsh', '--profile', 'headless'], profileExists: () => true }).source, 'argv',
    '存在时不得退回')
  // 顺序：--profile 优先于裸子命令
  eq(resolveProfileName({ argv: ['node', 'dsh', '--profile', 'tui', 'web'] }).name, 'tui', '--profile 优先')
  // 形态健壮性
  eq(resolveProfileName({}).name, 'web', '无参')
  eq(resolveProfileName({ argv: 'not-an-array' }).name, 'web', '非数组输入不炸')
})

// ── 4. A15 验收：走真实 apply()，包必须真的落进上下文 ────────────────
/**
 * 最小但**忠实**的假宿主投影服务：注册 + 按事件 fold 出状态。
 * 为什么不能省：`intentStateOf` 在投影未注册时返回 `undefined`（不是 `null`），
 * 而流水线只在 `=== null` 时才初始化状态 ⇒ 没有投影服务，整条链会静默什么都不做。
 * 这正是"生产可达性"要求连**宿主依赖**一起验的原因。
 */
function fakeProjections() {
  const defs = new Map()
  const states = new Map()
  return {
    register(def) { defs.set(def.key, def); return () => {} },
    stateOf(session, key) {
      const def = defs.get(key)
      if (!def) return undefined
      const sid = String(session.id)
      return states.has(sid) ? states.get(sid) : def.init()
    },
    /** 模拟宿主：append 出来的事件会被投影 fold 进该会话的状态。 */
    fold(session, event) {
      const sid = String(session.id)
      for (const def of defs.values()) {
        const cur = states.has(sid) ? states.get(sid) : def.init()
        states.set(sid, def.apply(cur, event))
      }
    },
  }
}

/**
 * 假 session：`append(type, data)` 与宿主同形（见 projection.js 的调用点），
 * 并且**复刻宿主的重入禁令**：事件正在发布期间不得再 append。
 *
 * 为什么要复刻这条：真实宿主会抛
 * `session append cannot reenter while another append is being published`（EV-0080）。
 * 第一版假宿主没有这条约束，于是"在 session/event 处理器里同步 append"这种写法
 * **测试全绿、真机全败**。假宿主比真宿主宽松，就等于把最危险的一类缺陷挡在测试之外。
 */
function fakeSession(sid, projections) {
  const s = {
    id: sid,
    publishing: false,
    append(type, data) {
      if (s.publishing) throw new Error('session append cannot reenter while another append is being published')
      projections.fold({ id: sid }, { type, data })
    },
  }
  return s
}

/**
 * 造一个假 ctx：只提供插件真正用到的那几个面（on/effect/get/inject）。
 * `agents` 必须给：`handleInput` 有一道入口守卫（缺它就返回 `no-agents-service` 而什么都不做）——
 * 那也是一条**静默无事发生**的路径，所以它会照样被记进台账，测试里也就能看见。
 */
function fakeCtx({ llm }) {
  const handlers = []
  const agents = { get: (id) => ({ id }) }
  const projections = fakeProjections()
  return {
    handlers,
    projections,
    on(name, fn) { handlers.push({ name, fn }); return () => {} },
    effect() { return () => {} },
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agents') return agents
      return undefined
    },
    inject(deps, fn) {
      // 只满足本插件真正声明的注入；其余原样忽略（自检里才需要更多）
      const scope = {}
      if (Array.isArray(deps) && deps.includes('sessionProjections')) scope.sessionProjections = projections
      try { fn(scope) } catch { /* 缺服务时插件自己会降级 */ }
    },
  }
}

/**
 * 假 LLM：按块吐出一段合法的解释器 JSON。**不花任何钱**。
 * `reply` 可以是字符串，也可以是**惰性求值**的函数——夹具里的 sid/messageId
 * 必须在**真正被调用的那一刻**才确定，否则会与本次事件对不上。
 */
function fakeLlm(reply) {
  const calls = []
  return {
    calls,
    stream(opts) {
      calls.push(opts)
      const json = typeof reply === 'function' ? reply() : reply
      const chunks = [
        { type: 'text-delta', text: json },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
        { type: 'finish', finish: 'stop' },
      ]
      return (async function* () { for (const c of chunks) yield c })()
    },
  }
}

/**
 * 一份**合法**的解释器输出（形状照抄 reducer/项目既有夹具）：
 * `id` 与 `sourceRefs` 都是必需的——缺了就只会在 dryRun 被 reducer 拒掉，
 * 于是"解释成功了但没写进任何东西"，看起来像接线没通，其实是夹具不合格。
 */
const interpreterReply = ({ sid, mid, quote = '不要解释' }) => JSON.stringify({
  ops: [{
    op: 'add_item',
    item: {
      id: 'req-seconds',
      kind: 'user_requirement',
      text: '用 Python 写一个秒数格式化函数',
      quote,
      sourceRefs: [{ kind: 'human', sessionId: sid, messageId: mid }],
    },
  }],
})

/**
 * 触发一条会话事件。
 * **必须喂给所有订阅者**——宿主就是这么派发的，而且本插件自己就有多个
 * `session/event` 订阅（交付门 + 生产触发）。只挑第一个会让测试看着通过、
 * 实际测的是另一个处理器（第一次写这个测试时就踩了，包因此一直是空的）。
 */
function emit(ctx, session, event) {
  const hs = ctx.handlers.filter((x) => x.name === 'session/event')
  if (session) session.publishing = true
  try {
    for (const h of hs) h.fn(session, event)
  } finally {
    if (session) session.publishing = false
  }
  return hs.length
}

/** 让 fire-and-forget 的生产链路跑完（调用方**故意不 await**，所以测试自己等）。 */
async function settle(ms = 400) { await new Promise((r) => setTimeout(r, ms)) }

/** 宿主真实发过的形状（EV-0078 的会话日志里逐字核对过）。 */
const headerEvent = (provider = 'deepseek-official', model = 'deepseek-flash') => ({
  type: 'request/header',
  data: { header: { config: { provider, model, maxTokens: 256000, reasoningEffort: 'high' } } },
})

// ⚠ **顺序有意义**：模型观测在进程内是共享的（本会话优先、全局兜底）。
// 这一条必须在**任何**观测发生之前跑，否则它会继承别的用例的观测值。
// 它同时守两件事：① 没有模型就不解释（不编造路由）；② 模型一出现立刻**补跑**待办输入。
await ta('A15：模型未知时记下待办；模型一出现立刻补跑（包落在同一轮第 2 步）', async () => {
  const mod = await import('../lib/index.js')
  const llm = fakeLlm(() => interpreterReply({ sid: SID, mid: MID }))
  const ctx = fakeCtx({ llm })
  mod.apply(ctx, {})
  const sid = 'session-a15-nomodel'
  SID = sid; MID = 'm-nomodel'
  mod.adapter.enableGate.set(sid, { enabled: true, code: 'test-forced-enabled', reason: '单测放行' })
  const sess = fakeSession(sid, ctx.projections)

  // ① 没有任何 request/header 观测值、配置也是空的 ⇒ **跳过**而不是瞎猜
  emit(ctx, sess, userEvent(USER_TEXT, 'm-nomodel'))
  await settle(150)
  eq(llm.calls.length, 0, '没有模型路由时不得调用模型')
  eq(mod.adapter.getIntentText(sid), '', '也不得写入任何包')

  // ② 宿主随后发出请求头（真实顺序：**先**用户消息、**后** request/header）
  //    ⇒ 待办必须被补跑，包落在**同一轮**后续步骤，而不是白等一整轮
  emit(ctx, sess, headerEvent())
  await settle()
  eq(llm.calls.length, 1, '模型出现后必须补跑一次解释')
  eq(llm.calls[0].model, 'deepseek-flash', '补跑用的是观测到的模型')
  ok((mod.adapter.getIntentText(sid) || '').length > 0, '补跑必须真的把包写进上下文')
})

await ta('A15：真实 apply() 路径下，用户输入会经解释编译成包并写进上下文', async () => {
  const mod = await import('../lib/index.js')
  const llm = fakeLlm(() => interpreterReply({ sid: SID, mid: MID }))
  const ctx = fakeCtx({ llm })
  mod.apply(ctx, {})

  ok(ctx.handlers.filter((x) => x.name === 'session/event').length >= 1,
    '**必须**注册 session/event 处理器（A15：这就是 EV-0078 缺失的那一环）')

  // 闸门默认未判定 ⇒ 保守不启用。显式放行这个会话（等价于配置 enabled:true + 无双重拦截）。
  const sid = 'session-a15'
  mod.adapter.enableGate.set(sid, { enabled: true, code: 'test-forced-enabled', reason: '单测放行' })
  SID = sid; MID = 'm-1'
  // 宿主会先发一条 request/header（解释层据此知道该用哪个模型）
  const sess = fakeSession(sid, ctx.projections)
  emit(ctx, sess, headerEvent())

  emit(ctx, sess, userEvent())
  await settle()

  const text = mod.adapter.getIntentText(sid)
  ok(text && text.length > 0,
    '意图包必须真的写进该会话的上下文（写不进去 = 生产路径仍然不通）。实际：' + JSON.stringify(text))
  eq(llm.calls.length, 1, '应当恰好调用一次解释层')
  // 用的是宿主的 system 槽（一次性调用者路径），而不是评估台那条硬编码 import
  ok(typeof llm.calls[0].system === 'string' && llm.calls[0].system.length > 0, '必须带系统提示词')
  eq(llm.calls[0].messages.length, 1, '只带一条用户消息')
  eq(llm.calls[0].provider, 'deepseek-official', '用宿主观测到的 provider')
  eq(llm.calls[0].model, 'deepseek-flash', '用宿主观测到的 model')
})

await ta('A15：插件自己的投递**不得**触发第二次解释（防自激循环）', async () => {
  const mod = await import('../lib/index.js')
  const llm = fakeLlm(() => interpreterReply({ sid: SID, mid: MID }))
  const ctx = fakeCtx({ llm })
  mod.apply(ctx, {})
  const sid = 'session-a15-loop'
  mod.adapter.enableGate.set(sid, { enabled: true, code: 'test-forced-enabled', reason: '单测放行' })
  SID = sid; MID = 'm-real'
  const sess = fakeSession(sid, ctx.projections)
  emit(ctx, sess, headerEvent())

  emit(ctx, sess, userEvent(USER_TEXT, 'm-real'))
  await settle()
  const after1 = llm.calls.length
  ok(after1 >= 1, '真人输入必须先触发一次解释，否则这条测试没有意义')

  emit(ctx, sess, pluginEvent(mod.adapter.getIntentText(sid)))
  await settle()
  eq(llm.calls.length, after1, '插件投递不得触发解释（否则自激循环）')
})

await ta('A15：闸门未放行时，绝不调用模型（保守方向）', async () => {
  const mod = await import('../lib/index.js')
  const llm = fakeLlm(() => interpreterReply({ sid: SID, mid: MID }))
  const ctx = fakeCtx({ llm })
  mod.apply(ctx, {})
  // 不设闸门 ⇒ 未判定 ⇒ 不启用
  const gated = fakeSession('session-a15-gated', ctx.projections)
  emit(ctx, gated, headerEvent())
  emit(ctx, gated, userEvent(USER_TEXT, 'm-gate'))
  await settle()
  eq(llm.calls.length, 0, '未放行时一次模型调用都不能发生')
  eq(mod.adapter.getIntentText('session-a15-gated'), '', '也不得写入任何包')
})

// ── 5. 静态守卫：生产调用点必须在（防"注释与代码一起过期"）────────────
t('index.js 里存在生产调用点（A15 反回归的静态检查）', () => {
  const src = readFileSync(join(HERE, '..', 'lib', 'index.js'), 'utf8')
  ok(/ctx\.on\('session\/event'/.test(src), '必须有 session/event 订阅')
  ok(/defer\(\(\) => runProductionInput\(/.test(src),
    '订阅里必须调用 runProductionInput，且**必须经 defer 推迟**')
  ok(/adapter\.handleInput\(/.test(src), 'runProductionInput 必须调用 adapter.handleInput')
  ok(/isRealUserInput\(/.test(src), '必须先过滤来源（防自激循环）')
  // 重入禁令：在 session/event 派发窗口里同步 append 会被宿主拒绝（EV-0080）
  ok(/function defer\(/.test(src), '必须有 defer 帮助函数')
  const selfcheckIdx = src.indexOf('if (SELF_CHECK)')
  const callIdx = src.indexOf('defer(() => runProductionInput(')
  ok(callIdx > 0, '生产调用点必须存在')
  ok(selfcheckIdx === -1 || callIdx < selfcheckIdx,
    '生产调用点必须在自检分支**之外/之前**（否则又变成只有自检才会跑）')
})

console.log(JSON.stringify({
  suite: 'po06-wire', phase: 'P8-A15',
  total: pass + failures.length, pass, fail: failures.length, failures,
}, null, 2))
if (failures.length > 0) process.exit(1)
