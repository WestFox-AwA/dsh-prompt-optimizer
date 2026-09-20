// dsh-prompt-optimizer 0.6 · P1 最薄 DshAdapter
//
// 职责边界（严格限制，P1 只做接入，不做智能）：
//   ① 把「当前意图包文本」注册成动态上下文，由**宿主**负责合并/排序/去重（EV-0014）。
//   ② 提供不唤醒的投递：plugin 来源消息 → agent.inject（ADR-0012 的默认档）。
//   ③ 唤醒式投递单独一个方法，且**只允许调用方在已授权场景下使用**（本原型不主动调用它）。
//
// 明确不做：不调用 LLM、不做质量展开、不解析用户输入、不注册路由、不写用户会话内容。
//
// 两条 P1-6 实测教训（都写进了实现）：
//   · `ctx.inject` 的回调**不是同步执行**的 → 必须 await 就绪信号，不能假定服务立即可用。
//   · 动态上下文是**全局注册**的：只要文本非空，就会进入**所有**会话（含用户正在用的那个）
//     → 静默待命时文本必须为空（空文本被宿主聚合渲染过滤掉），只在确有内容时才置非空。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  createStats, createProjectionDefinition, commitPatch, PROJECTION_KEY, STATE_EVENT,
} from './projection.js'
import { recordUserInput } from './reducer.js'
import { createState } from './schema.js'
import { handleUserInput } from './pipeline.js'
import { verifyHtmlFile } from './verifier-html.js'
import { runGate, createMemoryLedgerStore, LEVEL, resolveLevel } from './gate.js'
import { detectOldPluginRuntime, mergeOldPluginSignals } from './detect-old.js'
import { decideEnabled } from './rollout.js'
import {
  createEnableGate, parseEnableIntent, resolveEnableDecision, toActiveTriState, PENDING,
} from './assembly-gate.js'

const EVIDENCE_DIR = 'C:/Users/WestFox/.dsh/exp/po06/probe-reports'
const CONTEXT_NAME = 'prompt-optimizer:intent'
// order 取 9100：排在宿主与其它插件（110–362 段）之后，使意图包出现在聚合快照靠后位置。
const CONTEXT_ORDER = 9100
const LLM_LIB = 'file:///C:/Users/WestFox/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
// 自检开关：环境变量或标记文件（后者可在运行期通过"创建文件 + 热重载"触发）
const SELFCHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-selfcheck.flag'
const SELF_CHECK = process.env.DSH_PO06_SELFCHECK === '1' || existsSync(SELFCHECK_FLAG)
// P2 自检开关（投影接线 / CAS / 调用量实测）
const P2CHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-p2check.flag'
const P2_CHECK = process.env.DSH_PO06_P2CHECK === '1' || existsSync(P2CHECK_FLAG)
// P3 自检开关（流水线接进真实宿主：状态走真实投影，意图包走真实 systemPrompt.context）
const P3CHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-p3check.flag'
const P3_CHECK = process.env.DSH_PO06_P3CHECK === '1' || existsSync(P3CHECK_FLAG)
// P6 自检开关（交付门真实链路）
const P6CHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-p6check.flag'
const P6_CHECK = process.env.DSH_PO06_P6CHECK === '1' || existsSync(P6CHECK_FLAG)
// P8 自检开关（旧插件运行时探测 / 启动闸门）
const P8CHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-p8check.flag'
const P8_CHECK = process.env.DSH_PO06_P8CHECK === '1' || existsSync(P8CHECK_FLAG)
// P8b 自检开关（装配期启用闸门**接线**验证：默认抑制 / 强制放行两侧对照）
const P8BCHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-p8bcheck.flag'
const P8B_CHECK = process.env.DSH_PO06_P8BCHECK === '1' || existsSync(P8BCHECK_FLAG)
// 交付门**生产触发**默认关闭：每次交付都启动浏览器是重操作，是否开启属于设置决策（P8）
const GATE_TRIGGER_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/enable-gate-trigger.flag'
const gateLedgers = createMemoryLedgerStore()
// apply 调用量统计（不进入持久状态）
const projectionStats = createStats()

// ── 装配期启用闸门的配置来源 ──────────────────────────────────────────
// 用户的 0.6 配置。**读不到就按不启用**（保守方向）——启用必须是显式成立的。
const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || 'C:/Users/WestFox', '.dsh')
const ENABLE_CONFIG_PATH = join(DSH_HOME, 'prompt-optimizer.json')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'web')

/** 读启用意图；任何异常都不抛出，一律回落到保守值。 */
function readEnableIntent() {
  try {
    if (!existsSync(ENABLE_CONFIG_PATH)) return parseEnableIntent('')
    return parseEnableIntent(readFileSync(ENABLE_CONFIG_PATH, 'utf8'))
  } catch { return parseEnableIntent('') }
}

/**
 * 解析某个会话的启用判定，并把探测结果映射成**三态**。
 * 注意 `toActiveTriState`：探测拿不到作用域时返回 null（不知道）→ 不启用，
 * 绝不把"没法判"当成"旧插件不在装"（ADR-0033）。
 */
async function decideEnableFor(agentId) {
  const intent = readEnableIntent()
  let active = null
  try {
    const agent = adapter.agentFor(agentId)
    const sp = adapter.services.systemPrompt
    if (sp && agent) {
      const rt = await detectOldPluginRuntime({ systemPrompt: sp, agent })
      let st = null
      try {
        const { detectOldPluginStatic } = await import('./host-migrate.js')
        st = detectOldPluginStatic(PROFILE_DIR)
      } catch { st = null }
      active = toActiveTriState(mergeOldPluginSignals(rt, st))
    }
  } catch { active = null }
  return resolveEnableDecision({ intent, sessionId: agentId, oldPluginActive: active })
}

export const name = '@dsh-external/dsh-po06'

class DshAdapter {
  constructor() {
    // **按会话隔离**：意图包文本是 per-session 的。
    // 早期版本用一个全局字符串，会让 A 会话的意图泄漏进 B 会话（违反隔离不变量）。
    // `systemPrompt.context` 的 text(context) 能拿到 `context.agent`，据此取会话 id。
    this.intentBySession = new Map()
    this.contextDisposer = null
    this.services = { agents: null, sessionController: null, systemPrompt: null, sessionProjections: null }
    this.readyResolvers = []
    this.ready = new Promise((resolve) => this.readyResolvers.push(resolve))
    this.projectionDisposer = null
    this.projectionResolvers = []
    this.projectionReady = new Promise((resolve) => this.projectionResolvers.push(resolve))
  }

  markReady() {
    const rs = this.readyResolvers
    this.readyResolvers = []
    for (const r of rs) { try { r() } catch { /* best effort */ } }
  }

  /** 投影就绪信号（与 systemPrompt 的就绪分开，避免一个慢服务拖住另一个）。 */
  markProjectionReady() {
    const rs = this.projectionResolvers
    this.projectionResolvers = []
    for (const r of rs) { try { r() } catch { /* best effort */ } }
  }

  async waitProjectionReady(timeoutMs = 3000) {
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    const r = await Promise.race([this.projectionReady.then(() => true), timeout])
    if (timer) clearTimeout(timer)
    return r === true
  }

  /** 读某会话的意图状态（经投影）。未注册返回 undefined；尚无状态返回 null。 */
  intentStateOf(session) {
    const sp = this.services.sessionProjections
    if (!sp || typeof sp.stateOf !== 'function') return undefined
    try { return sp.stateOf(session, PROJECTION_KEY) } catch { return undefined }
  }

  /** 提交候选 patch：CAS → reducer → append 完整状态（见 projection.js）。 */
  commit(session, patch) {
    return commitPatch({ session, currentState: this.intentStateOf(session), patch })
  }

  /** 记录一次用户输入（推进 lastInputRevision，使在途候选作废）。 */
  commitUserInput(session, { messageId }) {
    const cur = this.intentStateOf(session)
    if (!cur) return { ok: false, code: 'NO_BASE_STATE' }
    const next = recordUserInput(cur, { messageId })
    session.append(STATE_EVENT, next)
    return { ok: true, state: next }
  }

  /** 新建一个空意图状态（经 reducer 的权威路径提交，避免绕过闸门）。 */
  initIntent(session, { taskId }) {
    const sid = String(session.id)
    return this.commit(session, {
      causeId: 'init',
      baseRevision: 0,
      sessionId: sid,
      taskId: taskId || 'default',
      ops: [{ op: 'set_phase', phase: 'idle' }],
    })
  }

  /**
   * 产品入口：处理一次用户输入（解释 → 提交 → 编译 → 写入动态上下文）。
   * `interpret` 是**注入**的解释函数；真实实现接 LLM，测试/自检传桩。
   */
  async handleInput(session, { messageId, text, interpret, observations, taskId }) {
    const agents = this.services.agents
    if (!agents || typeof agents.get !== 'function') {
      return { outcome: 'no-agents-service', trace: [] }
    }
    return handleUserInput(this, session, { messageId, text, interpret, observations, taskId })
  }

  /** 等待可选注入就绪；超时返回 false（调用方必须处理 false）。 */
  async waitReady(timeoutMs = 3000) {
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    const r = await Promise.race([this.ready.then(() => true), timeout])
    if (timer) clearTimeout(timer)
    return r === true
  }

  /** 更新**某会话**的意图包文本的唯一入口。空字符串 = 该会话静默待命。 */
  setIntentText(sessionId, text) {
    const sid = String(sessionId == null ? '' : sessionId)
    if (!sid) return
    const t = String(text == null ? '' : text)
    if (t) this.intentBySession.set(sid, t)
    else this.intentBySession.delete(sid)
  }

  /** 取某会话当前的意图包文本（诊断/测试用）。 */
  getIntentText(sessionId) {
    return this.intentBySession.get(String(sessionId == null ? '' : sessionId)) || ''
  }

  /** 当前有意图包的会话数（诊断用）。 */
  intentSessionCount() {
    return this.intentBySession.size
  }

  registerContext(ctx) {
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        try {
          this.services.systemPrompt = scope.systemPrompt
          this.contextDisposer = scope.systemPrompt.context({
            name: CONTEXT_NAME,
            order: CONTEXT_ORDER,
            // 按会话渲染：装配 context 携带 agent，据此取该会话的意图包；取不到就是空（静默）
            text: (assemblyCtx) => {
              try {
                const agent = assemblyCtx && assemblyCtx.agent
                const sid = agent && agent.id !== undefined ? String(agent.id) : ''
                if (!sid) return ''
                // ── 启用闸门（A10/A12）──────────────────────────────
                // 灰度 + 设置 + 双重拦截守卫**在这里**生效，而不是只在自检里生效。
                // 未判定时 statusFor 返回 PENDING（=不启用）⇒ 贡献空字符串 ⇒ 等同于没拦截。
                const st = adapter.enableGate ? adapter.enableGate.ensure(sid) : PENDING
                if (!st || st.enabled !== true) return ''
                return this.intentBySession.get(sid) || ''
              } catch { return '' }
            },
          })
        } finally {
          this.markReady()
        }
      })
      return true
    } catch {
      this.markReady()
      return false
    }
  }

  /** 取当前 live agent；找不到返回 null（调用方必须处理 null，不得猜）。 */
  agentFor(sessionId) {
    const agents = this.services.agents
    if (!agents || typeof agents.get !== 'function' || !sessionId) return null
    try { return agents.get(sessionId) || null } catch { return null }
  }

  buildMessage(llm, text, summary) {
    return llm.createUserMessage({
      content: [{ type: 'text', text: String(text) }],
      source: {
        kind: 'plugin',
        plugin: '@dsh-external/dsh-po06',
        form: 'notice',
        summary: String(summary || '').slice(0, 120),
      },
    })
  }

  /**
   * 不唤醒投递：排入 next-step，不启动生成、不产生模型调用（EV-0020）。0.6 的默认投递方式。
   */
  async deliverNotice(sessionId, text, summary) {
    const agent = this.agentFor(sessionId)
    if (!agent) return { ok: false, reason: 'agent-not-found' }
    if (typeof agent.inject !== 'function') return { ok: false, reason: 'inject-unavailable' }
    try {
      const llm = await import(LLM_LIB)
      const msg = this.buildMessage(llm, text, summary)
      agent.inject(msg)
      return { ok: true, messageId: String(msg.id) }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /**
   * 唤醒式投递。**调用方必须已在用户授权范围内**（ADR-0012）。
   * 本原型不主动调用；保留接口以便 P4/P6 在授权路径中复用。
   */
  async deliverAndWake(sessionId, text, summary) {
    const agent = this.agentFor(sessionId)
    if (!agent) return { ok: false, reason: 'agent-not-found' }
    if (typeof agent.followup !== 'function') return { ok: false, reason: 'followup-unavailable' }
    try {
      const llm = await import(LLM_LIB)
      const msg = this.buildMessage(llm, text, summary)
      agent.followup(msg)
      return { ok: true, messageId: String(msg.id) }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  dispose() {
    try { if (typeof this.contextDisposer === 'function') this.contextDisposer() } catch { /* best effort */ }
    try { if (typeof this.projectionDisposer === 'function') this.projectionDisposer() } catch { /* best effort */ }
    this.contextDisposer = null
    this.projectionDisposer = null
  }
}

export const adapter = new DshAdapter()

function writeReport(report) {
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    writeFileSync(join(EVIDENCE_DIR, 'adapter-' + Date.now() + '.json'), JSON.stringify(report, null, 2), 'utf8')
  } catch { /* best effort */ }
}

export function apply(ctx) {
  const report = {
    probe: 'dsh-po06-adapter',
    phase: 'P1-6',
    at: new Date().toISOString(),
    note: '最薄 DshAdapter。生产路径：静默待命 + 不唤醒投递；自检只在 DSH_PO06_SELFCHECK=1 时运行',
    steps: {},
  }

  adapter.services.agents = ctx.get('agents') || null
  adapter.services.sessionController = ctx.get('sessionController') || null
  report.steps.services = {
    agents: typeof adapter.services.agents,
    sessionController: typeof adapter.services.sessionController,
  }
  // ── 装配期启用闸门（A10/A12）：拦截是否生效由它决定，默认不生效 ──
  adapter.enableGate = createEnableGate({ decide: decideEnableFor })
  report.steps.enableGate = (() => {
    const i = readEnableIntent()
    return {
      configPath: ENABLE_CONFIG_PATH,
      configExists: existsSync(ENABLE_CONFIG_PATH),
      intent: { ok: i.ok, ours: i.ours, reason: i.reason, enabled: i.settings.enabled, rolloutMode: i.rollout.mode },
      note: '未判定期间一律不启用（保守）；判定按 agent 懒触发',
    }
  })()

  report.steps.registerContext = { ok: adapter.registerContext(ctx), name: CONTEXT_NAME, order: CONTEXT_ORDER }
  report.steps.restingTextIsEmpty = adapter.getIntentText() === ''

  // ── 注册意图状态投影（产品路径）────────────────────────────────
  report.steps.registerProjection = (() => {
    try {
      ctx.inject(['sessionProjections'], (scope) => {
        try {
          adapter.services.sessionProjections = scope.sessionProjections
          adapter.projectionDisposer = scope.sessionProjections.register(
            createProjectionDefinition(projectionStats),
          )
        } finally {
          adapter.markProjectionReady()
        }
      })
      return { ok: true, key: PROJECTION_KEY, stateVersion: 1, event: STATE_EVENT }
    } catch (e) {
      adapter.markProjectionReady()
      return { ok: false, reason: String((e && e.message) || e) }
    }
  })()

  // ── 交付门触发（默认关闭；见 GATE_TRIGGER_FLAG）────────────────
  try {
    const off = ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'deliverables/presented') return
        if (!existsSync(GATE_TRIGGER_FLAG)) return          // 未显式开启 → 不做任何事
        const files = Array.isArray(event.data && event.data.files) ? event.data.files : []
        for (const f of files) {
          const p = f && typeof f.path === 'string' ? f.path : null
          if (!p || !/\.html?$/i.test(p)) continue          // 只对本验证器的适用范围生效
          void runGateFor(session, p).catch(() => {})
        }
      } catch { /* 交付门是旁路，绝不打断会话 */ }
    })
    ctx.effect(() => () => { try { if (typeof off === 'function') off() } catch { /* best effort */ } }, 'dsh-po06: delivery gate trigger')
  } catch { /* 注册失败不影响插件本体 */ }

  ctx.effect(() => () => adapter.dispose(), 'dsh-po06: adapter dispose')

  if (!SELF_CHECK) {
    report.ok = report.steps.registerContext.ok === true && report.steps.restingTextIsEmpty === true
    report.verdict = 'IDLE: 已注册并静默待命（未运行自检；设 DSH_PO06_SELFCHECK=1 开启）'
    writeReport(report)
    if (P8_CHECK) runP8Check(ctx)
    if (P8B_CHECK) runP8bCheck(ctx)
    if (P6_CHECK) runP6Check(ctx)
    if (P3_CHECK) runP3Check(ctx)
    if (P2_CHECK) runP2Check(ctx)
    return
  }

  void (async () => {
    let testSessionId = null
    try {
      report.steps.injectReady = { ready: await adapter.waitReady(3000) }

      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      testSessionId = 'session-po06-adapter-selfcheck-' + Date.now().toString(36)
      report.testSessionId = testSessionId
      await sc.create({ sessionId: testSessionId, cwd: 'C:/Users/WestFox/.dsh/exp/po06/test-workspace' })
      const target = agents.get(testSessionId)
      if (!target) throw new Error('自检会话创建后取不到 agent')

      const sp = adapter.services.systemPrompt
      const M1 = '【意图包 · 自检 A】只读装配验证，不进入任何真实会话。'
      const M2 = '【意图包 · 自检 B】文本已变，验证动态求值。'

      // 只在**自检会话**的作用域里做只读装配；不产生消息投递
      adapter.setIntentText(M1)
      const a1 = await sp.assemble({ agent: target, scope: target })
      const c1 = a1.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembleA = {
        minePresent: Boolean(c1),
        mineChars: c1 ? String(c1.text).length : 0,
        mineIndex: a1.contexts.findIndex((c) => c.name === CONTEXT_NAME),
        contextCount: a1.contexts.length,
        names: a1.contexts.map((c) => c.name),
      }

      adapter.setIntentText(M2)
      const a2 = await sp.assemble({ agent: target, scope: target })
      const c2 = a2.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembleB = {
        minePresent: Boolean(c2),
        changed: Boolean(c2) && String(c2.text).includes('自检 B'),
      }

      // 立刻复位为静默——不让自检文本有任何机会进入别的会话
      adapter.setIntentText('')
      const a3 = await sp.assemble({ agent: target, scope: target })
      report.steps.resetToSilent = {
        minePresent: a3.contexts.some((c) => c.name === CONTEXT_NAME),
        mineChars: (() => {
          const c = a3.contexts.find((x) => x.name === CONTEXT_NAME)
          return c ? String(c.text).length : 0
        })(),
      }

      // 投递验证（不唤醒）：消息应留在队列，且不产生 turn/start
      const events = []
      const off = ctx.on('session/event', (s, e) => {
        try { if (s && String(s.id) === testSessionId) events.push(e.type) } catch { /* best effort */ }
      })
      const d = await adapter.deliverNotice(testSessionId, '【自检投递】不应唤醒。', 'P1-6 selfcheck')
      await new Promise((r) => setTimeout(r, 1200))
      report.steps.deliverNotice = {
        result: d,
        queued: target.inbox.nextStep.some((m) => String(m.id) === String(d.messageId)),
        turnStarted: events.filter((t) => t === 'turn/start').length,
        status: target.status,
      }
      try { off() } catch { /* best effort */ }
      if (d.ok) { try { target.inbox.remove(d.messageId) } catch { /* best effort */ } }
      try { target.cancel('po06-selfcheck-cleanup') } catch { /* best effort */ }

      report.ok = report.steps.assembleA.minePresent === true
        && report.steps.assembleB.changed === true
        && report.steps.resetToSilent.mineChars === 0
        && report.steps.deliverNotice.queued === true
        && report.steps.deliverNotice.turnStarted === 0
      report.verdict = report.ok
        ? 'PASS: 上下文注册+动态求值+静默复位+不唤醒投递 全部成立'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      adapter.setIntentText('')
      writeReport(report)
    }
  })()
}

/** P2 自检：投影接线 / 完整状态事件 / CAS 拒绝 / apply 调用量实测。 */function runP2Check(ctx) {
  const report = {
    probe: 'dsh-po06-p2check',
    phase: 'P2',
    at: new Date().toISOString(),
    note: '投影接线 + CAS + 调用量；只在自己建的测试会话上操作',
    steps: {},
  }
  const baseline = { ...projectionStats, sessionsSeen: projectionStats.sessionsSeen.size }

  void (async () => {
    try {
      report.steps.projectionReady = { ready: await adapter.waitProjectionReady(3000) }
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p2-proj-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: 'C:/Users/WestFox/.dsh/exp/po06/test-workspace' })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session

      // 1) 尚无状态
      report.steps.beforeInit = { state: adapter.intentStateOf(session) }

      // 2) 初始化（经 reducer 权威路径）
      const init = adapter.initIntent(session, { taskId: 'p2check' })
      report.steps.init = { ok: init.ok, code: init.code || null, revision: init.state ? init.state.revision : null }
      report.steps.afterInit = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, phase: s.phase, items: s.items.length } : s
      })()

      // 3) 正常提交：人类来源需求
      const cur = adapter.intentStateOf(session)
      const addHuman = adapter.commit(session, {
        causeId: 'c-add-human',
        baseRevision: cur.revision,
        baseInputRevision: cur.lastInputRevision,
        sessionId,
        ops: [{
          op: 'add_item',
          item: {
            id: 'req-1', kind: 'user_requirement', text: '单 HTML、可预览可操控',
            sourceRefs: [{ kind: 'human', sessionId, messageId: 'm1' }],
          },
        }],
      })
      report.steps.addHuman = { ok: addHuman.ok, code: addHuman.code || null }
      report.steps.afterAddHuman = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, items: s.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) } : s
      })()

      // 4) CAS：用**过期的 baseRevision** 再提交一次（模拟晚到的优化结果）
      const stale = adapter.commit(session, {
        causeId: 'c-stale',
        baseRevision: 0,   // 已过期
        sessionId,
        ops: [{ op: 'set_phase', phase: 'interpreting' }],
      })
      report.steps.staleRejected = { ok: stale.ok, code: stale.code || null, reason: String(stale.reason || '').slice(0, 120) }
      report.steps.afterStale = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, phase: s.phase } : s
      })()

      // 5) 用户改口：输入闸门
      const before = adapter.intentStateOf(session)
      const ui = adapter.commitUserInput(session, { messageId: 'm-user-2' })
      report.steps.userInput = { ok: ui.ok, revision: ui.state ? ui.state.revision : null, lastInputRevision: ui.state ? ui.state.lastInputRevision : null }
      const inFlight = adapter.commit(session, {
        causeId: 'c-inflight',
        baseRevision: before.revision,          // 与旧 revision 对齐，专测输入闸门
        baseInputRevision: before.lastInputRevision,
        sessionId,
        ops: [{ op: 'set_phase', phase: 'ready' }],
      })
      report.steps.inFlightRejected = { ok: inFlight.ok, code: inFlight.code || null, reason: String(inFlight.reason || '').slice(0, 120) }

      // 6) 身份闸门（宿主路径）：模型来源不得建 user_requirement
      const cur2 = adapter.intentStateOf(session)
      const badIdentity = adapter.commit(session, {
        causeId: 'c-bad-identity',
        baseRevision: cur2.revision,
        baseInputRevision: cur2.lastInputRevision,
        sessionId,
        ops: [{
          op: 'add_item',
          item: { id: 'req-bad', kind: 'user_requirement', text: '必须离线', sourceRefs: [{ kind: 'model', sessionId }] },
        }],
      })
      report.steps.identityRejected = { ok: badIdentity.ok, code: badIdentity.code || null }

      // 7) 客户端视图（wire）
      try {
        const snap = adapter.services.sessionProjections.snapshot(session)
        report.steps.wireView = snap && snap.values ? snap.values[PROJECTION_KEY] : null
      } catch (e) { report.steps.wireView = 'error: ' + String((e && e.message) || e) }

      // 8) apply 调用量：本会话操作期间的增量
      report.steps.applyStats = {
        baseline,
        now: { ...projectionStats, sessionsSeen: projectionStats.sessionsSeen.size },
        delta: {
          applyCalls: projectionStats.applyCalls - baseline.applyCalls,
          shortCircuits: projectionStats.shortCircuits - baseline.shortCircuits,
          adopted: projectionStats.adopted - baseline.adopted,
          rejected: projectionStats.rejected - baseline.rejected,
        },
        shortCircuitRatio: (projectionStats.applyCalls - baseline.applyCalls) > 0
          ? Math.round(((projectionStats.shortCircuits - baseline.shortCircuits) / (projectionStats.applyCalls - baseline.applyCalls)) * 1000) / 1000
          : null,
      }

      // 9) 恢复验证：checkpoint → restore() 重建
      const sp = adapter.services.sessionProjections
      let cp = null
      try { cp = sp.checkpoint(session) } catch (e) { report.steps.checkpointError = String((e && e.message) || e) }
      report.steps.checkpointRow = cp && cp[PROJECTION_KEY]
        ? { ver: cp[PROJECTION_KEY].ver, seq: cp[PROJECTION_KEY].seq, revision: cp[PROJECTION_KEY].val && cp[PROJECTION_KEY].val.revision }
        : null

      // 9b) 落盘：等待投影缓存写入后，检查磁盘上确实有本键
      await new Promise((r) => setTimeout(r, 1500))
      report.steps.persistedCache = await (async () => {
        try {
          const fsMod = await import('node:fs')
          const file = 'C:/Users/WestFox/.dsh/storages/session_projcache/sessions/' + sessionId + '.json'
          if (!fsMod.existsSync(file)) return { file, exists: false }
          const raw = fsMod.readFileSync(file, 'utf8')
          const j = JSON.parse(raw)
          const rows = (j && j.record && j.record.rows) || {}
          const row = rows[PROJECTION_KEY]
          return {
            file, exists: true, size: raw.length,
            hasOurKey: Boolean(row),
            row: row ? { ver: row.ver, seq: row.seq, revision: row.val && row.val.revision } : null,
          }
        } catch (e) { return { error: String((e && e.message) || e) } }
      })()

      // 9c) restore()：用 checkpoint + 全部事件冷读重建，断言与在线状态一致
      const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
      report.steps.eventCount = Array.isArray(events) ? events.length : 'not-array:' + typeof events
      // 9c-1) 全量 checkpoint（与宿主真实启动路径一致：所有注册单元一起恢复）
      // 注意：restore() 返回的 snapshot.values 是 **wire 视图**；完整状态在 out.checkpoint[key].val。
      try {
        const out = sp.restore(cp, events, 0, session.header, session.inheritedEventCount)
        const view = out && out.snapshot && out.snapshot.values ? out.snapshot.values[PROJECTION_KEY] : undefined
        const restoredState = out && out.checkpoint && out.checkpoint[PROJECTION_KEY]
          ? out.checkpoint[PROJECTION_KEY].val : undefined
        const live = adapter.intentStateOf(session)
        report.steps.restore = {
          mode: 'full-checkpoint',
          asOfSeq: out && out.snapshot ? out.snapshot.asOfSeq : null,
          wireView: view || null,
          restoredStatePresent: Boolean(restoredState),
          restoredRevision: restoredState ? restoredState.revision : null,
          liveRevision: live ? live.revision : null,
          revisionsMatch: Boolean(restoredState && live && restoredState.revision === live.revision),
          itemsMatch: Boolean(restoredState && live
            && JSON.stringify(restoredState.items) === JSON.stringify(live.items)),
          restoredItems: restoredState ? restoredState.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
          liveItems: live ? live.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
          refreshedRowKeys: out && out.checkpoint ? Object.keys(out.checkpoint).length : null,
        }
      } catch (e) {
        report.steps.restore = {
          mode: 'full-checkpoint',
          error: String((e && e.message) || e),
          stack: String((e && e.stack) || '').split('\n').slice(0, 6).join(' | ').slice(0, 600),
        }
      }
      // 9c-2) 只带本单元的 checkpoint（隔离"其它单元在折叠我的事件时抛错"这一可能原因）
      try {
        const only = {}
        if (cp && cp[PROJECTION_KEY]) only[PROJECTION_KEY] = cp[PROJECTION_KEY]
        const out2 = sp.restore(only, events, 0, session.header, session.inheritedEventCount)
        const st2 = out2 && out2.checkpoint && out2.checkpoint[PROJECTION_KEY]
          ? out2.checkpoint[PROJECTION_KEY].val : undefined
        const live = adapter.intentStateOf(session)
        report.steps.restoreOnlyMine = {
          restoredStatePresent: Boolean(st2),
          restoredRevision: st2 ? st2.revision : null,
          liveRevision: live ? live.revision : null,
          revisionsMatch: Boolean(st2 && live && st2.revision === live.revision),
          itemsMatch: Boolean(st2 && live && JSON.stringify(st2.items) === JSON.stringify(live.items)),
          restoredItems: st2 ? st2.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
        }
      } catch (e) {
        report.steps.restoreOnlyMine = {
          error: String((e && e.message) || e),
          stack: String((e && e.stack) || '').split('\n').slice(0, 6).join(' | ').slice(0, 600),
        }
      }

      // 10) 卸载后不可读
      try { adapter.projectionDisposer() } catch { /* best effort */ }
      adapter.projectionDisposer = null
      report.steps.afterDispose = { stateOfIsUndefined: adapter.intentStateOf(session) === undefined }

      report.ok = report.steps.init.ok === true
        && report.steps.addHuman.ok === true
        && report.steps.staleRejected.ok === false
        && report.steps.inFlightRejected.ok === false
        && report.steps.identityRejected.ok === false
        && report.steps.identityRejected.code === 'UNAUTHORIZED_KIND'
        && Boolean(report.steps.restoreOnlyMine && report.steps.restoreOnlyMine.revisionsMatch === true)
        && report.steps.afterDispose.stateOfIsUndefined === true
      report.verdict = report.ok
        ? 'PASS: 投影接线 + 三闸门 + checkpoint/restore 一致性 + 卸载即净'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      writeReport(report)
    }
  })()
}

/** P3 自检：把流水线接进**真实宿主**（状态走真实投影，意图包走真实 systemPrompt.context）。 */
function runP3Check(ctx) {
  const TANK = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'
  const report = {
    probe: 'dsh-po06-p3check',
    phase: 'P3',
    at: new Date().toISOString(),
    note: '真实宿主路径 + 桩解释器（不调用模型）；只在自己建的测试会话上操作',
    steps: {},
  }
  void (async () => {
    try {
      await adapter.waitProjectionReady(3000)
      await adapter.waitReady(3000)
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p3-intent-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: 'C:/Users/WestFox/.dsh/exp/po06/test-workspace' })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session

      // 桩解释器：严格按契约输出（逐字引文来自真实原话）
      const stub = async () => JSON.stringify({
        ops: [
          { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId, messageId: 'm-1' }] } },
          { op: 'add_item', item: { id: 'req-2', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', quote: '不要预览文件夹内的其他文件', sourceRefs: [{ kind: 'human', sessionId, messageId: 'm-1' }] } },
          { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '整体比例协调、结构可信', rationale: '来自原话的“真实、帅气”', sourceRefs: [{ kind: 'model', sessionId }] } },
        ],
      })

      const out = await adapter.handleInput(session, { messageId: 'm-1', text: TANK, interpret: stub })
      report.steps.outcome = out.outcome
      report.steps.trace = out.trace.map((x) => x.step)
      report.steps.packetChars = out.packet ? out.packet.text.length : 0

      const st = adapter.intentStateOf(session)
      report.steps.state = st ? { revision: st.revision, items: st.items.map((i) => i.id + '|' + i.kind + '|' + i.status) } : st

      // 真实宿主装配：本会话应看到意图包
      const sp = adapter.services.systemPrompt
      const asm = await sp.assemble({ agent, scope: agent })
      const mine = asm.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembledMine = {
        present: Boolean(mine),
        chars: mine ? String(mine.text).length : 0,
        hasRequirements: mine ? String(mine.text).includes('明确要求') : false,
        hasQuality: mine ? String(mine.text).includes('质量解释') : false,
        hasProvenanceNote: mine ? String(mine.text).includes('不是用户新增的命令') : false,
      }

      // 真实宿主装配：**别的会话**不得看到本会话的意图包（跨会话隔离）
      const other = agents.list().find((x) => String(x.id) !== sessionId)
      if (other) {
        const asmOther = await sp.assemble({ agent: other, scope: other })
        const mineOther = asmOther.contexts.find((c) => c.name === CONTEXT_NAME)
        report.steps.assembledOtherSession = {
          agentId: String(other.id),
          chars: mineOther ? String(mineOther.text).length : 0,
          leaked: Boolean(mineOther && String(mineOther.text).length > 0),
        }
      } else {
        report.steps.assembledOtherSession = { skipped: true, reason: 'no other agent' }
      }

      // 清理：本会话恢复静默
      adapter.setIntentText(sessionId, '')
      const asmAfter = await sp.assemble({ agent, scope: agent })
      const mineAfter = asmAfter.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.afterClear = { chars: mineAfter ? String(mineAfter.text).length : 0 }
      try { agent.cancel('po06-p3check-cleanup') } catch { /* best effort */ }

      report.ok = out.outcome === 'committed'
        && report.steps.assembledMine.present === true
        && report.steps.assembledMine.hasRequirements === true
        && report.steps.assembledMine.hasQuality === true
        && (report.steps.assembledOtherSession.leaked === false || report.steps.assembledOtherSession.skipped === true)
        && report.steps.afterClear.chars === 0
      report.verdict = report.ok
        ? 'PASS: 真实宿主路径成立（状态→编译→动态上下文），且跨会话不泄漏'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      writeReport(report)
    }
  })()
}

const htmlVerifierDeps = () => ({
  verify: async (file) => {
    const r = await verifyHtmlFile({ file })
    return { record: r && r.built && r.built.ok ? r.built.record : null, raw: r && r.raw }
  },
  deliver: async (level, payload) => {
    const text = '[交付验证 · 机器结论，不是用户的话]\n' + payload.text
    if (level === LEVEL.WAKE) return adapter.deliverAndWake(payload.sessionId, text, payload.summary)
    return adapter.deliverNotice(payload.sessionId, text, payload.summary)
  },
  ledgerFor: gateLedgers.ledgerFor,
  computeSha: (file) => {
    try { return createHash('sha256').update(readFileSync(file)).digest('hex') } catch { return null }
  },
})

/**
 * 对一份交付物跑交付门。**默认 L0（只记录、不投递）**；
 * 若带 settings 则按其解析等级——自检用它验证 L1/L2 路径。
 */
async function runGateFor(session, file, settingsOverride) {
  const sessionId = String(session.id)
  const st = adapter.intentStateOf(session)
  const rev = st ? st.lastInputRevision : 0
  return runGate(htmlVerifierDeps(), {
    file,
    taskId: st ? String(st.taskId) : 'default',
    sessionId,
    currentInputRevision: rev,
    recordInputRevision: rev,
    settings: settingsOverride || { autoReworkEnabled: false, allowWake: false },
  })
}

/** P6 自检：交付门真实链路 —— 真机验证 + 真实 agent 投递（在自己建的测试会话上）。 */
function runP6Check(ctx) {
  const report = { probe: 'dsh-po06-p6check', phase: 'P6', at: new Date().toISOString(),
    note: '真机验证 + 真实投递；只在自己建的测试会话上；默认等级不投递', steps: {} }
  void (async () => {
    try {
      await adapter.waitProjectionReady(3000)
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p6-gate-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: 'C:/Users/WestFox/.dsh/exp/po06/test-workspace' })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session
      adapter.initIntent(session, { taskId: 'p6check' })

      // 造一个**确定缺陷**的交付物：画布 0x0
      const dir = 'C:/Users/WestFox/.dsh/exp/po06/gate-fixtures'
      mkdirSync(dir, { recursive: true })
      const bad = dir + '/bad-zero.html'
      writeFileSync(bad, '<!doctype html><html><head><meta charset="utf-8"><title>bad</title></head><body><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=0;c.height=0;</script></body></html>', 'utf8')
      const good = dir + '/good.html'
      writeFileSync(good, '<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=320;c.height=240;const g=c.getContext("2d");g.fillStyle="#345";g.fillRect(0,0,320,240);</script></body></html>', 'utf8')

      // ① L0（默认）：验证会跑，但**不投递**
      const before = agent.inbox.nextStep.length
      const r0 = await runGateFor(session, bad)
      report.steps.L0 = { verdict: r0.verdict, level: r0.level, delivered: r0.delivered, reasons: r0.reasons }
      await new Promise((r) => setTimeout(r, 500))
      report.steps.L0inboxDelta = agent.inbox.nextStep.length - before

      // ② L1：不唤醒投递（消息应排队，且不产生 turn/start）
      // 用**会话事件快照差分**，不注册 effect——
      // 在 apply 返回后的异步续体里 ctx.on 会报 "cannot create effect on inactive context"（实测）。
      const countTurns = () => {
        try { return (session.snapshotEvents() || []).filter((e) => e.type === 'turn/start').length } catch { return -1 }
      }
      const turnsBefore = countTurns()
      const r1 = await runGateFor(session, bad, { autoReworkEnabled: true, allowWake: false })
      await new Promise((r) => setTimeout(r, 800))
      report.steps.L1 = { verdict: r1.verdict, level: r1.level, delivered: r1.delivered, reasons: r1.reasons }
      const turnsAfter = countTurns()
      report.steps.L1turnStarted = turnsAfter - turnsBefore
      report.steps.triggerResult = r1.delivered

      // ③ 好件：不应产生可返工失败
      const r2 = await runGateFor(session, good, { autoReworkEnabled: true, allowWake: false })
      report.steps.good = { verdict: r2.verdict, level: r2.level, reasons: r2.reasons }

      // ④ 交付门触发默认关闭
      report.steps.triggerDefaultOff = !existsSync(GATE_TRIGGER_FLAG)

      try { agent.cancel('po06-p6check-cleanup') } catch { /* */ }

      report.ok = r0.verdict === 'rework-eligible' && r0.level === 'L0-record'
        && report.steps.L0inboxDelta === 0
        && r1.level === 'L1-queue' && Boolean(r1.delivered && r1.delivered.ok)
        && report.steps.L1turnStarted === 0
        && r2.verdict !== 'rework-eligible'
        && report.steps.triggerDefaultOff === true
      report.verdictText = report.ok
        ? 'PASS: 交付门真实链路（L0 不投递 / L1 投递且不唤醒 / 好件不返工 / 触发默认关闭）'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally { writeReport(report) }
  })()
}

/** P8b 自检：**装配期启用闸门是否真的在生效**（真实宿主；不调模型、不开浏览器）。
 *
 *  为什么必须有这个自检：闸门的判定逻辑单测已经全绿，但"逻辑正确"与
 *  "接线接上了"是两件事——**一个只在自检里生效的守卫等于没有守卫**（A10/A12 缺口）。
 *  这里用**两侧对照**证明接线成立（只有闸门能解释这个差异）：
 *    (a) 默认态：写了意图包文本，但旧插件仍在装配 ⇒ 上下文贡献必须是 **0 字符**；
 *    (b) 强制启用该会话（探针注入，绕过判定）⇒ 同一段文本必须**贡献出来**。
 *  若 (a) 与 (b) 都为空，说明抑制来自别处（接线没生效）；若 (a) 非空，说明闸门没拦住。
 */
function runP8bCheck(ctx) {
  const report = { probe: 'dsh-po06-p8bcheck', phase: 'P8b', at: new Date().toISOString(),
    note: '装配期启用闸门接线验证：默认抑制 / 强制启用放行（两侧对照）', steps: {} }
  void (async () => {
    const PROBE_TEXT = '【P8b 探针】意图包文本：这段文字只有在启用闸门放行时才应出现在装配上下文里。'
    let sid = ''
    try {
      await adapter.waitReady(3000)
      const agents = adapter.services.agents
      const sp = adapter.services.systemPrompt
      const list = agents && typeof agents.list === 'function' ? agents.list() : []
      const target = list[0]
      report.steps.hasSystemPrompt = Boolean(sp)
      if (!target || !sp) { report.error = 'no agent/systemPrompt to probe'; return }
      sid = String(target.id)

      const mineChars = async () => {
        const asm = await sp.assemble({ agent: target, scope: target })
        const c = (asm.contexts || []).find((x) => x.name === CONTEXT_NAME)
        return c ? String(c.text).length : 0
      }

      // 前置：确认"没有闸门时文本本来是会出现的"——即文本非空且真被渲染
      adapter.setIntentText(sid, PROBE_TEXT)
      report.steps.textLength = adapter.getIntentText(sid).length

      // (a) 默认态：先 forget 掉缓存，让 text() 走真实判定路径
      adapter.enableGate.forget(sid)
      await mineChars()                       // 触发一次判定（异步）
      await new Promise((r) => setTimeout(r, 600))
      const stDefault = adapter.enableGate.statusFor(sid)
      report.steps.gateStatus = { ...stDefault }
      report.steps.charsWhenGated = await mineChars()

      // (b) 强制启用（**仅探针**）：绕过判定，直接注入 enabled=true
      adapter.enableGate.set(sid, { enabled: true, code: 'probe-forced-enabled', reason: 'P8b 探针强制放行' })
      report.steps.charsWhenForced = await mineChars()

      // (c) 双重拦截分支：**不写用户配置**，而是把本机真实探测结果喂给判定函数，
      //     看"若 0.6 已被配置启用（all）"会得到什么结论。
      //     不写 ~/.dsh/prompt-optimizer.json 是刻意的：真实配置迁移需用户同意（ADR-0032）。
      try {
        const agent = adapter.agentFor(sid)
        const rt2 = await detectOldPluginRuntime({ systemPrompt: sp, agent })
        let st2 = null
        try {
          const { detectOldPluginStatic } = await import('./host-migrate.js')
          st2 = detectOldPluginStatic(PROFILE_DIR)
        } catch { st2 = null }
        const merged2 = mergeOldPluginSignals(rt2, st2)
        const tri = toActiveTriState(merged2)
        const wouldBe = resolveEnableDecision({
          intent: parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } })),
          sessionId: sid,
          oldPluginActive: tri,
        })
        report.steps.oldPluginTriState = tri
        report.steps.oldPluginEvidence = (merged2 && merged2.evidence || []).slice(0, 3)
        report.steps.wouldBeIfEnabled = wouldBe

        // (d) 把**真实判定结论**注入闸门 → 装配贡献必须仍为 0
        adapter.enableGate.set(sid, wouldBe)
        report.steps.charsWithRealDecision = await mineChars()
      } catch (e) {
        report.steps.oldPluginBranchError = String((e && e.message) || e)
      }

      const a = report.steps.charsWhenGated
      const b = report.steps.charsWhenForced
      const c = report.steps.charsWithRealDecision
      const wb = report.steps.wouldBeIfEnabled || {}
      report.ok = report.steps.textLength > 0
        && a === 0
        && b === report.steps.textLength
        && stDefault.enabled !== true
        // 双重拦截分支：本机旧插件确实在装 ⇒ 结论必须是否决，且据此装配贡献仍为 0
        && (report.steps.oldPluginTriState !== true || wb.code === 'DOUBLE_INTERCEPT')
        && (report.steps.oldPluginTriState !== true || c === 0)
      report.verdictText = report.ok
        ? ('PASS: 闸门真的接在装配路径上——默认态贡献 ' + a + ' 字符（结论 ' + stDefault.code
           + '），强制放行后贡献 ' + b + ' 字符；'
           + '按本机真实探测（旧插件 tri-state=' + report.steps.oldPluginTriState
           + '）若配置启用则结论=' + wb.code + '，据此贡献 ' + c + ' 字符')
        : ('CHECK: 默认 ' + a + ' / 强制 ' + b + ' / 真实判定 ' + c + ' / 文本 ' + report.steps.textLength
           + '，默认结论 ' + stDefault.code + '，真实判定结论 ' + wb.code)
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      try { if (sid) { adapter.setIntentText(sid, ''); adapter.enableGate.forget(sid) } } catch { /* best effort */ }
      writeReport(report)
    }
  })()
}

/** P8 自检：旧插件**运行时**探测 + 启用闸门（不调模型、不开浏览器）。 */
function runP8Check(ctx) {
  const report = { probe: 'dsh-po06-p8check', phase: 'P8', at: new Date().toISOString(),
    note: '运行时探测旧插件是否仍在装配；并核对启用闸门结论', steps: {} }
  void (async () => {
    try {
      await adapter.waitReady(3000)
      const agents = adapter.services.agents
      const list = agents && typeof agents.list === 'function' ? agents.list() : []
      const target = list[0]
      const sp = adapter.services.systemPrompt
      report.steps.hasSystemPrompt = Boolean(sp)
      if (!target) { report.error = 'no agent to scope the probe'; return }

      // 装配结果里的上下文清单（用来核对探测依据）
      const asm = await sp.assemble({ agent: target, scope: target })
      report.steps.contextNames = (asm.contexts || []).map((c) => c.name)

      const rt = await detectOldPluginRuntime({ systemPrompt: sp, agent: target })
      report.steps.runtime = rt

      // 静态探测（本机 profile）
      let st = null
      try {
        const { detectOldPluginStatic } = await import('./host-migrate.js')
        st = detectOldPluginStatic('C:/Users/WestFox/.dsh/profiles/web')
      } catch (e) { st = { error: String((e && e.message) || e) } }
      report.steps.static = st

      const merged = mergeOldPluginSignals(rt, st)
      report.steps.merged = merged

      // 启用闸门：命中则必须拒绝启用
      const decided = decideEnabled({
        rollout: { mode: 'all' },
        sessionId: String(target.id),
        settings: { enabled: true },
        oldPluginActive: merged.active,
      })
      report.steps.gate = decided

      report.ok = rt.confidence === 'runtime'
        && typeof merged.active === 'boolean'
        && (merged.active === false || decided.code === 'DOUBLE_INTERCEPT')
      report.verdictText = report.ok
        ? ('PASS: 运行时探测成立（active=' + merged.active + '，confidence=' + merged.confidence
           + '）；启用闸门结论=' + decided.code)
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally { writeReport(report) }
  })()
}
