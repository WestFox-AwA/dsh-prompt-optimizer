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

/** 每轮都从 req-1 开始编号的"健忘"解释器（复刻真机：不遗传 ⇒ 它看不到历史条目 ⇒ 必然撞号）。 */
function forgetfulInterpreter(text) {
  return async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: {
        id: 'req-1', kind: 'user_requirement', text: String(text).slice(0, 80), quote: String(text),
        sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-auto' }],
      },
    }],
  })
}

ta('撞 id 不再把整轮判死：宿主改名后照常成包（真机 2026-09-22 的 no-packet 真因）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  // 第一轮：req-1 落进状态（之后**永不删除**，只退场）
  const r1 = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: forgetfulInterpreter(TANK) })
  eq(r1.outcome, 'committed', '第一轮提交')
  ok(a.intentStateOf(s).items.some((i) => i.id === 'req-1'), 'req-1 进了状态')
  // 第二轮：解释层**又**发 req-1（它看不到历史）⇒ 旧行为是 DUPLICATE_ITEM ⇒ 整轮 no-packet
  const text2 = '继续吧,弹窗问题已修复'
  const r2 = await handleUserInput(a, s, { messageId: 'm-2', text: text2, interpret: forgetfulInterpreter(text2) })
  eq(r2.outcome, 'committed', '第二轮也必须提交（不再 reducer-rejected）')
  const rename = r2.trace.find((x) => x.step === 'rename')
  ok(rename && rename.renamed.length === 1 && rename.renamed[0].from === 'req-1', '改名要记账：' + JSON.stringify(rename))
  ok(a.intentStateOf(s).items.some((i) => i.id === rename.renamed[0].to), '改名后的新条目进了状态')
  ok(a.getIntentText(SID).includes('继续吧'), '第二轮的原话进了包（这才是用户要的"思考完成后有产出"）')
})

// ── 缺 id / 空 id 不再把整轮判死（真机 2026-09-24 的 no-packet 真因，与撞号是两回事）────────
// 台账原句：`dryRun:fail(BAD_SCHEMA | ops[7].item: item.id invalid: undefined;
//            ops[8].item: item.id invalid: -tmuetqc4p; ops[9]… -tmuetqc4p_jb; ops[10]… -tmuetqc4p_e6)`
// 机制两段叠加：模型有几条 add_item 没给 id ⇒ 旧代码把 `''` 记进 taken 却不修（第一条漏过去），
// 后面的空 id 于是走"撞号"分支被改成 `'' + '-t' + turnId尾` ⇒ 以 `-` 开头、仍然非法 ⇒ 整份补丁被拒。
// id 只是宿主内部的名字（正文/原话/依据都不变）⇒ 正确处置是**宿主补名并记账**。
ta('缺 id / 空 id / 非法 id：宿主补一个合法名字，整轮照常成包', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const bad = async () => JSON.stringify({
    ops: [
      { op: 'add_item', item: { kind: 'user_requirement', text: '没有 id 的一条', quote: TANK, sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-auto' }] } },
      { op: 'add_item', item: { id: '', kind: 'user_requirement', text: '空 id 的一条', quote: TANK, sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-auto' }] } },
      { op: 'add_item', item: { id: '-x', kind: 'proposal', text: '非法 id 的一条', quote: TANK, sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-auto' }] } },
    ],
  })
  const r = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: bad })
  eq(r.outcome, 'committed', '必须提交（旧行为是 reducer-rejected ⇒ 包 0 字）：' + JSON.stringify(r.trace))
  const step = r.trace.find((x) => x.step === 'rename')
  ok(step && step.renamed.length === 3, '三条都要记账：' + JSON.stringify(step))
  ok(step.renamed.every((x) => x.why === 'invalid-id'), '这三条是"补名"不是"撞号"：' + JSON.stringify(step.renamed))
  // 补出来的名字必须真的合法——判据与 schema 同源，直接拿真 ID_RE 复核（不许"改完还是非法"）
  const ID_RE = /^[a-z0-9][a-z0-9:_-]{2,79}$/i
  for (const x of step.renamed) ok(ID_RE.test(x.to), '补出来的 id 必须过 schema 的规则：' + x.to)
  ok(a.getIntentText(SID).includes('没有 id 的一条'), '内容不许因为补名而丢')
  ok(a.getIntentText(SID).includes('非法 id 的一条'), '同上')
})

// ── 旧包不许留在动态上下文里（真机 2026-09-22 用户报障）───────────────────
// 报障原话："当插件档位为'关闭'后，再发消息给 AI，会自动注入上一次对话的优化上下文"。
// 宿主侧有两条独立成因：① 注入门禁只查启用闸门、不查档位；② 失败/中止的那一轮**不收尾**，
// 于是上一轮的包继续挂着。①不在本文件（index 的 provider），②在这里钉住：
// **任何一轮只要没产出新包，动态上下文就必须变空**（包是"只作用于这一轮"的东西）。
ta('失败的一轮要把上一轮的包撤下来（不留旧包）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const r1 = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  eq(r1.outcome, 'committed', '第一轮提交')
  ok(a.getIntentText(SID).length > 0, '第一轮写了包')
  // 第二轮：解释层交回**不是 JSON** 的东西 ⇒ parse-rejected（真机里这一类的常见来源见 ledger）
  // 第二轮：解释层交回**坏 JSON**（有 JSON 形状但解析不了）⇒ parse-rejected
  // ⚠ 注意别用"完全没有 JSON"（那是 `NO_JSON` ⇒ 空产出 ⇒ 会被重试+兜底，见 pipeline 的 3b）。
  //   这里要钉的是"真·解析失败"仍然把上一轮的包撤下来。
  const r2 = await handleUserInput(a, s, {
    messageId: 'm-2', text: '继续', interpret: async () => '{"ops":[{"op":}]}',
  })
  eq(r2.outcome, 'parse-rejected', '第二轮解析失败')
  eq(a.getIntentText(SID), '', '失败的一轮必须把上一轮的包撤下来（否则旧包继续被注入）')
  const st = r2.trace.find((x) => x.step === 'setContext')
  ok(st && st.chars === 0, '收尾要记一步 setContext: 0：' + JSON.stringify(st))
})

ta('用户取消（abort）⇒ 记 aborted 而不是 parse-rejected；不产生"模型写坏了"的假象', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const r1 = await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  ok(a.getIntentText(SID).length > 0, '第一轮写了包')
  // 真机形态：浏览器 abort ⇒ 流被切断 ⇒ 模型一个字都没吐（''），旧顺序会先判 parse 失败
  const r2 = await handleUserInput(a, s, {
    messageId: 'm-2', text: '再改一下', signal: { aborted: true }, interpret: async () => '',
  })
  eq(r2.outcome, 'aborted', '取消就是取消，不许记成解析失败')
  eq(a.getIntentText(SID), '', '取消的一轮同样要把上一轮的包撤下来')
})

ta('伪造引文（发明要求）→ 该条被丢弃；这一轮以"没提取到"的兜底收尾（不发明的绝不入包）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  // 第一次正常提交，建立基线
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)

  const bad = async () => JSON.stringify({
    ops: [{
      op: 'add_item',
      item: { id: 'req-x', kind: 'user_requirement', text: '必须完全离线运行', quote: '必须完全离线运行', sourceRefs: [humanSrc('m-2')] },
    }],
  })
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: TANK, interpret: bad })
  // ⚠ 契约变更（真机回归 2026-09-22：用户发 "A" 却报 `no-packet`）：伪造引文**只丢这一条**，
  //   不再把整轮判成 `parse-rejected`。
  // ⚠ 二次变更（同日，"短消息/老会话里反复重试一直 no-packet"）：唯一一条被丢 ⇒ 空补丁 ⇒
  //   重试一次仍空 ⇒ **宿主补一条"这一轮没提取到"的待确认条目**，于是这一轮不再是空的。
  //   不变量一个都没动：**那条发明的要求既不在状态里、也不在包里**；新增的只有兜底那一条（非人类类别）。
  eq(out.outcome, 'committed', '不再整轮失败；以兜底条目收尾')
  const droppedStep = out.trace.find((x) => x.step === 'parse')
  eq(droppedStep.dropped.length, 1, '被丢的条目要记账')
  eq(droppedStep.dropped[0].id, 'req-x', '记的是这一条')
  const after = a.intentStateOf(s)
  ok(after.items.every((i) => i.id !== 'req-x'), 'invented requirement must not enter state')
  ok(after.items.some((i) => i.id === 'unk-unevaluated-input'), '兜底条目进了状态（它是"没提取到"的事实，不是发明的要求）')
  eq(after.items.length, before.items.length + 1, '除兜底外没有别的条目')
  ok(!a.getIntentText(SID).includes('必须完全离线运行'), 'invented requirement must not appear in packet')
  ok(a.getIntentText(SID).includes('unk-unevaluated-input') || a.getIntentText(SID).includes('没有从中提取到'),
    '包里应当能看到"这一轮没提取到"这句话')
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

ta('解释器抛错 → 不提交；这一轮没有包，动态上下文必须是空的', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  ok(a.getIntentText(SID).length > 0, '第一轮先有一份包')
  const boom = async () => { throw new Error('provider down') }
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: TANK, interpret: boom })
  eq(out.outcome, 'interpret-threw', 'outcome')
  ok(!a.getIntentText(SID).includes('provider'), 'context must not contain error text')
  // ⚠ 判据更新（2026-09-22，用户报障"关闭档后仍注入上一次的优化上下文"）：
  //   旧断言是"包原样不变"（recompiled from same items）—— 那正是**旧包继续被注入**的那条路。
  //   `advance_turn` 已经在解释之前把上一轮条目整体退场 ⇒ 这一轮的正确答案就是**空包**；
  //   失败的一轮若不收尾，上一轮的包会一直挂在动态上下文里（真机症状）。现在一律收尾成空。
  eq(a.getIntentText(SID), '', '抛错的一轮不留旧包（旧包必须被撤下来）')
})

ta('空产出（ops 为空）⇒ 重试一次仍空 ⇒ 宿主兜底成包（真机"反复重试一直 no-packet"的正面修复）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: goodInterpreter() })
  const before = a.intentStateOf(s)
  const empty = async () => '{"ops":[]}'
  const out = await handleUserInput(a, s, { messageId: 'm-2', text: '谢谢', interpret: empty })
  // ⚠ 契约变更（2026-09-22）：旧行为是 `noop` + 空包 —— 真机里 28 条 noop 有 26 条是"原话只有两个字"，
  //   而且**重试多少次都是同一条输入、同一种结果**（用户报障："不断重试也一直出现 no-packet"）。
  //   现在：① 空产出重试一次；② 仍空 ⇒ 宿主补一条"这一轮没提取到"的**待确认**条目（不发明要求、
  //   不拦下游），于是这一轮**一定有包**。
  eq(out.outcome, 'committed', '兜底后这一轮不再空')
  const steps = out.trace.map((x) => x.step)
  ok(steps.includes('retryEmpty'), '要记一步"空产出重试"：' + JSON.stringify(steps))
  ok(steps.includes('fallbackEmpty'), '要记一步"兜底"：' + JSON.stringify(steps))
  const after = a.intentStateOf(s)
  const added = after.items.filter((i) => !before.items.some((b) => b.id === i.id))
  eq(added.length, 1, '只新增兜底那一条')
  eq(added[0].id, 'unk-unevaluated-input', '兜底条目的 id')
  eq(added[0].kind, 'unknown', '兜底落在"待确认"类（不是 user_requirement）')
  eq(added[0].blocksAction, false, '不拦下游（"谢谢"这种本轮就不该额外做什么）')
  ok(a.getIntentText(SID).length > 0, '这一轮真的有包了')
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

ta('新一轮：用户下一条消息让上一轮的 turn 级指令退役，长期目标保留', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  // 第 1 条消息：长期目标
  const r1 = async () => JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'req-html', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-1' }] } },
    ],
  })
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: r1 })
  // 第 2 条消息：本轮指令
  const r2 = async () => JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'turn-color', kind: 'user_requirement', text: '只改颜色，其他别动', scope: 'turn', quote: '只改颜色，其他别动', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-2' }] } },
    ],
  })
  const o2 = await handleUserInput(a, s, { messageId: 'm-2', text: '只改颜色，其他别动', interpret: r2 })
  eq(o2.outcome, 'committed', 'round2 committed')
  ok(a.getIntentText(SID).includes('只改颜色'), 'turn item present in its own round')

  // 第 3 条消息：新的一轮 → 上一轮 turn 条目应退役
  const o3 = await handleUserInput(a, s, { messageId: 'm-3', text: '再看看履带', interpret: async () => '{"ops":[]}' })
  // ⚠ 判据更新（2026-09-22）：空产出不再停在 `noop`+空包 —— 重试一次仍空则由宿主补一条
  //   "这一轮没提取到"的兜底条目（真机：短消息反复重试一直 no-packet）。轮次退役的语义不变。
  eq(o3.outcome, 'committed', 'round3 以兜底收尾（不再空）')
  const stepAdv = o3.trace.find((x) => x.step === 'advanceTurn')
  ok(stepAdv && stepAdv.ok === true, 'advanceTurn ran: ' + JSON.stringify(stepAdv))
  eq(stepAdv.turnId, 'turn:m-3', 'turnId derived from messageId')
  const st = a.intentStateOf(s)
  // ⚠ 2026-09-21 用户拍板"不遗传目标"：推进轮次 = 上一轮**整体**退场（stale），
  // 连 task 级长期目标也不再自动继承——所以这里两条都断言退场。
  eq(st.items.find((x) => x.id === 'turn-color').status, 'stale', 'previous turn item retired')
  eq(st.items.find((x) => x.id === 'req-html').status, 'stale', 'task item 同样不继承（不遗传目标）')
  ok(!a.getIntentText(SID).includes('只改颜色'), 'retired turn item gone from packet')
  ok(!a.getIntentText(SID).includes('单 HTML 程序'), 'standing goal 也不再自动继承')
  ok(a.getIntentText(SID).includes('没有从中提取到'), '这一轮包里留下的是"没提取到"的如实说明，而不是旧目标')
})

ta('新一轮幂等：同一条消息重复处理不会误退役本轮的 turn 条目', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  const r2 = async () => JSON.stringify({
    ops: [{ op: 'add_item', item: { id: 'turn-color', kind: 'user_requirement', text: '只改颜色', scope: 'turn', quote: '只改颜色', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-2' }] } }],
  })
  await handleUserInput(a, s, { messageId: 'm-2', text: '只改颜色', interpret: r2 })
  const st1 = a.intentStateOf(s)
  eq(st1.items.find((x) => x.id === 'turn-color').status, 'active', 'active after first pass')
  // 同一条消息再来一次（模拟重放）：turnId 相同 → 不应退役
  const o2 = await handleUserInput(a, s, { messageId: 'm-2', text: '只改颜色', interpret: async () => '{"ops":[]}' })
  const st2 = a.intentStateOf(s)
  eq(st2.turnId, 'turn:m-2', 'same turnId')
  eq(st2.items.find((x) => x.id === 'turn-color').status, 'active', 'idempotent: must NOT retire its own round item')
  // ⚠ 判据更新（2026-09-22）：空产出不再停在 `noop`（宿主会补兜底条目）。**幂等语义没变**：
  //   本轮 turn 条目仍 active，兜底只是额外一条 unknown。
  eq(o2.outcome, 'committed', '以兜底收尾')
  ok(st2.items.some((x) => x.id === 'unk-unevaluated-input'), '兜底条目在')
})

ta('解释器看到的是推进后的状态（不会看到上一轮的 turn 条目）', async () => {
  const s = makeSession(SID)
  const a = makeAdapter()
  await handleUserInput(a, s, { messageId: 'm-1', text: TANK, interpret: async () => JSON.stringify({
    ops: [{ op: 'add_item', item: { id: 'turn-old', kind: 'user_requirement', text: '旧的本轮指令', scope: 'turn', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: 'm-1' }] } }],
  }) })
  let seen = null
  await handleUserInput(a, s, { messageId: 'm-2', text: '新的一轮', interpret: async ({ state }) => {
    seen = state
    return '{"ops":[]}'
  } })
  ok(seen, 'interpreter received state')
  const old = seen.items.find((x) => x.id === 'turn-old')
  eq(old.status, 'stale', 'interpreter must see the retired item, not a stale active one')
  eq(seen.turnId, 'turn:m-2', 'interpreter sees the NEW turnId')
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
  eq(steps, ['init', 'recordInput', 'advanceTurn', 'interpret', 'parse', 'recheck', 'dryRun', 'commit', 'clarify', 'setContext'], 'trace steps')
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
