// P3 流水线端到端**离线**联调：解释器是伪造的，**不调用任何模型**。
// 运行：node po06/test/pipeline.test.mjs
//
// 目的：在花模型预算之前，先把"解释 → 提交 → 编译 → 动态上下文"这条链路的
//       行为与故障路径全部钉死。真实模型只在 P3 对照实验里接上。
import { handleUserInput } from '../lib/pipeline.js'
import { createState, SCHEMA_VERSION } from '../lib/schema.js'
import { reduce, recordUserInput } from '../lib/reducer.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async test must use ta()'); pass += 1 }
  catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
const asyncTests = []
function ta(name, fn) { asyncTests.push({ name, fn }) }
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-p'
const TANK = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'

/** 极简 session 桩：只提供 append（状态事件写进内存数组） */
function makeSession(id) {
  const events = []
  return {
    id,
    events,
    append(type, data) { events.push({ type, data }); return events.length },
  }
}

/** adapter 桩：复用真实 reducer/compiler，但状态存在内存里（不接宿主投影） */
function makeAdapter() {
  const states = new Map()
  const texts = new Map()   // 按会话隔离的意图包文本
  return {
    packetBudget: 1200,
    intentStateOf(session) {
      const s = states.get(session.id)
      return s === undefined ? null : s
    },
    _set(session, st) { states.set(session.id, st) },
    initIntent(session, { taskId }) {
      const empty = createState({ sessionId: String(session.id), taskId: taskId || 'default' })
      const r = reduce(empty, {
        causeId: 'init', baseRevision: 0, sessionId: String(session.id), taskId: taskId || 'default',
        ops: [{ op: 'set_phase', phase: 'idle' }],
      })
      if (!r.ok) return r
      session.append('prompt-optimizer/state-changed', r.state)
      states.set(session.id, r.state)
      return { ok: true, state: r.state }
    },
    commitUserInput(session, { messageId }) {
      const cur = states.get(session.id)
      if (!cur) return { ok: false, code: 'NO_BASE_STATE' }
      const next = recordUserInput(cur, { messageId })
      session.append('prompt-optimizer/state-changed', next)
      states.set(session.id, next)
      return { ok: true, state: next }
    },
    commit(session, patch) {
      const cur = states.get(session.id)
      if (!cur) return { ok: false, code: 'NO_BASE_STATE' }
      const r = reduce(cur, patch)
      if (!r.ok) return r
      session.append('prompt-optimizer/state-changed', r.state)
      states.set(session.id, r.state)
      return { ok: true, state: r.state }
    },
    setIntentText(sessionId, t) {
      const sid = String(sessionId == null ? '' : sessionId)
      const v = String(t == null ? '' : t)
      if (!sid) return
      if (v) texts.set(sid, v); else texts.delete(sid)
    },
    getIntentText(sessionId) { return texts.get(String(sessionId)) || '' },
  }
}

function humanSrc(mid) { return { kind: 'human', sessionId: SID, messageId: mid } }
function modelSrc() { return { kind: 'model', sessionId: SID } }

/** 伪造的解释器：模拟一个**守规矩**的模型输出 */
function goodInterpreter(raw = null) {
  return async () => raw !== null ? raw : JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [humanSrc('m-1')] } },
      { op: 'add_item', item: { id: 'req-2', kind: 'user_requirement', text: '可预览、可操控', quote: '可以预览,操控', sourceRefs: [humanSrc('m-1')] } },
      { op: 'add_item', item: { id: 'req-3', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', quote: '不要预览文件夹内的其他文件', sourceRefs: [humanSrc('m-1')] } },
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '整体比例协调、结构可信；炮塔与车体连接合理', rationale: '来自原话的“真实、帅气”', sourceRefs: [modelSrc()] } },
      { op: 'add_item', item: { id: 'qi-2', kind: 'quality_interpretation', text: '细节密度、材质与灯光共同服务写实展示', rationale: '来自原话的“极其精细”“炫技写真”', sourceRefs: [modelSrc()] } },
    ],
  })
}

// ── 同步用例 ────────────────────────────────────────────────────────
t('模块可加载且导出流水线入口', () => {
  ok(typeof handleUserInput === 'function', 'handleUserInput')
})

// ── 异步用例 ────────────────────────────────────────────────────────
ta('端到端（伪造解释器）: 提交成功且意图包含要求与质量解释', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  eq(out.outcome, 'committed', 'outcome')
  ok(out.packet && out.packet.text.length > 0, 'packet produced')
  ok(out.packet.text.includes('明确要求'), 'has requirements')
  ok(out.packet.text.includes('质量解释'), 'has quality section')
  ok(out.packet.text.includes('单 HTML 程序'), 'has req text')
  ok(out.packet.text.includes('整体比例协调'), 'has quality text')
  ok(a.getIntentText(SID) === out.packet.text, 'context updated with packet')
  const ids = out.packet.sections.find((x) => x.key === 'requirements').itemIds
  eq(ids.sort(), ['req-1', 'req-2', 'req-3'], 'requirements ids')
})

ta('质量展开不进入"明确要求"节（越界防线）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const reqIds = out.packet.sections.find((x) => x.key === 'requirements').itemIds
  ok(!reqIds.includes('qi-1') && !reqIds.includes('qi-2'), 'quality items must not be requirements')
  const reqBlock = out.packet.text.split('【质量解释')[0]
  ok(!reqBlock.includes('比例协调'), 'quality text must not appear under requirements block')
})

ta('伪造引文（发明要求）→ 解析被拒 → 状态与上下文都不变', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  // 第一次正常提交，建立基线
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)
  const beforeText = a.getIntentText(SID)

  const bad = async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: { id: 'req-x', kind: 'user_requirement', text: '必须完全离线运行', quote: '必须完全离线运行', sourceRefs: [humanSrc('m-2')] },
    }],
  })
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: TANK, interpret: bad })
  eq(out.outcome, 'parse-rejected', 'outcome')
  const after = a.intentStateOf(s)
  ok(after.items.every((i) => i.id !== 'req-x'), 'invented requirement must not enter state')
  eq(after.items.length, before.items.length, 'item count unchanged')
  // 注意：recordInput 已经推进了 revision，所以上下文会重编译；关键是**没有新增条目**
  ok(!a.getIntentText(SID).includes('必须完全离线运行'), 'invented requirement must not appear in packet')
  ok(beforeText.length > 0, 'baseline packet existed')
})

ta('用户改口：解释期间的晚到补丁被拒（真实竞态）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)

  // 关键：解释进行到一半时，**用户又说了第二句** —— 这会让 base 过期。
  // 解释器返回的补丁是基于旧 revision 构造的，正是"晚到的优化结果"。
  const lateInterpreter = async () => {
    a.commitUserInput(s, { messageId: 'm-user-second' })   // 用户改口
    return JSON.stringify({
      ops: [{ op: 'add_item', item: { id: 'late-1', kind: 'proposal', text: '基于旧目标的建议', sourceRefs: [modelSrc()] } }],
    })
  }
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: '只改颜色', interpret: lateInterpreter })

  // 流水线在解释后重读状态，发现输入已变 → 直接丢弃（不依赖下游 CAS 兜底）
  eq(out.outcome, 'input-changed', 'late patch must be discarded at the recheck step')
  const stepRecheck = out.trace.find((x) => x.step === 'recheck')
  ok(stepRecheck && stepRecheck.inputChanged === true, 'recheck must notice the input change: ' + JSON.stringify(stepRecheck))
  const stepDiscard = out.trace.find((x) => x.step === 'discard')
  ok(stepDiscard && stepDiscard.reason === 'INPUT_CHANGED_DURING_INTERPRETATION', 'must record a diagnosable reason')
  ok(!out.trace.some((x) => x.step === 'commit'), 'must not even attempt commit')

  const after = a.intentStateOf(s)
  ok(!after.items.some((i) => i.id === 'late-1'), 'late item must not enter state')
  ok(after.lastInputRevision > before.lastInputRevision, 'user input advanced lastInputRevision')
  ok(!a.getIntentText(SID).includes('基于旧目标的建议'), 'late item must not appear in packet')
})

ta('显式过期补丁：reducer 拒绝且不落状态', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)

  // 直接构造一个 baseRevision 过期的补丁（模拟旧的优化结果）
  const r = a.commit(s, {
    causeId: 'stale', baseRevision: 0, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'stale-1', kind: 'proposal', text: '过期建议', sourceRefs: [modelSrc()] } }],
  })
  ok(!r.ok, 'stale must be rejected')
  eq(r.code, 'STALE_REVISION', 'code')
  const after = a.intentStateOf(s)
  eq(after.revision, before.revision, 'revision unchanged')
  ok(after.items.every((i) => i.id !== 'stale-1'), 'stale item absent')
})

ta('解释器抛错 → 不提交、上下文不变', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const beforeText = a.getIntentText(SID)
  const boom = async () => { throw new Error('provider down') }
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: TANK, interpret: boom })
  eq(out.outcome, 'interpret-threw', 'outcome')
  ok(!a.getIntentText(SID).includes('provider'), 'context must not contain error text')
  eq(a.getIntentText(SID), beforeText, 'packet unchanged (recompiled from same items)')
})

ta('无操作（ops 为空）→ 不报错、状态不变', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)
  const empty = async () => '{"ops":[]}'
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: '谢谢', interpret: empty })
  eq(out.outcome, 'noop', 'outcome')
  const after = a.intentStateOf(s)
  eq(after.items.length, before.items.length, 'no items added')
})

ta('reducer 拒绝（模型伪造 human 来源）→ 不提交', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  // 引文是真的，但来源是 model → 解释层放行、reducer 拒绝
  const sneaky = async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: { id: 'req-s', kind: 'user_requirement', text: '必须离线', quote: '真实', sourceRefs: [modelSrc()] },
    }],
  })
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: sneaky })
  eq(out.outcome, 'reducer-rejected', 'outcome')
  const st = a.intentStateOf(s)
  ok(!st.items.some((i) => i.id === 'req-s'), 'must not enter state')
  ok(!a.getIntentText(SID).includes('必须离线'), 'must not appear in packet')
})

ta('解释期间发生并发提交（非用户输入）→ dryRun 必须针对当前状态', async () => {
  // 这条用例是**专门为 `dryRun(parsed.patch, current, …)` 这一行**设计的探针：
  // 上一个用例（用户改口）会被 `recheck` 的 inputChanged 提前拦下，
  // 因而无法单独验证"dryRun 用的是哪一份状态"。这里让 lastInputRevision 不变、
  // 只有 revision 变，使 dryRun 成为唯一能拦下晚到补丁的地方。
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)

  const concurrentInterpreter = async () => {
    // 解释期间，另一个**内部**补丁先提交（不是用户输入，所以 lastInputRevision 不变）
    const cur = a.intentStateOf(s)
    a.commit(s, {
      causeId: 'concurrent', baseRevision: cur.revision, sessionId: SID,
      ops: [{ op: 'add_item', item: { id: 'other-1', kind: 'proposal', text: '并发建议', sourceRefs: [modelSrc()] } }],
    })
    // 返回一个基于**旧** revision 的补丁（模拟晚到）
    return JSON.stringify({
      ops: [{ op: 'add_item', item: { id: 'late-2', kind: 'proposal', text: '晚到建议', sourceRefs: [modelSrc()] } }],
    })
  }
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: '顺手再看一眼', interpret: concurrentInterpreter })

  const stepRecheck = out.trace.find((x) => x.step === 'recheck')
  ok(stepRecheck, 'recheck step present')
  eq(stepRecheck.inputChanged, false, 'input did NOT change (so recheck cannot catch this)')
  eq(stepRecheck.revisionChanged, true, 'revision DID change')

  eq(out.outcome, 'reducer-rejected', 'dryRun against the CURRENT state must reject: ' + out.outcome)
  const stepDry = out.trace.find((x) => x.step === 'dryRun')
  ok(stepDry && stepDry.ok === false, 'dryRun must fail: ' + JSON.stringify(stepDry))
  eq(stepDry.code, 'STALE_REVISION', 'staleness code')

  const after = a.intentStateOf(s)
  ok(!after.items.some((i) => i.id === 'late-2'), 'late item must not enter state')
  ok(after.items.some((i) => i.id === 'other-1'), 'concurrent item stays')
})

ta('澄清集成：用户偏好未知 → 写 question 状态但**不弹窗**', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const interp = async () => JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'unk-pref', kind: 'unknown', unknownClass: 'user_preference', text: 'CDN 能否使用', sourceRefs: [modelSrc()] } },
    ],
  })
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: interp })
  eq(out.outcome, 'committed', 'committed')
  const cl = out.trace.find((x) => x.step === 'clarify')
  ok(cl, 'clarify step present')
  eq(cl.mode, 'ask', 'mode ask')
  eq(cl.questions, ['unk-pref'], 'question planned')
  const rec = out.trace.find((x) => x.step === 'recordQuestions')
  ok(rec && rec.ok === true, 'question recorded: ' + JSON.stringify(rec))
  const st = a.intentStateOf(s)
  eq(st.questions.length, 1, 'one question in state')
  eq(st.questions[0].status, 'proposed', 'status must be proposed (NOT asked: no UI was touched)')
})

ta('澄清集成：可查事实不进提问，只进 lookup 路由', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const interp = async () => JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'unk-fact', kind: 'unknown', unknownClass: 'lookupable_fact', text: '项目用什么测试框架', sourceRefs: [modelSrc()] } },
      { op: 'add_item', item: { id: 'unk-impl', kind: 'unknown', unknownClass: 'implementation_detail', text: '间距用 12 还是 16', sourceRefs: [modelSrc()] } },
    ],
  })
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: interp })
  const cl = out.trace.find((x) => x.step === 'clarify')
  eq(cl.mode, 'none', 'must not ask')
  eq(cl.routed.lookup, ['unk-fact'], 'fact routed to lookup')
  eq(cl.routed.decide, ['unk-impl'], 'detail routed to decide')
  ok(!out.trace.some((x) => x.step === 'recordQuestions'), 'must not record any question')
  const st = a.intentStateOf(s)
  eq(st.questions.length, 0, 'no questions recorded')
})

ta('澄清集成：问过即不再问（第二次输入不产生新问题）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const interp = async () => JSON.stringify({
    ops: [{ op: 'add_item', item: { id: 'unk-pref', kind: 'unknown', unknownClass: 'user_preference', text: 'CDN 能否使用', sourceRefs: [modelSrc()] } }],
  })
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: interp })
  const st1 = a.intentStateOf(s)
  eq(st1.questions.length, 1, 'first question recorded')
  // 第二次解释**不再重复添加**同一条（模拟模型不重复），但即使重复也会被去重闸挡住
  const out2 = await handleUserInput(a, s, { messageId: 'm-2', text: '继续说', interpret: async () => '{"ops":[]}' })
  const cl2 = out2.trace.find((x) => x.step === 'clarify')
  eq(cl2.mode, 'none', 'must not re-ask the same decision')
  const st2 = a.intentStateOf(s)
  eq(st2.questions.length, 1, 'still exactly one question')
})

ta('跨会话隔离：A 会话的意图包不进入 B 会话', async () => {
  const sA = makeSession('session-A')
  const sB = makeSession('session-B')
  const a = makeAdapter()
  const interpA = async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: {
        id: 'req-1', kind: 'user_requirement', text: 'A会话的单HTML程序',
        quote: '制作一个单html程序',
        sourceRefs: [{ kind: 'human', sessionId: 'session-A', messageId: 'm-1' }],
      },
    }],
  })
  const outA = await handleUserInput(a, sA, { messageId: 'm-1', text: TANK, interpret: interpA })
  eq(outA.outcome, 'committed', 'A committed')
  ok(a.getIntentText('session-A').includes('A会话的单HTML程序'), 'A has its packet')
  eq(a.getIntentText('session-B'), '', 'B must be silent: intent must not leak across sessions')

  const interpB = async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: {
        id: 'req-1', kind: 'user_requirement', text: '把标题改成设置',
        quote: '把标题改成设置',
        sourceRefs: [{ kind: 'human', sessionId: 'session-B', messageId: 'm-2' }],
      },
    }],
  })
  const outB = await handleUserInput(a, sB, { messageId: 'm-2', text: '把标题改成设置', interpret: interpB })
  eq(outB.outcome, 'committed', 'B committed')
  ok(a.getIntentText('session-B').includes('把标题改成设置'), 'B has its own packet')
  ok(!a.getIntentText('session-A').includes('把标题改成设置'), 'A must not receive B content')
  ok(!a.getIntentText('session-B').includes('A会话'), 'B must not receive A content')
})

ta('trace 记录每一步，失败时也能定位', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const out = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const steps = out.trace.map((x) => x.step)
  eq(steps, ['init', 'recordInput', 'interpret', 'parse', 'recheck', 'dryRun', 'commit', 'clarify', 'setContext'], 'trace steps')
})

ta('确定性：同一输入重复跑，产出包一致', async () => {
  const s1 = makeSession(SID); const a1 = makeAdapter()
  const s2 = makeSession(SID); const a2 = makeAdapter()
  const o1 = await handleUserInput(a1, s1, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const o2 = await handleUserInput(a2, s2, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  eq(o1.packet.text, o2.packet.text, 'packets identical')
})

// 运行
for (const { name, fn } of asyncTests) {
  try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-pipeline', phase: 'P3', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
