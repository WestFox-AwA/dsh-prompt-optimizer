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

import { SOURCE_KINDS } from './schema.js'

export const INTERPRETER_VERSION = '0.6.0-alpha.1'

/** 解释器可以产出的 op（其余一律拒绝）。 */
export const ALLOWED_OPS = Object.freeze([
  'add_item', 'set_phase', 'add_question',
  // P11 多轮：**销账**。用户 2026-09-21 真机反馈"第二轮还带着第一轮早已解决的问题"——
  // 因为解释层此前**只能加、不能销**，意图状态只增不减，于是旧问题每轮都被重新编译进包。
  'set_item_status',
])

/**
 * 解释层**只许把条目退掉**，不许把它们改回 active/pending。
 * "复活"旧条目会让状态在轮次之间来回摆，比"不能销"更糟（用户要的是轮次之间不互相污染）。
 */
export const INTERPRETER_RETIRE_STATUSES = Object.freeze(['superseded', 'retracted', 'stale'])

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
7. **轮次之间不遗传**（用户 2026-09-21 拍板："每次优化都自动根据上下文还有原提示词，独立产生目标，
   而不是遗传目标"）：上一轮的目标**不会**带进这一轮，所以你**不要**写"延续上一轮""之前提过的还要继续"
   这类话，也不要假设自己看过上一轮的产物——**把这一轮该有的目标重新说清楚**。
   （同一轮内**已经**产出、又被本轮内容证伪的条目，可以用
   \`{"op":"set_item_status","id":"<id>","status":"superseded","quote":"逐字依据"}\` 退掉；没有逐字依据不许退。）
8. 你的产物**只作用于这一轮**。跨轮的长期记忆由会话本身承担（工作 AI 看得到完整对话），
   你不需要、也不要试图在这里维护长期状态。

【输出格式】只输出 JSON，不要解释、不要 Markdown 代码块：
{"ops":[
  {"op":"add_item","item":{"id":"req-1","kind":"user_requirement","text":"...","quote":"原话里的逐字片段","scope":"turn","sourceRefs":[{"kind":"human","sessionId":"<给定的>","messageId":"<给定的>"}]}},
  {"op":"add_item","item":{"id":"qi-1","kind":"quality_interpretation","text":"...","rationale":"来自原话的“真实、帅气”","sourceRefs":[{"kind":"model","sessionId":"<给定的>"}]}},
  {"op":"add_item","item":{"id":"unk-1","kind":"unknown","unknownClass":"user_preference","blocksAction":true,"text":"...","sourceRefs":[{"kind":"model","sessionId":"<给定的>"}]}},
  {"op":"set_item_status","id":"req-9","status":"superseded","quote":"上下文里证明它已经做完的那句话"}
]}

**上面示例里的字段就是全部字段；unknown 必须带 unknownClass**（缺了它这条未知就会被当成用户偏好）。
id 规则：小写字母/数字/冒号/下划线/连字符，3–80 字符，同一次输出内不得重复。
条目 text 一句话说清一件事，不超过 ${MAX_ITEM_CHARS} 字。总条目数不超过 ${MAX_ITEMS} 条。

**每一轮都必须给出"这一轮我理解到了什么"**：哪怕用户只写了一两个字，也要结合**上下文**推断出他的意图，
至少输出一条条目（通常是 \`user_requirement\` 或 \`quality_interpretation\`），**不许因为"没什么可补"就交空数组**；
也**不许**用"见上一轮"之类的省略来偷懒——包是**这一轮**交给工作 AI 的东西，必须自足。
你的两份依据只有：**用户这一轮的原话**（逐字）+ **本轮读入的会话上下文**。
\`quote\` 必须逐字来自**用户原话**；若这句话本身太短、字面引不出东西，就从**已读入的上下文**里逐字引出依据
（这种条目会被记为"机器从上下文推的"，不会冒充成你说过的话）。`

/**
 * 构造用户消息。
 * @param userText  用户原话（**逐字**）
 * @param state     当前 IntentState（可为 null）
 * @param extras    { sessionId, messageId, observations?: string[] }
 * @param context   会话上下文块（P10 步骤 2 的注入文本；空串 = **与旧行为逐字节相同**）
 */
export function buildUserMessage({ userText, state, sessionId, messageId, observations, context }) {
  const parts = []
  // 上下文块**在最前**：先让模型知道"这段会话已经发生了什么"，再读这次的原话。
  // 它在文本里自带旁观者声明与读取范围说明（见 session-context.js），这里不加标题——
  // 加了会多一层"这是一节输入"的错觉，而那正是声明要消掉的东西。
  if (context) parts.push(String(context), '')
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
    parts.push('【本轮已产出的条目（通常为空；同一轮内别重复）】')
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
 * 必须是**字面子串**——来自 `userText`，**或者**来自本轮喂给解释层的**上下文文本**。
 *
 * ⚠ 为什么加了"或"（用户 2026-09-21 的真机反馈）：短消息（例："测试"两个字）几乎无字可引，
 * 于是候选全被这里判为"引文不成立" ⇒ 补丁为空 ⇒ `outcome:noop` ⇒ 界面报 `no-packet`。
 * 而**一两字结合上下文完全可能带大量信息**，所以判据要认"上下文里的依据"；同时**不许含糊**：
 * 来自上下文的条目会被标成 `machine`（机器从上下文推的），不会冒充"你说过"。
 * @returns 问题清单（空 = 通过）
 */
export function validateProvenance(ops, userText, contextText, stateText) {
  const problems = []
  const text = String(userText == null ? '' : userText)
  const ctx = String(contextText == null ? '' : contextText)
  // 已存档的状态正文（`【已知意图状态】`里那些条目的正文与 rationale）。
  // ⚠ 为什么要有这一路（2026-09-21 真机）：坦克会话第三轮里模型**确实**发了 11 条销账，
  // 但引文是它自己的转述（"两个问题都修好了"），既不在用户原话里、也不在本轮读入的上下文里
  // ⇒ 全被判"无依据"丢掉 ⇒ 旧条目一条没销掉，第三轮的包照样带着前两轮的东西。
  // 宿主**自己记录过**的条目正文属于"有据可查的材料"，据此销账不算凭空——但要标成 `state` 来源，
  // 面板与台账都看得见它是拿什么销的。
  const st = String(stateText == null ? '' : stateText)
  ops.forEach((op, i) => {
    // 销账（`set_item_status`）同样要有**逐字依据**：没有依据就销账 = 凭空把用户的要求划掉。
    // 这里只标证据（user / context / state / none），**不判整轮失败**——由 parseInterpreterOutput 逐条丢弃并记账。
    if (op && op.op === 'set_item_status') {
      const q = op.quote
      const has = typeof q === 'string' && q.trim().length > 0
      if (has && text.includes(q)) { op.evidence = 'user'; return }
      if (has && ctx && ctx.includes(q)) { op.evidence = 'context'; return }
      if (has && st && st.includes(q)) { op.evidence = 'state'; return }
      op.evidence = 'none'
      return
    }
    if (!op || op.op !== 'add_item' || !op.item) return
    const it = op.item
    const needsQuote = it.kind === 'user_requirement' || it.kind === 'user_decision'
    const quote = it.quote
    const hasQuote = typeof quote === 'string' && quote.trim().length > 0
    if (!hasQuote) {
      if (needsQuote) {
        problems.push(`ops[${i}] ${it.kind} ${it.id}: missing quote (verbatim excerpt of the user's text or the read context)`)
      }
      return
    }
    // ⚠ 2026-09-21 扩到**所有**带引文的条目（原来只标 human-only 两种）：
    // ① `quoteSource` 决定 provenance（上下文来的**不许冒充"你说过"**），只标两种会让
    //    `observed_fact` 这类"从读到的材料推出来"的条目失去标记；② 下方的来源引用归一
    //    要靠它判断"这条引文是不是真在宿主给过的材料里"。
    if (text.includes(quote)) { it.quoteSource = 'user'; return }
    if (ctx && ctx.includes(quote)) { it.quoteSource = 'context'; return }
    // 引文两边都对不上：human-only 是硬错；其余**留痕**（`unverifiable`）交给解析层**丢条目**，
    // 绝不因为它编得含糊就放行成"有依据的机读结论"。
    it.quoteSource = 'unverifiable'
    if (needsQuote) {
      problems.push(`ops[${i}] ${it.kind} ${it.id}: quote is not a verbatim substring of the user's text or the read context`)
    }
  })
  return problems
}

/**
 * 解析并校验模型输出，产出可交给 reducer 的候选 patch。
 * @returns {{ok:true, patch:object, warnings:string[]}} | {{ok:false, code:string, reason:string, problems?:string[]}}
 */
export function parseInterpreterOutput(raw, { userText, contextText, stateText, sessionId, messageId, baseRevision, baseInputRevision, causeId }) {
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
      // 引文不外传进状态：状态里只留正文与 rationale。
      // ⚠ `provenance:'machine'`（上下文来的条目**不许冒充"你说过"**）**必须等 `validateProvenance` 跑完再标**：
      // 那个函数才写下 `quoteSource`。这里原来就标，等于拿一个当时还不存在的字段做判断 ⇒ 该标记**从未生效**
      // （2026-09-21 复查发现的真机缺陷：从读入材料里推出来的条目会看起来像"你说过的"）。补标见下方 provenance 之后。
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

  const provenance = validateProvenance(obj.ops, userText, contextText, stateText)
  if (provenance.length > 0) {
    return { ok: false, code: 'UNVERIFIABLE_PROVENANCE', reason: provenance.join('; '), problems: provenance }
  }

  // 6) provenance 之后的补标：`quoteSource` 到这一刻才存在（见上面的顺序说明）。
  for (let i = 0; i < obj.ops.length; i += 1) {
    const rawOp = obj.ops[i]
    const built = ops[i]
    if (!rawOp || rawOp.op !== 'add_item' || !rawOp.item || !built || built.op !== 'add_item') continue
    if (rawOp.item.quoteSource === 'context') built.item.provenance = 'machine'
  }

  // 7) 来源引用归一 —— 只补**宿主确实知道**的事实，其余**逐条丢弃并记账**。
  //
  // 为什么需要它（用户真机 2026-09-21）：开着「只读工具」时模型会写 `kind:'tool'` / `kind:'file'`，
  // 可 `toolCallId` / `uri` 只有宿主才有 ⇒ schema 判 BAD_SCHEMA ⇒ **整份补丁作废**，
  // 其它合法条目陪葬（台账 `outcome:reducer-rejected dryRun:fail(BAD_SCHEMA)`）。
  // 一条写坏的来源不该有能力弄死整轮；而"补"也不能靠编，只认两件可机械核对的事：
  //   · 引文逐字来自**用户这条原话** ⇒ 可以把 `human` 引用的 `messageId` 补成这一轮的真实 messageId；
  //   · 引文逐字来自**本轮读入的上下文** ⇒ 如实改记成"模型从给定材料推导"（`kind:'model'`）。
  // 两者都不成立时**丢弃这一条**（记账进 `dropped`，不静默）。
  const dropped = []
  const keptOps = []
  for (const built of ops) {
    if (built.op === 'set_item_status') {
      // 销账：① 只许退，不许复活（active/pending 一律不收）；② 必须有逐字依据。
      // 不满足就**只丢这一条**（记账），与来源引用同一条纪律——一条不合法的销账不该弄死整轮。
      const status = String(built.status || '')
      if (!INTERPRETER_RETIRE_STATUSES.includes(status)) {
        dropped.push({ id: String(built.id || ''), kind: 'retire', reason: '解释层只能把条目退成 superseded/retracted/stale，收到：' + (status || '(空)') })
        continue
      }
      if (built.evidence !== 'user' && built.evidence !== 'context' && built.evidence !== 'state') {
        dropped.push({ id: String(built.id || ''), kind: 'retire', reason: '销账没有逐字依据（引文须来自用户本轮原话、本轮读入的上下文，或【已知意图状态】里已记录的条目正文）' })
        continue
      }
      // 引文不外传进状态：只留 id 与目标状态
      keptOps.push({ op: 'set_item_status', id: String(built.id), status })
      continue
    }
    if (built.op !== 'add_item') { keptOps.push(built); continue }
    const it = built.item
    const humanOnly = it.kind === 'user_requirement' || it.kind === 'user_decision'
    const fromUser = it.provenance !== 'machine'
    const refs = Array.isArray(it.sourceRefs) ? it.sourceRefs : []
    const kept = []
    const refProblems = []
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { refProblems.push('引用不是对象'); continue }
      const r = { ...ref }
      if (typeof r.sessionId !== 'string' || !r.sessionId) r.sessionId = String(sessionId || '')
      const kind = String(r.kind || '')
      if (!SOURCE_KINDS.includes(kind)) { refProblems.push('来源种类无效：' + (kind || '(空)')); continue }
      const missing = kind === 'tool' ? (typeof r.toolCallId !== 'string' || !r.toolCallId)
        : (kind === 'file' || kind === 'external') ? (typeof r.uri !== 'string' || !r.uri)
          : kind === 'human' ? (typeof r.messageId !== 'string' || !r.messageId)
            : false
      if (!missing) { kept.push(r); continue }
      if (kind === 'human' && fromUser && typeof messageId === 'string' && messageId) {
        // 引文是这条原话里的字面子串 ⇒ 宿主替它填上真实的 messageId（可机械核对，不是编）
        kept.push({ ...r, messageId })
        refProblems.push('补全 human.messageId（引文逐字来自本轮原话）')
        continue
      }
      if (!humanOnly && !fromUser) {
        // 引文逐字来自读入的上下文 ⇒ 如实记成"模型从给定材料推导"
        kept.push({ kind: 'model', sessionId: String(sessionId || '') })
        refProblems.push('改记 kind:model（引文来自本轮读入的上下文，工具标识宿主无法代填）')
        continue
      }
      refProblems.push('来源缺少宿主才知道的标识符（' + kind + '）且引文不足以证明，已丢弃')
    }
    if (kept.length === 0) {
      // 一条来源都没给：human-only 直接丢（不许无来源冒充用户要求）；
      // 机器条目**且**引文确实来自本轮读入的材料 ⇒ 如实记一条 kind:model 的来源，别把有用的条目丢了。
      if (!humanOnly && !fromUser) {
        it.sourceRefs = [{ kind: 'model', sessionId: String(sessionId || '') }]
        warnings.push('item ' + String(it.id || '') + ' 来源引用：模型未给来源，按其引文来自本轮读入材料记 kind:model')
        keptOps.push(built)
        continue
      }
      dropped.push({ id: String(it.id || ''), kind: String(it.kind || ''), reason: refProblems.join('；') || '没有可用的来源引用' })
      continue
    }
    it.sourceRefs = kept
    if (refProblems.length > 0) warnings.push('item ' + String(it.id || '') + ' 来源引用：' + refProblems.join('；'))
    keptOps.push(built)
  }

  if (keptOps.length === 0) {
    // 模型一条 op 都没给 ⇒ 保持原有契约（`no ops: nothing to add`），不要因为下面新加的丢弃逻辑改口径。
    return {
      ok: true,
      patch: null,
      warnings: ops.length === 0
        ? ['no ops: nothing to add']
        : [...warnings, ...dropped.map((d) => '丢弃条目 ' + d.id + '：' + d.reason)],
      dropped,
    }
  }

  return {
    ok: true,
    warnings,
    dropped,
    patch: {
      causeId: String(causeId || 'interpret'),
      baseRevision,
      baseInputRevision,
      sessionId,
      ops: keptOps,
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
