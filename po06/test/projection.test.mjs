// P2 投影定义的结构回归测试（纯函数，无需宿主）。
// 运行：node po06/test/projection.test.mjs
//
// 存在理由：宿主 `register()` **不校验** stateSchema，
// 缺了它注册/提交/读取全正常，只在 `restore()` 时才抛错——是一个"恢复时才爆炸"的隐性缺陷。
// 本测试把这类必需项钉成断言，避免再次漏掉。
import { createProjectionDefinition, looksLikeIntentState, PROJECTION_KEY, PROJECTION_VERSION, STATE_EVENT } from '../lib/projection.js'
import { createStats } from '../lib/projection.js'
import { SCHEMA_VERSION } from '../lib/schema.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const def = createProjectionDefinition(createStats())

t('定义暴露宿主所需的全部字段', () => {
  eq(def.key, PROJECTION_KEY, 'key')
  eq(def.stateVersion, PROJECTION_VERSION, 'stateVersion')
  ok(typeof def.init === 'function', 'init must be a function')
  ok(typeof def.apply === 'function', 'apply must be a function')
  ok(def.wire && typeof def.wire.view === 'function', 'wire.view must be a function')
})

t('stateSchema 必须存在且可 parse（恢复路径依赖，register 不校验）', () => {
  ok(def.stateSchema !== undefined, 'stateSchema must be declared or restore() will throw')
  ok(typeof def.stateSchema.parse === 'function', 'stateSchema.parse must be a function')
})

t('stateSchema.parse 接受合法状态、拒绝非法状态', () => {
  const good = {
    schemaVersion: SCHEMA_VERSION, sessionId: 's1', taskId: 't1',
    revision: 3, lastInputRevision: 3, sourceMessageIds: [], phase: 'idle',
    items: [], questions: [], artifactRefs: [], verificationRefs: [], lastCauseId: null,
  }
  eq(def.stateSchema.parse(good), good, 'must return the value')
  const bad = [
    null, undefined, 42, 'x', [], {},
    { ...good, schemaVersion: 999 },
    { ...good, sessionId: '' },
    { ...good, revision: -1 },
    { ...good, revision: 1.5 },
    { ...good, items: undefined },
    { ...good, questions: 'nope' },
  ]
  for (const b of bad) {
    let threw = false
    try { def.stateSchema.parse(b) } catch { threw = true }
    ok(threw, 'must reject: ' + JSON.stringify(b))
  }
})

t('stateSchema 与 looksLikeIntentState 判定一致', () => {
  const good = {
    schemaVersion: SCHEMA_VERSION, sessionId: 's', taskId: 't', revision: 0,
    lastInputRevision: 0, sourceMessageIds: [], phase: 'idle',
    items: [], questions: [], artifactRefs: [], verificationRefs: [], lastCauseId: null,
  }
  ok(looksLikeIntentState(good), 'looksLike must accept good')
  eq(def.stateSchema.parse(good), good, 'schema must accept good')
})

t('init 返回 null（"尚无状态"与"空状态"区分）', () => {
  eq(def.init(), null, 'init')
})

t('apply 第一句短路：非本前缀事件返回同一引用', () => {
  const state = { marker: 'x' }
  const r = def.apply(state, { type: 'user/message', seq: 1, data: {} })
  ok(r === state, 'must return the SAME reference')
  const r2 = def.apply(state, { type: 'prompt-optimizer/other', seq: 2, data: {} })
  ok(r2 === state, 'same prefix but different type must also short-circuit')
})

t('apply 对畸形事件不抛错且返回同一引用', () => {
  const state = { marker: 'y' }
  for (const ev of [null, undefined, {}, { type: 42 }, { type: STATE_EVENT, data: null }, { type: STATE_EVENT, data: {} }]) {
    let r
    let threw = false
    try { r = def.apply(state, ev) } catch { threw = true }
    ok(!threw, 'apply must never throw: ' + JSON.stringify(ev))
    ok(r === state, 'must return same reference: ' + JSON.stringify(ev))
  }
})

t('apply 采纳合法状态事件', () => {
  const good = {
    schemaVersion: SCHEMA_VERSION, sessionId: 's', taskId: 't', revision: 1,
    lastInputRevision: 0, sourceMessageIds: [], phase: 'ready',
    items: [], questions: [], artifactRefs: [], verificationRefs: [], lastCauseId: 'c',
  }
  const r = def.apply(null, { type: STATE_EVENT, seq: 5, data: good })
  ok(r === good, 'must adopt the event payload')
})

t('统计计数：短路与采纳分开计', () => {
  const stats = createStats()
  const d = createProjectionDefinition(stats)
  d.apply(null, { type: 'user/message' })
  d.apply(null, { type: STATE_EVENT, data: null })
  d.apply(null, {
    type: STATE_EVENT,
    data: { schemaVersion: SCHEMA_VERSION, sessionId: 's1', taskId: 't', revision: 0, lastInputRevision: 0, sourceMessageIds: [], phase: 'idle', items: [], questions: [], artifactRefs: [], verificationRefs: [], lastCauseId: null },
  })
  eq(stats.applyCalls, 3, 'applyCalls')
  eq(stats.shortCircuits, 1, 'shortCircuits')
  eq(stats.rejected, 1, 'rejected')
  eq(stats.adopted, 1, 'adopted')
  eq(stats.sessionsSeen.size, 1, 'sessionsSeen')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-projection', phase: 'P2', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
