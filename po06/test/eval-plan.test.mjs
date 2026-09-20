// P7 · 留出评估计划与预算守卫的单测（纯函数；不做任何生成）。
// 运行：node po06/test/eval-plan.test.mjs
//
// 这个文件要守住的四件事：
//   ① 题集**解析得对**（18 题、正文取全、不把"判据"当题干）；
//   ② 封存值不符 ⇒ **拒绝运行**（题集被改过，结论就不可比）；
//   ③ **默认不花钱**：没授权预算只能 dry-run；
//   ④ 预算低于**上界** ⇒ 拒绝（不是"省着跑"，是根本不开跑）。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  parseHoldout, checkSealHash, verifySeal, estimateCost, decideRun, renderPlan,
  HOLDOUT_SEAL, MEASURED_PER_TASK, LARGE_TASK_IDS,
} from '../lib/eval-plan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOLDOUT_PATH = join(HERE, '..', 'eval', HOLDOUT_SEAL.file)

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const text = readFileSync(HOLDOUT_PATH, 'utf8')
const sha = createHash('sha256').update(readFileSync(HOLDOUT_PATH)).digest('hex')
const tasks = parseHoldout(text)

// ── 1. 解析 ─────────────────────────────────────────────────────────
t('解析出 18 题，编号 H-01..H-18 齐全且不重复', () => {
  eq(tasks.length, 18, '题数')
  const ids = tasks.map((x) => x.id)
  eq(ids, Array.from({ length: 18 }, (_, i) => 'H-' + String(i + 1).padStart(2, '0')), '编号序列')
  eq(new Set(ids).size, 18, '无重复')
})

t('题干取全（含跨行），且**不含**"判据"段', () => {
  const h01 = tasks.find((x) => x.id === 'H-01')
  ok(h01.title === '机械结构', 'H-01 标题：' + h01.title)
  ok(h01.body.includes('摆轮') && h01.body.includes('擒纵') && h01.body.includes('产品广告片'),
    'H-01 题干必须完整：' + h01.body)
  ok(!h01.body.includes('判据'), 'H-01 不得混入判据段')

  // H-10 的题干之后紧跟一段"（判据：…）"，必须被切开
  const h10 = tasks.find((x) => x.id === 'H-10')
  eq(h10.body, '把这个列表页弄快点。', 'H-10 只取引用块')
  ok(!h10.body.includes('虚拟滚动'), 'H-10 不得包含判据内容')

  // 无标题形态
  const h07 = tasks.find((x) => x.id === 'H-07')
  eq(h07.title, null, 'H-07 无标题')
  ok(h07.body.includes('private'), 'H-07 题干：' + h07.body)
})

// ── 2. 封存 ─────────────────────────────────────────────────────────
t('封存 hash 与登记值一致（题集未被改动）', () => {
  const r = checkSealHash(sha)
  eq(r.ok, true, 'hash 必须一致；实际 ' + sha + ' vs ' + r.expected)
  eq(sha, HOLDOUT_SEAL.sha256, '与常量一致')
})

t('hash 不符 ⇒ 拒绝，且理由说明"结论不可比"', () => {
  const r = checkSealHash('0'.repeat(64))
  eq(r.ok, false, '必须不通过')
  ok(/不可比|不得改动/.test(r.reason), '理由要讲清代价：' + r.reason)
})

t('题数不符也能被识别（防止题集被截断）', () => {
  const cut = text.split('## 四、')[0]     // 砍掉后三节
  const r = verifySeal(cut)
  eq(r.okTasks, false, '截断后题数不符')
  ok(r.actualTasks < HOLDOUT_SEAL.tasks, '实际题数应少于 18：' + r.actualTasks)
})

// ── 3. 成本估计 ─────────────────────────────────────────────────────
const est = estimateCost({ tasks, arms: ['A', 'C'], runs: 3 })

t('上界 = 单题实测 × 18 × 3；期望值按假设折扣更低', () => {
  eq(est.upper, (MEASURED_PER_TASK.A + MEASURED_PER_TASK.C) * 18 * 3, '上界算法')
  ok(est.expected < est.upper, '期望值必须低于上界')
  ok(est.upper > 0 && est.expected > 0, '都要为正')
  const a = est.perArm.find((x) => x.arm === 'A')
  eq(a.largeTasks, LARGE_TASK_IDS.length, '大视觉题数')
  eq(a.smallTasks, 18 - LARGE_TASK_IDS.length, '其它题数')
})

t('没有实测依据的臂 ⇒ 标 unknown（不得编造单价）', () => {
  const e2 = estimateCost({ tasks, arms: ['A', 'X'], runs: 3 })
  const x = e2.perArm.find((p) => p.arm === 'X')
  eq(x.unknown, true, 'X 臂必须标 unknown')
  eq(x.upper, null, '不得给出上界')
})

// ── 4. 预算闸门 ─────────────────────────────────────────────────────
t('未授权预算 ⇒ dry-run（**默认不花钱**）', () => {
  const d = decideRun({ estimate: est, budget: null, runs: 3 })
  eq(d.mode, 'dry-run', '默认只能 dry-run')
  ok(/不做任何生成|只输出计划/.test(d.reason), '理由要说明不花钱：' + d.reason)
})

t('预算低于上界 ⇒ 拒绝（不是省着跑）', () => {
  const d = decideRun({ estimate: est, budget: Math.round(est.upper / 2), runs: 3 })
  eq(d.mode, 'refuse', '必须拒绝')
  ok(/上界需要/.test(d.reason), '理由要给出上界数字：' + d.reason)
})

t('预算 ≥ 上界 ⇒ execute', () => {
  const d = decideRun({ estimate: est, budget: est.upper, runs: 3 })
  eq(d.mode, 'execute', '边界值（等于上界）应放行')
  ok(/预算充足/.test(d.reason), d.reason)
})

t('runs < 3 ⇒ 拒绝（留出集自己规定 n=1 不得用于结论）', () => {
  for (const r of [1, 2]) {
    const d = decideRun({ estimate: est, budget: 99_999_999, runs: r })
    eq(d.mode, 'refuse', 'runs=' + r)
    ok(/≥3|不得用于结论/.test(d.reason), '理由要引用留出集规则：' + d.reason)
  }
})

t('预算为 0/负数/非数 ⇒ 拒绝', () => {
  for (const b of [0, -1, 'abc', NaN]) {
    const d = decideRun({ estimate: est, budget: b, runs: 3 })
    eq(d.mode, 'refuse', 'budget=' + String(b))
  }
})

t('有 unknown 臂 ⇒ 拒绝运行（无法给出上界就不能开跑）', () => {
  const e2 = estimateCost({ tasks, arms: ['A', 'X'], runs: 3 })
  const d = decideRun({ estimate: e2, budget: 99_999_999, runs: 3 })
  eq(d.mode, 'refuse', '必须拒绝')
  ok(/没有实测成本依据/.test(d.reason), '理由要说明缺依据：' + d.reason)
  ok(/X/.test(d.reason), '理由必须**点名**是哪个臂：' + d.reason)
})

// ── 5. 计划文本 ─────────────────────────────────────────────────────
t('计划文本含"未运行"、封存校验、上界与模式', () => {
  const sealCheck = checkSealHash(sha)
  const md = renderPlan({ estimate: est, decision: decideRun({ estimate: est, budget: null, runs: 3 }), seal: { ok: sealCheck.ok, reason: sealCheck.reason } })
  ok(md.includes('未运行'), '必须标明未运行')
  ok(md.includes('封存校验'), '含封存校验')
  ok(md.includes(String(est.upper)), '含上界数字')
  ok(md.includes('假设，不是测量'), '折扣必须标注为假设')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-eval-plan', phase: 'P7', total, pass, fail: failures.length, failures, holdoutSha256: sha }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
