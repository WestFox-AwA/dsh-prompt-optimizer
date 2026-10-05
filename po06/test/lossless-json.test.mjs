import test from 'node:test'
import assert from 'node:assert/strict'
import { toLosslessJson } from '../lib/lossless-json.js'

// 这一套用例守的是**宿主边界**：`dsh-tools` 的 snapshotToolValue → `@deepseek-ai/dsh-util-values`
// 的 walkJsonValue（0.1.7 与 0.2 同一行同一份代码）。不合规的返回值会被宿主**整条丢弃**：
//   `tool "consult_task" returned invalid output: value is not lossless JSON`
// 真机后果（2026-10-04）：38 次顾问调用里 5 次中招，模型一点内容都拿不到。

/** 宿主判据的等价实现：通过返回 true，否则 false。逐条对齐 walkJsonValue。 */
function hostAccepts(value) {
  const ancestors = new Set()
  const walk = (v) => {
    if (v === null) return true
    if (typeof v === 'boolean' || typeof v === 'string') return true
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0)
    if (typeof v !== 'object') return false              // undefined/function/symbol/bigint
    if (ancestors.has(v)) return false                   // 循环引用
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) return false
      if (Reflect.ownKeys(v).length !== v.length + 1) return false   // 稀疏数组/额外自有键
      ancestors.add(v)
      for (let i = 0; i < v.length; i++) if (!walk(v[i])) return false
      ancestors.delete(v)
      return true
    }
    const proto = Object.getPrototypeOf(v)
    if (!(proto === null || proto === Object.prototype)) return false   // Date/Map/Set/类实例
    const keys = Reflect.ownKeys(v)
    if (keys.some((k) => typeof k !== 'string' || !Object.prototype.propertyIsEnumerable.call(v, k))) return false
    ancestors.add(v)
    for (const k of keys) if (!walk(v[k])) return false                  // 值为 undefined 的键同样算违规
    ancestors.delete(v)
    return true
  }
  return walk(value)
}

test('判据自检：宿主会拒的形状，本判据也必须拒（否则用例是空转的）', () => {
  assert.equal(hostAccepts({ path: undefined }), false, 'undefined 值的键必须被拒')
  assert.equal(hostAccepts({ ms: NaN }), false, 'NaN 必须被拒')
  assert.equal(hostAccepts({ ms: Infinity }), false, 'Infinity 必须被拒')
  assert.equal(hostAccepts({ n: -0 }), false, '-0 必须被拒')
  assert.equal(hostAccepts({ at: new Date() }), false, 'Date 必须被拒')
  assert.equal(hostAccepts({ m: new Map() }), false, 'Map 必须被拒')
  assert.equal(hostAccepts([, 1]), false, '稀疏数组必须被拒')
  assert.equal(hostAccepts({ run: () => {} }), false, '函数必须被拒')
  const cyc = {}; cyc.self = cyc
  assert.equal(hostAccepts(cyc), false, '循环引用必须被拒')
  assert.equal(hostAccepts({ ok: true, ms: 12, note: null }), true, '普通对象必须通过')
})

test('真机回归：可选链产出的 undefined 字段曾让整条顾问结果被丢掉', () => {
  // 现场形状来自 advisor.js 的 inspectedMaterials：`path: r.args?.path`
  const raw = {
    ok: true,
    inspectedMaterials: [{ path: undefined, source: 'advisor-read', status: 'ok' }],
    report: { verdict: 'pass', summary: 's', nextStep: 'n', stopCondition: 'c' },
    ms: 1234,
  }
  assert.equal(hostAccepts(raw), false, '这就是被整条丢弃的那种值')
  const safe = toLosslessJson(raw)
  assert.equal(hostAccepts(safe), true, '收敛后必须通过宿主校验')
  assert.equal(safe.ok, true)
  assert.equal(safe.ms, 1234)
  assert.equal(safe.report.verdict, 'pass', '有效字段一个都不能少')
  assert.equal(safe.inspectedMaterials.length, 1, '数组长度不变')
  assert.equal('path' in safe.inspectedMaterials[0], false, 'undefined 的键按 JSON 语义丢弃')
  assert.equal(safe.inspectedMaterials[0].source, 'advisor-read')
})

test('每一类违规值都被收敛成合法 JSON', () => {
  const cyc = { name: 'c' }; cyc.self = cyc
  const raw = {
    nan: NaN, inf: -Infinity, negZero: -0,
    when: new Date('2026-10-04T00:00:00.000Z'),
    bad: new Date('nope'),
    map: new Map([['a', 1]]),
    fn: () => {}, sym: Symbol('s'), big: 10n,
    sparse: [, 'x'],
    cyc,
    keep: ['a', null, 3, true],
  }
  const safe = toLosslessJson(raw)
  assert.equal(hostAccepts(safe), true)
  assert.equal(safe.nan, null, '非有限数变 null')
  assert.equal(safe.inf, null)
  assert.equal(safe.negZero, 0, '-0 归一成 0')
  assert.equal(safe.when, '2026-10-04T00:00:00.000Z', 'Date 变 ISO 串')
  assert.equal(safe.bad, null, '非法 Date 变 null')
  assert.deepEqual(safe.keep, ['a', null, 3, true], '正常值原样保留')
  assert.equal(safe.sparse.length, 2, '稀疏空洞保留长度')
  assert.equal(safe.sparse[0], null, '空洞按 JSON 语义变 null')
  assert.equal(safe.cyc.self, '[circular]', '循环引用写成标记而不是抛错')
  assert.equal('fn' in safe, false, '函数键丢弃')
})

test('收敛器绝不抛：再坏的值也要能交回宿主', () => {
  const hostile = { get boom() { throw new Error('getter 炸了') } }
  const safe = toLosslessJson(hostile)
  assert.equal(hostAccepts(safe), true)
  assert.equal(toLosslessJson(undefined), null, '顶层 undefined 也要变成合法值')
  assert.equal(toLosslessJson(() => {}), null)
  assert.equal(hostAccepts(toLosslessJson(10n)), true)
})

test('注册出口必须包着收敛器（否则同一个缺陷会悄悄回来）', async () => {
  const fs = await import('node:fs')
  const advisor = fs.readFileSync(new URL('../lib/advisor.js', import.meta.url), 'utf8')
  const stage = fs.readFileSync(new URL('../lib/advisor-stage-tool.js', import.meta.url), 'utf8')
  assert.match(advisor, /execute: losslessExecute/, 'consult_task 必须注册收敛后的执行函数')
  assert.match(advisor, /toLosslessJson\(await execute\(/, 'consult_task 出口必须收敛')
  assert.match(stage, /toLosslessJson\(await \(async\(args,exec\)=>/, 'advisor_stage 出口必须收敛')
})
