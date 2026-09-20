// P7 / E-001 · **执行入口**（宿主侧）
//
// 为什么需要这个文件（EV-0087）：`eval-run.js` 的 `runEvaluation` / `runUnits` 写好了、也测过了，
// 但**没有任何可运行入口**——全仓只有单测调用它们。也就是说 CHECKPOINT 早先那句
// "只差授权即可跑，不需再写代码"是**错的**。这与 EV-0078 是同一形态的缺口：
// 库是对的，生产路径上没有调用者。本模块就是那个调用者。
//
// 它必须跑在**宿主侧**（而不是一个独立脚本），因为模型调用要走宿主已装配的 LLM 服务
// （provider/model/凭据都在那儿）——与 eval-smoke 同一个理由。
//
// 三个阶段，顺序不能改：
//   ① 封存校验：题集 hash 不符 ⇒ **拒绝**（题集被改过，结论就不可比）
//   ② 逐题解释层：C 臂的意图包是**每题的属性**，必须逐题编译（`runEvaluation` 只接受单个 packet）
//   ③ 单元循环：交给 `runEvaluation`（它带开跑前的拒绝检查 + 预算闸门 + 续跑）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  parseHoldout, checkSealHash, tasksForStage, estimateCost, HOLDOUT_SEAL,
  MEASURED_PER_TASK, MEASURED_SMALL_PAIR, LARGE_TASK_IDS,
} from './eval-plan.js'
import { runEvaluation } from './eval-run.js'
import { complete } from './eval-llm.js'
import { SYSTEM_PROMPT, buildUserMessage, parseInterpreterOutput, dryRun, extractJson } from './interpreter.js'
import { buildArmMessages } from './eval-run.js'
import { createState } from './schema.js'
import { reduce } from './reducer.js'
import { compileAudited } from './compiler.js'

/** 逐题跑解释层并编译出该题的意图包。**失败即中止**（不静默退化成 A 臂）。
 *
 * 两个必须做到的事（都是被真实代价教会的）：
 *  ① **包文本必须落盘**。第一版只把 `{chars,usage,ms}` 写进报告，正文丢了——
 *     于是想验证"是不是【未决项】段导致 C 臂多问"时，手上没有包，只能**再付一次解释层的钱**。
 *     与"答案正文必须留档"（EV-0088）是同一个错误的两种形态。
 *  ② **已存在的包直接复用**（续跑）。重跑时不该为同样的输入重复付费。
 */
async function compilePackets({ tasks, llm, llmLib, spec, report, onSpend, outDir }) {
  const packets = new Map()
  const dir = join(outDir, 'packets')
  mkdirSync(dir, { recursive: true })
  for (const task of tasks) {
    const cached = join(dir, task.id + '.md')
    if (existsSync(cached)) {
      const t = readFileSync(cached, 'utf8')
      if (t) { packets.set(task.id, t); report.steps.packets.push({ taskId: task.id, chars: t.length, reused: true }); continue }
    }
    const sid = 'e001-' + task.id
    const st0 = createState({ sessionId: sid, taskId: task.id })
    const um = buildUserMessage({ userText: task.body, state: st0, sessionId: sid, messageId: 'm-' + task.id, observations: [] })
    const res = await complete({ llm, llmLib, cfg: spec, systemPrompt: SYSTEM_PROMPT, messages: [um] })
    const usage = res && res.usage ? Number(res.usage.totalTokens || 0) : 0
    onSpend(usage)
    const parsed = extractJson(res.text)
    if (!parsed.ok) throw new Error(`interpreter 未产出可解析 JSON（${task.id}）：${parsed.code || ''}`)
    const p = parseInterpreterOutput(res.text, {
      userText: task.body, sessionId: sid,
      baseRevision: st0.revision, baseInputRevision: st0.lastInputRevision, causeId: 'c-' + task.id,
    })
    if (!p.ok) throw new Error(`interpreter 输出被机械校验拒绝（${task.id}）：${p.code || p.reason || ''}`)
    if (!p.patch) throw new Error(`interpreter 无操作（${task.id}）⇒ C 臂没有包，继续跑会污染对照`)
    const dr = dryRun(p.patch, st0, reduce)
    if (!dr.ok) throw new Error(`reducer 拒绝解释结果（${task.id}）：${dr.reason || dr.code || ''}`)
    const r = reduce(st0, p.patch)
    if (!r.ok) throw new Error(`reduce 失败（${task.id}）：${r.reason || ''}`)
    const c = compileAudited(r.state)
    if (!c.ok || !c.text) throw new Error(`意图包为空或审计不过（${task.id}）：${(c.problems || []).join('; ')}`)
    packets.set(task.id, c.text)
    try { writeFileSync(join(dir, task.id + '.md'), c.text, 'utf8') } catch { /* 落盘失败不影响本轮 */ }
    report.steps.packets.push({ taskId: task.id, chars: c.text.length, usage, ms: res.ms })
  }
  return packets
}

/**
 * **实验用**：把包里的【未决项】整段去掉，其余原样。
 *
 * 为什么需要（EV-0088 的机制假设）：S1 里 C 臂的"实现细节类问句"是 A 臂的 2.4 倍（12 vs 5）。
 * 一个可疑原因是包里的【未决项（尚未确定，不要替我拍板）】段——
 * 模型看到"尚未确定"的条目，很可能就把它们**当成该问用户的问题抛了回去**，
 * 包括本该自己定的实现细节。要验证这一点，就需要"带未决项 / 去掉未决项"两个条件的对照。
 *
 * 这是**实验工具**，不是产品行为：产品里该不该有这一段，要由实验结果决定。
 */
export function stripUnknownSection(text) {
  const s = String(text || '')
  const start = s.indexOf('【未决项')
  if (start < 0) return s
  // 到下一个【 段头为止（没有就到结尾），并清掉因此产生的多余空行
  const rest = s.slice(start + 1)
  const nextRel = rest.indexOf('【')
  const end = nextRel < 0 ? s.length : start + 1 + nextRel
  return (s.slice(0, start) + s.slice(end)).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * @param ctx      宿主上下文（取 llm 服务）
 * @param opts     { holdoutPath, specPath, outDir, stage, runs, budget, llmLib, onlyTaskIds, onlyArms, onlyRuns }
 */
export async function runE001({ ctx, holdoutPath, specPath, outDir, stage = 'S1', runs = 3, budget,
  llmLib, onlyTaskIds = null, onlyArms = null, onlyRuns = null, dropUnknowns = false }) {
  const report = {
    probe: 'po06-e001', phase: 'P7', at: new Date().toISOString(),
    note: 'E-001 留出评估**正式运行**（真实模型）。结论只在 n≥3 且两臂都跑满时成立。',
    moduleUrl: import.meta.url,
    stage, steps: { packets: [] }, ok: false,
  }
  let spent = 0
  const spendRecords = []
  const onSpend = (t) => { spent += t; spendRecords.push(t) }

  try {
    // ① 封存校验
    // 题集随包发行（`files` 里有 eval/HOLDOUT-v1.md）。为什么**可以**随包发行：
    // 封存校验是 sha256，随包的那份一旦与封存值不符就会被拒绝运行——
    // 也就是说"发行副本漂移"这件事**由闸门自己兜住**，不需要靠人工比对。
    // 首次真机自检就撞到过这一点：`runE001` 在**装出来的**插件里找不到题集
    // （开发树里有、包里没有），正是 EV-0056 那类"源码树全绿、装出来直接崩"。
    if (!existsSync(holdoutPath)) { report.error = 'holdout-missing:' + holdoutPath; return report }
    const raw = readFileSync(holdoutPath)
    const sha = createHash('sha256').update(raw).digest('hex')
    const seal = checkSealHash(sha)
    report.steps.seal = { ok: seal.ok, actual: seal.actual, expected: seal.expected }
    if (!seal.ok) { report.error = 'seal-mismatch'; report.verdict = 'REFUSED: ' + seal.reason; return report }

    const spec = JSON.parse(readFileSync(specPath, 'utf8'))
    report.spec = {
      provider: spec.provider, model: spec.model, temperature: spec.temperature,
      armSystemPromptChars: String(spec.armSystemPrompt || '').length, specPath,
    }

    const allTasks = parseHoldout(raw.toString('utf8'))
    const stageTasks = onlyTaskIds
      ? allTasks.filter((t) => onlyTaskIds.includes(t.id))
      : tasksForStage(allTasks, stage)
    const arms = onlyArms || ['A', 'C']
    const runsUsed = onlyRuns || runs
    report.plan = { stage, tasks: stageTasks.map((t) => t.id), arms, runs: runsUsed, onlyTaskIds: onlyTaskIds || null }

    // ② 预算闸门：**额度低于上界就拒绝**（不是"省着跑"）
    const est = estimateCost({ tasks: stageTasks, arms, runs: runsUsed })
    report.estimate = { upper: est.upper, expected: est.expected, perArm: est.perArm, interpreter: est.interpreter }
    if (typeof budget !== 'number' || !(budget >= est.upper)) {
      report.error = 'budget-below-upper'
      report.verdict = `REFUSED: 授权 ${budget} < 上界 ${est.upper}（按上界授权才不会跑到一半没钱）`
      return report
    }
    report.budget = budget

    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') { report.error = 'llm-unavailable'; return report }

    mkdirSync(outDir, { recursive: true })

    // ③ 逐题解释层（C 臂需要；A 臂不需要）
    let packets = new Map()
    if (arms.includes('C')) {
      packets = await compilePackets({ tasks: stageTasks, llm, llmLib, spec, report, onSpend, outDir })
    }
    // 实验条件：去掉【未决项】段（用于验证"是不是这一段导致 C 臂多问"）
    if (dropUnknowns) {
      for (const [k, v] of packets) packets.set(k, stripUnknownSection(v))
      report.steps.dropUnknowns = true
    }
    report.steps.interpreterSpend = spent

    // ④ 单元循环（拒绝检查 / 预算 / 续跑都在 runEvaluation 里）
    const byId = new Map(stageTasks.map((t) => [t.id, t]))
    const estimateForUnit = (unit) => {
      const large = LARGE_TASK_IDS.includes(unit.taskId)
      const table = large ? MEASURED_PER_TASK : MEASURED_SMALL_PAIR
      return typeof table[unit.arm] === 'number' ? table[unit.arm] : null
    }
    const records = []
    const out = await runEvaluation({
      tasks: stageTasks, arms, runs: runsUsed, stage, budget, spec, llm, llmLib, packet: '',
      priorSpent: spent, estimateForUnit,
      onRecord: (rec) => {
        records.push(rec)
        try {
          writeFileSync(join(outDir, 'records.jsonl'), JSON.stringify(rec) + '\n', { encoding: 'utf8', flag: 'a' })
          // 每个单元的答案单独落一份可读文件：判据（是否放大原话 / 该问的问了没 / 约束是否守住）
          // 都要人读或仪器读正文，散在 JSONL 里不好用。
          if (rec.text) {
            const dir = join(outDir, 'units')
            mkdirSync(dir, { recursive: true })
            writeFileSync(join(dir, rec.unitId + '.md'), String(rec.text), 'utf8')
          }
        } catch { /* best effort */ }
      },
      // **注入真实补全**：这样走 runEvaluation 的拒绝检查，同时 C 臂能用**该题自己的**包。
      complete: async (unit) => {
        const task = byId.get(unit.taskId)
        if (!task) throw new Error('unknown task: ' + unit.taskId)
        const packet = packets.get(unit.taskId) || ''
        if (unit.arm === 'C' && !packet) throw new Error('C 臂缺包（拒绝退化成 A 臂）：' + unit.taskId)
        const messages = buildArmMessages({ arm: unit.arm, taskText: task.body, packet })
        return await complete({ llm, llmLib, cfg: spec, systemPrompt: spec.armSystemPrompt, messages })
      },
    })

    report.steps.run = { ok: out.ok, refused: out.refused || false, reason: out.reason || null, units: out.units, stopped: out.stopped || null }
    report.records = records.length
    report.spend = { interpreter: report.steps.interpreterSpend, units: out.spend || null, budget }
    report.outDir = outDir
    report.ok = out.ok === true && records.length > 0 && records.every((r) => r.ok === true)
    report.verdict = report.ok
      ? `RAN: ${records.length} 个单元全部产出（${report.plan.tasks.length} 题 × ${arms.join('/')} × ${runsUsed}）`
      : 'CHECK: 见 steps.run 与 records'
  } catch (e) {
    report.error = String((e && e.stack) || e)
    report.verdict = 'ERROR: ' + String((e && e.message) || e)
  } finally {
    try { mkdirSync(outDir, { recursive: true }) } catch { /* best effort */ }
    try { writeFileSync(join(outDir, 'e001-' + Date.now() + '.json'), JSON.stringify(report, null, 2), 'utf8') } catch { /* best effort */ }
  }
  return report
}
