// P9.2 · **控制 API**（供 P9.3 的面板调用）。挂在 `ctx.webServer` 上，前缀 `/po06/api`。
//
// 为什么必须自己做信任检查（EV-0139）：宿主的"浏览器信任闸门"只覆盖 `/api` 前缀
// （`dsh-client-connection` 的注释写明 "Browser-trust fence for every /api request"），
// 而插件路由在 `/po06/api` —— **不在闸门内**。宿主的理由同样适用于我们：
//   · **DNS rebinding**：恶意页面把域名解析到 127.0.0.1，就能带着 `Host: evil.com` 打本地端口；
//     闸门靠 Host 判据挡住它（Host 是 rebinding 唯一改不了的请求头）。
//   · **跨站发起**：恶意页面直接 `fetch('http://127.0.0.1:3080/po06/api/settings')`。
// 而我们的接口能读到**用户的意图状态**（他说的原话），还能**改设置** ⇒ 不能裸奔。
//
// 采用与宿主同源的判据 + 一条只对我们有利的加码：
//   ① `Host` 必须是 loopback 权威（127/8、localhost、[::1]，可带端口）——挡 rebinding；
//   ② 出现 `Origin` 时其 host 必须是 loopback——挡跨站；
//   ③ **写操作必须带自定义头 `x-po06: 1`**：自定义头会触发 CORS 预检，而我们**从不**回 CORS 头
//      ⇒ 跨站写在预检阶段就被浏览器拦掉（同源页面不受影响）。这一条是"最小代价的 CSRF 防线"。
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_PROMPT } from './interpreter.js'
import { parseEnableIntent } from './assembly-gate.js'
import { normalizeSettings, describeSettings, writeSettings, SETTINGS_KEYS } from './settings.js'

export const API_PREFIX = '/po06/api'
/** 写操作必须带的自定义头（见文件头 ③）。 */
export const WRITE_HEADER = 'x-po06'
/** 启动闸门自己的顶层字段：它们不是"设置"，但**也不是**不认识的字段（见 /status 的处理）。 */
export const GATE_KEYS = Object.freeze(['settingsVersion', 'enabled', 'rollout'])
/** 请求体上限：设置/指令都很小；给足了也不会被巨体打爆。 */
export const MAX_BODY_BYTES = 64 * 1024

/** `authority`（Host 头的值，可能带端口）是不是 loopback。纯函数。 */
export function isLoopbackAuthority(authority) {
  const a = String(authority == null ? '' : authority).trim().toLowerCase()
  if (!a) return false
  let host = a
  if (host.startsWith('[')) {                       // IPv6 字面量：[::1]:3080
    const end = host.indexOf(']')
    if (end < 0) return false
    host = host.slice(0, end + 1)
    return host === '[::1]'
  }
  const colon = host.lastIndexOf(':')
  if (colon >= 0) host = host.slice(0, colon)       // 去掉端口
  if (host === 'localhost') return true
  if (host === '::1') return true
  const parts = host.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * 请求可信吗。**纯函数**（只读 headers），便于单测把每条判据钉死。
 * @param headers 形如 `{ host, origin, 'x-po06' }` 的小写键对象
 * @param needsWrite 写操作要求额外的自定义头
 */
export function requestTrust(headers, needsWrite) {
  const h = headers || {}
  const host = h.host
  if (!isLoopbackAuthority(host)) return { ok: false, code: 403, reason: 'host-not-loopback' }
  if (h.origin !== undefined && h.origin !== null && String(h.origin) !== '') {
    let ohost = null
    try { ohost = new URL(String(h.origin)).host } catch { return { ok: false, code: 403, reason: 'origin-unparsable' } }
    if (!isLoopbackAuthority(ohost)) return { ok: false, code: 403, reason: 'origin-not-loopback' }
  }
  if (needsWrite && String(h[WRITE_HEADER] || '') !== '1') return { ok: false, code: 403, reason: 'missing-write-header' }
  return { ok: true }
}

/** 意图条目的**出处分类**：来自用户的话 / 机器补充 / 无出处。纯函数。 */
export function provenanceOf(item) {
  const refs = Array.isArray(item && item.sourceRefs) ? item.sourceRefs : []
  if (refs.some((r) => r && (r.kind === 'human' || r.kind === 'user'))) return 'user'
  if (refs.length > 0) return 'machine'
  return 'unsourced'
}

/** 把一份状态投影成面板要用的形状（不暴露 schema/phase/hash —— 计划 §14.1 的明确要求）。 */
export function projectState(state, sessionId) {
  if (!state || !Array.isArray(state.items)) return null
  const items = state.items.map((it) => ({
    id: it.id, kind: it.kind, status: it.status, text: it.text,
    provenance: provenanceOf(it), scope: it.scope || null,
  }))
  return {
    sessionId: sessionId || state.sessionId || null,
    revision: typeof state.revision === 'number' ? state.revision : null,
    items,
    counts: {
      total: items.length,
      user: items.filter((x) => x.provenance === 'user').length,
      machine: items.filter((x) => x.provenance === 'machine').length,
      unsourced: items.filter((x) => x.provenance === 'unsourced').length,
    },
  }
}

/** 台账最后 n 行 → 面板要用的字段（丢掉 trace 之类的大字段）。纯函数（输入是文本）。 */
export function recentTurns(ledgerText, limit = 5) {
  const lines = String(ledgerText == null ? '' : ledgerText).split('\n')
  const out = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* 坏行跳过（台账是流式追加，可能正在写） */ }
  }
  return out.slice(-Math.max(0, limit)).reverse().map((r) => ({
    at: r.at || null, trigger: r.trigger || null, ok: r.ok === true,
    outcome: r.outcome || null, inputChars: typeof r.chars === 'number' ? r.chars : null,
    packetChars: typeof r.packetChars === 'number' ? r.packetChars : null,
    revision: typeof r.revision === 'number' ? r.revision : null,
    ms: typeof r.ms === 'number' ? r.ms : null,
    model: r.provider ? r.provider + '/' + (r.model || '') : null,
    reason: r.reason || null,
  }))
}

/** 解释层提示词的**生效来源**：文件覆盖优先，否则内置。 */
export function resolvePrompt({ home, readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null) } = {}) {
  const file = join(String(home), 'po06-prompt.md')
  const text = readFile(file)
  if (typeof text === 'string' && text.trim()) return { source: 'file', path: file, text, chars: text.length }
  return { source: 'builtin', path: file, text: SYSTEM_PROMPT, chars: SYSTEM_PROMPT.length }
}

/** 写/重置提示词覆盖文件（原子 + 备份 + 读回）。 */
export function writePrompt({ home, text, reset = false, now = Date.now() } = {}) {
  const path = join(String(home), 'po06-prompt.md')
  try {
    if (reset) {
      if (existsSync(path)) { copyFileSync(path, path + '.bak-' + now); rmSync(path, { force: true }) }
      return { ok: true, reset: true, path }
    }
    const body = String(text == null ? '' : text)
    if (!body.trim()) return { ok: false, reason: 'empty', path }
    if (body.length > 20000) return { ok: false, reason: 'too-long', path }
    let backup = null
    if (existsSync(path)) { copyFileSync(path, path + '.bak-' + now); backup = path + '.bak-' + now }
    const tmp = path + '.tmp-' + now
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, path)
    if (readFileSync(path, 'utf8') !== body) return { ok: false, reason: 'readback-mismatch', path, backup }
    return { ok: true, path, backup, chars: body.length }
  } catch (e) {
    try { rmSync(path + '.tmp-' + now, { force: true }) } catch { /* best effort */ }
    return { ok: false, reason: 'write-failed:' + String((e && e.message) || e), path }
  }
}

function readJsonSafe(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null }
}
function readTextSafe(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null } catch { return null }
}

/**
 * 建一个处理函数。**不碰 ctx**（纯 IO + 纯函数），便于单测直接喂假 req/res。
 * @param opts.home        DSH_HOME
 * @param opts.stateDir    状态目录（默认 `<home>/po06-state`）
 * @param opts.ledgerPath  台账（默认 `<home>/po06-wire.jsonl`）
 * @param opts.version     版本号（面板显示用）
 * @param opts.now         注入时钟（测试用）
 */
export function createControlHandler({ home, stateDir, ledgerPath, version = null, now = () => Date.now() } = {}) {
  const H = String(home)
  const cfgPath = join(H, 'po06.json')
  const ledger = ledgerPath || join(H, 'po06-wire.jsonl')
  const states = stateDir || join(H, 'po06-state')

  const readBody = (req) => new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) { resolve({ ok: false, reason: 'body-too-large' }); try { req.destroy() } catch { /* best effort */ } return }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({ ok: true, value: {} })
      try { resolve({ ok: true, value: JSON.parse(raw) }) } catch { resolve({ ok: false, reason: 'body-not-json' }) }
    })
    req.on('error', () => resolve({ ok: false, reason: 'body-read-error' }))
  })

  return async function handle(req, res) {
    const url = String(req.url || '')
    const path = url.split('?')[0]
    const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
    const method = String(req.method || 'GET').toUpperCase()
    const send = (code, obj) => {
      // 一律不回 CORS 头：跨站读被浏览器挡掉，跨站写被预检挡掉（见文件头 ③）
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    const trust = requestTrust(req.headers || {}, method !== 'GET')
    if (!trust.ok) return send(trust.code, { ok: false, reason: trust.reason })

    try {
      if (method === 'GET' && path === API_PREFIX + '/status') {
        const raw = readJsonSafe(cfgPath)
        const intent = parseEnableIntent(readTextSafe(cfgPath))
        const norm = normalizeSettings(raw || {})
        const prompt = resolvePrompt({ home: H })
        return send(200, {
          ok: true, version, home: H,
          enabled: intent.settings.enabled === true,
          rollout: intent.rollout.mode,
          ours: intent.ours, reason: intent.reason || null,
          settings: norm.settings, described: describeSettings(norm.settings),
          // ⚠ 启动闸门自己的字段（enabled / rollout / settingsVersion）**不是**"不认识的字段"，
          // 只是不属于**设置**白名单。真实宿主实测（EV-0141）时它们被当成 problems 报给界面，
          // 界面会显示"配置里有 3 处不规范"——**假警报**，用户会以为自己把配置写坏了。
          problems: norm.problems.filter((p) => !GATE_KEYS.includes(p.key)),
          prompt: { source: prompt.source, chars: prompt.chars, path: prompt.path },
          writableKeys: SETTINGS_KEYS,
        })
      }
      if (method === 'GET' && path === API_PREFIX + '/state') {
        const sid = String(query.get('session') || '').trim()
        if (!sid) return send(400, { ok: false, reason: 'session-required' })
        const safe = sid.replace(/[^A-Za-z0-9._-]/g, '_')
        const state = readJsonSafe(join(states, safe + '.json'))
        const projected = projectState(state, sid)
        // ⚠ "这个会话还没有状态"是**正常情况**（还没产生过意图包），不是错误：返回 404 会让浏览器
        // 控制台报红（真机 DOM 探针实测到那条红字），而界面上其实一切正常。
        // 404 的语义是"资源不存在"，这里应当是"**查询成功，只是还空着**"。
        if (!projected) {
          return send(200, { ok: true, hasState: false, sessionId: sid, revision: null, items: [],
            counts: { total: 0, user: 0, machine: 0, unsourced: 0 } })
        }
        return send(200, { ok: true, hasState: true, ...projected })
      }
      if (method === 'GET' && path === API_PREFIX + '/turns') {
        const n = Math.min(50, Math.max(1, Number(query.get('limit') || 5) || 5))
        return send(200, { ok: true, turns: recentTurns(readTextSafe(ledger) || '', n), limit: n })
      }
      if (method === 'GET' && path === API_PREFIX + '/prompt') {
        const p = resolvePrompt({ home: H })
        return send(200, { ok: true, source: p.source, chars: p.chars, path: p.path, text: p.text })
      }
      if (method === 'POST' && path === API_PREFIX + '/settings') {
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const r = writeSettings({ path: cfgPath, patch: body.value || {}, now: now() })
        return send(r.ok ? 200 : 500, {
          ok: r.ok, reason: r.reason || null, backup: r.backup, problems: r.problems,
          settings: normalizeSettings(r.after).settings,
          described: describeSettings(normalizeSettings(r.after).settings),
          recoveredFromCorrupt: r.recoveredFromCorrupt === true,
        })
      }
      if (method === 'POST' && path === API_PREFIX + '/prompt') {
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const v = body.value || {}
        const r = writePrompt({ home: H, text: v.text, reset: v.reset === true, now: now() })
        return send(r.ok ? 200 : 400, { ok: r.ok, reason: r.reason || null, backup: r.backup || null, path: r.path })
      }
      if (method === 'POST' && path === API_PREFIX + '/rollback') {
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const kind = String((body.value || {}).kind || '')
        if (kind === 'disable') {
          const r = writeSettings({ path: cfgPath, patch: { assist: 'off' }, now: now() })
          return send(r.ok ? 200 : 500, { ok: r.ok, reason: r.reason || null, settings: normalizeSettings(r.after).settings })
        }
        // 条目级/包级回退需要状态历史（当前没有），**如实说没做**而不是假装成功
        return send(501, { ok: false, reason: 'not-implemented', kind, note: '条目级/包级回退需要状态历史，计划在 P9.4 之后（见 po06/P9-UI-PLAN.md）' })
      }
      return send(404, { ok: false, reason: 'unknown-endpoint', path, method })
    } catch (e) {
      return send(500, { ok: false, reason: 'handler-threw:' + String((e && e.message) || e) })
    }
  }
}

/** 注册到宿主（调用方负责放进 `ctx.effect` 生命周期）。 */
export function registerControlApi(ctx, opts) {
  const handler = createControlHandler(opts)
  return ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
}
