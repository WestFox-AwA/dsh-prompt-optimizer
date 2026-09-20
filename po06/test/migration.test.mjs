// P8 迁移测试：纯函数、无 IO。运行：node po06/test/migration.test.mjs
import {
  planMigration, applyMigration, rollback, renderMigrationReport,
  TIER_MAP, UNMAPPABLE, NEW_SETTINGS_VERSION,
} from '../lib/migration.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function throws(fn, what) { let threw = false; try { fn() } catch { threw = true } ok(threw, what || 'expected throw') }

/** 真实旧配置样本（取自本机 prompt-optimizer.json 的字段集） */
const OLD = {
  tier: 'extreme',
  permission: 'review',
  model: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910', name: 'x' },
  reasoningEffort: 'high',
  readTools: true,
  delivery: 'chat',
  strategy: 'v6',
  ui: { w: 408, h: 473, x: 549, y: 97 },
  turns: 10,
  historyMode: 'turns',
  fullOn: true,
  perSession: { 'session-a': { tier: 'basic', permission: 'review' }, 'session-b': { tier: 'extreme', permission: 'auto' } },
  outcomes: [],
  revision: 2234,
}

// ── 1. 不做机械映射 ─────────────────────────────────────────────────
t('每个档位映射都带**解释**，且不声称等价', () => {
  for (const [tier, m] of Object.entries(TIER_MAP)) {
    ok(typeof m.note === 'string' && m.note.length > 10, tier + ' must explain itself')
    ok(m.note.includes('等价') || m.note.includes('对应'), tier + ' note should discuss equivalence explicitly')
    ok(['partial', true, false].includes(m.reversible), tier + ' must declare reversibility')
  }
  // "关闭"可以等价；三档一律是部分可逆（不得声称等价）
  eq(TIER_MAP.off.reversible, true, 'off is fully reversible')
  for (const tier of ['basic', 'advanced', 'extreme']) {
    eq(TIER_MAP[tier].reversible, 'partial', tier + ' must NOT claim full equivalence')
  }
})

t('未知档位不猜：进 unmappable', () => {
  const p = planMigration({ tier: 'super-extreme' })
  ok(p.unmappable.some((u) => u.key === 'tier'), 'unknown tier must be reported')
  eq(p.steps.length, 0, 'no silent mapping')
})

t('档位缺失也进 unmappable', () => {
  const p = planMigration({ permission: 'review' })
  ok(p.unmappable.some((u) => u.key === 'tier'), 'missing tier must be reported')
})

// ── 2. 无法映射的项如实列出 ─────────────────────────────────────────
t('语义不同的旧项全部列入 unmappable', () => {
  const p = planMigration(OLD)
  const keys = p.unmappable.map((u) => u.key)
  for (const u of UNMAPPABLE) ok(keys.includes(u.key), 'must list: ' + u.key)
  ok(keys.includes('strategy'), 'strategy has no counterpart in 0.6 and must be listed')
  for (const u of p.unmappable) ok(typeof u.reason === 'string' && u.reason.length > 10, u.key + ' needs a reason')
})

t('保留项带语义说明（模型 / UI）', () => {
  const p = planMigration(OLD)
  const keys = p.carryOver.map((c) => c.key)
  ok(keys.includes('model'), 'model carried over')
  ok(keys.includes('ui'), 'ui carried over')
  ok(p.carryOver.find((c) => c.key === 'model').note.includes('实发'), 'model note must mention actual-sent params')
})

// ── 3. 旧状态不得冒充已确认需求 ─────────────────────────────────────
t('旧会话级配置标为 legacy-unverified，绝不导入为需求', () => {
  const p = planMigration(OLD)
  ok(p.legacyState, 'legacy state reported')
  eq(p.legacyState.disposition, 'legacy-unverified', 'disposition')
  eq(p.legacyState.sessions, 2, 'session count')
  ok(p.legacyState.note.includes('不得'), 'must state the prohibition explicitly: ' + p.legacyState.note)
})

// ── 4. apply 需要显式选择，缺了就抛错 ───────────────────────────────
t('applyMigration：缺少用户选择时抛错（不猜）', () => {
  const p = planMigration(OLD)
  throws(() => applyMigration(p, {}, OLD), 'must require explicit choices')
  throws(() => applyMigration(p, { permission: 'review' }, OLD), 'must require ALL choices')
})

t('applyMigration：给齐选择后产出新设置，且不含旧档位字段', () => {
  const p = planMigration(OLD)
  const choices = {
    permission: 'review', delivery: 'chat', reasoningEffort: 'high',
    turns: 10, historyMode: 'turns', fullOn: true, readTools: true,
  }
  const s = applyMigration(p, choices, OLD)
  eq(s.settingsVersion, NEW_SETTINGS_VERSION, 'version')
  eq(s.enabled, true, 'enabled derived from tier=extreme')
  eq(s.qualityExpansion, 'deep', 'quality expansion derived')
  ok(!('tier' in s), 'old tier field must not survive')
  ok(!('strategy' in s), 'old strategy field must not survive')
  eq(s.model, OLD.model, 'model carried over')
  eq(s.ui, OLD.ui, 'ui carried over')
  eq(s.legacyState.disposition, 'legacy-unverified', 'legacy disposition recorded')
})

t('tier=off → enabled=false（这一条可以等价映射）', () => {
  const p = planMigration({ tier: 'off', permission: 'review' })
  const s = applyMigration(p, { permission: 'review' }, { tier: 'off' })
  eq(s.enabled, false, 'disabled')
  ok(!s.qualityExpansion, 'no quality expansion when disabled')
})

// ── 5. 回滚 ─────────────────────────────────────────────────────────
t('回滚 = 原样还原备份，不让旧版理解新字段', () => {
  const backup = JSON.parse(JSON.stringify(OLD))
  const r = rollback(backup)
  ok(r.ok, 'rollback ok')
  eq(r.restored, OLD, 'byte-equal restore')
  // 且回滚结果与备份**互不影响**（深拷贝）
  r.restored.tier = 'MUTATED'
  eq(backup.tier, 'extreme', 'backup must not be mutated through the returned object')
})

t('没有备份时回滚如实失败', () => {
  const r = rollback(null)
  ok(!r.ok, 'must fail')
  eq(r.reason, 'no-backup', 'reason')
})

// ── 6. 报告 ─────────────────────────────────────────────────────────
t('迁移报告含解释、待决项与旧状态处置', () => {
  const p = planMigration(OLD)
  const md = renderMigrationReport(p)
  ok(md.includes('dry-run：是'), 'dry-run marked')
  ok(md.includes('已映射'), 'mapped section')
  ok(md.includes('无法映射，需要你决定'), 'unmappable section')
  ok(md.includes('legacy-unverified'), 'legacy disposition')
  ok(md.includes('可逆性'), 'reversibility stated')
})

t('空配置：如实说按新装处理，不报错', () => {
  const p = planMigration(null)
  eq(p.steps.length, 0, 'no steps')
  ok(p.warnings.some((w) => w.includes('全新安装')), 'warning')
})

// ── 7. 确定性 ───────────────────────────────────────────────────────
t('确定性：同输入两次规划一致', () => {
  eq(planMigration(OLD), planMigration(OLD), 'deterministic')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-migration', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
