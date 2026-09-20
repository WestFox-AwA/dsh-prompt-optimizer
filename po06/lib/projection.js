// dsh-prompt-optimizer 0.6 · 意图状态的宿主投影接线
//
// 依据：
//   · PLAN-0.6.md §7.3 —— 状态事件必须携带**完整变更后状态**（宿主 whole-value 规则）。
//   · ADR-0011 —— `apply` 的第一句必须是事件类型短路并**返回同一引用**；
//     宿主对**每个会话的每个已提交事件**都驱动所有注册单元，代价按"会话数 × 事件数"增长。
//
// 因此本文件的设计是：
//   · reducer 在**提交前**运行（CAS / 权威判断都在那里）；
//   · 提交时把**完整新状态**作为事件载荷 append；
//   · 投影的 `apply` 只做"校验并采纳"，不做任何计算、不构造新对象（除非确实要采纳）。
import { SCHEMA_VERSION, isPlainObject } from './schema.js'
import { reduce, checkInvariants } from './reducer.js'

export const PROJECTION_KEY = 'promptOptimizerIntent'
export const PROJECTION_VERSION = 1
/** 0.6 的状态事件类型。固定前缀便于 apply 首句快速短路。 */
export const STATE_EVENT = 'prompt-optimizer/state-changed'
const EVENT_PREFIX = 'prompt-optimizer/'

/** 运行时统计（用于实测 apply 调用量，不进入持久状态）。 */
export function createStats() {
  return {
    applyCalls: 0,
    shortCircuits: 0,
    adopted: 0,
    rejected: 0,
    sessionsSeen: new Set(),
    firstTouchAt: new Map(),
  }
}

/** 判断一个事件载荷是否是可采纳的完整意图状态。 */
export function looksLikeIntentState(v) {
  if (!isPlainObject(v)) return false
  if (v.schemaVersion !== SCHEMA_VERSION) return false
  if (typeof v.sessionId !== 'string' || !v.sessionId) return false
  if (!Number.isSafeInteger(v.revision) || v.revision < 0) return false
  if (!Array.isArray(v.items) || !Array.isArray(v.questions)) return false
  return true
}

/**
 * 状态校验器（zod 风格的最小实现：只要有 `.parse`）。
 *
 * **这是恢复路径的必需项**：宿主在 `restore()` 里会调用
 * `def.stateSchema.parse(row.val)` 来校验从磁盘读回的 checkpoint 行
 * （`dsh-session-projection/lib/index.js:255` 与 `:297`）。
 * `register()` **不校验** stateSchema 是否存在——缺了它，注册、提交、读取全都正常，
 * **只有在恢复时才抛错**。这是 P2-3 实测抓到的隐性缺陷。
 */
const stateSchema = {
  parse: (v) => {
    if (!looksLikeIntentState(v)) {
      throw new Error('promptOptimizerIntent: persisted state failed validation')
    }
    return v
  },
}

/**
 * 构造投影定义。
 * @param stats 可选的统计对象（createStats()）
 */
export function createProjectionDefinition(stats) {
  return {
    key: PROJECTION_KEY,
    stateVersion: PROJECTION_VERSION,
    stateSchema,
    /** 初始状态：`null` 表示"该会话尚无意图状态"，与"空状态"区分开。 */
    init: () => null,
    /**
     * 纯 fold。**第一句必须是类型短路并返回同一引用**（ADR-0011）。
     * 这里不做任何 IO、不调 LLM、不序列化。
     */
    apply: (state, event) => {
      if (stats) {
        stats.applyCalls += 1
        if (event && event.sessionId !== undefined) { /* noop */ }
      }
      // ── 短路：非本插件事件一律原样返回（引用不变）──────────────
      if (!event || typeof event.type !== 'string' || event.type.indexOf(EVENT_PREFIX) !== 0) {
        if (stats) stats.shortCircuits += 1
        return state
      }
      if (event.type !== STATE_EVENT) {
        if (stats) stats.shortCircuits += 1
        return state
      }
      const data = event.data
      if (!looksLikeIntentState(data)) {
        if (stats) stats.rejected += 1
        return state
      }
      if (stats) {
        stats.adopted += 1
        try {
          const sid = String(data.sessionId)
          if (!stats.sessionsSeen.has(sid)) {
            stats.sessionsSeen.add(sid)
            stats.firstTouchAt.set(sid, Date.now())
          }
        } catch { /* best effort */ }
      }
      // whole-value：事件带完整状态，直接采纳
      return data
    },
    /** 客户端视图：只暴露渲染需要的字段，避免把内部结构推给 UI。 */
    wire: {
      viewSchema: { parse: (v) => v },
      view: (state) => {
        if (state === null) return null
        return {
          revision: state.revision,
          phase: state.phase,
          activeCount: Array.isArray(state.items) ? state.items.filter((it) => it.status === 'active').length : 0,
          unresolvedQuestions: Array.isArray(state.questions)
            ? state.questions.filter((q) => q.status === 'proposed' || q.status === 'asked').length
            : 0,
        }
      },
    },
  }
}

/**
 * 提交一个候选 patch：CAS → reduce → append（完整新状态）。
 *
 * @param session      目标会话（提供 append）
 * @param currentState 从投影读到的当前状态（可为 null）
 * @param patch        候选 patch
 * @returns {{ok:true, state:object}} | {{ok:false, code:string, reason:string}}
 */
export function commitPatch({ session, currentState, patch, persist }) {
  // ── 落地方式由 persist 决定（EV-0081）──────────────────────────────
  // 不传 persist ⇒ 走会话事件 `session.append`。**生产路径禁止**走这条：
  // 宿主不认识我们的自定义事件类型时，会**拒绝重建整个会话**
  // （`ignorable` 标记插件置不上：`Session.append` 的信封只收 sourceEventSeqs/surfaceOp）。
  // 传 persist ⇒ 由插件自己存（store.js）。
  // 让"能持久化"与"会污染会话日志"在**代码层面**分开，而不是靠记得。
  const useSessionLog = typeof persist !== 'function'
  if (useSessionLog && (!session || typeof session.append !== 'function')) {
    return { ok: false, code: 'NO_SESSION', reason: 'session.append unavailable' }
  }
  if (!useSessionLog && !session) {
    return { ok: false, code: 'NO_SESSION', reason: 'session required' }
  }
  const land = (state) => {
    if (useSessionLog) { session.append(STATE_EVENT, state); return null }
    try {
      const r = persist(session, state)
      return r && r.ok === false ? { ok: false, code: 'PERSIST_FAILED', reason: r.reason || null } : null
    } catch (e) { return { ok: false, code: 'PERSIST_THREW', reason: String((e && e.message) || e) } }
  }
  const base = currentState === null || currentState === undefined ? null : currentState
  if (base === null) {
    // 尚无状态：只接受"从零建立"的 patch（baseRevision 必须为 0）
    if (!isPlainObject(patch) || patch.baseRevision !== 0) {
      return { ok: false, code: 'NO_BASE_STATE', reason: 'no intent state yet; patch.baseRevision must be 0' }
    }
    // 用一个空状态驱动 reducer，保证所有权威判断仍然经由 reducer
    const empty = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: patch.sessionId,
      taskId: patch.taskId || 'default',
      revision: 0,
      lastInputRevision: 0,
      sourceMessageIds: [],
      phase: 'idle',
      items: [],
      questions: [],
      artifactRefs: [],
      verificationRefs: [],
      lastCauseId: null,
    }
    const r = reduce(empty, patch)
    if (!r.ok) return r
    const bad = land(r.state)
    return bad || { ok: true, state: r.state }
  }
  const r = reduce(base, patch)
  if (!r.ok) return r
  const problems = checkInvariants(r.state)
  if (problems.length > 0) {
    return { ok: false, code: 'INVARIANT_VIOLATION', reason: problems.join('; ') }
  }
  const bad = land(r.state)
  return bad || { ok: true, state: r.state }
}
