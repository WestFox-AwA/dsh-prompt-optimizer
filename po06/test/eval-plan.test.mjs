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
  HOLDOUT_SEAL, MEASURED_PER_TASK, MEASURED_SMALL_PAIR, UPPER_MARGIN, LARGE_TASK_IDS, STAGES, tasksForStage, estimateStages,
  buildRunUnits, completedUnitIds, budgetStop, summarizeSpend,
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

t('上界 = 每类实测锚点 × 方差余量 ＋ 解释层；期望值更低', () => {
  // 上界不再"把所有题按大视觉题计价"（那是类别错误，见 EV-0086）：
  // 现在按题类分别用自己的实测锚点，再乘同一个方差余量。
  const a = est.perArm.find((x) => x.arm === 'A')
  const c = est.perArm.find((x) => x.arm === 'C')
  eq(a.upper, (MEASURED_PER_TASK.A * UPPER_MARGIN * a.largeTasks + a.smallUnit * UPPER_MARGIN * a.smallTasks) * 3,
    'A 臂上界按题类分别计价 × 余量 × 轮数')
  eq(c.upper, (MEASURED_PER_TASK.C * UPPER_MARGIN * c.largeTasks + c.smallUnit * UPPER_MARGIN * c.smallTasks) * 3,
    'C 臂同理')
  eq(est.upper, a.upper + c.upper + est.interpreter.upper, '总额 = 各臂 ＋ 解释层上界')
  ok(est.expected < est.upper, '期望值必须低于上界')
  ok(est.upper > 0 && est.expected > 0, '都要为正')
  eq(a.largeTasks, LARGE_TASK_IDS.length, '大视觉题数')
  eq(a.smallTasks, 18 - LARGE_TASK_IDS.length, '其它题数')
})

// 这条守的是"闸门要可用"：不可用的闸门会被绕过，那比没有更糟。
t('上界与期望值的比例必须与余量同量级（不再跨类借价）', () => {
  const ratio = est.upper / est.expected
  ok(ratio < 10, `上界/期望值 应接近余量（${UPPER_MARGIN}×），实测 ${ratio.toFixed(1)}× —— 过大说明又在跨类借价`)
  ok(ratio >= UPPER_MARGIN - 0.01, `上界至少是期望值的 ${UPPER_MARGIN} 倍（保守方向不得打折），实测 ${ratio.toFixed(1)}×`)
})

// 解释层是**每题一次**（意图包是题的属性），不是每臂、更不是每轮。
// 乘错任何一维都会让预算系统性偏离——这是最容易写错的一处。
t('解释层按"每题一次"计，不随臂数与轮数翻倍', () => {
  const one = estimateCost({ tasks, arms: ['A', 'C'], runs: 1 })
  const three = estimateCost({ tasks, arms: ['A', 'C'], runs: 3 })
  eq(one.interpreter.total, three.interpreter.total, '轮数变化不得改变解释层总额')
  eq(three.interpreter.total, MEASURED_SMALL_PAIR.interpreter * 18, '解释层 = 单价 × 题数')
  const onlyA = estimateCost({ tasks, arms: ['A'], runs: 3 })
  eq(onlyA.interpreter.total, three.interpreter.total, '解释层不按臂数翻倍（它不属于任何一臂）')
  ok(onlyA.upper < three.upper, '少一臂 ⇒ 总额必须更低（否则解释层把差额吃掉了）')
})

// **总额 = 各臂之和 ＋ 解释层**：这是"计划上写的钱"与实际要花的钱的一致性。
// 少了这一条，解释层可以悄悄从总额里消失而不触发任何红灯（实测到的漏洞）。
t('计划上写的钱 = 各臂之和 ＋ 解释层（不得少报）', () => {
  const armSum = est.perArm.reduce((s, p) => s + p.expected, 0)
  eq(est.expected, armSum + est.interpreter.total, '期望总额必须含解释层（漏计即少报钱）')
  const armSumUpper = est.perArm.reduce((s, p) => s + p.upper, 0)
  eq(est.upper, armSumUpper + est.interpreter.upper, '上界总额必须含解释层（按其自身的上界）')
})

// 期望值必须**优先用测量**。这条守的是"别把假设当测量"。
t('小题单价用实测锚点（EV-0063），而非折扣假设', () => {
  const a = est.perArm.find((x) => x.arm === 'A')
  const c = est.perArm.find((x) => x.arm === 'C')
  eq(a.smallUnitBasis, 'measured(EV-0063)', 'A 臂小题单价必须标注为实测')
  eq(c.smallUnitBasis, 'measured(EV-0063)', 'C 臂小题单价必须标注为实测')
  eq(a.smallUnit, MEASURED_SMALL_PAIR.A, 'A 臂小题单价 = 实测值，不是 unit×小折扣')
  eq(c.smallUnit, MEASURED_SMALL_PAIR.C, 'C 臂小题单价 = 实测值')
  ok(a.smallUnit < MEASURED_PER_TASK.A * 0.15 * 2,
    `实测小题单价应显著低于大视觉题单价：${a.smallUnit} vs ${MEASURED_PER_TASK.A}`)
})

// 锚点缺失时必须**退回假设并如实标注**——不能默默用 0，也不能冒充实测。
t('无实测锚点 ⇒ 退回假设折扣，并如实标注为假设', () => {
  const fallback = estimateCost({ tasks, arms: ['A', 'C'], runs: 3, smallPair: null })
  const a = fallback.perArm.find((x) => x.arm === 'A')
  eq(a.smallUnitBasis, 'assumed(smallFactor)', '无锚点时必须标注为假设')
  eq(a.smallUnit, Math.round(MEASURED_PER_TASK.A * 0.15), '退回首版折扣算法')
  eq(fallback.interpreter.basis, 'unknown', '解释层无锚点时必须标 unknown')
  eq(fallback.interpreter.perTask, null, '不得编造解释层单价')
  ok(fallback.expected > 0, '退路也必须给出可用估计')
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
})

// 计划文本的**成本依据**必须跟着数字走。这条守的是"文案撒谎"：
// 曾经它硬写着"按 0.15 折扣估计"，而那时已经改用实测锚点了。
t('成本依据跟着数字走：实测锚点 ⇒ 不得再宣称是假设', () => {
  const sealCheck = checkSealHash(sha)
  const dec = decideRun({ estimate: est, budget: null, runs: 3 })
  const md = renderPlan({ estimate: est, decision: dec, seal: { ok: sealCheck.ok, reason: sealCheck.reason } })
  ok(md.includes('实测锚点'), '有实测锚点时必须写明：' + md.slice(0, 400))
  ok(!md.includes('假设，不是测量'), '既有实测依据，就不得再说是假设')
  ok(md.includes('每题一次'), '解释层的计费方式必须写清（每题一次，不随轮数翻倍）')

  // 反过来：锚点缺失时必须如实降级为"假设"，并且**明说解释层没算进去**——
  // 否则用户会以为表上的数字就是全部开销。
  const fb = estimateCost({ tasks, arms: ['A', 'C'], runs: 3, smallPair: null })
  const md2 = renderPlan({ estimate: fb, decision: dec, seal: { ok: sealCheck.ok, reason: sealCheck.reason } })
  ok(md2.includes('假设，不是测量'), '退回假设时必须标注为假设')
  ok(md2.includes('未计入'), '解释层未计入总额时必须明说（不能让人以为这是全部）')
})

// 分期表与总额表必须是**同一套依据**算出来的，否则同一份计划里两个数对不上。
t('分期表与总额表同依据：smallPair 必须透传到 estimateStages', () => {
  const withAnchor = estimateStages({ tasks, arms: ['A', 'C'], runs: 3 })
  const noAnchor = estimateStages({ tasks, arms: ['A', 'C'], runs: 3, smallPair: null })
  ok(noAnchor.S1.expected !== withAnchor.S1.expected,
    `两种依据必须给出不同的 S1 期望值（否则 smallPair 没透传）：${noAnchor.S1.expected} vs ${withAnchor.S1.expected}`)
  ok(noAnchor.S1.expected > withAnchor.S1.expected, '假设折扣应比实测锚点更贵（保守方向）')
  // 分期表里的 S1 必须与"直接对 S1 那 6 道题算一次"完全一致
  // （注意不能拿全量 18 题那个 est 来比——那不是同一件事）
  const s1Direct = estimateCost({ tasks: tasksForStage(tasks, 'S1'), arms: ['A', 'C'], runs: 3 })
  eq(withAnchor.S1.expected, s1Direct.expected, 'S1 期望值必须与直接估计一致（同依据）')
  eq(withAnchor.S1.upper, s1Direct.upper, 'S1 上界同理')
  eq(noAnchor.S1.expected,
    estimateCost({ tasks: tasksForStage(tasks, 'S1'), arms: ['A', 'C'], runs: 3, smallPair: null }).expected,
    '退回假设时也必须与直接估计一致')
})

// ── 6. 分期（实验设计，不是为了省钱）────────────────────────────────
t('三期覆盖全部 18 题且互不重叠', () => {
  const ids = Object.values(STAGES).flatMap((s) => s.ids)
  eq(ids.length, 18, '三期合计题数')
  eq(new Set(ids).size, 18, '不得重复')
  eq(ids.slice().sort(), tasks.map((x) => x.id).sort(), '必须与留出集题目一致')
})

t('tasksForStage 只给该期的题；未知分期退回全部（不静默给错子集）', () => {
  const s1 = tasksForStage(tasks, 'S1').map((x) => x.id).sort()
  eq(s1, STAGES.S1.ids.slice().sort(), 'S1 题目')
  eq(tasksForStage(tasks, 's2').length, 6, '大小写不敏感')
  eq(tasksForStage(tasks, null).length, 18, '不给分期 = 全部')
  eq(tasksForStage(tasks, 'S9').length, 18, '未知分期退回全部')
})

t('**分期是实验设计**：S1 必须显著便宜于全量，否则分期没意义', () => {
  const all = estimateCost({ tasks, arms: ['A', 'C'], runs: 3 })
  const st = estimateStages({ tasks, arms: ['A', 'C'], runs: 3 })
  eq(st.S1.tasks, 6, 'S1 题数')
  // 上界不再按题数线性（S1 全是小题、全量含 6 道大视觉题 ⇒ 两者单价不同），
  // 所以这里断言的是**量级**而不是"恰好 1/3"。
  ok(st.S1.upper < all.upper / 5,
    `S1 上界应远低于全量（S1 零道大视觉题）：S1=${st.S1.upper} 全量=${all.upper}`)
  // 真正有意义的是**期望值**：S1 全是非视觉题 ⇒ 折扣生效 ⇒ 远低于全量
  ok(st.S1.expected < all.expected / 5,
    `S1 期望值应远低于全量（折扣生效）：S1=${st.S1.expected} 全量=${all.expected}`)
  ok(st.S1.expected < st.S1.upper, 'S1 期望值低于其上界')
  eq(st.S2.expected, st.S2.upper / UPPER_MARGIN, 'S2 全是视觉题 ⇒ 上界恰为期望值的余量倍')
})

t('S1 覆盖的正是"不需要审美判断"的那批（清晰小任务 + 歧义题）', () => {
  for (const id of ['H-07', 'H-08', 'H-09', 'H-10', 'H-11', 'H-12']) {
    ok(STAGES.S1.ids.includes(id), 'S1 应含 ' + id)
  }
  for (const id of LARGE_TASK_IDS) {
    ok(!STAGES.S1.ids.includes(id), 'S1 不应含大视觉题 ' + id)
  }
})

// ── 7. 运行单元与**逐单元花费闸门**（唯一能防超支的地方）─────────────
t('buildRunUnits：题 × 次 × 臂，数量与顺序都对', () => {
  const sub = tasksForStage(tasks, 'S1')
  const units = buildRunUnits({ tasks: sub, arms: ['A', 'C'], runs: 3 })
  eq(units.length, 6 * 3 * 2, '6 题 × 3 次 × 2 臂 = 36')
  eq(units[0].unitId, 'H-07-A-r1', '首个单元')
  eq(units[1].unitId, 'H-07-C-r1', '同一题的 A/C 必须相邻（可比性）')
  eq(units[2].unitId, 'H-07-A-r2', '然后才是第 2 次')
  eq(units[units.length - 1].unitId, 'H-12-C-r3', '末个单元')
  eq(new Set(units.map((u) => u.unitId)).size, units.length, 'unitId 必须唯一')
  // 确定性：同输入重复构造结果一致（断点续跑依赖这一点）
  eq(buildRunUnits({ tasks: sub, arms: ['A', 'C'], runs: 3 }), units, '必须确定性')
})

t('completedUnitIds：只有 ok 的才算跑过（失败的必须重跑）', () => {
  const recs = [
    { unitId: 'u1', ok: true }, { unitId: 'u2', ok: false },
    { unitId: 'u3', ok: true }, { unitId: 'u4' }, null,
  ]
  eq([...completedUnitIds(recs)].sort(), ['u1', 'u3'], '只认 ok === true')
  eq([...completedUnitIds(null)].length, 0, 'null 不抛')
})

t('budgetStop：**未授权预算 = 不跑**（与 decideRun 同方向）', () => {
  eq(budgetStop({ spent: 0, budget: null }).stop, true, 'null 预算')
  eq(budgetStop({ spent: 0, budget: null }).reason, 'no-budget-authorized', '理由')
  eq(budgetStop({ spent: 0, budget: undefined }).stop, true, 'undefined 预算')
  for (const b of [0, -1, 'abc', NaN]) {
    eq(budgetStop({ spent: 0, budget: b }).stop, true, 'budget=' + String(b))
  }
})

t('budgetStop：余额用尽即停；余额够则继续', () => {
  eq(budgetStop({ spent: 100, budget: 100 }).stop, true, '刚好用尽')
  eq(budgetStop({ spent: 100, budget: 100 }).reason, 'budget-exhausted', '理由')
  eq(budgetStop({ spent: 150, budget: 100 }).stop, true, '已超支（也必须停）')
  const okCase = budgetStop({ spent: 100, budget: 1000 })
  eq(okCase.stop, false, '余额 900 ⇒ 继续')
  eq(okCase.remaining, 900, '余额')
})

t('budgetStop：**下一个单元就超预算时不跑**（宁可停在边界，不可跑完才发现超了）', () => {
  const d = budgetStop({ spent: 900, budget: 1000, nextUnitEstimate: 200 })
  eq(d.stop, true, '200 > 余额 100 ⇒ 停')
  eq(d.reason, 'next-unit-exceeds-remaining', '理由要能区分"用尽"与"下一个太大"')
  eq(d.remaining, 100, '余额')
  eq(budgetStop({ spent: 900, budget: 1000, nextUnitEstimate: 100 }).stop, false, '刚好等于余额 ⇒ 放行')
  eq(budgetStop({ spent: 900, budget: 1000, nextUnitEstimate: 99 }).stop, false, '小于余额 ⇒ 放行')
})

t('budgetStop 的判据是**逐单元重算**，不是开跑前算一次就算完', () => {
  // 模拟实际单价高于估计：每单元 300，预算 1000 ⇒ 跑到第 4 个必须停
  let spent = 0
  const budget = 1000
  const perUnit = 300
  const ran = []
  for (let i = 1; i <= 10; i++) {
    const d = budgetStop({ spent, budget, nextUnitEstimate: perUnit })
    if (d.stop) { ran.push('STOP:' + d.reason); break }
    spent += perUnit
    ran.push(i)
  }
  eq(ran, [1, 2, 3, 'STOP:next-unit-exceeds-remaining'], '第 4 个之前必须停（已花 900，余额 100 < 300）')
  ok(spent <= budget, '实际花费不得超预算：' + spent)
})

t('summarizeSpend：只统计成功的单元，且把失败计数暴露出来', () => {
  const s = summarizeSpend([
    { unitId: 'u1', ok: true, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, totalTokens: 33 } },
    { unitId: 'u2', ok: true, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    { unitId: 'u3', ok: false, usage: { inputTokens: 999, outputTokens: 999, totalTokens: 1998 } },
    null,
  ])
  eq(s.units, 2, '成功单元数')
  eq(s.failed, 1, '失败单元数必须暴露')
  eq(s.inputTokens, 11, '输入合计')
  eq(s.outputTokens, 22, '输出合计')
  eq(s.cacheReadTokens, 3, '缓存读合计')
  eq(s.totalTokens, 36, '总计')
  eq(summarizeSpend([]), { units: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }, '空输入')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-eval-plan', phase: 'P7', total, pass, fail: failures.length, failures, holdoutSha256: sha }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
