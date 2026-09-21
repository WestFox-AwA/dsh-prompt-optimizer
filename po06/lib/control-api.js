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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  // ⚠ P11：**显式标了机器来源的，不许被"有 human 引用"洗成"你说过"**。
  // 短消息的引文可以来自**上下文**（用户 2026-09-21 的反馈：一两字结合上下文也有大量信息），
  // 那种条目在 parse 里被标成 `provenance:'machine'` —— 这里必须尊重它，否则界面会把
  // "机器从上下文推的"显示成"来自你的话"，那是最不该犯的错。
  if (item && item.provenance === 'machine') return 'machine'
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
    // ── P10：把"这一轮它在做什么"需要的归因字段透给界面 ──
    // 台账里**早就有**这些（上下文读了多少、有没有派工具、包超没超预算），
    // 但 `/turns` 以前只映射固定几个字段 ⇒ 界面即便想显示也拿不到，
    // 于是"运行情况"只能靠人去看 jsonl。这里**只透传、不加工**；缺值一律 null，
    // 界面据 null 显示"未记录"——不许拿 0 冒充"没发生"（两者含义不同）。
    packetOverBudget: typeof r.packetOverBudget === 'boolean' ? r.packetOverBudget : null,
    packetOverBy: typeof r.packetOverBy === 'number' ? r.packetOverBy : null,
    packetBudget: typeof r.packetBudget === 'number' ? r.packetBudget : null,
    historyChars: typeof r.historyChars === 'number' ? r.historyChars : null,
    historyTurnsRead: typeof r.historyTurnsRead === 'number' ? r.historyTurnsRead : null,
    historyAvailable: typeof r.historyAvailable === 'number' ? r.historyAvailable : null,
    toolsEnabled: typeof r.toolsEnabled === 'boolean' ? r.toolsEnabled : null,
    toolsReason: typeof r.toolsReason === 'string' ? r.toolsReason : null,
    toolRounds: typeof r.toolRounds === 'number' ? r.toolRounds : null,
    toolCalls: typeof r.toolCalls === 'number' ? r.toolCalls : null,
    toolFallback: r.toolFallback || null,
    interpretVia: typeof r.interpretVia === 'string' ? r.interpretVia : null,
  }))
}

/**
 * `?` 帮助弹层的正文来源：包根目录的 `HELP-0.6.md`（**一个真相来源**——不在客户端里再抄一份，
 * 抄一份就一定会和文档分叉）。
 *
 * ⚠ 读不到时**不许假装成功**、也不许糊一段别的文案顶上：如实标 `missing` 并把路径给出去——
 * "帮助文件没进安装包"是**打包缺陷**，必须让人看见（且这份文件已列进 package.json 的 `files`，
 * 有守卫测试钉住，见 test/client-file.test.mjs）。
 */
export const HELP_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'HELP-0.6.md')
/** 用户可见正文的起点标记（此前的"用途"说明与文中的〔依据〕都不给用户看）。 */
export const HELP_START = '<!-- po06:help-start'
/** 把实现者注记（〔依据：…〕，可能跨行）从用户可见正文里剥掉。 */
export function stripAuthorNotes(text) {
  return String(text == null ? '' : text).replace(/〔依据[\s\S]*?〕/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

export function resolveHelp({ file = HELP_FILE, readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null) } = {}) {
  const raw = readFile(file)
  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      source: 'missing', path: file, text: '', chars: 0,
      note: '帮助文件读不到：' + file + '（安装包可能没带上它——这是打包缺陷，不是你的操作问题）。'
        + '界面上的每个控件都带悬停说明（title），可以先用它们。',
    }
  }
  const at = raw.indexOf(HELP_START)
  if (at < 0) {
    // 文件在、但**可见区间的标记没写**：这时给全文是不行的（开头那段是给实现者看的），
    // 于是如实报缺陷并给出路径，而不是糊一段别的文案顶上去。
    return {
      source: 'file', path: file, text: '', chars: 0, warning: 'help-start-marker-missing',
      note: '帮助文件里没有可见区间标记（' + HELP_START + '…）：这是文档缺陷，已记路径 ' + file,
    }
  }
  const body = stripAuthorNotes(raw.slice(at + HELP_START.length).replace(/^[^\n]*\n/, ''))
  return { source: 'file', path: file, text: body, chars: body.length }
}

/** 解释层提示词的**生效来源**：文件覆盖优先，否则内置。 */
export function resolvePrompt({ home, readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null) } = {}) {
  const file = join(String(home), 'po06-prompt.md')
  const text = readFile(file)
  if (typeof text === 'string' && text.trim()) return { source: 'file', path: file, text, chars: text.length }
  return { source: 'builtin', path: file, text: SYSTEM_PROMPT, chars: SYSTEM_PROMPT.length }
}

/** 写/重置提示词覆盖文件（原子 + 备份 + 读回）。 */
export function writePrompt({ home, text, reset = false, undo = false, now = Date.now() } = {}) {
  const path = join(String(home), 'po06-prompt.md')
  try {
    const previousPath = path + '.previous.json'
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (undo) {
      if (!existsSync(previousPath)) return { ok: false, reason: '没有可撤销的提示词修改', path }
      const previous = JSON.parse(readFileSync(previousPath, 'utf8'))
      if (previous.text !== null && typeof previous.text !== 'string') return { ok: false, reason: 'invalid-history', path }
      if (current !== null) copyFileSync(path, path + '.bak-' + now)
      if (previous.text === null) rmSync(path, { force: true })
      else { writeFileSync(path + '.tmp-' + now, previous.text, 'utf8'); renameSync(path + '.tmp-' + now, path) }
      rmSync(previousPath, { force: true })
      return { ok: true, path, undone: true }
    }
    const remember = () => {
      writeFileSync(previousPath + '.tmp', JSON.stringify({ text: current }), 'utf8')
      renameSync(previousPath + '.tmp', previousPath)
    }
    if (reset) {
      remember()
      if (existsSync(path)) { copyFileSync(path, path + '.bak-' + now); rmSync(path, { force: true }) }
      return { ok: true, reset: true, path }
    }
    const body = String(text == null ? '' : text)
    if (!body.trim()) return { ok: false, reason: 'empty', path }
    if (body.length > 20000) return { ok: false, reason: 'too-long', path }
    remember()
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
 * @param opts.help        `?` 帮助正文的来源覆盖（默认读包里的 HELP-0.6.md；测试可指到临时文件）
 * @param opts.interpret   P11 前置拦截的按需解释（`({sessionId, text, messageId}) => {ok, packet, chars, ms}`）；
 *                         不传 = 本 profile 不支持 ⇒ `/interpret` 如实回 501
 * @param opts.setPacket   P11 审查态里用户改过的正文 → **本轮注入的包**（`({sessionId, text}) => {ok, chars}`）；
 *                         不传 ⇒ `/packet` 如实回 501
 * @param opts.now         注入时钟（测试用）
 */
export function createControlHandler({ home, stateDir, ledgerPath, version = null, listModels = async () => ({ models: [], problems: [] }), now = () => Date.now(), help = {}, interpret = null, setPacket = null, progress = null, rollbackPacket = null, getPacket = null, listItems = null, closeItem = null } = {}) {
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
      if (method === 'GET' && path === API_PREFIX + '/models') {
        return send(200, { ok: true, ...await listModels() })
      }
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
          prompt: { source: prompt.source, chars: prompt.chars, path: prompt.path, text: prompt.text },
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
      // `?` 帮助弹层的正文（要求②，2026-09-21）：真身是包里的 HELP-0.6.md，**不在这里另写一份**
      if (method === 'GET' && path === API_PREFIX + '/help') {
        return send(200, { ok: true, ...resolveHelp(help) })
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
        const r = writePrompt({ home: H, text: v.text, reset: v.reset === true, undo: v.undo === true, now: now() })
        return send(r.ok ? 200 : 400, { ok: r.ok, reason: r.reason || null, backup: r.backup || null, path: r.path })
      }
      if (method === 'POST' && path === API_PREFIX + '/interpret') {
        // P11：前置拦截的按需解释（"第一轮发，第一轮就回"）。**可能跑 20–60 秒**——这是设计好的等待，
        // 客户端此时显示"优化中… 已用 N 秒 ｜ 跳过并直接发送"。**不设超时**（用户 2026-09-21 明确选择）。
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const v = body.value || {}
        if (typeof interpret !== 'function') {
          // 本 profile 没接上 pipeline ⇒ **如实说做不到**（客户端据此按原文放行），不假装成功
          return send(501, {
            ok: false, reason: 'not-implemented',
            note: '按需解释需要宿主侧的 pipeline（本 profile 未提供）——客户端应按原文放行',
          })
        }
        const r = await interpret({ sessionId: String(v.sessionId || ''), text: String(v.text || ''), messageId: v.messageId || null })
        const out = (r && typeof r === 'object') ? r : { ok: false, reason: 'bad-hook-result' }
        return send(out.ok === true ? 200 : 400, {
          ok: out.ok === true, reason: out.reason || null,
          packet: typeof out.packet === 'string' ? out.packet : '',
          chars: typeof out.chars === 'number' ? out.chars : 0,
          ms: typeof out.ms === 'number' ? out.ms : null,
          // 无出处条目数（缺值 = null = "未记录"，界面不许拿 0 冒充"没有"）
          unsourced: typeof out.unsourced === 'number' ? out.unsourced : null,
          // P11：这一轮用的是哪条模型路由（`observed` / `session` / `host-default` / `host-default-first`）。
          // 界面据此对"兜底"明说一句——**不许把兜底模型当成用户会话的模型**静默使用。
          route: typeof out.route === 'string' ? out.route : null,
          gate: typeof out.gate === 'string' ? out.gate : null,
        })
      }
      if (method === 'POST' && path === API_PREFIX + '/packet') {
        // P11：审查态里用户**改过的正文**就是本轮要注入的包（空串 = 清掉这一轮的包）。
        // 与 `/interpret` 的区别：这里不跑模型，只把"这一轮注入什么"按用户的意思定下来。
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const v = body.value || {}
        if (typeof setPacket !== 'function') {
          return send(501, { ok: false, reason: 'not-implemented', note: '本 profile 未接上 pipeline，改包无法生效' })
        }
        const r = await setPacket({ sessionId: String(v.sessionId || ''), text: String(v.text == null ? '' : v.text) })
        const out = (r && typeof r === 'object') ? r : { ok: false, reason: 'bad-hook-result' }
        return send(out.ok === true ? 200 : 400, { ok: out.ok === true, reason: out.reason || null, chars: typeof out.chars === 'number' ? out.chars : 0 })
      }
      if (method === 'GET' && path === API_PREFIX + '/interpret-progress') {
        // P11：让"优化中"那几十秒看得见（阶段 + 流式正文尾部）。**只读、无副作用**；
        // 没在跑不是错误 ⇒ 回 `{ok:true, active:false}`（404 会让浏览器控制台报红）。
        const sid = String(query.get('session') || '').trim()
        if (!sid) return send(400, { ok: false, reason: 'session-required' })
        const p = (typeof progress === 'function') ? progress(sid) : { active: false }
        return send(200, { ok: true, ...(p && typeof p === 'object' ? p : { active: false }) })
      }
      if (method === 'GET' && path === API_PREFIX + '/packet') {
        // P11：读"这一轮注入的包"当前是什么（回退之后要把新的正文读回界面）。
        const sid = String(query.get('session') || '').trim()
        if (!sid) return send(400, { ok: false, reason: 'session-required' })
        if (typeof getPacket !== 'function') return send(501, { ok: false, reason: 'not-implemented', note: '本 profile 未接上 pipeline' })
        const text = String(getPacket({ sessionId: sid }) || '')
        return send(200, { ok: true, chars: text.length, packet: text })
      }
      // P11 闭合通道（A 案）：列出这个会话的条目，供界面逐条"已解决"。
      if (method === 'GET' && path === API_PREFIX + '/items') {
        const sid = String(query.get('session') || '').trim()
        if (!sid) return send(400, { ok: false, reason: 'session-required' })
        if (typeof listItems !== 'function') return send(501, { ok: false, reason: 'not-implemented', note: '本 profile 未接上 pipeline' })
        const r = listItems({ sessionId: sid })
        const out = (r && typeof r === 'object') ? r : { ok: false, reason: 'bad-hook-result' }
        return send(out.ok === true ? 200 : 400, out)
      }
      // P11 闭合通道（A 案）：把某条条目**手动结案**（只许退不许复活，条目不删除）。
      // 写操作带 `x-po06:1` 写头（见文件头 ③：跨站写在预检阶段就被浏览器挡掉）。
      if (method === 'POST' && path === API_PREFIX + '/item-status') {
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const v = body.value || {}
        if (typeof closeItem !== 'function') return send(501, { ok: false, reason: 'not-implemented', note: '本 profile 未接上 pipeline' })
        const r = closeItem({ sessionId: String(v.sessionId || ''), id: String(v.id || ''), status: String(v.status || 'retracted') })
        const out = (r && typeof r === 'object') ? r : { ok: false, reason: 'bad-hook-result' }
        return send(out.ok === true ? 200 : 400, out)
      }
      if (method === 'POST' && path === API_PREFIX + '/rollback') {
        const body = await readBody(req)
        if (!body.ok) return send(400, { ok: false, reason: body.reason })
        const kind = String((body.value || {}).kind || '')
        if (kind === 'disable') {
          const r = writeSettings({ path: cfgPath, patch: { assist: 'off' }, now: now() })
          return send(r.ok ? 200 : 500, { ok: r.ok, reason: r.reason || null, settings: normalizeSettings(r.after).settings })
        }
        // P11：**包级回退**现在真能做——宿主侧每次写非空包都会把上一版压进历史（每会话 10 条）
        if (kind === 'packet') {
          if (typeof rollbackPacket !== 'function') {
            return send(501, { ok: false, reason: 'not-implemented', kind, note: '本 profile 未接上 pipeline，包级回退无法生效' })
          }
          const r = await rollbackPacket({ sessionId: String((body.value || {}).sessionId || '') })
          const out = (r && typeof r === 'object') ? r : { ok: false, reason: 'bad-hook-result' }
          return send(out.ok === true ? 200 : 400, { ok: out.ok === true, reason: out.reason || null, chars: out.chars || 0, remaining: out.remaining == null ? null : out.remaining })
        }
        // 条目级回退需要"每条意图的历史版本"，目前没有 —— **如实说没做**，不假装成功
        return send(501, { ok: false, reason: 'not-implemented', kind, note: '条目级回退需要条目级历史（当前只有包级历史），计划在 P9.4 之后（见 po06/P9-UI-PLAN.md）' })
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
