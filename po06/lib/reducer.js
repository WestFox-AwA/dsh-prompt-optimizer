// dsh-prompt-optimizer 0.6 · 意图状态 reducer（纯函数：无 IO、无宿主依赖、无时间、无随机）
//
// 职责：把**候选 patch** 变成**新状态**，或明确拒绝。它是唯一的提交权持有者。
// 依据 PLAN-0.6.md §7.2/§7.3：
//   · 模型只提议；reducer 检查类型、来源、会话、revision、取代关系。
//   · CAS：patch.baseRevision 必须等于当前 revision，否则拒绝（旧结果不得覆盖新输入）。
//   · 任何在**最新用户输入之后**产生的 patch 一律作废（lastInputRevision 闸门）。
//
// 纯函数约束（ADR-0011 的精神延伸到 reducer）：不读文件、不调 LLM、不取当前时间。
import {
  SCHEMA_VERSION, ITEM_KINDS, ITEM_STATUSES, HUMAN_ONLY_KINDS,
  validatePatch, isPlainObject,
} from './schema.js'

/** 拒绝码。调用方必须按码处理，不得只匹配文本。 */
export const REJECT = Object.freeze({
  BAD_SCHEMA: 'BAD_SCHEMA',
  STALE_REVISION: 'STALE_REVISION',
  STALE_AFTER_INPUT: 'STALE_AFTER_INPUT',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  DUPLICATE_ITEM: 'DUPLICATE_ITEM',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  UNAUTHORIZED_KIND: 'UNAUTHORIZED_KIND',
  NO_EFFECT: 'NO_EFFECT',
})

function reject(code, reason) {
  return { ok: false, code, reason }
}

/** 深拷贝（状态是纯 JSON；不用 structuredClone 以保持可预测的比较语义）。 */
function clone(state) {
  return JSON.parse(JSON.stringify(state))
}

/**
 * 提交一个候选 patch。
 * @returns {{ok:true, state:object, applied:number}} 或 {{ok:false, code:string, reason:string}}
 */
export function reduce(state, patch) {
  if (!isPlainObject(state)) return reject(REJECT.BAD_SCHEMA, 'state must be an object')
  if (state.schemaVersion !== SCHEMA_VERSION) {
    return reject(REJECT.BAD_SCHEMA, `schemaVersion mismatch: state=${state.schemaVersion} expected=${SCHEMA_VERSION}`)
  }
  const v = validatePatch(patch)
  if (!v.ok) return reject(REJECT.BAD_SCHEMA, v.errors.join('; '))

  if (patch.sessionId !== undefined && patch.sessionId !== state.sessionId) {
    return reject(REJECT.SESSION_MISMATCH, `patch.sessionId=${patch.sessionId} state.sessionId=${state.sessionId}`)
  }
  // CAS：旧 revision 的候选不得落地
  if (patch.baseRevision !== state.revision) {
    return reject(
      REJECT.STALE_REVISION,
      `baseRevision=${patch.baseRevision} but current revision=${state.revision}`,
    )
  }
  // 用户输入闸门：patch 基于的输入修订落后于最新用户输入 ⇒ 作废
  if (typeof patch.baseInputRevision === 'number' && patch.baseInputRevision < state.lastInputRevision) {
    return reject(
      REJECT.STALE_AFTER_INPUT,
      `baseInputRevision=${patch.baseInputRevision} < lastInputRevision=${state.lastInputRevision}`,
    )
  }

  const next = clone(state)
  let applied = 0

  for (const op of patch.ops) {
    switch (op.op) {
      case 'add_item': {
        if (next.items.some((it) => it.id === op.item.id)) {
          return reject(REJECT.DUPLICATE_ITEM, `item id already exists: ${op.item.id}`)
        }
        if (HUMAN_ONLY_KINDS.includes(op.item.kind)) {
          const hasHuman = op.item.sourceRefs.some((r) => r.kind === 'human')
          if (!hasHuman) return reject(REJECT.UNAUTHORIZED_KIND, `${op.item.kind} requires a human sourceRef`)
        }
        next.items.push({
          id: op.item.id,
          kind: op.item.kind,
          status: op.item.status || 'active',
          text: op.item.text,
          sourceRefs: op.item.sourceRefs,
          appliesTo: Array.isArray(op.item.appliesTo) ? op.item.appliesTo : [],
          supersedes: Array.isArray(op.item.supersedes) ? op.item.supersedes : [],
          dependsOn: Array.isArray(op.item.dependsOn) ? op.item.dependsOn : [],
          rationale: typeof op.item.rationale === 'string' ? op.item.rationale : null,
          // unknown 专属：分类（决定"问用户 / 去查 / 自行决定"）与是否阻塞下一步
          ...(op.item.kind === 'unknown' && op.item.unknownClass !== undefined
            ? { unknownClass: op.item.unknownClass } : {}),
          ...(op.item.kind === 'unknown' && op.item.blocksAction !== undefined
            ? { blocksAction: op.item.blocksAction === true } : {}),
        })
        // 取代关系：被取代的条目立刻退出有效集合
        for (const target of next.items[next.items.length - 1].supersedes) {
          const t = next.items.find((x) => x.id === target)
          if (t) t.status = 'superseded'
        }
        applied += 1
        break
      }
      case 'set_item_status': {
        const it = next.items.find((x) => x.id === op.id)
        if (!it) return reject(REJECT.UNKNOWN_ITEM, `no such item: ${op.id}`)
        it.status = op.status
        applied += 1
        break
      }
      case 'update_item': {
        const it = next.items.find((x) => x.id === op.id)
        if (!it) return reject(REJECT.UNKNOWN_ITEM, `no such item: ${op.id}`)
        // 身份不可改：schema 的 `isMutableItemField` 白名单已在结构层挡下 kind/sourceRefs/id。
        // 这里不再重复判断——重复的不可达检查会掩盖真实缺口（P2 修正）。
        for (const [k, val] of Object.entries(op.fields)) {
          it[k] = val
        }
        applied += 1
        break
      }
      case 'set_phase': {
        next.phase = op.phase
        applied += 1
        break
      }
      case 'add_question': {
        if (next.questions.some((q) => q.id === op.question.id)) {
          return reject(REJECT.DUPLICATE_ITEM, `question id already exists: ${op.question.id}`)
        }
        next.questions.push({ ...op.question, status: op.question.status || 'proposed' })
        applied += 1
        break
      }
      case 'answer_question': {
        const q = next.questions.find((x) => x.id === op.id)
        if (!q) return reject(REJECT.UNKNOWN_ITEM, `no such question: ${op.id}`)
        q.status = op.status
        if (op.answerSource !== undefined) q.answerSource = op.answerSource
        if (op.delegatedScope !== undefined) q.delegatedScope = op.delegatedScope
        applied += 1
        break
      }
      default:
        return reject(REJECT.BAD_SCHEMA, `unhandled op: ${String(op.op)}`)
    }
  }

  if (applied === 0) return reject(REJECT.NO_EFFECT, 'no operations applied')
  next.revision = state.revision + 1
  next.lastCauseId = patch.causeId
  return { ok: true, state: next, applied }
}

/**
 * 记录一次**用户输入**。这是唯一会推进 lastInputRevision 的入口，
 * 因而会使一切在它之前产生的候选 patch 失效。
 */
export function recordUserInput(state, { messageId, at }) {
  if (!isPlainObject(state)) throw new Error('recordUserInput: state required')
  if (typeof messageId !== 'string' || !messageId) throw new Error('recordUserInput: messageId required')
  const next = clone(state)
  if (!next.sourceMessageIds.includes(messageId)) next.sourceMessageIds.push(messageId)
  next.revision = state.revision + 1
  next.lastInputRevision = next.revision
  next.lastCauseId = 'user-input:' + messageId
  if (typeof at === 'string') next.lastInputAt = at
  return next
}

/** 有效条目：status === 'active'。 */
export function activeItems(state) {
  return state.items.filter((it) => it.status === 'active')
}

/** 按类型取有效条目。 */
export function itemsOfKind(state, kind) {
  if (!ITEM_KINDS.includes(kind)) return []
  return activeItems(state).filter((it) => it.kind === kind)
}

/** 自检不变量：返回违规清单（空 = 通过）。用于在提交前后做断言。 */
export function checkInvariants(state) {
  const problems = []
  if (!ITEM_KINDS.length) problems.push('no item kinds defined')
  for (const it of state.items) {
    if (!ITEM_KINDS.includes(it.kind)) problems.push(`item ${it.id}: bad kind`)
    if (!ITEM_STATUSES.includes(it.status)) problems.push(`item ${it.id}: bad status`)
    if (HUMAN_ONLY_KINDS.includes(it.kind)) {
      if (!it.sourceRefs.some((r) => r.kind === 'human')) problems.push(`item ${it.id}: ${it.kind} without human source`)
    }
  }
  if (state.lastInputRevision > state.revision) problems.push('lastInputRevision > revision')
  return problems
}
