/**
 * 把工具返回值收敛成宿主要求的**无损 JSON**。
 *
 * 为什么需要（2026-10-04 真机）：`consult_task` 偶发被宿主整条拒收——
 *   `tool "consult_task" returned invalid output: value is not lossless JSON`
 * 会话台账里 38 次调用中 5 次（13%）失败，模型**一点内容都拿不到**。
 * 判据在宿主 `dsh-tools` 的 `snapshotToolValue` → `@deepseek-ai/dsh-util-values` 的 `walkJsonValue`，
 * 两版（0.1.7 / 0.2）同一行同一份代码，所以这不是版本差异、是返回值里确实带了它拒收的东西：
 *
 *   · number 非有限（NaN / ±Infinity）或 -0            —— 直接拒
 *   · undefined / function / symbol / bigint            —— 直接拒（**键不过滤**：值是 undefined 的键也算）
 *   · 非朴素原型（Date / Map / Set / 类实例）           —— 直接拒
 *   · 稀疏数组、数组带额外自有键                        —— 直接拒
 *   · 循环引用                                          —— 直接拒
 *
 * 其中最常见的是**可选链产出的 undefined 直接当字段值**（例如 `path: r.args?.path`），
 * 它只在某些可选字段缺席的那些调用里出现 ⇒ 表现为"偶发"。
 *
 * 收敛口径与 `JSON.stringify` 一致：对象里 undefined 的键**丢弃**，数组里的 undefined 变 `null`，
 * 非有限数变 `null`，Date 变 ISO 串，`-0` 变 `0`，循环引用写成 `[circular]` 而不是抛错。
 * 本函数**绝不抛**：再坏的值也要能交回宿主，否则就把"内容缺失"升级成了"工具失败"。
 *
 * @param {unknown} value - 工具准备返回的任意值。
 * @returns {unknown} 保证通过宿主无损 JSON 校验的值。
 */
export function toLosslessJson(value) {
  const seen = new WeakSet()
  const walk = (v) => {
    if (v === undefined) return undefined            // 键：丢弃；数组：下面转 null
    if (v === null) return null
    const t = typeof v
    if (t === 'string' || t === 'boolean') return v
    if (t === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null
    if (t === 'bigint') return String(v)
    if (t === 'function' || t === 'symbol') return undefined
    if (seen.has(v)) return '[circular]'
    if (v instanceof Date) { const ms = v.getTime(); return Number.isFinite(ms) ? v.toISOString() : null }
    if (Array.isArray(v)) {
      if (!Array.isArray(v)) return null
      seen.add(v)
      const out = []
      for (let i = 0; i < v.length; i++) {
        // 稀疏数组宿主也拒：空洞按 JSON 语义填 null
        const item = Object.prototype.hasOwnProperty.call(v, i) ? walk(v[i]) : undefined
        out.push(item === undefined ? null : item)
      }
      seen.delete(v)
      return out
    }
    // 非朴素原型：先按 toJSON（Date/自定义）取 JSON 视图，再退回可枚举自有键
    if (typeof v.toJSON === 'function') {
      try { const j = v.toJSON(); if (j !== v) { seen.delete(v); return walk(j) } } catch { /* 落到下面按普通对象处理 */ }
    }
    seen.add(v)
    const out = {}
    for (const k of Object.keys(v)) {
      const val = walk(v[k])
      if (val !== undefined) out[k] = val             // undefined 的键不落盘（与 JSON.stringify 一致）
    }
    seen.delete(v)
    return out
  }
  try {
    const out = walk(value)
    // 顶层不能是 undefined：宿主对 `undefined` 的判定同样是"不是无损 JSON"（工具返回空值也会被整条丢弃）。
    return out === undefined ? null : out
  } catch { return null }
}
