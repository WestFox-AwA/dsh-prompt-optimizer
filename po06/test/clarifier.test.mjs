// P4 澄清规划单元测试：纯函数、无 IO、无 LLM、**不触达用户界面**。
// 运行：node po06/test/clarifier.test.mjs
import { createState } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'
import {
  planClarification, planningToOps, classifyUnknown, alreadyHandled,
  isDelegatedFor, resolutionOp, onTimeout, UNKNOWN_CLASSES, TERMINAL_QUESTION_STATES,
} from '../lib/clarifier.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-cl'
const model = () => ({ kind: 'model', sessionId: SID })
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })

function stateWith(unknowns) {
  const s0 = createState({ sessionId: SID, taskId: 't' })
  const ops = unknowns.map((u, i) => ({
    op: 'add_item',
    item: { id: u.id || 'unk-' + i, kind: 'unknown', text: u.text || ('未知项 ' + i), sourceRefs: [model()], ...u },
  }))
  if (ops.length === 0) return s0
  const r = reduce(s0, { causeId: 'c', baseRevision: 0, sessionId: SID, ops })
  if (!r.ok) throw new Error('fixture failed: ' + r.reason)
  return r.state
}

// ── 分类 ────────────────────────────────────────────────────────────
t('缺省分类为用户偏好（保守：宁可不替用户拍板）', () => {
  eq(classifyUnknown({ kind: 'unknown' }), 'user_preference', 'default')
  eq(classifyUnknown({ kind: 'unknown', unknownClass: 'lookupable_fact' }), 'lookupable_fact', 'explicit')
  eq(classifyUnknown({ kind: 'unknown', unknownClass: '胡写' }), 'user_preference', 'invalid falls back')
  eq(UNKNOWN_CLASSES.length, 3, 'three classes')
})

t('unknownClass / blocksAction 只对 unknown 合法（schema 层拒绝误用）', () => {
  const s0 = createState({ sessionId: SID, taskId: 't' })
  const r1 = reduce(s0, { causeId: 'c', baseRevision: 0, sessionId: SID, ops: [
    { op: 'add_item', item: { id: 'r1', kind: 'user_requirement', text: 'x', sourceRefs: [human('m')], unknownClass: 'user_preference' } },
  ] })
  ok(!r1.ok, 'unknownClass on non-unknown must be rejected')
  const r2 = reduce(s0, { causeId: 'c2', baseRevision: 0, sessionId: SID, ops: [
    { op: 'add_item', item: { id: 'unkA', kind: 'unknown', text: 'x', sourceRefs: [model()], unknownClass: '胡写' } },
  ] })
  ok(!r2.ok, 'invalid unknownClass must be rejected')
})

t('reducer 保留 unknown 的分类与阻塞标记', () => {
  const s = stateWith([{ id: 'unkA', text: 'CDN 能否用', unknownClass: 'user_preference', blocksAction: true }])
  eq(s.items[0].unknownClass, 'user_preference', 'unknownClass kept')
  eq(s.items[0].blocksAction, true, 'blocksAction kept')
})

// ── 规划：该问什么 ──────────────────────────────────────────────────
t('用户偏好未知 → 成为提问候选', () => {
  const s = stateWith([{ id: 'unkA', text: 'CDN 能否用', unknownClass: 'user_preference' }])
  const p = planClarification(s)
  eq(p.mode, 'ask', 'mode')
  eq(p.questions.length, 1, 'one question')
  eq(p.questions[0].decisionId, 'unkA', 'decisionId')
  eq(p.questions[0].text, 'CDN 能否用', 'text')
})

t('可查事实不进提问，进 lookup 路由', () => {
  const s = stateWith([{ id: 'unkA', text: '项目用什么测试框架', unknownClass: 'lookupable_fact' }])
  const p = planClarification(s)
  eq(p.mode, 'none', 'must not ask')
  eq(p.routed.lookup, ['unkA'], 'routed to lookup')
  eq(p.routed.decide, [], 'not to decide')
})

t('可逆实现细节不进提问，进 decide 路由', () => {
  const s = stateWith([{ id: 'unkA', text: '用 12 还是 16 的间距', unknownClass: 'implementation_detail' }])
  const p = planClarification(s)
  eq(p.mode, 'none', 'must not ask')
  eq(p.routed.decide, ['unkA'], 'routed to decide')
})

t('显式声明不阻塞下一步 → 不打扰', () => {
  const s = stateWith([{ id: 'unkA', text: '次要偏好', unknownClass: 'user_preference', blocksAction: false }])
  const p = planClarification(s)
  eq(p.mode, 'none', 'must not ask')
  eq(p.questions.length, 0, 'no questions')
})

t('混合场景：只问用户偏好，其余分流', () => {
  const s = stateWith([
    { id: 'unkA', text: '偏好 A', unknownClass: 'user_preference' },
    { id: 'unkB', text: '可查事实', unknownClass: 'lookupable_fact' },
    { id: 'unkC', text: '实现细节', unknownClass: 'implementation_detail' },
    { id: 'unkD', text: '偏好 B', unknownClass: 'user_preference' },
  ])
  const p = planClarification(s)
  eq(p.mode, 'ask', 'ask')
  eq(p.questions.map((q) => q.decisionId), ['unkA', 'unkD'], 'only preferences, in order')
  eq(p.routed.lookup, ['unkB'], 'lookup')
  eq(p.routed.decide, ['unkC'], 'decide')
})

// ── 预算 ────────────────────────────────────────────────────────────
t('默认最多 2 个问题，其余进 deferred', () => {
  const s = stateWith([
    { id: 'unkA', text: 'P1' }, { id: 'unkB', text: 'P2' }, { id: 'unkC', text: 'P3' },
  ])
  const p = planClarification(s)
  eq(p.questions.length, 2, 'capped at 2')
  eq(p.deferred, ['unkC'], 'deferred')
})

t('maxQuestions 可收紧到 1（优先只问一个）', () => {
  const s = stateWith([{ id: 'unkA', text: 'P1' }, { id: 'unkB', text: 'P2' }])
  const p = planClarification(s, { maxQuestions: 1 })
  eq(p.questions.length, 1, 'one')
  eq(p.deferred, ['unkB'], 'deferred')
})

t('maxQuestions=0 → 一个问题都不问', () => {
  const s = stateWith([{ id: 'unkA', text: 'P1' }])
  const p = planClarification(s, { maxQuestions: 0 })
  eq(p.mode, 'none', 'none')
  eq(p.questions.length, 0, 'no questions')
  eq(p.deferred, ['unkA'], 'all deferred')
})

// ── 不重复问 ────────────────────────────────────────────────────────
t('已答过的不再问（同 decisionId）', () => {
  let s = stateWith([{ id: 'unkA', text: 'CDN 能否用' }])
  const ops = planningToOps(planClarification(s))
  let r = reduce(s, { causeId: 'q', baseRevision: s.revision, sessionId: SID, ops })
  ok(r.ok, 'add question: ' + (r.reason || ''))
  s = r.state
  r = reduce(s, { causeId: 'a', baseRevision: s.revision, sessionId: SID, ops: [resolutionOp('q-unkA', 'answered', { answerSource: 'human:msg-9' })] })
  ok(r.ok, 'answer: ' + (r.reason || ''))
  s = r.state
  ok(alreadyHandled(s, 'unkA'), 'handled')
  eq(planClarification(s).mode, 'none', 'must not ask again')
})

t('拒答 / 跳过 / 授权 都不导致重复提问', () => {
  for (const kind of ['declined', 'skipped', 'delegated']) {
    let s = stateWith([{ id: 'unkA', text: 'P' }])
    let r = reduce(s, { causeId: 'q', baseRevision: s.revision, sessionId: SID, ops: planningToOps(planClarification(s)) })
    s = r.state
    r = reduce(s, { causeId: 'x', baseRevision: s.revision, sessionId: SID, ops: [resolutionOp('q-unkA', kind)] })
    ok(r.ok, kind + ' should be accepted: ' + (r.reason || ''))
    s = r.state
    eq(planClarification(s).mode, 'none', kind + ' must suppress re-asking')
  }
  eq(TERMINAL_QUESTION_STATES.includes('answered'), true, 'answered terminal')
  eq(TERMINAL_QUESTION_STATES.includes('proposed'), false, 'proposed is not terminal')
})

t('授权自主：全范围免问；限定范围只在该范围内免问', () => {
  let s = stateWith([{ id: 'unkA', text: 'P1' }, { id: 'unkB', text: 'P2' }])
  // 只对 u1 授权，且限定范围 'color'
  let r = reduce(s, { causeId: 'q', baseRevision: s.revision, sessionId: SID, ops: planningToOps(planClarification(s)) })
  s = r.state
  r = reduce(s, { causeId: 'd', baseRevision: s.revision, sessionId: SID, ops: [resolutionOp('q-unkA', 'delegated', { delegatedScope: 'color' })] })
  s = r.state
  ok(isDelegatedFor(s, 'unkA', 'color'), 'in scope')
  ok(!isDelegatedFor(s, 'unkA', 'layout'), 'out of scope')
  ok(isDelegatedFor(s, 'unkA'), 'no scope asked = in scope')
  // u2 仍未处理
  ok(!alreadyHandled(s, 'unkB'), 'u2 still open')
})

// ── 解析语义 ────────────────────────────────────────────────────────
t('answered 必须带 answerSource（人类来源）', () => {
  let threw = false
  try { resolutionOp('q1', 'answered') } catch { threw = true }
  ok(threw, 'must require answerSource')
  const op = resolutionOp('q1', 'answered', { answerSource: 'human:m1' })
  eq(op.answerSource, 'human:m1', 'source kept')
})

t('未知的 resolution 类型被拒（防止把超时写成别的东西）', () => {
  let threw = false
  try { resolutionOp('q1', 'timeout') } catch { threw = true }
  ok(threw, 'unknown kind must throw')
})

t('超时不做任何状态转移（不是同意，也不是授权）', () => {
  const r = onTimeout()
  eq(r.op, null, 'no op')
  eq(r.reason, 'timeout-is-not-consent', 'explicit reason')
})

// ── 与 reducer 串联 ─────────────────────────────────────────────────
t('planningToOps 产出的 ops 能被 reducer 接受', () => {
  const s = stateWith([{ id: 'unkA', text: 'CDN 能否用', unknownClass: 'user_preference' }])
  const p = planClarification(s)
  const ops = planningToOps(p)
  eq(ops.length, 1, 'one op')
  eq(ops[0].op, 'add_question', 'add_question')
  const r = reduce(s, { causeId: 'c', baseRevision: s.revision, sessionId: SID, ops })
  ok(r.ok, 'reducer must accept: ' + (r.reason || ''))
  eq(r.state.questions.length, 1, 'question recorded')
  eq(r.state.questions[0].status, 'proposed', 'status proposed')
})

t('非 ask 模式不产出任何 op', () => {
  const s = stateWith([{ id: 'unkA', text: 'x', unknownClass: 'lookupable_fact' }])
  eq(planningToOps(planClarification(s)), [], 'no ops')
  eq(planningToOps(null), [], 'null safe')
})

t('确定性：同输入两次规划一致', () => {
  const s = stateWith([{ id: 'unkA', text: 'A' }, { id: 'unkB', text: 'B' }, { id: 'unkC', text: 'C' }])
  eq(planClarification(s), planClarification(s), 'deterministic')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-clarifier', phase: 'P4', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
