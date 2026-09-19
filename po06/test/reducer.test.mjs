// P2 reducer 单元测试：纯函数、无 IO、无宿主依赖。运行：node po06/test/reducer.test.mjs
import { createState, validateNewItem, validatePatch, ITEM_KINDS } from '../lib/schema.js'
import { reduce, recordUserInput, activeItems, itemsOfKind, checkInvariants, REJECT } from '../lib/reducer.js'

let pass = 0
const failures = []
function t(name, fn) {
  try {
    fn()
    pass += 1
  } catch (e) {
    failures.push({ name, error: String((e && e.message) || e) })
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${what || 'value'}: expected ${b}, got ${a}`)
}
function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected truthy')
}

const SID = 'session-test'
const humanSrc = (mid) => ({ kind: 'human', sessionId: SID, messageId: mid })
const modelSrc = () => ({ kind: 'model', sessionId: SID })
const toolSrc = (cid) => ({ kind: 'tool', sessionId: SID, toolCallId: cid })

const base = () => createState({ sessionId: SID, taskId: 'task-1' })
let seq = 0
const patch = (state, ops, extra = {}) => ({
  causeId: 'cause-' + (++seq),
  baseRevision: state.revision,
  ops,
  ...extra,
})

// ── 1. 建状态 ────────────────────────────────────────────────────────
t('createState 初值正确', () => {
  const s = base()
  eq(s.revision, 0, 'revision')
  eq(s.lastInputRevision, 0, 'lastInputRevision')
  eq(s.items, [], 'items')
  eq(s.phase, 'idle', 'phase')
})

// ── 2. 人类来源可建 user_requirement ────────────────────────────────
t('add_item: 人类来源可建 user_requirement', () => {
  const s = base()
  const r = reduce(s, patch(s, [{
    op: 'add_item',
    item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML', sourceRefs: [humanSrc('m1')] },
  }]))
  ok(r.ok, 'should be ok: ' + (r.reason || ''))
  eq(r.state.items.length, 1, 'items')
  eq(r.state.items[0].status, 'active', 'default status')
  eq(r.state.revision, 1, 'revision bumped')
})

// ── 3. 身份闸门：非人类来源不得建 user_requirement ──────────────────
t('身份闸门: 模型来源建 user_requirement 被拒（reducer 层 UNAUTHORIZED_KIND）', () => {
  const s = base()
  const r = reduce(s, patch(s, [{
    op: 'add_item',
    item: { id: 'req-x', kind: 'user_requirement', text: '必须离线', sourceRefs: [modelSrc()] },
  }]))
  ok(!r.ok, 'should reject')
  eq(r.code, REJECT.UNAUTHORIZED_KIND, 'identity is enforced by the reducer, not the shape validator')
  eq(s.items.length, 0, 'state unchanged')
})

t('身份闸门: user_decision 同样需要人类来源', () => {
  const s = base()
  const r = reduce(s, patch(s, [{
    op: 'add_item',
    item: { id: 'd-1', kind: 'user_decision', text: '保持全部信息', sourceRefs: [toolSrc('call-1')] },
  }]))
  ok(!r.ok, 'must reject')
  eq(r.code, REJECT.UNAUTHORIZED_KIND, 'code')
})

t('形状校验器不越权: validateNewItem 只查形状', () => {
  // 形状合法（有来源引用、格式正确），但来源是 model —— 形状层**应当放行**，
  // 权威判断留给 reducer。这条用来防止"身份判断偷偷跑回校验器"。
  const errs = validateNewItem({
    id: 'req-z', kind: 'user_requirement', text: 'x', sourceRefs: [modelSrc()],
  })
  eq(errs, [], 'shape validator must not enforce identity')
})

// ── 4. quality_interpretation 不得升格为 user_requirement ───────────
t('质量解释不得升格: kind 是不可变字段（白名单在形状层）', () => {
  let s = base()
  let r = reduce(s, patch(s, [{
    op: 'add_item',
    item: {
      id: 'qi-1', kind: 'quality_interpretation', text: '比例协调、结构可信',
      sourceRefs: [modelSrc()], rationale: '由“真实、帅气”展开',
    },
  }]))
  ok(r.ok, 'add quality_interpretation: ' + (r.reason || ''))
  s = r.state
  const r2 = reduce(s, patch(s, [{ op: 'update_item', id: 'qi-1', fields: { kind: 'user_requirement' } }]))
  ok(!r2.ok, '升格必须被拒')
  eq(r2.code, REJECT.BAD_SCHEMA, 'kind 不在可变白名单内')
  eq(s.items[0].kind, 'quality_interpretation', '原条目未被改动')
})

t('可变的只有白名单里的字段', () => {
  let s = base()
  let r = reduce(s, patch(s, [{
    op: 'add_item', item: { id: 'qi-3', kind: 'quality_interpretation', text: '旧', sourceRefs: [modelSrc()] },
  }]))
  s = r.state
  r = reduce(s, patch(s, [{ op: 'update_item', id: 'qi-3', fields: { text: '新', rationale: '更新理由' } }]))
  ok(r.ok, 'mutable fields should apply: ' + (r.reason || ''))
  eq(r.state.items[0].text, '新', 'text updated')
  eq(r.state.items[0].rationale, '更新理由', 'rationale updated')
  // sourceRefs 不可改
  const r3 = reduce(r.state, patch(r.state, [{ op: 'update_item', id: 'qi-3', fields: { sourceRefs: [humanSrc('m9')] } }]))
  ok(!r3.ok, 'sourceRefs must be immutable')
})

// ── 5. CAS：旧 revision 必须被拒绝（第一条验收）────────────────────
t('CAS: 旧 baseRevision 的候选 patch 被拒（STALE_REVISION）', () => {
  let s = base()
  let r = reduce(s, patch(s, [{
    op: 'add_item',
    item: { id: 'req-1', kind: 'user_requirement', text: 'A', sourceRefs: [humanSrc('m1')] },
  }]))
  ok(r.ok, 'first patch')
  s = r.state   // revision = 1

  // 一个基于 revision 0 的旧候选（模拟"优化结果晚到"）
  const stale = {
    causeId: 'cause-stale',
    baseRevision: 0,
    ops: [{ op: 'add_item', item: { id: 'req-2', kind: 'user_requirement', text: 'B', sourceRefs: [humanSrc('m2')] } }],
  }
  const r2 = reduce(s, stale)
  ok(!r2.ok, 'stale patch must be rejected')
  eq(r2.code, REJECT.STALE_REVISION, 'code')
  eq(s.items.length, 1, 'state must be unchanged')
})

// ── 6. 用户改口：输入闸门让在途 patch 作废 ──────────────────────────
t('用户改口: 用户输入后，旧 baseInputRevision 的 patch 被拒', () => {
  let s = base()
  // 在 revision 0 时构造一个在途候选
  const inFlight = {
    causeId: 'cause-inflight',
    baseRevision: 0,
    baseInputRevision: 0,
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '旧目标', sourceRefs: [humanSrc('m1')] } }],
  }
  // 用户中途说话
  s = recordUserInput(s, { messageId: 'm-user-2' })
  eq(s.lastInputRevision, s.revision, 'lastInputRevision 跟随')
  const r = reduce(s, inFlight)
  ok(!r.ok, 'in-flight patch must be rejected')
  eq(r.code, REJECT.STALE_REVISION, 'revision 也变了，先撞 CAS')
})

t('用户改口: revision 对齐但输入修订落后 → STALE_AFTER_INPUT', () => {
  let s = base()
  s = recordUserInput(s, { messageId: 'm-user-1' })   // revision=1, lastInputRevision=1
  const r = reduce(s, {
    causeId: 'cause-old-input',
    baseRevision: 1,
    baseInputRevision: 0,   // 基于更早的输入
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '旧', sourceRefs: [humanSrc('m1')] } }],
  })
  ok(!r.ok, 'must reject')
  eq(r.code, REJECT.STALE_AFTER_INPUT, 'code')
})

// ── 7. 取代关系 ─────────────────────────────────────────────────────
t('取代: supersedes 让旧条目退出有效集合', () => {
  let s = base()
  let r = reduce(s, patch(s, [{
    op: 'add_item',
    item: { id: 'req-old', kind: 'user_requirement', text: '改颜色', sourceRefs: [humanSrc('m1')] },
  }]))
  s = r.state
  r = reduce(s, patch(s, [{
    op: 'add_item',
    item: {
      id: 'req-new', kind: 'user_requirement', text: '不改颜色了', sourceRefs: [humanSrc('m2')],
      supersedes: ['req-old'],
    },
  }]))
  ok(r.ok, 'supersede add')
  s = r.state
  eq(s.items.find((x) => x.id === 'req-old').status, 'superseded', 'old status')
  eq(activeItems(s).map((x) => x.id), ['req-new'], 'active set')
})

// ── 8. 重复 / 未知条目 ──────────────────────────────────────────────
t('重复 id 被拒', () => {
  let s = base()
  let r = reduce(s, patch(s, [{
    op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: 'A', sourceRefs: [humanSrc('m1')] },
  }]))
  s = r.state
  r = reduce(s, patch(s, [{
    op: 'add_item', item: { id: 'req-1', kind: 'unknown', text: 'B', sourceRefs: [modelSrc()] },
  }]))
  ok(!r.ok, 'duplicate must reject')
  eq(r.code, REJECT.DUPLICATE_ITEM, 'code')
})

t('未知条目被拒', () => {
  const s = base()
  const r = reduce(s, patch(s, [{ op: 'set_item_status', id: 'nope', status: 'retracted' }]))
  ok(!r.ok, 'unknown item must reject')
  eq(r.code, REJECT.UNKNOWN_ITEM, 'code')
})

// ── 9. 纯函数性 ─────────────────────────────────────────────────────
t('纯函数: 不修改入参状态', () => {
  const s = base()
  const snapshot = JSON.stringify(s)
  reduce(s, patch(s, [{
    op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: 'A', sourceRefs: [humanSrc('m1')] },
  }]))
  eq(JSON.stringify(s), snapshot, 'input state must be untouched')
})

t('确定性: 同一输入两次结果相同', () => {
  const s = base()
  const p = { causeId: 'c-det', baseRevision: 0, ops: [{ op: 'set_phase', phase: 'ready' }] }
  const a = reduce(s, p)
  const b = reduce(s, p)
  eq(JSON.stringify(a.state), JSON.stringify(b.state), 'deterministic')
})

// ── 10. 不变量 ──────────────────────────────────────────────────────
t('不变量: 合法状态无违规', () => {
  let s = base()
  let r = reduce(s, patch(s, [
    { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML', sourceRefs: [humanSrc('m1')] } },
    { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '比例协调', sourceRefs: [modelSrc()] } },
    { op: 'add_item', item: { id: 'f-1', kind: 'observed_fact', text: '文件有 12 个', sourceRefs: [toolSrc('call-1')] } },
  ]))
  ok(r.ok, 'batch add')
  s = r.state
  eq(checkInvariants(s), [], 'invariants')
  eq(itemsOfKind(s, 'user_requirement').length, 1, 'by kind')
  eq(activeItems(s).length, 3, 'active count')
})

t('schema: 工具来源必须带 toolCallId', () => {
  const errs = validateNewItem({
    id: 'f-1', kind: 'observed_fact', text: 'x', sourceRefs: [{ kind: 'tool', sessionId: SID }],
  })
  ok(errs.some((e) => e.includes('toolCallId')), 'must require toolCallId: ' + JSON.stringify(errs))
})

t('schema: 空 ops 被拒', () => {
  const v = validatePatch({ causeId: 'c', baseRevision: 0, ops: [] })
  ok(!v.ok, 'empty ops must fail')
})

// ── 结果 ────────────────────────────────────────────────────────────
const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-reducer',
  phase: 'P2',
  total,
  pass,
  fail: failures.length,
  failures,
  itemKinds: ITEM_KINDS.length,
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
