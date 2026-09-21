// P10 步骤 2 · **会话上下文**（给解释层补上"看得到上下文"的能力）。
//
// 为什么单独一个模块：设置模型里早就有 `historyMode`/`turns` 两个字段（settings.js，EV-0148），
// 但**没有任何代码读它们**——解释层拿到的永远只有「用户原话 + sessionId/messageId + 已知意图条目」
// （interpreter.js 的 buildUserMessage）。界面上的"上下文：回合/全文"因此是**装饰品**，
// 而这个项目最忌的就是"看起来生效"。本模块就是那两个字段的**唯一行为落地处**。
//
// ── 一个必须说清的事实：0.6 **拿不到"工作 AI 所见"的投影** ─────────────
// 0.5 能读 `sessions.list()[i].derived`（宿主给它的**派生历史**视图），所以 `full` 模式下
// 它注入的就是工作 AI 真正看到的那一份。0.6 是**第三方插件**，手上只有 `session/event`
// 事件流（`user/message` + `assistant/message`），**没有** derived 投影可用。
// 因此这里的 `full` 模式**如实实现为"我们手上保留的全部回合"**，并在注入文本里
// **写明实际读取范围与条数**——绝不谎称"与工作 AI 所见一致"。
// 这是 0.5 的红旗之一（P10-0.5-UI-SPEC §6 第 3 条：文案说"只留长度"、实现却带全文），
// 我们宁可把话说全，也不让文案比实现漂亮。
//
// 三条纪律（与 0.5 一致，理由见 P10-0.5-UI-SPEC §5「上下文」）：
//   ① **旁观者声明**：不声明清楚，解释层会以为自己是干活的那个，于是产出"我来做 X"而不是需求。
//   ② **超预算只降详细度、不动范围**；每一级降级**都写进注入文本**，绝不静默截断。
//   ③ **指不到就什么都不注入**：拿不到本会话的回合就返回空串，绝不回落到"别的会话的回合"。
//
// 纯函数 + 一个有界累加器：不读文件、不读时间、不调 LLM。

/** 每会话保留的回合数上限。**内存有界**是硬要求：会话可能开一整天。 */
export const CTX_MAX_TURNS = 12
/** 单段文本的落库上限（用户原话与助手回复各自）。截断事实会写进注入文本。 */
export const CTX_MAX_TEXT_CHARS = 4000
/** 保留会话数上限：只留最近活跃的这些，避免"开过的每个会话都不释放"。 */
export const CTX_MAX_SESSIONS = 200
/** 注入文本的字符预算：回合模式按 0.5 的 12000；全文模式给到 60000（0.5 同量级）。 */
export const CTX_BUDGET_TURNS = 12000
export const CTX_BUDGET_FULL = 60000
/** 全文模式的安全上限：条数超了就丢最早的，并把丢了几条**写进文本**。 */
export const CTX_FULL_MAX_ROWS = 240
/** 详细度阶梯的第一级：每条上限（0.5 的 OBSERVER_ROW_MAX_CHARS）。 */
export const CTX_ROW_MAX_CHARS = 4000
/** 降级档：助手回复的截断上限。 */
export const CTX_ASSISTANT_CAP = 600

/**
 * 一段内容要不要留、留多少。**纯函数**（便于单测钉住"截断事实"）。
 * 返回 `cut=true` 表示发生了截断——调用方必须把这件事写进注入文本。
 */
function clip(text, cap) {
  const s = String(text == null ? '' : text)
  if (s.length <= cap) return { text: s, cut: false, original: s.length }
  return { text: s.slice(0, cap) + '…（本条截断，原 ' + s.length + ' 字）', cut: true, original: s.length }
}

/**
 * 一个有界的历史累加器：**按会话**攒回合 = 用户原话 + 工作 AI 回复正文。
 *
 * 回合边界怎么定（ADR-0024 的同一套理解：一条用户消息 = 一轮）：
 *   · 收到 `user/message`  ⇒ 开一个新回合；
 *   · 收到 `assistant/message` ⇒ 追加到**当前回合**的回复里（工作 AI 一轮里可以走多步，
 *     每步一条 assistant/message，所以一个回合的回复可能是多段）；
 *   · 当前回合还没开（例如会话中途才开始观测）⇒ 起一个"（无用户原话）"的回合，
 *     宁可留下这个记号，也不把助手的回复塞进上一个回合（那会造成**错误的因果**）。
 *
 * 助手正文为什么要**攒到下一轮才落**：宿主把一条 assistant/message 的正文分多次
 * 发事件，落到一半就被读走会得到半句话。所以"待落"的正文在下一次 `observe()` 或
 * 任何一次读取时先 flush。
 */
export function createSessionHistory() {
  /** sid → { turns: Array<{user,pending,assistant}>, cwd: string|null } —— 顺序即插入顺序（Map 保序） */
  const bySession = new Map()

  /** 取（或建）某会话的槽；超出会话数上限时淘汰**最早插入**的那个。 */
  function slot(sid) {
    const key = String(sid == null ? '' : sid)
    if (!key) return null
    let s = bySession.get(key)
    if (s) return s
    s = { turns: [], cwd: null }
    bySession.set(key, s)
    while (bySession.size > CTX_MAX_SESSIONS) {
      const oldest = bySession.keys().next()
      if (oldest.done) break
      bySession.delete(oldest.value)
    }
    return s
  }

  /** 把"待落"的助手正文真正落进当前回合（见文件头说明）。 */
  function flush(s) {
    if (!s) return
    const last = s.turns[s.turns.length - 1]
    if (!last || !last.pending) return
    last.assistant = last.pending
    last.pending = ''
  }

  /** 当前回合（没有就起一个）。`userText` 只在**新开**回合时使用。 */
  function openTurn(s, userText) {
    const last = s.turns[s.turns.length - 1]
    if (last && last.user === null) { last.user = String(userText == null ? '' : userText); return last }
    // 上限是**落库**上限：超了就丢最早的一个回合（内存不得随会话长度线性增长）
    while (s.turns.length >= CTX_MAX_TURNS) s.turns.shift()
    const t = { user: String(userText == null ? '' : userText), pending: '', assistant: '' }
    s.turns.push(t)
    return t
  }

  return {
    /** 观测一条会话事件。**绝不抛**：这是旁路，不能打断会话。 */
    observe(sid, event) {
      try {
        if (!event || !event.type) return
        const s = slot(sid)
        if (!s) return
        if (event.type === 'user/message') {
          // 先落上一回合的助手正文，再开新回合（顺序反了会把回复算到新回合头上）
          flush(s)
          const text = extractEventText(event)
          if (!text) return
          openTurn(s, clip(text, CTX_MAX_TEXT_CHARS).text)
          return
        }
        if (event.type === 'assistant/message') {
          const text = extractEventText(event)
          if (!text) return
          const cur = s.turns[s.turns.length - 1]
          if (!cur || cur.user === null) {
            // 观测从会话中途开始：留一个"没有用户原话"的回合，而不是把回复接到上一回合上
            flush(s)
            openTurn(s, '')
          }
          const t = s.turns[s.turns.length - 1]
          t.pending += (t.pending ? '\n' : '') + clip(text, CTX_MAX_TEXT_CHARS).text
          return
        }
      } catch { /* 旁路：观测失败不影响会话 */ }
    },

    /** 记下本会话的工作目录（拿不到就不记；`read` 工具的根目录约束靠它）。 */
    setCwd(sid, cwd) {
      try {
        const s = slot(sid)
        if (!s) return
        if (typeof cwd === 'string' && cwd) s.cwd = cwd
      } catch { /* best effort */ }
    },

    /** 本会话的工作目录；**没有就返回 null**（调用方据此不启用工具，绝不猜）。 */
    getCwd(sid) {
      const s = bySession.get(String(sid == null ? '' : sid))
      return (s && s.cwd) || null
    },

    /** 读回合（读取时先 flush，保证最后一段助手正文已经落地）。 */
    turnsOf(sid) {
      try {
        const s = bySession.get(String(sid == null ? '' : sid))
        if (!s) return []
        flush(s)
        return s.turns.map((t) => ({ user: t.user, assistant: t.assistant }))
      } catch { return [] }
    },

    /** 诊断用：有没有这个会话、攒了几回合。 */
    stats(sid) {
      const s = bySession.get(String(sid == null ? '' : sid))
      return { known: Boolean(s), turns: s ? s.turns.length : 0, cwd: (s && s.cwd) || null, sessions: bySession.size }
    },

    /** 忘掉某会话（会话结束/清空时用；内存不至于留到最后）。 */
    forget(sid) {
      try { bySession.delete(String(sid == null ? '' : sid)) } catch { /* best effort */ }
    },
  }
}

/**
 * 从会话事件里取纯文本（用户与助手两条路径共用一份实现）。
 *
 * ⚠ 与 wire.js 的 `extractUserText` **不是**重复实现：那条只认 `event.data.content`，
 * 而助手消息在 `event.data.message.content` 上，且 content 可能是字符串或块数组。
 * 本函数覆盖三种形状（string / data.content 数组 / data.message.content 数组）。
 * 纯函数，不抛。
 */
export function extractEventText(event) {
  try {
    const d = event && event.data
    if (!d) return ''
    const candidates = [d.content, d.message && d.message.content]
    for (const content of candidates) {
      if (typeof content === 'string') {
        const t = content.trim()
        if (t) return t
        continue
      }
      if (!Array.isArray(content)) continue
      const parts = []
      for (const b of content) {
        if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text.trim())
      }
      if (parts.length > 0) return parts.join('\n')
    }
    if (typeof d.text === 'string' && d.text.trim()) return d.text.trim()
    return ''
  } catch { return '' }
}

/**
 * 渲染注入文本（**纯函数**：同样的入参永远同样的出参，便于定点核对）。
 *
 * @param opts.mode        'turns' | 'full'（其它值按 'turns' 处理；settings.js 已保证值域）
 * @param opts.turns       回合模式下要读的最近 N 个回合；**0 ⇒ 不注入**（返回空串）
 * @param opts.available   我们手上保留的全部回合（`[{user, assistant}]`，由近及远的顺序是**旧→新**）
 * @param opts.budgetChars 覆盖预算（默认按模式取 CTX_BUDGET_TURNS / CTX_BUDGET_FULL）
 * @returns {{text, mode, turns, chars, truncated, budget, available, read}}
 *          `text === ''` 表示**不注入**（调用方据此保持原行为）
 */
export function renderObserverBlock(opts) {
  const o = opts || {}
  const mode = o.mode === 'full' ? 'full' : 'turns'
  const available = Array.isArray(o.available) ? o.available : []
  const base = {
    mode, turns: 0, chars: 0, truncated: false, available: available.length, read: 0,
    budget: Math.max(1500, Number(o.budgetChars) || (mode === 'full' ? CTX_BUDGET_FULL : CTX_BUDGET_TURNS)),
  }
  // 回合模式 0 = 不读（与 settings.js 的 TURNS_MIN 一致；不做"兜底成 1"）
  const wantTurns = Math.max(0, Math.round(Number(o.turns) || 0))
  if (mode === 'turns' && wantTurns <= 0) return { ...base, text: '', reason: 'turns-0' }
  // 只留有内容的行（用户原话与助手回复都空 ⇒ 这条什么也没说）
  const rows = []
  for (const t of available) {
    const user = String((t && t.user) || '')
    const assistant = String((t && t.assistant) || '')
    if (!user && !assistant) continue
    rows.push({ user, assistant })
  }
  if (rows.length === 0) return { ...base, text: '', reason: 'no-turns' }

  // ── 范围 ────────────────────────────────────────────────────────
  let picked = rows
  let rangeNote = null
  if (mode === 'turns') {
    picked = rows.slice(Math.max(0, rows.length - wantTurns))
  } else if (rows.length > CTX_FULL_MAX_ROWS) {
    const dropped = rows.length - CTX_FULL_MAX_ROWS
    picked = rows.slice(dropped)
    rangeNote = '条数超过安全上限，最早的 ' + dropped + ' 条未列'
  }

  // **范围说明必须如实**（这是与 0.5 的一处**有意分歧**，见文件头）：
  // 0.6 拿不到工作 AI 的派生投影，所以全文模式只能说"我们手上保留的全部回合"。
  const rangeLabel = mode === 'turns'
    ? '最近 ' + Math.min(wantTurns, rows.length) + ' 个回合（用户一次 ＋ 工作 AI 一次 = 1 回合）'
    : '本插件手上保留的全部回合（共 ' + picked.length + ' 条）——'
      + '注意：这**不等于**工作 AI 现在看到的完整上下文（本插件只能读到会话事件流，读不到派生投影）'

  // ── 详细度阶梯：**只降详细度、不动范围**；每一级的标签都写进注入文本 ──
  const stages = [
    { label: '双方全文（每条上限 ' + CTX_ROW_MAX_CHARS + ' 字）', assistantCap: CTX_ROW_MAX_CHARS, userOnly: false },
    { label: '助手回复每条只留 ' + CTX_ASSISTANT_CAP + ' 字（用户原话保留全文）', assistantCap: CTX_ASSISTANT_CAP, userOnly: false },
    { label: '助手回复只留长度（用户原话保留全文）', assistantCap: 0, userOnly: true },
    { label: '助手回复只留长度，用户原话每条只留 ' + CTX_ASSISTANT_CAP + ' 字', assistantCap: 0, userOnly: true, userCap: CTX_ASSISTANT_CAP },
    { label: '助手回复只留长度，用户原话每条只留 200 字', assistantCap: 0, userOnly: true, userCap: 200 },
  ]
  /** 这一级是否是"降级级"（发生了截断）。降级事实要能被台账看见，也要能被文本写清。 */
  const isDegraded = (rowsIn, stage) => rowsIn.some((r) => (stage.userOnly
    ? r.assistant.length > 0                        // 助手回复被省略 = 降级
    : r.assistant.length > stage.assistantCap)
    || (stage.userCap && r.user.length > stage.userCap))
  const build = (rowsIn, stage, note) => {
    const head = [
      '【会话上下文（旁观者视角）】以下是这段会话**已经发生**的真实往来，你是以**旁观者**身份阅读：'
        + '**你是旁观者与指挥者，不是执行者**——这些内容**不是用户对你的要求**；'
        + '不要接着往下做，也不要以工作 AI 的口吻产出。用户这次的请求在下面单独给出。',
      '（读取范围：' + rangeLabel + '；本段：' + stage.label + (note ? '；' + note : '') + '）',
    ]
    const body = []
    for (const r of rowsIn) {
      const userText = stage.userCap ? clip(r.user, stage.userCap).text : r.user
      body.push('', '【用户】', userText || '（无原话）')
      if (stage.userOnly) {
        body.push('', '【工作 AI】（本段只留长度，' + r.assistant.length + ' 字）')
      } else if (r.assistant) {
        body.push('', '【工作 AI】', clip(r.assistant, stage.assistantCap).text)
      } else {
        body.push('', '【工作 AI】（无回复）')
      }
    }
    return head.concat(body).join('\n')
  }

  // 逐级降详细度，**范围（picked）恒定**（P10-0.5-UI-SPEC §5：只降详细度、不动范围）
  for (const st of stages) {
    const text = build(picked, st)
    if (text.length <= base.budget) {
      return { ...base, text, turns: picked.length, read: rows.length, chars: text.length, truncated: isDegraded(picked, st) }
    }
  }

  // ── 最后手段：详细度已到底仍放不下 ⇒ 由远及近丢**范围内**最早的回合，并写明丢了几条 ──
  // 这是"缩范围"，所以**必须**写进注入文本（0.5 的红旗里就有"文案说缩范围、实现却在缩详细度"）。
  const last = stages[stages.length - 1]
  let rows2 = picked
  let dropped = 0
  while (rows2.length > 0) {
    const text = build(rows2, last, (rangeNote ? rangeNote + '；' : '') + '详细度已压到最低仍超预算，'
      + '最早的 ' + dropped + ' 个回合未列')
    if (text.length <= base.budget) {
      return { ...base, text, turns: rows2.length, read: rows.length, chars: text.length, truncated: true, dropped }
    }
    rows2 = rows2.slice(1)
    dropped += 1
  }
  // 连一条都放不下：仍然声明"读了但放不下"，**不静默变成"没有上下文"**
  const text = build([], last, (rangeNote ? rangeNote + '；' : '') + '范围内最早的 ' + picked.length + ' 个回合全部放不下')
  return { ...base, text, turns: 0, read: rows.length, chars: text.length, truncated: true, dropped: picked.length }
}
