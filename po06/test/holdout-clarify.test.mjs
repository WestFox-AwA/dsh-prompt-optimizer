// P7 × P4 · **拿留出集的真题**喂给澄清规划：检验它是否符合留出集自己写下的判据。
//
// 运行：node po06/test/holdout-clarify.test.mjs
//
// 为什么值得单独测：留出集的 S1 那 6 道题**明确写下了理想行为**，而此前
// 所有澄清测试用的都是人造夹具。真题与人造夹具的区别在这里很具体：
//   · H-11「这个仓库的构建脚本在哪、跑起来要多久？」——留出集写明
//     **「应当自己去读，不该问用户」**。若澄清规划把它变成一条要问用户的问题，
//     那就是**违背留出集判据的真实缺陷**。
//   · H-07/08/09 是清晰小任务——**不该回问**（回问就是增加用户负担，B6 直接不达标）。
//   · H-10/12 是偏好分叉——**应该问**，且 H-12 里"用哪个颜色库"属实现细节，
//     应当由工作 AI 自定（routed.decide），不占用户的问题额度。
//
// ⚠ 输入是**手写的解释层输出**（不是真实模型输出）。所以本文件测的是
//   「给定这样的解释结果，澄清规划是否符合判据」，**不测**模型会不会产出这样的解释。
//   后者需要真实调用，属 E-001（EV-0055/0058）。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createState } from '../lib/schema.js'
import { reduce } from '../lib/reducer.js'
import { planClarification } from '../lib/clarifier.js'
import { compileAudited } from '../lib/compiler.js'
import { parseHoldout, HOLDOUT_SEAL, STAGES, tasksForStage } from '../lib/eval-plan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOLDOUT = readFileSync(join(HERE, '..', 'eval', HOLDOUT_SEAL.file), 'utf8')
const S1 = tasksForStage(parseHoldout(HOLDOUT), 'S1')
const SID = 'session-holdout-s1'
const human = (m) => ({ kind: 'human', sessionId: SID, messageId: m })

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String((e && e.message) || e) }) } }

/** 用 reducer 建状态（与真实路径一致，不直接拼对象）。 */
function build(ops) {
  const s0 = createState({ sessionId: SID, taskId: 'holdout' })
  if (ops.length === 0) return s0
  const r = reduce(s0, { causeId: 'c', baseRevision: 0, sessionId: SID, ops })
  if (!r.ok) throw new Error('fixture failed: ' + r.reason)
  return r.state
}

const task = (id) => S1.find((x) => x.id === id)
const req = (id, text, quote, extra = {}) => ({
  op: 'add_item',
  item: { id, kind: 'user_requirement', scope: 'task', text, sourceRefs: [human(quote)], ...extra },
})
const unk = (id, text, extra = {}) => ({
  op: 'add_item',
  item: { id, kind: 'unknown', scope: 'task', text, sourceRefs: [{ kind: 'model', sessionId: SID }], ...extra },
})

// ── 0. 前提：确实拿到的是留出集的 S1 六题 ────────────────────────────
t('拿到的是留出集 S1 的 6 道真题（不是人造文本）', () => {
  eq(S1.length, 6, 'S1 题数')
  eq(S1.map((x) => x.id), STAGES.S1.ids.slice().sort(), '题号')
  ok(S1.every((x) => typeof x.body === 'string' && x.body.length > 3), '每题都有正文')
  ok(task('H-11').body.includes('构建脚本'), 'H-11 正文：' + task('H-11').body)
})

// ── 1. 清晰小任务：**不该回问** ─────────────────────────────────────
// 留出集把 H-07/08/09 归为"清晰小任务"。若这里冒出问题，等于给用户白加负担。
t('H-07 清晰小任务：无未知项 ⇒ 不提问、不改写', () => {
  const s = build([req('req-1', '把 package.json 里的 private 从 false 改成 true。', 'private')])
  const p = planClarification(s)
  eq(p.mode, 'none', '不该问')
  eq(p.questions.length, 0, '零问题')
  eq(p.reason, 'no-unknowns', '理由应为无未知项：' + p.reason)
})

t('H-08 / H-09 同样：只有明确要求时不得产生问题', () => {
  for (const id of ['H-08', 'H-09']) {
    const s = build([req('req-1', task(id).body, task(id).body.slice(0, 6))])
    const p = planClarification(s)
    eq(p.mode, 'none', id + ' 不该问')
    eq(p.questions.length, 0, id + ' 零问题')
  }
})

// ── 2. H-11：可查事实 → **必须路由去查，绝不能不问就丢给用户** ────────
// 留出集原文：「应当自己去读，不该问用户。」
t('H-11 可查事实：路由为 lookup，**不得**变成问用户的问题', () => {
  const s = build([
    req('req-1', '说明该仓库的构建脚本位置与运行时长。', '构建脚本'),
    unk('unk-1', '构建脚本在哪、跑起来要多久？', { unknownClass: 'lookupable_fact' }),
  ])
  const p = planClarification(s)
  eq(p.routed.lookup, ['unk-1'], '必须进 lookup')
  eq(p.questions.length, 0, '**不得**问用户（这正是留出集的判据）')
  eq(p.mode, 'none', '没有该问的')
})

t('H-11 反向：若分类缺失（模型没输出 unknownClass）⇒ 退化为用户偏好、**会**问 —— 如实暴露契约问题', () => {
  // 这一条记录的是**已知的真实风险**（EV-0037：模型两次都没输出 unknownClass）。
  // 不是"通过"，而是把"可查事实被当成用户偏好去问"的路径钉在案上。
  const s = build([
    req('req-1', '说明该仓库的构建脚本位置与运行时长。', '构建脚本'),
    unk('unk-1', '构建脚本在哪、跑起来要多久？'),      // 无 unknownClass
  ])
  const p = planClarification(s)
  eq(p.mode, 'ask', '分类缺失时会问（保守方向：不替用户拍板）')
  eq(p.unclassified, 1, '必须把"契约未被遵守"计数暴露出来')
})

// ── 3. H-10 / H-12：偏好分叉 → 该问的那部分要问，不该问的要自定 ────────
t('H-10 真偏好分叉：问用户偏好，且可查的部分单独路由', () => {
  const s = build([
    req('req-1', '把列表页弄快。', '弄快点'),
    unk('unk-1', '要解决的是哪一类慢（首屏/图片/接口/虚拟滚动）？', { unknownClass: 'user_preference' }),
    unk('unk-2', '当前首屏耗时是多少？', { unknownClass: 'lookupable_fact' }),
  ])
  const p = planClarification(s)
  eq(p.mode, 'ask', '偏好分叉该问')
  eq(p.questions.map((q) => q.itemId), ['unk-1'], '只问偏好那条')
  eq(p.routed.lookup, ['unk-2'], '"当前多慢"是可查事实，路由去查而不是问用户')
})

t('H-12 取舍：实现细节由工作 AI 自定，不占用户问题额度', () => {
  const s = build([
    req('req-1', '给 CLI 加上彩色输出。', '彩色输出'),
    unk('unk-1', '哪些信息上色？', { unknownClass: 'user_preference' }),
    unk('unk-2', '用哪个颜色库？', { unknownClass: 'implementation_detail' }),
  ])
  const p = planClarification(s)
  eq(p.mode, 'ask', '该问的影响结果的取舍')
  eq(p.questions.map((q) => q.itemId), ['unk-1'], '只问"哪些上色"')
  eq(p.routed.decide, ['unk-2'], '"用哪个库"由工作 AI 自定')
  ok(!p.questions.some((q) => q.itemId === 'unk-2'), '实现细节绝不能出现在问题里')
})

// ── 4. 真题上的编译：分节正确、无越界、无缩水 ───────────────────────
t('S1 六题逐一编译：审计通过、文本非空、原话逐字可回溯', () => {
  for (const x of S1) {
    const quote = x.body.length > 8 ? x.body.slice(0, 8) : x.body
    const s = build([req('req-1', x.body, quote)])
    const c = compileAudited(s)
    eq(c.problems, [], x.id + ' 审计必须无问题：' + JSON.stringify(c.problems))
    ok(c.ok === true, x.id + ' ok')
    ok(c.text.length > 0, x.id + ' 编译文本不得为空')
    ok(c.text.includes(quote), x.id + ' 必须逐字回引原话：' + quote)
    const reqSec = c.sections.find((sec) => sec.key === 'requirements')
    ok(reqSec && reqSec.itemIds.length === 1, x.id + ' 明确要求节应有 1 条，实际 '
      + JSON.stringify(reqSec || null))
  }
})

t('质量解释不得出现在"明确要求"节（越界的结构化防线）', () => {
  const s = build([
    req('req-1', '极其精细的坦克模型。', '极其精细'),
    { op: 'add_item', item: { id: 'qual-1', kind: 'quality_interpretation', scope: 'task', text: '增加 1080p 60 帧', sourceRefs: [{ kind: 'model', sessionId: SID }] } },
  ])
  const c = compileAudited(s)
  const reqSec = c.sections.find((sec) => sec.key === 'requirements')
  ok(!(reqSec && reqSec.itemIds.includes('qual-1')), '质量解释不得混进明确要求')
  const qSec = c.sections.find((sec) => sec.key === 'quality')
  ok(qSec && qSec.itemIds.includes('qual-1'), '应落在质量解释节：' + JSON.stringify(c.sections))
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-holdout-clarify', phase: 'P7xP4', total, pass, fail: failures.length,
  failures, holdoutSha256: HOLDOUT_SEAL.sha256,
  note: '输入为手写解释层输出；测的是"给定解释结果，规划是否符合留出集判据"',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
