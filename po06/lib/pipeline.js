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
    if (!init.ok) return finish(trace, null, null, 'init-failed')
  }

  // 1) 记录用户输入 —— 这一步使**一切在它之前产生的候选补丁**失效
  const ui = adapter.commitUserInput(session, { messageId: input.messageId })
  step('recordInput', { ok: ui.ok, revision: ui.state ? ui.state.revision : null, lastInputRevision: ui.state ? ui.state.lastInputRevision : null })
  if (!ui.ok) return finish(trace, null, null, 'record-input-failed')

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
  let raw = null
  try {
    raw = await input.interpret({
      userText: text,
      state: base,
      sessionId,
      messageId: String(input.messageId),
      observations: input.observations,
    })
  } catch (e) {
    step('interpret', { ok: false, error: String((e && e.message) || e) })
    return finish(trace, base, null, 'interpret-threw')
  }
  step('interpret', { ok: true, chars: String(raw == null ? '' : raw).length })

  // 3) 解析 + 机械校验（逐字引文 / kind 白名单 / op 白名单 / 数量上限）
  const parsed = parseInterpreterOutput(raw, {
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
  step('parse', {
    ok: parsed.ok, code: parsed.code || null, reason: parsed.reason || null, warnings: parsed.warnings || [],
    // 逐条丢弃要留痕（用户 2026-09-21：绝不允许"看着成了、其实少了一条"）
    dropped: parsed.dropped || [],
  })
  if (!parsed.ok) return finish(trace, base, null, 'parse-rejected')

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

  // 6) reducer 权威校验（dry run，针对**当前**状态）
  const dry = dryRun(parsed.patch, current, reduce)
  step('dryRun', { ok: dry.ok, code: dry.code || null, reason: dry.reason || null })
  if (!dry.ok) return finish(trace, current, null, 'reducer-rejected', adapter, session)

  // 7) 提交（CAS → append 完整新状态）
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
