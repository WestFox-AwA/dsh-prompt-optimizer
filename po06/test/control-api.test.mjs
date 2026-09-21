// P9.2 · 控制 API（`lib/control-api.js`）的单测。
//
// 运行：node po06/test/control-api.test.mjs
//
// 为什么给它配单测（EV-0139）：这个接口能**读到用户的意图状态**（他说的原话）、**改设置**、
// **改解释层提示词**。而宿主的浏览器信任闸门只覆盖 `/api` 前缀，插件路由不在其中
// ⇒ 信任判据必须由我们自己实现，且必须**逐条**有测试。
// 这里用假 req/res 直接调 handler：不起服务器、不联网、不碰真实 home。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  API_PREFIX, WRITE_HEADER, MAX_BODY_BYTES,
  isLoopbackAuthority, requestTrust, provenanceOf, projectState, recentTurns,
  resolvePrompt, writePrompt, createControlHandler,
} from '../lib/control-api.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
async function t(name, fn) { try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'po06-api-')); DIRS.push(d); return d }

/** 假请求：可带 headers/body；假响应：记录 status 与 JSON。 */
function fakeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080', ...headers }
  req.destroy = () => { /* noop */ }
  setImmediate(() => {
    if (body !== null && body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'))
    req.emit('end')
  })
  return req
}
function fakeRes() {
  const res = { status: null, headers: null, body: null, writeHead(c, h) { this.status = c; this.headers = h } , end(b) { try { this.body = JSON.parse(String(b)) } catch { this.body = String(b) } } }
  return res
}
const call = async (handler, opts) => { const res = fakeRes(); await handler(fakeReq(opts), res); return res }
const GET = (handler, url, headers) => call(handler, { method: 'GET', url, headers })
const POST = (handler, url, body, headers = {}) => call(handler, { method: 'POST', url, body, headers: { [WRITE_HEADER]: '1', ...headers } })

// ── ① 信任判据（逐条钉死）────────────────────────────────────────────
await t('isLoopbackAuthority：只认 127/8、localhost、[::1]（可带端口）', () => {
  for (const good of ['127.0.0.1', '127.0.0.1:3080', '127.1.2.3:1', 'localhost', 'localhost:3080', '[::1]', '[::1]:3080', 'LOCALHOST:80']) {
    eq(isLoopbackAuthority(good), true, '应认：' + good)
  }
  for (const bad of ['', null, undefined, 'evil.com', 'evil.com:3080', '128.0.0.1', '127.0.0.999', '127.0.0', '10.0.0.1:3080', '[::2]', 'localhost.evil.com', '127.0.0.1.evil.com']) {
    eq(isLoopbackAuthority(bad), false, '不该认：' + String(bad))
  }
})

await t('requestTrust：非 loopback Host 一律挡（DNS rebinding 的唯一判据）', () => {
  eq(requestTrust({ host: 'evil.com:3080' }, false).reason, 'host-not-loopback', 'Host 非本机 ⇒ 挡')
  eq(requestTrust({ host: '127.0.0.1:3080' }, false).ok, true, '本机 ⇒ 放行')
})

await t('requestTrust：带 Origin 时必须是 loopback 源（挡跨站）', () => {
  eq(requestTrust({ host: '127.0.0.1:3080', origin: 'https://evil.com' }, false).reason, 'origin-not-loopback', '跨站 Origin ⇒ 挡')
  eq(requestTrust({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, false).ok, true, '同源 ⇒ 放行')
  eq(requestTrust({ host: '127.0.0.1:3080', origin: '不是URL' }, false).reason, 'origin-unparsable', '坏 Origin ⇒ 挡')
})

await t('requestTrust：写操作必须带自定义头（让跨站写在 CORS 预检阶段就失败）', () => {
  eq(requestTrust({ host: '127.0.0.1:3080' }, true).reason, 'missing-write-header', '缺头 ⇒ 挡')
  eq(requestTrust({ host: '127.0.0.1:3080', [WRITE_HEADER]: '1' }, true).ok, true, '带头 ⇒ 放行')
  eq(requestTrust({ host: '127.0.0.1:3080', [WRITE_HEADER]: '0' }, true).reason, 'missing-write-header', '值不对也挡')
  eq(requestTrust({ host: '127.0.0.1:3080' }, false).ok, true, '只读不要求该头')
})

// ── ② 纯投影 ─────────────────────────────────────────────────────────
await t('provenanceOf / projectState：出处三分法 + 计数', () => {
  eq(provenanceOf({ sourceRefs: [{ kind: 'human' }] }), 'user', '有人类引用 ⇒ user')
  eq(provenanceOf({ sourceRefs: [{ kind: 'model' }] }), 'machine', '只有模型引用 ⇒ machine')
  eq(provenanceOf({ sourceRefs: [] }), 'unsourced', '空引用 ⇒ unsourced（应是缺陷）')
  eq(provenanceOf({}), 'unsourced', '没有 sourceRefs ⇒ unsourced')
  const p = projectState({
    sessionId: 's1', revision: 3,
    items: [
      { id: 'a', kind: 'user_requirement', status: 'active', text: '甲', sourceRefs: [{ kind: 'human' }] },
      { id: 'b', kind: 'unknown', status: 'active', text: '乙', sourceRefs: [{ kind: 'model' }] },
      { id: 'c', kind: 'unknown', status: 'active', text: '丙', sourceRefs: [] },
    ],
  }, 's1')
  eq(p.counts, { total: 3, user: 1, machine: 1, unsourced: 1 }, '计数')
  eq(p.revision, 3, '版本号')
  ok(!('schemaVersion' in p) && !('phase' in p), '不把内部字段抖给界面（计划 §14.1）')
  eq(projectState(null, 's'), null, '没有状态 ⇒ null')
  eq(projectState({ items: 'nope' }, 's'), null, 'items 不是数组 ⇒ null')
})

await t('recentTurns：取最后 n 条、倒序、丢掉大字段、坏行跳过', () => {
  const text = [
    JSON.stringify({ at: 't1', trigger: 'user-message', ok: true, outcome: 'committed', chars: 10, packetChars: 100, revision: 1, trace: ['x'.repeat(500)] }),
    'not json',
    JSON.stringify({ at: 't2', trigger: 'user-message', ok: false, reason: 'disabled' }),
    '',
    JSON.stringify({ at: 't3', trigger: 'user-message', ok: true, chars: 20, packetChars: 200, revision: 2, provider: 'p', model: 'm', ms: 5 }),
  ].join('\n')
  const r = recentTurns(text, 2)
  eq(r.length, 2, '只要 2 条')
  eq(r[0].at, 't3', '倒序：最新在前')
  eq(r[1].at, 't2', '第二新')
  ok(!('trace' in r[0]), '大字段不该传给界面')
  eq(recentTurns('', 5), [], '空台账 ⇒ 空数组')
  eq(recentTurns(null, 5), [], 'null ⇒ 空数组')
})

// ── ③ 提示词：文件覆盖 + 重置 + 读回 ──────────────────────────────────
// 要求②（2026-09-21）：`?` 帮助的正文 = 包里的 HELP-0.6.md 的**用户可见区间**，
// 实现者注记（〔依据：…〕）与开头的"用途"说明**不得漏给用户**；读不到要如实标 missing。
await t('resolveHelp：只取用户可见区间、剥掉〔依据〕、缺文件/缺标记都如实上报', async () => {
  const { resolveHelp, stripAuthorNotes, HELP_START } = await import('../lib/control-api.js')
  const file = join(tmp(), 'HELP.md')
  writeFileSync(file, [
    '# 给实现者看的说明（不要显示给用户）',
    HELP_START + ' —— 之后才是正文 -->',
    '',
    '## 节 1 · 怎么用',
    '| ① | 照常输入 〔依据：0.6 是旁路架构〕 |',
    '〔依据：settings.js 的 TIER_PRESETS——',
    '跨行的依据也要剥掉〕',
    '档位是糖。',
  ].join('\n'), 'utf8')
  const r = resolveHelp({ file })
  eq(r.source, 'file', '文件在 ⇒ source=file')
  ok(r.text.startsWith('## 节 1'), '正文从可见标记之后开始：' + JSON.stringify(r.text.slice(0, 20)))
  ok(!/不要显示给用户/.test(r.text), '开头的实现者说明不得漏出去')
  ok(!/〔依据/.test(r.text), '〔依据：…〕（含跨行）必须剥干净：' + JSON.stringify(r.text))
  ok(/档位是糖/.test(r.text), '正文内容要保留')
  eq(r.chars, r.text.length, 'chars 与正文一致')
  eq(stripAuthorNotes('a〔依据：x\ny〕b'), 'ab', '跨行注记剥除')
  // 缺标记 ⇒ 不拿全文顶（那是给实现者看的），如实报缺陷
  const f2 = join(tmp(), 'NO-MARK.md')
  writeFileSync(f2, '# 只有实现者说明，没有可见标记\n', 'utf8')
  const r2 = resolveHelp({ file: f2 })
  eq(r2.text, '', '缺标记时不给正文')
  eq(r2.warning, 'help-start-marker-missing', '要报明确的缺陷码')
  // 缺文件 ⇒ source=missing + note（不是抛异常）
  const r3 = resolveHelp({ file: join(tmp(), 'nope.md') })
  eq(r3.source, 'missing', '缺文件 ⇒ missing')
  ok(/读不到/.test(r3.note), '要有人话说明：' + r3.note)
})

await t('resolvePrompt / writePrompt：文件优先、可重置、写后读回一致', () => {
  const home = tmp()
  const r0 = resolvePrompt({ home })
  eq(r0.source, 'builtin', '没有覆盖文件 ⇒ 用内置')
  ok(r0.chars > 100, '内置提示词应该有内容：' + r0.chars)
  const w = writePrompt({ home, text: '这是我的提示词', now: 1 })
  eq(w.ok, true, '写入应成功')
  eq(resolvePrompt({ home }).source, 'file', '写完之后以文件为准')
  eq(resolvePrompt({ home }).text, '这是我的提示词', '内容一致')
  eq(writePrompt({ home, text: '   ', now: 2 }).reason, 'empty', '空内容拒绝')
  eq(writePrompt({ home, text: 'x'.repeat(20001), now: 3 }).reason, 'too-long', '过长拒绝')
  const w2 = writePrompt({ home, text: '第二版', now: 4 })
  eq(w2.backup, join(home, 'po06-prompt.md.bak-4'), '第二次写要有备份')
  eq(readFileSync(w2.backup, 'utf8'), '这是我的提示词', '备份是上一版内容')
  const r = writePrompt({ home, reset: true, now: 5 })
  eq(r.reset, true, '重置成功')
  eq(resolvePrompt({ home }).source, 'builtin', '重置后回到内置')
})

// ── ④ 端到端：handler 的每个端点（含拒信分支）─────────────────────────
await t('handler：非 loopback Host / 缺写头 ⇒ 403，且**不落任何副作用**', async () => {
  const home = tmp()
  writeFileSync(join(home, 'po06.json'), JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }), 'utf8')
  const h = createControlHandler({ home })
  const bad1 = await call(h, { method: 'GET', url: API_PREFIX + '/status', headers: { host: 'evil.com' } })
  eq(bad1.status, 403, 'Host 非本机 ⇒ 403')
  eq(bad1.body.reason, 'host-not-loopback', '原因')
  const bad2 = await call(h, { method: 'POST', url: API_PREFIX + '/settings', body: { assist: 'off' }, headers: { host: '127.0.0.1:1' } })
  eq(bad2.status, 403, '缺写头 ⇒ 403')
  eq(JSON.parse(readFileSync(join(home, 'po06.json'), 'utf8')).assist, undefined, '被拒的写请求不得改动文件')
})

await t('handler：GET /status 与 GET /prompt、GET /turns', async () => {
  const home = tmp()
  writeFileSync(join(home, 'po06.json'), JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, detail: 'detailed' }, null, 2), 'utf8')
  writeFileSync(join(home, 'po06-wire.jsonl'), JSON.stringify({ at: 'a', ok: true, outcome: 'committed', packetChars: 7 }) + '\n', 'utf8')
  const h = createControlHandler({ home, version: '0.6.0-beta.6' })
  const s = await GET(h, API_PREFIX + '/status')
  eq(s.status, 200, '状态 200')
  eq(s.body.enabled, true, '已启用')
  eq(s.body.rollout, 'all', '灰度')
  eq(s.body.version, '0.6.0-beta.6', '版本')
  eq(s.body.settings.detail, 'detailed', '设置读出来了')
  eq(s.body.described.detail, '尽量补全', '给界面的是行为词')
  eq(s.body.prompt.source, 'builtin', '提示词来源')
  eq(s.headers['cache-control'], 'no-store', '不得被缓存')
  ok(!('access-control-allow-origin' in s.headers), '**不得**回 CORS 头')
  // ⚠ 启动闸门字段（settingsVersion/enabled/rollout）**不得**被当成"不认识的字段"报给界面：
  // 真机实测（EV-0141）时界面会因此显示"配置里有 3 处不规范"——假警报。
  eq(s.body.problems, [], '正常配置不得报 problems（闸门字段不是问题）：' + JSON.stringify(s.body.problems))
  const p = await GET(h, API_PREFIX + '/prompt')
  ok(typeof p.body.text === 'string' && p.body.text.length > 100, '提示词正文')
  const tn = await GET(h, API_PREFIX + '/turns?limit=3')
  eq(tn.body.turns.length, 1, '台账 1 条')
  eq((await GET(h, API_PREFIX + '/turns?limit=999')).body.limit, 50, 'limit 有上限')
  // 要求②：GET /help 走的是包里的真文件（这条 handler 用默认路径 ⇒ 真机装出来也是这样）
  const hp = await GET(h, API_PREFIX + '/help')
  eq(hp.status, 200, '/help 200')
  eq(hp.body.source, 'file', '默认路径要能读到包里的 HELP-0.6.md：' + JSON.stringify(hp.body.note || hp.body.path))
  ok(hp.body.chars > 500, '帮助正文不该是空的：' + hp.body.chars)
  ok(!/〔依据|不要显示给用户|实现时/.test(hp.body.text), '实现者注记不得漏给用户')
  eq((await GET(h, API_PREFIX + '/nope')).status, 404, '未知端点 404')
})

await t('handler：GET /state 需要 session，且只读该会话的状态文件', async () => {
  const home = tmp()
  mkdirSync(join(home, 'po06-state'), { recursive: true })
  writeFileSync(join(home, 'po06-state', 's1.json'), JSON.stringify({ sessionId: 's1', revision: 2, items: [{ id: 'a', text: '甲', sourceRefs: [{ kind: 'human' }] }] }), 'utf8')
  // ⚠ 穿越探针必须指向一个**真实存在、不在 stateDir 里、且长得像状态文件**的目标：
  //   · 第一次写成 `../../po06.json`：两种实现都解析到不存在的路径 ⇒ 都 404，变异体没被抓住；
  //   · 第二次写成普通对象 `{secret:…}`：即使读到了，`projectState` 也因"items 不是数组"返回 null ⇒ 仍 404
  //     （纵深防御生效，但测试依然没有区分力）。
  // 所以这里把它写成**结构合法的状态文件**——只有这样，"去消毒"才会真的泄露内容并被断言抓到。
  writeFileSync(join(home, 'secret.json'), JSON.stringify({
    sessionId: 'other-session', revision: 9,
    items: [{ id: 'leak', kind: 'user_requirement', status: 'active', text: '外部文件的秘密', sourceRefs: [{ kind: 'human' }] }],
  }), 'utf8')
  const h = createControlHandler({ home })
  eq((await GET(h, API_PREFIX + '/state')).status, 400, '缺 session ⇒ 400')
  const empty = await GET(h, API_PREFIX + '/state?session=nope')
  // "还没有状态"是正常情况：必须 200 + hasState:false，**不能** 404
  //（真机 DOM 探针实测：404 会让浏览器控制台报红，而界面一切正常）
  eq(empty.status, 200, '没有该会话的状态 ⇒ 200（不是 404）')
  eq(empty.body.hasState, false, '要明确告诉界面"还没状态"')
  eq(empty.body.counts.total, 0, '计数为 0')
  const r = await GET(h, API_PREFIX + '/state?session=s1')
  eq(r.status, 200, '有状态 ⇒ 200')
  eq(r.body.hasState, true, '要有 hasState:true')
  eq(r.body.counts, { total: 1, user: 1, machine: 0, unsourced: 0 }, '出处计数')
  // 会话 id 消毒：`../secret` 消毒后落成 `.._secret`（不存在）
  // ⚠ 断言必须看**内容**而不是状态码：改成"没有状态 ⇒ 200 + hasState:false"之后，
  // 用 404 当代理判据就失效了（两种实现都 200）。**内容**才是真正要守的东西。
  const esc = await GET(h, API_PREFIX + '/state?session=' + encodeURIComponent('../secret'))
  eq(esc.body.hasState, false, '路径穿越必须读不到东西（hasState 必须为 false）')
  ok(!JSON.stringify(esc.body).includes('不该被'), '响应里不得出现外部文件内容')
  ok(!JSON.stringify(esc.body).includes('外部文件的秘密'), '响应里不得出现外部文件内容（真实载荷）')
})

await t('handler：POST /settings 真写盘（原子+备份），非法值回落并上报', async () => {
  const home = tmp()
  const p = join(home, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }, null, 2) + '\n', 'utf8')
  const h = createControlHandler({ home, now: () => 42 })
  const r = await POST(h, API_PREFIX + '/settings', { detail: 'minimal', budget: 'generous' })
  eq(r.status, 200, '写入成功')
  eq(r.body.ok, true, 'ok')
  eq(r.body.settings.detail, 'minimal', '新值')
  eq(r.body.backup, p + '.bak-42', '有备份')
  const onDisk = JSON.parse(readFileSync(p, 'utf8'))
  eq(onDisk.detail, 'minimal', '落盘')
  eq(onDisk.enabled, true, '别人的字段保留')
  const bad = await POST(h, API_PREFIX + '/settings', { assist: 'autoo' })
  eq(bad.status, 200, '错值也照写（用默认值）')
  eq(bad.body.problems.length, 1, '但要上报')
  eq(bad.body.settings.assist, 'auto', '回落默认')
  const wrongType = await POST(h, API_PREFIX + '/settings', '不是对象')
  eq(wrongType.status, 400, 'body 不是 JSON 对象 ⇒ 400')
  eq(wrongType.body.reason, 'body-not-json', '原因')
})

await t('handler：POST /prompt 写覆盖；POST /rollback disable 生效、其余如实 501', async () => {
  const home = tmp()
  writeFileSync(join(home, 'po06.json'), JSON.stringify({ settingsVersion: 1, enabled: true }), 'utf8')
  const h = createControlHandler({ home, now: () => 7 })
  const w = await POST(h, API_PREFIX + '/prompt', { text: '自定义提示词' })
  eq(w.status, 200, '写入提示词')
  eq(readFileSync(join(home, 'po06-prompt.md'), 'utf8'), '自定义提示词', '落盘')
  const off = await POST(h, API_PREFIX + '/rollback', { kind: 'disable' })
  eq(off.status, 200, '关闭成功')
  eq(off.body.settings.assist, 'off', 'assist 已关')
  // P11 之后："包级"回退**真能做**了（宿主存了每会话 10 版非空包）；这里没接 hook ⇒ 如实 501 + 说清缺什么
  const pkt = await POST(h, API_PREFIX + '/rollback', { kind: 'packet' })
  eq(pkt.status, 501, '未接 pipeline 时包级回退如实 501')
  ok(/pipeline/.test(pkt.body.note || ''), '要说清缺的是 pipeline：' + pkt.body.note)
  // 条目级仍然没有（只有包级历史）⇒ 501 且**指到计划文件**，不假装成功
  const other = await POST(h, API_PREFIX + '/rollback', { kind: 'item' })
  eq(other.status, 501, '条目级回退：**如实说没做**')
  eq(other.body.reason, 'not-implemented', '原因')
  ok(/P9-UI-PLAN/.test(other.body.note), '指到计划文件')
})

// P11：包级回退接了 hook 之后要真的回退（并把"没有历史"如实报出来）
await t('handler：POST /rollback kind=packet —— 接上 hook 即生效；无历史如实 400', async () => {
  const home = tmp()
  const mk = (hook) => createControlHandler({ home, version: 't', rollbackPacket: hook })
  const okr = await POST(mk(async ({ sessionId }) => ({ ok: true, chars: 123, remaining: 2, sessionId })), API_PREFIX + '/rollback', { kind: 'packet', sessionId: 's1' })
  eq(okr.status, 200, '有 hook ⇒ 200')
  eq(okr.body.chars, 123, 'chars 透传')
  eq(okr.body.remaining, 2, '剩余版本数透传')
  const noHist = await POST(mk(async () => ({ ok: false, reason: 'no-history' })), API_PREFIX + '/rollback', { kind: 'packet', sessionId: 's1' })
  eq(noHist.status, 400, '没历史 ⇒ 400')
  eq(noHist.body.reason, 'no-history', '理由透传（不假装成功）')
})

// P11：前置拦截的按需解释端点（"第一轮发，第一轮就回"）。
// 要害是**失败必须能被客户端看见**（它据此按原文放行）——不许假装成功、不许把异常冒给连接。
await t('handler：POST /interpret —— 成功回包；无 hook 如实 501；hook 抛错由 handler 兜住', async () => {
  const home = tmp()
  const mk = (hook) => createControlHandler({ home, version: 't', interpret: hook })
  // ① 未接 hook（本 profile 不支持）⇒ 501 + 说明，而不是 500/静默
  const noHook = await POST(mk(undefined), API_PREFIX + '/interpret', { sessionId: 's1', text: '你好' })
  eq(noHook.status, 501, '无 hook 必须 501')
  eq(noHook.body.reason, 'not-implemented', '理由要明确')
  ok(/按原文放行/.test(noHook.body.note || ''), '要告诉客户端怎么办：' + noHook.body.note)
  // ② 正常：把 hook 的返回透出来
  const okHook = await POST(mk(async ({ sessionId, text }) => ({ ok: true, packet: '包:' + sessionId + ':' + text, chars: 6, ms: 12 })),
    API_PREFIX + '/interpret', { sessionId: 's1', text: '你好' })
  eq(okHook.status, 200, '成功 200')
  eq(okHook.body.ok, true, 'ok')
  eq(okHook.body.chars, 6, 'chars 透传')
  eq(okHook.body.ms, 12, 'ms 透传')
  ok(/包:s1:你好/.test(okHook.body.packet), 'packet 透传：' + okHook.body.packet)
  // ③ 没包（解释失败/档位关闭）⇒ 400 + reason，客户端据此按原文放行
  const noPacket = await POST(mk(async () => ({ ok: false, reason: 'no-packet' })), API_PREFIX + '/interpret', { sessionId: 's1', text: 'x' })
  eq(noPacket.status, 400, '没包 ⇒ 400')
  eq(noPacket.body.reason, 'no-packet', '理由透传')
  eq(noPacket.body.packet, '', '没包时不得回半截文本')
  // ④ hook 抛错：由 handler 的 try/catch 兜住 ⇒ 500（**不是**把异常冒到连接上）
  const threw = await POST(mk(async () => { throw new Error('boom') }), API_PREFIX + '/interpret', { sessionId: 's1', text: 'x' })
  eq(threw.status, 500, 'hook 抛错 ⇒ 500')
  ok(/handler-threw/.test(threw.body.reason || ''), '要标明是处理器抛的：' + threw.body.reason)
  // ⑤ 缺写头照样 403（这是写操作：它会改变"这一轮注入什么"）
  const noHead = await call(mk(async () => ({ ok: true })), { method: 'POST', url: API_PREFIX + '/interpret', body: { sessionId: 's', text: 'x' }, headers: {} })
  eq(noHead.status, 403, '缺写头必须 403')
})

await t('handler：超大 body 被拒（不许被打爆）', async () => {
  const home = tmp()
  const h = createControlHandler({ home })
  const res = await POST(h, API_PREFIX + '/settings', 'x'.repeat(MAX_BODY_BYTES + 10))
  eq(res.status, 400, '400')
  eq(res.body.reason, 'body-too-large', '原因')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-control-api', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '控制 API：信任判据（loopback Host / Origin / 写头）、出处投影、台账投影、提示词覆盖、端点行为。不联网、不起服务器。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
