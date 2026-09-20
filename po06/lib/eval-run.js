// P7 / E-001 · **运行编排**（宿主侧）。
//
// 与 eval-plan.js 的分工：
//   · eval-plan 负责**判据**（单元怎么展开、余额够不够、什么时候必须停）——纯函数、已单测；
//   · 本模块负责**把判据串成一次真实运行**：取题 → 构造两臂消息 → 逐单元调用 →
//     落盘 → 断点续跑 → 在预算边界停下。
//
// 它刻意把"调用模型"做成**注入的** `complete` 函数：
// 于是循环、预算、续跑、失败处理这些**真正容易错**的地方，
// 可以用假的补全函数做确定性测试——不必花钱就能验"会不会超支"。

import { buildRunUnits, completedUnitIds, budgetStop, summarizeSpend } from './eval-plan.js'

/**
 * 构造某一臂要发出去的用户消息（**逐字**，供事后核对实验是否公平）。
 * A = 只有原话；C = 原话 + 0.6 编译出的意图包（与 D-01 的 C 臂口径一致）。
 */
export function buildArmMessages({ arm, taskText, packet = '' }) {
  if (arm === 'A') return [String(taskText)]
  if (arm === 'C') return [String(taskText), String(packet)]
  throw new Error('unknown arm: ' + String(arm))
}

/**
 * **多轮**：构造第 k 轮要发出的全部消息（单次补全没有会话状态，必须重放历史）。
 *
 * 两臂的差别就在这里，而且这个差别必须是**忠实**的：
 *   · A 臂（无插件）：历史里只有用户各轮的原话；
 *   · C 臂（0.6）：历史里有用户原话，外加**只保留最新那一份意图包**。
 *
 * 为什么是最新一份而不是每轮都追加：0.6 的投递是 `form:'snapshot'` 的**全值**语义——
 * 新快照**取代**旧快照（ADR-0006 / EV-0040 验过"取代而非追加"）。
 * 若实验里把每轮意图包都堆进历史，测的就不是 0.6，而是一个**比 0.6 更啰嗦**的东西。
 *
 * @param turns   [{ userText }] 每一轮的用户原话
 * @param packets 与 turns 等长；packets[k] 是第 k 轮编译出的意图包（C 臂用）
 * @param upTo    构造到第几轮为止（缺省 = 最后）
 */
export function buildTurnMessages({ arm, turns, packets = [], upTo = null }) {
  if (arm !== 'A' && arm !== 'C') throw new Error('unknown arm: ' + String(arm))
  const last = upTo === null ? turns.length - 1 : Number(upTo)
  if (!Number.isInteger(last) || last < 0 || last >= turns.length) {
    throw new Error('upTo out of range: ' + String(upTo) + ' (turns=' + turns.length + ')')
  }
  const out = []
  for (let i = 0; i <= last; i++) out.push(String(turns[i].userText))
  if (arm === 'C') {
    const p = packets[last]
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error('C 臂第 ' + last + ' 轮缺少意图包（**不得静默退化成 A 臂**）')
    }
    out.push(p)          // **只放最新的那一份**
  }
  return out
}

/** 历史里出现了几份意图包（取代语义的守卫：C 臂任何一轮都只该有 1 份）。 */
export function countPacketsInMessages({ messages, packets }) {
  const set = new Set((packets || []).filter((p) => typeof p === 'string' && p.length > 0))
  return messages.filter((m) => set.has(m)).length
}

/**
 * 依次跑多轮。`complete` 注入，便于用假补全做确定性测试（不花钱）。
 */
export async function runTurnSequence({ arm, turns, packets = [], complete, onRound = null }) {
  if (typeof complete !== 'function') throw new Error('runTurnSequence: complete() is required')
  const rounds = []
  let total = 0
  for (let i = 0; i < turns.length; i++) {
    const messages = buildTurnMessages({ arm, turns, packets, upTo: i })
    const r = await complete({ index: i, messages, userText: turns[i].userText })
    const usage = (r && r.usage) || null
    total += Number(usage && usage.totalTokens) || 0
    const rec = {
      index: i, messages, messageCount: messages.length,
      answer: (r && r.text) || '', usage, ms: (r && r.ms) || null,
    }
    rounds.push(rec)
    if (typeof onRound === 'function') { try { onRound(rec) } catch { /* 落盘失败不打断 */ } }
  }
  return { arm, rounds, spend: { totalTokens: total } }
}

/**
 * 逐单元运行。**只依赖注入的 complete**，因此可被确定性测试。
 *
 * @param units        buildRunUnits 的结果（本次要跑的题 × 次 × 臂）
 * @param budget       已授权预算（tokens）。**null = 不跑**（不会调用任何东西）
 * @param spentSoFar   之前已经花掉的（续跑时传入）
 * @param done         completedUnitIds 的结果（跑过的绝不重跑）
 * @param estimateFor  可选：(unit) => 该单元预计花费；用于"下一个就超余额"提前停
 * @param complete     async (unit) => { text, usage, ms } ；抛错视为该单元失败
 * @param onRecord     可选：(record) => void ；每个单元结束即回调（落盘用）
 */
export async function runUnits({
  units, budget, spentSoFar = 0, done = new Set(), estimateFor = null, complete, onRecord = null,
}) {
  if (typeof complete !== 'function') throw new Error('runUnits: complete() is required')
  const records = []
  const ran = []
  let spent = Number(spentSoFar) || 0
  let stopped = null

  for (const unit of units) {
    if (done.has(unit.unitId)) continue                     // 续跑：跑过的不重跑（重跑=重复花钱）
    // **每个单元开始前重算余额**——这是唯一能防超支的地方。
    const gate = budgetStop({
      spent, budget,
      nextUnitEstimate: typeof estimateFor === 'function' ? estimateFor(unit) : null,
    })
    if (gate.stop) { stopped = { reason: gate.reason, atUnit: unit.unitId, spent }; break }

    let rec
    try {
      const r = await complete(unit)
      const usage = (r && r.usage) || null
      spent += Number(usage && usage.totalTokens) || 0
      rec = {
        unitId: unit.unitId, taskId: unit.taskId, arm: unit.arm, run: unit.run,
        ok: true, usage, ms: (r && r.ms) || null,
        chars: r && r.text ? r.text.length : 0,
        reasoningChars: (r && r.reasoning) ? r.reasoning.length : 0,
      }
    } catch (e) {
      // 单个单元失败**不终止整轮**（否则一次网络抖动就毁掉几十分钟的进度），
      // 但必须如实记成 ok:false —— 它不会被算作"跑过"，续跑时会重试。
      rec = {
        unitId: unit.unitId, taskId: unit.taskId, arm: unit.arm, run: unit.run,
        ok: false, error: String((e && e.message) || e),
      }
    }
    records.push(rec)
    ran.push(unit.unitId)
    if (typeof onRecord === 'function') { try { onRecord(rec) } catch { /* 落盘失败不打断运行 */ } }
  }

  return {
    records, ran, spent, stopped,
    spend: summarizeSpend(records),
    completedAfter: new Set([...done, ...records.filter((r) => r.ok === true).map((r) => r.unitId)]),
  }
}

/**
 * 一次正式的 S1（或任意分期）运行。
 * 与 runUnits 的差别：这里做**开跑前的全部拒绝检查**，只有全过才进入循环。
 */
export async function runEvaluation({
  tasks, arms, runs, stage, budget, spec, llm, llmLib, packet = '', priorRecords = [], priorSpent = 0,
  complete: completeFn = null, onRecord = null, estimateForUnit = null,
}) {
  // ① 封存前提由调用方（plan-e001 / spec 生成）保证；这里只认单元展开与预算。
  const units = buildRunUnits({ tasks, arms, runs })
  const done = completedUnitIds(priorRecords)
  // ② 一次性拒绝：**没有授权就一个单元都不跑**（与 decideRun 同方向）。
  const pre = budgetStop({ spent: priorSpent, budget, nextUnitEstimate: null })
  if (pre.stop) {
    return { ok: false, refused: true, reason: pre.reason, units: units.length, pending: units.length - done.size, records: [] }
  }
  if (typeof completeFn === 'function') {
    // 测试路径：用注入的补全函数跑编排，不碰模型。
    const out = await runUnits({ units, budget, spentSoFar: priorSpent, done, estimateFor: estimateForUnit, complete: completeFn, onRecord })
    return { ok: true, refused: false, stage: stage || null, units: units.length, ...out }
  }
  // ③ 真实路径：按单元构造消息 → 调模型。
  const { complete } = await import('./eval-llm.js')
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = await runUnits({
    units, budget, spentSoFar: priorSpent, done, estimateFor: estimateForUnit, onRecord,
    complete: async (unit) => {
      const task = byId.get(unit.taskId)
      if (!task) throw new Error('unknown task: ' + unit.taskId)
      const messages = buildArmMessages({ arm: unit.arm, taskText: task.body, packet })
      return await complete({ llm, llmLib, cfg: spec, systemPrompt: spec.armSystemPrompt, messages })
    },
  })
  return { ok: true, refused: false, stage: stage || null, units: units.length, ...out }
}
