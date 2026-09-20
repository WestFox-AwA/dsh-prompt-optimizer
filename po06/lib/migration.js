// dsh-prompt-optimizer 0.6 · 配置迁移（纯函数：无 IO、无 LLM、无宿主）
//
// 依据 PLAN-0.6.md §19.1。三条硬规则：
//   ① **不做机械映射**。旧档位把"质量 / 预算 / 工具权限 / 篇幅"混在一个字段里，
//      直接映射到新档位等于悄悄改变语义。每一步迁移都要给出**解释**，且**可逆**。
//   ② **旧生成文本不得导入为已确认需求**。那些文本没有 source/revision 信息，
//      无法证明是用户说的；一律标 `legacy-unverified`，只作历史引用。
//   ③ **装不下的就明说**。无法映射的项进 `unmappable` 并要求用户选择，不猜。

export const NEW_SETTINGS_VERSION = 1

/** 旧档位 → 新设置的**显式**映射表；`note` 是给人看的解释，不是等价声明。 */
export const TIER_MAP = Object.freeze({
  off: {
    enabled: false,
    note: '旧「关闭」与新「不启用」**等价**：两者都表示不介入。可直接映射，且完全可逆。',
    reversible: true,
  },
  basic: {
    enabled: true,
    qualityExpansion: 'language-only',
    note: '旧「普通」只做语言层整理。新设置里对应「只整理语言、不做质量展开」——'
      + '**不等价于**旧的整档行为，旧档还包含长度上限等未迁移条款。',
    reversible: 'partial',
  },
  advanced: {
    enabled: true,
    qualityExpansion: 'on-demand',
    note: '旧「高级」会按需读项目文件并补对象/结果/边界。新设置对应「按需质量展开」；'
      + '**读文件的权限属于会话策略**，不由本项决定——需要用户在会话里确认。',
    reversible: 'partial',
  },
  extreme: {
    enabled: true,
    qualityExpansion: 'deep',
    note: '旧「极端」深读交叉核对并允许正向丰富。新设置对应「深展开」；'
      + '旧的"每条改动带出处"在 0.6 里是**常开**的审计要求，不再是档位差异。',
    reversible: 'partial',
  },
})

/** 旧设置里**无法**映射、必须让用户决定的项。 */
export const UNMAPPABLE = Object.freeze([
  { key: 'permission', reason: '旧「优化权限」管的是"优化结果是否自动发出"；'
      + '0.6 里"能不能发"由三级投递与授权决定，含义不同，需用户重选。' },
  { key: 'delivery', reason: '旧「下游形态」（ptc/chat）是给旧策略用的投影；0.6 不按形态投影，需用户确认是否仍要该偏好。' },
  { key: 'reasoningEffort', reason: '旧思考强度作用于"优化器自己"；0.6 需要用户确认优化模型与工作模型各自的强度。' },
  { key: 'turns', reason: '旧「回合数」决定喂多少历史给优化器；0.6 的上下文由意图状态与证据决定，历史只作引用。' },
  { key: 'historyMode', reason: '同上：全文/回合的开关在 0.6 里没有对应物。' },
  { key: 'fullOn', reason: '旧「全文模式」开关决定把整份会话投影喂给优化器；0.6 的上下文由意图状态与证据清单决定，没有对应开关，需用户确认是否仍要该行为。' },
  { key: 'readTools', reason: '旧「只读查证」开关在 0.6 里属于会话权限范围，需按会话确认。' },
])

/** 旧设置里**保留**但语义已变的项。 */
export const CARRY_OVER = Object.freeze([
  { key: 'model', note: '优化模型选择保留；但 0.6 的实发参数会如实记录，未声明档位时不发。' },
  { key: 'ui', note: '弹层位置与尺寸保留（纯外观，无语义）。' },
])

/**
 * 规划一次迁移。
 * @param oldState 旧 `prompt-optimizer.json`（或 null）
 * @returns 计划：每步含 from/to/note/reversible；另有 unmappable / carryOver / legacyState
 */
export function planMigration(oldState) {
  const plan = {
    fromVersion: null,
    toVersion: NEW_SETTINGS_VERSION,
    steps: [],
    unmappable: [],
    carryOver: [],
    legacyState: null,
    warnings: [],
    dryRun: true,
    /** ADR-0036：计划**没处理**、但会被原样写回的旧键（dry-run 报告也要能看到）。 */
    preservedLegacyKeys: [],
    oldKeys: [],
  }
  if (!oldState || typeof oldState !== 'object') {
    plan.warnings.push('没有可迁移的旧配置（按全新安装处理）')
    return annotatePreserved(plan, null)
  }
  plan.fromVersion = typeof oldState.revision === 'number' ? ('revision:' + oldState.revision) : 'unknown'

  // ① 档位
  const tier = typeof oldState.tier === 'string' ? oldState.tier : null
  if (tier === null) {
    plan.unmappable.push({ key: 'tier', reason: '旧配置里没有档位字段，需用户选择是否启用' })
  } else if (!TIER_MAP[tier]) {
    plan.unmappable.push({ key: 'tier', value: tier, reason: '未知档位取值，不猜' })
  } else {
    const m = TIER_MAP[tier]
    plan.steps.push({
      key: 'enabled', from: 'tier=' + tier, to: m.enabled,
      note: m.note, reversible: m.reversible,
    })
    if (m.qualityExpansion) {
      plan.steps.push({
        key: 'qualityExpansion', from: 'tier=' + tier, to: m.qualityExpansion,
        note: '由档位推导，非等价声明。', reversible: m.reversible,
      })
    }
  }

  // ② 无法映射的项：如实列出，不猜
  for (const u of UNMAPPABLE) {
    if (oldState[u.key] !== undefined) {
      plan.unmappable.push({ key: u.key, value: summarize(oldState[u.key]), reason: u.reason })
    }
  }

  // ③ 保留项
  for (const c of CARRY_OVER) {
    if (oldState[c.key] !== undefined) {
      plan.carryOver.push({ key: c.key, value: summarize(oldState[c.key]), note: c.note })
    }
  }

  // ④ 旧生成文本 / 会话级历史：**不得**导入为已确认需求
  const perSession = oldState.perSession && typeof oldState.perSession === 'object' ? oldState.perSession : null
  if (perSession) {
    const ids = Object.keys(perSession)
    plan.legacyState = {
      sessions: ids.length,
      disposition: 'legacy-unverified',
      note: '旧配置里只有"每会话档位"，不含任何用户原话或来源信息；'
        + '**一律不得**导入为已确认要求。保留作历史引用，需要时由用户在会话里重新表达。',
      sample: ids.slice(0, 3),
    }
  }
  if (oldState.strategy !== undefined) {
    plan.unmappable.push({
      key: 'strategy', value: summarize(oldState.strategy),
      reason: '旧策略选择器（v6/v5/…）在 0.6 里没有对应物：策略不再是可拨动的开关。',
    })
  }
  if (oldState.outcomes !== undefined) {
    plan.legacyState = plan.legacyState || { sessions: 0, disposition: 'legacy-unverified', note: '' }
    plan.legacyState.outcomes = summarize(oldState.outcomes)
    plan.legacyState.note += ' 旧"一次交付可用率"记录仅作历史统计，不进入意图状态。'
  }

  return annotatePreserved(plan, oldState)
}

function summarize(v) {
  try {
    const s = JSON.stringify(v)
    return s && s.length > 60 ? s.slice(0, 57) + '…' : s
  } catch { return String(v) }
}

/**
 * 应用迁移，产出新设置。**不含任何需要用户决定的值**——那些必须在 `choices` 里给齐，
 * 缺了就抛错（不猜）。
 * @param plan   planMigration 的结果
 * @param choices { permission?, delivery?, reasoningEffort?, turns?, historyMode?, fullOn?, readTools? }
 * @param oldState
 */
export function applyMigration(plan, choices, oldState) {
  const missing = []
  for (const u of plan.unmappable) {
    if (u.key === 'tier' || u.key === 'strategy') continue   // tier 缺席另有默认；strategy 无需选择
    if (!choices || choices[u.key] === undefined) missing.push(u.key)
  }
  if (missing.length > 0) {
    throw new Error('migration needs explicit user choices for: ' + missing.join(', ')
      + '（不猜：这些项在 0.6 里语义不同，不得沿用旧值冒充已决定）')
  }
  const settings = { settingsVersion: NEW_SETTINGS_VERSION, enabled: false, qualityExpansion: null }
  for (const s of plan.steps) settings[s.key] = s.to
  for (const c of plan.carryOver) settings[c.key] = oldState[c.key]
  for (const u of plan.unmappable) {
    if (u.key === 'tier' || u.key === 'strategy') continue
    settings[u.key] = choices[u.key]
  }
  settings.migratedFrom = plan.fromVersion
  settings.legacyState = plan.legacyState

  // ── ADR-0036：**不得删除自己不认识的旧键** ──────────────────────────
  // "不映射"（语义变了，不沿用旧值）与"删除"是两件不同的事。
  // 旧版本可能**仍在运行**、仍按**顶层键**读取这些字段：实测真实配置会被删掉
  // `perSession`/`revision`/`outcomes`/`tier`/`strategy`/`updatedAt` 六个顶层键（EV-0062），
  // 而其中 `perSession`/`revision` 是 0.5.x 的运行时状态——不是 0.6 的东西，却一并没了。
  // 把值挪进 `legacyState` **不算**保留：旧插件读的是顶层。
  const preserved = []
  for (const k of Object.keys(oldState || {})) {
    if (Object.prototype.hasOwnProperty.call(settings, k)) continue   // 已被新值/映射结果占用
    settings[k] = oldState[k]
    preserved.push(k)
  }
  if (preserved.length > 0) settings.preservedLegacyKeys = preserved
  return settings
}

/**
 * 计划**没有明确处理**、但因 ADR-0036 会被原样保留的旧键清单。
 * 与 `carryOver` 分开计：carryOver 是计划里写明的，这里要暴露的是"计划外的保留"。
 * `next` 可省略（dry-run 阶段还没有新配置）；给出时只用于确认键确实还在。
 */
export function preservedVerbatimKeys(plan, oldState, next) {
  const handled = new Set([
    ...(plan.steps || []).map((s) => s.key),
    ...(plan.unmappable || []).filter((u) => u.key !== 'tier' && u.key !== 'strategy').map((u) => u.key),
    ...(plan.carryOver || []).map((c) => c.key),
  ])
  return Object.keys(oldState || {})
    .filter((k) => !handled.has(k))
    .filter((k) => next === undefined || Object.prototype.hasOwnProperty.call(next || {}, k))
    .sort()
}

/** 在计划上登记"计划外保留"清单（planMigration 收尾处调用）。 */
function annotatePreserved(plan, oldState) {
  plan.oldKeys = Object.keys(oldState || {}).sort()
  plan.preservedLegacyKeys = preservedVerbatimKeys(plan, oldState)
  return plan
}

/**
 * 回滚：从备份恢复旧配置。
 * 只做一件事——**原样还原备份**，绝不让旧版本去理解新字段（PLAN §19.1）。
 */
export function rollback(backup) {
  if (!backup || typeof backup !== 'object') {
    return { ok: false, reason: 'no-backup' }
  }
  return { ok: true, restored: JSON.parse(JSON.stringify(backup)) }
}

/**
 * **0.5.x 持久化的键清单**——逐字抄自其 `savePluginState()` 里构造 `next` 的那个字面量
 * （`dsh-prompt-optimizer-0.5.2-beta.1/package/lib/index.js:2315-2332`，见 EV-0065）。
 *
 * 为什么要把它写进 0.6 的代码：那个函数**每次保存都重建整个对象**
 * （`const next = { …15 个字段… }` 然后 `writeFileSync(STATE_FILE, …)`），
 * 于是**凡不在这份清单里的键，都会被旧版的一次保存静默抹掉**。
 * 0.6 的启用标记（`settingsVersion` 等）恰好都不在清单里
 * ⇒ **旧版存一次，0.6 就悄悄退回"未启用"**。
 *
 * ⚠ 这是**跨版本契约的硬编码**：0.5.x 若改了持久化字段，这里必须同步核对。
 */
export const LEGACY_STATE_KEYS = Object.freeze([
  'tier', 'permission', 'model', 'reasoningEffort', 'readTools', 'delivery', 'strategy',
  'ui', 'turns', 'historyMode', 'fullOn', 'perSession', 'outcomes', 'revision', 'updatedAt',
])

/** 模拟"旧版保存了一次"之后，文件里还剩什么。 */
export function projectThroughLegacyWriter(state) {
  const out = {}
  for (const k of LEGACY_STATE_KEYS) {
    if (state && Object.prototype.hasOwnProperty.call(state, k)) out[k] = state[k]
  }
  return out
}

/** 旧版保存一次会抹掉哪些键（含 0.6 的启用标记）。 */
export function legacySaveWouldDrop(state) {
  const after = projectThroughLegacyWriter(state)
  const dropped = Object.keys(state || {}).filter((k) => !(k in after))
  return {
    after,
    dropped,
    dropsEnablementMarkers: dropped.includes('settingsVersion'),
    note: '旧版每次保存都重建对象；dropped 里的键会被静默抹掉。'
      + '若 dropsEnablementMarkers 为真，则旧版存一次之后 0.6 会退回"未启用"（配置被认成 not-a-0.6-config）。',
  }
}

/** 迁移报告（给人看；每步都带解释，且**不声称等价**）。 */
export function renderMigrationReport(plan) {
  const lines = []
  lines.push('# 配置迁移报告（dry-run：' + (plan.dryRun ? '是' : '否') + '）')
  lines.push('')
  lines.push('源：' + String(plan.fromVersion) + ' → 目标 settingsVersion ' + plan.toVersion)
  lines.push('')
  if (plan.steps.length > 0) {
    lines.push('## 已映射')
    for (const s of plan.steps) {
      lines.push('- `' + s.key + '`：' + String(s.from) + ' → ' + String(s.to) + '（可逆性：' + s.reversible + '）')
      lines.push('  ' + s.note)
    }
    lines.push('')
  }
  if (plan.unmappable.length > 0) {
    lines.push('## 无法映射，需要你决定')
    for (const u of plan.unmappable) {
      lines.push('- `' + u.key + '`' + (u.value !== undefined ? '（旧值 ' + u.value + '）' : '') + '：' + u.reason)
    }
    lines.push('')
  }
  if (plan.carryOver.length > 0) {
    lines.push('## 原样保留')
    for (const c of plan.carryOver) lines.push('- `' + c.key + '`：' + c.note)
    lines.push('')
  }
  if (plan.legacyState) {
    lines.push('## 旧状态处置')
    lines.push('- 处置：**' + plan.legacyState.disposition + '**')
    lines.push('  ' + plan.legacyState.note)
    lines.push('')
  }
  // ADR-0036：把"计划外但会被原样保留的旧键"摆到明面上——
  // 让"有没有丢东西"变成可核对的一行，而不是要人去比对 JSON。
  if (Array.isArray(plan.preservedLegacyKeys) && plan.preservedLegacyKeys.length > 0) {
    lines.push('## 原样保留（计划外，ADR-0036）')
    lines.push('- 本迁移**不删除**自己不认识的旧键，以下 ' + plan.preservedLegacyKeys.length
      + ' 个将按原值写回：`' + plan.preservedLegacyKeys.join('`、`') + '`')
    lines.push('  理由：旧版本可能仍在运行并按**顶层键**读取这些字段；'
      + '把它们挪进 `legacyState` 不算保留。')
    lines.push('')
  }
  if (plan.warnings.length > 0) {
    lines.push('## 提示')
    for (const w of plan.warnings) lines.push('- ' + w)
  }
  return lines.join('\n')
}
