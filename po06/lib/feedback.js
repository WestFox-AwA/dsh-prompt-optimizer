// dsh-prompt-optimizer 0.6 · 有限反馈（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §13。核心立场：
//   **发现症状不等于知道病因，机器结论也不等于用户授权。**
//   所以自动返工要过六道门，且受**任务级**总预算约束（不是"每版各修一次"）。
import { RESULT, actionableFailures, dedupeKey, isStale } from './verifier.js'

/** 工程初值（可配置；PLAN-0.6.md §15 登记为建议初值，不是用户批准值）。 */
export const DEFAULT_CAPS = Object.freeze({
  maxRepairRounds: 2,        // 每任务自动返工轮数上限
  maxAutoRepairMs: 10 * 60 * 1000,
  maxVerificationRuns: 6,
})

export const ELIGIBLE = 'eligible'
export const INELIGIBLE = 'ineligible'

/** 新建一个任务级预算台账。 */
export function createLedger(taskId, caps) {
  return {
    taskId: String(taskId),
    caps: { ...DEFAULT_CAPS, ...(caps || {}) },
    repairRounds: 0,
    verificationRuns: 0,
    autoRepairMs: 0,
    stoppedReason: null,
    /** 已发过的去重键（跨产物版本累计，防无限循环） */
    dispatchedKeys: [],
    /** 每轮失败检查的签名，用于无进展检测 */
    roundSignatures: [],
  }
}

function reject(reasons) { return { eligible: false, code: INELIGIBLE, reasons } }

/**
 * 判断一条验证记录是否可以触发自动返工。六道门（PLAN-0.6.md §13.1）：
 *   ① 有可返工的失败（只有 `fail`；infra/unknown 不算）
 *   ② 失败绑定**当前**产物版本（旧版本的 pass/fail 都不算）
 *   ③ 记录未过期、且用户输入未使它作废
 *   ④ 在用户已授权的范围内（`authorized` 由调用方按会话政策给出）
 *   ⑤ 任务级预算未耗尽
 *   ⑥ 这不是同一失败的重复投递（去重）
 */
export function evaluateEligibility({ record, ledger, currentSha256, authorized, currentInputRevision, recordInputRevision }) {
  const reasons = []

  if (!record) return reject(['no-record'])
  const failures = actionableFailures(record)
  if (failures.length === 0) {
    // 明确区分"没失败"与"失败但不可返工"
    const hasInfra = Array.isArray(record.checks) && record.checks.some((c) => c.result === RESULT.INFRA_ERROR)
    const hasUnknown = Array.isArray(record.checks) && record.checks.some((c) => c.result === RESULT.UNKNOWN)
    if (hasInfra) reasons.push('infrastructure-error-is-not-a-product-defect')
    if (hasUnknown) reasons.push('unknown-result-is-not-evidence')
    if (!hasInfra && !hasUnknown) reasons.push('no-failure')
    return reject(reasons)
  }

  if (isStale(record, currentSha256)) reasons.push('artifact-version-mismatch')
  if (typeof currentInputRevision === 'number' && typeof recordInputRevision === 'number'
    && currentInputRevision !== recordInputRevision) {
    reasons.push('superseded-by-newer-user-input')
  }
  if (authorized !== true) reasons.push('not-authorized')
  if (ledger.stoppedReason) reasons.push('ledger-stopped:' + ledger.stoppedReason)
  if (ledger.repairRounds >= ledger.caps.maxRepairRounds) reasons.push('repair-rounds-exhausted')
  if (ledger.autoRepairMs >= ledger.caps.maxAutoRepairMs) reasons.push('repair-time-exhausted')
  if (ledger.verificationRuns >= ledger.caps.maxVerificationRuns) reasons.push('verification-runs-exhausted')

  const fresh = failures.filter((f) => !ledger.dispatchedKeys.includes(dedupeKey(record, f)))
  if (fresh.length === 0) reasons.push('all-failures-already-dispatched')

  if (reasons.length > 0) return reject(reasons)
  return { eligible: true, code: ELIGIBLE, reasons: [], failures: fresh }
}

/** 失败集合的签名（用于检测"两轮之间没有进展"）。 */
export function failureSignature(failures) {
  return failures.map((f) => f.id + ':' + f.property).sort().join(';')
}

/**
 * 记一轮返工投递。**跨产物版本累计** `dispatchedKeys`——
 * 只按文件版本去重无法防止"每版各修一次"的无限循环。
 */
export function recordDispatch(ledger, record, failures, elapsedMs) {
  ledger.repairRounds += 1
  ledger.autoRepairMs += Math.max(0, Number(elapsedMs) || 0)
  for (const f of failures) {
    const k = dedupeKey(record, f)
    if (!ledger.dispatchedKeys.includes(k)) ledger.dispatchedKeys.push(k)
  }
  const sig = failureSignature(failures)
  ledger.roundSignatures.push(sig)
  return ledger
}

/** 记一次验证运行（无论结果如何都计入，防止靠反复验证拖时间）。 */
export function recordVerificationRun(ledger) {
  ledger.verificationRuns += 1
  return ledger
}

/**
 * 无进展检测：连续两轮**同一失败集合**（签名相同）即视为没有进展。
 * @returns {noProgress:boolean, rounds:number}
 */
export function detectNoProgress(ledger) {
  const s = ledger.roundSignatures
  if (s.length < 2) return { noProgress: false, rounds: s.length }
  const last = s[s.length - 1]
  const prev = s[s.length - 2]
  return { noProgress: last === prev, rounds: s.length }
}

/**
 * 是否应该停止自动循环；返回原因或 null。
 * 停止后**保留证据并把结论交给人**，不静默继续。
 */
export function shouldStop(ledger) {
  // **报告优先级 = 信息量优先级**：多种停止条件同时成立时，报最能说明问题的那个。
  // "无进展"告诉你"修了但没用"；"轮数耗尽"只说明预算用完了。
  // 前者对排查更有价值，所以排在预算类原因之前。
  if (ledger.stoppedReason) return ledger.stoppedReason            // 显式停止（用户取消/严重回归）最优先
  if (detectNoProgress(ledger).noProgress) return 'no-progress'    // 修了没效果——最有诊断价值
  if (ledger.autoRepairMs >= ledger.caps.maxAutoRepairMs) return 'repair-time-exhausted'
  if (ledger.verificationRuns >= ledger.caps.maxVerificationRuns) return 'verification-runs-exhausted'
  if (ledger.repairRounds >= ledger.caps.maxRepairRounds) return 'repair-rounds-exhausted'
  return null
}

/** 显式停止（用户取消 / 新指令作废 / 发现严重回归）。 */
export function stop(ledger, reason) {
  ledger.stoppedReason = String(reason)
  return ledger
}

/**
 * 用户新指令到达时调用：作废在途返工。
 * 返回的是**判断结果**，实际取消由调用方执行（可能涉及宿主取消信号）。
 */
export function onNewUserInput(ledger) {
  return { cancelPending: true, reason: 'user-input-supersedes-pending-repair', ledger }
}
