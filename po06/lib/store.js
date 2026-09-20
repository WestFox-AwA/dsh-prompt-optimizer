// P8 · **插件自己的按会话状态存储**（不再往会话日志里写自定义事件）
//
// 为什么必须自己存（EV-0081，读宿主源码逐条确认）：
//   ① 会话日志里放自定义事件类型，宿主会**拒绝重建整个会话**——
//      除非事件带 `ignorable: true`；而 `Session.append(type, data, ...opts)`
//      构造信封时**只**接受 `sourceEventSeqs`/`surfaceOp`，插件根本置不上那个标记。
//   ② 事件类型表 `KNOWN_SESSION_EVENT_TYPES` 是**构建期静态**的（脚本生成），
//      第三方插件无法在运行期注册自己的类型。
//   ③ 投影缓存**不是**持久化机制：宿主契约原文写着
//      "A row is never authoritative, only a fold shortcut"——它是日志的派生视图，
//      而我们的状态来自模型输出，**不由日志推导**，所以放进去也不成立。
//   ⇒ 结论：**状态必须由插件自己拥有**。会话日志保持"宿主自己的东西"，污染面归零。
//
// 存储形态：`<DSH_HOME>/po06-state/<sessionId>.json`，一次整份覆盖（全值语义，与状态本身一致）。
// 会话 id 来自宿主，仍按"不可信输入"处理：**白名单字符 + 长度上限**，杜绝路径穿越。

import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 存储子目录名（放在 DSH_HOME 下的独立命名空间，不与宿主/别的插件混在一起）。 */
export const STORE_DIRNAME = 'po06-state'

/** 默认保留份数。够覆盖"最近用过的会话"，又不至于无限增长。 */
export const DEFAULT_KEEP = 200

/** 会话 id 允许的字符：只留 uuid/短横线/下划线/点，其余一律替换掉。 */
export function safeSessionFile(sessionId) {
  const s = String(sessionId == null ? '' : sessionId)
  const cleaned = s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)
  return (cleaned || 'unknown') + '.json'
}

export function statePath(home, sessionId) {
  return join(String(home), STORE_DIRNAME, safeSessionFile(sessionId))
}

/**
 * **分叉继承**：把子会话的初始状态从父会话状态派生出来（EV-0091）。
 *
 * 为什么必须继承：宿主的分叉给出**新的 sessionId**（`SessionHeader.parentSession` 指向来源），
 * 而我们的状态按 sessionId 存 ⇒ 不处理的话，分叉出来的会话**静默地没有状态**。
 * 那恰好破坏最该保住的性质：分叉的语义是"从这里接着走"，
 * 而累积的长期约束（"不要预览其他文件""只给代码"）正是要接着用的东西。
 *
 * 三条纪律：
 *  ① **深拷贝**：分叉必须能独立演化——改子会话绝不能改到父会话的状态。
 *  ② **改写归属**：状态里的 `sessionId` 换成子会话 id；否则一份自称属于别人的状态
 *     会在后续渲染与审计里给出**错误出处**。
 *  ③ **留下出处**：记 `inheritedFrom` 与继承时的修订号，使"这份状态是继承来的"可复核，
 *     并与"新任务从头开始"区分开。
 */
export function inheritStateForFork(parentState, childSessionId, parentSessionId) {
  if (!parentState || typeof parentState !== 'object') return null
  const child = JSON.parse(JSON.stringify(parentState))   // 深拷贝（纯结构化数据，JSON 足够）
  child.sessionId = String(childSessionId)
  child.inheritedFrom = String(parentSessionId)
  child.inheritedAtRevision = typeof parentState.revision === 'number' ? parentState.revision : null
  return child
}

/**
 * 建一个存储句柄。
 * @param home  DSH_HOME
 * @param opts.keep 保留的会话份数上限（超出按 mtime 删最旧）——防止无限增长
 */
export function createStateStore({ home, keep = DEFAULT_KEEP } = {}) {
  if (!home) throw new Error('createStateStore: home required')
  const dir = join(String(home), STORE_DIRNAME)
  // 上限必须是**正**整数：0 / 负数 / NaN 会让 prune 把刚写的文件也删掉，
  // 或者永远不删（两种都是静默故障）。这里直接取合法值。
  const limit = Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : DEFAULT_KEEP

  /**
   * 淘汰：只保留最近 `limit` 份（按 mtime），其余删除。
   *
   * 为什么必须有：每个会话一份文件、**从不删除**就是无限增长——
   * 而"把用户磁盘写满"正是本项目被明确要求避免的事。
   * 只在 save 之后顺手做，**尽力而为**：淘汰失败绝不能让这次保存失败
   * （保存成功与否是正确性问题，淘汰只是空间问题）。
   */
  function prune() {
    try {
      if (!existsSync(dir)) return { removed: 0, kept: 0 }
      const rows = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try { return { f, t: statSync(join(dir, f)).mtimeMs } } catch { return null }
        })
        .filter(Boolean)
        .sort((a, b) => b.t - a.t)          // 新的在前
      let removed = 0
      for (const row of rows.slice(limit)) {
        try { rmSync(join(dir, row.f), { force: true }); removed += 1 } catch { /* 下一轮再说 */ }
      }
      return { removed, kept: Math.min(rows.length, limit) }
    } catch { return { removed: 0, kept: 0 } }
  }

  /** 写：先写临时文件再 rename（原子替换，避免半份 JSON 被读成"状态损坏"）。 */
  function save(sessionId, state) {
    try {
      mkdirSync(dir, { recursive: true })
      const dst = statePath(home, sessionId)
      const tmp = dst + '.tmp'
      writeFileSync(tmp, JSON.stringify(state), 'utf8')
      renameSync(tmp, dst)
      const p = prune()                     // 顺手淘汰；失败不影响本次保存
      return { ok: true, path: dst, pruned: p.removed }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /**
   * 读：任何异常（不存在 / JSON 坏 / 形状不对）一律返回 null——**不抛**、不猜。
   *
   * ⚠ **它把三种完全不同的情况折成了同一个 `null`**（EV-0122），所以**光看它是分不出来的**：
   *   ① 真的没有状态（文件不存在）——正常，"尚无状态"，从头开始是对的；
   *   ② **文件坏了**（JSON 坏 / 读不出来）——用户的长期约束**静默消失**；
   *   ③ **形状不对**（revision/items 缺失，例如别的版本写的）——同上。
   * 而调用方拿到 `null` 会**新建一个空状态并覆盖写回同一个路径** ⇒ 损坏的证据被销毁、
   * 用户永远不会知道自己的约束丢了。所以需要区分时**必须用 `inspect()`**。
   */
  function load(sessionId) {
    const r = inspect(sessionId)
    return r.ok ? r.state : null
  }

  /**
   * 诊断式读取：把"没有"与"读不出来"分开。
   * @returns {{present:boolean, ok:boolean, state:object|null, reason:string|null, path:string}}
   *   `present=false` ⇒ 真的没有；`present=true, ok=false` ⇒ **文件在但读不出来**（要留证据）。
   */
  function inspect(sessionId) {
    const p = statePath(home, sessionId)
    try {
      if (!existsSync(p)) return { present: false, ok: true, state: null, reason: null, path: p }
    } catch (e) {
      return { present: false, ok: false, state: null, reason: 'stat-failed:' + String((e && e.message) || e), path: p }
    }
    let raw = null
    try { raw = readFileSync(p, 'utf8') } catch (e) {
      return { present: true, ok: false, state: null, reason: 'unreadable:' + String((e && e.message) || e), path: p }
    }
    let v = null
    try { v = JSON.parse(raw) } catch {
      return { present: true, ok: false, state: null, reason: 'malformed-json', path: p }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { present: true, ok: false, state: null, reason: 'not-an-object', path: p }
    }
    if (typeof v.revision !== 'number' || !Array.isArray(v.items)) {
      return { present: true, ok: false, state: null, reason: 'shape-mismatch', path: p }
    }
    return { present: true, ok: true, state: v, reason: null, path: p }
  }

  /**
   * **隔离**一份读不出来的状态：改名成 `<名字>.corrupt-<时间戳>.json`，而不是让它
   * 被随后的 `save()` 覆盖掉。尽力而为；返回新路径或 null。
   *
   * 为什么必须留证据：那份文件里可能就是用户积累了很久的长期约束。
   * "静默地从头开始"与"从头开始并留下一份可查的残骸"是两种完全不同的产品行为。
   */
  function quarantine(sessionId) {
    const p = statePath(home, sessionId)
    const dst = p.replace(/\.json$/, '') + '.corrupt-' + Date.now() + '.json'
    try { renameSync(p, dst); return dst } catch { return null }
  }

  function remove(sessionId) {
    try { rmSync(statePath(home, sessionId), { force: true }); return { ok: true } } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /** 只看文件数，不做删除以外的动作（自检用）。 */
  function count() {
    try { return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0 } catch { return 0 }
  }

  return { dir, save, load, inspect, quarantine, remove, count, prune, keep: limit }
}
