// P11 · 来源引用归一 + 「机器来源」标记真生效（两个真机缺陷的回锚）。
//
// 运行：node po06/test/provenance-ref.test.mjs
//
// 缺陷 A（用户真机 2026-09-21，与「只读工具:开」严格绑定）：
//   开工具时模型会写 `kind:'tool'` / `kind:'file'`，可 `toolCallId` / `uri` 只有宿主才有 ⇒ schema 判
//   `BAD_SCHEMA` ⇒ **整份补丁作废**、其它合法条目陪葬（台账 `outcome:reducer-rejected`）。
//   现在：只补宿主确实知道的事实（引文逐字来自本轮原话 ⇒ 补 human.messageId；逐字来自本轮读入的
//   上下文 ⇒ 如实改记 kind:model），补不了的**逐条丢弃并记账**，绝不弄死整轮。
//
// 缺陷 B（2026-09-21 复查发现）：
//   `provenance:'machine'` 原来在 `validateProvenance` **之前**就标，而 `quoteSource` 是那个函数才写的
//   ⇒ 该标记**从未生效**：从读入材料里推出来的条目会看起来像"你说过的"。
import { parseInterpreterOutput, validateProvenance } from '../lib/interpreter.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const base = { sessionId: 'session-x', messageId: 'msg-1', baseRevision: 1, baseInputRevision: 1, causeId: 'test' }
const parse = (ops, extra = {}) => parseInterpreterOutput(JSON.stringify({ ops }), { ...base, userText: '帮我改一下坦克的颜色', contextText: '项目里 README 写着：颜色用 #3b82f6', ...extra })

t('A1 工具来源缺 toolCallId（引文逐字来自读入材料）⇒ 改记 kind:model，条目**不丢**', () => {
  const r = parse([{
    op: 'add_item',
    item: {
      id: 'obs-1', kind: 'observed_fact', text: 'README 里规定了主色',
      quote: '颜色用 #3b82f6',
      sourceRefs: [{ kind: 'tool', sessionId: 'session-x' }],
    },
  }])
  eq(r.ok, true, '不该整轮失败')
  ok(r.patch, '要有补丁')
  eq(r.patch.ops.length, 1, '条目保留')
  eq(r.patch.ops[0].item.sourceRefs[0].kind, 'model', '如实改记成模型从给定材料推导')
  eq(r.patch.ops[0].item.provenance, 'machine', '上下文来源必须标 machine（缺陷 B 的回锚）')
})

t('A2 一条写坏的来源**不许**弄死整轮：其余合法条目照常落地，坏的记账丢弃', () => {
  const r = parse([
    {
      op: 'add_item',
      item: {
        id: 'obs-bad', kind: 'observed_fact', text: '凭空断言',
        quote: '这句在上下文里不存在',
        sourceRefs: [{ kind: 'tool', sessionId: 'session-x' }],
      },
    },
    {
      op: 'add_item',
      item: {
        id: 'prop-1', kind: 'proposal', text: '顺手把阴影调淡一点',
        quote: '帮我改一下坦克的颜色',
        sourceRefs: [{ kind: 'model', sessionId: 'session-x' }],
      },
    },
  ])
  eq(r.ok, true, '不该整轮失败（这就是 no-packet 的机制）')
  eq(r.patch.ops.length, 1, '只留合法那条')
  eq(r.patch.ops[0].item.id, 'prop-1', '留下的是合法条目')
  eq(r.dropped.length, 1, '坏的那条要记账')
  eq(r.dropped[0].id, 'obs-bad', '记的是哪一条')
  ok(r.dropped[0].reason.length > 0, '记的是为什么')
})

t('A3 human 引用缺 messageId，但引文逐字来自**用户这条原话** ⇒ 宿主补全（可机械核对）', () => {
  const r = parse([{
    op: 'add_item',
    item: {
      id: 'req-1', kind: 'user_requirement', text: '要改坦克颜色',
      quote: '帮我改一下坦克的颜色',
      sourceRefs: [{ kind: 'human', sessionId: 'session-x' }],
    },
  }])
  eq(r.ok, true, '通过')
  eq(r.patch.ops[0].item.sourceRefs[0].messageId, 'msg-1', '补成这一轮真实的 messageId')
})

t('A4 无来源引用的机器条目（引文来自读入材料）⇒ 记一条 kind:model，不丢', () => {
  const r = parse([{
    op: 'add_item',
    item: { id: 'unk-1', kind: 'unknown', unknownClass: 'lookupable_fact', text: '构建脚本用哪个', quote: '颜色用 #3b82f6', sourceRefs: [] },
  }])
  eq(r.ok, true, '通过')
  eq(r.patch.ops[0].item.sourceRefs[0].kind, 'model', '如实记模型来源')
})

t('B1 machine 标记在 validateProvenance 之后才标，但必须**真的标上**', () => {
  const ops = [{ op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: 'x', quote: '颜色用 #3b82f6', sourceRefs: [{ kind: 'model', sessionId: 's' }] } }]
  eq(validateProvenance(ops, '帮我改一下坦克的颜色', '项目里写着：颜色用 #3b82f6'), [], '引文在上下文里')
  const r = parse([{ op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: 'x', quote: '颜色用 #3b82f6', sourceRefs: [{ kind: 'model', sessionId: 'session-x' }] } }])
  eq(r.patch.ops[0].item.provenance, 'machine', '上下文来的条目必须能被认出来，不许冒充"你说过"')
})

t('B2 用户原话来的条目**不许**被标 machine（反向）', () => {
  const r = parse([{
    op: 'add_item',
    item: { id: 'qi-2', kind: 'quality_interpretation', text: 'x', quote: '坦克的颜色', sourceRefs: [{ kind: 'human', sessionId: 'session-x', messageId: 'msg-1' }] },
  }])
  eq(r.patch.ops[0].item.provenance, undefined, '来自原话的不标 machine')
})

t('B3 一条 op 都没有时保持原契约（noop，不是错误）', () => {
  const r = parse([])
  eq(r.ok, true, '不是错误')
  eq(r.patch, null, '没有补丁')
  eq(r.warnings, ['no ops: nothing to add'], '口径不变')
})

t('R1 销账（set_item_status）带逐字依据 ⇒ 落地，且引文不外传进状态', () => {
  const r = parse([{ op: 'set_item_status', id: 'req-9', status: 'superseded', quote: '坦克的颜色' }])
  eq(r.ok, true, '通过')
  eq(r.patch.ops.length, 1, '销账落地')
  eq(r.patch.ops[0], { op: 'set_item_status', id: 'req-9', status: 'superseded' }, '只留 id 与目标状态（不带 quote）')
})

t('R2 销账没有逐字依据 ⇒ 只丢这一条并记账，其余条目照常（不许凭空划掉用户的要求）', () => {
  const r = parse([
    { op: 'set_item_status', id: 'req-9', status: 'retracted', quote: '这句谁都没说过' },
    { op: 'add_item', item: { id: 'qi-3', kind: 'quality_interpretation', text: 'x', quote: '坦克的颜色', sourceRefs: [{ kind: 'human', sessionId: 'session-x', messageId: 'msg-1' }] } },
  ])
  eq(r.ok, true, '整轮不失败')
  eq(r.patch.ops.length, 1, '只留合法条目')
  eq(r.patch.ops[0].op, 'add_item', '留下的是新增条目')
  eq(r.dropped.length, 1, '缺依据的销账要记账')
  eq(r.dropped[0].kind, 'retire', '记的是销账')
})

t('R3 销账不许“复活”条目（active/pending 一律不收）', () => {
  const r = parse([{ op: 'set_item_status', id: 'req-9', status: 'active', quote: '坦克的颜色' }])
  eq(r.patch, null, '没有其它 op ⇒ 补丁为空')
  eq(r.dropped.length, 1, '被丢掉并记账')
  ok(/superseded/.test(r.dropped[0].reason), '理由要说清只许退：' + r.dropped[0].reason)
})

t('R4 scope:"turn" 透传（多轮不互相污染的前提：下一轮自动退役）', () => {
  const r = parse([{
    op: 'add_item',
    item: { id: 'req-t', kind: 'user_requirement', text: '这一轮先把颜色改了', quote: '坦克的颜色', scope: 'turn', sourceRefs: [{ kind: 'human', sessionId: 'session-x', messageId: 'msg-1' }] },
  }])
  eq(r.patch.ops[0].item.scope, 'turn', '本轮条目带 turn 作用域')
})

console.log(JSON.stringify({
  suite: 'po06-provenance-ref', phase: 'P11', total: pass + failures.length, pass, fail: failures.length, failures,
  note: '来源引用归一（工具标识宿主才有的不许要求模型给）+ 机器来源标记真生效。纯函数，不联网、不跑模型。',
}, null, 2))
process.exit(failures.length ? 1 : 0)
