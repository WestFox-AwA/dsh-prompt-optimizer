// P8 · **两个版本共用一个配置文件**的冲突：谁能抹掉谁的键
//
// 运行：node po06/test/coexist-config.test.mjs
//
// 背景（EV-0065）：0.5.x 的 `savePluginState()` **每次保存都重建整个对象**——
// 它按一份固定的 15 键清单构造 `next` 再整份写回
// （`dsh-prompt-optimizer-0.5.2-beta.1/package/lib/index.js:2315-2332`）。
// 所以只要旧版还在跑、还可能被用户改动设置，**0.6 的键就会被静默抹掉**。
//
// 这个文件把冲突**量化**，而不是停在"可能有风险"：
//   · 旧版的持久化键清单是什么；
//   · 0.6 的启用标记是否在清单之外（在 = 会被抹掉）；
//   · 走一遍"迁移 → 旧版存一次"，0.6 是否退回未启用。
import { join } from 'node:path'
import { createState } from '../lib/schema.js'
import {
  planMigration, applyMigration, LEGACY_STATE_KEYS, projectThroughLegacyWriter,
  legacySaveWouldDrop,
} from '../lib/migration.js'
import {
  parseEnableIntent, resolveEnableDecision,
  pickEnableIntent, resolveEnableConfigPath, legacyEnableConfigPath,
} from '../lib/assembly-gate.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) } }

/** 0.5.x 的配置形态（与本机真实文件同构）。 */
const OLD = {
  tier: 'extreme', permission: 'review', strategy: 'v6', reasoningEffort: 'high',
  readTools: true, delivery: 'chat', turns: 10, historyMode: 'turns', fullOn: true,
  model: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910', name: 'x' },
  ui: { w: 408, h: 473, x: 549, y: 97 },
  perSession: { 'session-a': { tier: 'basic' } },
  outcomes: [], revision: 2234, updatedAt: 1,
}
const CHOICES = {
  permission: 'review', delivery: 'chat', reasoningEffort: 'high',
  turns: 10, historyMode: 'turns', fullOn: true, readTools: true,
}

t('0.6 的启用标记**都不在**旧版的持久化键清单里 ⇒ 会被旧版保存抹掉', () => {
  // 0.6 判断"这份配置是不是我的"只看一个标记：settingsVersion
  const markers = ['settingsVersion', 'enabled', 'qualityExpansion', 'migratedFrom', 'legacyState', 'preservedLegacyKeys']
  for (const m of markers) {
    ok(!LEGACY_STATE_KEYS.includes(m),
      m + ' 不该出现在旧版清单里——若出现了，说明旧版行为变了，本测试的前提要重新核对')
  }
})

t('走一遍真实序列：迁移 → 旧版存一次 ⇒ 0.6 退回未启用', () => {
  const plan = planMigration(OLD)
  const migrated = applyMigration(plan, CHOICES, OLD)
  // 迁移后文件里有 0.6 的标记
  eq(parseEnableIntent(JSON.stringify(migrated)).ours, true, '前提：迁移后是"0.6 的配置"')

  const dropped = legacySaveWouldDrop(migrated)
  eq(dropped.dropsEnablementMarkers, true, '旧版保存必须会抹掉 settingsVersion')
  ok(dropped.dropped.includes('qualityExpansion'), '也会抹掉 qualityExpansion：' + JSON.stringify(dropped.dropped))

  // 抹掉之后 0.6 怎么认这份文件
  const after = parseEnableIntent(JSON.stringify(dropped.after))
  eq(after.ours, false, '旧版存过之后，0.6 不再认这份配置')
  eq(after.reason, 'not-a-0.6-config', '理由：' + after.reason)
  const d = resolveEnableDecision({ intent: after, sessionId: 's1', oldPluginActive: true })
  eq(d.enabled, false, '结果：0.6 未启用（**静默退回**，用户不会收到任何提示）')
})

t('方向二：0.6 的迁移**不会**再弄丢旧版的键（ADR-0036 的回归守卫）', () => {
  const plan = planMigration(OLD)
  const migrated = applyMigration(plan, CHOICES, OLD)
  const lost = Object.keys(OLD).filter((k) => !(k in migrated))
  eq(lost, [], '反向不得丢键；实际：' + JSON.stringify(lost))
  // 旧版自己关心的字段必须仍能被它读回去
  for (const k of ['perSession', 'outcomes', 'revision', 'tier', 'strategy']) {
    eq(migrated[k], OLD[k], k + ' 必须原样保留')
  }
})

t('projectThroughLegacyWriter 只保留清单内的键（模拟的正确性）', () => {
  const src = { tier: 'x', settingsVersion: 1, extra: 'y', revision: 5 }
  eq(projectThroughLegacyWriter(src), { tier: 'x', revision: 5 }, '只留清单内的')
  eq(projectThroughLegacyWriter({}), {}, '空对象')
  eq(projectThroughLegacyWriter(null), {}, 'null 也不抛')
})

t('结论（写进证据，不是写进代码注释）：**共存期间不得共用这个配置文件**', () => {
  // 两个写者互相覆盖，且方向不对称：
  //   · 0.6 迁移 → 旧版的键**会保留**（ADR-0036 已修）；
  //   · 旧版保存 → 0.6 的标记**会被抹掉**（旧版是既成事实的代码，0.6 改不动它）。
  // 因此顺序决定结果，最后写的赢；且 0.6 会**静默**退回未启用。
  const migrated = applyMigration(planMigration(OLD), CHOICES, OLD)
  const afterLegacySave = legacySaveWouldDrop(migrated).after
  const afterMigrateAgain = applyMigration(planMigration(afterLegacySave), CHOICES, afterLegacySave)
  eq(parseEnableIntent(JSON.stringify(afterMigrateAgain)).ours, true, '再迁移一次又能恢复——说明是"互相覆盖"而非"永久损坏"')
  ok(!afterLegacySave.settingsVersion, '但两次写之间 0.6 处于未启用状态（窗口内行为不确定）')
})

// ── EV-0111：**不再共用那个文件**，于是上面那条"最后写的赢"从根上消失 ──────────
// 上面几条证明的是"共用 `prompt-optimizer.json` 时，0.5.x 一次保存就会让 0.6 静默退回未启用"。
// 但真正该问的是：**为什么非要共用？** 启用意图只是一个小 JSON，而那个路径是 0.5.x 的**设置文件**
// （实测：用户真机上它就是 0.5.x 正在用的 4.9KB 配置，含 tier/strategy/ui）。
// 共用的唯一效果是——"想试试 0.6"的代价变成"弄坏你每天在用的插件"。这个代价没必要。
t('0.6 用自己的配置文件，且路径可被 DSH_PO06_CONFIG 覆盖', () => {
  eq(resolveEnableConfigPath({ home: '/h' }), join('/h', 'po06.json'), '默认路径')
  eq(resolveEnableConfigPath({ home: '/h', env: {} }), join('/h', 'po06.json'), 'env 为空也走默认')
  eq(resolveEnableConfigPath({ home: '/h', env: { DSH_PO06_CONFIG: '/x/y.json' } }), '/x/y.json', 'env 覆盖')
  eq(resolveEnableConfigPath({}), join('.', 'po06.json'), 'home 缺省也不抛')
  eq(legacyEnableConfigPath('/h'), join('/h', 'prompt-optimizer.json'), '旧路径只读回退')
})

t('旧路径回退**必须带 0.6 标记**：0.5.x 的设置文件永远不会启用 0.6', () => {
  // ① 主的没有、旧的也没有 ⇒ 不启用
  const none = pickEnableIntent(null, null)
  eq(none.ok, false, '都没有 ⇒ 不启用')
  eq(none.reason, 'not-enabled', '理由：' + none.reason)

  // ② 主的没有，旧的是**0.5.x 的设置**（无 settingsVersion）⇒ 不启用，且理由说清是被拒的
  const legacyOnly = pickEnableIntent(null, JSON.stringify(OLD))
  eq(legacyOnly.ours, false, '0.5.x 的文件不是"我们的"')
  eq(legacyOnly.settings.enabled, false, '不得启用')
  eq(legacyOnly.reason, 'legacy-path-is-not-a-0.6-config', '理由必须可归因：' + legacyOnly.reason)

  // ③ 旧路径上是**带标记的 0.6 配置** ⇒ 认（老用户的配置不作废）
  const legacyOurs = pickEnableIntent(null, JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }))
  eq(legacyOurs.ours, true, '带标记就认')
  eq(legacyOurs.settings.enabled, true, '启用意图生效')

  // ④ 主文件存在 ⇒ 它说了算（旧路径不再参与）
  const primaryWins = pickEnableIntent(
    JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }),
    JSON.stringify(OLD),
  )
  eq(primaryWins.settings.enabled, true, '主文件赢')
  const primaryOff = pickEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: false }), JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } }))
  eq(primaryOff.settings.enabled, false, '主文件说关就是关（不得被旧路径翻回来）')
})

t('共用文件的旧场景**不可复现**了：0.5.x 保存碰不到 0.6 的配置', () => {
  // 旧场景：0.6 启用标记与 0.5.x 设置同处一个文件 ⇒ 0.5.x 存一次就抹掉标记。
  // 新设计：两者**是两个文件**，所以"旧版保存"之后 0.6 的意图必须**逐字不变**。
  const po06Cfg = JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } })
  const legacyAfterSave = JSON.stringify(legacySaveWouldDrop(OLD).after)   // 0.5.x 存了一次
  const intent = pickEnableIntent(po06Cfg, legacyAfterSave)               // 0.6 读自己的 + 读旧路径
  eq(intent.settings.enabled, true, '0.6 的启用意图不受 0.5.x 保存影响')
  eq(intent.rollout.mode, 'all', '灰度模式也不受影响')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-coexist-config', phase: 'P8', total, pass, fail: failures.length, failures,
  legacyStateKeys: LEGACY_STATE_KEYS,
  note: '两个版本共用 ~/.dsh/prompt-optimizer.json；旧版保存会重建对象并抹掉 0.6 的标记。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
