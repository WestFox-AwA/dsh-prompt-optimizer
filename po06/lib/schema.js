// dsh-prompt-optimizer 0.6 · 意图状态 schema 与校验（纯函数，无 IO、无宿主依赖）
//
// 设计依据：PLAN-0.6.md §7。核心原则——
//   · **来源身份决定条目能否成为"用户已确认"**，不能靠一个 confidence 字段。
//   · 质量解释（quality_interpretation）**不得**升格为用户需求（user_requirement）。
//   · 模型只能产出候选 patch；提交权在 reducer（宿主侧）。

export const SCHEMA_VERSION = 1

/** 条目类型。决定"这条东西是什么身份"，而不是"有多确定"。 */
export const ITEM_KINDS = Object.freeze([
  'user_requirement',       // 用户明确要求（必须能引用人类来源）
  'user_decision',          // 用户对已呈现分叉作出的选择
  'quality_interpretation', // 对已表达质量目标的解释（有标签的工作目标，不是需求）
  'observed_fact',          // 工具/来源确认的事实（不是需求，不产生授权）
  'implementation_option',  // 实现手段与候选方案（工作 AI 可调整）
  'proposal',               // 建议：新功能、审美方向、结果取舍（待采纳）
  'unknown',                // 尚缺的选择或事实（保持未知）
])

export const ITEM_STATUSES = Object.freeze([
  'active', 'pending', 'superseded', 'retracted', 'stale',
])

/** 来源类型。`human` 是唯一能授权 user_requirement / user_decision 的来源。 */
export const SOURCE_KINDS = Object.freeze([
  'human', 'model', 'tool', 'file', 'external', 'project_convention',
])

/** 需要人类来源才能创建的条目类型。 */
export const HUMAN_ONLY_KINDS = Object.freeze(['user_requirement', 'user_decision'])

export const PHASES = Object.freeze([
  'idle', 'interpreting', 'awaiting_answer', 'ready',
  'working', 'verifying', 'repair_pending',
  'completed', 'cancelled', 'needs_recovery',
])

/** 条目作用域：task 长期有效；turn 仅本轮有效（下一轮自动退役）。 */
export const SCOPES = Object.freeze(['task', 'turn'])

/** `unknown` 条目的分类。决定它该"问用户"还是"去查/自行决定"（见 clarifier.js）。 */
export const UNKNOWN_CLASSES = Object.freeze([
  'user_preference', 'lookupable_fact', 'implementation_detail',
])

/** 条目 patch 的允许字段（白名单；不在表内的字段一律拒绝，避免静默塞入）。 */
const ITEM_MUTABLE_FIELDS = Object.freeze([
  'text', 'status', 'appliesTo', 'rationale', 'dependsOn',
])

const ID_RE = /^[a-z0-9][a-z0-9:_-]{2,79}$/i

export function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 新建一个空状态。revision 从 0 开始；每次成功提交 +1。 */
export function createState({ sessionId, taskId }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('createState: sessionId required')
  if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('createState: taskId required')
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    taskId,
    revision: 0,
    lastInputRevision: 0,
    turnId: 't0',
    sourceMessageIds: [],
    phase: 'idle',
    items: [],
    questions: [],
    artifactRefs: [],
    verificationRefs: [],
    lastCauseId: null,
  }
}

/** 校验一个来源引用是否可用。 */
export function validateSourceRef(ref) {
  const errors = []
  if (!isPlainObject(ref)) return ['sourceRef must be an object']
  if (!SOURCE_KINDS.includes(ref.kind)) errors.push(`sourceRef.kind invalid: ${String(ref.kind)}`)
  if (typeof ref.sessionId !== 'string' || !ref.sessionId) errors.push('sourceRef.sessionId required')
  if (ref.kind === 'human' && typeof ref.messageId !== 'string') errors.push('human sourceRef requires messageId')
  if (ref.kind === 'tool' && typeof ref.toolCallId !== 'string') errors.push('tool sourceRef requires toolCallId')
  if ((ref.kind === 'file' || ref.kind === 'external') && typeof ref.uri !== 'string') {
    errors.push(`${ref.kind} sourceRef requires uri`)
  }
  return errors
}

/**
 * 校验一条新条目的**形状**。返回错误数组（空数组 = 合法）。
 *
 * 职责边界（P2 修正）：本函数只查"形状"——字段存在、类型正确、来源引用格式合法。
 * **权威判断（哪种来源能创建哪种 kind）在 reducer 里**，不在这里。
 * 早期版本把身份判断放在这里，导致 reducer 的 UNAUTHORIZED_KIND 分支永远不可达——
 * 那种"看起来在做事的死代码"会掩盖真实缺口，故已拆开。
 */
export function validateNewItem(item) {
  const errors = []
  if (!isPlainObject(item)) return ['item must be an object']
  if (typeof item.id !== 'string' || !ID_RE.test(item.id)) errors.push(`item.id invalid: ${String(item.id)}`)
  if (!ITEM_KINDS.includes(item.kind)) errors.push(`item.kind invalid: ${String(item.kind)}`)
  if (typeof item.text !== 'string' || item.text.trim().length === 0) errors.push('item.text must be non-empty')
  if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) {
    errors.push('item.sourceRefs must be a non-empty array')
  } else {
    item.sourceRefs.forEach((r, i) => {
      for (const e of validateSourceRef(r)) errors.push(`sourceRefs[${i}]: ${e}`)
    })
  }
  // 状态可选；缺省由 reducer 填 'active'
  if (item.status !== undefined && !ITEM_STATUSES.includes(item.status)) {
    errors.push(`item.status invalid: ${String(item.status)}`)
  }
  // unknown 专属字段
  if (item.unknownClass !== undefined) {
    if (item.kind !== 'unknown') errors.push('unknownClass is only valid on kind "unknown"')
    else if (!UNKNOWN_CLASSES.includes(item.unknownClass)) {
      errors.push(`item.unknownClass invalid: ${String(item.unknownClass)}`)
    }
  }
  if (item.blocksAction !== undefined && item.kind !== 'unknown') {
    errors.push('blocksAction is only valid on kind "unknown"')
  }
  // 作用域
  if (item.scope !== undefined && !SCOPES.includes(item.scope)) {
    errors.push('item.scope invalid: ' + String(item.scope))
  }
  // 本轮作用域只对用户指令有意义（机器解释不该只在某一轮有效）
  if (item.scope === 'turn' && !HUMAN_ONLY_KINDS.includes(item.kind)) {
    errors.push('scope turn is only valid on user_requirement / user_decision')
  }
  return errors
}

/** `update_item` 允许修改的字段（白名单）。`kind` / `sourceRefs` / `id` 是**身份**，永不可改。 */
export function isMutableItemField(name) {
  return ITEM_MUTABLE_FIELDS.includes(name)
}

/**
 * 校验候选 patch 的结构（**不含**权限与版本判断，那些在 reducer 里）。
 * 返回 { ok, errors }。
 */
export function validatePatch(patch) {
  const errors = []
  if (!isPlainObject(patch)) return { ok: false, errors: ['patch must be an object'] }
  if (typeof patch.causeId !== 'string' || !patch.causeId) errors.push('patch.causeId required')
  if (!Number.isSafeInteger(patch.baseRevision) || patch.baseRevision < 0) {
    errors.push('patch.baseRevision must be a non-negative integer')
  }
  if (!Array.isArray(patch.ops) || patch.ops.length === 0) errors.push('patch.ops must be a non-empty array')
  else {
    patch.ops.forEach((op, i) => {
      if (!isPlainObject(op)) { errors.push(`ops[${i}] must be an object`); return }
      switch (op.op) {
        case 'add_item':
          for (const e of validateNewItem(op.item)) errors.push(`ops[${i}].item: ${e}`)
          break
        case 'set_item_status':
          if (typeof op.id !== 'string') errors.push(`ops[${i}].id required`)
          if (!ITEM_STATUSES.includes(op.status)) errors.push(`ops[${i}].status invalid: ${String(op.status)}`)
          break
        case 'update_item':
          if (typeof op.id !== 'string') errors.push(`ops[${i}].id required`)
          if (!isPlainObject(op.fields) || Object.keys(op.fields).length === 0) {
            errors.push(`ops[${i}].fields must be a non-empty object`)
          } else {
            const illegal = Object.keys(op.fields).filter((k) => !isMutableItemField(k))
            if (illegal.length > 0) {
              errors.push(`ops[${i}].fields has immutable or unknown keys: ${illegal.join(', ')}`)
            }
          }
          break
        case 'advance_turn':
          if (typeof op.turnId !== 'string' || !op.turnId) errors.push('ops[' + i + '].turnId required')
          break
        case 'set_phase':
          if (!PHASES.includes(op.phase)) errors.push(`ops[${i}].phase invalid: ${String(op.phase)}`)
          break
        case 'add_question':
          if (!isPlainObject(op.question) || typeof op.question.id !== 'string') {
            errors.push(`ops[${i}].question.id required`)
          }
          break
        case 'answer_question':
          if (typeof op.id !== 'string') errors.push(`ops[${i}].id required`)
          if (!['answered', 'skipped', 'declined', 'delegated', 'cancelled', 'stale'].includes(op.status)) {
            errors.push(`ops[${i}].status invalid: ${String(op.status)}`)
          }
          break
        default:
          errors.push(`ops[${i}].op unknown: ${String(op.op)}`)
      }
    })
  }
  return { ok: errors.length === 0, errors }
}
