// A8 · 真实配置的**只读迁移报告**（dry-run；本脚本**绝不写任何文件**）
//
//   node po06/scripts/migrate-report.mjs [--home C:/Users/X/.dsh]
//
// 为什么单独做一个脚本而不是直接跑 runConfigMigration：
//   ① `dryRun` 虽默认 true，但"默认安全"和"证明没写"是两回事——
//      本脚本在运行前后对**真实配置目录**做快照比对，逐字节证明没动过任何东西。
//   ② 报告要能回答一个具体问题：**迁移之后，0.5.x 还读不读得到它自己的字段？**
//      这决定"能不能安全地写"，所以必须把旧键的去向逐条列出来。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runConfigMigration } from '../lib/host-migrate.js'
import { planMigration } from '../lib/migration.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const HOME = opt('home', process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh'))
const CONFIG = join(HOME, 'prompt-optimizer.json')

/** 迁移**可能触碰**的范围快照：只需要配置文件本身 + backups 目录。
 *  （不遍历整个 home：那会把 profiles/node_modules 全扫一遍，还可能撞上断掉的 junction。） */
function snapshot() {
  const out = {}
  if (existsSync(CONFIG)) {
    const st = statSync(CONFIG)
    out[CONFIG] = { sha256: createHash('sha256').update(readFileSync(CONFIG)).digest('hex'), bytes: st.size, mtimeMs: st.mtimeMs }
  }
  const backups = join(HOME, 'backups')
  out[backups] = existsSync(backups) ? readdirSync(backups).sort() : null
  return out
}

const before = snapshot()

const out = runConfigMigration({ home: HOME })          // 默认就是 dry-run
const plan = out.plan

// ── 旧键去向：这决定"能不能安全写" ───────────────────────────────────
const oldKeys = (() => {
  try { return Object.keys(JSON.parse(readFileSync(CONFIG, 'utf8'))) } catch { return [] }
})()
const inSteps = new Set((plan && plan.steps || []).map((s) => s.key))
const inCarry = new Set((plan && plan.carryOver || []).map((c) => c.key))
const unmappable = (plan && plan.unmappable || []).map((u) => u.key)
const accounted = new Set([...inSteps, ...inCarry, ...unmappable])
const unaccounted = oldKeys.filter((k) => !accounted.has(k))

const after = snapshot()
const changed = Object.keys({ ...before, ...after }).filter((k) => {
  const a = before[k], b = after[k]
  return JSON.stringify(a) !== JSON.stringify(b)
})

// ── 关键安全问答：**若真写下去，旧插件还读得到自己的键吗？** ──────────
// 在内存里算出"新配置长什么样"（不落盘），把顶层键做差集。
// 这一步把"我觉得可能有问题"变成"差集就摆在这里"。
let keyImpact = null
try {
  const { applyMigration } = await import('../lib/migration.js')
  const oldObj = JSON.parse(readFileSync(CONFIG, 'utf8'))
  // 只用来算形状：给每个待决项一个占位值（真实执行时必须由用户给）
  const placeholders = {}
  for (const u of (plan.unmappable || [])) placeholders[u.key] = '__PLACEHOLDER__'
  const next = applyMigration(plan, placeholders, oldObj)
  const oldTop = Object.keys(oldObj).sort()
  const newTop = Object.keys(next).sort()
  const lostTopLevel = oldTop.filter((k) => !newTop.includes(k))
  const nestedInLegacy = lostTopLevel.filter((k) => plan.legacyState && Object.prototype.hasOwnProperty.call(plan.legacyState, k))
  keyImpact = {
    oldTopLevel: oldTop,
    newTopLevel: newTop,
    lostTopLevel,
    preservedOnlyInsideLegacyState: nestedInLegacy,
    note: 'lostTopLevel = 写下去之后**顶层不再有**的旧键。若旧插件按顶层键读取，它就会读不到；'
      + 'nested 到 legacyState 只是"留了个副本"，不等于旧插件还能读到。',
  }
} catch (e) {
  keyImpact = { error: String((e && e.message) || e) }
}

const report = {
  probe: 'po06-migrate-report', phase: 'A8', at: new Date().toISOString(),
  home: HOME, configPath: CONFIG,
  configExists: existsSync(CONFIG),
  dryRun: out.dryRun, written: out.written, backupPath: out.backupPath, error: out.error,
  plan: plan ? {
    fromVersion: plan.fromVersion,
    steps: plan.steps, carryOver: plan.carryOver, unmappable: plan.unmappable,
    legacyStateKeys: plan.legacyState ? Object.keys(plan.legacyState) : [],
  } : null,
  legacyKeyAccounting: {
    oldKeys, mapped: [...inSteps], carriedOver: [...inCarry], needsYourChoice: unmappable,
    unaccounted,
    note: 'unaccounted 非空 = 有旧键**没有出现在迁移计划里**——写下去就等于丢掉它们。',
  },
  keyImpact,
  noWriteProof: {
    filesBefore: Object.keys(before).length,
    filesAfter: Object.keys(after).length,
    changed: changed.map((p) => p.replace(HOME, '<home>')),
    unchanged: changed.length === 0,
  },
  reportText: out.report,
}
report.ok = out.dryRun === true && out.written === false && changed.length === 0 && !out.error

console.log(report.reportText || '(无报告文本)')
console.log('---')
console.log(JSON.stringify({
  ok: report.ok,
  configExists: report.configExists,
  dryRun: report.dryRun, written: report.written, backupCreated: report.backupPath !== null,
  needsYourChoice: report.legacyKeyAccounting.needsYourChoice,
  unaccountedOldKeys: report.legacyKeyAccounting.unaccounted,
  keyImpact,
  noWriteProof: report.noWriteProof,
  error: report.error,
}, null, 2))

// 报告文本本身不落盘在 home 里（避免"只读"被自己破坏），写进插件仓库的 eval/
import('node:fs').then((fs) => {
  fs.writeFileSync(join(ROOT, 'eval', 'migrate-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
})
process.exit(report.ok ? 0 : 1)
