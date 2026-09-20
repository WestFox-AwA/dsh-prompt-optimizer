// dsh-prompt-optimizer 0.6 · **装配期启用闸门**
//
// 为什么需要它：0.6 的"拦截"就是向装配上下文贡献意图包（`systemPrompt.context`）。
// 在此之前，那段贡献是**无条件**注册的——灰度、设置、双重拦截守卫都只在自检里跑过，
// **没有接到装配路径上**（RELEASE-CHECKLIST 的 A10/A12 缺口）。
// 一个只在自检里生效的守卫，等于没有守卫。
//
// 三条设计约束，逐条都有原因：
//
// ① **默认关，异步解析**：`systemPrompt.context` 的 `text(ctx)` 是**同步**的，
//    而旧插件探测是**异步**的（要读装配结果）。所以初始状态只能是"未决"，
//    未决期间按**保守方向**处理 = 不启用。
//    理由（ADR-0031/0033）：误报的代价是"新版暂时不启用"，
//    漏报的代价是"一条消息被两个拦截器处理两次"——两者不对价。
//
// ② **按 agent 缓存，判定懒触发**：灰度是 per-session 的，旧插件探测依赖
//    per-agent 作用域（ADR-0016/EV-0016）。在 `apply()` 时还没有 agent，
//    所以判定必须等到某个 agent 真的来要上下文时才做。
//
// ③ **绝不把旧配置当成"已启用 0.6"**：本机 `prompt-optimizer.json` 是 **0.5.x 写的**，
//    里面同样有 `enabled: true`。若照着它启用 0.6，就等于让**旧版的启用状态冒充新版的用户决定**
//    ——正是 ADR-0030 禁止的机械映射。因此只有带 0.6 自己的 `settingsVersion` 标记的配置才算数。

import { normalizeRollout, decideEnabled } from './rollout.js'

/** 未决状态的统一表示：**不启用**。 */
export const PENDING = Object.freeze({
  status: 'pending', enabled: false, code: 'decision-pending',
  reason: '启用判定尚未完成：按保守方向不启用（宁可不生效，也不双重拦截）',
})

/**
 * 启用判定缓存：`agentId -> 结论`。同步读、异步算、幂等触发。
 *
 * ⚠ **判定必须有保质期**。最初的实现是"判一次就永久信"（`if (cur && cur.status !== 'error') return cur`
 * 而 `status` 永远不会是 `'error'`），于是双重拦截守卫只在该 agent 第一次要上下文时成立过一次。
 * 插件是**可以运行时注入**的：某个会话在"旧插件不在装"时被合法启用，之后旧插件被注入进来，
 * 缓存里那句 `enabled: true` 会让**两个拦截器同时生效**——正是这个守卫要防的事故。
 *
 * 保质期到点后怎么办，方向是**确定的**：按未判定处理（=不启用）。
 * 理由与本模块一致——"少生效一轮"的代价远小于"双重拦截"，
 * 因此宁可让拦截短暂停下，也不让一句过期结论继续放行。
 * 代价是每个 TTL 会有一次"空转"（该轮不带意图包），所以默认取 5 分钟，
 * 并额外提供 `invalidate()` 供**已知发生变化**时立刻撤销。
 *
 * @param decide (agentId) => Promise<{enabled:boolean, code:string, reason:string|null}>
 * @param ttlMs  判定保质期；<=0 表示每次都重新判定
 * @param now    注入时钟（测试用）
 */
export function createEnableGate({ decide, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map()
  const listeners = []
  const isStale = (e) => Boolean(e) && e.status === 'done' && (ttlMs <= 0 || (now() - (e.at || 0)) >= ttlMs)

  function resolve(sid) {
    entries.set(sid, { status: 'resolving', enabled: false, code: 'decision-pending', reason: '判定中', at: now() })
    Promise.resolve()
      .then(() => decide(sid))
      .then((d) => {
        const done = {
          status: 'done',
          enabled: d && d.enabled === true,
          code: (d && d.code) || (d && d.enabled ? 'enabled' : 'unknown'),
          reason: (d && d.reason) || null,
          // 诊断明细原样带过：`old-plugin-unknown` 这类保守拒绝必须说得清
          // **是哪一项没拿到**（缺服务 / 缺 agent / assemble 抛错），
          // 否则"装了却什么都不做"无法归因（EV-0078/0079）。
          probe: (d && d.probe) || null,
          at: now(),
        }
        entries.set(sid, done)
        for (const fn of listeners) { try { fn(sid, done) } catch { /* 通知失败不影响判定 */ } }
      })
      .catch((e) => {
        // 判定本身出错也按**保守方向**：不启用。错误原文留档，不吞。
        entries.set(sid, {
          status: 'done', enabled: false, code: 'decision-error',
          reason: String((e && e.message) || e), at: now(),
        })
      })
    return entries.get(sid)
  }

  function ensure(agentId) {
    const sid = String(agentId == null ? '' : agentId)
    if (!sid || typeof decide !== 'function') return PENDING
    const cur = entries.get(sid)
    if (cur && cur.status === 'resolving') return cur         // 判定中：不重复触发
    if (cur && cur.status === 'done' && !isStale(cur)) return cur   // 新鲜：直接用
    return resolve(sid)                                       // 没判过 / 已过期 → 重判
  }

  return {
    ensure,
    /**
     * 同步读。**过期即按未判定处理**（=不启用）：
     * 过期结论不能在重新判定完成前继续放行，否则上面那段说的事故窗口就回来了。
     */
    statusFor(agentId) {
      const sid = String(agentId == null ? '' : agentId)
      const e = sid ? entries.get(sid) : null
      if (!e) return PENDING
      if (isStale(e)) return { ...PENDING, reason: '判定已过期（TTL ' + ttlMs + 'ms）：重新判定完成前按保守方向不启用' }
      return e
    },
    /** 明确已知发生变化时立刻撤销（比等 TTL 精确）。 */
    invalidate(agentId) {
      const sid = String(agentId == null ? '' : agentId)
      if (sid) entries.delete(sid)
    },
    invalidateAll() { entries.clear() },
    /** 自检/测试注入结论（不经过 decide）。 */
    set(agentId, decision) {
      const sid = String(agentId == null ? '' : agentId)
      if (!sid) return
      entries.set(sid, {
        status: 'done', enabled: decision && decision.enabled === true,
        code: (decision && decision.code) || 'injected', reason: (decision && decision.reason) || null,
        at: Date.now(),
      })
    },
    forget(agentId) { entries.delete(String(agentId == null ? '' : agentId)) },
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn) },
    snapshot() {
      const out = {}
      for (const [k, v] of entries) out[k] = { ...v }
      return out
    },
    size() { return entries.size },
  }
}

/**
 * 解析配置文件内容 → 启用意图。**纯函数**（IO 留在宿主入口）。
 *
 * 任何解析失败、字段缺失、类型不对，一律回落到 `{enabled:false, rollout:'off'}`：
 * 启用是"必须显式成立"的事，不是"默认成立"的事。
 */
export function parseEnableIntent(text) {
  const conservative = {
    ok: false, ours: false, reason: 'not-enabled',
    settings: { enabled: false }, rollout: { mode: 'off' },
  }
  let cfg = null
  try { cfg = JSON.parse(String(text == null ? '' : text)) } catch { return { ...conservative, reason: 'config-unparsable' } }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ...conservative, reason: 'config-not-an-object' }

  // ③ 只有带 0.6 标记的配置才算"我们自己的配置"
  const marker = cfg.settingsVersion
  const ours = typeof marker === 'string' || typeof marker === 'number'
  if (!ours) return { ...conservative, reason: 'not-a-0.6-config' }

  return {
    ok: true,
    ours: true,
    reason: null,
    settings: { enabled: cfg.enabled === true },
    rollout: normalizeRollout(cfg.rollout),
  }
}

/**
 * 把旧插件探测结果映射成**三态**：`true` / `false` / `null`（＝不知道）。
 *
 * ⚠ 这里有个必须绕开的坑：`mergeOldPluginSignals()` 在**拿不到作用域**时
 * 也会返回 `active: false`（它把"没命中"和"没法判"合并成了一个字段）。
 * 若照着 `active === false` 就认定"旧插件不在装"，守卫会在**最需要它的场景下失效**。
 * 只有 `confidence === 'runtime'`（真的读到装配结果、且没有旧上下文）才配得上"确实不在装"。
 */
export function toActiveTriState(signal) {
  if (!signal || typeof signal !== 'object') return null
  if (signal.active === true) return true
  return signal.confidence === 'runtime' ? false : null
}

/**
 * 把「配置 + 旧插件事实」合成一次启用判定。纯函数，便于单测。
 * @param intent  parseEnableIntent 的结果
 * @param oldPluginActive  旧插件是否仍在装配（true/false/**null=拿不到作用域**）
 */
export function resolveEnableDecision({ intent, sessionId, oldPluginActive }) {
  const base = intent && intent.ok ? intent : { settings: { enabled: false }, rollout: { mode: 'off' } }
  // 拿不到作用域时**不得**当作"不在装"（ADR-0033）：直接把结论降为 unknown 且不启用。
  if (oldPluginActive === null || oldPluginActive === undefined) {
    return {
      enabled: false, code: 'old-plugin-unknown',
      reason: '拿不到 per-agent 作用域，无法确认旧插件是否仍在装配：按保守方向不启用',
    }
  }
  return decideEnabled({
    rollout: base.rollout,
    sessionId,
    settings: base.settings,
    oldPluginActive: oldPluginActive === true,
  })
}
