// dsh-prompt-optimizer 0.6 · P7 留出评估的**计划与预算守卫**（纯函数，不做任何生成）
//
// 为什么先要有这个文件：
//   留出集（HOLDOUT-v1.md）**已封存但没有任何运行器**——也就是说 P7 目前
//   **根本跑不起来**，而不是"跑了但没结论"。同时它一旦运行就是本项目最大的一笔模型开销，
//   而用户从未授权过预算。所以第一步不是"跑"，而是把**封存校验、成本上界、预算闸门**
//   做成可复核的东西：授权之后一条命令就能跑，未授权时**在代码层面拒绝花钱**。
//
// 三条硬规则：
//   ① **封存校验**：文件 hash 与封存值不符 ⇒ 拒绝运行（题集被改过，结论就不可比）。
//   ② **n≥3**：留出集自己写明"n=1 不得用于结论"，所以运行数低于 3 直接拒绝。
//   ③ **预算闸门**：没有显式预算授权 ⇒ 只出计划；预算低于**上界** ⇒ 拒绝运行。

/** 封存值（与 EVIDENCE / CHECKPOINT / RELEASE-CHECKLIST 登记的必须一致）。 */
export const HOLDOUT_SEAL = Object.freeze({
  file: 'HOLDOUT-v1.md',
  sha256: '71b8956d8960f75d72003ef3ed14a9b1324b882404d26c39876a0d03638814ac',
  tasks: 18,
})

/** 每臂每题的**实测**单点成本（来自 D-01：A 40,090 / C 44,271 / D 65,446 tokens）。
 *  这是**大视觉题**（H-01…H-06，S2 期）的实测依据。绝不假装知道别题的价格。 */
export const MEASURED_PER_TASK = Object.freeze({
  A: 40090,   // 原话直发
  C: 44271,   // 原话 + 0.6 意图包
  D: 65446,   // 旧版 0.5.x 的命令输出
})

/**
 * **实测的"小题一整对"成本**（EV-0063，H-12 冒烟，真实模型调用）：
 * 解释层 1,978 + A 臂 464 + C 臂 822 = **3,264 tokens**。
 *
 * 这条比 `SMALL_TASK_FACTOR` 强得多——它是**测量**，不是折扣假设。
 * 所以"非大视觉题"的估计**优先用它**；`smallFactor` 只在没有实测锚点时兜底。
 */
export const MEASURED_SMALL_PAIR = Object.freeze({
  interpreter: 1978,
  A: 464,
  C: 822,
  pair: 3264,
  source: 'EV-0063（H-12 冒烟，deepseek-official/deepseek-v4.1-flash-expires-on-0910，无工具单次补全）',
})

/** 非大视觉题的**假设**折扣（**假设，不是测量**）：仅在无实测锚点时兜底。 */
export const SMALL_TASK_FACTOR = 0.15

/** 哪些题属于"大视觉创作"（用 D-01 实测锚点；其余用 MEASURED_SMALL_PAIR）。 */
export const LARGE_TASK_IDS = Object.freeze(['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06'])

/**
 * **分期评估**：一次性要 450 万 tokens 是一个糟糕的实验设计——
 * 它把"能不能证伪核心主张"和"审美好不好"绑在同一笔钱上。
 * 而 0.6 的核心主张（不越界、不缩水、该问才问、原话不被放大）恰恰可以在
 * **最便宜的那批题**上先证伪：歧义题与清晰小任务。
 *
 * 分期原则：**先花小钱买"能不能推翻它"，再花大钱买"好不好看"。**
 * 每期都能独立得出结论，且任何一期失败都不必再花后面的钱。
 */
export const STAGES = Object.freeze({
  S1: {
    key: 'S1', name: '核心主张（便宜、可证伪）',
    ids: ['H-07', 'H-08', 'H-09', 'H-10', 'H-11', 'H-12'],
    why: '清晰小任务 + 歧义题：直接检验「不越界 / 不缩水 / 该问才问 / 原话不被放大」。'
      + '这几题**不需要审美判断**，判据是二值的，且单价最低——最适合先证伪。',
  },
  S2: {
    key: 'S2', name: '视觉质量（贵、主观）',
    ids: ['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06'],
    why: '写实/风格化/建筑/数据可视化：**需要你的审美判断**，且单价最高。'
      + '应在 S1 通过之后再花钱——否则等于先买最贵而最说不清的那部分。',
  },
  S3: {
    key: 'S3', name: '长工程 + 环境 + 并发',
    ids: ['H-13', 'H-14', 'H-15', 'H-16', 'H-17', 'H-18'],
    why: '改口撤回、局部不扩散、长期约束保持、验证通道不可用、越界读文件、取消与晚到。'
      + '**需要多轮真实会话**，牵涉宿主交互，风险与前两期不同类。',
  },
})

/** 按分期挑题；未指定分期 = 全部 18 题。分期名非法时**退回全部**（不静默给一个错的子集）。 */
export function tasksForStage(tasks, stage) {
  if (!stage) return tasks.slice()
  const s = STAGES[String(stage).toUpperCase()]
  if (!s) return tasks.slice()
  return tasks.filter((t) => s.ids.includes(t.id))
}

/**
 * 解析留出集 markdown → 题目数组。
 * 支持两种标题形态：`**H-01 · 机械结构**（备注）` 与 `**H-07**`；正文取紧随其后的 `>` 引用块。
 * 解析失败（题数不符）**必须**由调用方当作故障处理——宁可拒绝跑，也不要跑一个残缺的题集。
 */
export function parseHoldout(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  const tasks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^\*\*(H-\d{2})(?:\s*·\s*([^*]*?))?\*\*(.*)$/.exec(lines[i].trim())
    if (!m) continue
    const body = []
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (t.startsWith('>')) { body.push(t.replace(/^>\s?/, '')); continue }
      if (t === '') { if (body.length) break; continue }   // 引用块结束
      break                                                 // 遇到非引用内容就停
    }
    tasks.push({
      id: m[1],
      title: (m[2] || '').trim() || null,
      note: (m[3] || '').trim().replace(/^（|）$/g, '') || null,
      body: body.join(' ').replace(/\s+/g, ' ').trim(),
    })
  }
  return tasks
}

/** 封存校验：hash 与题数都对才算通过。 */
export function verifySeal(text, expected = HOLDOUT_SEAL) {
  const actualTasks = parseHoldout(text).length
  const okTasks = actualTasks === expected.tasks
  // 由调用方传入实际 hash（本模块不做 IO，保持纯函数可测）
  return { okTasks, actualTasks, expectedTasks: expected.tasks }
}

/** 用给定 hash 与封存值比对。 */
export function checkSealHash(actualSha256, expected = HOLDOUT_SEAL) {
  const ok = String(actualSha256 || '').toLowerCase() === expected.sha256.toLowerCase()
  return {
    ok, actual: actualSha256 || null, expected: expected.sha256,
    reason: ok ? null : '题集文件 hash 与封存值不符：已封存的题目不得改动（改动即结论不可比）',
  }
}

/**
 * 成本估计。给出**上界**（所有题都按大视觉题计价）与**期望值**。
 *
 * 期望值的算法分两类，**优先用测量**：
 *   · 非大视觉题：用 `MEASURED_SMALL_PAIR`（EV-0063 实测：小题一整对 3,264 tokens）
 *     —— 这是**测量**；只有当该锚点不可用时才退回 `smallFactor` **假设**。
 *   · 大视觉题：用 D-01 的实测单题值。
 * 上界用于预算闸门——**要求授权额度不低于上界**，这样"跑一半没钱了"不会发生。
 * 结果里逐臂标出**用的是测量还是假设**，免得两者被混着引用。
 */
export function estimateCost({
  tasks, arms, runs = 3, measured = MEASURED_PER_TASK,
  smallFactor = SMALL_TASK_FACTOR, largeIds = LARGE_TASK_IDS,
  smallPair = MEASURED_SMALL_PAIR,
}) {
  const perArm = []
  let upper = 0
  let expected = 0
  for (const arm of arms) {
    const unit = measured[arm]
    if (typeof unit !== 'number') { perArm.push({ arm, unit: null, upper: null, expected: null, unknown: true }); continue }
    const nLarge = tasks.filter((t) => largeIds.includes(t.id)).length
    const nSmall = tasks.length - nLarge
    const armUpper = unit * tasks.length * runs
    // 优先用"小题一整对"的实测锚点；它按对给（含解释层），这里按臂拆开用。
    const smallUnitMeasured = smallPair && typeof smallPair[arm] === 'number' ? smallPair[arm] : null
    const smallUnit = smallUnitMeasured !== null ? smallUnitMeasured : unit * smallFactor
    const armExpected = (unit * nLarge + smallUnit * nSmall) * runs
    upper += armUpper
    expected += armExpected
    perArm.push({
      arm, unit, largeTasks: nLarge, smallTasks: nSmall,
      smallUnit: Math.round(smallUnit),
      smallUnitBasis: smallUnitMeasured !== null ? 'measured(EV-0063)' : 'assumed(smallFactor)',
      upper: Math.round(armUpper), expected: Math.round(armExpected),
    })
  }
  // C 臂需要**每题一次解释层调用**（意图包是"题的属性"，不随重复次数变化）。
  // 它不属于任何一臂，所以单列——否则总额会系统性地少算一块。
  const interp = smallPair && typeof smallPair.interpreter === 'number' ? smallPair.interpreter : null
  const interpreterTotal = interp === null ? null : interp * tasks.length
  const interpreterBasis = interp === null ? 'unknown' : 'measured(EV-0063)'
  const expectedWithInterpreter = interpreterTotal === null ? expected : expected + interpreterTotal
  const upperWithInterpreter = interpreterTotal === null ? upper : upper + interpreterTotal
  return {
    arms, runs, tasks: tasks.length,
    upper: Math.round(upperWithInterpreter), expected: Math.round(expectedWithInterpreter),
    perArm,
    interpreter: { perTask: interp, tasks: tasks.length, total: interpreterTotal, basis: interpreterBasis },
    note: '上界 = 所有题都按大视觉题计价（不打折）；期望值优先用**实测锚点**。'
      + '解释层单独计（C 臂每题一次，不属于任何一臂）。',
  }
}

/**
 * 运行闸门。**默认什么都不做**（dry-run），只有显式授权预算才可能进入 execute。
 * @returns {{mode:'dry-run'|'execute'|'refuse', reason:string, budget:number|null}}
 */
export function decideRun({ estimate, budget, runs = 3, minRuns = 3 }) {
  if (!estimate || !Array.isArray(estimate.perArm)) {
    return { mode: 'refuse', reason: '没有可用的成本估计', budget: null }
  }
  if (estimate.perArm.some((a) => a.unknown)) {
    const unknown = estimate.perArm.filter((a) => a.unknown).map((a) => a.arm).join(', ')
    return { mode: 'refuse', reason: '这些臂没有实测成本依据，无法给出预算上界：' + unknown, budget: null }
  }
  if (!(runs >= minRuns)) {
    return { mode: 'refuse', reason: `留出集要求每臂每題运行数 ≥${minRuns}（n=1 不得用于结论），当前 runs=${runs}`, budget: null }
  }
  if (budget === null || budget === undefined) {
    return { mode: 'dry-run', reason: '未授权预算：只输出计划，不做任何生成（要运行需显式给出预算上界）', budget: null }
  }
  const b = Number(budget)
  if (!Number.isFinite(b) || b <= 0) {
    return { mode: 'refuse', reason: '预算必须是一个正数（单位：tokens）', budget: null }
  }
  if (b < estimate.upper) {
    return {
      mode: 'refuse', budget: b,
      reason: `预算不足：上界需要 ${estimate.upper} tokens，授权 ${b}。`
        + '按上界而不是期望值授权，是为了避免"跑到一半没钱了"留下半套数据。',
    }
  }
  return { mode: 'execute', reason: `预算充足（授权 ${b} ≥ 上界 ${estimate.upper}）`, budget: b }
}

/** 人读的计划文本。 */
export function renderPlan({ estimate, decision, seal, stages }) {
  const L = []
  L.push('# P7 / E-001 留出评估计划（**未运行**）')
  L.push('')
  L.push('- 题集：`' + HOLDOUT_SEAL.file + '`（已封存 sha256 `' + HOLDOUT_SEAL.sha256.slice(0, 12) + '…`）')
  L.push('- **封存校验**：' + (seal.ok ? '通过（hash 与题数一致）' : '**不通过**：' + seal.reason))
  L.push('- 题目数：' + estimate.tasks + '　每臂每题运行数：**' + estimate.runs + '**（留出集要求 ≥3）')
  L.push('')
  L.push('## 成本')
  L.push('')
  L.push('| 臂 | 单题实测 | 大视觉题 | 其它题 | 上界 tokens | 期望 tokens |')
  L.push('|---|---|---|---|---|---|')
  for (const a of estimate.perArm) {
    L.push('| ' + a.arm + ' | ' + a.unit + ' | ' + a.largeTasks + ' | ' + a.smallTasks + ' | '
      + a.upper + ' | ' + a.expected + ' |')
  }
  L.push('| **合计** | | | | **' + estimate.upper + '** | **' + estimate.expected + '** |')
  L.push('')
  // 成本的**依据**必须由数字本身推出来，不能写在文案里——
  // 否则哪天模型换了，这里会继续宣称一个已经不对的来源（本文件真实踩过）。
  const bases = new Set(estimate.perArm.map((a) => a.smallUnitBasis))
  L.push('> 大视觉题单价来自 `exp/po06/bench/D-01/`（**实测**：A '
    + MEASURED_PER_TASK.A + ' / C ' + MEASURED_PER_TASK.C + ' / D ' + MEASURED_PER_TASK.D + '）。')
  if (bases.has('measured(EV-0063)')) {
    L.push('> 非大视觉题单价来自 **EV-0063 实测锚点**（小题一整对 3,264 tokens：解释层 '
      + MEASURED_SMALL_PAIR.interpreter + ' ＋ A ' + MEASURED_SMALL_PAIR.A + ' ＋ C ' + MEASURED_SMALL_PAIR.C + '）。')
  }
  if (bases.has('assumed(smallFactor)')) {
    L.push('> ⚠ **部分臂**的非大视觉题退回了 **' + SMALL_TASK_FACTOR + ' 折扣**——那是**假设，不是测量**。')
  }
  const it = estimate.interpreter
  if (it.basis === 'measured(EV-0063)') {
    L.push('> 解释层（C 臂**每题一次**，不属于任何一臂）：' + it.perTask + ' × ' + it.tasks
      + ' 题 = **' + it.total + '**，已计入上表合计。')
  } else {
    L.push('> ⚠ 解释层单价**未知**：**未计入**上表合计，实际开销会更高（需先用一次冒烟测量）。')
  }
  L.push('')
  if (stages) {
    L.push('## 分期（**建议从 S1 开始**）')
    L.push('')
    L.push('| 期 | 内容 | 题数 | 上界 tokens | 期望 tokens | 为什么先/后做 |')
    L.push('|---|---|---|---|---|---|')
    for (const [k, s] of Object.entries(stages)) {
      L.push('| **' + k + '** | ' + s.name + ' | ' + s.tasks + ' | ' + s.upper + ' | ' + s.expected
        + ' | ' + s.why + ' |')
    }
    L.push('')
    L.push('> 分期不是省钱的花招，而是**实验设计**：S1 的判据是二值的、不需要审美，')
    L.push('> 单价又最低——它能独立地证伪 0.6 的核心主张。若 S1 不通过，S2/S3 的钱就不必花。')
    L.push('')
  }
  L.push('## 判定')
  L.push('')
  L.push('- 模式：**' + decision.mode + '**')
  L.push('- 理由：' + decision.reason)
  L.push('')
  return L.join('\n')
}

/** 三期的成本一览（同样按**上界**与期望值两列给）。
 *  `smallPair` 必须**原样透传**：否则分期表与总额会用不同的依据算同一件事，
 *  用户会在同一份计划里看到两个对不上的数（这比算错更糟——它看起来像对的）。 */
export function estimateStages({
  tasks, arms, runs = 3, measured = MEASURED_PER_TASK,
  smallFactor = SMALL_TASK_FACTOR, largeIds = LARGE_TASK_IDS, smallPair = MEASURED_SMALL_PAIR,
}) {
  const out = {}
  for (const [k, s] of Object.entries(STAGES)) {
    const sub = tasks.filter((t) => s.ids.includes(t.id))
    const e = estimateCost({ tasks: sub, arms, runs, measured, smallFactor, largeIds, smallPair })
    out[k] = { key: k, name: s.name, why: s.why, tasks: sub.length, upper: e.upper, expected: e.expected }
  }
  return out
}

// ── 运行单元与**逐单元花费闸门** ────────────────────────────────────────
//
// 为什么把"该不该跑下一个单元"单独写成纯函数：这是**唯一**能防止超支的地方。
// 一次 S1 是几十次模型调用、几分钟到几十分钟，中途可能被打断、也可能实际单价比估计高。
// 所以判据必须是"**每个单元开始前**重新算一次余额"，而不是开跑前算一次就信任到底。

/**
 * 展开运行单元。顺序是 **按题 → 按次 → 按臂**：
 * 同一题的各臂相邻，这样即使中途模型行为漂移，同一题的 A/C 也是紧挨着产生的（可比性更好）。
 * `unitId` 稳定且可读，用于断点续跑与去重。
 */
export function buildRunUnits({ tasks, arms, runs = 3 }) {
  const units = []
  for (const t of tasks) {
    for (let i = 1; i <= runs; i++) {
      for (const arm of arms) {
        units.push({ unitId: t.id + '-' + arm + '-r' + i, taskId: t.id, arm, run: i, taskChars: (t.body || '').length })
      }
    }
  }
  return units
}

/** 已有产物的单元集合（断点续跑：跑过的绝不重跑，重跑等于重复花钱）。 */
export function completedUnitIds(records) {
  const done = new Set()
  for (const r of records || []) {
    if (r && r.unitId && r.ok === true) done.add(r.unitId)
  }
  return done
}

/**
 * 下一个单元该不该跑。**未授权预算 = 不跑**（与 decideRun 同一方向）。
 * @returns {{stop:boolean, reason:string, remaining?:number}}
 */
export function budgetStop({ spent, budget, nextUnitEstimate = null }) {
  if (budget === null || budget === undefined) {
    return { stop: true, reason: 'no-budget-authorized' }
  }
  const b = Number(budget)
  if (!Number.isFinite(b) || b <= 0) return { stop: true, reason: 'invalid-budget' }
  const s = Number(spent) || 0
  const remaining = b - s
  if (remaining <= 0) return { stop: true, reason: 'budget-exhausted', remaining: 0 }
  // 宁可停在单元边界，也不要"跑完了才发现超了"——超支的钱是收不回来的。
  if (nextUnitEstimate !== null && Number(nextUnitEstimate) > remaining) {
    return { stop: true, reason: 'next-unit-exceeds-remaining', remaining, nextUnitEstimate: Number(nextUnitEstimate) }
  }
  return { stop: false, reason: 'ok', remaining }
}

/** 汇总实际花费（供报告；`usage` 形状与模型返回一致）。 */
export function summarizeSpend(records) {
  let input = 0, output = 0, cacheRead = 0, total = 0, units = 0, failed = 0
  for (const r of records || []) {
    if (!r) continue
    if (r.ok !== true) { failed += 1; continue }
    units += 1
    const u = r.usage || {}
    input += Number(u.inputTokens) || 0
    output += Number(u.outputTokens) || 0
    cacheRead += Number(u.cacheReadTokens) || 0
    total += Number(u.totalTokens) || 0
  }
  return { units, failed, inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, totalTokens: total }
}
