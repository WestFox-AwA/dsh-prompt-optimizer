// P7 × P5/P6 · **拿留出集 S3 的真题**检验长任务、环境受限、取消与晚到的判据。
//
// 运行：node po06/test/holdout-longtask.test.mjs
//
// 为什么值得单独测：留出集 S3 的题**写明了可判定的验收行为**，而此前
// longtask/carryover/feedback 的测试全是人造夹具。真题给出的判据是具体的：
//   · H-13「第三轮应回到未改状态，而**不是叠加**前两轮的改动」
//   · H-15「那条约束必须在**后续每一轮**都仍然有效且被遵守」
//   · H-16「验证通道不可用时须如实报告 infrastructure_error，**不得**声称"已验证"」
//   · H-18「取消必须生效；晚到结果**不得**自动提交或发出」
// 这四条都能在**零模型调用**下判定——所以没有理由等到花了钱才查。
//
// ⚠ 输入是**手写的解释层输出**（不是真实模型输出）。测的是"给定这样的解释结果，
//  机制是否满足判据"，**不测**模型会不会产出这样的解释（后者属 E-001）。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createState } from '../lib/schema.js'
import { reduce, activeItems } from '../lib/reducer.js'
import { compile, compileAudited } from '../lib/compiler.js'
import { createRecord, actionableFailures, hasInfrastructureError, RESULT } from '../lib/verifier.js'
import { createLedger, evaluateEligibility, stop } from '../lib/feedback.js'
import { parseHoldout, HOLDOUT_SEAL, STAGES, tasksForStage } from '../lib/eval-plan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOLDOUT = readFileSync(join(HERE, '..', 'eval', HOLDOUT_SEAL.file), 'utf8')
const S3 = tasksForStage(parseHoldout(HOLDOUT), 'S3')
const SID = 'session-holdout-s3'
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) } }

/** 依次施加多个 patch，任一步失败即抛（夹具坏了必须立刻可见）。 */
function applyAll(state, patches) {
  let s = state
  for (const [i, p] of patches.entries()) {
    const r = reduce(s, { causeId: 'c' + i, baseRevision: s.revision, sessionId: SID, ...p })
    if (!r.ok) throw new Error(`patch ${i} failed: ${r.code} ${r.reason}`)
    s = r.state
  }
  return s
}
/** 建一条**合法**验证记录（走 createRecord，别手拼——手拼会缺 property/evidenceRefs）。 */
function rec(checks, sha) {
  const built = createRecord({
    artifact: { path: 'C:/tmp/x.html', sha256: sha },
    validator: { name: 'probe', version: '1.0.0' },
    environmentRef: 'unit',
    checks,
    coverage: ['what this covers'],
    notCovered: ['审美', '玩法'],
  })
  if (!built.ok) throw new Error('record fixture invalid: ' + JSON.stringify(built.errors))
  return built.record
}
const chk = (id, result, observation, evidenceRefs) => ({
  id, property: 'p:' + id, result, observation,
  ...(evidenceRefs ? { evidenceRefs } : {}),
})

const item = (id, kind, text, scope, extra = {}) => ({
  op: 'add_item',
  ops: [{
    op: 'add_item',
    item: { id, kind, text, scope, sourceRefs: [human('m-' + id)], ...extra },
  }],
})
const advance = (turnId) => ({ ops: [{ op: 'advance_turn', turnId }] })
/** **撤回的正确建模**：就地改状态，而不是新增一条"撤回"需求。
 *  新增 carrier 会让"撤回"这句话本身变成一条 active 的用户要求，
 *  于是它会出现在交给工作 AI 的意图包里——这是真实陷阱，下面单独测。 */
const retract = (id) => ({ ops: [{ op: 'set_item_status', id, status: 'retracted' }] })

// ── 0. 前提 ─────────────────────────────────────────────────────────
t('拿到的是留出集 S3 的 6 道真题', () => {
  eq(S3.length, 6, 'S3 题数')
  eq(S3.map((x) => x.id), STAGES.S3.ids.slice().sort(), '题号')
  ok(S3.find((x) => x.id === 'H-13').body.includes('圆角'), 'H-13 正文')
  ok(S3.find((x) => x.id === 'H-15').body.includes('标准库'), 'H-15 正文')
})

// ── H-13 改口与撤回：第三轮回到原状，**不是叠加** ────────────────────
t('H-13 三轮之后有效变更集**为空**（回到未改状态），且撤回件可追溯', () => {
  const s0 = createState({ sessionId: SID, taskId: 'h13' })
  const s = applyAll(s0, [
    advance('t1'),
    item('round1-radius', 'user_requirement', '把主页卡片的圆角改成 8px', 'turn'),   // ①
    advance('t2'),
    // ②「算了，圆角别动，改成给卡片加个阴影」：撤回圆角 + 新增阴影
    retract('round1-radius'),
    item('round2-shadow', 'user_requirement', '给卡片加个阴影', 'turn'),
    advance('t3'),
    // ③「阴影也撤掉，回到最开始那样」
    retract('round2-shadow'),
  ])
  const active = activeItems(s).filter((it) => it.kind === 'user_requirement')
  eq(active.map((it) => it.id), [], '第三轮后**不得**留下任何有效变更（叠加就是错的）')

  // 撤回不是删除：历史仍在（可追溯）
  const all = Object.fromEntries(s.items.map((it) => [it.id, it.status]))
  eq(all['round1-radius'], 'retracted', '① 应被撤回')
  eq(all['round2-shadow'], 'retracted', '② 的阴影应被撤回')

  // 编译出来的意图包也不得再提这两件事
  const c = compile(s, { budget: 4000 })
  ok(!c.text.includes('圆角'), '撤回后不得再出现在意图包里：' + c.text.slice(0, 120))
  ok(!c.text.includes('阴影'), '撤回后不得再出现在意图包里：' + c.text.slice(0, 120))
})

t('H-13 陷阱：把"撤回"写成新增一条需求 ⇒ 它会作为**有效要求**发给工作 AI', () => {
  // 这条不是假设：我第一次就是这么建模的，测试立刻抓到 active 里多出一条
  // "[撤回] …"。撤回若用一个 carrier 条目表达，而 carrier 自己又是
  // user_requirement，它就会出现在意图包里 —— 工作 AI 会以为用户在要求"撤回"。
  const s0 = createState({ sessionId: SID, taskId: 'h13c' })
  const s = applyAll(s0, [
    advance('t1'),
    item('shadow-item', 'user_requirement', '给卡片加个阴影', 'turn'),
    {
      ops: [{
        op: 'add_item',
        item: {
          id: 'carrier-retract', kind: 'user_requirement', scope: 'turn',
          text: '[撤回] 阴影也撤掉', sourceRefs: [human('m-c')], supersedes: ['shadow-item'],
        },
      }],
    },
  ])
  const st = Object.fromEntries(s.items.map((it) => [it.id, it.status]))
  eq(st['shadow-item'], 'superseded', 'supersedes 确实让目标退役')
  eq(st['carrier-retract'], 'active', '**但 carrier 自己是 active** —— 这就是陷阱')
  const c = compile(s, { budget: 4000 })
  ok(c.text.includes('撤回'), '于是"撤回"这句话本身进了意图包：' + c.text.slice(0, 160))
})

t('H-13 对照：若**不**撤回，turn 级条目仍会退役 —— 说明"空集"另有来源', () => {
  const s0 = createState({ sessionId: SID, taskId: 'h13b' })
  const s = applyAll(s0, [
    advance('t1'), item('feat-a', 'user_requirement', '圆角 8px', 'turn'),
    advance('t2'), item('feat-b', 'user_requirement', '加阴影', 'turn'),
    advance('t3'), item('feat-c', 'user_requirement', '再改点别的', 'turn'),
  ])
  const statuses = Object.fromEntries(s.items.map((it) => [it.id, it.status]))
  eq(statuses['feat-a'], 'superseded', '上一轮的 turn 级条目必须退役')
  eq(statuses['feat-b'], 'superseded', '上一轮的 turn 级条目必须退役')
  eq(statuses['feat-c'], 'active', '本轮条目仍有效')
})

// ── H-15 长期约束保持：跨轮仍然有效且被遵守 ──────────────────────────
t('H-15 任务级约束跨 3 轮仍然 active，且每轮编译文本里都还在', () => {
  const s0 = createState({ sessionId: SID, taskId: 'h15' })
  const CONSTRAINT = '这个项目只用标准库，不准加任何第三方依赖'
  let s = applyAll(s0, [
    advance('t1'),
    item('constraint-stdlib', 'user_requirement', CONSTRAINT, 'task'),   // 第一轮声明
  ])

  const seen = []
  for (const [i, turn] of ['t2', 't3', 't4'].entries()) {
    s = applyAll(s, [
      advance(turn),
      item('feat-' + i, 'user_requirement', '新功能需求 ' + (i + 1), 'turn'),
    ])
    const c = compile(s, { budget: 4000 })
    const stillActive = activeItems(s).some((it) => it.id === 'constraint-stdlib')
    const inText = c.text.includes('标准库')
    seen.push({ turn, stillActive, inText })
  }
  for (const x of seen) {
    eq(x.stillActive, true, x.turn + '：约束必须仍然 active')
    eq(x.inText, true, x.turn + '：约束必须仍在编译文本里（不能被预算丢掉）')
  }
})

t('H-15 对照：turn 级的需求**不该**活过本轮（否则长期约束与临时需求就没区别）', () => {
  const s0 = createState({ sessionId: SID, taskId: 'h15b' })
  const s = applyAll(s0, [
    advance('t1'),
    item('con-stdlib', 'user_requirement', '只用标准库', 'task'),
    item('turn-feature', 'user_requirement', '本轮：加个导出命令', 'turn'),
    advance('t2'),
  ])
  const st = Object.fromEntries(s.items.map((it) => [it.id, it.status]))
  eq(st['con-stdlib'], 'active', 'task 级必须活下来')
  eq(st['turn-feature'], 'superseded', 'turn 级必须退役')
})

// ── H-16 验证通道不可用：如实报 infra，不得当成"已验证" ──────────────
t('H-16 验证通道不可用 ⇒ 不可返工，且理由点名是基础设施问题', () => {
  const r = rec([
    chk('file-readable', RESULT.PASS, '文件大小 78081 字节', ['x.html']),
    chk('browser-available', RESULT.INFRA_ERROR, '未找到可用的 msedge/chrome 可执行文件'),
    chk('canvas-nonzero', RESULT.UNKNOWN, '未测（通道不可用）'),
  ], 'a'.repeat(64))
  eq(actionableFailures(r).length, 0, 'infra 不是可返工失败')
  eq(hasInfrastructureError(r), true, '必须被识别为基础设施故障')
  const ledger = createLedger('h16')
  const d = evaluateEligibility({
    record: r, ledger, currentSha256: 'a'.repeat(64), authorized: true,
    currentInputRevision: 1, recordInputRevision: 1,
  })
  eq(d.eligible, false, '不得触发返工')
  ok(d.reasons.includes('infrastructure-error-is-not-a-product-defect'),
    '理由必须点名基础设施：' + JSON.stringify(d.reasons))
})

t('H-16 关键区分：infra 与"通过"是**不同**的结果，不得被读成已验证', () => {
  ok(RESULT.INFRA_ERROR !== RESULT.PASS, '二者必须不同值')
  ok(RESULT.UNKNOWN !== RESULT.PASS, 'unknown 也不等于通过')
  const r = rec([
    chk('browser-available', RESULT.INFRA_ERROR, '通道不可用'),
  ], 'c'.repeat(64))
  const allPass = r.checks.every((c) => c.result === RESULT.PASS)
  eq(allPass, false, 'infra 不得满足"全部通过"')
})

// ── H-18 取消与晚到：取消后晚到的结果不得自动发出 ────────────────────
t('H-18 取消生效：晚到的**真失败**结果也不得触发返工/投递', () => {
  const r = rec([
    chk('canvas-nonzero', RESULT.FAIL, '0x0', ['x.html']),
  ], 'b'.repeat(64))
  const ledger = createLedger('h18')
  // 先确认"未取消时它是可以返工的"——否则下面的断言毫无意义
  const before = evaluateEligibility({
    record: r, ledger, currentSha256: 'b'.repeat(64), authorized: true,
    currentInputRevision: 1, recordInputRevision: 1,
  })
  eq(before.eligible, true, '前提：未取消时该失败本可返工')

  stop(ledger, 'cancelled')
  const after = evaluateEligibility({
    record: r, ledger, currentSha256: 'b'.repeat(64), authorized: true,
    currentInputRevision: 1, recordInputRevision: 1,
  })
  eq(after.eligible, false, '取消之后**不得**再返工')
  ok(after.reasons.some((x) => x.includes('cancelled')),
    '理由必须写明是取消：' + JSON.stringify(after.reasons))
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-holdout-longtask', phase: 'P7xP5P6', total, pass, fail: failures.length,
  failures, holdoutSha256: HOLDOUT_SEAL.sha256,
  note: '输入为手写解释层输出；测的是"给定解释结果，机制是否满足留出集判据"',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
