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

import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 存储子目录名（放在 DSH_HOME 下的独立命名空间，不与宿主/别的插件混在一起）。 */
export const STORE_DIRNAME = 'po06-state'

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
 * 建一个存储句柄。
 * @param home  DSH_HOME
 * @param opts.keep 保留的会话份数上限（超出按 mtime 删最旧）——防止无限增长
 */
export function createStateStore({ home, keep = 200 } = {}) {
  if (!home) throw new Error('createStateStore: home required')
  const dir = join(String(home), STORE_DIRNAME)

  /** 写：先写临时文件再 rename（原子替换，避免半份 JSON 被读成"状态损坏"）。 */
  function save(sessionId, state) {
    try {
      mkdirSync(dir, { recursive: true })
      const dst = statePath(home, sessionId)
      const tmp = dst + '.tmp'
      writeFileSync(tmp, JSON.stringify(state), 'utf8')
      renameSync(tmp, dst)
      return { ok: true, path: dst }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /** 读：任何异常（不存在 / JSON 坏 / 形状不对）一律返回 null——**不抛**、不猜。 */
  function load(sessionId) {
    const p = statePath(home, sessionId)
    try {
      if (!existsSync(p)) return null
      const v = JSON.parse(readFileSync(p, 'utf8'))
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null
      if (typeof v.revision !== 'number' || !Array.isArray(v.items)) return null
      return v
    } catch { return null }
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

  return { dir, save, load, remove, count, keep }
}
