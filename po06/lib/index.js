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
import {
  createStats, createProjectionDefinition, commitPatch, PROJECTION_KEY, STATE_EVENT,
} from './projection.js'
import { recordUserInput } from './reducer.js'
import { createState } from './schema.js'

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
// apply 调用量统计（不进入持久状态）
const projectionStats = createStats()

export const name = '@dsh-external/dsh-po06'

class DshAdapter {
  constructor() {
    // 静默待命：空文本不会出现在任何会话的上下文里（宿主过滤空贡献）
    this.intentText = ''
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

  ctx.effect(() => () => adapter.dispose(), 'dsh-po06: adapter dispose')

  if (!SELF_CHECK) {
    report.ok = report.steps.registerContext.ok === true && report.steps.restingTextIsEmpty === true
    report.verdict = 'IDLE: 已注册并静默待命（未运行自检；设 DSH_PO06_SELFCHECK=1 开启）'
    writeReport(report)
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

/** P2 自检：投影接线 / 完整状态事件 / CAS 拒绝 / apply 调用量实测。 */
function runP2Check(ctx) {
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
