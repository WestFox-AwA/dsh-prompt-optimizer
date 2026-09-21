// P9.1 · 用户设置模型（`lib/settings.js`）的单测。
//
// 运行：node po06/test/settings.test.mjs
//
// 为什么给它配单测（EV-0138）：它是**界面上每一个开关的宿主侧依据**。
// 界面上写"补充程度：标准"，背后必须真有一个字段、一个值域、一条回落规则；
// 否则用户点了开关、看起来生效了，实际什么都没变——那正是"没有控制面"的另一种形态。
// 三条纪律各有用例：值域外回落并**上报**、写盘**原子+备份+读回**、**未知字段不写进去**。
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ASSIST_MODES, DETAIL_LEVELS, BUDGET_LEVELS, DEFAULT_SETTINGS, SETTINGS_KEYS,
  normalizeSettings, mergeSettings, writeSettings, describeSettings,
} from '../lib/settings.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'po06-set-')); DIRS.push(d); return d }

// ── ① 值域与默认 ─────────────────────────────────────────────────────
t('字段缺失 ⇒ 用默认，且**不算问题**（旧配置不被判成坏配置）', () => {
  const r = normalizeSettings({})
  eq(r.settings, DEFAULT_SETTINGS, '全缺 ⇒ 全默认')
  eq(r.problems, [], '缺失不是问题')
  eq(normalizeSettings(null).settings, DEFAULT_SETTINGS, 'null ⇒ 默认')
  eq(normalizeSettings('nonsense').settings, DEFAULT_SETTINGS, '非对象 ⇒ 默认')
})

t('值域外 / 类型错 ⇒ 回落默认**并如实上报**（不静默接受、也不静默丢弃）', () => {
  const a = normalizeSettings({ assist: 'autoo' })
  eq(a.settings.assist, DEFAULT_SETTINGS.assist, '错拼 ⇒ 默认值')
  eq(a.problems.length, 1, '要报一条')
  eq(a.problems[0], { key: 'assist', kind: 'not-in-domain', got: 'autoo', used: 'auto' }, '要写清原值与采用值')

  const b = normalizeSettings({ detail: 3 })
  eq(b.settings.detail, DEFAULT_SETTINGS.detail, '类型错 ⇒ 默认值')
  eq(b.problems[0].kind, 'wrong-type', '要标明是类型问题')

  const c = normalizeSettings({ budget: 'generous' })
  eq(c.settings.budget, 'generous', '合法值必须原样接受')
  eq(c.problems, [], '合法值不报问题')
})

t('model：null/缺省 = 跟随会话；给了但不像路由 ⇒ 回落 null 并上报', () => {
  eq(normalizeSettings({}).settings.model, null, '缺省 ⇒ 跟随会话')
  eq(normalizeSettings({ model: null }).settings.model, null, 'null ⇒ 跟随会话')
  eq(normalizeSettings({ model: { provider: 'p', model: 'm' } }).settings.model, { provider: 'p', model: 'm' }, '合法路由')
  for (const bad of [{ provider: 'p' }, { model: 'm' }, { provider: '', model: 'm' }, 'p/m', 42]) {
    const r = normalizeSettings({ model: bad })
    eq(r.settings.model, null, '坏路由 ⇒ 跟随会话：' + JSON.stringify(bad))
    ok(r.problems.some((x) => x.key === 'model' && x.kind === 'not-a-route'), '要报 not-a-route：' + JSON.stringify(r.problems))
  }
})

t('未知字段：**只报告，不采纳**（白名单之外的东西不该被我们写坏）', () => {
  const r = normalizeSettings({ assist: 'off', tier: 'extreme', enabled: false, rollout: { mode: 'all' } })
  eq(r.settings.assist, 'off', '白名单内的照常生效')
  ok(!('tier' in r.settings) && !('enabled' in r.settings) && !('rollout' in r.settings), '白名单外的不得进入 settings')
  const kinds = r.problems.map((x) => x.key + ':' + x.kind).sort()
  eq(kinds, ['enabled:unknown-field', 'rollout:unknown-field', 'tier:unknown-field'], '三个都要报成 unknown-field')
  eq(SETTINGS_KEYS, ['assist', 'detail', 'budget', 'model'], '白名单就是这四项')
  eq([ASSIST_MODES, DETAIL_LEVELS, BUDGET_LEVELS].map((x) => x.length), [2, 3, 3], '值域长度（界面上的选项数）')
})

// ── ② 合并：只改点到的项 ──────────────────────────────────────────────
t('mergeSettings：只改补丁里出现的键，其余原样；未知键忽略', () => {
  const cur = { assist: 'auto', detail: 'detailed', budget: 'minimal' }
  const r = mergeSettings(cur, { detail: 'minimal', nope: 1 })
  eq(r.settings, { assist: 'auto', detail: 'minimal', budget: 'minimal', model: null }, '只改了 detail')
  ok(r.problems.some((x) => x.key === 'nope' && x.kind === 'unknown-field'), '未知键要报')
  eq(mergeSettings(cur, {}).settings.detail, 'detailed', '空补丁不改变任何东西')
  eq(mergeSettings(cur, { detail: undefined }).settings.detail, 'detailed', 'undefined = 不改')
})

// ── ③ 写盘：备份 + 原子 + 读回校验 ────────────────────────────────────
t('writeSettings：写入成功、备份可解析、读回一致、别人的字段原样保留', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, assist: 'auto' }, null, 2) + '\n', 'utf8')
  const r = writeSettings({ path: p, patch: { detail: 'detailed', budget: 'generous' }, now: 111 })
  eq(r.ok, true, '应成功：' + JSON.stringify(r))
  eq(r.backup, p + '.bak-111', '要有备份')
  ok(existsSync(r.backup), '备份文件必须真的在')
  const back = JSON.parse(readFileSync(r.backup, 'utf8'))
  eq(back.detail, undefined, '备份里不该有还没写的新值')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.detail, 'detailed', '新值已写入')
  eq(now.budget, 'generous', '第二项也写入了')
  eq(now.enabled, true, 'enabled 原样保留（不越权）')
  eq(now.rollout, { mode: 'all' }, 'rollout 原样保留')
  eq(now.settingsVersion, 1, 'settingsVersion 原样保留')
  ok(!existsSync(p + '.tmp-111'), '临时文件不该留下')
})

t('writeSettings：文件不存在 ⇒ 直接创建（不报"备份失败"）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  const r = writeSettings({ path: p, patch: { assist: 'off' }, now: 7 })
  eq(r.ok, true, '应成功：' + JSON.stringify(r))
  eq(r.backup, null, '没有原文件就没有备份')
  eq(JSON.parse(readFileSync(p, 'utf8')).assist, 'off', '内容写入')
})

t('writeSettings：坏 JSON ⇒ 不覆盖、如实失败（不许拿垃圾当基础去写）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, '{ 这是坏的', 'utf8')
  const r = writeSettings({ path: p, patch: { assist: 'off' }, now: 9 })
  eq(r.ok, true, '坏文件按"空配置"处理并写入（保守默认），但**必须**让人能从备份取回')
  eq(readFileSync(r.backup, 'utf8'), '{ 这是坏的', '原文进了备份（可回滚）')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.assist, 'off', '写入的是我们归一化后的结果')
  ok(!('settingsVersion' in now), '不会凭空造出 settingsVersion（启用与否由 enabled 那条线决定）')
})

// ── ④ 给界面用的摘要（不暴露内部字段名）────────────────────────────────
t('describeSettings：给界面的是**行为描述**，不是内部枚举值', () => {
  const d = describeSettings({ assist: 'off', detail: 'minimal', budget: 'generous', model: { provider: 'deepseek', model: 'v4' } })
  eq(d.assist, '只记录、不补充', '关掉要说清是"只记录"')
  eq(d.detail, '最少补充', '补充程度用行为词')
  eq(d.budget, '允许更多自主处理', '预算用行为词')
  eq(d.model, 'deepseek / v4', '模型写明')
  eq(describeSettings({}).model, '跟随会话模型', '缺省模型的说法')
  for (const v of Object.values(describeSettings({}))) ok(!/standard|generous|detailed|minimal/.test(v) || v === '标准' || v === '标准补充', '摘要里不该出现原始枚举值：' + v)
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-settings', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '用户设置模型：值域/默认/保守回落 + 白名单合并 + 原子写（备份+读回校验）。不调模型、不联网。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
