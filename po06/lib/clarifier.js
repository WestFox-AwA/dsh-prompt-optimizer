// dsh-prompt-optimizer 0.6 · 澄清规划（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §8。核心不是"发现不确定就问"，而是**分类之后只问该问的**：
//   · user_preference（用户偏好未知）      → 候选提问
//   · lookupable_fact（许可内可查的事实）  → 交给查证，**不丢回用户**
//   · implementation_detail（可逆实现细节）→ 交给工作 AI 自行决定，**不问**
//
// 三条硬规则：
//   ① 同一个 decisionId 一旦问过（任何非 proposed 状态），**永不再问**——
//      这是"前置优化器与工作 AI 不重复问"的机制保证。
//   ② 每批最多问 maxQuestions（默认 2，优先 1），其余进 deferred。
//   ③ 拒答 / 跳过 / 授权自主 / 取消 是**四种不同状态**，都不等于"同意"。
import { activeItems } from './reducer.js'

export const UNKNOWN_CLASSES = Object.freeze([
  'user_preference',
  'lookupable_fact',
  'implementation_detail',
])

/** 问过就不再问的状态（'proposed' 尚未问出，可以再次规划）。 */
export const TERMINAL_QUESTION_STATES = Object.freeze([
  'asked', 'answered', 'skipped', 'declined', 'delegated', 'cancelled', 'stale',
])

/** 授权自主决定的记录**只在该范围内**免问。 */
export function isDelegatedFor(state, decisionId, scope) {
  const q = state.questions.find((x) => x.decisionId === decisionId || x.id === decisionId)
  if (!q || q.status !== 'delegated') return false
  if (!scope) return true           // 无范围声明 = 全范围授权
  const s = q.delegatedScope
  if (!s) return true               // 授权时未限定范围 = 全范围
  return String(s) === String(scope)
}

/** 该 decision 是否已经问过（含已答、已拒、已授权、已取消）。 */
/**
 * 该 decision 是否**已经有 question 记录**（任何状态，含 'proposed'）。
 *
 * 语义：**规划对每个 decisionId 只发生一次**。已记录过就不再重新规划——
 * 真正"把问题投递给用户"是另一步（读 status==='proposed' 的记录去问）。
 * 早期版本只把终态算作已处理，导致同一个问题被反复规划，
 * 而记录时会因重复 id 失败（P4-2 集成测试抓到）。
 */
export function hasQuestion(state, decisionId) {
  return state.questions.some((q) => q.decisionId === decisionId || q.id === decisionId)
}

export function alreadyHandled(state, decisionId) {
  return state.questions.some((q) => (q.decisionId === decisionId || q.id === decisionId)
    && TERMINAL_QUESTION_STATES.includes(q.status))
}

/** 把一个 unknown 条目分类。缺省视为用户偏好（保守：宁可问，也不要替用户拍板）。 */
export function classifyUnknown(item) {
  const c = item && item.unknownClass
  return UNKNOWN_CLASSES.includes(c) ? c : 'user_preference'
}

/**
 * 规划一次澄清。
 * @returns {
 *   mode: 'ask' | 'none',
 *   questions: [{ id, decisionId, text, whyNeeded, itemId }],
 *   routed: { lookup: [...], decide: [...] },   // 不该问用户的
 *   deferred: [...],                            // 该问但超出本批预算
 *   reason: string
 * }
 */
export function planClarification(state, opts = {}) {
  const maxQuestions = Number.isFinite(opts.maxQuestions) ? Math.max(0, opts.maxQuestions) : 2
  const unknowns = activeItems(state).filter((it) => it.kind === 'unknown')

  const lookup = []
  const decide = []
  const askable = []

  for (const it of unknowns) {
    const cls = classifyUnknown(it)
    if (cls === 'lookupable_fact') { lookup.push(it.id); continue }
    if (cls === 'implementation_detail') { decide.push(it.id); continue }
    // user_preference：先过"是否已经处理过"
    if (hasQuestion(state, it.id)) continue
    if (isDelegatedFor(state, it.id)) continue
    // 用户显式声明"这条不影响下一步" → 不打扰
    if (it.blocksAction === false) continue
    askable.push(it)
  }

  const questions = []
  const deferred = []
  askable.forEach((it, i) => {
    if (i < maxQuestions) {
      questions.push({
        id: 'q-' + it.id,
        decisionId: it.id,
        itemId: it.id,
        text: it.text,
        whyNeeded: it.rationale || null,
      })
    } else {
      deferred.push(it.id)
    }
  })

  const mode = questions.length > 0 ? 'ask' : 'none'
  const reason = mode === 'ask'
    ? `有 ${questions.length} 个会改变下一步的用户偏好未定`
    : (unknowns.length === 0 ? 'no-unknowns'
      : (lookup.length + decide.length > 0 ? 'all-routed-not-askable' : 'nothing-left-to-ask'))

  return { mode, questions, routed: { lookup, decide }, deferred, reason }
}

/**
 * 把一次规划结果变成 reducer 可接受的 ops（**不提交**）。
 * 只产出 `add_question`；提交权仍在流水线/reducer。
 */
export function planningToOps(planned) {
  if (!planned || planned.mode !== 'ask') return []
  return planned.questions.map((q) => ({
    op: 'add_question',
    question: {
      id: q.id,
      decisionId: q.decisionId,
      itemId: q.itemId,
      text: q.text,
      whyNeeded: q.whyNeeded,
      status: 'proposed',
    },
  }))
}

/**
 * 用户答复的四种结局 → question 状态。**都不等于"同意"**。
 * @param kind 'answered' | 'declined' | 'skipped' | 'delegated'
 */
export function resolutionOp(questionId, kind, extra = {}) {
  const allowed = ['answered', 'declined', 'skipped', 'delegated']
  if (!allowed.includes(kind)) throw new Error('unknown resolution kind: ' + String(kind))
  const op = { op: 'answer_question', id: questionId, status: kind }
  if (kind === 'answered') {
    if (typeof extra.answerSource !== 'string' || !extra.answerSource) {
      throw new Error('answered requires answerSource (human source ref required)')
    }
    op.answerSource = extra.answerSource
  }
  if (kind === 'delegated') {
    // 授权只有带范围时才可被 isDelegatedFor 限定；无范围 = 全范围
    if (extra.delegatedScope !== undefined) op.delegatedScope = String(extra.delegatedScope)
  }
  return op
}

/**
 * 超时**不是**答复，也不是授权。
 * 该函数存在的意义是：把"超时"这件事显式表达为**不做任何状态转移**，
 * 避免有人图省事写成 `delegated`。
 */
export function onTimeout() {
  return { op: null, reason: 'timeout-is-not-consent' }
}
