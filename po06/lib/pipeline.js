// dsh-prompt-optimizer 0.6 · 单次任务流水线（C 臂接线）
//
// 把四段串起来：用户输入 → 解释（唯一 LLM 环节，**可注入**）→ reducer 提交 → 编译 → 动态上下文。
//
// 设计要点：
//   · **解释器是注入的**（`interpret`），因此本文件与它的测试**完全不调用模型**；
//     真实模型只在 P3 对照实验里接上。
//   · 任何一步失败都**不产生副作用**：不提交、不更新意图包。
//   · 全过程产出 `trace`，供证据台账与故障用例断言。
//
// 纯编排：不读文件、不读时间、不调 LLM。

import { parseInterpreterOutput, dryRun } from './interpreter.js'
import { compileAudited } from './compiler.js'
import { reduce } from './reducer.js'
import { planClarification, planningToOps } from './clarifier.js'

/**
 * 处理一次用户输入。
 *
 * @param adapter  DshAdapter（需提供 intentStateOf / commit / commitUserInput / initIntent / setIntentText）
 * @param session  宿主 session（提供 id 与 append）
 * @param input    { messageId, text, interpret, observations? }
 *        `interpret` 是注入的解释函数：async ({userText, state, sessionId, messageId, observations}) => rawOutput
 * @returns { trace, packet, state, outcome }
 */
export async function handleUserInput(adapter, session, input) {
  const trace = []
  const step = (name, data) => { trace.push({ step: name, ...(data || {}) }) }
  const sessionId = String(session.id)
  const text = String(input.text == null ? '' : input.text)

  // 0) 尚无状态则初始化（仍走 reducer 权威路径）
  if (adapter.intentStateOf(session) === null) {
    const init = adapter.initIntent(session, { taskId: input.taskId || 'default' })
    step('init', { ok: init.ok, code: init.code || null })
    if (!init.ok) return finish(trace, null, null, 'init-failed', adapter, session)
  }

  // 1) 记录用户输入 —— 这一步使**一切在它之前产生的候选补丁**失效
  const ui = adapter.commitUserInput(session, { messageId: input.messageId })
  step('recordInput', { ok: ui.ok, revision: ui.state ? ui.state.revision : null, lastInputRevision: ui.state ? ui.state.lastInputRevision : null })
  if (!ui.ok) return finish(trace, null, null, 'record-input-failed', adapter, session)

  // 1b) 新一轮：**一条用户消息 = 一轮**（ADR-0024）。
  //     必须在解释之前推进——否则解释器看到的还是上一轮的 turn 级指令，
  //     可能据此重复添加已经过期的东西。
  //     turnId 由 messageId 决定，天然幂等：同一条消息重复处理不会把本轮指令误退役。
  const adv = adapter.commit(session, {
    causeId: 'advance-turn:' + String(input.messageId),
    baseRevision: adapter.intentStateOf(session).revision,
    baseInputRevision: adapter.intentStateOf(session).lastInputRevision,
    sessionId,
    ops: [{ op: 'advance_turn', turnId: 'turn:' + String(input.messageId) }],
  })
  step('advanceTurn', { ok: adv.ok, code: adv.code || null, turnId: 'turn:' + String(input.messageId) })
  if (!adv.ok) return finish(trace, adapter.intentStateOf(session), null, 'advance-turn-failed', adapter, session)

  const base = adapter.intentStateOf(session)

  // 2) 解释（可注入；真实实现是唯一 LLM 调用点）
  const interpretArgs = {
    userText: text,
    state: base,
    sessionId,
    messageId: String(input.messageId),
    observations: input.observations,
  }
  let raw = null
  try {
    raw = await input.interpret({ ...interpretArgs })
  } catch (e) {
    step('interpret', { ok: false, error: String((e && e.message) || e) })
    return finish(trace, base, null, 'interpret-threw', adapter, session)
  }
  step('interpret', { ok: true, chars: String(raw == null ? '' : raw).length })

  // 2b) **abort 先判**（真机 2026-09-22 台账照出来的误报）：
  //     用户按「跳过并发送」/「取消」时浏览器会 abort 这次 fetch，流被切断 ⇒ 模型这一轮
  //     通常**一个字都没吐**（`interpretTextChars: 0`）⇒ 旧顺序会先在下面 `parse` 判死，
  //     记成 `parse-rejected / NO_JSON`（看起来像"模型写坏了"），而真相是"用户取消了"。
  //     实测：近一天里 21 条"空文本 parse-rejected"有 **19 条** 都能在同一会话 ±5 秒内
  //     找到一条 `aborted` 台账 —— 这不是模型缺陷，是**归因错**（还会让界面把"已跳过"报成失败）。
  //     放在 parse 之前，用户主动取消就不再产生假的失败记录。
  if (input.signal && input.signal.aborted) {
    step('abort', { reason: 'client-aborted', before: 'parse' })
    return finish(trace, base, null, 'aborted', adapter, session)
  }

  // 3)+6) 解析 → 机械校验（逐字引文 / kind 白名单 / op 白名单 / 数量上限）
  //        → 撞 id 改名 → 目标不存在的 op 逐条丢弃。
  //        抽成**可重跑的一小段**，因为下面要做"空产出有界重试 + 兜底"。
  const prepare = (rawText) => {
    const p = parseInterpreterOutput(rawText, {
      // P11：把**本轮真正喂进去的上下文**也交给校验——短消息几乎无字可引，
      // 只认"用户原话的子串"会把候选全判死（真机 `no-packet` 的机制之一）。
      contextText: typeof input.contextText === 'function' ? input.contextText() : input.contextText,
      userText: text,
      sessionId,
      // 宿主替模型补 `human.messageId` 时要用它（引文逐字来自这条原话才补，可机械核对）
      messageId: String(input.messageId),
      // 销账的第三种依据：宿主**已经存档**的条目正文 + rationale（见 validateProvenance 的说明）。
      // 真机教训（坦克会话第三轮）：模型发了 11 条销账，引文却是自己的转述 ⇒ 三轮下来一条没销掉，
      // 旧条目继续被编译进包。只给"正文与 rationale"，不给 id 与状态——依据是"这句话被记录过"，
      // 不是"这条该销"；该不该销仍由模型判断，但**不许它凭空编一句没人说过的依据**。
      stateText: (base.items || []).map((it) => String(it.text || '') + ' ' + String(it.rationale || '')).join('\n'),
      baseRevision: base.revision,
      baseInputRevision: base.lastInputRevision,
      causeId: 'interpret:' + input.messageId,
    })
    const renamed = renameCollidingIds(p, adapter, session)
    const droppedTargets = dropUnknownTargetOps(p, adapter, session)
    return { parsed: p, renamed, droppedTargets }
  }
  let prepared = prepare(raw)
  step('parse', {
    ok: prepared.parsed.ok, code: prepared.parsed.code || null, reason: prepared.parsed.reason || null,
    warnings: prepared.parsed.warnings || [],
    // 逐条丢弃要留痕（用户 2026-09-21：绝不允许"看着成了、其实少了一条"）
    dropped: prepared.parsed.dropped || [],
  })
  if (prepared.renamed.length > 0) step('rename', { ok: true, renamed: prepared.renamed })
  if (prepared.droppedTargets.length > 0) step('dropUnknownTargets', { dropped: prepared.droppedTargets })

  // 3b) **空产出不再等于"这一轮没有包"**（真机 2026-09-22：短消息/老会话里**反复重试一直 no-packet**）。
  //
  // 台账把这条路径照得很清楚：28 条 `noop` 里 **26 条**的 `chars` 都是 **2**（原话两个字），
  // 它们全都在 `interpret` 之后直接 `noop` —— 模型对"两个字 + 一段上下文"给出了**空 ops 数组**，
  // 于是这一轮一个包都产不出来，而**用户重试多少次都是同一条输入 ⇒ 同一种结果**（这就是"一直 no-packet"）。
  // 处置分两级，都是"机制保证不空"，而不是把现象盖住：
  //   ① 有界重试**一次**：把"你上一轮交了空产出"这件事明确告诉解释层，要求它按规则至少给一条；
  //   ② 仍然空 ⇒ 宿主补一条**关于这轮原话本身**的待确认条目（`unknown`，不发明任何要求，见 buildEmptyFallback）。
  const emptyReason = emptyResultReason(prepared.parsed)
  if (emptyReason) {
    step('retryEmpty', { reason: emptyReason, attempt: 2 })
    let raw2 = null
    try { raw2 = await input.interpret({ ...interpretArgs, retryEmpty: true, emptyReason }) }
    catch (e) { step('retryEmptyFail', { error: String((e && e.message) || e) }) }
    if (raw2 != null) {
      prepared = prepare(raw2)
      step('parse2', { ok: prepared.parsed.ok, code: prepared.parsed.code || null, chars: String(raw2).length,
        warnings: prepared.parsed.warnings || [], dropped: prepared.parsed.dropped || [] })
      if (prepared.renamed.length > 0) step('rename2', { ok: true, renamed: prepared.renamed })
    }
    if (emptyResultReason(prepared.parsed)) {
      step('fallbackEmpty', { reason: emptyReason, chars: text.length })
      prepared = prepare(JSON.stringify({ ops: [buildEmptyFallback({ sessionId, messageId: String(input.messageId), userText: text })] }))
      step('parse3', { ok: prepared.parsed.ok, code: prepared.parsed.code || null, fallback: true, dropped: prepared.parsed.dropped || [] })
    }
  }
  const parsed = prepared.parsed
  if (!parsed.ok) {
    // `NO_JSON`（一个字都没吐）与"吐了但写坏了"要分开记：前者是**空产出**，后者才是解析失败。
    const outcome = parsed.code === 'NO_JSON' ? 'empty-completion' : 'parse-rejected'
    return finish(trace, base, null, outcome, adapter, session)
  }

  // 4) 无操作：不改状态，但仍重新编译（可能只是没有新增）
  if (!parsed.patch) {
    planAndRecordClarification(adapter, session, trace, input)
    return finish(trace, base, null, 'noop', adapter, session)
  }

  // 5) **重新读取当前状态**再校验。
  //    必须重读：解释期间用户可能又说话了。若拿解释开始前的快照去 reduce，
  //    CAS 会变成"旧 revision 比旧 revision"——永远相等、永远通过，
  //    这个最该拦下晚到补丁的地方反而给出假 OK。（P3 流水线测试抓到的真实缺陷）
  const current = adapter.intentStateOf(session)
  if (!current) {
    step('recheck', { ok: false, code: 'NO_CURRENT_STATE' })
    return finish(trace, base, null, 'state-lost', adapter, session)
  }
  const inputChanged = current.lastInputRevision !== base.lastInputRevision
  const revisionChanged = current.revision !== base.revision
  step('recheck', {
    ok: true, inputChanged, revisionChanged,
    baseRevision: base.revision, currentRevision: current.revision,
    baseInputRevision: base.lastInputRevision, currentInputRevision: current.lastInputRevision,
  })
  if (inputChanged) {
    // 用户已改口：这份补丁基于的目标已作废，直接丢弃（不提交、不写上下文以外的东西）
    step('discard', { reason: 'INPUT_CHANGED_DURING_INTERPRETATION' })
    return finish(trace, current, null, 'input-changed', adapter, session)
  }
  // 用户按了「跳过并发送」/「取消」（浏览器 abort 了那次 fetch）⇒ **提交前最后一道闸门**：
  // 不提交、不写**这一轮的结果**。
  // 为什么要有这一道（真机 2026-09-22："点击跳过并发送之后,优化居然还会持续一点时间才停止"）：
  // 光断掉 HTTP 不会让模型停下；这里保证"就算它跑完，也**写不进去**"。
  // ⚠ 与"清掉旧包"不矛盾（2026-09-22 补）：`advance_turn` 已经把上一轮条目整体退场，
  //   所以**这一轮的正确答案本来就是空包**；`finish` 写进去的正是这个空包 ——
  //   那不是"把这一轮的结果写进去"，而是**把上一轮的旧包撤下来**。旧写法在这里连 finish 都不走，
  //   于是那份上一轮的包继续被注入到后面的装配里（用户报障的另一半）。
  if (input.signal && input.signal.aborted) {
    step('abort', { reason: 'client-aborted' })
    return finish(trace, current, null, 'aborted', adapter, session)
  }

  // 6) 撞 id 改名与"目标不存在"的逐条丢弃**已经在上面 `prepare()` 里做过**（为了让空产出能重跑）。
  //    这里不再重复；要看结果就看 trace 里的 `rename` / `dropUnknownTargets` 两步。

  // 7) reducer 权威校验（dry run，针对**当前**状态）
  const dry = dryRun(parsed.patch, current, reduce)
  step('dryRun', { ok: dry.ok, code: dry.code || null, reason: dry.reason || null })
  // **归一记账进 trace**（2026-09-24）：`validatePatch` 里为形状做过的"就地修"（候选字符串化、
  // 超数截断、补 id…）。纪律是"**不静默**地修"，所以修了什么必须留在 trace 里能被查。
  // ⚠ 必须在 `dryRun` **之后**读：`repairs` 是 `dryRun → reduce → validatePatch` 那一步才填上的。
  if (Array.isArray(parsed.patch && parsed.patch.repairs) && parsed.patch.repairs.length > 0) {
    const counts = {}
    for (const r of parsed.patch.repairs) {
      const k = String((r && r.why) || '?')
      counts[k] = (counts[k] || 0) + 1
    }
    step('normalize', { total: parsed.patch.repairs.length, counts })
  }
  if (!dry.ok) return finish(trace, current, null, 'reducer-rejected', adapter, session)

  // 8) 提交（CAS → append 完整新状态）
  const committed = adapter.commit(session, parsed.patch)
  step('commit', { ok: committed.ok, code: committed.code || null, reason: committed.reason || null })
  if (!committed.ok) return finish(trace, current, null, 'commit-rejected', adapter, session)

  planAndRecordClarification(adapter, session, trace, input)
  return finish(trace, committed.state, null, 'committed', adapter, session)
}

/** 收尾：编译 + 写入动态上下文，并汇总结果。 */
function finish(trace, state, _unused, outcome, adapter, session) {
  let packet = null
  if (adapter && session) {
    const cur = adapter.intentStateOf(session)
    if (cur) {
      packet = compileAudited(cur, { budget: adapter.packetBudget })
      // 审计不过 → 不写入上下文（宁可静默，也不投递不可信的包）
      if (!packet.ok) {
        trace.push({ step: 'audit', ok: false, problems: packet.problems })
        adapter.setIntentText(session.id, '')
        trace.push({ step: 'setContext', sessionId: String(session.id), chars: 0, reason: 'audit-failed' })
        return { trace, packet, state: cur, outcome: 'audit-failed' }
      }
      // 按会话隔离写入（不是全局字符串）
      adapter.setIntentText(session.id, packet.text)
      trace.push({ step: 'setContext', sessionId: String(session.id), chars: packet.text.length, dropped: packet.dropped.length })
    } else {
      // 没有状态（init/record 失败那一类）也要**把这一轮收干净**：
      // 旧写法在这里什么都不做，于是上一轮的包继续留在动态上下文里被注入 —— 与"关档后仍注入"
      // 是同一条缺陷面的另一处（包是"只作用于这一轮"的东西，这一轮没有包就该是空的）。
      adapter.setIntentText(session.id, '')
      trace.push({ step: 'setContext', sessionId: String(session.id), chars: 0, reason: 'no-state' })
    }
  }
  return { trace, packet, state: state || null, outcome }
}

/**
 * 澄清规划：只写 question 状态，**不弹窗**（遵守 ADR-0010，真实提问须与用户约定时机）。
 * 规划结果进 trace，便于事后核对"问了什么、为什么问、什么被路由走了"。
 */
function planAndRecordClarification(adapter, session, trace, input) {
  try {
    const st = adapter.intentStateOf(session)
    if (!st) return null
    const planned = planClarification(st, { maxQuestions: input && input.maxQuestions })
    trace.push({
      step: 'clarify',
      mode: planned.mode,
      questions: planned.questions.map((q) => q.decisionId),
      routed: planned.routed,
      deferred: planned.deferred,
      unclassified: planned.unclassified,
      reason: planned.reason,
    })
    if (planned.mode !== 'ask') return planned
    const ops = planningToOps(planned)
    const r = adapter.commit(session, {
      causeId: 'clarify:' + String(input && input.messageId || 'x'),
      baseRevision: st.revision,
      baseInputRevision: st.lastInputRevision,
      sessionId: String(session.id),
      ops,
    })
    trace.push({ step: 'recordQuestions', ok: r.ok, code: r.code || null, count: ops.length })
    return planned
  } catch (e) {
    trace.push({ step: 'clarify', error: String((e && e.message) || e) })
    return null
  }
}

/**
 * **id 归一：写坏了就补一个，撞号了才改名——两种情况都不把整轮判死**。
 *
 * ② 撞号（真机 2026-09-22，用户："在此会话中,还是会在思考完成之后 no-packet"）：
 *   `dryRun:fail(DUPLICATE_ITEM | item id already exists: req-1)` ⇒ 整轮作废、包 0 字。
 *   根因是"不遗传"之后**解释层看不到历史条目**（本轮状态通常是空的）⇒ 它每轮都从 `req-1` 开始编号；
 *   而旧条目只退场、**不删除** ⇒ 必然撞号。撞号本身不是语义冲突，只是命名撞车 ⇒ 宿主改名即可。
 *
 * ① **没写 id / 写坏了**（真机 2026-09-24，`dryRun:fail(BAD_SCHEMA | ops[7].item: item.id invalid:
 *   undefined; ops[8..10].item: item.id invalid: -tmuetqc4p / -tmuetqc4p_jb / -tmuetqc4p_e6)`）⇒ 整轮作废、包 0 字。
 *   机制是**两段叠加**：模型有几条 `add_item` 没给 id（或给了空串）⇒ 旧代码把 `''` 当成"一个已被占用的 id"
 *   记进 `taken` 却**不修**（第一条就这么漏过去了），后面的空 id 于是走"撞号"分支、被改成
 *   `'' + '-t' + turnId 尾` ＝ **以 `-` 开头**，仍然不合法 ⇒ 整份补丁 BAD_SCHEMA。
 *   id 只是宿主内部的**名字**（内容、原话、依据都不变），所以正确处置是**宿主补一个合法名字并记账**，
 *   而不是让一条没名字的条目把这一轮的全部产出带走。
 * @returns 归一清单（供 trace；`why` 标明是补名还是改名）
 */
function renameCollidingIds(parsed, adapter, session) {
  const renamed = []
  try {
    if (!parsed || !parsed.ok || !parsed.patch || !Array.isArray(parsed.patch.ops)) return renamed
    const state = adapter.intentStateOf(session)
    const taken = new Set(((state && state.items) || []).map((it) => String(it.id)))
    const map = new Map()
    const suffix = '-t' + String((state && state.turnId) || 'x').replace(/[^a-z0-9]/gi, '').slice(-8)
    const uniq = (base) => {
      let id = String(base).slice(0, Math.max(3, 80 - suffix.length))
      while (taken.has(id)) id = id.slice(0, Math.max(3, 80 - suffix.length - 2)) + '_' + Math.random().toString(36).slice(2, 4)
      taken.add(id)
      return id
    }
    // 合法 id 的判据与 `schema.js` 的 `ID_RE` 同源（`/^[a-z0-9][a-z0-9:_-]{2,79}$/i`）。
    // 为什么不 import：schema 那份是"校验用的真源"，这里要的是**快速判断**，
    // 但两者必须一致——`test/read-tools.test.mjs` 里有一条守卫拿 schema 的规则反着钉这件事。
    const VALID_ID = /^[a-z0-9][a-z0-9:_-]{2,79}$/i
    const KIND_PREFIX = {
      user_requirement: 'req', user_decision: 'dec', quality_interpretation: 'qi',
      observed_fact: 'obs', proposal: 'prop', unknown: 'unk',
    }
    let serial = 0
    for (const op of parsed.patch.ops) {
      if (op.op !== 'add_item' || !op.item) continue
      const oldId = typeof op.item.id === 'string' ? op.item.id : ''
      // ① 没写 / 写坏：宿主补一个合法名字（前缀跟着 kind 走，肉眼可读）
      if (!VALID_ID.test(oldId)) {
        const prefix = KIND_PREFIX[op.item.kind] || 'item'
        serial += 1
        op.item.id = uniq(prefix + '-' + serial + suffix)
        if (oldId) map.set(oldId, op.item.id)
        renamed.push({ from: oldId, to: op.item.id, why: 'invalid-id' })
        continue
      }
      // ② 撞号：改名（原逻辑不变）
      if (!taken.has(oldId)) { taken.add(oldId); continue }
      op.item.id = uniq(oldId + suffix)
      map.set(oldId, op.item.id)
      renamed.push({ from: oldId, to: op.item.id, why: 'collision' })
    }
    // 补丁**内部**的互相引用也要跟着改（supersedes / dependsOn / appliesTo），否则改名会改坏关系
    if (map.size > 0) {
      for (const op of parsed.patch.ops) {
        if (op.op !== 'add_item' || !op.item) continue
        for (const k of ['supersedes', 'dependsOn', 'appliesTo']) {
          if (Array.isArray(op.item[k])) op.item[k] = op.item[k].map((v) => map.get(String(v)) || v)
        }
      }
    }
  } catch { /* 改名只是增强：失败就让下游按原样校验（不许因此把这一轮弄死） */ }
  return renamed
}

/**
 * **目标条目不存在的销账/更新 ⇒ 只丢那一条**（真机台账 `dryRun:fail(UNKNOWN_ITEM | no such item: …)`）。
 *
 * 解释层是按 `stateText`（只给条目正文与 rationale、**不给 id**）工作的 —— 它记不住上一轮的 id
 * 是**设计使然**（不遗传），偶尔写一个已不存在的 id 属于**可预期的模型误差**。
 * 判据是硬事实：这个 id 在当前状态里不存在 ⇒ 这条 op 无论如何都不可能成功 ⇒ 丢掉并记账，
 * 同批其它 op 照常入包（与撞 id 改名、来源引用归一、引文不成立三条同一纪律）。
 * @returns 丢弃清单（供 trace）
 */
function dropUnknownTargetOps(parsed, adapter, session) {
  const dropped = []
  try {
    if (!parsed || !parsed.ok || !parsed.patch || !Array.isArray(parsed.patch.ops)) return dropped
    const state = adapter.intentStateOf(session)
    const known = new Set(((state && state.items) || []).map((it) => String(it.id)))
    const kept = []
    for (const op of parsed.patch.ops) {
      const target = (op && op.op !== 'add_item' && op.id != null) ? String(op.id) : null
      if (target && !known.has(target)) {
        dropped.push({ id: target, kind: String(op.op), reason: '目标条目在当前状态里不存在 ⇒ 丢这一条（整轮照常成包）' })
        continue
      }
      kept.push(op)
    }
    if (dropped.length > 0) {
      parsed.patch.ops = kept
      parsed.dropped = [...(parsed.dropped || []), ...dropped]
      if (kept.length === 0) parsed.patch = null     // 全被丢光 ⇒ 这一轮等于没有补丁（交给上层走空产出处置）
    }
  } catch { /* 同 rename：增强失败不弄死整轮 */ }
  return dropped
}

/**
 * 这一轮是不是"空产出"（模型没交东西 / 交了 0 条 / 全被逐条丢弃）。
 * 只有这类才值得重试一次；**解析失败（写坏了）不重试**——那要改的是模型输出，不是再问一遍。
 * @returns 原因码 | null
 */
function emptyResultReason(parsed) {
  if (!parsed) return 'no-result'
  if (!parsed.ok) return parsed.code === 'NO_JSON' ? 'empty-completion' : null
  if (!parsed.patch) return 'zero-ops'
  if (!Array.isArray(parsed.patch.ops) || parsed.patch.ops.length === 0) return 'all-ops-dropped'
  return null
}

/**
 * 空产出兜底：**不替模型编要求**，只写一条**关于这轮原话本身**的事实，落在"待确认"类。
 *
 * 为什么宿主写这一条不算"发明内容"（与"不得新增产品目标"不冲突）：
 *   · 它陈述的只有两件可机械核对的事：**原话的逐字内容**（截断展示）与**"这一轮没被展开"**；
 *   · 它落在 `unknown`（待确认）节，界面会显示成"需要确认"，**不会**被当成"你说过的"；
 *   · 它带 `blocksAction: true`，工作 AI 会知道"这一轮的意图还没定"，而不是拿着空包硬做；
 *   · 重试后模型只要交出任何东西，这条兜底就**不会被用到**（它是最后一道，不是常规路径）。
 */
function buildEmptyFallback({ sessionId, messageId, userText }) {
  const t = String(userText == null ? '' : userText)
  const shown = t.length > 40 ? t.slice(0, 40) + '…' : t
  return {
    op: 'add_item',
    item: {
      id: 'unk-unevaluated-input',
      kind: 'unknown',
      unknownClass: 'user_preference',
      // ⚠ `blocksAction: false`：这一条**不拦下游**。原话太短可能是"寒暄/确认/致谢"，
      //   那种情况下正确行为就是"本轮没有新要求"，不该把工作 AI 拦下来问一句。
      blocksAction: false,
      text: '这一轮的原话是「' + shown + '」（' + t.length + ' 字）：解释层没有从中提取到新的要求或质量目标。'
        + '如果用户这一轮确实没有新要求（寒暄、确认、致谢），本轮就不该额外改变什么；'
        + '如果他有新要求，需要他说明具体要做什么——**不要按猜测执行**。',
      sourceRefs: [{ kind: 'model', sessionId }],
    },
  }
}
