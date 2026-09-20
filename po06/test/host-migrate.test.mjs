// P8 宿主侧迁移接线测试：**全程临时目录**，绝不碰真实配置。
// 运行：node po06/test/host-migrate.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectOldPluginStatic, runConfigMigration, rollbackConfig, OLD_PACKAGE } from '../lib/host-migrate.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const OLD = {
  tier: 'extreme', permission: 'review', model: { provider: 'p', model: 'm' },
  reasoningEffort: 'high', readTools: true, delivery: 'chat', strategy: 'v6',
  ui: { w: 408, h: 473 }, turns: 10, historyMode: 'turns', fullOn: true,
  perSession: { 'session-a': { tier: 'basic' } }, outcomes: [], revision: 2234,
}
const CHOICES = {
  permission: 'review', delivery: 'chat', reasoningEffort: 'high',
  turns: 10, historyMode: 'turns', fullOn: true, readTools: true,
}

function freshHome() {
  const dir = join(tmpdir(), 'po06-home-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6))
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── 1. 旧插件静态探测 ───────────────────────────────────────────────
t('探测：profile 干净 → 不判定为在装', () => {
  const home = freshHome()
  try {
    const pd = join(home, 'profiles', 'web')
    mkdirSync(join(pd, 'node_modules'), { recursive: true })
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ name: 'web', dependencies: {} }), 'utf8')
    const d = detectOldPluginStatic(pd)
    eq(d.active, false, 'clean profile must not be detected as active')
    eq(d.confidence, 'static', 'confidence must be declared')
    ok(d.caveat.includes('保守'), 'caveat must state the bias: ' + d.caveat)
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('探测：dependencies 含旧包 → 判定在装（含证据）', () => {
  const home = freshHome()
  try {
    const pd = join(home, 'profiles', 'web')
    mkdirSync(join(pd, 'node_modules'), { recursive: true })
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ dependencies: { [OLD_PACKAGE]: 'file:../x' } }), 'utf8')
    const d = detectOldPluginStatic(pd)
    eq(d.active, true, 'must detect')
    ok(d.evidence.some((e) => e.includes('dependencies')), 'evidence must name the source: ' + JSON.stringify(d.evidence))
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('探测：bundle 列表含旧包 → 判定在装', () => {
  const home = freshHome()
  try {
    const pd = join(home, 'profiles', 'web')
    mkdirSync(join(pd, 'node_modules'), { recursive: true })
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [OLD_PACKAGE] } } }), 'utf8')
    const d = detectOldPluginStatic(pd)
    eq(d.active, true, 'must detect via bundles')
    ok(d.evidence.some((e) => e.includes('bundles')), 'evidence from bundles')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('探测：模块目录存在 → 判定在装（保守方向）', () => {
  const home = freshHome()
  try {
    const pd = join(home, 'profiles', 'web')
    mkdirSync(join(pd, 'node_modules', OLD_PACKAGE), { recursive: true })
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ dependencies: {} }), 'utf8')
    const d = detectOldPluginStatic(pd)
    eq(d.active, true, 'installed module must be treated as possibly active (conservative)')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

// ── 2. 迁移：默认 dry-run ───────────────────────────────────────────
t('默认 dry-run：**绝不写配置**（逐字节比对）', () => {
  const home = freshHome()
  try {
    const original = JSON.stringify(OLD, null, 2)
    writeFileSync(join(home, 'prompt-optimizer.json'), original, 'utf8')
    const r = runConfigMigration({ home })          // 不传 dryRun
    eq(r.dryRun, true, 'default must be dry-run')
    eq(r.written, false, 'must not write')
    eq(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'), original, 'file must be byte-identical')
    ok(r.report.includes('dry-run：是'), 'report marks dry-run')
    ok(r.report.includes('legacy-unverified'), 'report discloses legacy handling')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('无配置 → 如实说按全新安装处理，不算失败', () => {
  const home = freshHome()
  try {
    const r = runConfigMigration({ home })
    eq(r.ok, true, 'ok')
    eq(r.error, 'no-config', 'reason')
    ok(r.report.includes('全新安装'), 'message')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

// ── 3. 迁移：非 dry-run 的完整路径 ──────────────────────────────────
t('非 dry-run：缺选择 → 中止且**不写任何东西**（无备份也无改动）', () => {
  const home = freshHome()
  try {
    const original = JSON.stringify(OLD, null, 2)
    writeFileSync(join(home, 'prompt-optimizer.json'), original, 'utf8')
    const r = runConfigMigration({ home, dryRun: false })     // 不给 choices
    eq(r.ok, false, 'must fail')
    ok(r.error.startsWith('needs-choices:'), 'error: ' + r.error)
    eq(r.written, false, 'must not write')
    eq(existsSync(join(home, 'backups')), false, 'must not even create a backup dir when it cannot proceed')
    eq(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'), original, 'config untouched')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('非 dry-run：给齐选择 → 备份 + 写回；旧字段**保留但不再被解释**', () => {
  const home = freshHome()
  try {
    const original = JSON.stringify(OLD, null, 2)
    writeFileSync(join(home, 'prompt-optimizer.json'), original, 'utf8')
    const r = runConfigMigration({ home, dryRun: false, choices: CHOICES, now: () => 1700000000000 })
    eq(r.ok, true, 'ok: ' + r.error)
    eq(r.written, true, 'written')
    ok(r.backupPath && existsSync(r.backupPath), 'backup exists: ' + String(r.backupPath))
    eq(readFileSync(r.backupPath, 'utf8'), original, 'backup must equal the pre-migration file')
    const migrated = JSON.parse(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'))
    eq(migrated.settingsVersion, 1, 'new version')
    // ADR-0036（本断言此前恰好相反，且写在**三个**测试文件里——所以这是一次**有意的设计反转**）：
    // 旧版本可能仍在运行、仍按顶层键读取；实测会在真实配置上删掉 6 个顶层键（EV-0062）。
    eq(migrated.tier, OLD.tier, 'old tier 必须原样保留')
    eq(migrated.strategy, OLD.strategy, 'old strategy 必须原样保留')
    const lost = Object.keys(OLD).filter((k) => !(k in migrated))
    eq(lost, [], '不得有任何旧顶层键丢失；实际：' + JSON.stringify(lost))
    ok(Array.isArray(migrated.preservedLegacyKeys), '保留清单必须写进配置，便于事后核对')
    eq(migrated.legacyState.disposition, 'legacy-unverified', 'legacy disposition recorded')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('回滚：从备份还原，逐字节一致，且备份保留', () => {
  const home = freshHome()
  try {
    const original = JSON.stringify(OLD, null, 2)
    writeFileSync(join(home, 'prompt-optimizer.json'), original, 'utf8')
    const r = runConfigMigration({ home, dryRun: false, choices: CHOICES, now: () => 1700000000001 })
    ok(r.ok && r.backupPath, 'migrated first')
    const rb = rollbackConfig({ home, backupPath: r.backupPath })
    eq(rb.ok, true, 'rollback ok')
    eq(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'), original, 'must restore byte-for-byte')
    ok(existsSync(r.backupPath), 'backup must survive rollback (it is the only way back)')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('回滚：无备份 → 如实失败，不动配置', () => {
  const home = freshHome()
  try {
    const original = JSON.stringify(OLD, null, 2)
    writeFileSync(join(home, 'prompt-optimizer.json'), original, 'utf8')
    const rb = rollbackConfig({ home, backupPath: join(home, 'nope.json') })
    eq(rb.ok, false, 'must fail')
    eq(rb.reason, 'no-backup', 'reason')
    eq(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'), original, 'config untouched')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('损坏的配置：不抛错、不写文件，如实报告', () => {
  const home = freshHome()
  try {
    writeFileSync(join(home, 'prompt-optimizer.json'), '{ this is not json', 'utf8')
    const r = runConfigMigration({ home, dryRun: false, choices: CHOICES })
    eq(r.ok, false, 'must not claim success')
    ok(r.error.startsWith('unreadable-config:'), 'error: ' + r.error)
    eq(r.written, false, 'must not write')
    eq(readFileSync(join(home, 'prompt-optimizer.json'), 'utf8'), '{ this is not json', 'file untouched')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-host-migrate', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
