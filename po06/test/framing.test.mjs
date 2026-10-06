// 0.7.8 · 协作基调（Interaction Framing）回归
//
// 这个文件钉住四件事：
//   ① 语域**被保留**（hard 块必须是口语语域——把它消毒成正式条目就等于扔掉效果来源）；
//   ② 三条硬边界：不代表用户说话 / 不放松决策边界 / 不改原话；
//   ③ 按会话生效、与档位正交、neutral 时什么都不注入；
//   ④ 没有其它内容时不单独冒出一段语气（避免"只有口号没有内容"）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { framingBlock, FRAMING_VALUES } from '../lib/framing.js'
import { normalizeSettings, SESSION_KEYS, DEFAULT_SETTINGS } from '../lib/settings.js'
import { policyFor, effectiveSettings } from '../lib/policy.js'
import { compile, compileAudited, SECTIONS } from '../lib/compiler.js'
import { createState } from '../lib/schema.js'
const label = (key) => (SECTIONS.find((s) => s.key === key) || {}).label || ('(missing ' + key + ')')
import { reduce } from '../lib/reducer.js'

const SID = 'session-framing'
const A = 'session-framing-a'
const human = () => ({ kind: 'human', sessionId: SID, messageId: 'm1' })

function stateWithOneItem() {
  const r = reduce(createState({ sessionId: SID, taskId: 't' }), {
    causeId: 'c1', baseRevision: 0, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML；可预览、可操控', sourceRefs: [human()] } }],
  })
  if (!r.ok) throw new Error('fixture failed: ' + r.reason)
  return r.state
}

test('neutral 什么都不注入；hard 是一段语域匹配的块', () => {
  assert.equal(framingBlock('neutral'), '')
  assert.equal(framingBlock(undefined), '')
  assert.equal(framingBlock('nonsense'), '', '未知值按 neutral 处理，不猜')
  const hard = framingBlock('hard')
  assert.ok(hard.length > 0)
  // 语域本身必须在（这是效果来源，不是装饰）
  for (const marker of ['兄弟', '猛']) assert.ok(hard.includes(marker), '应保留口语语域：' + marker)
  assert.ok(!/请积极主动/.test(hard), '不许被消毒成正式条目')
})

test('三条硬边界必须写在块里（不代表用户说话 / 不放松决策边界）', () => {
  const hard = framingBlock('hard')
  assert.ok(/不是用户的新要求/.test(hard), '必须自带"插件所加、不是新要求"的标签')
  assert.ok(/不准替他定/.test(hard), '强结果导向必须显式反制越权——这是它最大的副作用')
  assert.ok(framingBlock('neutral') === '', '原话语域不被改写：neutral 下我们不插任何话')
})

test('设置层：framing 值域受校验、可按会话覆盖、默认 neutral', () => {
  assert.equal(DEFAULT_SETTINGS.framing, 'neutral')
  assert.ok(SESSION_KEYS.includes('framing'), 'framing 应按会话覆盖')
  assert.deepEqual(normalizeSettings({ framing: 'hard' }).settings.framing, 'hard')
  const bad = normalizeSettings({ framing: 'loud' })
  assert.equal(bad.settings.framing, 'neutral', '非法值回落默认')
  assert.deepEqual(bad.problems.map((p) => p.kind), ['not-in-domain'])
  const sess = normalizeSettings({ bySession: { [A]: { framing: 'hard' } } }).settings
  assert.deepEqual(sess.bySession[A], { framing: 'hard' })
})

test('政策：按会话生效，且与档位正交', () => {
  assert.equal(policyFor({}).framing, 'neutral')
  const raw = { bySession: { [A]: { tier: 'light', framing: 'hard' } } }
  const p = policyFor(raw, A)
  assert.equal(p.framing, 'hard', '会话覆盖生效')
  assert.equal(p.detail, 'minimal', '档位照旧生效——两者互不干扰')
  assert.equal(policyFor(raw, 'session-other').framing, 'neutral', '别的会话不受影响')
})

test('编译器：hard 时块在最前；neutral 时不出现', () => {
  const s = stateWithOneItem()
  const on = compile(s, { framing: 'hard' })
  assert.ok(on.text.includes('协作基调'), 'hard 应注入基调块')
  assert.ok(on.text.indexOf('协作基调') < on.text.indexOf(label('requirements')), '基调块应在最前（先入为主设定语域）')
  const off = compile(s, { framing: 'neutral' })
  assert.ok(!off.text.includes('协作基调'), 'neutral 不该出现基调块')
  assert.ok(!off.text.includes('兄弟'), 'neutral 连语域词都不该有')
})

test('没有条目时不单独冒出一段语气', () => {
  const empty = createState({ sessionId: SID, taskId: 'empty' })
  const out = compile(empty, { framing: 'hard' })
  assert.equal(out.text, '', '只有口号没有内容是不允许的')
})

test('带基调时审计仍通过，且基调不计入条目节', () => {
  const s = stateWithOneItem()
  const out = compileAudited(s, { framing: 'hard' })
  assert.deepEqual(out.problems, [], JSON.stringify(out.problems))
  assert.ok(!out.sections.some((x) => /framing|基调/.test(x.key)), '基调不是条目节')
  assert.ok(out.text.includes(label('requirements')), '其余内容照常')
})

test('基调不改变来源身份：要求仍然只来自人类条目', () => {
  const s = stateWithOneItem()
  const out = compileAudited(s, { framing: 'hard' })
  const req = out.sections.find((x) => x.key === 'requirements')
  assert.ok(req, '应有明确要求节')
  assert.deepEqual(req.itemIds, ['req-1'], '基调不得混入要求节')
})
