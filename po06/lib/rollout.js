// dsh-prompt-optimizer 0.6 · 灰度开关（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §19.5。三条硬规则：
//   ① **保守默认**：未明确配置 = 不启用（灰度不是"默认上新版"）。
//   ② **稳定可复现**：同一个会话在配置不变时永远得到同一个结论（不做随机）。
//   ③ **绝不双重拦截**：旧插件与新插件不得同时对同一条发送动手——
//      这是最容易造成"消息发两遍/被改两次"的事故，必须由代码拦住，不能靠人记得。

export const MODES = Object.freeze(['off', 'allowlist', 'all'])

/** 归一化灰度配置；**值非法或缺失**时回落 `off`，但会记下"这是回落，不是用户说的 off"。 */
export function normalizeRollout(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const valid = MODES.includes(r.mode)
  const mode = valid ? r.mode : 'off'
  const sessions = Array.isArray(r.sessions)
    ? r.sessions.filter((s) => typeof s === 'string' && s.length > 0)
    : []
  // ⚠ 归一化必须**幂等**：本函数会被调用不止一次（parseEnableIntent → decideEnabled → isEnabledFor），
  //   而"回落来的 off"与"用户显式写的 off"在 `mode` 上长得一模一样。若这里每次都按"mode 合法"
  //   把 `defaulted` 清成 false，第二次归一化就会把回落**误判成用户的决定**（`rollout-off` 就是这么来的）。
  const defaulted = valid ? (r.mode === 'off' && r.defaulted === true) : true
  return {
    mode, sessions, defaulted,
    reason: defaulted ? 'invalid-or-missing-mode-defaults-to-off' : null,
  }
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
 *
 * ⚠ `rollout` **缺失或写错**时怎么办（2026-09-22 用户要求查清 `gate:rollout-off`）：
 *   旧行为是"回落 off ⇒ 一律不启用"，于是**用户明明写了 `enabled: true`，插件却什么都不做**，
 *   而界面上的状态又是"已启用"——正是本项目最忌的那种"安静地不做事"（EV-0078）。
 *   现在把两种情况**分开**：
 *     · 用户**显式**写了 `rollout:{mode:"off"}` ⇒ 那是决定，照旧不启用（理由码 `rollout-off`）；
 *     · `rollout` 字段**没写**或**值不认识**（回落而来）⇒ 以用户显式的 `enabled:true` 为准，
 *       **按 all 启用**，并如实带上 `note`（界面/台账能看到"这是回落来的"）。
 *   为什么这不是"默认打开"：本配置必须带 0.6 自己的 `settingsVersion` 标记才算数（见 parseEnableIntent），
 *   而 `enabled:true` 只能是用户显式写的——把"显式启用 + 没写灰度"读成"用户要开"，
 *   比读成"用户要关"更贴近他的本意；双重拦截守卫仍然在后面独立把关（不受此处影响）。
 * @returns {{enabled:boolean, code:string, reason:string|null, note?:string|null}}
 */
export function decideEnabled({ rollout, sessionId, settings, oldPluginActive }) {
  let enabled = isEnabledFor(rollout, sessionId)
  let rolloutNote = null
  if (!enabled) {
    const r = normalizeRollout(rollout)
    const explicitOff = r.mode === 'off' && r.defaulted !== true
    if (r.mode === 'off' && r.defaulted === true && settings && settings.enabled === true) {
      // 回落而来的 off + 用户显式 enabled:true ⇒ 按 all 处理（并说清楚）
      enabled = true
      rolloutNote = 'rollout 缺失或值不认识，已按 "all" 处理（用户显式 enabled:true）'
    } else {
      return {
        enabled: false,
        code: r.mode === 'off' ? 'rollout-off' : 'session-not-in-allowlist',
        reason: explicitOff && !r.reason ? '灰度配置显式设为 off（用户的选择）' : r.reason,
        note: r.defaulted === true ? 'rollout 字段缺失或不合法；且设置里没有显式 enabled:true ⇒ 保守不启用' : null,
      }
    }
  }
  if (settings && settings.enabled !== true) {
    return { enabled: false, code: 'settings-disabled', reason: '设置里未启用 0.6' }
  }
  const guard = assertNoDoubleIntercept({ oldPluginActive, newEnabled: true })
  if (!guard.ok) return { enabled: false, code: guard.code, reason: guard.reason }
  return { enabled: true, code: 'enabled', reason: null, note: rolloutNote }
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
