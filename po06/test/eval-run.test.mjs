// P7 · 运行编排的确定性测试（**用假的补全函数，不调用任何模型**）
//
// 运行：node po06/test/eval-run.test.mjs
//
// 为什么这样写：编排里真正容易错的是**循环、预算、续跑、失败处理**，
// 而它们全都不需要真的调模型就能验。把 `complete` 做成注入的，
// 就能在不花钱的前提下断言"会不会超支""失败会不会被当成跑过"。
// 真实模型通道由冒烟证明（EV-0063，3,264 tokens）。
import { parseHoldout, HOLDOUT_SEAL, tasksForStage, buildRunUnits } from '../lib/eval-plan.js'
import { buildArmMessages, runUnits, runEvaluation } from '../lib/eval-run.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const S1 = tasksForStage(parseHoldout(readFileSync(join(HERE, '..', 'eval', HOLDOUT_SEAL.file), 'utf8')), 'S1')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
async function ta(name, fn) { try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

/** 假补全：每次固定返回 usage，可指定第几次开始抛错。 */
function fakeComplete({ perCall = 100, failAt = null, failAlways = false } = {}) {
  const calls = []
  const fn = async (unit) => {
    calls.push(unit.unitId)
    if (failAlways || (failAt && calls.length >= failAt)) throw new Error('FAKE-FAILURE at ' + unit.unitId)
    return { text: 'x'.repeat(10), usage: { inputTokens: 40, outputTokens: 60, totalTokens: perCall }, ms: 1, reasoning: '' }
  }
  fn.calls = calls
  return fn
}

// ── 1. 两臂消息构造（公平性的唯一凭据）──────────────────────────────
await ta('buildArmMessages：A 只有原话；C = 原话 + 意图包（顺序不可换）', () => {
  const T = '给这个 CLI 加上彩色输出。', P = '[插件辅助上下文] 明确要求：…'
  eq(buildArmMessages({ arm: 'A', taskText: T, packet: P }), [T], 'A 臂不得掺入意图包')
  eq(buildArmMessages({ arm: 'C', taskText: T, packet: P }), [T, P], 'C 臂是两条消息，原话在前')
  eq(buildArmMessages({ arm: 'C', taskText: T }), [T, ''], '缺包时仍返回两条（空串），形状不变')
  let threw = false
  try { buildArmMessages({ arm: 'Z', taskText: T }) } catch { threw = true }
  eq(threw, true, '未知臂必须抛错，不得静默当成 A')
})

// ── 2. 预算：不授权就不跑（最关键的一条安全性质）────────────────────
await ta('**未授权预算 ⇒ 一个单元都不跑**（complete 一次都不许被调用）', async () => {
  const units = buildRunUnits({ tasks: S1, arms: ['A', 'C'], runs: 3 })
  const fake = fakeComplete()
  for (const b of [null, undefined, 0, -5, 'abc']) {
    const out = await runEvaluation({
      tasks: S1, arms: ['A', 'C'], runs: 3, budget: b, spec: {}, complete: fake,
    })
    eq(out.refused, true, 'budget=' + String(b) + ' 必须拒绝')
    eq(out.ok, false, 'ok=false')
    eq(out.records.length, 0, '不得产生任何记录')
  }
  eq(fake.calls.length, 0, 'complete 绝不能被调用；实际调用 ' + fake.calls.length + ' 次')
  eq(units.length, 36, 'S1 本应有 36 个单元')
})

await ta('预算充足 ⇒ 跑满全部单元，且花费与记录一致', async () => {
  const fake = fakeComplete({ perCall: 100 })
  const out = await runEvaluation({ tasks: S1, arms: ['A', 'C'], runs: 3, budget: 100000, spec: {}, complete: fake })
  eq(out.refused, false, '不拒绝')
  eq(out.records.length, 36, '36 个单元都跑')
  eq(fake.calls.length, 36, '调用次数与单元数一致')
  eq(out.spent, 3600, '累计花费 36×100')
  eq(out.stopped, null, '不该有中途停止')
  eq(out.spend.units, 36, '汇总的成功单元数')
  eq(out.spend.failed, 0, '无失败')
})

// ── 3. 超支：必须在单元边界停下 ────────────────────────────────────
await ta('余额不足时**停在单元边界**，实际花费不得超预算', async () => {
  const fake = fakeComplete({ perCall: 300 })
  const out = await runEvaluation({
    tasks: S1, arms: ['A', 'C'], runs: 3, budget: 1000, spec: {},
    complete: fake, estimateForUnit: () => 300,
  })
  ok(out.spent <= 1000, '花费不得超预算：' + out.spent)
  eq(out.spent, 900, '跑到第 3 个（900），第 4 个之前停')
  eq(fake.calls.length, 3, '只调用 3 次')
  ok(out.stopped && out.stopped.reason === 'next-unit-exceeds-remaining', '停止理由：' + JSON.stringify(out.stopped))
})

await ta('不给单单元估计时，靠**实际花费**也能在越界后立即停', async () => {
  const fake = fakeComplete({ perCall: 400 })
  const out = await runEvaluation({ tasks: S1, arms: ['A', 'C'], runs: 3, budget: 1000, spec: {}, complete: fake })
  // 第 1 个 400（余 600）→ 第 2 个 400（余 200）→ 第 3 个开始前余额 200 > 0 仍会跑（无估计可判断）
  // 所以允许"跑过一点点"，但**必须在余额耗尽后立刻停**，且总花费有界。
  ok(out.spent >= 1000 ? out.stopped !== null : true, '若已越过预算就必须已停止')
  eq(out.stopped.reason, 'budget-exhausted', '最终以"用尽"停止：' + JSON.stringify(out.stopped))
  ok(out.spent <= 1000 + 400, '越界幅度不超过一个单元：' + out.spent)
  ok(fake.calls.length <= 3, '不得继续跑：' + fake.calls.length)
})

// ── 4. 续跑：跑过的不重跑；失败的必须重跑 ──────────────────────────
await ta('续跑跳过已完成单元（**不重复花钱**）', async () => {
  const first = fakeComplete({ perCall: 100 })
  const r1 = await runEvaluation({ tasks: S1, arms: ['A', 'C'], runs: 3, budget: 100000, spec: {}, complete: first })
  eq(r1.records.length, 36, '第一轮跑满')
  const second = fakeComplete({ perCall: 100 })
  const r2 = await runEvaluation({
    tasks: S1, arms: ['A', 'C'], runs: 3, budget: 100000, spec: {},
    complete: second, priorRecords: r1.records, priorSpent: r1.spent,
  })
  eq(second.calls.length, 0, '已完成 ⇒ 一次都不该再调')
  eq(r2.records.length, 0, '无新记录')
  eq(r2.spent, r1.spent, '花费不增加')
})

await ta('失败单元**不算跑过**：续跑时必须重试', async () => {
  const failing = fakeComplete({ perCall: 100, failAt: 3 })   // 第 3 个起全失败
  const r1 = await runEvaluation({ tasks: S1, arms: ['A', 'C'], runs: 3, budget: 100000, spec: {}, complete: failing })
  eq(r1.records.length, 36, '失败也逐个记录（不中断整轮）')
  eq(r1.spend.failed, 34, '34 个失败')
  eq(r1.spend.units, 2, '只有 2 个成功')
  eq(r1.completedAfter.size, 2, 'completedAfter 只含成功的 2 个')

  const retry = fakeComplete({ perCall: 100 })
  const r2 = await runEvaluation({
    tasks: S1, arms: ['A', 'C'], runs: 3, budget: 100000, spec: {},
    complete: retry, priorRecords: r1.records, priorSpent: r1.spent,
  })
  eq(retry.calls.length, 34, '失败的 34 个必须重试')
  eq(r2.records.length, 34, '产生 34 条新记录')
})

await ta('单个单元抛错不终止整轮（一次抖动不得毁掉几十分钟进度）', async () => {
  let n = 0
  const flaky = async () => { n += 1; if (n === 5) throw new Error('boom'); return { text: 'y', usage: { totalTokens: 10 }, ms: 1 } }
  const out = await runUnits({ units: buildRunUnits({ tasks: S1, arms: ['A'], runs: 3 }), budget: 100000, complete: flaky })
  eq(out.records.length, 18, '18 个单元全部有记录')
  eq(out.records[4].ok, false, '第 5 个记为失败')
  eq(out.records[5].ok, true, '后面继续跑')
  eq(out.spend.failed, 1, '失败计数')
})

await ta('onRecord 回调逐单元触发（落盘用），且回调抛错不打断运行', async () => {
  const seen = []
  const fake = fakeComplete({ perCall: 10 })
  const out = await runUnits({
    units: buildRunUnits({ tasks: S1.slice(0, 1), arms: ['A', 'C'], runs: 1 }),
    budget: 100000, complete: fake,
    onRecord: (r) => { seen.push(r.unitId); throw new Error('disk full') },
  })
  eq(seen.length, 2, '每个单元都回调')
  eq(out.records.length, 2, '回调抛错不影响记录')
})

// ── 5. 参数与错误处理 ─────────────────────────────────────────────
await ta('runUnits 缺 complete ⇒ 抛错（不得静默空跑）', async () => {
  let threw = false
  try { await runUnits({ units: [], budget: 100 }) } catch { threw = true }
  eq(threw, true, '必须抛错')
})

await ta('空单元集 ⇒ 不调用、不报错', async () => {
  const fake = fakeComplete()
  const out = await runUnits({ units: [], budget: 100, complete: fake })
  eq(out.records.length, 0, '无记录')
  eq(fake.calls.length, 0, '无调用')
  eq(out.stopped, null, '不算停止')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-eval-run', phase: 'P7', total, pass, fail: failures.length, failures,
  holdoutSha256: HOLDOUT_SEAL.sha256,
  note: '用注入的假补全函数做确定性测试，**未调用任何模型**；真实通道由冒烟 EV-0063 证明。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
