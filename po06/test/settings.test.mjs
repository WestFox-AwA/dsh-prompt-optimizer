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
  TIER_LEVELS, PERMISSIONS, HISTORY_MODES,
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
  // ⚠ P10 起契约变了（EV-0148）：`tier` 不再是"不认识的字段"，而是**合法的"糖"键**
  //   （一次写 assist/detail/budget 三项，且**自己不落盘**，由三项反推）。
  //   所以这里要分开报：白名单外 = `unknown-field`（字段名写错了）；
  //   认识但值不在域内 = `not-in-domain`（值写错了）。合成一个码就查不出问题在哪。
  const r = normalizeSettings({ assist: 'off', tier: 'extreme', enabled: false, rollout: { mode: 'all' } })
  eq(r.settings.assist, 'off', '白名单内的照常生效')
  ok(!('tier' in r.settings) && !('enabled' in r.settings) && !('rollout' in r.settings), '白名单外的不得进入 settings')
  const kinds = r.problems.map((x) => x.key + ':' + x.kind).sort()
  eq(kinds, ['enabled:unknown-field', 'rollout:unknown-field', 'tier:not-in-domain'], '不认识 vs 值不在域内，必须分开报')
  eq(SETTINGS_KEYS, ['assist', 'detail', 'budget', 'model', 'permission', 'historyMode', 'turns', 'readTools', 'bash', 'effortByModel', 'bySession', 'framing', 'slashReview', 'reasoningBoost', 'reasoningMode', 'reasoningCandidates', 'reasoningRounds', 'reasoningPace', 'englishMode'],
    '白名单：P10 四项 + 0.7.2 的 bash + 0.8 的 slashReview（斜杠命令名单，默认空）')
  eq([ASSIST_MODES, DETAIL_LEVELS, BUDGET_LEVELS].map((x) => x.length), [2, 3, 3], '值域长度（界面上的选项数）')
  eq(TIER_LEVELS, ['off', 'light', 'standard', 'heavy'], '档位就是四个：关闭/轻度/标准/重度')
  eq(PERMISSIONS, ['review', 'auto'], '权限两项')
  eq(HISTORY_MODES, ['turns', 'full'], '上下文模式两项')
})

// ── ② 合并：只改点到的项 ──────────────────────────────────────────────
t('mergeSettings：只改补丁里出现的键，其余原样；未知键忽略', () => {
  const cur = { assist: 'auto', detail: 'detailed', budget: 'minimal' }
  const r = mergeSettings(cur, { detail: 'minimal', nope: 1 })
  // 合并结果现在是**归一化后的完整形状**（P10 的四项缺失即补默认值）——
  // 旧断言只列了四项，会把"补上的默认值"读成"改了别的键"，所以按当前契约写全。
  eq(r.settings, {
    assist: 'auto', detail: 'minimal', budget: 'minimal', model: null,
    effortByModel: DEFAULT_SETTINGS.effortByModel,
    bySession: DEFAULT_SETTINGS.bySession,
    framing: DEFAULT_SETTINGS.framing,
    reasoningBoost: DEFAULT_SETTINGS.reasoningBoost, reasoningMode: DEFAULT_SETTINGS.reasoningMode,
    reasoningCandidates: DEFAULT_SETTINGS.reasoningCandidates, reasoningRounds: DEFAULT_SETTINGS.reasoningRounds, reasoningPace:DEFAULT_SETTINGS.reasoningPace,
    englishMode:DEFAULT_SETTINGS.englishMode,
    permission: DEFAULT_SETTINGS.permission, historyMode: DEFAULT_SETTINGS.historyMode,
    turns: DEFAULT_SETTINGS.turns, readTools: DEFAULT_SETTINGS.readTools,
    bash: DEFAULT_SETTINGS.bash,
    slashReview: DEFAULT_SETTINGS.slashReview,
  }, '只改了 detail，其余（含 P10 四项默认值、0.7.2 的 bash 与 0.8 的空名单）照默认')
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

t('writeSettings：坏 JSON ⇒ 原文备份 + 从备份捞回"启用意图"字段（真机数据丢失事故的修复）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  // 先造一份**好配置**（带启用意图）并写一次，让它留下 .bak-*
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, assist: 'auto' }), 'utf8')
  const good = writeSettings({ path: p, patch: { detail: 'detailed' }, now: 8 })
  eq(good.ok, true, '第一次写入成功')
  ok(good.backup, '有备份：' + good.backup)
  // 再把主文件写坏，模拟"读不出来"（BOM / 半截 / 手改坏）
  writeFileSync(p, '{ 这是坏的', 'utf8')
  // ⚠ 刻意用**非档位键**（permission）：issue #16 之后写档位键会同步"启用意图"，那是另一条语义；
  //   本条要钉的是"坏文件读不出来时不许丢启用字段"，两者必须各自独立可验证。
  const r = writeSettings({ path: p, patch: { permission: 'auto' }, now: 9 })
  eq(r.ok, true, '坏文件按"空配置"处理并写入，但**必须**能从备份取回')
  eq(readFileSync(r.backup, 'utf8'), '{ 这是坏的', '原文进了备份（可回滚）')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.permission, 'auto', '写入的是我们归一化后的结果')
  // ⚠ 判据更新（2026-09-22 真机：配置被一次设置写入**重置成默认值**，启用字段全丢 ⇒ 插件静默不启用）：
  //   `settingsVersion` 是"这份配置是 0.6 写的"这个标记，**必须有**，否则插件再也不被认作自己的配置；
  //   `enabled`/`rollout` 也在读不出来时从最近备份捞回来（**不凭空造**）。
  eq(now.settingsVersion, 1, 'settingsVersion 标记必须在（否则 ours=false ⇒ 永远不启用）')
  eq(now.enabled, true, '从备份捞回用户原来的 enabled（不凭空造，也不静默丢掉）')
  eq(now.rollout && now.rollout.mode, 'all', 'rollout 同样从备份捞回')
  eq(r.gateRepaired, true, '这次是"修复性写入"，要如实上报')
  ok(String(r.recoveredGateFrom || '').includes('.bak-'), '要说明从哪份备份捞的：' + r.recoveredGateFrom)
})

t('writeSettings：带 BOM 的配置**必须照常读**（不许当成空配置重写，更不许丢启用字段）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  // Windows 上 PowerShell / 记事本写出的 UTF-8 带 BOM —— 真机里就是它把配置"变成空的"
  writeFileSync(p, '\uFEFF' + JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' }, assist: 'auto', detail: 'minimal' }), 'utf8')
  const r = writeSettings({ path: p, patch: { budget: 'generous' }, now: 11 })
  eq(r.ok, true, '写入成功')
  eq(r.recoveredFromCorrupt, false, '带 BOM 的文件**不是**坏文件（旧实现当成坏/空 ⇒ 重写成默认值）')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, true, 'enabled 保留')
  eq(now.rollout.mode, 'all', 'rollout 保留')
  eq(now.assist, 'auto', '设置项保留')
  eq(now.budget, 'generous', '补丁生效')
  eq(now.detail, 'minimal', '其它设置项也保留（没有被默认值覆盖）')
  ok(!/\uFEFF/.test(readFileSync(p, 'utf8')), '写出来的文件不带 BOM')
})

// ── ④ 给界面用的摘要（不暴露内部字段名）────────────────────────────────
t('describeSettings：给界面的是**行为描述**，不是内部枚举值', () => {
  const d = describeSettings({ assist: 'off', detail: 'minimal', budget: 'generous', model: { provider: 'deepseek', model: 'v4' } })
  eq(d.assist, '只记录、不补充', '关掉要说清是"只记录"')
  eq(d.detail, '最少补充', '补充程度用行为词')
  eq(d.budget, '允许更多自主处理', '预算用行为词')
  eq(d.model, 'deepseek / v4', '模型写明')
  eq(describeSettings({}).model, '跟随会话模型', '缺省模型的说法')
  // 只扫**描述性**字段：`tier` 是机器标识（值必须是枚举，配 `tierLabel` 给界面读），
  // 不是"给用户看的文字"。0.7.0 起默认档由 light 变为 standard（见 TIER_PRESETS），
  // 该标识字段因此第一次被这条断言扫到——这里把范围说清，而不是把标识也当日志文案。
  for (const [k, v] of Object.entries(describeSettings({}))) {
    if (k === 'tier') continue
    ok(!/standard|generous|detailed|minimal/.test(String(v)) || v === '标准' || v === '标准补充', '摘要里不该出现原始枚举值：' + k + '=' + v)
  }
})


// ── ③b issue #16：写档位**必须**同步"启用意图"，否则面板永远开不了插件 ────────
// 报告者实测（0.7.6，只动面板）：`/status` 恒 `enabled:false / rollout:"off" / rolloutDefaulted:true`，
// 台账 43 条 `reason:"gate-disabled" / gate:"rollout-off"`、成功包 0 条 —— 因为**全包没有任何代码**
// 会写 `enabled:true`（`GATE_KEYS` 只是"原样保留"）。下面把四条边界都钉住。
t('写档位 ⇒ 自动补 enabled:true / rollout:all（全新安装的"面板拨档位"路径）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  // 全新安装：文件里**没有** enabled/rollout（这正是报告者的现场）
  writeFileSync(p, JSON.stringify({ settingsVersion: 1 }, null, 2) + '\n', 'utf8')
  const r = writeSettings({ path: p, patch: { tier: 'standard' }, now: 21 })
  eq(r.ok, true, '写入成功：' + JSON.stringify(r))
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, true, '写档位必须把启用意图写出来（否则 gate:rollout-off）')
  eq(now.rollout && now.rollout.mode, 'all', 'rollout 也要补齐（闸门只认这两个字段）')
  eq(now.settingsVersion, 1, '0.6 自己的配置标记仍在')
})

t('档位="关闭" ⇒ 显式写 enabled:false + rollout:{mode:off}（理由码是用户的选择）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }), 'utf8')
  const r = writeSettings({ path: p, patch: { tier: 'off' }, now: 22 })
  eq(r.ok, true, '写入成功')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, false, '关档要真的关')
  eq(now.rollout && now.rollout.mode, 'off', '写显式 off（不是回落来的 off）')
})

t('灰度名单不许被档位写入动到（只补 enabled，名单原样）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: false, rollout: { mode: 'allowlist', sessions: ['s-1'] } }), 'utf8')
  const r = writeSettings({ path: p, patch: { tier: 'light' }, now: 23 })
  eq(r.ok, true, '写入成功')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, true, '用户拨了非关闭档 ⇒ 应当启用')
  eq(now.rollout && now.rollout.mode, 'allowlist', '**不得**把灰度名单改成 all')
  eq(JSON.stringify(now.rollout.sessions), JSON.stringify(['s-1']), '名单内容也不许动')
})

t('改非档位项（模型/权限/上下文/bash）不碰启用意图', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: false, rollout: { mode: 'off' } }), 'utf8')
  for (const patch of [{ permission: 'review' }, { model: { provider: 'p', model: 'm' } }, { readTools: true }, { bash: false }, { turns: 3 }]) {
    const r = writeSettings({ path: p, patch, now: 24 })
    eq(r.ok, true, '写入成功：' + JSON.stringify(patch))
    const now = JSON.parse(readFileSync(p, 'utf8'))
    eq(now.enabled, false, '改 ' + JSON.stringify(patch) + ' 不该顺手把插件打开')
    eq(now.rollout && now.rollout.mode, 'off', 'rollout 同样不动')
  }
})

// ── ③c issue #27：**按会话**拨档位同样要写启用意图 ──────────────────────────
// 面板切档位走的是 `bySession`（client.js：`save({ bySession: replaceTier(v) })`），
// 而 #16 的修法只认顶层四个键 ⇒「新装 → 进会话 → 拨档位」这条路上 `enabled` 永远不写，
// 闸门一律 `gate:rollout-off`，用户看到的是"插件装了却什么都不做"（报告者原话）。
t('按会话拨档位（bySession）⇒ 同样补 enabled:true / rollout:all（issue #27）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1 }, null, 2) + '\n', 'utf8')
  const r = writeSettings({ path: p, patch: { bySession: { 's-1': { tier: 'heavy' } } }, now: 25 })
  eq(r.ok, true, '写入成功：' + JSON.stringify(r))
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, true, '按会话拨档位也必须写出启用意图（否则 gate:rollout-off）')
  eq(now.rollout && now.rollout.mode, 'all', 'rollout 同样补齐')
  eq(now.bySession['s-1'].tier, 'heavy', '按会话的档位本身照旧落盘')
})

t('按会话设为"关闭" ⇒ **不许**关掉整个插件（只开不关）', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }), 'utf8')
  const r = writeSettings({ path: p, patch: { bySession: { 's-1': { tier: 'off' } } }, now: 26 })
  eq(r.ok, true, '写入成功')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, true, '某一场关掉不代表整个插件要关：这里不得写 false')
  eq(now.rollout && now.rollout.mode, 'all', 'rollout 不得被改成 off')
})

t('按会话只改 framing 等非档位项 ⇒ 不碰启用意图', () => {
  const dir = tmp(); const p = join(dir, 'po06.json')
  writeFileSync(p, JSON.stringify({ settingsVersion: 1, enabled: false, rollout: { mode: 'off' } }), 'utf8')
  const r = writeSettings({ path: p, patch: { bySession: { 's-1': { framing: 'hard' } } }, now: 27 })
  eq(r.ok, true, '写入成功')
  const now = JSON.parse(readFileSync(p, 'utf8'))
  eq(now.enabled, false, '非档位项不该顺手把插件打开')
  eq(now.bySession['s-1'].framing, 'hard', 'framing 照旧落盘')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-settings', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '用户设置模型：值域/默认/保守回落 + 白名单合并 + 原子写（备份+读回校验）。不调模型、不联网。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
