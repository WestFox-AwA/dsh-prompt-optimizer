// P8 · 装配期启用闸门单测（纯函数 + 缓存，无宿主、无浏览器）。
// 运行：node po06/test/assembly-gate.test.mjs
//
// 这个文件要守住的三件事，每一件都对应一个**真实事故形态**：
//   ① 未决 ≠ 启用：text() 是同步的、探测是异步的，未决期间若放行就等于没守卫。
//   ② 旧插件的 enabled 不得冒充新版的启用决定（本机 0.5.x 的配置里就有 enabled:true）。
//   ③ 拿不到作用域时不得当作"旧插件不在装"（ADR-0033）。
import {
  createEnableGate, parseEnableIntent, resolveEnableDecision, toActiveTriState, PENDING,
} from '../lib/assembly-gate.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
async function t(name, fn) {
  try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. 缓存语义 ─────────────────────────────────────────────────────
await t('未判定时读到的必须是 PENDING（=不启用）', async () => {
  const g = createEnableGate({ decide: async () => ({ enabled: true, code: 'enabled' }) })
  eq(g.statusFor('a'), PENDING, '未触发前')
  eq(g.statusFor('a').enabled, false, '未判定绝不能是启用')
  eq(g.statusFor('').enabled, false, '空 id 也不能启用')
  eq(g.statusFor(null).enabled, false, 'null id 也不能启用')
})

await t('判定完成后按结论生效，且只判定一次', async () => {
  let calls = 0
  const g = createEnableGate({ decide: async () => { calls += 1; return { enabled: true, code: 'enabled', reason: null } } })
  g.ensure('a')
  await sleep(5)
  eq(calls, 1, '第一次 ensure 触发一次判定')
  eq(g.statusFor('a').enabled, true, '结论生效')
  g.ensure('a'); g.ensure('a')
  await sleep(5)
  eq(calls, 1, '已判定则不重复判定（幂等）')
})

await t('判定抛错 → 保守不启用，且错误原文留档（不吞）', async () => {
  const g = createEnableGate({ decide: async () => { throw new Error('PO06-GATE-BOOM') } })
  g.ensure('a')
  await sleep(5)
  const s = g.statusFor('a')
  eq(s.enabled, false, '出错必须不启用')
  eq(s.code, 'decision-error', 'code 必须标明是判定出错')
  ok(/PO06-GATE-BOOM/.test(s.reason), '错误原文必须留档：' + s.reason)
})

await t('会话之间互不串扰（per-agent 隔离）', async () => {
  const g = createEnableGate({ decide: async (sid) => ({ enabled: sid === 'a', code: sid === 'a' ? 'enabled' : 'rollout-off' }) })
  g.ensure('a'); g.ensure('b')
  await sleep(5)
  eq(g.statusFor('a').enabled, true, 'a 启用')
  eq(g.statusFor('b').enabled, false, 'b 不启用')
  eq(g.size(), 2, '两个会话各一条')
})

// ── 2. 配置解析：绝不让旧配置冒充新版的启用决定 ──────────────────────
await t('带 BOM 的合法配置**必须**认（EV-0132：Windows 记事本 / PowerShell 都会写 BOM）', () => {
  const good = JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } })
  const clean = parseEnableIntent(good)
  eq(clean.ours, true, '不带 BOM 的基准：ours=true')
  eq(clean.settings.enabled, true, '基准：enabled=true')

  const bom = parseEnableIntent('\uFEFF' + good)
  eq(bom.reason === 'config-unparsable', false, '不得因为一个 BOM 就判"读不懂"：' + JSON.stringify(bom))
  eq(bom.ours, true, '带 BOM 也要认出是 0.6 的配置')
  eq(bom.settings.enabled, true, '带 BOM 时启用意图必须照样生效')
  eq(bom.rollout.mode, 'all', '灰度模式也要解析出来')

  // 反面：BOM 之外照旧严格 —— 真的坏 JSON 仍然是"读不懂"
  eq(parseEnableIntent('\uFEFF' + '{oops').reason, 'config-unparsable', '坏 JSON 仍要拒')
  eq(parseEnableIntent('\uFEFF[1,2]').reason, 'config-not-an-object', '数组仍要拒')
})

await t('旧插件写的配置（无 settingsVersion）一律**不启用** 0.6', async () => {
  // 本机 0.5.x 配置的真实形态：有 enabled:true，但没有 0.6 的 settingsVersion
  const legacy = JSON.stringify({ enabled: true, tier: 'full', strategy: 'balanced' })
  const i = parseEnableIntent(legacy)
  eq(i.settings.enabled, false, '旧版的 enabled:true 绝不能被当成"已启用 0.6"（ADR-0030）')
  eq(i.rollout.mode, 'off', '旧配置里没有灰度字段 → 保守 off')
  eq(i.reason, 'not-a-0.6-config', '必须说明为什么不采纳')
  const d = resolveEnableDecision({ intent: i, sessionId: 's1', oldPluginActive: false })
  eq(d.enabled, false, '即使旧插件已卸载，也不能凭旧配置启用')
})

await t('坏内容/坏类型/空值一律保守', async () => {
  for (const bad of ['', 'not json', '{', 'null', '[]', '"str"', '42']) {
    const i = parseEnableIntent(bad)
    eq(i.settings.enabled, false, 'bad=' + JSON.stringify(bad))
    eq(i.rollout.mode, 'off', 'bad=' + JSON.stringify(bad))
  }
  // 0.6 自己的配置但内容缺失 → 仍是不启用
  const i = parseEnableIntent(JSON.stringify({ settingsVersion: 1 }))
  eq(i.settings.enabled, false, 'settingsVersion 在但 enabled 缺 → 不启用')
  eq(i.rollout.mode, 'off', 'rollout 缺 → off')
})

await t('0.6 自己写的配置：enabled 与 rollout 都被采纳', async () => {
  const i = parseEnableIntent(JSON.stringify({
    settingsVersion: 1, enabled: true, rollout: { mode: 'allowlist', sessions: ['s1'] },
  }))
  eq(i.ok, true, 'ok')
  eq(i.settings.enabled, true, 'enabled 采纳')
  eq(i.rollout.mode, 'allowlist', 'rollout 采纳')
  eq(resolveEnableDecision({ intent: i, sessionId: 's1', oldPluginActive: false }).enabled, true, '在名单里且旧插件不在 → 启用')
  eq(resolveEnableDecision({ intent: i, sessionId: 's2', oldPluginActive: false }).code, 'session-not-in-allowlist', '不在名单 → 不启用')
})

// ── 3. 三重判定的合成 ───────────────────────────────────────────────
// ⚠ `rollout` 缺失/写错时的语义（2026-09-22 用户要求查清 `gate:rollout-off`）：
//   旧行为：回落 off ⇒ **一律不启用**，哪怕用户显式写了 `enabled: true` ⇒ 界面上显示"已启用"、
//           实际什么都不做（EV-0078 那一类"安静地不做事"）。
//   新口径：**显式 off 是决定**（照旧不启用）；**缺失或值不认识是回落**（以显式 enabled 为准，按 all 启用 + note）。
await t('rollout 缺失/写错 + enabled:true ⇒ 按 all 启用（回落不等于用户说要关）；显式 off 才是不启用', async () => {
  const noRollout = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true }))
  eq(noRollout.ok, true, '0.6 自己的配置')
  eq(noRollout.rollout.mode, 'off', '归一化仍然是 off（保守值）')
  eq(noRollout.rollout.defaulted, true, '但要标出"这是回落来的"')
  const d1 = resolveEnableDecision({ intent: noRollout, sessionId: 's1', oldPluginActive: false })
  eq(d1.enabled, true, '显式 enabled:true ⇒ 启用（不再静默不做事）')
  eq(d1.code, 'enabled', 'code')
  ok(/rollout/.test(d1.note || ''), '要如实说明"rollout 是回落来的"：' + d1.note)

  const bogus = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'on' } }))
  eq(resolveEnableDecision({ intent: bogus, sessionId: 's1', oldPluginActive: false }).enabled, true, '值写错同样按回落处理')

  const explicitOff = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'off' } }))
  const d2 = resolveEnableDecision({ intent: explicitOff, sessionId: 's1', oldPluginActive: false })
  eq(d2.enabled, false, '显式 off 是用户的选择 ⇒ 不启用')
  eq(d2.code, 'rollout-off', '理由码')

  const disabled = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: false }))
  const d3 = resolveEnableDecision({ intent: disabled, sessionId: 's1', oldPluginActive: false })
  eq(d3.enabled, false, 'enabled:false + 没有 rollout ⇒ 仍然不启用')
})

const OURS_ON = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }))

await t('旧插件仍在装配 → DOUBLE_INTERCEPT，绝不启用', async () => {
  const d = resolveEnableDecision({ intent: OURS_ON, sessionId: 's1', oldPluginActive: true })
  eq(d.enabled, false, '绝不启用')
  eq(d.code, 'DOUBLE_INTERCEPT', '必须是这个 code')
  ok(/卸载/.test(d.reason || ''), '理由要给出下一步：' + d.reason)
})

await t('拿不到作用域（null/undefined）→ 不启用，且**不得**说成"不在装"', async () => {
  for (const v of [null, undefined]) {
    const d = resolveEnableDecision({ intent: OURS_ON, sessionId: 's1', oldPluginActive: v })
    eq(d.enabled, false, '保守不启用')
    eq(d.code, 'old-plugin-unknown', 'code 必须区分于 enabled/DOUBLE_INTERCEPT')
    ok(!/不在装/.test(d.reason || ''), '绝不能声称旧插件不在装：' + d.reason)
  }
})

await t('设置未启用 → settings-disabled（灰度开了也不放行）', async () => {
  const off = parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: false, rollout: { mode: 'all' } }))
  const d = resolveEnableDecision({ intent: off, sessionId: 's1', oldPluginActive: false })
  eq(d.enabled, false, '不启用')
  eq(d.code, 'settings-disabled', 'code 正确')
})

await t('三件事都满足 → 才是 enabled', async () => {
  const d = resolveEnableDecision({ intent: OURS_ON, sessionId: 's1', oldPluginActive: false })
  eq(d.enabled, true, '启用')
  eq(d.code, 'enabled', 'code 正确')
})

await t('intent 缺失/非法时 resolve 不得抛错（保守兜底）', async () => {
  for (const bad of [null, undefined, {}, { ok: false }]) {
    const d = resolveEnableDecision({ intent: bad, sessionId: 's1', oldPluginActive: false })
    eq(d.enabled, false, 'intent=' + JSON.stringify(bad))
  }
})

await t('旧插件探测三态：只有 confidence:runtime 才配说"确实不在装"', async () => {
  // mergeOldPluginSignals 在"拿不到作用域"时也返回 active:false —— 不能照抄
  eq(toActiveTriState({ active: true, confidence: 'runtime' }), true, '命中 → true')
  eq(toActiveTriState({ active: false, confidence: 'runtime' }), false, '读到装配结果且无旧上下文 → 确实不在装')
  eq(toActiveTriState({ active: false, confidence: 'unknown', reason: 'no-agent-scope' }), null,
    '拿不到作用域 → **null（不知道）**，绝不是 false')
  eq(toActiveTriState({ active: false, confidence: 'unknown', reason: 'no-systemPrompt-service' }), null, '缺服务 → null')
  eq(toActiveTriState({ active: false, confidence: 'unknown', reason: 'assemble-failed:x' }), null, '装配失败 → null')
  eq(toActiveTriState(null), null, 'null → null')
  eq(toActiveTriState(undefined), null, 'undefined → null')

  // 端到端：unknown 经 resolve 之后必须是"不启用"
  const d = resolveEnableDecision({ intent: OURS_ON, sessionId: 's1', oldPluginActive: toActiveTriState({ active: false, confidence: 'unknown' }) })
  eq(d.enabled, false, 'unknown 不得启用')
  eq(d.code, 'old-plugin-unknown', 'code 正确')
})

// ── 4. 判定的**保质期**（防"判一次就永久信"）─────────────────────────
// 安全关键：插件可以**运行时注入**。若某会话在"旧插件不在装"时被合法启用，
// 之后旧插件被注入进来，而缓存里那句 enabled:true 永久有效 ⇒ **两个拦截器同时生效**
// ——正是双重拦截守卫要防的事故。最初的实现就是永久缓存（status 永不为 'error'），
// 这一段把它钉住。
await t('新鲜判定不重复判定（幂等仍然成立）', async () => {
  let calls = 0
  const g = createEnableGate({ decide: async () => { calls += 1; return { enabled: true, code: 'enabled' } }, ttlMs: 1000, now: () => 1000 })
  g.ensure('a'); await sleep(5); g.ensure('a'); g.ensure('a')
  await sleep(5)
  eq(calls, 1, '保质期内不得重复判定')
  eq(g.statusFor('a').enabled, true, '新鲜结论生效')
})

await t('过期后**必须重判**，且过期期间不得继续放行', async () => {
  let clock = 1000
  let calls = 0
  const g = createEnableGate({
    decide: async () => { calls += 1; return { enabled: true, code: 'enabled' } },
    ttlMs: 500, now: () => clock,
  })
  g.ensure('a'); await sleep(5)
  eq(calls, 1, '第一次判定')
  clock += 400
  eq(g.statusFor('a').enabled, true, '未过期仍生效')
  clock += 200                                     // 越过 500ms
  const stale = g.statusFor('a')
  eq(stale.enabled, false, '**过期即按未判定处理**：不得继续放行')
  ok(/过期/.test(stale.reason || ''), '理由要说明过期：' + stale.reason)
  g.ensure('a'); await sleep(5)
  eq(calls, 2, '过期后必须重新判定')
})

await t('**安全方向**：旧插件在上次判定之后出现 ⇒ 重判必须撤销启用', async () => {
  let clock = 1000
  let oldPluginAppeared = false
  const g = createEnableGate({
    decide: async () => (oldPluginAppeared
      ? { enabled: false, code: 'DOUBLE_INTERCEPT', reason: '旧版插件仍在装配中' }
      : { enabled: true, code: 'enabled', reason: null }),
    ttlMs: 500, now: () => clock,
  })
  g.ensure('a'); await sleep(5)
  eq(g.statusFor('a').enabled, true, '前提：一开始是启用的')

  oldPluginAppeared = true                         // 运行时注入了旧插件
  clock += 600                                     // 越过保质期
  eq(g.statusFor('a').enabled, false, '过期窗口内**不得**继续放行（否则双重拦截）')
  g.ensure('a'); await sleep(5)
  const after = g.statusFor('a')
  eq(after.enabled, false, '重判后必须撤销')
  eq(after.code, 'DOUBLE_INTERCEPT', 'code 正确')
})

await t('invalidate() 立刻撤销，不必等保质期', async () => {
  let calls = 0
  const g = createEnableGate({ decide: async () => { calls += 1; return { enabled: true, code: 'enabled' } }, ttlMs: 60_000 })
  g.ensure('a'); await sleep(5)
  eq(g.statusFor('a').enabled, true, '已启用')
  g.invalidate('a')
  eq(g.statusFor('a').enabled, false, '撤销后立刻不启用')
  g.ensure('a'); await sleep(5)
  eq(calls, 2, '撤销后再次 ensure 会重新判定')
  g.invalidateAll()
  eq(g.statusFor('a').enabled, false, '全撤销')
})

await t('ttlMs<=0 ⇒ 每次都重判（给"绝不缓存"留一条可用路径）', async () => {
  let calls = 0
  const g = createEnableGate({ decide: async () => { calls += 1; return { enabled: false, code: 'rollout-off' } }, ttlMs: 0 })
  g.ensure('a'); await sleep(5)
  g.ensure('a'); await sleep(5)
  eq(calls, 2, 'ttl=0 时每次 ensure 都重判')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-assembly-gate', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
