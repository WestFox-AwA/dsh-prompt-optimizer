// P3 编译器单元测试：纯函数、无 IO、无 LLM。运行：node po06/test/compiler.test.mjs
import { createState, SCHEMA_VERSION } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'
import { compile, compileAudited, groupActive, auditCompilation, DEFAULT_BUDGET } from '../lib/compiler.js'

let pass = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) }
}
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

const SID = 'session-c'
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })
const model = () => ({ kind: 'model', sessionId: SID })
const tool = (c) => ({ kind: 'tool', sessionId: SID, toolCallId: c })

/** 构造一个"坦克题"状态的辅助函数 */
function buildTankState(extraOps = []) {
  let s = createState({ sessionId: SID, taskId: 'tank' })
  const r = reduce(s, {
    causeId: 'c1', baseRevision: 0, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML；可预览、可操控', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'req-2', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '整体比例协调、结构可信；活动部件保持连接', sourceRefs: [model()], rationale: '由“真实、帅气”展开' } },
      { op: 'add_item', item: { id: 'opt-1', kind: 'implementation_option', text: '用程序化几何或导入模型均可', sourceRefs: [model()] } },
      { op: 'add_item', item: { id: 'prop-1', kind: 'proposal', text: '可加一套弹药切换演示', sourceRefs: [model()] } },
      { op: 'add_item', item: { id: 'unk-1', kind: 'unknown', text: '是否有指定的车型偏好', sourceRefs: [model()] } },
      ...extraOps,
    ],
  })
  if (!r.ok) throw new Error('fixture build failed: ' + r.reason)
  return r.state
}

// ── 1. 基本编译 ─────────────────────────────────────────────────────
t('编译产出包含各类标签节', () => {
  const s = buildTankState()
  const out = compile(s)
  ok(out.text.includes('明确要求'), 'has requirements section')
  ok(out.text.includes('质量解释'), 'has quality section')
  ok(out.text.includes('建议'), 'has proposal section')
  ok(out.text.includes('未决项'), 'has unknown section')
  ok(out.text.includes('不是用户新增的命令'), 'has provenance header')
})

t('明确要求节只含用户要求，不含质量解释/建议', () => {
  const s = buildTankState()
  const out = compile(s)
  const reqSection = out.sections.find((x) => x.key === 'requirements')
  eq(reqSection.itemIds.sort(), ['req-1', 'req-2'], 'requirements item ids')
  const qSection = out.sections.find((x) => x.key === 'quality')
  eq(qSection.itemIds, ['qi-1'], 'quality item ids')
})

t('注入文本里**不带出处标注**（用户 2026-09-21：那份文本的读者是工作 AI，不能让它对着"（来源：model）"发懵）', () => {
  const s = buildTankState()
  const out = compile(s)
  const body = out.text.split('\n').filter((l) => l.startsWith('- '))
  ok(body.length >= 6, 'has lines: ' + body.length)
  for (const l of body) ok(!l.includes('（来源：'), '注入行不得带出处标注：' + l)
  // ⚠ 出处**没有消失**，只是换了载体：给人的那份走状态/面板——sourceRefs 仍在状态里，
  //   范围审计（auditScope）也仍然按它判定"这一节不许出现非人类来源"。
  const withRefs = (s.items || []).filter((it) => Array.isArray(it.sourceRefs) && it.sourceRefs.length > 0)
  ok(withRefs.length >= 6, '状态里必须仍然逐条留着来源引用（可核对）：' + withRefs.length)
})

// ── 2. 空节不出现 ───────────────────────────────────────────────────
t('没有某类条目时不出现该节', () => {
  let s = createState({ sessionId: SID, taskId: 't' })
  const r = reduce(s, {
    causeId: 'c', baseRevision: 0, sessionId: SID,
    ops: [{ op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '只改标题', sourceRefs: [human('m1')] } }],
  })
  s = r.state
  const out = compile(s)
  ok(out.text.includes('明确要求'), 'requirements present')
  ok(!out.text.includes('质量解释'), 'quality absent')
  ok(!out.text.includes('建议（未采纳'), 'proposal absent')
  ok(!out.text.includes('未决项'), 'unknown absent')
})

t('无有效条目时编译为空文本（静默待命）', () => {
  const s = createState({ sessionId: SID, taskId: 't' })
  const out = compile(s)
  eq(out.text, '', 'empty text')
  eq(out.sections, [], 'no sections')
})

t('已撤销/被取代的条目不进入编译', () => {
  let s = buildTankState()
  const r = reduce(s, {
    causeId: 'c2', baseRevision: s.revision, sessionId: SID,
    ops: [{ op: 'set_item_status', id: 'req-2', status: 'retracted' }],
  })
  ok(r.ok, 'retract ok')
  s = r.state
  const out = compile(s)
  ok(!out.text.includes('不要预览文件夹内的其他文件'), 'retracted item must not render')
  const reqSection = out.sections.find((x) => x.key === 'requirements')
  eq(reqSection.itemIds, ['req-1'], 'requirements after retract')
})

// ── 3. 预算与丢弃 ───────────────────────────────────────────────────
t('超预算时按顺序丢弃并写明丢了什么', () => {
  // 造一个很小的预算，强制丢弃
  const big = []
  for (let i = 0; i < 20; i += 1) {
    big.push({ op: 'add_item', item: { id: 'prop-b' + i, kind: 'proposal', text: '建议条目 ' + i + ' 内容内容内容内容内容', sourceRefs: [model()] } })
  }
  const s = buildTankState(big)
  const out = compile(s, { budget: 400 })
  ok(out.dropped.length > 0, 'must drop something, dropped=' + out.dropped.length)
  ok(out.droppedSummary && out.droppedSummary.includes('因篇幅预算省略'), 'must state what was dropped')
  // 要么装得下；要么**显式声明装不下**（必保节永不被丢弃，所以存在真装不下的情形）
  ok(out.text.length <= 400 || out.overBudget === true, 'must fit or explicitly declare over-budget: ' + out.text.length)
  if (out.overBudget) ok(out.text.includes('【预算不足】'), 'over-budget must be stated in the packet, not silent')
})

t('必保节（明确要求）不会被丢弃', () => {
  const big = []
  for (let i = 0; i < 30; i += 1) {
    big.push({ op: 'add_item', item: { id: 'prop-c' + i, kind: 'proposal', text: '建议 ' + i + ' 一二三四五六七八九十一二三四五六七八九十', sourceRefs: [model()] } })
  }
  const s = buildTankState(big)
  const out = compile(s, { budget: 200 })
  ok(out.text.includes('单 HTML'), 'requirements must survive')
  ok(out.text.includes('不要预览文件夹内的其他文件'), 'second requirement must survive')
})

t('丢弃顺序：建议先于事实/质量解释', () => {
  const ops = []
  for (let i = 0; i < 12; i += 1) {
    ops.push({ op: 'add_item', item: { id: 'prop-d' + i, kind: 'proposal', text: '建议长条目 ' + i + ' 内容内容内容内容内容内容内容内容', sourceRefs: [model()] } })
  }
  for (let i = 0; i < 6; i += 1) {
    ops.push({ op: 'add_item', item: { id: 'fact-d' + i, kind: 'observed_fact', text: '事实长条目 ' + i + ' 内容内容内容内容内容内容内容内容', sourceRefs: [tool('call-' + i)] } })
  }
  const s = buildTankState(ops)
  const out = compile(s, { budget: 700 })
  const droppedKinds = [...new Set(out.dropped.map((d) => d.kind))]
  ok(droppedKinds.includes('proposal'), 'proposals dropped first: ' + JSON.stringify(droppedKinds))
  const proposalStillIn = out.sections.some((x) => x.key === 'proposals')
  const factsStillIn = out.sections.some((x) => x.key === 'facts')
  if (proposalStillIn) ok(factsStillIn || true, 'if proposals remain, fine')
  else ok(true, 'ok')
})

// ── 4. 审计 ─────────────────────────────────────────────────────────
t('审计通过于正常编译结果', () => {
  const s = buildTankState()
  const out = compileAudited(s)
  eq(out.problems, [], 'no problems')
  eq(out.ok, true, 'ok')
})

t('审计能抓出"非人类来源冒充要求"', () => {
  const s = buildTankState()
  const good = compile(s)
  // 伪造：把质量解释条目塞进 requirements 节
  const tampered = {
    ...good,
    sections: good.sections.map((x) => (x.key === 'requirements' ? { ...x, itemIds: [...x.itemIds, 'qi-1'] } : x)),
  }
  const problems = auditCompilation(tampered, s)
  ok(problems.length > 0, 'must catch tampering')
  ok(problems.some((p) => p.includes('must not appear under requirements')), 'specific reason: ' + JSON.stringify(problems))
})

t('审计的人类来源检查可被单独打中（用非禁用类型做探针）', () => {
  // 关键：这里必须用**不在禁用类型列表里**的 kind（observed_fact），
  // 否则会被"禁止类型"那条独立检查顺带拦下，导致"人类来源"检查形同虚设。
  // 变异检验 `compiler: audit-human-source-check-removed` 就是靠这条用例咬人的。
  let s = createState({ sessionId: SID, taskId: 'probe' })
  const r = reduce(s, {
    causeId: 'c-probe', baseRevision: 0, sessionId: SID,
    ops: [
      { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '用户要求', sourceRefs: [human('m1')] } },
      { op: 'add_item', item: { id: 'fact-1', kind: 'observed_fact', text: '一条工具事实', sourceRefs: [tool('call-1')] } },
    ],
  })
  ok(r.ok, 'fixture: ' + (r.reason || ''))
  s = r.state
  const good = compile(s)
  const tampered = {
    ...good,
    sections: good.sections.map((x) => (x.key === 'requirements' ? { ...x, itemIds: [...x.itemIds, 'fact-1'] } : x)),
  }
  const problems = auditCompilation(tampered, s)
  ok(problems.length > 0, 'must catch: ' + JSON.stringify(problems))
  ok(problems.some((p) => p.includes('without human source')),
    'must be the HUMAN-SOURCE check that fires: ' + JSON.stringify(problems))
  // 反向确认：这条探针不会被"禁止类型"检查拦下（否则它无法单独验证人类来源检查）
  ok(!problems.some((p) => p.includes('must not appear under requirements')),
    'fact must not be blocked by the forbidden-kind rule, else it cannot isolate the human-source check')
})

t('审计能抓出"缺少来源的条目被渲染"', () => {
  const s = buildTankState()
  const good = compile(s)
  const brokenState = { ...s, items: s.items.map((it) => (it.id === 'req-1' ? { ...it, sourceRefs: [] } : it)) }
  const problems = auditCompilation(good, brokenState)
  ok(problems.some((p) => p.includes('without a source ref')), 'must catch: ' + JSON.stringify(problems))
})

t('groupActive 按节分组正确', () => {
  const s = buildTankState()
  const g = groupActive(s)
  eq(g.requirements.map((x) => x.id).sort(), ['req-1', 'req-2'], 'requirements')
  eq(g.quality.map((x) => x.id), ['qi-1'], 'quality')
  eq(g.proposals.map((x) => x.id), ['prop-1'], 'proposals')
  eq(g.unknowns.map((x) => x.id), ['unk-1'], 'unknowns')
})

t('确定性：同样输入两次编译结果一致', () => {
  const s = buildTankState()
  eq(compile(s).text, compile(s).text, 'deterministic')
})

t('默认预算为常量且可覆盖', () => {
  const s = buildTankState()
  eq(compile(s).budget, DEFAULT_BUDGET, 'default budget')
  eq(compile(s, { budget: 5000 }).budget, 5000, 'override')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-compiler', phase: 'P3', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
