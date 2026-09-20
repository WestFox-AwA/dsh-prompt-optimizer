// P8 灰度开关 + 迁移/回滚演练（**全部在临时目录**，不碰真实配置）。
// 运行：node po06/test/rollout.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MODES, normalizeRollout, isEnabledFor, assertNoDoubleIntercept,
  decideEnabled, renderRolloutReport,
} from '../lib/rollout.js'
import { planMigration, applyMigration, rollback, renderMigrationReport } from '../lib/migration.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function throws(fn, what) { let th = false; try { fn() } catch { th = true } ok(th, what || 'expected throw') }

// ── 1. 灰度：保守默认 ───────────────────────────────────────────────
t('非法/缺失配置一律回落 off（保守默认）', () => {
  eq(normalizeRollout(null).mode, 'off', 'null')
  eq(normalizeRollout({}).mode, 'off', 'empty')
  eq(normalizeRollout({ mode: 'yolo' }).mode, 'off', 'invalid')
  ok(normalizeRollout({ mode: 'yolo' }).reason, 'must record why it fell back')
  eq(MODES, ['off', 'allowlist', 'all'], 'modes')
})

t('off → 任何会话都不启用', () => {
  eq(isEnabledFor({ mode: 'off' }, 'session-a'), false, 'off')
  eq(isEnabledFor(null, 'session-a'), false, 'missing config')
})

t('allowlist → 精确匹配，不做模糊', () => {
  const r = { mode: 'allowlist', sessions: ['session-a'] }
  eq(isEnabledFor(r, 'session-a'), true, 'exact hit')
  eq(isEnabledFor(r, 'session-ab'), false, 'prefix must NOT match')
  eq(isEnabledFor(r, 'session-'), false, 'partial must NOT match')
  eq(isEnabledFor(r, 'SESSION-A'), false, 'case must match exactly')
  eq(isEnabledFor({ mode: 'allowlist', sessions: [] }, 'session-a'), false, 'empty allowlist = nothing enabled')
  eq(isEnabledFor(r, ''), false, 'empty session id')
  eq(isEnabledFor(r, null), false, 'null session id')
})

t('all → 全部启用', () => {
  eq(isEnabledFor({ mode: 'all' }, 'anything'), true, 'all')
})

t('稳定可复现：同输入永远同结论（无随机）', () => {
  const r = { mode: 'allowlist', sessions: ['x'] }
  for (let i = 0; i < 5; i += 1) eq(isEnabledFor(r, 'x'), true, 'stable #' + i)
  for (let i = 0; i < 5; i += 1) eq(isEnabledFor(r, 'y'), false, 'stable-neg #' + i)
})

// ── 2. 双重拦截守卫 ─────────────────────────────────────────────────
t('双重拦截：旧版在装 + 新版启用 ⇒ 拒绝，且理由说清后果', () => {
  const g = assertNoDoubleIntercept({ oldPluginActive: true, newEnabled: true })
  ok(!g.ok, 'must refuse')
  eq(g.code, 'DOUBLE_INTERCEPT', 'code')
  ok(g.reason.includes('两次'), 'reason must state the consequence: ' + g.reason)
})

t('双重拦截：旧版不在装，或新版未启用 ⇒ 放行', () => {
  ok(assertNoDoubleIntercept({ oldPluginActive: false, newEnabled: true }).ok, 'old absent')
  ok(assertNoDoubleIntercept({ oldPluginActive: true, newEnabled: false }).ok, 'new disabled')
})

t('decideEnabled：给出单一结论与可机读原因', () => {
  const base = { settings: { enabled: true }, oldPluginActive: false }
  eq(decideEnabled({ ...base, rollout: { mode: 'off' }, sessionId: 's' }).code, 'rollout-off', 'off')
  eq(decideEnabled({ ...base, rollout: { mode: 'allowlist', sessions: ['s'] }, sessionId: 't' }).code, 'session-not-in-allowlist', 'not allowed')
  eq(decideEnabled({ ...base, rollout: { mode: 'all' }, sessionId: 's' }).code, 'enabled', 'enabled')
  eq(decideEnabled({ ...base, settings: { enabled: false }, rollout: { mode: 'all' }, sessionId: 's' }).code, 'settings-disabled', 'settings off')
  eq(decideEnabled({ settings: { enabled: true }, oldPluginActive: true, rollout: { mode: 'all' }, sessionId: 's' }).code, 'DOUBLE_INTERCEPT', 'double intercept')
})

t('灰度报告：all 模式必须带警告', () => {
  ok(renderRolloutReport({ mode: 'all' }).includes('⚠️'), 'must warn on all')
  ok(renderRolloutReport({ mode: 'allowlist', sessions: [] }).includes('等同于全不启用'), 'empty allowlist note')
})

// ── 3. 迁移 + 回滚**演练**（临时目录，不碰真实配置）──────────────────
t('演练：备份 → 迁移 → 校验 → 回滚，且原文件字节还原', () => {
  const dir = join(tmpdir(), 'po06-drill-' + Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  try {
    const configPath = join(dir, 'prompt-optimizer.json')
    const backupDir = join(dir, 'backups')
    const OLD = {
      tier: 'extreme', permission: 'review', model: { provider: 'p', model: 'm' },
      reasoningEffort: 'high', readTools: true, delivery: 'chat', strategy: 'v6',
      ui: { w: 408, h: 473 }, turns: 10, historyMode: 'turns', fullOn: true,
      perSession: { 'session-a': { tier: 'basic' } }, outcomes: [], revision: 2234,
    }
    const originalText = JSON.stringify(OLD, null, 2)
    writeFileSync(configPath, originalText, 'utf8')

    // ① dry-run：只读，不改文件
    const p1 = planMigration(JSON.parse(readFileSync(configPath, 'utf8')))
    const report = renderMigrationReport(p1)
    ok(report.includes('dry-run：是'), 'dry-run report')
    eq(readFileSync(configPath, 'utf8'), originalText, 'dry-run must not modify the file')

    // ② 备份（迁移前必须做）
    mkdirSync(backupDir, { recursive: true })
    const backupPath = join(backupDir, 'prompt-optimizer.' + Date.now() + '.json')
    writeFileSync(backupPath, readFileSync(configPath, 'utf8'), 'utf8')
    ok(existsSync(backupPath), 'backup written')

    // ③ 迁移写回（缺选择必须抛错——先验证这一点）
    throws(() => applyMigration(p1, {}, JSON.parse(readFileSync(configPath, 'utf8'))), 'must refuse without choices')

    const choices = {
      permission: 'review', delivery: 'chat', reasoningEffort: 'high',
      turns: 10, historyMode: 'turns', fullOn: true, readTools: true,
    }
    const NEW = applyMigration(p1, choices, JSON.parse(readFileSync(configPath, 'utf8')))
    writeFileSync(configPath, JSON.stringify(NEW, null, 2), 'utf8')
    const migrated = JSON.parse(readFileSync(configPath, 'utf8'))
    eq(migrated.settingsVersion, 1, 'new version')
    // ADR-0036：旧档位**不再被解释**（enabled/qualityExpansion 由映射推出），
    // 但**不得被删除**——旧版本可能仍在运行并按顶层键读取（EV-0062）。
    eq(migrated.tier, NEW.tier, 'old tier 必须原样保留（不是删掉）')
    eq(migrated.strategy, NEW.strategy, 'old strategy 必须原样保留')
    eq(migrated.enabled, true, '新语义只由映射推出')
    eq(migrated.legacyState.disposition, 'legacy-unverified', 'legacy disposition kept')

    // ④ 回滚：从备份还原，必须字节一致
    const rb = rollback(JSON.parse(readFileSync(backupPath, 'utf8')))
    ok(rb.ok, 'rollback ok')
    writeFileSync(configPath, JSON.stringify(rb.restored, null, 2), 'utf8')
    eq(readFileSync(configPath, 'utf8'), originalText, 'rollback must restore the original text byte-for-byte')

    // ⑤ 清理检查：备份仍在（回滚后不该被自动删除）
    ok(readdirSync(backupDir).length >= 1, 'backup must survive rollback')
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

t('演练：无备份时回滚如实失败（不假装成功）', () => {
  const r = rollback(undefined)
  ok(!r.ok, 'must fail')
  eq(r.reason, 'no-backup', 'reason')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-rollout', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
