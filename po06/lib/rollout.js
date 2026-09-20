// dsh-prompt-optimizer 0.6 · 灰度开关（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §19.5。三条硬规则：
//   ① **保守默认**：未明确配置 = 不启用（灰度不是"默认上新版"）。
//   ② **稳定可复现**：同一个会话在配置不变时永远得到同一个结论（不做随机）。
//   ③ **绝不双重拦截**：旧插件与新插件不得同时对同一条发送动手——
//      这是最容易造成"消息发两遍/被改两次"的事故，必须由代码拦住，不能靠人记得。

export const MODES = Object.freeze(['off', 'allowlist', 'all'])

/** 归一化灰度配置；非法值一律回落 `off`（保守）。 */
export function normalizeRollout(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const mode = MODES.includes(r.mode) ? r.mode : 'off'
  const sessions = Array.isArray(r.sessions)
    ? r.sessions.filter((s) => typeof s === 'string' && s.length > 0)
    : []
  return { mode, sessions, reason: MODES.includes(r.mode) ? null : 'invalid-or-missing-mode-defaults-to-off' }
}

/**
 * 该会话是否启用 0.6。
 * `allowlist` 用**精确匹配**（不做前缀/模糊匹配——模糊匹配会让"以为没开"的会话被开上）。
 */
export function isEnabledFor(rollout, sessionId) {
  const r = normalizeRollout(rollout)
  if (r.mode === 'off') return false
  if (r.mode === 'all') return true
  const sid = String(sessionId == null ? '' : sessionId)
  if (!sid) return false
  return r.sessions.includes(sid)
}

/**
 * 双重拦截守卫。
 * 旧插件在装配时存在、新插件又对同一会话启用 ⇒ **必须拒绝启用**，
 * 直到旧插件被卸载。宁可不上新版，也不要一条消息被处理两次。
 * @returns {{ok:true}} | {{ok:false, code:string, reason:string}}
 */
export function assertNoDoubleIntercept({ oldPluginActive, newEnabled }) {
  if (oldPluginActive === true && newEnabled === true) {
    return {
      ok: false,
      code: 'DOUBLE_INTERCEPT',
      reason: '旧版插件仍在装配中，且 0.6 已对该会话启用：'
        + '一条消息会被两个拦截器处理两次。请先卸载旧版，再开启 0.6。',
    }
  }
  return { ok: true }
}

/**
 * 启用闸门：把灰度、双重拦截、设置一起判断，给出**单一结论**。
 * @returns {{enabled:boolean, code:string, reason:string|null}}
 */
export function decideEnabled({ rollout, sessionId, settings, oldPluginActive }) {
  const enabled = isEnabledFor(rollout, sessionId)
  if (!enabled) {
    const r = normalizeRollout(rollout)
    return { enabled: false, code: r.mode === 'off' ? 'rollout-off' : 'session-not-in-allowlist', reason: r.reason }
  }
  if (settings && settings.enabled !== true) {
    return { enabled: false, code: 'settings-disabled', reason: '设置里未启用 0.6' }
  }
  const guard = assertNoDoubleIntercept({ oldPluginActive, newEnabled: true })
  if (!guard.ok) return { enabled: false, code: guard.code, reason: guard.reason }
  return { enabled: true, code: 'enabled', reason: null }
}

/** 人读的灰度报告（供发布说明与诊断）。 */
export function renderRolloutReport(rollout) {
  const r = normalizeRollout(rollout)
  const lines = ['# 灰度状态', '', '模式：**' + r.mode + '**']
  if (r.reason) lines.push('（' + r.reason + '）')
  if (r.mode === 'allowlist') {
    lines.push('', '允许的会话（' + r.sessions.length + ' 个）：')
    for (const s of r.sessions) lines.push('- ' + s)
    if (r.sessions.length === 0) lines.push('- （空：等同于全不启用）')
  }
  if (r.mode === 'all') lines.push('', '⚠️ 全量启用：请确认旧版插件已卸载，否则会被双重拦截。')
  return lines.join('\n')
}
