import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const ADVISOR_UI_LIMIT = 80
export const ADVISOR_THINK_LIMIT = 24000
export const ADVISOR_DRAFT_LIMIT = 8000
const copy = value => JSON.parse(JSON.stringify(value))
/** 把查询参数转成字符偏移；空串/NaN/负数一律当"没给"（null）。 */
const toOffset = (value) => {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const terminal = new Set(['done', 'failed', 'cancelled', 'timeout', 'interrupted'])

// UI-only state. Never inject provider reasoning into the working model's messages.
export function createAdvisorProgress({ home, now = Date.now, limit = ADVISOR_UI_LIMIT } = {}) {
  const records = new Map()
  const file = home ? join(home, 'po06-advisor-ui.json') : null
  if (file && existsSync(file)) {
    try {
      const rows = JSON.parse(readFileSync(file, 'utf8'))
      for (const row of Array.isArray(rows) ? rows.slice(-limit) : []) {
        if (!row?.runId || !row.sessionId) continue
        if (!terminal.has(row.stage)) { row.stage = 'interrupted'; row.finishedAt = now(); row.reason = 'host-restarted' }
        records.set(row.runId, row)
      }
    } catch { /* A bad UI cache must not break model execution. */ }
  }
  const save = () => {
    if (!file) return
    try {
      mkdirSync(home, { recursive: true })
      const temp = file + '.tmp'
      writeFileSync(temp, JSON.stringify([...records.values()]), 'utf8')
      renameSync(temp, file)
    } catch { /* best effort; memory remains authoritative for this process */ }
  }
  const trim = (target = limit) => {
    for (const [key, value] of records) {
      if (records.size <= target) break
      if (terminal.has(value.stage)) records.delete(key)
    }
  }
  return {
    start({ sessionId, callId, mode, question, timeoutMs, scope = 'general', focus = '' }) {
      trim(limit - 1)
      if (records.size >= limit) return null
      const runId = randomUUID()
      const row = { runId, sessionId: String(sessionId), callId: String(callId || ''), mode, reviewScope: scope, focus: String(focus).slice(0,500),
        timeoutMs: Number(timeoutMs) > 0 ? Math.round(Number(timeoutMs)) : null,
        question: String(question || '').slice(0, 4000), startedAt: now(), updatedAt: now(), stage: 'prepare',
        reasoning: '', draft: '', reasoningChars: 0, draftChars: 0, reasoningTruncated: false, draftTruncated: false,
        activities: [], round: 0, toolCalls: 0, result: null }
      records.set(runId, row); save(); return runId
    },
    patch(runId, patch) {
      const row = records.get(runId)
      if (!row || terminal.has(row.stage)) return
      Object.assign(row, patch, { updatedAt: now() })
    },
    delta(runId, delta) {
      const row = records.get(runId)
      if (!row || terminal.has(row.stage)) return
      for (const [field, cap] of [['reasoning', ADVISOR_THINK_LIMIT], ['draft', ADVISOR_DRAFT_LIMIT]]) {
        const text = String(delta?.[field === 'draft' ? 'text' : field] || '')
        if (!text) continue
        row[field + 'Chars'] += text.length
        row[field] = (row[field] + text).slice(-cap)
        row[field + 'Truncated'] = row[field + 'Chars'] > cap
      }
      row.updatedAt = now()
    },
    event(runId, event) {
      const row = records.get(runId)
      if (!row || terminal.has(row.stage)) return
      if (event.kind === 'round') {
        row.round = event.round
        row.stage = event.final ? 'conclude' : 'thinking'
        row.draft = ''; row.draftChars = 0; row.draftTruncated = false
      } else if (event.kind === 'tool') {
        row.stage = 'evidence'
        row.toolCalls += 1
        row.activities.push({ tool: event.tool, target: String(event.target || '').slice(0, 220),
          ok: event.ok === true, round: event.round, at: now(), ms: event.ms || 0 })
        row.activities = row.activities.slice(-24)
      }
      row.updatedAt = now()
    },
    finish(runId, result) {
      const row = records.get(runId)
      if (!row) return
      row.result = copy(result)
      row.stage = result.cut === 'advisor-timeout' || result.reason === 'advisor-timeout' ? 'timeout'
        : result.cut === 'advisor-cancelled' || result.reason === 'advisor-cancelled' ? 'cancelled'
        : result.ok ? 'done' : 'failed'
      row.finishedAt = now(); row.updatedAt = now()
      row.reason = result.reason || result.cut || null
      trim(); save()
    },
    /**
     * 读一行进度。`since`/`draftSince` 是**增量模式**：客户端带上"我已经收到多少字"，
     * 只回新增的那一截（`reasoningDelta`/`draftDelta`），正文两个字段置空。
     *
     * 为什么要增量：顾问一次咨询的思考可达 24k 字，全量回一次就是几十 KB；
     * 客户端要按会话那种高频刷新（本插件用 25ms 轮询，见 client.js 的 ADVISOR_POLL_MS），
     * 全量回会变成每秒上兆的 JSON 传输与解析，白白烧 CPU。
     *
     * ⚠ 保留窗口是**尾部**窗口（`delta()` 里 `slice(-cap)`），所以只有客户端偏移仍落在窗口内才给增量；
     *   落不进去（被截掉、或换了回合 draft 归零）就回全量并带 `resync:true`，让客户端重同步。
     */
    get(sessionId, { callId, runId, since, draftSince, draftRound } = {}) {
      if (!sessionId || (!callId && !runId)) return null
      const rows = [...records.values()]
      const row = runId ? records.get(runId) : rows.reverse().find(r => r.sessionId === String(sessionId) && r.callId === String(callId))
      if (row?.sessionId !== String(sessionId)) return null
      const th = toOffset(since)
      const dg = toOffset(draftSince)
      if (th === null && dg === null) return copy(row)
      const take = (field, total, want) => (want === null ? '' : row[field].slice(row[field].length - (total - want)))
      const fits = (field, total, want) => want === null || (total - want >= 0 && total - want <= row[field].length)
      const full = () => { const out = copy(row); out.delta = false; out.resync = true; return out }
      if (!fits('reasoning', row.reasoningChars, th) || !fits('draft', row.draftChars, dg)) return full()
      // ⚠ **回合变了就必须重同步**：draft 每回合归零（见 delta() 的 event 分支），只比字数会漏 ——
      //   若新回合在客户端下次轮询前又攒到 ≥ 客户端手里那个旧偏移，`total - want` 恰好落回合法区间，
      //   于是把**新回合的片段拼到上一回合正文后面**，画面永久混排。
      const roundParam = toOffset(draftRound)
      if (roundParam !== null && roundParam !== row.round) return full()
      const out = { ...row }
      out.delta = true; out.resync = false
      out.reasoningDelta = take('reasoning', row.reasoningChars, th)
      out.draftDelta = take('draft', row.draftChars, dg)
      // 服务端保留窗口的长度：客户端按同一长度裁自己的缓冲，保证"直播看到的"与"刷新后看到的"一致，
      // 也免去在客户端再写一份窗口常量（两份常量必然漂移）。
      out.reasoningLen = row.reasoning.length
      out.draftLen = row.draft.length
      // 增量的语义就是"正文我只给你新增的那一截"：全量字段必须置空，否则省下的传输又回来了。
      out.reasoning = ''; out.draft = ''
      return out
    },
    dispose() {
      for (const row of records.values()) if (!terminal.has(row.stage)) {
        row.stage = 'interrupted'; row.reason = 'plugin-unloaded'; row.finishedAt = now()
      }
      save()
    },
  }
}
