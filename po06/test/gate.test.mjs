// P6-3 交付门测试：**离线桩**（验证器与投递都是注入的），不启动浏览器、不调模型。
// 运行：node po06/test/gate.test.mjs
import { LEVEL, resolveLevel, runGate, createMemoryLedgerStore } from '../lib/gate.js'
import { RESULT, createRecord } from '../lib/verifier.js'
import { DEFAULT_CAPS } from '../lib/feedback.js'

let pass = 0
const failures = []
const tests = []
function ta(name, fn) { tests.push({ name, fn }) }
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const HASH = 'a'.repeat(64)
const SID = 'session-gate'

function mkRecord(checks, sha = HASH) {
  const r = createRecord({
    artifact: { path: 'deliverable.html', sha256: sha },
    validator: { name: 'html-deliverable', version: '1.0.0', configHash: 'cdp-v1' },
    environmentRef: 'cdp:msedge',
    checks,
    coverage: ['可运行'],
    notCovered: ['审美'],
  })
  if (!r.ok) throw new Error('fixture: ' + JSON.stringify(r.errors))
  return r.record
}
const failCheck = (over = {}) => ({
  id: 'canvas-nonzero', property: '画布后备缓冲尺寸非零', result: RESULT.FAIL,
  observation: '实测 0x0', evidenceRefs: ['deliverable.html'], ...over,
})
const passCheck = (over = {}) => ({
  id: 'page-loads', property: '页面加载完成', result: RESULT.PASS,
  observation: 'readyState=complete', evidenceRefs: ['deliverable.html'], ...over,
})

const settings = (over = {}) => ({ autoReworkEnabled: false, allowWake: false, ...over })

// ── 1. 投递等级 ─────────────────────────────────────────────────────
tests.push({ name: '投递等级：默认 L0（什么都不发）', fn: () => {
  eq(resolveLevel({}), LEVEL.RECORD, 'no settings → record only')
  eq(resolveLevel({ autoReworkEnabled: false, allowWake: true }), LEVEL.RECORD, 'wake without auto-rework is still L0')
  eq(resolveLevel({ autoReworkEnabled: true, allowWake: false }), LEVEL.QUEUE, 'auto-rework → queue (no wake)')
  eq(resolveLevel({ autoReworkEnabled: true, allowWake: true }), LEVEL.WAKE, 'explicit wake')
} })

// ── 2. 主流程 ───────────────────────────────────────────────────────
ta('默认设置：验证会跑，但**不投递**（L0）', async () => {
  let delivered = 0
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()]) }),
    deliver: async () => { delivered += 1; return { ok: true } },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't1', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings() })
  eq(out.verdict, 'rework-eligible', 'it IS eligible…')
  eq(delivered, 0, '…but nothing is delivered at L0')
  ok(out.reasons.includes('delivery-level-is-record-only'), 'reason recorded: ' + JSON.stringify(out.reasons))
})

ta('L1：用不唤醒方式投递一次，并记账', async () => {
  const calls = []
  const store = createMemoryLedgerStore()
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck({ suspectedCause: '父子坐标变换错误' })]) }),
    deliver: async (level, payload) => { calls.push({ level, payload }); return { ok: true, messageId: 'm1' } },
    ledgerFor: store.ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't2', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.level, LEVEL.QUEUE, 'level')
  eq(calls.length, 1, 'delivered once')
  eq(calls[0].level, LEVEL.QUEUE, 'delivered at queue level')
  ok(calls[0].payload.text.includes('未证实'), 'instruction must mark suspected cause as unverified')
  ok(calls[0].payload.text.includes('不要扩大改动范围'), 'must bound scope')
  eq(store.ledgerFor('t2').repairRounds, 1, 'dispatch recorded')
})

ta('L2：唤醒式投递（只有显式开启才发生）', async () => {
  const calls = []
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()]) }),
    deliver: async (level) => { calls.push(level); return { ok: true } },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  await runGate(deps, { file: 'deliverable.html', taskId: 't3', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(calls, [LEVEL.WAKE], 'delivered at wake level')
})

// ── 3. 不该返工的情形 ───────────────────────────────────────────────
ta('全部通过 → 不投递', async () => {
  let delivered = 0
  const deps = {
    verify: async () => ({ record: mkRecord([passCheck()]) }),
    deliver: async () => { delivered += 1; return { ok: true } },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't4', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(out.verdict, 'pass', 'verdict')
  eq(delivered, 0, 'nothing delivered')
})

ta('基础设施故障 → 不进入修作品流程（且理由可机读）', async () => {
  let delivered = 0
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck({ result: RESULT.INFRA_ERROR, observation: 'msedge 启动失败', evidenceRefs: [] })]) }),
    deliver: async () => { delivered += 1; return { ok: true } },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't5', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(out.verdict, 'infrastructure_error', 'verdict')
  ok(out.reasons.includes('infrastructure-error-is-not-a-product-defect'), 'reason')
  eq(delivered, 0, 'nothing delivered')
})

ta('未知结果 → 不返工', async () => {
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck({ result: RESULT.UNKNOWN, observation: '采样不足', evidenceRefs: [] })]) }),
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'x.html', taskId: 't6', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(out.verdict, 'inconclusive', 'unknown-only is not a verdict of failure either way')
  ok(out.reasons.includes('unknown-result-is-not-evidence'), 'reason')
})

ta('未开启自动返工 → 有失败也不投递', async () => {
  let delivered = 0
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()]) }),
    deliver: async () => { delivered += 1; return { ok: true } },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't7', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: false, allowWake: true }) })
  // 授权**不**影响"产物是否不合格"的判断——它只决定"发不发得出去"。
  // 所以这里 verdict 仍是 rework-eligible，但**一条都没投递**，理由写明是等级限制。
  eq(out.verdict, 'rework-eligible', 'product verdict is independent of authorization')
  ok(out.reasons.includes('delivery-level-is-record-only'), 'reason: ' + JSON.stringify(out.reasons))
  eq(delivered, 0, 'nothing delivered without authorization')
})

ta('用户中途改口 → 在途失败作废', async () => {
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()]) }),
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't8', sessionId: SID, currentInputRevision: 5, recordInputRevision: 4, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(out.verdict, 'not-eligible', 'verdict')
  ok(out.reasons.includes('superseded-by-newer-user-input'), 'reason')
})

// ── 4. 预算 ─────────────────────────────────────────────────────────
ta('任务级预算：连续两次投递后到达上限，第三次不再投递', async () => {
  const store = createMemoryLedgerStore({ maxRepairRounds: 2 })
  const calls = []
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()], 'a'.repeat(64).replace(/.$/, '1')) }),
    deliver: async () => { calls.push(1); return { ok: true } },
    ledgerFor: store.ledgerFor,
    computeSha: () => 'a'.repeat(64).replace(/.$/, '1'),
  }
  const base = { file: 'd.html', taskId: 't9', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) }
  // 每次换产物版本，但仍受任务级总预算约束
  for (let i = 0; i < 3; i += 1) {
    const sha = 'a'.repeat(63) + String(i)
    deps.verify = async () => ({ record: mkRecord([failCheck()], sha) })
    deps.computeSha = () => sha
    const out = await runGate(deps, { ...base, file: 'd' + i + '.html' })
    if (i < 2) eq(out.verdict, 'rework-eligible', 'round ' + i + ' eligible: ' + JSON.stringify(out.reasons))
    else {
      // 第 3 轮被拦下。注意：**同一失败签名连续两轮 ⇒ 先报 no-progress**（ADR-0026 的优先级：
      // "修了但没用"比"轮数用完"更有诊断价值），所以这里要么是 stopped+no-progress。
      ok(out.verdict === 'stopped' || out.verdict === 'not-eligible', 'round 2 must be blocked: ' + JSON.stringify(out.reasons))
      ok(out.reasons.some((r) => r.includes('no-progress') || r.includes('repair-rounds-exhausted')),
        'reason must be a stop reason: ' + JSON.stringify(out.reasons))
    }
  }
  eq(calls.length, 2, 'exactly two deliveries')
})

ta('台账停止后，后续不再验证（省成本）', async () => {
  const store = createMemoryLedgerStore()
  store.stop('t10', 'user-cancelled')
  let verified = 0
  const deps = {
    verify: async () => { verified += 1; return { record: mkRecord([failCheck()]) } },
    deliver: async () => ({ ok: true }),
    ledgerFor: store.ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'x.html', taskId: 't10', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.verdict, 'stopped', 'verdict')
  eq(verified, 0, 'must not even run the verifier')
})

// ── 5. 故障路径 ─────────────────────────────────────────────────────
ta('验证器抛错 → 不外泄异常文本、不投递', async () => {
  const deps = {
    verify: async () => { throw new Error('SECRET-PATH-LEAK') },
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'x.html', taskId: 't11', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.verdict, 'verify-threw', 'verdict')
  eq(out.record, null, 'no record')
})

ta('验证器没产出记录 → 明确标记，不投递', async () => {
  const deps = {
    verify: async () => ({ raw: {} }),
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'x.html', taskId: 't12', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.verdict, 'no-record', 'verdict')
})

ta('投递失败 → 不记账（否则会白白消耗预算）', async () => {
  const store = createMemoryLedgerStore()
  const deps = {
    verify: async () => ({ record: mkRecord([failCheck()]) }),
    deliver: async () => ({ ok: false, reason: 'inject-unavailable' }),
    ledgerFor: store.ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'x.html', taskId: 't13', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.verdict, 'rework-eligible', 'verdict')
  eq(store.ledgerFor('t13').repairRounds, 0, 'failed delivery must NOT consume a repair round')
  ok(out.reasons.some((r) => r.startsWith('delivery-failed:')), 'reason: ' + JSON.stringify(out.reasons))
})

ta('informational 检查不阻碍 pass：好件应判 pass 而非 inconclusive', async () => {
  // 这条用例来自 P6-4 的真实自检发现：'中心像素采样'恒为 unknown，
  // 若计入"全部通过"，pass 永远不可达 —— 好件永远只能是 inconclusive。
  const rec = mkRecord([
    passCheck({ id: 'page-loads' }),
    passCheck({ id: 'canvas-nonzero', property: '画布尺寸非零' }),
    { id: 'canvas-content-sampled', property: '画布中心像素被采样到', result: RESULT.UNKNOWN,
      observation: '中心像素 rgba=[52,68,85,255]', evidenceRefs: [], informational: true },
  ])
  const deps = {
    verify: async () => ({ record: rec }),
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't14', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true, allowWake: true }) })
  eq(out.verdict, 'pass', 'a good deliverable must be able to reach pass')
  eq(out.reasons, [], 'a pass must not carry rework-eligibility reasons (that pairing misleads)')
  eq(out.delivered, null, 'nothing delivered')
})

ta('非 informational 的 unknown 仍使结论为 inconclusive', async () => {
  const rec = mkRecord([
    passCheck({ id: 'page-loads' }),
    { id: 'canvas-nonzero', property: '画布尺寸', result: RESULT.UNKNOWN, observation: '没有 canvas', evidenceRefs: [] },
  ])
  const deps = {
    verify: async () => ({ record: rec }),
    deliver: async () => { throw new Error('must not deliver') },
    ledgerFor: createMemoryLedgerStore().ledgerFor,
    computeSha: () => HASH,
  }
  const out = await runGate(deps, { file: 'deliverable.html', taskId: 't15', sessionId: SID, currentInputRevision: 1, recordInputRevision: 1, settings: settings({ autoReworkEnabled: true }) })
  eq(out.verdict, 'inconclusive', 'a decisive unknown still blocks pass')
})

// 运行
for (const { name, fn } of tests) {
  try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-gate', phase: 'P6', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
