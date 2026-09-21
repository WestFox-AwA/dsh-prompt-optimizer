// P11 · 引文来源判据 + 出处不被"洗白"（短消息 `no-packet` 的机制之一）。
//
// 运行：node po06/test/provenance.test.mjs
//
// 背景（用户 2026-09-21 真机复现）：发"测试"两个字 ⇒ 解释层候选全被
// `validateProvenance` 判为"引文不是用户原话的子串" ⇒ 补丁为空 ⇒ `outcome:noop` ⇒ 界面报 `no-packet`。
// 而"一两字结合上下文依然能有大量信息"（用户原话）⇒ 判据必须认**上下文里的逐字依据**；
// 同时**不许含糊**：来自上下文的条目必须被记成机器来源，不能冒充"你说过"。
import { validateProvenance } from '../lib/interpreter.js'
import { provenanceOf } from '../lib/control-api.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const mk = (id, quote) => ({ op: 'add_item', item: { id, kind: 'user_requirement', text: 'x', quote, sourceRefs: [{ kind: 'human', sessionId: 's', messageId: 'm' }] } })

t('引文来自**用户原话** ⇒ 通过，并标 quoteSource=user', () => {
  const ops = [mk('req-1', '测试')]
  eq(validateProvenance(ops, '这是一次测试', ''), [], '通过')
  eq(ops[0].item.quoteSource, 'user', '标成用户原话')
})

t('引文来自**已读入的上下文** ⇒ 通过，并标 quoteSource=context（短消息的关键通道）', () => {
  const ops = [mk('req-1', '把配置检查一遍')]
  eq(validateProvenance(ops, '测试', '上一轮用户说：帮我把配置检查一遍'), [], '短消息 + 上下文引文也要通过')
  eq(ops[0].item.quoteSource, 'context', '标成上下文来源')
})

t('两处都找不到 ⇒ 仍然拦下（不许凭空引文）', () => {
  const p = validateProvenance([mk('req-1', '这句谁都没说过')], '测试', '上下文里也没有')
  eq(p.length, 1, '要报一条')
  ok(/not a verbatim substring/.test(p[0]), '理由要说清：' + p[0])
})

t('出处不被洗白：标了 machine 的条目即使带 human 引用也不许显示成"来自你的话"', () => {
  eq(provenanceOf({ sourceRefs: [{ kind: 'human' }] }), 'user', '普通条目：有 human 引用 = 来自你的话')
  eq(provenanceOf({ sourceRefs: [{ kind: 'human' }], provenance: 'machine' }), 'machine',
    '上下文来源的条目必须显示成机器补充（否则界面在撒谎）')
  eq(provenanceOf({ sourceRefs: [] }), 'unsourced', '没有引用 = 无出处（界面要标红）')
})

console.log(JSON.stringify({
  suite: 'po06-provenance', phase: 'P11', total: pass + failures.length, pass, fail: failures.length, failures,
  note: '引文来源判据：用户原话 或 已读上下文；后者一律记机器来源，不冒充"你说过"。不联网、不跑模型。',
}, null, 2))
process.exit(failures.length ? 1 : 0)
