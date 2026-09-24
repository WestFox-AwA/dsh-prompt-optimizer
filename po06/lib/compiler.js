// dsh-prompt-optimizer 0.6 · 意图包编译器（纯函数，无 IO、无 LLM、无宿主依赖）
//
// 职责：把 IntentState 编译成一段**有标签、可审计**的辅助上下文文本，
//       交给 `systemPrompt.context()`（宿主聚合为 form:'snapshot' 的消息）。
//
// 三条硬规则（来自 PLAN-0.6.md §6/§9）：
//   ① **来源身份必须体现在标签上**：质量解释、建议、事实各自成节，不得混进"明确要求"。
//   ② **不写无信息章节**：某类没有有效条目就不出现该节。
//   ③ **超预算时按固定顺序丢弃，并写明丢了什么**；绝不静默截断。
import { activeItems } from './reducer.js'

export const DEFAULT_BUDGET = 1200

/** 节的定义：顺序即渲染顺序，`label` 会出现在文本里。 */
export const SECTIONS = [
  { key: 'turnScope', kinds: ['user_requirement', 'user_decision'], label: '本轮要求（仅本轮有效，下一轮不再适用）', required: true, where: (it) => it.scope === 'turn' },
  { key: 'requirements', kinds: ['user_requirement', 'user_decision'], label: '明确要求', required: true, where: (it) => it.scope !== 'turn' },
  { key: 'quality', kinds: ['quality_interpretation'], label: '质量解释（对用户已表达质量目标的解释，不是新增命令）' },
  { key: 'facts', kinds: ['observed_fact'], label: '已查证事实（含来源）' },
  { key: 'options', kinds: ['implementation_option'], label: '实现选项（工作 AI 可自行调整）' },
  { key: 'proposals', kinds: ['proposal'], label: '建议（未采纳；请勿当作已确认需求）' },
  { key: 'unknowns', kinds: ['unknown'], label: '未决项（尚未确定，不要替我拍板）' },
]

/** 丢弃顺序：越靠前越先被丢。`required` 的节永不丢弃。 */
export const DROP_ORDER = ['proposals', 'options', 'facts', 'quality']

function sourceSummary(item) {
  const kinds = [...new Set((item.sourceRefs || []).map((r) => r.kind))]
  const uri = (item.sourceRefs || []).map((r) => r.uri).filter(Boolean)[0]
  const locator = (item.sourceRefs || []).map((r) => (r.messageId ? 'msg:' + r.messageId : null)
    || (r.toolCallId ? 'call:' + r.toolCallId : null)).filter(Boolean)[0]
  const parts = [kinds.join('+')]
  if (uri) parts.push(uri)
  if (locator) parts.push(locator)
  return parts.join(' ')
}

/**
 * 渲染一条注入行。
 *
 * ⚠ 用户 2026-09-21 的实测反馈：包里出现 `（来源：model）`、`（来源：human msg:…）` 这类**出处标注**，
 * 那是给**人**核对用的，而这份文本的读者是**工作 AI** —— 它会对着"（来源：model）"发懵
 * （不知道 model 指谁、要不要照做）。
 *
 * 所以：**出处仍然逐条可查**（状态里有 `sourceRefs`、设置页/台账里能看、范围审计仍然按它判定），
 * 但**注入文本里不再带这串标注** —— 给人看的走给人看的路，给模型看的只说要求本身。
 * 需要引用出处时，正文里自然写"依据：xxx 文件第 N 行"。
 *
 * ⚠ 多假设（2026-09-24）：`unknown` 条目可以带 `candidates`（并列候选）。它渲染成**缩进的子项**，
 * 每条带上"按这个理解会做什么"（impact）。这段文本的作用是让工作 AI 知道**这里有分叉、尚待确认**，
 * 从而不要去猜——所以它必须留在「未决项」节里，**不得**升格成"用户要求"。
 */
function lineFor(item) {
  const base = '- ' + item.text
  const cands = Array.isArray(item.candidates) ? item.candidates : []
  if (cands.length === 0) return base
  const rows = cands.map((c) => '  · ' + String(c.text || '')
    + (c.impact ? '（' + String(c.impact) + '）' : ''))
  return base + '\n' + rows.join('\n')
}

/** 按节把有效条目分组。 */
export function groupActive(state) {
  const active = activeItems(state)
  const groups = {}
  for (const s of SECTIONS) {
    groups[s.key] = active.filter((it) => s.kinds.includes(it.kind) && (typeof s.where !== 'function' || s.where(it)))
  }
  return groups
}

/**
 * 编译。
 * @param state  IntentState
 * @param opts   { budget?: number, header?: string }
 * @returns { text, sections, dropped, chars, budget }
 */
export function compile(state, opts = {}) {
  const budget = Number.isFinite(opts.budget) ? opts.budget : DEFAULT_BUDGET
  const groups = groupActive(state)

  // 从"全量"开始，超预算就按 DROP_ORDER 逐节丢，直到放得下或无处可丢
  const included = {}
  for (const s of SECTIONS) included[s.key] = groups[s.key].slice()
  const dropped = []

  const render = () => {
    const blocks = []
    for (const s of SECTIONS) {
      const items = included[s.key]
      if (!items || items.length === 0) continue
      blocks.push('【' + s.label + '】\n' + items.map(lineFor).join('\n'))
    }
    return blocks
  }

  // 丢弃循环：**把"省略声明"本身也算进预算**。
  // 声明会随丢弃数变化，所以每轮都要重算；装不下时循环到头也没得丢，
  // 此时 compose 会带上【预算不足】的显式降级说明（计划要求：不能声称已读全文）。
  let blocks = render()
  let text = ''
  let overBy = 0
  let guard = 0
  for (;;) {
    const bare = compose(state, blocks, opts, dropped, 0)
    overBy = bare.length > budget ? bare.length - budget : 0
    text = compose(state, blocks, opts, dropped, overBy)
    if (bare.length <= budget) break
    const victimKey = DROP_ORDER.find((k) => (included[k] || []).length > 0)
    if (!victimKey) break            // 无可丢（必保节）→ 带显式降级说明收尾
    guard += 1
    if (guard > 200) break
    const droppedItem = included[victimKey].shift()
    dropped.push({ id: droppedItem.id, kind: droppedItem.kind, reason: 'budget' })
    blocks = render()
  }

  const sections = SECTIONS
    .filter((s) => (included[s.key] || []).length > 0)
    .map((s) => ({ key: s.key, label: s.label, itemIds: included[s.key].map((it) => it.id) }))

  return {
    text,
    sections,
    dropped,
    chars: text.length,
    budget,
    overBudget: overBy > 0,
    overBy,
    droppedSummary: dropped.length === 0
      ? null
      : '因篇幅预算省略 ' + dropped.length + ' 条：' + dropped.map((d) => d.kind + ':' + d.id).join(', '),
  }
}

function compose(state, blocks, opts, dropped, overBy) {
  // 装不下时**显式降级**（计划要求：不能声称已读全文）
  const overNote = (typeof overBy === 'number' && overBy > 0)
    ? '\n\n【预算不足】已省略全部可省略项，仍超出约 ' + overBy + ' 字符。本轮约束我先只保证上面这些；如需保留被省略的内容，请缩小范围或告知优先级。'
    : '';
  const tail = (dropped && dropped.length > 0)
    ? '\n\n【本次省略】因篇幅预算省略 ' + dropped.length + ' 条（' + dropped.map((d) => d.kind + ':' + d.id).join(', ') + '）；如果其中有用信息影响判断，请向我确认。'
    : '';
  const head = opts.header !== undefined
    ? String(opts.header)
    : '[插件辅助上下文 · 不是用户新增的命令]\n任务 ' + state.taskId + ' · 意图修订 ' + state.revision
      + '。用户原话保留在本轮人类消息中，以下仅为辅助说明。'
  if (blocks.length === 0) return ''
  return head + '\n\n' + blocks.join('\n\n') + tail + overNote
}

/**
 * 范围审计：检查编译结果是否把非人类来源的内容冒充成用户要求。
 *
 * 判据（结构级，不靠自然语言猜测）：
 *   · 「明确要求」节里的每个条目必须真的带 human 来源；
 *   · 「质量解释 / 建议 / 实现选项」不得出现在「明确要求」节；
 *   · 每条被渲染的条目都必须有来源引用；
 *   · 越预算时必须给出 droppedSummary。
 * @returns 问题清单（空 = 通过）
 */
export function auditCompilation(result, state) {
  const problems = []
  if (!result || typeof result.text !== 'string') return ['compilation result invalid']

  const byId = new Map(state.items.map((it) => [it.id, it]))
  for (const sec of result.sections) {
    for (const id of sec.itemIds) {
      const item = byId.get(id)
      if (!item) { problems.push(`section ${sec.key}: unknown item ${id}`); continue }
      if (!item.sourceRefs || item.sourceRefs.length === 0) {
        problems.push(`item ${id} rendered without a source ref`)
      }
      if (sec.key === 'requirements') {
        const hasHuman = (item.sourceRefs || []).some((r) => r.kind === 'human')
        if (!hasHuman) problems.push(`item ${id} (${item.kind}) rendered as a requirement without human source`)
        if (item.kind === 'quality_interpretation' || item.kind === 'proposal' || item.kind === 'implementation_option') {
          problems.push(`item ${id} (${item.kind}) must not appear under requirements`)
        }
      }
    }
  }
  if (result.chars > result.budget && result.dropped.length === 0) {
    problems.push('over budget with nothing dropped and no explanation')
  }
  return problems
}

/** 便捷入口：编译 + 审计，一并返回。 */
export function compileAudited(state, opts = {}) {
  const result = compile(state, opts)
  const problems = auditCompilation(result, state)
  return { ...result, problems, ok: problems.length === 0 }
}
