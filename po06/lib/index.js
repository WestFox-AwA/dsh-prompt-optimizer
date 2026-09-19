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
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE_DIR = 'C:/Users/WestFox/.dsh/exp/po06/probe-reports'
const CONTEXT_NAME = 'prompt-optimizer:intent'
// order 取 9100：排在宿主与其它插件（110–362 段）之后，使意图包出现在聚合快照靠后位置。
const CONTEXT_ORDER = 9100
const LLM_LIB = 'file:///C:/Users/WestFox/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
// 自检开关：环境变量或标记文件（后者可在运行期通过"创建文件 + 热重载"触发）
const SELFCHECK_FLAG = 'C:/Users/WestFox/.dsh/exp/po06/run-selfcheck.flag'
const SELF_CHECK = process.env.DSH_PO06_SELFCHECK === '1' || existsSync(SELFCHECK_FLAG)

export const name = '@dsh-external/dsh-po06'

class DshAdapter {
  constructor() {
    // 静默待命：空文本不会出现在任何会话的上下文里（宿主过滤空贡献）
    this.intentText = ''
    this.contextDisposer = null
    this.services = { agents: null, sessionController: null, systemPrompt: null }
    this.readyResolvers = []
    this.ready = new Promise((resolve) => this.readyResolvers.push(resolve))
  }

  markReady() {
    const rs = this.readyResolvers
    this.readyResolvers = []
    for (const r of rs) { try { r() } catch { /* best effort */ } }
  }

  /** 等待可选注入就绪；超时返回 false（调用方必须处理 false）。 */
  async waitReady(timeoutMs = 3000) {
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    const r = await Promise.race([this.ready.then(() => true), timeout])
    if (timer) clearTimeout(timer)
    return r === true
  }

  /** 编译层更新意图包文本的唯一入口。空字符串 = 静默待命（不注入任何东西）。 */
  setIntentText(text) {
    this.intentText = String(text ?? '')
  }

  getIntentText() {
    return this.intentText
  }

  registerContext(ctx) {
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        try {
          this.services.systemPrompt = scope.systemPrompt
          this.contextDisposer = scope.systemPrompt.context({
            name: CONTEXT_NAME,
            order: CONTEXT_ORDER,
            text: () => this.intentText,
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
    this.contextDisposer = null
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
  report.steps.registerContext = { ok: adapter.registerContext(ctx), name: CONTEXT_NAME, order: CONTEXT_ORDER }
  report.steps.restingTextIsEmpty = adapter.getIntentText() === ''

  ctx.effect(() => () => adapter.dispose(), 'dsh-po06: adapter dispose')

  if (!SELF_CHECK) {
    report.ok = report.steps.registerContext.ok === true && report.steps.restingTextIsEmpty === true
    report.verdict = 'IDLE: 已注册并静默待命（未运行自检；设 DSH_PO06_SELFCHECK=1 开启）'
    writeReport(report)
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
