// P5 长任务单元测试：作用域（task/turn）、轮次推进、局部修改。
// 纯函数、无 IO、无 LLM。运行：node po06/test/longtask.test.mjs
import { createState, SCOPES, validateNewItem } from '../lib/schema.js'
import { reduce, activeItems } from '../lib/reducer.js'
import { compile, compileAudited } from '../lib/compiler.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-lt'
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })
const model = () => ({ kind: 'model', sessionId: SID })

/** 第 1 轮：用户给出长期目标 */
function round1() {
  const s0 = createState({ sessionId: SID, taskId: 'tank' })
  const r = reduce(s0, {
    causeId: 'r1', baseRevision: 0, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'req-html', kind: 'user_requirement', text: '单 HTML 程序', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'req-nopeek', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'qi-real', kind: 'quality_interpretation', text: '比例协调、结构可信', sourceRefs: [model()] } },
    ],
  })
  if (!r.ok) throw new Error('round1 failed: ' + r.reason)
  return r.state
}

/** 第 2 轮：用户下达**本轮**指令「只改颜色」 */
function round2(state) {
  const r = reduce(state, {
    causeId: 'r2', baseRevision: state.revision, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'turn-color', kind: 'user_requirement', text: '只改颜色，其他别动', scope: 'turn', sourceRefs: [human('m2')] } },
    ],
  })
  if (!r.ok) throw new Error('round2 failed: ' + r.reason)
  return r.state
}

// ── 1. 作用域基础 ───────────────────────────────────────────────────
t('SCOPES 定义正确', () => {
  eq(SCOPES, ['task', 'turn'], 'scopes')
})

t('缺省作用域为 task', () => {
  const s = round1()
  for (const it of s.items) eq(it.scope, 'task', it.id + ' scope')
})

t('turn 作用域只对用户指令合法（机器解释不可只在某一轮有效）', () => {
  const bad = validateNewItem({
    id: 'qi-x', kind: 'quality_interpretation', text: 'x', scope: 'turn', sourceRefs: [model()],
  })
  ok(bad.some((e) => e.includes('scope turn is only valid')), 'must reject: ' + JSON.stringify(bad))
  const badReq = validateNewItem({ id: 'r-x', kind: 'user_requirement', text: 'x', scope: 'eek', sourceRefs: [human('m')] })
  ok(badReq.some((e) => e.includes('item.scope invalid')), 'must reject bad scope value')
})

t('turn 条目记录所属轮次', () => {
  const s = round2(round1())
  const it = s.items.find((x) => x.id === 'turn-color')
  eq(it.scope, 'turn', 'scope')
  eq(it.turnId, s.turnId, 'turnId equals current turn')
})

// ── 2. 编译分节 ─────────────────────────────────────────────────────
t('本轮要求与明确要求分节渲染', () => {
  const s = round2(round1())
  const out = compile(s)
  ok(out.text.includes('本轮要求（仅本轮有效，下一轮不再适用）'), 'has turn section')
  ok(out.text.includes('只改颜色，其他别动'), 'turn item rendered')
  const turnIds = out.sections.find((x) => x.key === 'turnScope').itemIds
  eq(turnIds, ['turn-color'], 'turnScope ids')
  const reqIds = out.sections.find((x) => x.key === 'requirements').itemIds.sort()
  eq(reqIds, ['req-html', 'req-nopeek'], 'requirements exclude the turn item')
  // 长期目标**没有**被本轮指令挤掉
  ok(out.text.includes('单 HTML 程序'), 'standing goal survives')
  ok(out.text.includes('不要预览文件夹内的其他文件'), 'standing constraint survives')
})

t('审计通过：本轮条目带 human 来源', () => {
  const s = round2(round1())
  const out = compileAudited(s)
  eq(out.problems, [], 'no problems')
})

// ── 3. 轮次推进 ─────────────────────────────────────────────────────
t('推进轮次后，上一轮的本轮指令退役', () => {
  let s = round2(round1())
  const r = reduce(s, { causeId: 'adv', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 't2' }] })
  ok(r.ok, 'advance: ' + (r.reason || ''))
  s = r.state
  eq(s.turnId, 't2', 'turn advanced')
  const it = s.items.find((x) => x.id === 'turn-color')
  eq(it.status, 'stale', 'previous turn item retired (kept for traceability)')
  // ⚠ 2026-09-21 用户拍板"不遗传目标"：**长期目标也不再自动跨轮**——
  // 推进轮次时上一轮整体退场，本轮由解释层从「本轮原话 + 上下文」独立重新产生。
  eq(activeItems(s).length, 0, '不继承：推进后没有条目仍 active')
})

t('退役后的本轮指令不再出现在意图包里', () => {
  let s = round2(round1())
  let r = reduce(s, { causeId: 'adv', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 't2' }] })
  s = r.state
  const out = compile(s)
  ok(!out.text.includes('只改颜色'), 'turn instruction must not persist into the next round')
  ok(!out.sections.some((x) => x.key === 'turnScope'), 'no turn section when empty')
  // ⚠ 同上（不遗传）：standing goal 不再自动继承。它是否出现在本轮包里，
  // 取决于解释层能否从**本轮的上下文**里重新得出它——这是用户明确选择的取舍。
  ok(!out.text.includes('单 HTML 程序'), 'standing goal 不再自动继承（不遗传目标）')
})

t('新一轮的本轮指令与上一轮互不影响', () => {
  let s = round2(round1())
  let r = reduce(s, { causeId: 'adv', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 't2' }] })
  s = r.state
  r = reduce(s, {
    causeId: 'r3', baseRevision: s.revision, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'turn-shape', kind: 'user_requirement', text: '这轮只调配比例', scope: 'turn', sourceRefs: [human('m3')] } }],
  })
  ok(r.ok, 'round3: ' + (r.reason || ''))
  s = r.state
  const out = compile(s)
  ok(out.text.includes('这轮只调配比例'), 'new turn item present')
  ok(!out.text.includes('只改颜色'), 'old turn item absent')
  const turnIds = out.sections.find((x) => x.key === 'turnScope').itemIds
  eq(turnIds, ['turn-shape'], 'only the new turn item')
})

t('advance_turn 必须带 turnId', () => {
  const s = round1()
  const v = reduce(s, { causeId: 'x', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn' }] })
  ok(!v.ok, 'must reject missing turnId')
  eq(v.code, 'BAD_SCHEMA', 'code')
})

// ── 4. 场景复核：你说的那两个例子 ───────────────────────────────────
t('场景「只改颜色，其他别动」：不触发重建，长期约束仍在', () => {
  const s = round2(round1())
  const out = compile(s)
  // 工作 AI 同时看到：本轮只改颜色 + 长期仍是单 HTML + 不得预览其他文件
  ok(out.text.includes('只改颜色，其他别动'), 'turn scope stated')
  ok(out.text.includes('单 HTML 程序'), 'delivery constraint retained')
  ok(out.text.includes('不要预览文件夹内的其他文件'), 'no-peek constraint retained')
  // 且本轮指令被明确标为"仅本轮有效"，不会被读成永久禁令
  ok(out.text.includes('仅本轮有效'), 'turn scope labelled')
})

t('场景「换个风格」：新风格不丢原有的交付约束', () => {
  let s = round1()
  let r = reduce(s, {
    causeId: 'style', baseRevision: s.revision, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'turn-style', kind: 'user_requirement', text: '换成低多边形风格', scope: 'turn', sourceRefs: [human('m9')] } },
      { op: 'add_item', item: { id: 'qi-lowpoly', kind: 'quality_interpretation', text: '低多边形：面数克制、轮廓清晰', sourceRefs: [model()] } },
    ],
  })
  ok(r.ok, 'style change: ' + (r.reason || ''))
  s = r.state
  const out = compileAudited(s)
  ok(out.text.includes('换成低多边形风格'), 'new style turn item')
  ok(out.text.includes('低多边形：面数克制'), 'new quality interpretation')
  ok(out.text.includes('单 HTML 程序'), 'delivery constraint NOT lost')
  eq(out.problems, [], 'audited clean')
})

// ── 5. 撤销 ─────────────────────────────────────────────────────────
t('撤销上一决定：supersedes 让旧条目退出且新条目生效', () => {
  let s = round1()
  let r = reduce(s, {
    causeId: 'c', baseRevision: s.revision, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-a', kind: 'user_requirement', text: '标题用蓝色', sourceRefs: [human('m5')] } }],
  })
  s = r.state
  r = reduce(s, {
    causeId: 'undo', baseRevision: s.revision, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-b', kind: 'user_requirement', text: '标题不用蓝色了', supersedes: ['req-a'], sourceRefs: [human('m6')] } }],
  })
  ok(r.ok, 'undo: ' + (r.reason || ''))
  s = r.state
  const out = compile(s)
  ok(!out.text.includes('标题用蓝色'), 'revoked decision must not render')
  ok(out.text.includes('标题不用蓝色了'), 'replacement renders')
})

// ── 6. 不变量 ───────────────────────────────────────────────────────
t('确定性：同状态两次编译一致', () => {
  const s = round2(round1())
  eq(compile(s).text, compile(s).text, 'deterministic')
})

t('轮次推进不改变长期条目的 revision 语义（只加不删）', () => {
  let s = round2(round1())
  const before = s.items.length
  const r = reduce(s, { causeId: 'adv', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 't2' }] })
  s = r.state
  eq(s.items.length, before, 'items are retired, never removed')
  ok(s.items.every((x) => x.status !== 'active' || x.scope === 'task'), 'only task items remain active')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-longtask', phase: 'P5', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
