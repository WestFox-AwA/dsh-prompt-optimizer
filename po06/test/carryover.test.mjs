// P5-3 保持性测试：预算省略声明、序列化往返、压缩、fork 继承。
// 纯函数、无 IO、无 LLM。运行：node po06/test/carryover.test.mjs
import { createState, SCOPES } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'
import { compile, compileAudited } from '../lib/compiler.js'
import { createProjectionDefinition, STATE_EVENT } from '../lib/projection.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-cy'
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })
const model = () => ({ kind: 'model', sessionId: SID })

/** 造一个含 turn/task 两类条目的状态，并返回其事件序列（模拟会话日志） */
function build() {
  const events = []
  const append = (st) => { events.push({ type: STATE_EVENT, seq: events.length, data: st }); return st }
  let s = createState({ sessionId: SID, taskId: 'tank' })
  let r = reduce(s, {
    causeId: 'c1', baseRevision: 0, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'req-html', kind: 'user_requirement', text: '单 HTML 程序', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'req-nopeek', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'qi-real', kind: 'quality_interpretation', text: '比例协调', sourceRefs: [model()] } },
    ],
  })
  if (!r.ok) throw new Error('build1: ' + r.reason)
  s = append(r.state)
  // 与真实流水线一致：**先推进轮次**（消息 m2 到达），再解释出本轮条目
  r = reduce(s, { causeId: 'c2a', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 'turn:m2' }] })
  if (!r.ok) throw new Error('build2a: ' + r.reason)
  s = append(r.state)
  r = reduce(s, {
    causeId: 'c2', baseRevision: s.revision, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'turn-color', kind: 'user_requirement', text: '只改颜色，其他别动', scope: 'turn', sourceRefs: [human('m2')] } }],
  })
  if (!r.ok) throw new Error('build2: ' + r.reason)
  s = append(r.state)
  // 消息 m3 到达 → 推进轮次，上一轮的 turn 条目退役
  r = reduce(s, { causeId: 'c3', baseRevision: s.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 'turn:m3' }] })
  if (!r.ok) throw new Error('build3: ' + r.reason)
  s = append(r.state)
  return { state: s, events }
}

// ── 1. 省略声明 ─────────────────────────────────────────────────────
t('丢弃发生时，意图包**写明**省略了什么（不静默）', () => {
  const big = []
  for (let i = 0; i < 20; i += 1) {
    big.push({ op: 'add_item', item: { id: 'prop-' + i, kind: 'proposal', text: '建议 ' + i + ' 内容内容内容内容内容内容', sourceRefs: [model()] } })
  }
  let s = createState({ sessionId: SID, taskId: 't' })
  const r = reduce(s, { causeId: 'c', baseRevision: 0, sessionId: SID, ops: [
    { op: 'add_item', item: { id: 'req-html', kind: 'user_requirement', text: '单 HTML', sourceRefs: [human('m1')] } },
    ...big,
  ] })
  s = r.state
  const out = compile(s, { budget: 500 })
  ok(out.dropped.length > 0, 'something must be dropped')
  ok(out.text.includes('【本次省略】'), 'packet must state what was omitted')
  ok(out.text.includes('请向我确认'), 'must invite confirmation rather than pretend completeness')
})

t('装不下时显式降级，不静默超预算', () => {
  let s = createState({ sessionId: SID, taskId: 't' })
  const r = reduce(s, { causeId: 'c', baseRevision: 0, sessionId: SID, ops: [
    { op: 'add_item', item: { id: 'req-html', kind: 'user_requirement', text: '单 HTML 程序并且这句话本身就很长很长很长很长很长很长很长', sourceRefs: [human('m1')] } },
    { op: 'add_item', item: { id: 'req-nopeek', kind: 'user_requirement', text: '不要预览文件夹内的其他文件这是必保节所以永远不能被丢弃', sourceRefs: [human('m1')] } },
  ] })
  s = r.state
  const out = compile(s, { budget: 80 })   // 必保节本身就已超预算
  ok(out.overBudget === true, 'must be flagged over budget: ' + out.chars)
  ok(out.text.includes('【预算不足】'), 'must state it explicitly in the packet')
  ok(out.text.includes('单 HTML'), 'required section still present (never dropped)')
})

// ── 2. 序列化往返（重启/持久化路径）────────────────────────────────
t('含 scope/turnId 的状态能通过 stateSchema 往返（重启路径）', () => {
  const { state } = build()
  const def = createProjectionDefinition()
  const json = JSON.stringify(state)
  const back = JSON.parse(json)
  const parsed = def.stateSchema.parse(back)
  eq(parsed.turnId, state.turnId, 'turnId survives')
  eq(parsed.items.length, state.items.length, 'items survive')
  const turnItem = parsed.items.find((x) => x.id === 'turn-color')
  eq(turnItem.scope, 'turn', 'scope survives')
  eq(turnItem.turnId, 'turn:m2', 'item turnId survives')
  eq(turnItem.status, 'superseded', 'retired status survives')
})

// ── 3. 压缩：全值事件 ⇒ 丢旧事件不丢状态 ────────────────────────────
t('压缩安全：仅凭**最后一条**状态事件即可重建全部状态（whole-value）', () => {
  const { state, events } = build()
  const def = createProjectionDefinition()
  // 模拟压缩：只保留最后一条事件
  const onlyLast = [events[events.length - 1]]
  let folded = def.init()
  for (const e of onlyLast) folded = def.apply(folded, e)
  eq(folded, state, 'last event alone reconstructs the live state')
  eq(folded.items.length, state.items.length, 'including retired items')
  eq(folded.turnId, state.turnId, 'including turnId')
})

t('压缩安全（对照）：若事件是增量式，丢旧事件会丢状态——本项目用全值事件规避了这点', () => {
  const { state, events } = build()
  const def = createProjectionDefinition()
  // 全部事件折叠 == 最后一条（说明中间事件对最终状态没有额外贡献）
  let all = def.init()
  for (const e of events) all = def.apply(all, e)
  eq(all, state, 'full fold equals last-event fold')
})

// ── 4. fork 继承 ────────────────────────────────────────────────────
t('fork 继承：从 init 折叠被继承的事件前缀，得到与父会话一致的快照', () => {
  const { state, events } = build()
  const def = createProjectionDefinition()
  const inherited = events.slice(0, 3)      // fork 时被继承的前缀（含 m2 那一轮）
  let child = def.init()
  for (const e of inherited) child = def.apply(child, e)
  eq(child.revision, events[2].data.revision, 'child inherits the prefix state')
  // 关键：继承后 turn 级条目**仍在本轮内**（尚未推进），所以还是 active
  eq(child.items.find((x) => x.id === 'turn-color').status, 'active', 'turn item still active in the fork prefix')
  eq(child.turnId, 'turn:m2', 'child turnId is the inherited one')
})

t('fork 后子会话再推进轮次，只影响子会话的那份状态', () => {
  const { events } = build()
  const def = createProjectionDefinition()
  let child = def.init()
  for (const e of events.slice(0, 3)) child = def.apply(child, e)
  const r = reduce(child, { causeId: 'fork-adv', baseRevision: child.revision, sessionId: SID, ops: [{ op: 'advance_turn', turnId: 'turn:child' }] })
  ok(r.ok, 'child advance: ' + (r.reason || ''))
  eq(r.state.items.find((x) => x.id === 'turn-color').status, 'superseded', 'child retires its turn item')
  // 父状态未被触碰（纯函数）
  eq(child.items.find((x) => x.id === 'turn-color').status, 'active', 'parent snapshot untouched')
})

// ── 5. 非本插件事件被短路（ADR-0011）───────────────────────────────
t('折叠时非本插件事件返回同一引用（不产生额外开销/污染）', () => {
  const def = createProjectionDefinition()
  const { state } = build()
  const r = def.apply(state, { type: 'user/message', seq: 99, data: {} })
  ok(r === state, 'must return the same reference')
})

// ── 6. 审计仍通过 ───────────────────────────────────────────────────
t('含 turn/task 混合的状态审计通过', () => {
  const { state } = build()
  const out = compileAudited(state, { budget: 2000 })
  eq(out.problems, [], 'no problems')
  ok(out.text.includes('不要预览文件夹内的其他文件'), 'task constraint present')
  ok(!out.text.includes('只改颜色'), 'retired turn item absent after advance')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-carryover', phase: 'P5', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
