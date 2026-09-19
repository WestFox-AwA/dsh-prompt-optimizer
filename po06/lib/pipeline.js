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
    userText: text,
    sessionId,
    baseRevision: base.revision,
    baseInputRevision: base.lastInputRevision,
    causeId: 'interpret:' + input.messageId,
  })
  step('parse', { ok: parsed.ok, code: parsed.code || null, reason: parsed.reason || null, warnings: parsed.warnings || [] })
  if (!parsed.ok) return finish(trace, base, null, 'parse-rejected')

  // 4) 无操作：不改状态，但仍重新编译（可能只是没有新增）
  if (!parsed.patch) return finish(trace, base, null, 'noop', adapter, session)

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
