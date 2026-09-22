// P3 解释层契约测试：纯函数、**不调用任何模型**。运行：node po06/test/interpreter.test.mjs
import {
  SYSTEM_PROMPT, buildUserMessage, extractJson, validateProvenance,
  parseInterpreterOutput, dryRun, MAX_ITEMS, MAX_ITEM_CHARS, INTERPRETER_VERSION,
} from '../lib/interpreter.js'
import { createState } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-i'
const MID = 'm-1'
// 开发集 D-01 的原话（逐字）
const TANK = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'

const opts = () => ({ userText: TANK, sessionId: SID, baseRevision: 0, baseInputRevision: 0, causeId: 'c1' })

// ── 1. 契约文本 ─────────────────────────────────────────────────────
t('系统提示词包含关键约束条款', () => {
  ok(SYSTEM_PROMPT.includes('原样保留'), 'must state the original is preserved')
  ok(SYSTEM_PROMPT.includes('逐字'), 'must require verbatim quote')
  ok(SYSTEM_PROMPT.includes('quality_interpretation'), 'must define quality interpretation')
  ok(SYSTEM_PROMPT.includes('不得新增产品目标'), 'must forbid new product goals')
  ok(SYSTEM_PROMPT.includes('unknown'), 'must define unknown')
  ok(INTERPRETER_VERSION.length > 0, 'versioned')
})

t('用户消息包含原话、标识与上限说明', () => {
  const msg = buildUserMessage({ userText: TANK, state: null, sessionId: SID, messageId: MID })
  ok(msg.includes(TANK), 'must include verbatim text')
  ok(msg.includes('sessionId=' + SID), 'must include sessionId')
  ok(msg.includes('messageId=' + MID), 'must include messageId')
  ok(msg.includes('逐字'), 'must tell the model it may quote')
})

t('用户消息带上已有状态，避免重复添加', () => {
  let s = createState({ sessionId: SID, taskId: 't' })
  const r = reduce(s, {
    causeId: 'c', baseRevision: 0, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] } }],
  })
  s = r.state
  const msg = buildUserMessage({ userText: TANK, state: s, sessionId: SID, messageId: MID })
  ok(msg.includes('req-1'), 'must list existing item ids')
})

// ── 2. JSON 抽取容错 ────────────────────────────────────────────────
t('extractJson: 裸 JSON / 代码围栏 / 前后废话都能抽', () => {
  eq(extractJson('{"ops":[]}').value, { ops: [] }, 'bare')
  eq(extractJson('```json\n{"ops":[]}\n```').value, { ops: [] }, 'fenced')
  eq(extractJson('好的，这是结果：\n{"ops":[]}\n以上。').value, { ops: [] }, 'prose-wrapped')
})

t('extractJson: 无 JSON / 坏 JSON 给出明确错误码', () => {
  eq(extractJson('完全没有 JSON').code, 'NO_JSON', 'no json')
  eq(extractJson('{bad json}').code, 'BAD_JSON', 'bad json')
  eq(extractJson(null).code, 'NO_JSON', 'null input')
})

// ── 3. 逐字引文检查（本层的核心机制）───────────────────────────────
t('validateProvenance: 逐字引文通过', () => {
  const ops = [{
    op: 'add_item',
    item: {
      id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序',
      quote: '制作一个单html程序',
      sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }],
    },
  }]
  eq(validateProvenance(ops, TANK), [], 'verbatim quote must pass')
})

t('validateProvenance: 改写过的引文被拒（发明的要求挡在这里）', () => {
  const ops = [{
    op: 'add_item',
    item: {
      id: 'req-1', kind: 'user_requirement', text: '必须是离线单文件程序',
      quote: '必须完全离线运行',   // 用户从未说过
      sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }],
    },
  }]
  const problems = validateProvenance(ops, TANK)
  eq(problems.length, 1, 'must reject')
  ok(problems[0].includes('not a verbatim substring'), 'reason: ' + problems[0])
})

t('validateProvenance: 缺 quote 被拒', () => {
  const ops = [{
    op: 'add_item',
    item: { id: 'r', kind: 'user_requirement', text: 'x', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] },
  }]
  const problems = validateProvenance(ops, TANK)
  ok(problems.some((p) => p.includes('missing quote')), 'must require quote: ' + JSON.stringify(problems))
})

t('validateProvenance: 只约束人类要求类，不误伤解释类', () => {
  const ops = [{
    op: 'add_item',
    item: { id: 'qi-1', kind: 'quality_interpretation', text: '比例协调', sourceRefs: [{ kind: 'model', sessionId: SID }] },
  }]
  eq(validateProvenance(ops, TANK), [], 'quality interpretation needs no quote')
})

// ── 4. 输出解析与闸门 ───────────────────────────────────────────────
t('合法输出被接受，quote 不外传进状态', () => {
  const raw = JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] } },
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '比例协调、结构可信', rationale: '来自原话的“真实、帅气”', sourceRefs: [{ kind: 'model', sessionId: SID }] } },
      { op: 'add_item', item: { id: 'unk-1', kind: 'unknown', text: '是否有指定车型', sourceRefs: [{ kind: 'model', sessionId: SID }] } },
    ],
  })
  const r = parseInterpreterOutput(raw, opts())
  ok(r.ok, 'should accept: ' + (r.reason || ''))
  eq(r.patch.ops.length, 3, 'ops')
  ok(!('quote' in r.patch.ops[0].item), 'quote must not leak into state')
})

t('解释器不得创建 user_decision（不在允许类型内）', () => {
  const raw = JSON.stringify({
    ops: [{ op: 'add_item', item: { id: 'd-1', kind: 'user_decision', text: 'x', quote: '真实', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] } }],
  })
  const r = parseInterpreterOutput(raw, opts())
  ok(!r.ok, 'must reject')
  eq(r.code, 'KIND_NOT_ALLOWED', 'code')
})

// ⚠ 2026-09-21 契约变更（用户真机："第二轮还带着第一轮早已解决的问题"）：
// 解释层此前**只能加不能销** ⇒ 状态只增不减 ⇒ 旧问题每轮都被重新编译进包。
// 现在放行 `set_item_status`，但**只许退、必须有逐字依据**；其它 op 仍然一律拒。
t('解释器不得使用未授权 op（update_item / advance_turn / answer_question）', () => {
  for (const op of [
    { op: 'update_item', id: 'req-1', fields: { text: 'x' } },
    { op: 'advance_turn', turnId: 'turn:x' },
    { op: 'answer_question', id: 'q-1', status: 'answered' },
  ]) {
    const r = parseInterpreterOutput(JSON.stringify({ ops: [op] }), opts())
    ok(!r.ok, 'must reject: ' + op.op)
    eq(r.code, 'OP_NOT_ALLOWED', 'code for ' + op.op)
  }
})

t('销账必须有依据、且只许退：无依据 ⇒ 逐条丢弃（不弄死整轮）；退成 active ⇒ 丢弃', () => {
  const noEvidence = parseInterpreterOutput(JSON.stringify({ ops: [{ op: 'set_item_status', id: 'req-1', status: 'retracted' }] }), opts())
  eq(noEvidence.ok, true, '不是整轮失败')
  eq(noEvidence.patch, null, '没有其它 op ⇒ 空补丁')
  eq(noEvidence.dropped.length, 1, '记账')
  const revive = parseInterpreterOutput(JSON.stringify({ ops: [{ op: 'set_item_status', id: 'req-1', status: 'active' }] }), opts())
  eq(revive.ok, true, '不是整轮失败')
  eq(revive.dropped.length, 1, '不许复活旧条目')
})

t('超量条目被拒（防止把短原话膨胀成文档）', () => {
  const ops = []
  for (let i = 0; i < MAX_ITEMS + 3; i += 1) {
    ops.push({ op: 'add_item', item: { id: 'unk-' + i, kind: 'unknown', text: '未知项 ' + i, sourceRefs: [{ kind: 'model', sessionId: SID }] } })
  }
  const r = parseInterpreterOutput(JSON.stringify({ ops }), opts())
  ok(!r.ok, 'must reject')
  eq(r.code, 'TOO_MANY_ITEMS', 'code')
})

t('超长条目被截断并给出警告（不整条丢弃）', () => {
  const raw = JSON.stringify({
    ops: [{ op: 'add_item', item: { id: 'unk-1', kind: 'unknown', text: 'x'.repeat(MAX_ITEM_CHARS + 50), sourceRefs: [{ kind: 'model', sessionId: SID }] } }],
  })
  const r = parseInterpreterOutput(raw, opts())
  ok(r.ok, 'should accept: ' + (r.reason || ''))
  eq(r.patch.ops[0].item.text.length, MAX_ITEM_CHARS, 'truncated')
  ok(r.warnings.some((w) => w.includes('truncated')), 'warned')
})

t('引文不可验证时整份输出被拒（不放半个补丁进去）', () => {
  const raw = JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: 'ok', sourceRefs: [{ kind: 'model', sessionId: SID }] } },
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '必须离线', quote: '必须离线', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] } },
    ],
  })
  const r = parseInterpreterOutput(raw, opts())
  // ⚠ 契约变更（真机回归 2026-09-22："发 A ⇒ 思考完了报 no-packet"）：
  //   原来"一条引文对不上 ⇒ 整轮 UNVERIFIABLE_PROVENANCE"，现在**逐条丢弃并记账**，
  //   剩下的条目照常成包（除非全被丢）。底线不变：human-only 没逐字依据就**丢**，绝不放行。
  eq(r.ok, true, '整轮不再作废')
  eq(r.patch.ops.length, 1, '只留引文成立的那条')
  eq(r.patch.ops[0].item.id, 'qi-1', '留下的是不要求引文的 quality_interpretation')
  eq(r.dropped.length, 1, '被丢的那条要记账')
  eq(r.dropped[0].id, 'req-1', '记的是哪一条')
  ok(/逐字片段/.test(r.dropped[0].reason), '理由要说清：' + r.dropped[0].reason)
})

t('空 ops 视为无操作（noop），不是错误', () => {
  const r = parseInterpreterOutput('{"ops":[]}', opts())
  ok(r.ok, 'ok')
  eq(r.patch, null, 'null patch')
  ok(r.warnings.some((w) => w.includes('nothing to add')), 'warned as noop')
})

// ── 5. 与 reducer 的串联 ────────────────────────────────────────────
t('dryRun: 合法补丁可被 reducer 接受', () => {
  const raw = JSON.stringify({
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId: SID, messageId: MID }] } },
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '比例协调', sourceRefs: [{ kind: 'model', sessionId: SID }] } },
    ],
  })
  const p = parseInterpreterOutput(raw, opts())
  ok(p.ok, 'parse ok: ' + (p.reason || ''))
  const s = createState({ sessionId: SID, taskId: 'tank' })
  const d = dryRun(p.patch, s, reduce)
  ok(d.ok, 'reducer should accept: ' + (d.reason || ''))
  eq(d.state.items.length, 2, 'items')
})

t('dryRun: 模型来源伪造 human 引文仍会被 reducer 拦（双层防线）', () => {
  const raw = JSON.stringify({
    ops: [{
      op: 'add_item',
      item: {
        id: 'req-1', kind: 'user_requirement', text: '必须离线',
        quote: '真实',   // 引文是真的（在 TANK 里存在）
        sourceRefs: [{ kind: 'model', sessionId: SID }],   // 但来源不是人类
      },
    }],
  })
  const r = parseInterpreterOutput(raw, opts())
  ok(r.ok, 'provenance passes (quote is verbatim)')
  const s = createState({ sessionId: SID, taskId: 'tank' })
  const d = dryRun(r.patch, s, reduce)
  ok(!d.ok, 'reducer must reject')
  eq(d.code, 'UNAUTHORIZED_KIND', 'code')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-interpreter', phase: 'P3', version: INTERPRETER_VERSION, total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
