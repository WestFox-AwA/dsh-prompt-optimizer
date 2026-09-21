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
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, copyFileSync } from 'node:fs'

/** 补充程度：它决定"把用户的话展开到多细"。 */
export const DETAIL_LEVELS = Object.freeze(['minimal', 'standard', 'detailed'])
/** 自主操作预算：它决定"0.6 自己可以做多少事"（P6 的返工/验证门按它收敛）。 */
export const BUDGET_LEVELS = Object.freeze(['minimal', 'standard', 'generous'])
/** 辅助模式：`off` = 只看不补（静默记录）；`auto` = 自动补充。 */
export const ASSIST_MODES = Object.freeze(['off', 'auto'])

/** 默认值：字段**缺失**时用它。字段**写错**时也用它，但会记一条 `problems`（见文件头 ①）。 */
export const DEFAULT_SETTINGS = Object.freeze({
  assist: 'auto',
  detail: 'standard',
  budget: 'standard',
  model: null,          // null = 跟随会话模型（0.6 现状）；{ provider, model } = 固定解释层模型
})

/** 白名单：只有这些键会被读/写。 */
export const SETTINGS_KEYS = Object.freeze(['assist', 'detail', 'budget', 'model'])

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
  const settings = {
    assist: pick('assist', ASSIST_MODES, DEFAULT_SETTINGS.assist),
    detail: pick('detail', DETAIL_LEVELS, DEFAULT_SETTINGS.detail),
    budget: pick('budget', BUDGET_LEVELS, DEFAULT_SETTINGS.budget),
    model: null,
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
  // 未知键：**只报告，不写入**（白名单合并由 mergeSettings 负责）
  for (const k of Object.keys(src)) {
    if (!SETTINGS_KEYS.includes(k)) problems.push({ key: k, kind: 'unknown-field', got: src[k], used: undefined })
  }
  return { settings, problems }
}

/** 合并补丁：只接受白名单键；`undefined` 表示"不改这一项"。纯函数。 */
export function mergeSettings(current, patch) {
  const base = normalizeSettings(current).settings
  const p = isPlainObject(patch) ? patch : {}
  const next = { ...base }
  for (const k of SETTINGS_KEYS) if (p[k] !== undefined) next[k] = p[k]
  const out = normalizeSettings(next)
  // ⚠ 补丁里**多出来的键**也要报：界面上打错字段名时，用户会以为"保存成功了"，
  // 而实际上我们什么都没改——静默忽略等于骗人（实测这条是被用例逼出来的）。
  const extra = Object.keys(p).filter((k) => !SETTINGS_KEYS.includes(k))
  for (const k of extra) out.problems.push({ key: k, kind: 'unknown-field', got: p[k], used: undefined })
  return out
}

function readJson(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null }
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
  const merged = mergeSettings(before, patch)
  const after = { ...before, ...merged.settings }
  const out = { ok: false, before, after, backup: null, problems: merged.problems, path, recoveredFromCorrupt: corruptBefore }
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
  return { assist, detail, budget, model }
}
