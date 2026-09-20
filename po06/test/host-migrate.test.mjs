// P8 宿主侧迁移接线测试：**全程临时目录**，绝不碰真实配置。
// 运行：node po06/test/host-migrate.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { detectOldPluginStatic, runConfigMigration, rollbackConfig, OLD_PACKAGE } from '../lib/host-migrate.js'

const HERE = dirname(fileURLToPath(import.meta.url))

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

// ── 迁移写盘：**原子 + 回读校验**（EV-0123）────────────────────────────
// 这是唯一会动用户 `prompt-optimizer.json`（他每天在用的 0.5.x 设置）的地方。
// 直写覆盖的话，写一半被杀/断电 ⇒ 半截 JSON，而 0.5.x 读不动它之后会怎么表现不由我们决定。
t('写配置是**原子**的：不留 .tmp- 残留，备份与原文逐字节相同', () => {
  const home = freshHome()
  try {
    const cfg = join(home, 'prompt-optimizer.json')
    const original = JSON.stringify(OLD)
    writeFileSync(cfg, original, 'utf8')
    const r = runConfigMigration({ home, dryRun: false, choices: CHOICES })
    eq(r.ok, true, '迁移应成功：' + JSON.stringify({ error: r.error }))
    eq(r.written, true, 'written')
    ok(existsSync(r.backupPath), '备份必须在：' + r.backupPath)
    eq(readFileSync(r.backupPath, 'utf8'), original, '**备份必须与原文逐字节相同**（那是退路）')
    JSON.parse(readFileSync(cfg, 'utf8'))                       // 必须解析得动
    const leftovers = readdirSync(home).filter((f) => f.includes('.tmp-'))
    eq(leftovers, [], '不得留下临时文件：' + JSON.stringify(leftovers))
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('回滚也是**原子**的：写回后能解析，且不留 .tmp- 残留', () => {
  const home = freshHome()
  try {
    const cfg = join(home, 'prompt-optimizer.json')
    writeFileSync(cfg, JSON.stringify(OLD), 'utf8')
    const r = runConfigMigration({ home, dryRun: false, choices: CHOICES })
    ok(r.backupPath, '前提：有备份')
    const rb = rollbackConfig({ home, backupPath: r.backupPath })
    eq(rb.ok, true, '回滚应成功：' + JSON.stringify(rb))
    eq(readFileSync(cfg, 'utf8'), JSON.stringify(OLD, null, 2), '回滚后内容等于原始设置（供 0.5.x 继续用）')
    const leftovers = readdirSync(home).filter((f) => f.includes('.tmp-'))
    eq(leftovers, [], '不得留临时文件：' + JSON.stringify(leftovers))
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

t('默认 dry-run：一个字节都不写，也不产生备份', () => {
  const home = freshHome()
  try {
    const cfg = join(home, 'prompt-optimizer.json')
    const original = JSON.stringify(OLD)
    writeFileSync(cfg, original, 'utf8')
    const r = runConfigMigration({ home })
    eq(r.dryRun, true, '默认 dry-run')
    eq(r.written, false, '不得写')
    eq(readFileSync(cfg, 'utf8'), original, '**逐字节不变**')
    ok(!existsSync(join(home, 'backups')), 'dry-run 不该留下备份目录')
    eq(readdirSync(home).filter((f) => f.includes('.tmp-')), [], 'dry-run 不留临时文件')
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch { /* */ } }
})

// 收尾：跑完这一份不留临时目录（这个项目为"单测临时目录泄漏"专门修过一次）
// **结构守卫**：上面几条验的是"结果对不对"，而"是不是原子写"在进程内**观测不到**
// （崩溃无法在单测里制造）。所以这里直接查源码结构——与 wire.test.mjs 里
// "EVIDENCE_DIR 必须由 DSH_HOME 派生"同一类做法：
// 配置**必须**经原子 helper 写，不得对配置路径直写。
t('结构守卫：配置写入必须走原子 helper（不得直写配置路径）', () => {
  const src = readFileSync(join(HERE, '..', 'lib', 'host-migrate.js'), 'utf8')
  ok(/renameSync\(/.test(src), '必须存在 rename 这一步（原子写的机制）')
  ok(!/writeFileSync\(configPath\s*,/.test(src), '不得对 configPath 直接 writeFileSync')
  ok(!/writeFileSync\(join\(home,\s*CONFIG_FILE\)/.test(src), '不得对 <home>/配置文件名 直接 writeFileSync')
  ok(/writeConfig\(configPath, next\)/.test(src), '迁移必须经 writeConfig 写')
  ok(/writeConfig\(join\(home, CONFIG_FILE\), rb\.restored\)/.test(src), '回滚必须经 writeConfig 写')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-host-migrate', phase: 'P8', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
