// P6 验证器与有限反馈测试：纯函数、无 IO、无 LLM。
// 运行：node po06/test/feedback.test.mjs
import {
  RESULT, createRecord, checkOf, actionableFailures, hasInfrastructureError,
  isStale, dedupeKey, renderReworkInstruction,
} from '../lib/verifier.js'
import {
  createLedger, evaluateEligibility, recordDispatch, recordVerificationRun,
  detectNoProgress, shouldStop, stop, DEFAULT_CAPS, ELIGIBLE,
} from '../lib/feedback.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const HASH = 'a'.repeat(64)
const goodCheck = (over = {}) => ({
  id: 'c1', property: '炮塔与车体连接', result: RESULT.FAIL,
  observation: '截图中炮塔相对车体偏移约 1/4 车宽', evidenceRefs: ['shot.png'], ...over,
})
const mk = (checks, artifactOver = {}, recOver = {}) => createRecord({
  artifact: { path: 'tank.html', sha256: HASH, ...artifactOver },
  validator: { name: 'tank-geometry', version: '1.0.0', configHash: 'cfg1' },
  environmentRef: 'browser:edge@1420x800',
  checks,
  coverage: ['可运行', '炮塔-车体连接'],
  notCovered: ['审美', '手感'],
  ...recOver,
})

// ── 1. 记录必须绑定产物与覆盖范围 ───────────────────────────────────
t('缺少 sha256 的记录被拒（结论必须绑定产物版本）', () => {
  const r = mk([goodCheck()], { sha256: '' })
  ok(!r.ok, 'must reject')
  ok(r.errors.some((e) => e.includes('sha256')), 'reason: ' + JSON.stringify(r.errors))
})

t('缺少 observation 的检查被拒（没有观察就不是证据）', () => {
  const r = mk([goodCheck({ observation: '' })])
  ok(!r.ok, 'must reject')
  ok(r.errors.some((e) => e.includes('observation')), 'reason: ' + JSON.stringify(r.errors))
})

t('pass/fail 必须有 evidenceRefs', () => {
  const r = mk([goodCheck({ evidenceRefs: [] })])
  ok(!r.ok, 'must reject fail without evidence')
  const r2 = mk([goodCheck({ result: RESULT.UNKNOWN, evidenceRefs: [] })])
  ok(r2.ok, 'unknown may omit evidence')
})

t('覆盖范围必须显式声明（含 notCovered）', () => {
  const r = createRecord({
    artifact: { path: 'x', sha256: HASH },
    validator: { name: 'v', version: '1' },
    environmentRef: 'e',
    checks: [goodCheck()],
  })
  ok(!r.ok, 'must require coverage/notCovered')
  ok(r.errors.some((e) => e.includes('coverage')), 'coverage reason')
  ok(r.errors.some((e) => e.includes('notCovered')), 'notCovered reason')
})

t('合法记录建立成功且字段完整', () => {
  const r = mk([goodCheck()])
  ok(r.ok, 'ok: ' + JSON.stringify(r.errors))
  eq(r.record.coverage, ['可运行', '炮塔-车体连接'], 'coverage')
  eq(r.record.notCovered, ['审美', '手感'], 'notCovered')
  eq(checkOf(r.record, 'c1').property, '炮塔与车体连接', 'check lookup')
})

// ── 2. 只有 fail 可返工 ─────────────────────────────────────────────
t('只有 fail 进入可返工集合', () => {
  const r = mk([
    goodCheck({ id: 'c1', result: RESULT.FAIL }),
    goodCheck({ id: 'c2', result: RESULT.PASS }),
    goodCheck({ id: 'c3', result: RESULT.UNKNOWN, observation: '页面未加载完' }),
    goodCheck({ id: 'c4', result: RESULT.INFRA_ERROR, observation: '浏览器启动被拒', evidenceRefs: [] }),
    goodCheck({ id: 'c5', result: RESULT.CANCELLED, evidenceRefs: [] }),
  ])
  ok(r.ok, 'record ok')
  eq(actionableFailures(r.record).map((c) => c.id), ['c1'], 'only fail')
  ok(hasInfrastructureError(r.record), 'infra detected')
})

t('基础设施故障触发自动返工 = 拒绝，且理由明确', () => {
  const r = mk([goodCheck({ id: 'c1', result: RESULT.INFRA_ERROR, observation: 'msedge 启动失败', evidenceRefs: [] })])
  const led = createLedger('task-1')
  const e = evaluateEligibility({ record: r.record, ledger: led, currentSha256: HASH, authorized: true, currentInputRevision: 1, recordInputRevision: 1 })
  ok(!e.eligible, 'must be ineligible')
  ok(e.reasons.includes('infrastructure-error-is-not-a-product-defect'), 'reason: ' + JSON.stringify(e.reasons))
})

t('全部 unknown 也不返工', () => {
  const r = mk([goodCheck({ id: 'c1', result: RESULT.UNKNOWN, observation: '采样不足', evidenceRefs: [] })])
  const led = createLedger('task-1')
  const e = evaluateEligibility({ record: r.record, ledger: led, currentSha256: HASH, authorized: true, currentInputRevision: 1, recordInputRevision: 1 })
  ok(!e.eligible, 'must be ineligible')
  ok(e.reasons.includes('unknown-result-is-not-evidence'), 'reason: ' + JSON.stringify(e.reasons))
})

// ── 3. 六道门 ───────────────────────────────────────────────────────
function eligibleInput(over = {}) {
  const r = mk([goodCheck()])
  return {
    record: r.record,
    ledger: createLedger('task-1'),
    currentSha256: HASH,
    authorized: true,
    currentInputRevision: 1,
    recordInputRevision: 1,
    ...over,
  }
}

t('六道门全过时才 eligible', () => {
  const e = evaluateEligibility(eligibleInput())
  ok(e.eligible, 'eligible')
  eq(e.code, ELIGIBLE, 'code')
  eq(e.failures.length, 1, 'failures')
})

t('门②：产物版本不符 → 拒绝（旧结论不得用于新文件）', () => {
  const e = evaluateEligibility(eligibleInput({ currentSha256: 'b'.repeat(64) }))
  ok(!e.eligible, 'must reject')
  ok(e.reasons.includes('artifact-version-mismatch'), 'reason')
})

t('门③：用户新输入使其作废 → 拒绝', () => {
  const e = evaluateEligibility(eligibleInput({ currentInputRevision: 2, recordInputRevision: 1 }))
  ok(!e.eligible, 'must reject')
  ok(e.reasons.includes('superseded-by-newer-user-input'), 'reason')
})

t('门④：未授权 → 拒绝', () => {
  const e = evaluateEligibility(eligibleInput({ authorized: false }))
  ok(!e.eligible, 'must reject')
  ok(e.reasons.includes('not-authorized'), 'reason')
})

t('门⑤：轮数耗尽 → 拒绝', () => {
  const led = createLedger('task-1')
  for (let i = 0; i < DEFAULT_CAPS.maxRepairRounds; i += 1) led.repairRounds += 1
  const e = evaluateEligibility(eligibleInput({ ledger: led }))
  ok(!e.eligible, 'must reject')
  ok(e.reasons.includes('repair-rounds-exhausted'), 'reason')
})

t('门⑥：同一失败重复投递 → 拒绝', () => {
  const input = eligibleInput()
  recordDispatch(input.ledger, input.record, actionableFailures(input.record), 1000)
  const e = evaluateEligibility(input)
  ok(!e.eligible, 'must reject')
  ok(e.reasons.includes('all-failures-already-dispatched'), 'reason: ' + JSON.stringify(e.reasons))
})

t('去重键跨产物版本累计：换版本仍受任务级总预算约束', () => {
  const led = createLedger('task-1')
  const r1 = mk([goodCheck()])
  recordDispatch(led, r1.record, actionableFailures(r1.record), 1000)
  // 换了产物版本（sha 变了）→ 去重键不同，但 repairRounds 已计入
  const r2 = mk([goodCheck()], { sha256: 'b'.repeat(64) })
  eq(led.repairRounds, 1, 'rounds counted regardless of version')
  const e = evaluateEligibility({
    record: r2.record, ledger: led, currentSha256: 'b'.repeat(64), authorized: true,
    currentInputRevision: 1, recordInputRevision: 1,
  })
  ok(e.eligible, 'new version failure is a new key, still within budget')
  recordDispatch(led, r2.record, actionableFailures(r2.record), 1000)
  eq(led.repairRounds, 2, 'now at cap')
  const r3 = mk([goodCheck()], { sha256: 'c'.repeat(64) })
  const e3 = evaluateEligibility({
    record: r3.record, ledger: led, currentSha256: 'c'.repeat(64), authorized: true,
    currentInputRevision: 1, recordInputRevision: 1,
  })
  ok(!e3.eligible, 'cap must bind across versions (otherwise infinite loop)')
  ok(e3.reasons.includes('repair-rounds-exhausted'), 'reason')
})

// ── 4. 无进展与停止 ─────────────────────────────────────────────────
t('连续两轮同一失败集合 → 判定无进展', () => {
  const led = createLedger('task-1')
  const r = mk([goodCheck()])
  const f = actionableFailures(r.record)
  eq(detectNoProgress(led).noProgress, false, 'no rounds yet')
  recordDispatch(led, r.record, f, 100)
  eq(detectNoProgress(led).noProgress, false, 'one round')
  recordDispatch(led, r.record, f, 100)
  eq(detectNoProgress(led).noProgress, true, 'two identical rounds')
})

t('shouldStop 给出具体原因', () => {
  const led = createLedger('task-1')
  const r = mk([goodCheck()])
  const f = actionableFailures(r.record)
  eq(shouldStop(led), null, 'fresh ledger')
  recordDispatch(led, r.record, f, 100)
  recordDispatch(led, r.record, f, 100)
  eq(shouldStop(led), 'no-progress', 'no-progress wins')
})

t('时间预算耗尽也会停', () => {
  const led = createLedger('task-1', { maxRepairRounds: 99, maxAutoRepairMs: 500 })
  const r = mk([goodCheck()])
  recordDispatch(led, r.record, actionableFailures(r.record), 600)
  eq(shouldStop(led), 'repair-time-exhausted', 'time cap')
})

t('验证运行次数上限防止靠反复验证拖时间', () => {
  const led = createLedger('task-1', { maxVerificationRuns: 2 })
  recordVerificationRun(led)
  recordVerificationRun(led)
  eq(shouldStop(led), 'verification-runs-exhausted', 'run cap')
})

t('显式停止后不再 eligible', () => {
  const input = eligibleInput()
  stop(input.ledger, 'user-cancelled')
  const e = evaluateEligibility(input)
  ok(!e.eligible, 'must reject')
  ok(e.reasons.some((r) => r.startsWith('ledger-stopped:')), 'reason: ' + JSON.stringify(e.reasons))
})

// ── 5. 过期与返工指令文本 ───────────────────────────────────────────
t('isStale：产物变了旧记录即过期', () => {
  const r = mk([goodCheck()])
  eq(isStale(r.record, HASH), false, 'same hash')
  eq(isStale(r.record, 'b'.repeat(64)), true, 'different hash')
  eq(isStale(r.record, ''), true, 'unknown hash is stale by default')
})

t('返工指令：症状是事实、原因是推测，且明确标注', () => {
  const r = mk([goodCheck({ suspectedCause: '父子坐标变换错误' })])
  const text = renderReworkInstruction(r.record, actionableFailures(r.record))
  ok(text.includes('炮塔相对车体偏移'), 'observation included')
  ok(text.includes('未证实'), 'suspected cause must be marked unverified')
  ok(text.includes('不要扩大改动范围'), 'must bound the scope')
  ok(text.includes('sha256'), 'must bind to artifact version')
})

t('返工指令不含"必须重写整个程序"这类越权要求', () => {
  const r = mk([goodCheck()])
  const text = renderReworkInstruction(r.record, actionableFailures(r.record))
  for (const bad of ['重写整个', '全部推倒', '重新实现所有']) {
    ok(!text.includes(bad), 'must not contain: ' + bad)
  }
})

// ── 6. 确定性 ───────────────────────────────────────────────────────
t('确定性：同输入两次判定一致', () => {
  const a = evaluateEligibility(eligibleInput())
  const b = evaluateEligibility(eligibleInput())
  eq(a.eligible, b.eligible, 'eligible')
  eq(a.reasons, b.reasons, 'reasons')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-feedback', phase: 'P6', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
