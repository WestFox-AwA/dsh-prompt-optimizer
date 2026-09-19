// dsh-prompt-optimizer 0.6 · 解释层契约（用户原话 → 候选补丁）
//
// 这是**单次任务路径里唯一需要 LLM 的环节**。本文件只承载"契约"：
//   · 稳定的系统提示词（版本化）
//   · 用户消息构造
//   · 输出解析（容错）
//   · **来源可验证性检查**（见下）
//
// 核心机制 —— user_requirement 必须带"逐字引文"：
//   模型可以为用户要求建条目，但每条必须附 `quote`，且该引文必须是**用户原话的字面子串**。
//   这使"机器替用户发明要求"从"信任问题"变成"字符串比对问题"（可机械验证）。
//   它能允许的正常行为是：把原话**拆成原子要求**（每条都能指回原话某一段）；
//   它挡住的正是：把模型自己的推断写成用户要求。
//
// 纯函数：无 IO、无 LLM 调用、无宿主依赖。

export const INTERPRETER_VERSION = '0.6.0-alpha.1'

/** 解释器可以产出的 op（其余一律拒绝）。 */
export const ALLOWED_OPS = Object.freeze([
  'add_item', 'set_phase', 'add_question',
])

/** 解释器可以创建的条目类型（`user_requirement`/`user_decision` 需带逐字引文）。 */
export const INTERPRETER_KINDS = Object.freeze([
  'user_requirement', 'quality_interpretation', 'observed_fact',
  'implementation_option', 'proposal', 'unknown',
])

/** 单次解释最多产出的条目数（防止把短原话膨胀成文档）。 */
export const MAX_ITEMS = 12
/** 单条文本上限。 */
export const MAX_ITEM_CHARS = 300

export const SYSTEM_PROMPT = `你是"意图补全器"。用户给你一句他准备直接发给工作 AI 的原话，以及已知的意图状态。
你的产物是一份 JSON 补丁，会被宿主校验后并入意图状态；它**不会替换用户原话**。

【最重要的一条】用户原话会被原样保留。你不改写它，你只补它没说的、而工作 AI 无法自知的东西。

【硬规则】
1. 只有用户**明说**的才算 user_requirement。为它建条目时，必须附 quote —— 
   一段**在用户原话里逐字存在**的子串（照抄，不要改写、不要补标点）。宿主会做字面比对，对不上就整条作废。
   你可以把一句话拆成多条原子要求，每条各自引用原话的一段。
2. 用户表达的质量目标（"精细""真实""帅气""高级感"这类）→ 写成 quality_interpretation，
   并在 rationale 里指出它来自原话的哪几个字。**不要**把它写成 user_requirement。
3. 不得新增产品目标、功能或硬约束（例如"必须离线""禁止联网""只能用某个库""必须支持移动端"）。
   你觉得有价值的东西写成 proposal，并接受它可能不被采纳。
4. 你自己不确定、且会影响结果的选择 → 写成 unknown，不要替用户猜，也不要写"按最保守理解执行"。
   unknown 必须带 unknownClass，取值只能是这三种之一：
     · "user_preference"     —— 只有用户能定的取舍（会改变结果）。这一类才可能被拿去问用户。
     · "lookupable_fact"     —— 在许可范围内读文件/查代码就能确定的事实。**不要**把这类丢回用户。
     · "implementation_detail" —— 可逆的实现细节（间距、命名、库的内部用法）。交给工作 AI 自己定。
   若这条未知会挡住下一步，额外加 "blocksAction": true；确定不影响下一步就写 false。
5. 只有你**这次确实读到**的项目事实才写成 observed_fact，并给出 sourceRefs。
   没读到就不要写事实；只列过目录不算知道内容。
6. 与本次请求无关的内容不要输出。不要写流程仪式、通用教学、验收套话。

【输出格式】只输出 JSON，不要解释、不要 Markdown 代码块：
{"ops":[
  {"op":"add_item","item":{"id":"req-1","kind":"user_requirement","text":"...","quote":"原话里的逐字片段","sourceRefs":[{"kind":"human","sessionId":"<给定的>","messageId":"<给定的>"}]}},
  {"op":"add_item","item":{"id":"qi-1","kind":"quality_interpretation","text":"...","rationale":"来自原话的“真实、帅气”","sourceRefs":[{"kind":"model","sessionId":"<给定的>"}]}},
  {"op":"add_item","item":{"id":"unk-1","kind":"unknown","unknownClass":"user_preference","blocksAction":true,"text":"...","sourceRefs":[{"kind":"model","sessionId":"<给定的>"}]}}
]}

**上面示例里的字段就是全部字段；unknown 必须带 unknownClass**（缺了它这条未知就会被当成用户偏好）。
id 规则：小写字母/数字/冒号/下划线/连字符，3–80 字符，同一次输出内不得重复。
条目 text 一句话说清一件事，不超过 ${MAX_ITEM_CHARS} 字。总条目数不超过 ${MAX_ITEMS} 条。
没有可补的就输出 {"ops":[]}。`

/**
 * 构造用户消息。
 * @param userText  用户原话（**逐字**）
 * @param state     当前 IntentState（可为 null）
 * @param extras    { sessionId, messageId, observations?: string[] }
 */
export function buildUserMessage({ userText, state, sessionId, messageId, observations }) {
  const parts = []
  parts.push('【用户原话（逐字，供你引用；不要改写它）】')
  parts.push(String(userText))
  parts.push('')
  parts.push('【标识（填进 sourceRefs）】')
  parts.push('sessionId=' + String(sessionId) + '  messageId=' + String(messageId))
  if (Array.isArray(observations) && observations.length > 0) {
    parts.push('')
    parts.push('【本次实际观察到的（只有这些可以写成 observed_fact）】')
    for (const o of observations.slice(0, 20)) parts.push('- ' + String(o).slice(0, 300))
  }
  if (state && Array.isArray(state.items) && state.items.length > 0) {
    parts.push('')
    parts.push('【已知意图状态（不要重复添加，除非要修正）】')
    for (const it of state.items) {
      parts.push('- [' + it.id + '|' + it.kind + '|' + it.status + '] ' + String(it.text).slice(0, MAX_ITEM_CHARS))
    }
  }
  return parts.join('\n')
}

/** 从模型输出里抽出 JSON（容忍 ```json 围栏与前后废话）。 */
export function extractJson(raw) {
  const text = String(raw == null ? '' : raw)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, code: 'NO_JSON', reason: 'no JSON object found' }
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) }
  } catch (e) {
    return { ok: false, code: 'BAD_JSON', reason: String((e && e.message) || e) }
  }
}

/**
 * 来源可验证性：`user_requirement` / `user_decision` 的 `quote`
 * 必须是 `userText` 的**字面子串**（忽略首尾空白，但不做其它归一化）。
 * @returns 问题清单（空 = 通过）
 */
export function validateProvenance(ops, userText) {
  const problems = []
  const text = String(userText == null ? '' : userText)
  ops.forEach((op, i) => {
    if (!op || op.op !== 'add_item' || !op.item) return
    const it = op.item
    if (it.kind !== 'user_requirement' && it.kind !== 'user_decision') return
    const quote = it.quote
    if (typeof quote !== 'string' || quote.trim().length === 0) {
      problems.push(`ops[${i}] ${it.kind} ${it.id}: missing quote (verbatim excerpt of the user's text)`)
      return
    }
    if (!text.includes(quote)) {
      problems.push(`ops[${i}] ${it.kind} ${it.id}: quote is not a verbatim substring of the user's text`)
    }
  })
  return problems
}

/**
 * 解析并校验模型输出，产出可交给 reducer 的候选 patch。
 * @returns {{ok:true, patch:object, warnings:string[]}} | {{ok:false, code:string, reason:string, problems?:string[]}}
 */
export function parseInterpreterOutput(raw, { userText, sessionId, baseRevision, baseInputRevision, causeId }) {
  const ex = extractJson(raw)
  if (!ex.ok) return { ok: false, code: ex.code, reason: ex.reason }
  const obj = ex.value
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.ops)) {
    return { ok: false, code: 'BAD_SHAPE', reason: 'expected {"ops":[...]}' }
  }
  const warnings = []
  const ops = []
  let itemCount = 0

  for (const rawOp of obj.ops) {
    if (!rawOp || typeof rawOp !== 'object' || typeof rawOp.op !== 'string') {
      return { ok: false, code: 'BAD_OP', reason: 'op must be an object with a string op field' }
    }
    if (!ALLOWED_OPS.includes(rawOp.op)) {
      return { ok: false, code: 'OP_NOT_ALLOWED', reason: `interpreter may not emit op "${rawOp.op}"` }
    }
    if (rawOp.op === 'add_item') {
      const it = rawOp.item
      if (!it || typeof it !== 'object') return { ok: false, code: 'BAD_ITEM', reason: 'add_item requires item' }
      if (!INTERPRETER_KINDS.includes(it.kind)) {
        return { ok: false, code: 'KIND_NOT_ALLOWED', reason: `interpreter may not create kind "${it.kind}"` }
      }
      if (typeof it.text !== 'string' || it.text.trim().length === 0) {
        return { ok: false, code: 'BAD_ITEM', reason: `item ${it.id}: empty text` }
      }
      if (it.text.length > MAX_ITEM_CHARS) {
        const trimmed = it.text.slice(0, MAX_ITEM_CHARS)
        warnings.push(`item ${it.id}: text truncated to ${MAX_ITEM_CHARS} chars`)
        it.text = trimmed
      }
      // 引文不外传进状态：状态里只留正文与 rationale
      const { quote, ...rest } = it
      itemCount += 1
      if (itemCount > MAX_ITEMS) {
        return { ok: false, code: 'TOO_MANY_ITEMS', reason: `more than ${MAX_ITEMS} items` }
      }
      ops.push({ op: 'add_item', item: rest })
    } else {
      ops.push(rawOp)
    }
  }

  const provenance = validateProvenance(obj.ops, userText)
  if (provenance.length > 0) {
    return { ok: false, code: 'UNVERIFIABLE_PROVENANCE', reason: provenance.join('; '), problems: provenance }
  }

  if (ops.length === 0) return { ok: true, patch: null, warnings: ['no ops: nothing to add'] }

  return {
    ok: true,
    warnings,
    patch: {
      causeId: String(causeId || 'interpret'),
      baseRevision,
      baseInputRevision,
      sessionId,
      ops,
    },
  }
}

/**
 * 便捷入口：解析 → 由 reducer 校验（不提交）。
 * 需要 reduce/validatePatch 时由调用方传入，避免本模块依赖 reducer 内部。
 */
export function dryRun(patch, state, reduceFn) {
  if (!patch) return { ok: true, noop: true }
  const r = reduceFn(state, patch)
  return r.ok ? { ok: true, state: r.state } : { ok: false, code: r.code, reason: r.reason }
}
