// P9.1 · **用户可控制的设置模型**（承接主计划 §14.1「面向用户的最小界面」）。
//
// 为什么单独一个模块（EV-0138）：在此之前 0.6 的配置面只有 `enabled` + `rollout` 两个字段，
// 而计划 §14.1 写的是"关闭、自动辅助；补充程度和自主操作预算作为高级设置分别控制"——
// 那三项**根本没有实现**，于是用户"没有档位可选"不是界面缺失，而是**设置模型缺失**。
// 界面上要显示的每一个开关，都必须先在宿主侧有一个**有名字、有值域、有默认、有保守回落**的字段。
//
// 三条纪律（都有来源，不是新发明的规矩）：
//   ① **值域外一律回落默认并如实上报**（`problems`），不静默接受也不静默丢弃——
//      静默接受会让错拼的档位像生效了一样；静默丢弃则让人以为设置保存失败了。
//   ② **写盘必须原子 + 备份 + 读回校验**（EV-0123 的配置写入纪律）：备份坏了要能看出来，
//      写进去的内容要能读回来核对，而不是"写完就当成功"。
//   ③ **未知字段不写进去**：白名单合并，避免把别人的字段顺手改坏（ADR-0036 的同一条精神）。
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, copyFileSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

/** 补充程度：它决定"把用户的话展开到多细"。 */
export const DETAIL_LEVELS = Object.freeze(['minimal', 'standard', 'detailed'])
/** 自主操作预算：它决定"0.6 自己可以做多少事"（P6 的返工/验证门按它收敛）。 */
export const BUDGET_LEVELS = Object.freeze(['minimal', 'standard', 'generous'])
/** 辅助模式：`off` = 只看不补（静默记录）；`auto` = 自动补充。 */
export const ASSIST_MODES = Object.freeze(['off', 'auto'])

// ── P10：与 0.5 对齐的四个控件（EV-0148）─────────────────────────────
// 0.5 的操作面是「档位滑杆 + 优化权限 + 上下文模式 + 读项目文件」，用户实测反馈
// 「不适应 0.6 的操控/检测模式」。这里先把**契约**补上（值域/默认/回落），引擎与界面随后接。
//
// ⚠ **档位不是第二个真相来源**：它由 assist/detail/budget 三项**推导**（见 tierOf），
// 界面上拨档位 = 一次性写这三项。这样文件里永远只有一套状态，
// 不会出现"档位写着重度、实际却是标准"这种自相矛盾（本项目最忌的"看起来生效"）。
/** 档位四档：文案按用户 2026-09-21 指定（关闭 / 轻度 / 标准 / 重度）。 */
export const TIER_LEVELS = Object.freeze(['off', 'light', 'standard', 'heavy'])
/**
 * 档位 → 三项设置的预设。
 *
 * 0.7.0：**两个维度都逐级递进**（此前 `minimal` 从未被任何档位使用、且 standard 与
 * heavy 的 detail 相同 ⇒ 用户 2026-09-24 实测"重度并不明显比轻度高"）。
 *
 *   light    = 保真：补充最少（700 字）+ 自主最少（1 问）
 *   standard = 收敛：补充中等（1200）+ 自主中等（2 问）
 *   heavy    = 连续：补充最多（2000）+ 自主最多（3 问）
 *
 * ⚠ 提高档位只放宽"产出多少字 / 问几个问题"（见 policy.js 的边界说明），
 *   **不放大用户决策权**：会改变交付形态的架构分叉在任何档位都保留给用户。
 * ⚠ `tierOf` 按三项**全等**反推，四个组合必须两两不同（settings.test.mjs 钉住）。
 */
export const TIER_PRESETS = Object.freeze({
  off: { assist: 'off', detail: 'standard', budget: 'standard' },
  light: { assist: 'auto', detail: 'minimal', budget: 'minimal' },
  standard: { assist: 'auto', detail: 'standard', budget: 'standard' },
  heavy: { assist: 'auto', detail: 'detailed', budget: 'generous' },
})
/** 优化权限（0.5 的"审查/自动"）：`review` = 优化结果先给出处与依据待你确认；`auto` = 直接生效。 */
export const PERMISSIONS = Object.freeze(['review', 'auto'])
/** 上下文模式（0.5 的"回合/全文"）：`turns` = 只读最近 N 回合；`full` = 与工作 AI 看到的一致。 */
export const HISTORY_MODES = Object.freeze(['turns', 'full'])
/** 回合数上限（0.5 是 0~10：再多容易把优化模型的上下文撑爆）。 */
export const TURNS_MIN = 0
export const TURNS_MAX = 10

/** 默认值：字段**缺失**时用它。字段**写错**时也用它，但会记一条 `problems`（见文件头 ①）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  assist: 'auto',
  detail: 'standard',
  budget: 'standard',
  model: null,          // null = 跟随会话模型（0.6 现状）；{ provider, model } = 固定解释层模型
  permission: 'auto',   // P10
  historyMode: 'turns', // P10
  turns: 6,             // P10：回合模式的窗口
  // ⚠ 读项目文件默认 **关**：它会给每轮加上"只读工具轮次"（时间与 token 都要花），
  // 而计划的不变量是"不得悄悄放大成本/自主权"。0.5 那边默认是开——要完全照搬的话
  // 把这一行改成 true 即可，属于一行决定，已在此写明以免下次又被当成"忘了"。
  readTools: false,     // P10
  // 0.7.1：内置 Bash（随本插件装配即提供）。默认 **开**——它是"内置功能"，
  // 关掉＝不把 bash 工具注册给模型（模型看不到它），不是在工具内部做软拦截。
  bash: true,
})

/** 白名单：只有这些键会被读/写。 */
export const SETTINGS_KEYS = Object.freeze([
  'assist', 'detail', 'budget', 'model',
  'permission', 'historyMode', 'turns', 'readTools',
  'bash',
])

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 归一化设置。**纯函数**：不做 IO，便于单测钉住每一条回落。
 * @returns {{settings: object, problems: Array<{key:string, kind:string, got:*, used:*}>}}
 */
export function normalizeSettings(raw) {
  const src = isPlainObject(raw) ? raw : {}
  const problems = []
  const pick = (key, allowed, dflt) => {
    const v = src[key]
    if (v === undefined) return dflt                      // 缺失：用默认，不算问题
    if (typeof v !== 'string' || !allowed.includes(v)) {
      problems.push({ key, kind: typeof v === 'string' ? 'not-in-domain' : 'wrong-type', got: v, used: dflt })
      return dflt
    }
    return v
  }
  // 档位是**糖**：合法就先铺一遍预设，随后显式的 assist/detail/budget 覆盖它。
  // 这样文件里只有一套状态（三项），不会出现"档位写重度、实际是标准"的自相矛盾。
  const tier = src.tier
  let base = DEFAULT_SETTINGS
  if (tier !== undefined) {
    if (typeof tier === 'string' && TIER_LEVELS.includes(tier)) base = { ...DEFAULT_SETTINGS, ...TIER_PRESETS[tier] }
    else problems.push({ key: 'tier', kind: typeof tier === 'string' ? 'not-in-domain' : 'wrong-type', got: tier, used: undefined })
  }
  const pickBool = (key, dflt) => {
    const v = src[key]
    if (v === undefined) return dflt
    if (typeof v !== 'boolean') { problems.push({ key, kind: 'wrong-type', got: v, used: dflt }); return dflt }
    return v
  }
  const pickInt = (key, min, max, dflt) => {
    const v = src[key]
    if (v === undefined) return dflt
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      problems.push({ key, kind: typeof v === 'number' ? 'out-of-range' : 'wrong-type', got: v, used: dflt })
      return dflt
    }
    return v
  }
  const settings = {
    assist: pick('assist', ASSIST_MODES, base.assist),
    detail: pick('detail', DETAIL_LEVELS, base.detail),
    budget: pick('budget', BUDGET_LEVELS, base.budget),
    model: null,
    permission: pick('permission', PERMISSIONS, DEFAULT_SETTINGS.permission),
    historyMode: pick('historyMode', HISTORY_MODES, DEFAULT_SETTINGS.historyMode),
    turns: pickInt('turns', TURNS_MIN, TURNS_MAX, DEFAULT_SETTINGS.turns),
    readTools: pickBool('readTools', DEFAULT_SETTINGS.readTools),
    bash: pickBool('bash', DEFAULT_SETTINGS.bash),
  }
  // model：null / 缺省 = 跟随会话；给了就必须是 { provider, model } 两个非空字符串
  const m = src.model
  if (m !== undefined && m !== null) {
    if (!isPlainObject(m) || typeof m.provider !== 'string' || !m.provider || typeof m.model !== 'string' || !m.model) {
      problems.push({ key: 'model', kind: 'not-a-route', got: m, used: null })
    } else {
      settings.model = { provider: m.provider, model: m.model }
    }
  }
  // 未知键：**只报告，不写入**（白名单合并由 mergeSettings 负责）。`tier` 是已知别名。
  for (const k of Object.keys(src)) {
    if (!SETTINGS_KEYS.includes(k) && k !== 'tier') problems.push({ key: k, kind: 'unknown-field', got: src[k], used: undefined })
  }
  return { settings, problems }
}

/**
 * 当前三项设置**对应哪一档**（纯函数）。返回 `off/light/standard/heavy`，
 * 或者 `custom`——当三项不构成任何预设时如实说"自定义"，
 * 而不是把最接近的一档显示给你（那会让你以为档位在管着它）。
 */
export function tierOf(settings) {
  const s = normalizeSettings(settings).settings
  for (const t of TIER_LEVELS) {
    const p = TIER_PRESETS[t]
    if (s.assist === p.assist && s.detail === p.detail && s.budget === p.budget) return t
  }
  return 'custom'
}

/** 合并补丁：只接受白名单键（外加档位别名 `tier`）；`undefined` 表示"不改这一项"。纯函数。 */
export function mergeSettings(current, patch) {
  const base = normalizeSettings(current).settings
  const p = isPlainObject(patch) ? patch : {}
  const next = { ...base }
  // 档位先铺预设，**显式给出的三项仍然覆盖它**（顺序就是语义，写在这里以免以后被"顺手重排"）
  const tierOk = typeof p.tier === 'string' && TIER_LEVELS.includes(p.tier)
  if (tierOk) Object.assign(next, TIER_PRESETS[p.tier])
  for (const k of SETTINGS_KEYS) if (p[k] !== undefined) next[k] = p[k]
  // 非法档位也要如实报出来（不能静默丢弃）
  const out = normalizeSettings(p.tier !== undefined && !tierOk ? { ...next, tier: p.tier } : next)
  // ⚠ 补丁里**多出来的键**也要报：界面上打错字段名时，用户会以为"保存成功了"，
  // 而实际上我们什么都没改——静默忽略等于骗人（实测这条是被用例逼出来的）。
  const extra = Object.keys(p).filter((k) => !SETTINGS_KEYS.includes(k) && k !== 'tier')
  for (const k of extra) out.problems.push({ key: k, kind: 'unknown-field', got: p[k], used: undefined })
  return out
}

/**
 * 读一份 JSON 配置：**先剥掉 UTF-8 BOM 再解析**。
 *
 * 为什么必须剥（2026-09-22 真机数据丢失的真因）：Windows 上 PowerShell 的
 * `Set-Content -Encoding utf8`、记事本另存为，都会写出**带 BOM** 的 UTF-8。`JSON.parse('\uFEFF{…}')`
 * 直接抛 ⇒ 本函数返回 null ⇒ 上层把配置当成"空的"。
 * EV-0132 当时只给 `parseEnableIntent` 补了 BOM 容错，**这条读取路径没补**，后果不是"读不懂就不启用"，
 * 而是更糟的一种：`writeSettings` 拿 `before = {}` 去合并，**写回一份只有设置项的文件** ——
 * `settingsVersion`/`enabled`/`rollout` 三个"启用意图"字段被**静默抹掉**，插件从此不被认作 0.6 自己的配置
 * （`ours=false`）⇒ 用户看到的就是"明明开着却什么都不做"（`gate:rollout-off`）。
 * 剥 BOM 只影响"开头那三个字节"，不放松任何其它校验。
 */
export function parseJsonText(text) {
  const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '')
  try { return JSON.parse(raw) } catch { return null }
}

function readJson(path) {
  try { return existsSync(path) ? parseJsonText(readFileSync(path, 'utf8')) : null } catch { return null }
}

/** 从 `path.bak-*` 里找**最近一份能解析**的备份（用于"主文件读不出来时别丢字段"）。纯 IO 辅助。 */
function newestParsableBackup(path) {
  try {
    const dir = dirname(path)
    const base = basename(path) + '.bak-'
    const cands = readdirSync(dir)
      .filter((n) => n.startsWith(base))
      .map((n) => ({ n, t: Number((/(\d+)$/.exec(n) || [])[1] || 0) }))
      .sort((a, b) => b.t - a.t)
    for (const c of cands) {
      const j = readJson(join(dir, c.n))
      if (j && typeof j === 'object' && !Array.isArray(j)) return { name: c.n, json: j }
    }
  } catch { /* 没有备份目录/读不到就算了 */ }
  return null
}

/**
 * 原子写回设置：备份 → 临时文件 + rename → **读回校验**。
 * 只改白名单里的这几项，`settingsVersion`/`enabled`/`rollout` 等**原样保留**（不越权改别人的字段）。
 * @returns {{ok:boolean, reason?:string, before:object, after:object, backup:string|null, problems:Array, path:string}}
 */
export function writeSettings({ path, patch, now = Date.now() } = {}) {
  const beforeRaw = (() => { try { return existsSync(path) ? readFileSync(path, 'utf8') : null } catch { return null } })()
  const before = readJson(path) || {}
  const corruptBefore = beforeRaw !== null && readJson(path) === null
  // ── 别把"启用意图"字段弄丢（2026-09-22 真机数据丢失事故）─────────────────────
  // `before` 为空有两种来源：文件真的不存在，或者**文件读不出来**（典型：PowerShell/记事本写出的
  // **带 BOM** 的 UTF-8 —— `JSON.parse` 直接抛）。旧实现两种都当"空配置"，于是写回一份**只有设置项**的
  // 文件：`settingsVersion`/`enabled`/`rollout` 被静默抹掉 ⇒ 插件不再被认作 0.6 自己的配置（`ours=false`）
  // ⇒ 用户看到"明明开着却什么都不做"（`gate:rollout-off`）。
  // 现在的口径：① 读不出来时**先去最近的备份里捞**这几个字段；② 无论如何都保证 `settingsVersion` 在
  // ——它只是"这份配置是 0.6 写的"这个标记，不含任何启用决定；③ 捞不到就**如实上报**（`gateRepaired`），
  // 绝不假装无事发生。
  const GATE_KEYS = ['settingsVersion', 'enabled', 'rollout']
  const gateFrom = {}
  let recoveredFrom = null
  if (Object.keys(before).length === 0) {
    const bak = newestParsableBackup(path)
    if (bak) {
      for (const k of GATE_KEYS) if (bak.json[k] !== undefined) gateFrom[k] = bak.json[k]
      if (Object.keys(gateFrom).length > 0) recoveredFrom = bak.name
    }
  } else {
    for (const k of GATE_KEYS) if (before[k] !== undefined) gateFrom[k] = before[k]
  }
  if (gateFrom.settingsVersion === undefined) gateFrom.settingsVersion = 1     // 0.6 自己的配置标记（值同 migration 的 NEW_SETTINGS_VERSION）
  const merged = mergeSettings(before, patch)
  const after = { ...gateFrom, ...before, ...merged.settings }
  const out = {
    ok: false, before, after, backup: null, problems: merged.problems, path,
    recoveredFromCorrupt: corruptBefore,
    recoveredGateFrom: recoveredFrom,          // 从哪份备份把启用意图捞回来的（null = 不需要）
    gateRepaired: corruptBefore && recoveredFrom !== null,
  }
  try {
    if (beforeRaw !== null) {
      const backup = path + '.bak-' + now
      copyFileSync(path, backup)
      // 备份必须**真的能用于回滚**，而"能用于回滚"的判据取决于原文件是什么：
      //   · 原文件可解析 ⇒ 备份也必须能解析（这样的备份才配叫回滚点）；
      //   · 原文件**读不出来**（坏 JSON）⇒ 备份就是要**逐字节留住原文**，
      //     此时要求它可解析是荒谬的——那会让用户永远无法从界面里修好一个坏配置
      //     （他只能去手改文件，而这正是我们要消灭的操作）。改成比对字节。
      const backupOk = corruptBefore
        ? readFileSync(backup, 'utf8') === beforeRaw
        : readJson(backup) !== null
      if (!backupOk) return { ...out, reason: 'backup-unusable' }
      out.backup = backup
    }
    const tmp = path + '.tmp-' + now
    writeFileSync(tmp, JSON.stringify(after, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
  } catch (e) {
    try { rmSync(path + '.tmp-' + now, { force: true }) } catch { /* best effort */ }
    return { ...out, reason: 'write-failed:' + String((e && e.message) || e) }
  }
  // 读回校验：写进去的东西必须能读回来，且白名单项与我们算出来的一致
  const back = readJson(path)
  if (back === null) return { ...out, reason: 'readback-unparsable' }
  const norm = normalizeSettings(back).settings
  for (const k of SETTINGS_KEYS) {
    const a = JSON.stringify(norm[k]); const b = JSON.stringify(merged.settings[k])
    if (a !== b) return { ...out, reason: 'readback-mismatch:' + k, after: back }
  }
  return { ...out, ok: true, after: back }
}

/** 给界面看的一行摘要（§14.1：不把内部 schema/hash 堆进主流程）。 */
export function describeSettings(settings) {
  const s = normalizeSettings(settings).settings
  const assist = s.assist === 'off' ? '只记录、不补充' : '自动辅助'
  const detail = { minimal: '最少补充', standard: '标准补充', detailed: '尽量补全' }[s.detail]
  const budget = { minimal: '只做必要的', standard: '标准', generous: '允许更多自主处理' }[s.budget]
  const model = s.model ? s.model.provider + ' / ' + s.model.model : '跟随会话模型'
  return {
    assist, detail, budget, model,
    tier: tierOf(s),
    tierLabel: { off: '关闭', light: '轻度', standard: '标准', heavy: '重度', custom: '自定义' }[tierOf(s)],
    permission: { review: '审查', auto: '自动' }[s.permission],
    historyMode: { turns: '回合', full: '全文' }[s.historyMode],
    turns: s.turns,
    readTools: s.readTools,
    readToolsLabel: s.readTools ? '开（会读项目文件后再写要求）' : '关（只依据你的话与上下文）',
  }
}
