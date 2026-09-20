// dsh-prompt-optimizer 0.6 · 宿主侧迁移接线与旧插件探测
//
// 三条安全性质（都有测试守着）：
//   ① **默认 dry-run**：不显式传 `dryRun:false` 就绝不写配置。
//   ② **写之前必须备份**，且备份失败即中止（不带着"没有退路"的状态去改用户配置）。
//   ③ **写要原子 + 写完要回读校验**（EV-0123）：这是**唯一**会动用户
//      `prompt-optimizer.json`（他每天在用的 0.5.x 设置）的地方。原来直接
//      `writeFileSync` 覆盖——进程在写一半时被杀/断电，那份配置就是**半截 JSON**，
//      而 0.5.x 读不动它之后会怎么表现**不由我们决定**。`store.js` 早就用的是
//      "写临时文件 + rename" 的原子写法，这里却没有——同一个项目里两套标准。
//
// 旧插件探测是**静态**的（读 profile 清单 + 看模块是否存在），不是运行时活性检查。
// 它会**误报**（装了但没启用 → 判为在装）。这是刻意选择的方向：
// 安全守卫宁可挡住新版，也不要漏过双重拦截。
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { planMigration, applyMigration, rollback, renderMigrationReport } from './migration.js'

export const OLD_PACKAGE = '@dsh-external/dsh-prompt-optimizer'
export const CONFIG_FILE = 'prompt-optimizer.json'

/** 原子写文本：先写 `<名字>.tmp-<时间戳>`，再 `rename` 覆盖目标；失败时清理临时文件。 */
function writeTextAtomic(target, text) {
  const tmp = target + '.tmp-' + Date.now()
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, target)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw e
  }
  return true
}

/**
 * **原子写**用户配置 + **回读校验**：只有回读能解析才算成功。
 *
 * 为什么非这样不可：这是**唯一**会动用户 `prompt-optimizer.json`
 * （他每天在用的 0.5.x 设置）的地方。直接 `writeFileSync` 覆盖的话，
 * 进程在写一半时被杀/断电，那份配置就是**半截 JSON**——而 0.5.x 读不动它之后
 * 会怎么表现**不由我们决定**。`store.js` 早就是"写临时文件 + rename"，
 * 这里却直写，同一个项目里两套标准（EV-0123）。
 */
function writeConfig(configPath, value) {
  writeTextAtomic(configPath, JSON.stringify(value, null, 2))
  const back = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!back || typeof back !== 'object' || Array.isArray(back)) throw new Error('write-verify-failed')
  return true
}

/**
 * 静态探测旧插件是否可能仍在装配。
 * @param profileDir  例如 `<home>/profiles/web`
 * @returns {{active:boolean, evidence:string[], confidence:'static', caveat:string}}
 */
export function detectOldPluginStatic(profileDir) {
  const evidence = []
  let active = false
  const pkgPath = join(profileDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const deps = (pkg && pkg.dependencies) || {}
      const bundles = (pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
      if (deps[OLD_PACKAGE]) { active = true; evidence.push('profile dependencies 含 ' + OLD_PACKAGE + ' = ' + String(deps[OLD_PACKAGE])) }
      if (Array.isArray(bundles) && bundles.includes(OLD_PACKAGE)) {
        active = true; evidence.push('profile bundles 含 ' + OLD_PACKAGE)
      }
    } catch (e) {
      evidence.push('读取 profile package.json 失败：' + String((e && e.message) || e))
    }
  } else {
    evidence.push('未找到 ' + pkgPath)
  }
  const modDir = join(profileDir, 'node_modules', OLD_PACKAGE)
  if (existsSync(modDir)) { active = true; evidence.push('模块目录存在：' + modDir) }

  return {
    active,
    evidence,
    confidence: 'static',
    caveat: '静态检测：装了但被禁用时也会判为"在装"。方向是保守的——'
      + '宁可挡住新版，也不冒双重拦截的风险。真实活性需人工确认。',
  }
}

/**
 * 在**真实 home** 上执行配置迁移。**默认 dry-run**。
 * @param opts {
 *   home,             例如 C:/Users/X/.dsh
 *   dryRun = true,
 *   choices,          语义已变的旧项的新值（缺则抛错，不猜）
 *   now = () => Date.now()
 * }
 */
export function runConfigMigration(opts = {}) {
  const home = opts.home
  if (typeof home !== 'string' || !home) throw new Error('runConfigMigration: home required')
  const dryRun = opts.dryRun !== false           // **默认 true**
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const configPath = join(home, CONFIG_FILE)
  const out = { ok: false, dryRun, configPath, backupPath: null, written: false, report: null, plan: null, error: null }

  if (!existsSync(configPath)) {
    out.error = 'no-config'
    out.report = '没有找到旧配置文件（' + configPath + '）：按全新安装处理，无需迁移。'
    out.ok = true
    return out
  }

  let oldState
  try { oldState = JSON.parse(readFileSync(configPath, 'utf8')) } catch (e) {
    out.error = 'unreadable-config:' + String((e && e.message) || e)
    return out
  }

  const plan = planMigration(oldState)
  out.plan = plan
  // 即便 dry-run 也要渲染报告（让人先看清会发生什么）
  try {
    out.report = renderMigrationReport({ ...plan, dryRun })
  } catch (e) {
    out.error = 'report-failed:' + String((e && e.message) || e)
    return out
  }
  if (dryRun) { out.ok = true; return out }

  // 非 dry-run：先算出新设置（缺选择会在这里抛错 —— **不写任何东西**）
  let next
  try { next = applyMigration(plan, opts.choices, oldState) } catch (e) {
    out.error = 'needs-choices:' + String((e && e.message) || e)
    return out
  }

  // 备份：**失败即中止**。备份也要原子写 + **回读校验**——
  // 一份"存在但解析不动"的备份**不是退路**，而 `existsSync` 是看不出这一点的。
  const backupDir = join(home, 'backups')
  try {
    mkdirSync(backupDir, { recursive: true })
    const backupPath = join(backupDir, CONFIG_FILE + '.' + now() + '.bak.json')
    const originalText = readFileSync(configPath, 'utf8')
    writeTextAtomic(backupPath, originalText)
    if (!existsSync(backupPath)) throw new Error('backup not present after write')
    JSON.parse(readFileSync(backupPath, 'utf8'))     // 解析不动 ⇒ 不是退路，中止
    out.backupPath = backupPath
  } catch (e) {
    out.error = 'backup-failed:' + String((e && e.message) || e)
    return out                                  // 没有退路就不动配置
  }

  try {
    writeConfig(configPath, next)
    out.written = true
    out.ok = true
  } catch (e) {
    out.error = 'write-failed:' + String((e && e.message) || e)
    // 写入失败 → 尽力回滚
    try {
      const rb = rollback(JSON.parse(readFileSync(out.backupPath, 'utf8')))
      if (rb.ok) writeConfig(configPath, rb.restored)
    } catch { /* best effort */ }
  }
  return out
}

/**
 * 从备份回滚真实配置。
 * @returns {{ok:boolean, restoredFrom?:string, reason?:string}}
 */
export function rollbackConfig({ home, backupPath }) {
  if (typeof home !== 'string' || !home) return { ok: false, reason: 'home-required' }
  if (typeof backupPath !== 'string' || !backupPath || !existsSync(backupPath)) {
    return { ok: false, reason: 'no-backup' }
  }
  try {
    const rb = rollback(JSON.parse(readFileSync(backupPath, 'utf8')))
    if (!rb.ok) return { ok: false, reason: rb.reason }
    // 回滚同样走**原子 + 回读校验**：回滚这条路上，用户已经把信任交出来了。
    writeConfig(join(home, CONFIG_FILE), rb.restored)
    return { ok: true, restoredFrom: backupPath }
  } catch (e) {
    return { ok: false, reason: 'rollback-failed:' + String((e && e.message) || e) }
  }
}
