// dsh-prompt-optimizer 0.6 · 交付门（编排：验证 → 判定 → 按等级投递）
//
// 依据 PLAN-0.6.md §13 与 ADR-0012/0026。本模块把三件事串起来，且**每一件都可注入**（便于离线测试）：
//   verify(file) → record      真实验证器（P6-2 的 verifier-html）
//   evaluateEligibility(...)   六道门判定（P6-1）
//   deliver(level, text)       投递（默认不唤醒）
//
// **三级投递**（安全等级递增，默认 L0）：
//   L0 record  只记录与展示，**什么都不发**（默认）
//   L1 queue   用 `inject` 排入下一步——**不唤醒**，工作 AI 下次动的时候才会看到
//   L2 wake    用 `followup`/`steer` 唤醒——**会让工作 AI 立刻动起来**，必须用户显式开启
//
// 为什么默认 L0：机器检测到的失败**不等于**用户授权你去改动他的东西（ADR-0026）。

import { actionableFailures, hasInfrastructureError, renderReworkInstruction, RESULT } from './verifier.js'
import { createLedger, evaluateEligibility, recordDispatch, recordVerificationRun, shouldStop, stop } from './feedback.js'

export const LEVEL = Object.freeze({ RECORD: 'L0-record', QUEUE: 'L1-queue', WAKE: 'L2-wake' })

/**
 * 解析本次允许的投递等级。
 * @param opts {
 *   autoReworkEnabled:boolean,   // 用户设置：是否允许自动返工
 *   allowWake:boolean,           // 用户设置：是否允许唤醒（默认 false）
 *   sessionPermission:'review'|'auto'
 * }
 */
export function resolveLevel(opts = {}) {
  if (opts.autoReworkEnabled !== true) return LEVEL.RECORD
  if (opts.allowWake === true) return LEVEL.WAKE
  return LEVEL.QUEUE
}

/**
 * 跑一次交付门。
 * @param deps {
 *   verify:     async (file) => { record, raw }
 *   deliver:    async (level, { sessionId, text, summary }) => { ok, reason?, messageId? }
 *   ledgerFor:  (taskId) => ledger          （取/建任务级台账）
 *   computeSha: (file) => string|null
 * }
 * @param input { file, taskId, sessionId, currentInputRevision, recordInputRevision, settings }
 */
export async function runGate(deps, input) {
  const out = {
    file: input.file, taskId: String(input.taskId || 'default'),
    level: resolveLevel(input.settings), verdict: null, reasons: [], delivered: null, record: null,
  }

  // 0) 预算已停则不再验证（省成本，也避免"靠反复验证拖时间"）
  const ledger = deps.ledgerFor(out.taskId)
  const preStop = shouldStop(ledger)
  if (preStop) {
    out.verdict = 'stopped'
    out.reasons.push('pre-check:' + preStop)
    return out
  }

  // 1) 验证（计入运行次数）
  recordVerificationRun(ledger)
  let verified
  try {
    verified = await deps.verify(input.file)
  } catch (e) {
    out.verdict = 'verify-threw'
    out.reasons.push('verifier-error:' + String((e && e.message) || e))
    return out
  }
  const record = verified && verified.record ? verified.record : (verified && verified.built ? verified.built.record : null)
  out.record = record
  if (!record) {
    out.verdict = 'no-record'
    out.reasons.push('verifier-did-not-produce-a-record')
    return out
  }

  // 2) 基础设施故障：明确记录，**不进入修作品流程**
  if (hasInfrastructureError(record)) {
    out.verdict = 'infrastructure_error'
    out.reasons.push('infrastructure-error-is-not-a-product-defect')
    return out
  }

  // 3) 判定（六道门）
  const currentSha = deps.computeSha ? deps.computeSha(input.file) : (record.artifact && record.artifact.sha256)
  const elig = evaluateEligibility({
    record,
    ledger,
    currentSha256: currentSha,
    // **授权是与投递有关的事，不是产品是否有缺陷的判断**。
    // 传 true 让六道门回答"这份产物是否确实不合格"；
    // "能不能发出去"由 resolveLevel 与下方 level 分支决定。
    authorized: true,
    currentInputRevision: input.currentInputRevision,
    recordInputRevision: input.recordInputRevision,
  })

  if (!elig.eligible) {
    out.verdict = 'not-eligible'
    out.reasons = elig.reasons
    // 无失败 = 通过；有失败但不可返工 = 如实标明是哪一类
    const failures = actionableFailures(record)
    if (failures.length === 0) {
      // "全部通过"与"没有可判定证据"不是一回事，不许糊成同一个结论
      // 只看**参与判定**的检查（informational 的观察不算数，否则 pass 永不可达）
      const decisive = (record.checks || []).filter((c) => c.informational !== true)
      const allPass = decisive.length > 0 && decisive.every((c) => c.result === RESULT.PASS)
      out.verdict = allPass ? 'pass' : 'inconclusive'
      // verdict 已定，就不再挂"为何未进入返工"的理由——
      // 否则会出现 \`verdict: pass\` 旁边写着 \`unknown-result-is-not-evidence\` 这种会误导人的配对。
      if (allPass) out.reasons = []
    }
    return out
  }

  // 4) 渲染返工指令（只陈述现象；推测原因标注未证实）
  const failures = elig.failures
  const text = renderReworkInstruction(record, failures)
  out.verdict = 'rework-eligible'
  out.failures = failures.map((f) => f.id)

  // 5) 按等级投递
  if (out.level === LEVEL.RECORD) {
    out.reasons.push('delivery-level-is-record-only')
    return out
  }
  const res = await deps.deliver(out.level, {
    sessionId: input.sessionId,
    text,
    summary: '交付验证：' + failures.map((f) => f.property).join('、'),
  })
  out.delivered = res
  if (res && res.ok) {
    recordDispatch(ledger, record, failures, input.elapsedMs || 0)
    out.reasons.push('dispatched-at:' + out.level)
  } else {
    out.reasons.push('delivery-failed:' + String((res && res.reason) || 'unknown'))
  }
  return out
}

/** 便捷：为某任务取/建台账（内存版；持久化留给宿主投影）。 */
export function createMemoryLedgerStore(capsByTask) {
  const map = new Map()
  return {
    ledgerFor(taskId) {
      if (!map.has(taskId)) map.set(taskId, createLedger(taskId, capsByTask))
      return map.get(taskId)
    },
    stop(taskId, reason) { stop(this.ledgerFor(taskId), reason) },
    size() { return map.size },
  }
}
