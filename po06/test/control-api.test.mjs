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
  const p = await GET(h, API_PREFIX + '/prompt')
  ok(typeof p.body.text === 'string' && p.body.text.length > 100, '提示词正文')
  const tn = await GET(h, API_PREFIX + '/turns?limit=3')
  eq(tn.body.turns.length, 1, '台账 1 条')
  eq((await GET(h, API_PREFIX + '/turns?limit=999')).body.limit, 50, 'limit 有上限')
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
  eq((await GET(h, API_PREFIX + '/state?session=nope')).status, 404, '没有该会话 ⇒ 404')
  const r = await GET(h, API_PREFIX + '/state?session=s1')
  eq(r.status, 200, '有状态 ⇒ 200')
  eq(r.body.counts, { total: 1, user: 1, machine: 0, unsourced: 0 }, '出处计数')
  // 会话 id 消毒：`../secret` 在消毒后落成 `.._secret`（不存在），未消毒则会读到 home 下的 secret.json
  const esc = await GET(h, API_PREFIX + '/state?session=' + encodeURIComponent('../secret'))
  eq(esc.status, 404, '路径穿越必须读不到东西（读到了就是任意文件泄露）')
  ok(!JSON.stringify(esc.body).includes('不该被'), '响应里不得出现外部文件内容')
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
  const other = await POST(h, API_PREFIX + '/rollback', { kind: 'packet' })
  eq(other.status, 501, '包级回退：**如实说没做**')
  eq(other.body.reason, 'not-implemented', '原因')
  ok(/P9-UI-PLAN/.test(other.body.note), '指到计划文件')
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
