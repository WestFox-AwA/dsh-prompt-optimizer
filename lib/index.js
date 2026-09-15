/**
 * @dsh-external/dsh-prompt-optimizer — host 半（P0 骨架）。
 *
 * 本小类（回车与按钮的拦截实测）host 侧只承担三件事：
 *   1. 提供 client 探针的命令通道（evidence/cmd.json → GET /cmd）
 *   2. 接收探针报告并从**宿主侧权威记录**用户消息落库事件（user/message）
 *   3. 把报告写盘（evidence/selftest-report.json）供 agent 读取
 * 不含任何优化逻辑（属后续小类，禁入区）。
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'

export const name = '@dsh-external/dsh-prompt-optimizer'
export const inject = ['webServer', 'timer']

/** 探针残留看门狗：同一匹配串在到期前持续清扫（防"插入晚于撤销"的竞态泄漏）。 */
const sweepWatches = new Map()

/* ══════════════ 三档优化引擎（小类 2.1：提示词与产出结构） ══════════════ */
/**
 * 三档系统提示。核心语义：
 *   你是**传话者**（relay），不是对话伙伴：
 *     用户 → 【你：把用户的意思整理成命令】→ 工作 AI（编码/执行 agent）
 *   你产出的就是"用户要发给工作 AI 的那条消息本体"，会被原样发送；
 *   你既不与用户对话，也不替工作 AI 干活，更不回答用户的问题。
 *   思考过程走 reasoning 通道（浮层"思考"栏可见），不占用正文。
 */
/** 1) 身份：传话的中间领导 —— 对上不改需求，对下只给可执行要求。 */
const RELAY_IDENTITY = [
  '# 身份',
  '你是**传话的中间领导**：把用户的意图整理成一条命令，交给"工作 AI"（编码/执行 agent）执行。',
  '对上（用户）：不改需求、不加戏、不代拍板；用户没定的，写成"先向我确认"的动作。',
  '对下（工作 AI）：只给可执行的要求与判据，不给评论、解释、建议。',
  '输出**会被原样发出**（用户不再编辑或补充），读者只有工作 AI 一个；思考走 reasoning 通道，不占正文。',
].join('\n')

/** 2) 输出契约：交付什么 + 交付前闸门（逐条可判定，任何一条不过就重写）。 */
const OUTPUT_CONTRACT = [
  '# 交付物',
  '输出**就是那条命令本身**，像用户亲手打的；中文进中文出。',
  '# 交付前闸门（三查；任何一查不过就重写，不要逐条展开分析）',
  '① 纯净度：不许有元话语或元标题（优化后/改写后/改动说明/以下是），不许对"用户/原文/上一版"说话，不许把用户的疑问当成对你说的话来回答或替他拍板，不许向用户提问（改成"若 X 不明确，先读 Y 或先向我确认"），不许有一级标题（#）。',
  '② 硬度：不许出现"尽量/最好/建议/如果可以/争取"这类可绕过的软措辞，一律写成"必须/不得/做完必须…"或给出判据。',
  '③ 可开工：工作 AI 拿到它，能不追问就开工吗？不能就补具体动作，不要补猜测。',
].join('\n')

/** 3) 事实纪律 + 硬约束写法（不可放宽项：绝不虚构项目事实）。 */
const FACT_RULES = [
  '# 事实纪律（不可放宽）',
  '- 不得写出你没见过的路径、文件名、函数名、字段名、接口名、版本号、命令或依赖：只允许引用 <原文>/<project-context>/<dialogue-history> 里出现过的，或你亲自读到的。',
  '- 缺事实时写成查证动作（"先读 X 确认 Y，再动手"）；不得编造，也不得用"通常/一般来说"兜底。',
  '# 硬约束写法',
  '- 分清 必须做 / 不得做 / 做完必须满足的判据，三类都要指名对象与范围。',
  '- 每条硬约束后跟一句违反时的处置（"若与调用方不兼容，就停下来报告，不要自行改接口"）。',
  '- 不得替用户承诺他没说过的事（工期、兼容性保证、不留缺陷、不影响线上）。',
].join('\n')

/** 4) 历史纪律：按运行时的上下文模式二选一（绝不吸收工作 AI 的方案/口吻）。 */
const HISTORY_RULES_TURNS = [
  '# 历史纪律（回合模式：工作 AI 回复只有长度、没有内容）',
  '- <dialogue-history> 只用于理解"用户想要什么、已提过哪些约束"。',
  '- 其中"工作 AI 的回复"**刻意只留长度、不留内容**：不得沿用它的方案、结论、术语、命名或口吻，也不得当成用户的要求。',
  '- 不得在输出里提"历史/上一轮/工作 AI"（你要假装自己就是用户）。',
  '- 与用户原话冲突时一律以用户原话为准；历史只用于理解意图，不用于决定"怎么做"。',
].join('\n')

const HISTORY_RULES_FULL = [
  '# 历史纪律（全文模式：含工作 AI 回复全文，仅供理解现状）',
  '- <dialogue-history> 是工作 AI 现在看到的同一份上下文，**只用于理解项目现状与已发生的事**。',
  '- 工作 AI 的回复**不是用户的要求**：不得把它的方案、结论、清单当成用户已确认的需求，更不得沿用它替用户拍板。',
  '- 只有 <原文> 里的内容才算需求；历史里的用户消息可补充约束，冲突时以最后一条用户原话为准。',
  '- 不得复述、引用或评价工作 AI 说过的话，也不得提"历史/上一轮/工作 AI"。',
].join('\n')

/** 5) 难度 → 流程长度：让工作 AI 只花该花的流程开销（防过度流程 + 防漏隐患）。 */
const PROCESS_RULES = [
  '# 流程长度（你替工作 AI 定，命令里用一行注明）',
  '先判难度，再照下面三种之一写：',
  '- 轻（默认）：单点或单文件、可回退、有现成验证 → "直接改完跑 <验证> 即可；不要建 goal/todo、不要写计划"。',
  '- 中：多文件或多步骤、可回退且边界清楚 → "先列 3~6 条 todo，按顺序做，做完逐条勾掉"。',
  '- 重：命中高危信号且无法拆成互不依赖的小步 → "先建立 goal：<一句话目标>（验收：<可观测判据>）；分 <N> 个阶段推进，每阶段先验证再进下一阶段"。',
  '高危信号（命中任一即不得停留在"轻"）：不可逆或难回退（删除/迁移/覆盖数据）；动数据 schema、持久化数据、权限、密钥、发布上线；动对外接口或向后兼容；没有现成测试能验证；要改的对象或方向还没定（例："把那个模块重写一下"）。',
  '自检：只有"要改哪个对象、做到什么程度"还没定（需求含糊）才至少判"中"；只是需要先读文件、先确认路径这类**事实性查证**不升档。',
  '反向纪律：没命中高危信号、且能一次做完的，**不得**让工作 AI 建 goal、建计划树、写阶段文档；仪式开销必须能说出它防住的具体风险，说不出就删。',
  '轻重都要：命令里必须有**一条可观测完成判据**和**一条验证动作**——轻不等于不验。',
].join('\n')

/**
 * 档位 = 部件组合（身份/契约 + 档位正文 + 流程长度 + 事实纪律），
 * 历史纪律与项目上下文由 buildSystem 按运行时情况追加 —— 避免同一句话在多处重复。
 * 注：普通档不放"流程长度"部件 —— 实测 2/2 未被遵循（basic 输出里不出现执行方式行），
 * 属"变长但无可观测提升"，已回退；普通档不主动索取任何流程，本身即"简单任务直接执行"。
 */
const TIER_PARTS = {
  basic: {
    label: '普通',
    temperature: 0.2,
    parts: [
      RELAY_IDENTITY,
      OUTPUT_CONTRACT,
      [
        '# 本轮任务：只做语言层修复',
        '下面这段是用户要发给工作 AI 的指令，可能有病句、指代不明、用词含糊。',
        '把它改写成通顺、精确、无歧义的**同一条指令**，改完就能直接发出去。',
        '必须做到（可判定）：',
        '- 只动语言：病句、错别字、标点、指代消解（"那个页面"保留但指向同一对象）、含糊词收敛为可执行表述。',
        '- 逐句自检：输出的每条要求都能指回原话的哪一句；指不回去的删掉。',
        '- 新增需求、功能、约束、技术选型、交付物一律禁止；范围不得扩大也不得缩小。',
        '- 原话没说的不得替用户决定，写成给工作 AI 的查证指令（"先确认指的是哪个页面，再动手"）。',
        '- 长度上限：不超过原话的 1.4 倍；原话 30 字以内时不超过 60 字。',
      ].join('\n'),
      FACT_RULES,
    ],
  },
  advanced: {
    label: '高级',
    temperature: 0.3,
    parts: [
      RELAY_IDENTITY,
      OUTPUT_CONTRACT,
      [
        '# 本轮任务：以用户的名义把命令说清楚',
        '用户的原话含糊、缺关键约束。在**完全不改变用户目标**的前提下，把"用户显然想要、但没说出口"的必要信息写成对工作 AI 的要求，让它一次做对。',
        '允许做（且仅限这些）：',
        '- 补全从目标可直接推出的最低交付要求与验收标准（如"能跑起来""界面能用"），写成要求而非评论。',
        '- 把含糊词收敛为可观察、可执行的要求。',
        '- 存在两种合理解读时：按更常见的一种写成主要求，另一种写成"如果实际是 X，则…"的指令。',
        '禁止：新增功能/新目标/新依赖；虚构用户没提的环境、数据、技术栈；写用户没授权的技术选型。',
        '逐句自检：每条补充都必须能回溯到原话里的某一句，回溯不到的删掉。',
      ].join('\n'),
      PROCESS_RULES,
      FACT_RULES,
    ],
  },
  extreme: {
    label: '极端',
    temperature: 0.3,
    parts: [
      RELAY_IDENTITY,
      OUTPUT_CONTRACT,
      [
        '# 本轮任务：把复杂诉求固化成一条可执行命令',
        '这是一次需要多步执行的任务。用户不会再编辑或转述，工作 AI 会照这条命令执行。',
        '命令必须包含（以"用户在下命令"的口吻写）：',
        '- 诉求固化：要做什么 / 做完的标志（可观测验收标准）/ 硬约束 / 不许做什么。四块齐全，缺一块就是不合格。',
        '- 分阶段执行计划：每阶段写清动作与产出，并写明纪律（先验证再改、失败即回退、不擅自扩大范围、改完给证据）。',
        '- 多情况预案：最可能出岔子的 2~4 种情况，每种写成"如果出现 <触发信号>，就先 <应对动作>，不要 <禁止动作>"。',
        '- 执行方式：按下面的流程长度规矩写一行（这一行决定工作 AI 要不要建 goal/todo，必须给出结论，不许省略）。',
      ].join('\n'),
      PROCESS_RULES,
      FACT_RULES,
    ],
  },
}

/** 按运行时情况组装 system：档位部件 + 历史纪律（按模式二选一）+ 可选项目上下文。 */
function buildSystem(tier, opts) {
  const spec = TIER_PARTS[tier] || TIER_PARTS.basic
  const options = opts || {}
  const parts = spec.parts.slice()
  parts.push(options.historyMode === 'full' ? HISTORY_RULES_FULL : HISTORY_RULES_TURNS)
  if (options.projectContext === true) parts.push(ADVANCED_CONTEXT_SUFFIX)
  return parts.join('\n\n')
}

/** 静态 system（回合模式、无项目上下文）——供对比/自检等不感知运行时的路径使用。 */
const TIER_SPECS = Object.keys(TIER_PARTS).reduce((acc, id) => {
  acc[id] = { label: TIER_PARTS[id].label, temperature: TIER_PARTS[id].temperature, system: buildSystem(id, { historyMode: 'turns' }) }
  return acc
}, {})

const COMPARE_REQUEST = '把那个页面弄好看点，动画也加上，顺手把数据那块也修一下'
let lastRoute = null
let optimizerCallDepth = 0

/** 读取最近 N 回合的"意图上下文"：用户原话全文保留；工作 AI 回复只留中性元数据（防污染）。 */
const HISTORY_TURNS_MAX = 10
const HISTORY_TURNS_DEFAULT = 0   // 0 = 不读历史（默认等价于改动前行为）
const HISTORY_USER_MAX_CHARS = 4000      // 单条用户消息上限（避免超长粘贴撑爆预算）
const HISTORY_TOTAL_MAX_CHARS = 12000    // 回合模式总预算：超出时按整回合丢弃最早的，绝不截断单条约束
const HISTORY_FULL_MAX_CHARS = 60000     // 全文模式总预算：上限更高，但同样整回合丢弃，绝不截断单条
const HISTORY_ASSISTANT_MAX_CHARS = 8000 // 全文模式下单条工作 AI 回复的上限（超出标"截断"）
const HISTORY_MODES = ['turns', 'full']
const HISTORY_MODE_DEFAULT = 'turns'
function normalizeHistoryMode(v) { return HISTORY_MODES.indexOf(v) >= 0 ? v : HISTORY_MODE_DEFAULT }
function textOfMessage(message) {
  try {
    const blocks = (message && message.content) || []
    return blocks.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('\n').trim()
  } catch { return '' }
}
/**
 * 会话事件"投影"层（DSH 0.1.6 起 ownEvents/snapshotEvents/eventAt 被标记 deprecated，
 * Agent Note「deprecate-synchronous-session-event-reads」明确：新代码禁止再调用同步历史读取，
 * 官方方向是"维护投影 + 按需异步分页"，且当前版本尚未提供异步替代接口）。
 * 做法：新事件从 session/event 增量流入投影；投影为空时才用一次 ownEvents 做种子并缓存。
 * 将来该 API 被移除时，历史读取只会退化成"从插件启动起"（并如实标注 source），不会崩、也不会错读。
 */
const HISTORY_PROJECTION_MAX_SESSIONS = 24
const HISTORY_PROJECTION_MAX_TURNS = 40          // 每会话保留最近 40 个回合（超出按**整回合**丢弃最早的）
const HISTORY_PROJECTION_MAX_CHARS = 200000      // 每会话投影总字符上限（同样按整回合丢弃）
const HISTORY_PROJECTION_KEEP_TEXTS = 6          // 全文模式下每回合保留的最近助手回复条数（其余只留计数）
const historyProjection = new Map()   // sessionId -> { seeded, turns: [{ user, texts, assistantChars, tools }] }

function projectionOf(sessionId) {
  const key = String(sessionId || '')
  if (!key) return null
  let rec = historyProjection.get(key)
  if (!rec) {
    rec = { seeded: false, turns: [], dropped: 0 }
    historyProjection.set(key, rec)
    while (historyProjection.size > HISTORY_PROJECTION_MAX_SESSIONS) {
      const oldest = historyProjection.keys().next()
      if (!oldest || oldest.done || oldest.value === key) break
      historyProjection.delete(oldest.value)
    }
  }
  return rec
}
function projectionCapText(text, max) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + '…（截断）' : s
}
function projectionChars(rec) {
  let total = 0
  for (const t of rec.turns) {
    if (t.user) total += t.user.text.length
    for (const x of t.texts) total += x.text.length
  }
  return total
}
/** 超出上限时按"整回合"丢弃最早的 —— 与摘要器自己的预算语义一致，绝不留下没有用户消息的尾巴。 */
function projectionTrim(rec) {
  while (rec.turns.length > HISTORY_PROJECTION_MAX_TURNS || projectionChars(rec) > HISTORY_PROJECTION_MAX_CHARS) {
    if (rec.turns.length <= 1) break
    rec.turns.shift()
    rec.dropped = (rec.dropped || 0) + 1
  }
}
function projectionTurn(rec, startNew) {
  if (startNew || rec.turns.length === 0) rec.turns.push({ user: null, texts: [], assistantChars: 0, tools: 0 })
  return rec.turns[rec.turns.length - 1]
}
/** 原始 session 事件 → 回合制投影（用户消息是骨架，助手内容按额度留存；绝不因助手刷屏而丢用户消息）。 */
function projectSessionEvent(rec, event) {
  if (!rec || !event || !event.type) return
  if (event.type === 'user/message') {
    const text = textOfMessage(event.data)
    if (!text) return
    const turn = projectionTurn(rec, true)
    turn.user = { text: projectionCapText(text, HISTORY_USER_MAX_CHARS), chars: text.length }
    projectionTrim(rec)
  } else if (event.type === 'assistant/message') {
    const text = textOfMessage(event.data && event.data.message)
    const turn = projectionTurn(rec, false)
    turn.assistantChars += text.length
    turn.texts.push({ text: projectionCapText(text, HISTORY_ASSISTANT_MAX_CHARS), chars: text.length })
    if (turn.texts.length > HISTORY_PROJECTION_KEEP_TEXTS) turn.texts.shift()
    projectionTrim(rec)
  } else if (event.type === 'tool/call') {
    const turn = projectionTurn(rec, false)
    turn.tools += 1
  }
}
/** 投影 → 摘要器消费的条目序列（回合模式：助手只留聚合元数据；全文模式：附上留存的回复正文）。 */
function projectionItems(rec, full) {
  const out = []
  for (const t of rec.turns) {
    if (t.user) out.push({ role: 'user', text: t.user.text, chars: t.user.chars })
    const keptChars = t.texts.reduce((s, x) => s + x.text.length, 0)
    if (full) {
      for (const x of t.texts) out.push({ role: 'work-ai-full', text: x.text, chars: x.chars, tools: 0 })
      if (t.tools > 0) out.push({ role: 'work-ai', chars: 0, tools: t.tools })
      else if (t.assistantChars > keptChars + 200) out.push({ role: 'work-ai', chars: t.assistantChars - keptChars, tools: 0 })
    } else if (t.assistantChars > 0 || t.tools > 0) {
      out.push({ role: 'work-ai', chars: t.assistantChars, tools: t.tools })
    }
  }
  return out
}
function projectionUserTurns(rec) {
  let n = 0
  for (const t of rec.turns) if (t.user) n += 1
  return n
}
/** 历史读取的唯一入口。
 *  wantTurns：回合模式传要读的回合数，全文模式传 Infinity（要整段）。
 *  策略：投影先满足就用投影；投影不够（刚启动/刚重载）才播种一次，播种结果**整体替换**投影
 *  （种子已含截至此刻的全部事件，替换不会丢也不会重）；API 不可用时退化为"从插件启动起"并如实标注。 */
function readSessionHistory(session, sessionId, wantTurns, full) {
  const rec = projectionOf(sessionId)
  if (!rec) return { items: [], source: 'no-session-id' }
  const want = Number(wantTurns) > 0 ? Number(wantTurns) : 1
  if (!rec.seeded && projectionUserTurns(rec) < want) {
    rec.seeded = true
    let raw = null
    try { raw = session && typeof session.ownEvents === 'function' ? session.ownEvents() : null } catch { raw = null }
    if (Array.isArray(raw) && raw.length > 0) {
      const seeded = { seeded: true, turns: [], dropped: 0 }
      for (const ev of raw) projectSessionEvent(seeded, ev)
      if (projectionUserTurns(seeded) >= projectionUserTurns(rec)) { rec.turns = seeded.turns; rec.dropped = seeded.dropped }
      else rec.dropped = (rec.dropped || 0) + (seeded.dropped || 0)
      return { items: projectionItems(rec, full), source: 'seed', rawEvents: raw.length, rawUsers: projectionUserTurns(rec), dropped: rec.dropped || 0 }
    }
    return { items: projectionItems(rec, full), source: rec.turns.length === 0 ? 'unavailable' : 'projection-partial', dropped: rec.dropped || 0 }
  }
  return { items: projectionItems(rec, full), source: 'projection', dropped: rec.dropped || 0 }
}

function collectDialogueDigest(ctx, sessionId, turns, mode) {
  const m = normalizeHistoryMode(mode)
  const full = m === 'full'
  const n = full ? HISTORY_TURNS_MAX : Math.max(0, Math.min(HISTORY_TURNS_MAX, Number(turns) || 0))
  if (mode === 'off') return null
  if (!full && n <= 0) return null
  if (!sessionId) return { mode: m, turns: n, degraded: true, reason: 'no-session-id', source: 'no-session-id', userTurns: 0, items: [] }
  let session = null
  try { const sessions = ctx.get('sessions'); session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null } catch { session = null }
  if (!session) return { mode: m, turns: n, degraded: true, reason: 'session-not-live', source: 'session-not-live', userTurns: 0, items: [] }
  const hist = readSessionHistory(session, sessionId, full ? Infinity : n, full)
  const seq = hist.items.map((it) => (it.role === 'work-ai-full' && !full
    ? { role: 'work-ai', chars: it.chars, tools: it.tools || 0 }   // 回合模式：只留长度与工具次数，与改动前语义一致
    : it))
  // 取最近 n 个"用户回合"：定位倒数第 n 条用户消息，从它开始截取
  const userIdx = seq.map((it, i) => (it.role === 'user' ? i : -1)).filter((i) => i >= 0)
  // 回合模式：从倒数第 n 条用户消息开始截取；全文模式：整段会话不裁回合，只受总预算约束
  const from = !full && userIdx.length > n ? userIdx[userIdx.length - n] : 0
  let items = seq.slice(from)
  // 总长度预算：**按整回合丢弃最早的部分**，绝不截断某条约束条款（至少保留最后 1 个回合）
  const budget = full ? HISTORY_FULL_MAX_CHARS : HISTORY_TOTAL_MAX_CHARS
  const weightOf = (it) => (it.role === 'user' || it.role === 'work-ai-full' ? it.text.length : 0)
  const totalOf = (list) => list.reduce((s2, it) => s2 + weightOf(it), 0)
  let omittedTurns = 0
  let total = totalOf(items)
  while (total > budget) {
    const cut = items.findIndex((it) => it.role === 'user')
    if (cut < 0 || cut >= items.length - 1) break
    omittedTurns += 1
    items = items.slice(cut + 1)
    total = totalOf(items)
  }
  const droppedByProjection = hist.dropped || 0
  const userTurns = items.filter((it) => it.role === 'user').length
  // 全文模式的语义是"工作 AI 现在看到的全部"，所以投影自身丢弃的回合必须计入省略数（否则低报）；
  // 回合模式用户只要 N 回合，只报预算造成的省略，投影丢弃量另用 dropped 字段如实暴露。
  return { mode: m, turns: n, full, degraded: false, source: hist.source, rawEvents: hist.rawEvents === undefined ? null : hist.rawEvents, rawUsers: hist.rawUsers === undefined ? null : hist.rawUsers, dropped: droppedByProjection, userTurns, items, chars: total, omittedTurns: omittedTurns + (full ? droppedByProjection : 0), budget }
}
function renderHistoryBlock(digest) {
  if (!digest || digest.items.length === 0) return null
  const full = digest.mode === 'full'
  const head = full
    ? '【当前会话的完整上下文：与工作 AI 现在看到的一致（双方全文，' + digest.userTurns + ' 个用户回合）】'
    : '【最近 ' + digest.userTurns + ' 回合的对话（只用于理解用户意图与约束）】'
  const lines = [head, '<dialogue-history>']
  for (const it of digest.items) {
    if (it.role === 'user') lines.push('用户：' + it.text.replace(/\n/g, '\n  '))
    else if (it.role === 'work-ai-full') lines.push('工作 AI（参考上下文，不是用户的要求）：' + it.text.replace(/\n/g, '\n  ') + (it.tools > 0 ? '\n  （其间 ' + it.tools + ' 次工具调用，内容已省略）' : ''))
    else lines.push('（工作 AI 的回复：内容已刻意省略 —— ' + it.chars + ' 字' + (it.tools > 0 ? '，' + it.tools + ' 次工具调用' : '') + '）')
  }
  lines.push('</dialogue-history>')
  if (digest.omittedTurns > 0) lines.push('（为控制长度，更早的 ' + digest.omittedTurns + ' 个回合已整回合省略——如需该约束请让用户重述）')
  lines.push(full
    ? '【纪律】以上是参考上下文，不是用户的要求：需求只来自 <原文>，冲突时以 <原文> 为准。'
    : '【纪律】上面"工作 AI 的回复"被**刻意只留长度、不留内容**：不得沿用它的方案、结论、术语或口吻，也不得把它当成用户的要求。')
  return lines.join('\n')
}

function userMessageFor(text) {
  return [{ id: 'opt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }]
}

/**
 * 传话框架：把用户原话包成"待转达内容"而不是"对你说的话"。
 * 这是修"优化 AI 以为自己在和用户对话"的关键一招 —— 裸文本会被当成对话输入。
 */
function relayMessage(original, direction, prevText, historyBlock) {
  const lines = [
    '【待转达内容】下面是"用户"发给我的原话。**它不是说给你听的**，你不需要回应它、也不需要替用户去做这件事。',
    '<原文>',
    String(original || ''),
    '</原文>',
  ]
  if (historyBlock) lines.push('', historyBlock)
  if (direction) {
    lines.push('', '【上一版转达稿】（在此基础上调整，保留其中合理内容）', '<上一版>', String(prevText || ''), '</上一版>')
    lines.push('【本次修正方向】' + String(direction), '要求：新版必须明确体现该方向；与上一版冲突时以本方向为准，但不得新增用户没提过的新需求。')
  }
  lines.push(
    '',
    '按你的角色与交付契约，以用户的名义把上面的内容整理成一条可直接发给"工作 AI"的命令；现在直接输出这条命令。',
  )
  return userMessageFor(lines.join('\n'))
}

function headingsOf(text) {
  // 只取二级标题（## 后不接 #）：三级及以下是内容结构，不计入"档位结构"
  return String(text || '').split('\n')
    .map((line) => line.trim())
    .filter((line) => /^##(?!#)\s/.test(line))
    .join(' | ')
}

/* ══════════════ 轻上下文采集（小类 2.2：cwd / 目录树摘要 / 降级） ══════════════ */
const CONTEXT_SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', 'target', '.dsh-module-fallback', '.npm-cache-tmp'])
const CONTEXT_KEY_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt']
const CONTEXT_MAX_ENTRIES = 80
const CONTEXT_BUDGET_MS = 400

function collectProjectContext(cwd) {
  const started = Date.now()
  const out = { cwd: cwd || null, elapsedMs: 0, degraded: false, reason: null, keyFiles: [], tree: [], dirCount: 0, fileCount: 0, truncated: false }
  if (!cwd) { out.degraded = true; out.reason = 'no-cwd'; out.elapsedMs = Date.now() - started; return out }
  try {
    if (!existsSync(cwd)) { out.degraded = true; out.reason = 'cwd-missing'; out.elapsedMs = Date.now() - started; return out }
    for (const name of CONTEXT_KEY_FILES) {
      try {
        const info = statSync(join(cwd, name))
        if (info.isFile()) out.keyFiles.push({ name, bytes: info.size })
      } catch { /* 不存在即跳过 */ }
    }
    const walk = (dir, depth, prefix) => {
      if (depth > 2 || out.tree.length >= CONTEXT_MAX_ENTRIES || Date.now() - started > CONTEXT_BUDGET_MS) { out.truncated = true; return }
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      entries.sort((a, b) => (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) || a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (out.tree.length >= CONTEXT_MAX_ENTRIES) { out.truncated = true; return }
        if (entry.name.startsWith('.')) continue
        if (CONTEXT_SKIP.has(entry.name)) continue
        const rel = prefix ? prefix + '/' + entry.name : entry.name
        out.tree.push(entry.isDirectory() ? rel + '/' : rel)
        if (entry.isDirectory()) { out.dirCount += 1; walk(join(dir, entry.name), depth + 1, rel) } else { out.fileCount += 1 }
      }
    }
    walk(cwd, 1, '')
  } catch (error) {
    out.degraded = true
    out.reason = String(error)
  }
  out.elapsedMs = Date.now() - started
  if (!out.degraded && out.tree.length === 0 && out.keyFiles.length === 0) { out.degraded = true; out.reason = 'empty-project' }
  return out
}

function renderContextBlock(collect) {
  if (!collect || collect.degraded) return null
  const lines = ['<project-context>', 'cwd: ' + collect.cwd]
  if (collect.keyFiles.length > 0) lines.push('key files: ' + collect.keyFiles.map((f) => f.name + '(' + f.bytes + 'B)').join(', '))
  lines.push('tree (depth<=2, cap ' + CONTEXT_MAX_ENTRIES + ', dirs=' + collect.dirCount + ', files=' + collect.fileCount + '):')
  for (const item of collect.tree) lines.push('  ' + item)
  lines.push('</project-context>')
  return lines.join('\n')
}

const ADVANCED_CONTEXT_SUFFIX = [
  '',
  '【项目上下文】本条用户消息前附带 <project-context> 块，内容是当前项目的真实目录树与关键文件。',
  '命令里引用路径/文件名时必须与块中一致；块中不存在的路径一律不得编造，需要时写成"先确认 X 是否存在"的查证动作。',
].join('\n')

function resolveSessionCwd(ctx) {
  try {
    const sessions = ctx.get('sessions')
    const list = sessions ? sessions.list() : []
    for (const session of list) {
      const cwd = (session.header && session.header.cwd) || (session.meta && session.meta.cwd)
      if (typeof cwd === 'string' && cwd) return { cwd, sessionId: String(session.id) }
    }
  } catch { /* fall through */ }
  return { cwd: process.cwd(), sessionId: null }
}

async function streamOnce(llm, selection, system, userText, temperature) {
  const t0 = Date.now()
  let reasoning = ''
  let text = ''
  let usage = null
  let firstDeltaMs = null
  let error = null
  optimizerCallDepth += 1
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system,
      temperature,
      messages: userMessageFor(userText),
    })
    for await (const chunk of stream) {
      if (chunk.type === 'reasoning-delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - t0
        reasoning += chunk.text
        if (typeof onDelta === 'function') onDelta('reasoning-delta', chunk.text)
      } else if (chunk.type === 'text-delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - t0
        text += chunk.text
        if (typeof onDelta === 'function') onDelta('text-delta', chunk.text)
      } else if (chunk.type === 'usage') usage = chunk.usage
    }
  } catch (error_) {
    error = String(error_)
  } finally {
    optimizerCallDepth -= 1
  }
  return { ms: Date.now() - t0, firstDeltaMs, reasoningChars: reasoning.length, textChars: text.length, usage, error, text, reasoning }
}

/** 小类 2.2 核验器：A/B（带/不带上下文）+ 降级（空项目）+ 首字延迟。 */
async function runContextCheck(ctx, token, payload) {
  const llm = ctx.get('llm')
  let selection = null
  try { const def = ctx.get('agentDefaultModel'); if (def) selection = def.currentSelection() } catch { /* fall through */ }
  if (!selection || !selection.provider) selection = lastRoute
  const resolved = resolveSessionCwd(ctx)
  const requested = (payload && payload.cwd) || resolved.cwd
  const started = Date.now()
  const out = { token, requestedCwd: requested, sessionCwd: resolved, selection, started, ab: [], degraded: null, error: null }
  if (!llm || !selection || !selection.provider) {
    out.error = 'no-llm-route'
    ensureDir()
    writeFileSync(join(EVIDENCE, 'context-check.json'), JSON.stringify(out, null, 2))
    return out
  }

  const collect = collectProjectContext(requested)
  out.collect = { cwd: collect.cwd, elapsedMs: collect.elapsedMs, degraded: collect.degraded, reason: collect.reason, dirCount: collect.dirCount, fileCount: collect.fileCount, treeLen: collect.tree.length, truncated: collect.truncated, keyFiles: collect.keyFiles, tree: collect.tree }
  const block = renderContextBlock(collect)
  out.blockChars = block ? block.length : 0

  const spec = TIER_SPECS.advanced
  for (const variant of ['with-context', 'without-context']) {
    const userText = variant === 'with-context' && block
      ? block + '\n\n用户需求：' + COMPARE_REQUEST
      : COMPARE_REQUEST
    const system = variant === 'with-context' && block ? spec.system + ADVANCED_CONTEXT_SUFFIX : spec.system
    const run = await streamOnce(llm, selection, system, userText, spec.temperature)
    const names = collect.tree.map((t) => t.replace(/\/$/, '').split('/').pop()).filter((n) => n && n.length >= 3)
    const uniq = [...new Set(names)]
    const hit = uniq.filter((n) => run.text.includes(n))
    out.ab.push({
      variant, ms: run.ms, firstDeltaMs: run.firstDeltaMs, textChars: run.textChars,
      treeNames: uniq.length, treeNamesReferenced: hit.length, referencedSample: hit.slice(0, 12),
      error: run.error, text: run.text,
    })
  }

  // 降级：空项目目录（真实创建）
  const emptyDir = join(EVIDENCE, 'empty-project')
  try { mkdirSync(emptyDir, { recursive: true }) } catch { /* noop */ }
  const emptyCollect = collectProjectContext(emptyDir)
  const emptyRun = await streamOnce(llm, selection, spec.system, COMPARE_REQUEST, spec.temperature)
  out.degraded = {
    cwd: emptyDir,
    collect: { elapsedMs: emptyCollect.elapsedMs, degraded: emptyCollect.degraded, reason: emptyCollect.reason, treeLen: emptyCollect.tree.length },
    blockRendered: renderContextBlock(emptyCollect) !== null,
    textChars: emptyRun.textChars, firstDeltaMs: emptyRun.firstDeltaMs, error: emptyRun.error,
    text: emptyRun.text,
  }
  out.totalMs = Date.now() - started
  ensureDir()
  writeFileSync(join(EVIDENCE, 'context-check.json'), JSON.stringify(out, null, 2))
  const md = []
  md.push('# 轻上下文采集 · A/B 核验')
  md.push('')
  md.push('- 模型：`' + selection.provider + '/' + selection.model + '` · 会话 cwd：`' + resolved.cwd + '` · 请求 cwd：`' + requested + '`')
  md.push('- 采集耗时：' + collect.elapsedMs + 'ms · 目录 ' + collect.dirCount + ' / 文件 ' + collect.fileCount + ' · 树条目 ' + collect.tree.length + ' · 关键文件 ' + (collect.keyFiles.map((f) => f.name).join(', ') || '无'))
  md.push('- 上下文块：' + (block ? block.length + ' 字符' : '未生成'))
  md.push('')
  md.push('| 变体 | 首字延迟 | 总耗时 | 产出字数 | 引用的真实条目 |')
  md.push('|---|---|---|---|---|')
  for (const r of out.ab) md.push('| ' + r.variant + ' | ' + r.firstDeltaMs + 'ms | ' + r.ms + 'ms | ' + r.textChars + ' | ' + r.treeNamesReferenced + '/' + r.treeNames + '（' + (r.referencedSample || []).slice(0, 6).join(', ') + '） |')
  md.push('')
  md.push('## 降级（空项目目录）')
  md.push('')
  md.push('- degraded=' + out.degraded.collect.degraded + ' · reason=' + out.degraded.collect.reason + ' · 渲染块=' + out.degraded.blockRendered + ' · 产出 ' + out.degraded.textChars + ' 字 · 首字 ' + out.degraded.firstDeltaMs + 'ms · error=' + out.degraded.error)
  md.push('')
  md.push('## 带上下文产出（全文）')
  md.push('')
  md.push('```markdown')
  md.push(String((out.ab[0] || {}).text || '').trim())
  md.push('```')
  writeFileSync(join(EVIDENCE, 'context-check.md'), md.join('\n'))
  return out
}

/* ══════════════ 只读工具循环（小类 2.3：read/glob/grep + 轮次上限 + 查证 trace） ══════════════ */
const LOOP_MAX_ROUNDS = 6
const LOOP_BUDGET_MS = 90000
const LOOP_MAX_FILES = 400
const LOOP_MAX_FILE_BYTES = 200 * 1024
const LOOP_MAX_RESULT_CHARS = 4000
const LOOP_TOOLS = [
  {
    name: 'read',
    description: '读取项目内某个文件的指定行范围（只读）。返回带行号的文本。',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '相对项目根的路径' }, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['path'] },
  },
  {
    name: 'glob',
    description: '按通配符列出项目内文件路径（只读，最多 50 条）。支持 ** 与 *。',
    parameters: { type: 'object', properties: { pattern: { type: 'string', description: '例如 **/*.js' } }, required: ['pattern'] },
  },
  {
    name: 'grep',
    description: '在项目内按正则搜索，返回 "文件:行号: 内容"（只读，最多 40 条）。',
    parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: '可选：限定子路径' } }, required: ['pattern'] },
  },
]

function resolveInsideRoot(root, rel) {
  const abs = resolve(root, String(rel || ''))
  const back = relative(root, abs)
  if (!back || back.startsWith('..') || isAbsolute(back)) return null
  try {
    const realRoot = realpathSync(root)
    const realAbs = realpathSync(abs)
    const realBack = relative(realRoot, realAbs)
    if (!realBack || realBack.startsWith('..') || isAbsolute(realBack)) return null
  } catch { /* 目标尚不存在（例如越界或不存在的路径）时以词法校验为准 */ }
  return abs
}

function walkFiles(root, cap) {
  const found = []
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'evidence'])
  const walk = (dir, depth) => {
    if (found.length >= cap || depth > 6) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= cap) return
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs, depth + 1)
      else if (entry.isFile()) found.push(abs)
    }
  }
  walk(root, 1)
  return found
}

function toolRead(root, args) {
  const abs = resolveInsideRoot(root, args.path)
  if (!abs) return '拒绝：路径越出项目范围（只读工具限定在项目根内）'
  if (!existsSync(abs)) return '文件不存在：' + args.path
  const info = statSync(abs)
  if (!info.isFile()) return '不是文件：' + args.path
  if (info.size > LOOP_MAX_FILE_BYTES) return '拒绝：文件过大（>' + LOOP_MAX_FILE_BYTES + 'B）'
  const lines = readFileSync(abs, 'utf8').split('\n')
  const start = Math.max(1, Number(args.startLine) || 1)
  const end = Math.min(lines.length, Number(args.endLine) || start + 199)
  const slice = lines.slice(start - 1, end)
  let out = slice.map((line, i) => String(start + i).padStart(5, ' ') + '| ' + line).join('\n')
  if (out.length > LOOP_MAX_RESULT_CHARS) out = out.slice(0, LOOP_MAX_RESULT_CHARS) + '\n…(截断)'
  return '文件 ' + args.path + '（共 ' + lines.length + ' 行，返回 ' + start + '-' + end + '）\n' + out
}

function toolGlob(root, args) {
  const pattern = String(args.pattern || '')
  const rx = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*').replace(/\?/g, '.') + '$')
  const hits = []
  for (const abs of walkFiles(root, LOOP_MAX_FILES)) {
    const rel = relative(root, abs).split('\\').join('/')
    if (rx.test(rel)) hits.push(rel)
    if (hits.length >= 50) break
  }
  return hits.length === 0 ? '无匹配（pattern=' + pattern + '）' : '匹配 ' + hits.length + ' 条：\n' + hits.join('\n')
}

function toolGrep(root, args) {
  let rx = null
  try { rx = new RegExp(String(args.pattern || '')) } catch (error) { return '正则无效：' + String(error) }
  const scope = args.path ? resolveInsideRoot(root, args.path) : root
  if (!scope) return '拒绝：路径越出项目范围'
  const files = existsSync(scope) && statSync(scope).isDirectory() ? walkFiles(scope, LOOP_MAX_FILES) : [scope]
  const hits = []
  for (const abs of files) {
    if (hits.length >= 40) break
    let info = null
    try { info = statSync(abs) } catch { continue }
    if (!info.isFile() || info.size > LOOP_MAX_FILE_BYTES) continue
    let text = ''
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    if (text.indexOf('\u0000') >= 0) continue
    const rel = relative(root, abs).split('\\').join('/')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < 40; i += 1) {
      if (rx.test(lines[i])) hits.push(rel + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200))
    }
  }
  return hits.length === 0 ? '无匹配（pattern=' + args.pattern + '）' : '命中 ' + hits.length + ' 条：\n' + hits.join('\n')
}

function executeReadOnlyTool(root, name, args) {
  if (name === 'read') return toolRead(root, args)
  if (name === 'glob') return toolGlob(root, args)
  if (name === 'grep') return toolGrep(root, args)
  return '拒绝：不存在的工具（本循环只提供 read/glob/grep，且只读）'
}

function assistantToolCallMessage(calls, selection) {
  return [{
    id: 'opt-a-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    role: 'assistant',
    content: calls.map((c) => ({ type: 'tool-call', id: c.id, name: c.name, arguments: c.arguments })),
    source: { kind: 'model', provider: selection.provider, model: selection.model },
  }]
}

function toolResultMessages(calls, outputs) {
  return calls.map((c, i) => ({
    id: 'opt-t-' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: c.id, content: [{ type: 'text', text: outputs[i].text }], ...(outputs[i].ok ? {} : { isError: true }) }],
    source: { kind: 'tool', callId: c.id },
  }))
}

async function streamWithTools(llm, selection, system, messages, tools, temperature, budgetMs, externalSignal, onDelta) {
  const t0 = Date.now()
  let reasoning = ''
  let text = ''
  let usage = null
  let firstDeltaMs = null
  let error = null
  let finish = null
  const calls = []
  const ac = new AbortController()
  const hardTimer = setTimeout(() => ac.abort(), budgetMs || LOOP_BUDGET_MS)
  if (externalSignal) { if (externalSignal.aborted) ac.abort(); else externalSignal.addEventListener('abort', () => ac.abort(), { once: true }) }
  optimizerCallDepth += 1
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system,
      temperature,
      messages,
      signal: ac.signal,
      ...(tools ? { tools } : {}),
    })
    for await (const chunk of stream) {
      if (chunk.type === 'reasoning-delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - t0
        reasoning += chunk.text
        if (typeof onDelta === 'function') onDelta('reasoning-delta', chunk.text)
      } else if (chunk.type === 'text-delta') {
        if (firstDeltaMs === null) firstDeltaMs = Date.now() - t0
        text += chunk.text
        if (typeof onDelta === 'function') onDelta('text-delta', chunk.text)
      } else if (chunk.type === 'tool-call-delta') {
        let call = calls.find((c) => c.id === chunk.id)
        if (!call) { call = { id: chunk.id, name: chunk.name || '', arguments: '' }; calls.push(call) }
        if (chunk.name) call.name = chunk.name
        call.arguments += chunk.argumentsDelta || ''
      } else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'tool-call') {
        const block = chunk.block
        const existing = calls.find((c) => c.id === block.id)
        if (existing) { existing.name = block.name || existing.name; existing.arguments = block.arguments || existing.arguments }
        else calls.push({ id: block.id, name: block.name, arguments: block.arguments })
      } else if (chunk.type === 'usage') {
        // usage 随流到达（不同 provider 可能多次/最后一次给全量）：立刻转发给前端做 token 计数
        usage = chunk.usage
        if (typeof onDelta === 'function') onDelta('usage', JSON.stringify(chunk.usage || {}))
      }
      else if (chunk.type === 'finish') {
        finish = chunk.reason
        if (chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          error = 'llm-' + chunk.reason.kind + ': ' + JSON.stringify(chunk.reason.failure || {})
        }
      }
    }
  } catch (error_) {
    error = String(error_)
  } finally {
    clearTimeout(hardTimer)
    optimizerCallDepth -= 1
  }
  return { ms: Date.now() - t0, firstDeltaMs, reasoning, text, usage, error, finish, calls }
}

/** 极端档的只读工具循环：模型自己决定读什么/搜什么，直到给出结论或撞上限。 */
async function runToolLoop(ctx, opts) {
  const llm = ctx.get('llm')
  let selection = null
  try { const def = ctx.get('agentDefaultModel'); if (def) selection = def.currentSelection() } catch { /* fall through */ }
  if (!selection || !selection.provider) selection = lastRoute
  const root = opts.root
  const maxRounds = opts.maxRounds || 3
  const trace = []
  const system = opts.system || (TIER_SPECS.extreme.system + '\n\n【只读查证】你可以调用 read/glob/grep 三个只读工具查证项目实际情况（限定在项目根内、不写盘、不执行命令）。需要项目事实时必须先查证再下结论；不得编造未查到的内容。')
  const messages = userMessageFor(opts.userText)
  let rounds = 0
  let converged = false
  let capped = false
  let output = ''
  let reasoningAll = ''
  let error = null
  let lastFinish = null
  const deadline = Date.now() + (opts.budgetMs || LOOP_BUDGET_MS)
  for (let round = 1; round <= maxRounds + 1; round += 1) {
    const useTools = round <= maxRounds && Date.now() < deadline
    const res = await streamWithTools(llm, selection, system, messages, useTools ? LOOP_TOOLS : undefined, TIER_SPECS.extreme.temperature, deadline - Date.now(), opts.externalSignal)
    rounds = round
    reasoningAll += res.reasoning
    output = res.text
    lastFinish = res.finish || lastFinish
    if (res.error) { error = res.error; break }
    if (!useTools && round > maxRounds) { converged = Boolean(res.text && res.text.trim()); break }
    if (!res.calls || res.calls.length === 0) break
    messages.push(...assistantToolCallMessage(res.calls, selection))
    const outputs = []
    for (const call of res.calls) {
      let args = {}
      try { args = JSON.parse(call.arguments || '{}') } catch { args = {} }
      const t0 = Date.now()
      let text = ''
      let ok = true
      try { text = executeReadOnlyTool(root, call.name, args) } catch (e) { ok = false; text = 'ERROR: ' + String(e) }
      const rec = { round, tool: call.name, args, ok, ms: Date.now() - t0, resultLines: String(text).split('\n').length, resultPreview: String(text).slice(0, 240) }
      trace.push(rec)
      outputs.push({ ok, text: String(text) })
    }
    messages.push(...toolResultMessages(res.calls, outputs))
    if (round === maxRounds) {
      capped = true
      messages.push(...userMessageFor('【系统】已达本次查证轮次上限，请立即用已获得的证据给出阶段性结论，不要再请求工具。'))
    }
  }
  // 只读范围负例：越界路径必须被拒
  let scopeProbe = null
  try { scopeProbe = { result: executeReadOnlyTool(root, 'read', { path: '../../../../etc/hosts' }) } } catch (e) { scopeProbe = { error: String(e) } }
  return { root, maxRounds, rounds, capped, converged, error, finish: lastFinish, trace, output, reasoningChars: reasoningAll.length, scopeProbe, selection, llmOk: Boolean(llm), assistantMessages: messages.filter((m) => m.role === 'assistant').length }
}

/** 小类 2.3 核验器：正常查证（行级可核对）+ 超限收敛 + 越界拒绝。 */
async function runToolLoopCheck(ctx, token, payload) {
  const resolved = resolveSessionCwd(ctx)
  const root = (payload && payload.root) || resolved.cwd
  const started = Date.now()
  const out = { token, root, sessionCwd: resolved, started }
  const block = renderContextBlock(collectProjectContext(root))
  const ask = (payload && payload.request) || '给这个插件的"发送拦截"再加一条放行规则。请先自己查清楚：现有判定逻辑写在哪个文件的哪些行、一共有几条放行分支、分别是什么，然后把查到的结论写进给下游 AI 的提示词里。'
  out.ask = ask
  // ① 正常查证（最多 3 轮）
  out.normal = await runToolLoop(ctx, { root, maxRounds: 3, userText: (block ? block + '\n\n' : '') + ask })
  // 抽取产出中的 文件:行号 引用，并回读真实行内容
  const citeRx = /((?:[\w.@-]+\/)*[\w.@-]+\.(?:jsonl|json|mjs|cjs|tsx|ts|js|yaml|yml|md|css|html))(?![A-Za-z0-9])(?::(\d+))?/g
  const seen = new Set()
  const citations = []
  let match = citeRx.exec(out.normal.output)
  while (match && citations.length < 20) {
    const key = match[1] + ':' + (match[2] || '')
    if (!seen.has(key)) {
      seen.add(key)
      const abs = resolveInsideRoot(root, match[1])
      let exists = false
      let lineText = null
      if (abs && existsSync(abs)) {
        exists = true
        if (match[2]) {
          try { lineText = (readFileSync(abs, 'utf8').split('\n')[Number(match[2]) - 1] || '').trim().slice(0, 160) } catch { lineText = null }
        }
      }
      citations.push({ cite: match[1] + (match[2] ? ':' + match[2] : ''), fileExists: exists, lineText })
    }
    match = citeRx.exec(out.normal.output)
  }
  out.citations = citations
  out.citationStats = { total: citations.length, fileExists: citations.filter((c) => c.fileExists).length, withLine: citations.filter((c) => c.lineText !== null).length }
  // ② 超限收敛（上限 2 轮，故意给一个"要读很多文件"的请求）
  out.capped = await runToolLoop(ctx, {
    root,
    maxRounds: 2,
    userText: '请把这个项目里的每一个源码文件都读一遍，逐个说明它的作用和风险，然后据此给下游 AI 写一份完备提示词。',
  })
  out.totalMs = Date.now() - started
  ensureDir()
  writeFileSync(join(EVIDENCE, 'tool-loop.json'), JSON.stringify(out, null, 2))
  const md = []
  md.push('# 只读工具循环 · 核验')
  md.push('')
  md.push('- 项目根：`' + root + '` · 上限轮次：正常 3 / 超限 2 · 总耗时 ' + out.totalMs + 'ms')
  md.push('- 越界负例：`read ../../../../etc/hosts` → ' + JSON.stringify(out.normal.scopeProbe))
  md.push('')
  md.push('## ① 正常查证')
  md.push('')
  md.push('- 实际轮次 ' + out.normal.rounds + ' · 工具调用 ' + out.normal.trace.length + ' 次 · 产出 ' + out.normal.output.length + ' 字 · error=' + out.normal.error)
  md.push('')
  md.push('| # | 轮 | 工具 | 参数 | 耗时 | 结果行数 |')
  md.push('|---|---|---|---|---|---|')
  out.normal.trace.forEach((t, i) => md.push('| ' + (i + 1) + ' | ' + t.round + ' | ' + t.tool + ' | `' + JSON.stringify(t.args) + '` | ' + t.ms + 'ms | ' + t.resultLines + ' |'))
  md.push('')
  md.push('### 产出中的 文件:行号 引用 · 逐条回读核对')
  md.push('')
  md.push('| 引用 | 文件存在 | 该行真实内容 |')
  md.push('|---|---|---|')
  for (const c of citations) md.push('| `' + c.cite + '` | ' + (c.fileExists ? '✅' : '❌') + ' | ' + (c.lineText === null ? '（未给行号）' : '`' + c.lineText.replace(/\|/g, '\\|') + '`') + ' |')
  md.push('')
  md.push('## ② 超限收敛')
  md.push('')
  md.push('- rounds=' + out.capped.rounds + ' · converged=' + out.capped.converged + ' · 工具调用 ' + out.capped.trace.length + ' 次 · 产出 ' + out.capped.output.length + ' 字 · error=' + out.capped.error)
  md.push('')
  md.push('```markdown')
  md.push(String(out.capped.output || '').trim().slice(0, 2000))
  md.push('```')
  writeFileSync(join(EVIDENCE, 'tool-loop.md'), md.join('\n'))
  return out
}

/* ══════════════ 三项取值落盘（小类 4.2：档位/权限/模型） ══════════════ */
const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'prompt-optimizer.json')
function sanitizeUi(ui) {
  if (!ui || typeof ui !== 'object') return null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
  const w = num(ui.w); const h = num(ui.h); const x = num(ui.x); const y = num(ui.y)
  const out = {}
  if (w !== null) out.w = Math.min(1600, Math.max(320, w))
  if (h !== null) out.h = Math.min(1200, Math.max(220, h))
  if (x !== null) out.x = Math.max(0, x)
  if (y !== null) out.y = Math.max(0, y)
  return Object.keys(out).length ? out : null
}
/** 按会话的档位/权限（只保留最近 N 个会话，避免无限增长）。 */
const TIER_IDS = new Set(['off', 'basic', 'advanced', 'extreme'])
const PERMISSION_IDS = new Set(['review', 'auto'])
const PER_SESSION_CAP = 40
function sanitizePerSession(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const id of Object.keys(raw).slice(-PER_SESSION_CAP)) {
    const v = raw[id]
    if (!v || typeof v !== 'object') continue
    const entry = {}
    if (typeof v.tier === 'string' && TIER_IDS.has(v.tier)) entry.tier = v.tier
    if (typeof v.permission === 'string' && PERMISSION_IDS.has(v.permission)) entry.permission = v.permission
    if (Object.keys(entry).length > 0) out[id] = entry
  }
  return out
}
function loadPluginState() {
  const raw = readJson(STATE_FILE, null)
  return {
    tier: raw && typeof raw.tier === 'string' ? raw.tier : 'basic',
    permission: raw && typeof raw.permission === 'string' ? raw.permission : 'review',
    model: raw && raw.model && raw.model.provider && raw.model.model ? raw.model : null,
    ui: sanitizeUi(raw && raw.ui),
    turns: raw && typeof raw.turns === 'number' ? Math.max(0, Math.min(HISTORY_TURNS_MAX, Math.round(raw.turns))) : HISTORY_TURNS_DEFAULT,
    historyMode: normalizeHistoryMode(raw && raw.historyMode),
    fullOn: raw && raw.fullOn === true,
    perSession: sanitizePerSession(raw && raw.perSession),
    revision: raw && typeof raw.revision === 'number' ? raw.revision : 0,
  }
}
let settingsScope = null
let settingsStatus = 'not-initialized'
function initSettingsNamespace(ctx) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const req = createRequire(join(home, 'profiles', 'web', 'package.json'))
    const zod = req('zod')
    const z = zod.z || zod.default || zod
    const settings = ctx.get('settings')
    if (!settings || typeof settings.register !== 'function') { settingsStatus = 'no-settings-service'; return settingsStatus }
    const schema = z.object({
      tier: z.string().default('basic'),
      permission: z.string().default('review'),
      model: z.object({ provider: z.string(), model: z.string(), name: z.string().optional() }).nullable().default(null),
      ui: z.object({ w: z.number().optional(), h: z.number().optional(), x: z.number().optional(), y: z.number().optional() }).nullable().optional(),
    })
    settingsScope = settings.register('prompt-optimizer', schema)
    settingsStatus = 'registered'
  } catch (error) {
    settingsStatus = 'error: ' + String(error)
  }
  return settingsStatus
}
function mirrorToSettings(patch) {
  try {
    if (!settingsScope || typeof settingsScope.update !== 'function') { settingsStatus = settingsStatus + ' (mirror-skipped)'; return }
    void settingsScope.update(patch)
    settingsStatus = 'registered+mirrored'
  } catch (error) {
    settingsStatus = 'registered (mirror-error: ' + String(error) + ')'
  }
}
function savePluginState(patch) {
  const cur = loadPluginState()
  // 按会话记录：客户端上报 {tier, permission, sessionId} 时，写进该会话自己的槽位；
  // 顶层 tier/permission 仍作为"新会话的默认值"保留，兼容旧文件。
  const perSession = Object.assign({}, cur.perSession)
  const sid = typeof patch.sessionId === 'string' && patch.sessionId ? patch.sessionId : null
  if (sid) {
    const entry = Object.assign({}, perSession[sid])
    if (typeof patch.tier === 'string') entry.tier = patch.tier
    if (typeof patch.permission === 'string') entry.permission = patch.permission
    if (Object.keys(entry).length > 0) perSession[sid] = entry
  }
  const next = {
    tier: typeof patch.tier === 'string' ? patch.tier : cur.tier,
    permission: typeof patch.permission === 'string' ? patch.permission : cur.permission,
    model: patch.model === undefined ? cur.model : (patch.model && patch.model.provider && patch.model.model ? { provider: patch.model.provider, model: patch.model.model, name: patch.model.name || patch.model.model } : null),
    ui: patch.ui === undefined ? cur.ui : (patch.ui === null ? null : (sanitizeUi(Object.assign({}, cur.ui || {}, patch.ui)) || cur.ui)),
    turns: typeof patch.turns === 'number' ? Math.max(0, Math.min(HISTORY_TURNS_MAX, Math.round(patch.turns))) : cur.turns,
    historyMode: patch.historyMode === undefined ? cur.historyMode : normalizeHistoryMode(patch.historyMode),
    fullOn: patch.fullOn === undefined ? cur.fullOn : patch.fullOn === true,
    perSession: sanitizePerSession(perSession),
    revision: cur.revision + 1,
    updatedAt: Date.now(),
  }
  try { writeFileSync(STATE_FILE, JSON.stringify(next, null, 2)) } catch { /* best effort */ }
  mirrorToSettings({ tier: next.tier, permission: next.permission, model: next.model, ui: next.ui })
  return next
}

/* ══════════════ 方向化重跑（小类 2.4：方向参数 / 版本对照 / 重跑隔离 / 回退） ══════════════ */
const optSessions = new Map()
let optSeq = 0
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

function createOptSession(tier, request, sessionId, cwd) {
  optSeq += 1
  const session = {
    id: 'opt' + optSeq, sessionId: sessionId || null, tier, request, cwd,
    versions: [], current: 0, status: 'idle', abort: null, inFlight: 0, created: Date.now(),
  }
  optSessions.set(session.id, session)
  return session
}

function buildDirectionBlock(direction, prevText) {
  const parts = []
  if (prevText) parts.push('【上一版产出（在其基础上调整，保留其中合理的内容）】\n' + String(prevText).slice(0, 3000))
  if (direction) parts.push('【本次重跑方向】' + direction + '\n要求：新版必须明确体现该方向；与上一版冲突时以本方向为准，但不得新增用户没提过的新需求。')
  return parts.length === 0 ? '' : '\n\n' + parts.join('\n\n')
}

function rollbackOpt(session) {
  if (session && session.abort) {
    session.abort.abort()
    session.status = 'rolled-back'
    return { requested: true }
  }
  if (session) session.status = 'rolled-back'
  return { requested: false }
}

async function streamOnceWithSignal(ctx, spec, userText, signal) {
  const llm = ctx.get('llm')
  let selection = null
  try { const def = ctx.get('agentDefaultModel'); if (def) selection = def.currentSelection() } catch { /* fall through */ }
  if (!selection || !selection.provider) selection = lastRoute
  return streamWithTools(llm, selection, spec.system, userMessageFor(userText), undefined, spec.temperature, LOOP_BUDGET_MS, signal)
}

async function runVersion(ctx, session, direction) {
  const spec = TIER_SPECS[session.tier] || TIER_SPECS.advanced
  const prev = session.versions.length > 0 ? session.versions[session.versions.length - 1] : null
  const collect = collectProjectContext(session.cwd)
  const block = collect.degraded ? null : renderContextBlock(collect)
  const userText = (block ? block + '\n\n' : '') + '用户需求：' + session.request + buildDirectionBlock(direction, prev ? prev.text : null)
  const ac = new AbortController()
  session.abort = ac
  session.status = 'running'
  session.inFlight += 1
  const t0 = Date.now()
  let text = ''
  let reasoning = ''
  let error = null
  try {
    if (session.tier === 'extreme') {
      const loop = await runToolLoop(ctx, { root: session.cwd, maxRounds: 2, userText, externalSignal: ac.signal })
      text = loop.output || ''
      error = loop.error || null
    } else {
      const res = await streamOnceWithSignal(ctx, spec, userText, ac.signal)
      text = res.text || ''
      reasoning = res.reasoning || ''
      error = res.error || null
    }
  } catch (error_) {
    error = String(error_)
  } finally {
    session.inFlight -= 1
  }
  const aborted = ac.signal.aborted
  const entry = {
    n: session.versions.length + 1,
    direction: direction || null,
    aborted,
    ms: Date.now() - t0,
    chars: text.length,
    error,
    reasoningChars: reasoning.length,
    text,
  }
  if (!aborted) {
    session.versions.push(entry)
    session.current = entry.n
  }
  session.abort = null
  if (!aborted) session.status = 'idle'
  return entry
}

function hashText(text) {
  let h = 0
  const s = String(text || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 2147483647
  return 'h' + h.toString(36) + '-len' + s.length
}

function directionMetric(kind, text) {
  const body = String(text || '')
  if (kind === 'concise') return { kind, chars: body.length }
  if (kind === 'concrete') return { kind, criteriaWords: (body.match(/判据|验收|必须|至少|不低于|可观察|可检查/g) || []).length }
  return { kind, hasUndoneList: /没做|不做|未新增|没有做|刻意未/.test(body) }
}

/** 小类 2.4 核验器：方向生效 + 版本不变 + 会话隔离 + 回退无残留。 */
async function runRerunCheck(ctx, token, payload) {
  const resolved = resolveSessionCwd(ctx)
  const cwd = (payload && payload.cwd) || resolved.cwd
  const request = (payload && payload.request) || '把那个页面弄好看点，动画也加上，顺手把数据那块也修一下'
  const tier = (payload && payload.tier) || 'advanced'
  const out = { token, tier, request, cwd, started: Date.now(), steps: [] }
  const A = createOptSession(tier, request, resolved.sessionId, cwd)
  const B = createOptSession(tier, request, (resolved.sessionId || '') + ':B', cwd)
  const v1 = await runVersion(ctx, A, null)
  const b1 = await runVersion(ctx, B, null)
  const v1HashBefore = hashText(v1.text)
  const b1HashBefore = hashText(b1.text)
  out.baseline = {
    A: { id: A.id, n: v1.n, ms: v1.ms, chars: v1.chars, error: v1.error },
    B: { id: B.id, n: b1.n, chars: b1.chars, error: b1.error },
  }
  const directions = [
    { kind: 'preset', label: '预设·更简洁', metric: 'concise', text: '更简洁：删掉冗余与重复，长度明显缩短，但保留全部可执行要点。' },
    { kind: 'preset', label: '预设·更具体', metric: 'concrete', text: '更具体：每个要点都补上可验收的判据（可观察、可检查）。' },
    { kind: 'free', label: '自由输入·最小改动', metric: 'minimal', text: '按"最小改动优先"重写，并在末尾列出你刻意没有做的事。' },
  ]
  let prevChars = v1.chars
  for (const d of directions) {
    const v = await runVersion(ctx, A, d.text)
    out.steps.push({
      label: d.label, kind: d.kind, direction: d.text, n: v.n, ms: v.ms, chars: v.chars,
      aborted: v.aborted, error: v.error, metric: directionMetric(d.metric, v.text),
      deltaCharsVsPrev: v.chars - prevChars,
      head: v.text.slice(0, 240),
    })
    prevChars = v.chars
  }
  out.versionTable = A.versions.map((v) => ({ n: v.n, direction: v.direction ? v.direction.slice(0, 40) : null, chars: v.chars, ms: v.ms, hash: hashText(v.text) }))
  out.immutable = { v1HashBefore, v1HashAfter: hashText(A.versions[0].text), same: v1HashBefore === hashText(A.versions[0].text) }
  out.isolation = {
    Aversions: A.versions.length, Bversions: B.versions.length,
    Acurrent: A.current, Bcurrent: B.current,
    bHashBefore: b1HashBefore, bHashAfter: hashText(B.versions[0].text),
    BHashSame: b1HashBefore === hashText(B.versions[0].text),
  }
  const pending = runVersion(ctx, A, '（回退测试）把整段改写成七言绝句')
  await sleepMs(1600)
  const before = { versions: A.versions.length, inFlight: A.inFlight, status: A.status, current: A.current }
  const rb = rollbackOpt(A)
  const abortedEntry = await pending
  await sleepMs(400)
  out.rollback = {
    requested: rb.requested,
    before,
    after: { versions: A.versions.length, inFlight: A.inFlight, status: A.status, current: A.current },
    abortedEntry: { n: abortedEntry.n, aborted: abortedEntry.aborted, ms: abortedEntry.ms, chars: abortedEntry.chars, error: abortedEntry.error },
  }
  out.totalMs = Date.now() - out.started
  ensureDir()
  writeFileSync(join(EVIDENCE, 'rerun-check.json'), JSON.stringify(out, null, 2))
  const md = []
  md.push('# 方向化重跑 · 核验')
  md.push('')
  md.push('- 档位 `' + tier + '` · 需求：' + request)
  md.push('- 基线 A：' + out.baseline.A.chars + ' 字 / ' + out.baseline.A.ms + 'ms · 基线 B（独立会话）：' + out.baseline.B.chars + ' 字')
  md.push('')
  md.push('| 版本 | 方向 | 字数 | Δ字数 | 方向度量 | 耗时 |')
  md.push('|---|---|---|---|---|---|')
  md.push('| v1 | （基线） | ' + out.baseline.A.chars + ' | - | - | ' + out.baseline.A.ms + 'ms |')
  for (const s of out.steps) md.push('| v' + s.n + ' | ' + s.label + ' | ' + s.chars + ' | ' + (s.deltaCharsVsPrev >= 0 ? '+' : '') + s.deltaCharsVsPrev + ' | ' + JSON.stringify(s.metric) + ' | ' + s.ms + 'ms |')
  md.push('')
  md.push('- 版本不变性：v1 哈希前后一致 = ' + out.immutable.same + '（' + out.immutable.v1HashBefore + '）')
  md.push('- 会话隔离：A 版本数 ' + out.isolation.Aversions + ' / B 版本数 ' + out.isolation.Bversions + ' · B 哈希不变 = ' + out.isolation.BHashSame)
  md.push('- 回退：' + JSON.stringify(out.rollback))
  md.push('')
  md.push('## 各版本产出（首段，供肉眼对照方向是否生效）')
  md.push('')
  for (const s of out.steps) {
    md.push('### v' + s.n + ' · ' + s.label)
    md.push('')
    md.push('```markdown')
    md.push(String(s.head || '').trim())
    md.push('```')
    md.push('')
  }
  writeFileSync(join(EVIDENCE, 'rerun-check.md'), md.join('\n'))
  return out
}

/* ══════════════ 实时流（小类 3.2：思考/产出分通道，SSE 推给浮层） ══════════════ */
const liveRuns = new Map()
let liveSeq = 0

function publishRun(run, event) {
  if (event.type === 'reasoning-delta') {
    if (run.firstDeltaMs === null) run.firstDeltaMs = Date.now() - run.startedAt
    run.reasoning += event.text
  } else if (event.type === 'text-delta') {
    if (run.firstDeltaMs === null) run.firstDeltaMs = Date.now() - run.startedAt
    run.text += event.text
  } else if (event.type === 'usage') {
    // 逐次覆盖（provider 常在末尾给全量）；同时累加累计值供展示
    const raw = event.usage !== undefined ? event.usage : event.text
    let parsed = null
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { parsed = null }
    if (parsed && typeof parsed === 'object') {
      run.usage = parsed
      run.usageAt = Date.now()
    }
  } else if (event.type === 'aborted') {
    run.status = 'aborted'
  } else if (event.type === 'error') {
    run.status = 'error'
    run.error = event.message
  } else if (event.type === 'done') {
    run.status = 'done'
  }
  const line = 'data: ' + JSON.stringify(event) + '\n\n'
  for (const sub of [...run.subs]) {
    try { sub.write(line) } catch { run.subs.delete(sub) }
  }
}

function closeRunSubs(run) {
  for (const sub of [...run.subs]) {
    try { sub.end() } catch { /* noop */ }
  }
  run.subs.clear()
}

async function executeLiveRun(ctx, run) {
  const spec = TIER_SPECS[run.tier] || TIER_SPECS.basic
  const llm = ctx.get('llm')
  let selection = null
  try { const def = ctx.get('agentDefaultModel'); if (def) selection = def.currentSelection() } catch { /* fall through */ }
  if (!run.provider || !run.model) { const st = loadPluginState(); if (st.model) { run.provider = st.model.provider; run.model = st.model.model } }
  if (run.provider && run.model) selection = { provider: run.provider, model: run.model }
  if (run.forceError) selection = { provider: 'dpo-invalid-provider', model: 'dpo-invalid-model' }
  if (!selection || !selection.provider) selection = lastRoute
  if (selection) { run.provider = selection.provider; run.model = selection.model || null }
  try {
    const digest = collectDialogueDigest(ctx, run.sessionId, run.turns, run.historyMode)
    const historyBlock = renderHistoryBlock(digest)
    if (digest) {
      run.history = { mode: digest.mode || run.historyMode || 'turns', source: digest.source || null, rawEvents: digest.rawEvents === undefined ? null : digest.rawEvents, rawUsers: digest.rawUsers === undefined ? null : digest.rawUsers, dropped: digest.dropped === undefined ? null : digest.dropped, turns: digest.turns, userTurns: digest.userTurns || 0, chars: digest.chars || 0, omittedTurns: digest.omittedTurns || 0, budget: digest.budget || null, degraded: digest.degraded === true, reason: digest.reason || null }
      publishRun(run, { type: 'history', history: run.history })
    }
    const userMsg = relayMessage(run.request, run.direction || null, run.prevText || null, historyBlock)
    const res = await streamWithTools(
      llm, selection, buildSystem(run.tier, { historyMode: run.historyMode }), userMsg, undefined, spec.temperature, 60000, run.abort.signal,
      (type, text) => publishRun(run, { type, text }),
    )
    if (run.abort.signal.aborted) publishRun(run, { type: 'aborted' })
    else if (res.error) publishRun(run, { type: 'error', message: res.error })
    else publishRun(run, { type: 'done', ms: Date.now() - run.startedAt, firstDeltaMs: run.firstDeltaMs, usage: run.usage || (res && res.usage) || null })
  } catch (error) {
    publishRun(run, { type: 'error', message: String(error) })
  } finally {
    closeRunSubs(run)
  }
}

function startLiveRun(ctx, opts) {
  liveSeq += 1
  const st = loadPluginState()
  const histMode = normalizeHistoryMode(opts.historyMode === undefined || opts.historyMode === null ? st.historyMode : opts.historyMode)
  const fullOn = opts.fullOn === undefined || opts.fullOn === null ? st.fullOn === true : opts.fullOn === true
  const run = {
    id: 'run' + liveSeq,
    sessionId: opts.sessionId || null,
    tier: opts.tier || st.tier,
    request: String(opts.request || ''),
    turns: histMode === 'full' ? HISTORY_TURNS_MAX : Math.max(0, Math.min(HISTORY_TURNS_MAX, Math.round(Number(opts.turns === undefined || opts.turns === null ? st.turns : opts.turns) || 0))),
    historyMode: histMode === 'full' && !fullOn ? 'off' : histMode,
    direction: opts.direction ? String(opts.direction) : null,
    prevText: opts.prevText ? String(opts.prevText) : null,
    forceError: opts.forceError === true,
    provider: opts.provider || null,
    model: opts.model || null,
    status: 'running',
    reasoning: '',
    text: '',
    error: null,
    startedAt: Date.now(),
    firstDeltaMs: null,
    abort: new AbortController(),
    subs: new Set(),
  }
  liveRuns.set(run.id, run)
  void executeLiveRun(ctx, run)
  return run
}

async function runTierCompare(ctx, token) {

  const llm = ctx.get('llm')
  let selection = null
  try {
    const def = ctx.get('agentDefaultModel')
    if (def) selection = def.currentSelection()
  } catch { /* fall through */ }
  if (!selection || !selection.provider) selection = lastRoute
  const started = Date.now()
  const out = { token, request: COMPARE_REQUEST, selection, started, runs: [] }
  if (!llm || !selection || !selection.provider) {
    out.error = 'no-llm-route'
    writeFileSync(join(EVIDENCE, 'tier-compare.json'), JSON.stringify(out, null, 2))
    return out
  }
  for (const tier of ['basic', 'advanced', 'extreme']) {
    const spec = TIER_SPECS[tier]
    for (const round of [1, 2]) {
      const t0 = Date.now()
      let reasoning = ''
      let text = ''
      let usage = null
      let finish = null
      let error = null
      optimizerCallDepth += 1
      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          system: spec.system,
          temperature: spec.temperature,
          messages: userMessageFor(COMPARE_REQUEST),
        })
        for await (const chunk of stream) {
          if (chunk.type === 'reasoning-delta') reasoning += chunk.text
          else if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'usage') usage = chunk.usage
          else if (chunk.type === 'finish') finish = chunk.reason
        }
      } catch (error_) {
        error = String(error_)
      } finally {
        optimizerCallDepth -= 1
      }
      out.runs.push({
        tier, label: spec.label, round,
        ms: Date.now() - t0,
        reasoningChars: reasoning.length,
        textChars: text.length,
        headings: headingsOf(text),
        usage,
        finish,
        error,
        reasoning: reasoning.slice(0, 4000),
        text,
      })
    }
  }
  out.totalMs = Date.now() - started
  ensureDir()
  writeFileSync(join(EVIDENCE, 'tier-compare.json'), JSON.stringify(out, null, 2))
  const md = []
  md.push('# 三档产出对照 · ' + COMPARE_REQUEST)
  md.push('')
  md.push('- 模型：`' + selection.provider + '/' + selection.model + '` · token=' + token + ' · 总耗时 ' + out.totalMs + 'ms')
  md.push('')
  for (const tier of ['basic', 'advanced', 'extreme']) {
    const runs = out.runs.filter((r) => r.tier === tier)
    md.push('## ' + TIER_SPECS[tier].label + '（' + tier + '）')
    md.push('')
    md.push('| 轮次 | 耗时 | 思考字数 | 产出字数 | 结构标题 |')
    md.push('|---|---|---|---|---|')
    for (const r of runs) md.push('| ' + r.round + ' | ' + r.ms + 'ms | ' + r.reasoningChars + ' | ' + r.textChars + ' | `' + r.headings + '` |')
    md.push('')
    md.push('### 产出（第 1 轮）')
    md.push('')
    md.push('```markdown')
    md.push(((runs[0] || {}).text || '(无)').trim())
    md.push('```')
    md.push('')
  }
  writeFileSync(join(EVIDENCE, 'tier-compare.md'), md.join('\n'))
  return out
}

const START_URL = import.meta.url
const PKG_NAME = '@dsh-external/dsh-prompt-optimizer'
const resolveTrail = []

/** 自定位插件根：从模块真实落点向上找到属于本包的 package.json（不依赖目录层数假设）。 */
function findRoot(startUrl) {
  let dir = dirname(fileURLToPath(startUrl))
  for (let i = 0; i < 6; i += 1) {
    resolveTrail.push(dir)
    try {
      if (existsSync(join(dir, 'package.json'))) {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (pkg && pkg.name === PKG_NAME) return dir
      }
    } catch { /* keep walking */ }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const ROOT = findRoot(START_URL)
  || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins', 'dsh-prompt-optimizer')
const EVIDENCE = join(ROOT, 'evidence')
const CMD_FILE = join(EVIDENCE, 'cmd.json')
/** 探针命令的有效期：超过即作废（陈旧命令在页面刷新后会"复活"并劫持用户会话）。 */
const CMD_TTL_MS = 10 * 60 * 1000
/** 模型目录缓存：反复开弹层不再重扫 provider；单家超时避免被一个连不上的 provider 拖死。 */
const CATALOG_TTL_MS = 30 * 1000
const CATALOG_PROVIDER_TIMEOUT_MS = 2500
let catalogCache = null
const REPORT_FILE = join(EVIDENCE, 'selftest-report.json')
const EVENTS_FILE = join(EVIDENCE, 'host-events.jsonl')
const API_PATH = '/prompt-optimizer/api'

function ensureDir() {
  try { mkdirSync(EVIDENCE, { recursive: true }) } catch { /* ignore */ }
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return fallback }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (chunk) => { buf += chunk })
    req.on('end', () => resolve(buf))
    req.on('error', () => resolve(''))
  })
}

function sweepInbox(ctx, match) {
  const agents = ctx.get('agents')
  const removed = []
  for (const agent of (agents ? agents.list() : [])) {
    const inbox = agent.inbox || {}
    for (const target of ['nextTurn', 'nextStep']) {
      for (const message of [...(inbox[target] || [])]) {
        const text = Array.isArray(message.content)
          ? message.content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
          : ''
        if (!match || !text.includes(match)) continue
        try {
          agent.inbox.remove(message.id)
          removed.push({ sessionId: String(agent.id), target, id: String(message.id), text: text.slice(0, 90) })
        } catch (error) {
          removed.push({ sessionId: String(agent.id), id: String(message.id), error: String(error) })
        }
      }
    }
  }
  return removed
}

export function apply(ctx) {
  ensureDir()
  initSettingsNamespace(ctx)
  const events = []
  let cmdHits = 0

  // 记录主模型路由（优化器自身调用不覆盖它）；供优化器默认选用同一模型
  ctx.effect(() => {
    const off = ctx.on('llm/stream', (options, next) => {
      try {
        if (optimizerCallDepth === 0 && options && options.provider) {
          lastRoute = { provider: options.provider, model: options.model }
        }
      } catch { /* best effort */ }
      return next()
    })
    return () => { if (typeof off === 'function') off() }
  }, 'prompt-optimizer: main route tap')

  // 看门狗：每 1.2s 清扫一次登记的匹配串，直到过期（默认 60s）；同时轮询命令通道触发三档对照
  let lastCompareToken = null
  let lastContextToken = null
  let lastLoopToken = null
  let lastRerunToken = null
  ctx.effect(() => {
    const stop = ctx.setInterval(() => {
      // 开机兜底：清掉任何残留的 DPO- 标记待处理项（防探针被中断后留下痕迹）
      try {
        const removed = sweepInbox(ctx, 'DPO-')
        if (removed.length > 0) {
          try { appendFileSync(EVENTS_FILE, JSON.stringify({ t: Date.now(), bootSweep: 'DPO-', removed }) + '\n') } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
      const now = Date.now()
      for (const [match, expiresAt] of [...sweepWatches]) {
        if (expiresAt < now) { sweepWatches.delete(match); continue }
        const removed = sweepInbox(ctx, match)
        if (removed.length > 0) {
          try { appendFileSync(EVENTS_FILE, JSON.stringify({ t: now, watchdog: match, removed }) + '\n') } catch { /* best effort */ }
        }
      }
      const cmd = readJson(CMD_FILE, null)
      if (cmd && cmd.run === 'tier-compare' && cmd.token && cmd.token !== lastCompareToken) {
        lastCompareToken = cmd.token
        void runTierCompare(ctx, cmd.token).catch((error) => {
          try { writeFileSync(join(EVIDENCE, 'tier-compare-error.json'), String(error)) } catch { /* noop */ }
        })
      }
      if (cmd && cmd.run === 'rerun-check' && cmd.token && cmd.token !== lastRerunToken) {
        lastRerunToken = cmd.token
        void runRerunCheck(ctx, cmd.token, cmd).catch((error) => {
          try { writeFileSync(join(EVIDENCE, 'rerun-check-error.json'), String(error)) } catch { /* noop */ }
        })
      }
      if (cmd && cmd.run === 'tool-loop-check' && cmd.token && cmd.token !== lastLoopToken) {
        lastLoopToken = cmd.token
        void runToolLoopCheck(ctx, cmd.token, cmd).catch((error) => {
          try { writeFileSync(join(EVIDENCE, 'tool-loop-error.json'), String(error)) } catch { /* noop */ }
        })
      }
      if (cmd && cmd.run === 'context-check' && cmd.token && cmd.token !== lastContextToken) {
        lastContextToken = cmd.token
        void runContextCheck(ctx, cmd.token, cmd).catch((error) => {
          try { writeFileSync(join(EVIDENCE, 'context-check-error.json'), String(error)) } catch { /* noop */ }
        })
      }
    }, 1200)
    return () => { if (typeof stop === 'function') stop() }
  }, 'prompt-optimizer: watchdog + tier trigger')

  // 宿主侧权威记录：会话日志里真正落库的 user/message（探针窗口内应为 0 条）
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try { projectSessionEvent(projectionOf(session && session.id), event) } catch { /* 投影是尽力而为，失败不影响会话 */ }
    })
    return () => { if (typeof off === 'function') off() }
  }, 'prompt-optimizer: history projection')

  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        if (event.type !== 'user/message') return
        const data = event.data || {}
        const text = Array.isArray(data.content)
          ? data.content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ')
          : ''
        const rec = {
          t: Date.now(),
          sessionId: String(session.id),
          text: String(text).slice(0, 240),
          rpcId: data.source && data.source.rpcId ? String(data.source.rpcId) : null,
        }
        events.push(rec)
        if (events.length > 400) events.shift()
        appendFileSync(EVENTS_FILE, JSON.stringify(rec) + '\n')
      } catch { /* recorder is best-effort */ }
    })
    return () => { if (typeof off === 'function') off() }
  }, 'prompt-optimizer: host user/message recorder')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const url = String(req.url || '')
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        if (url.includes('/cmd')) {
          cmdHits += 1
          let raw = null
          let readError = null
          let ageMs = null
          let expired = false
          try {
            const st = statSync(CMD_FILE)
            ageMs = Date.now() - st.mtimeMs
            // 一次性 + 过期即失效：陈旧命令绝不能在用户会话里"复活"（曾导致探针自动劫持用户会话）
            if (ageMs > CMD_TTL_MS) expired = true
            raw = readFileSync(CMD_FILE, 'utf8')
          } catch (error) { readError = String(error && error.code ? error.code : error) }
          let cmd = null
          try { cmd = raw === null ? null : JSON.parse(raw) } catch { cmd = null }
          if (expired && cmd && cmd.run) {
            try { writeFileSync(CMD_FILE, JSON.stringify({ run: null, expiredFrom: cmd.token || cmd.run, expiredAt: Date.now() }, null, 2)) } catch { /* best effort */ }
            try { appendFileSync(EVENTS_FILE, JSON.stringify({ t: Date.now(), cmdExpired: cmd.token || cmd.run, ageMs }) + '\n') } catch { /* best effort */ }
            cmd = null
          }
          return send(200, {
            ok: true,
            host: '@dsh-external/dsh-prompt-optimizer',
            ts: Date.now(),
            cmd,
            cmdAgeMs: ageMs,
            cmdTtlMs: CMD_TTL_MS,
            cmdExpired: expired,
            recorded: events.length,
            cmdHits,
            diag: { startUrl: START_URL, trail: resolveTrail, root: ROOT, cmdFile: CMD_FILE, raw: raw === null ? null : raw.trim(), readError, exists: existsSync(CMD_FILE) },
          })
        }
        if (url.includes('/queued/remove-by-text')) {
          const body = await readBody(req)
          let payload = {}
          try { payload = JSON.parse(body || '{}') } catch { payload = {} }
          const match = String(payload.match || '')
          const removed = sweepInbox(ctx, match)
          // 不在此处挂看门狗：会让"是否进入官方队列"的取证与清扫互相竞态；
          // 统一由探针收尾的 /inbox/sweep 挂 'DPO-' 看门狗兜底（覆盖晚到插入）。
          if (payload.watch === true && match) sweepWatches.set(match, Date.now() + 60000)
          return send(200, { ok: true, match, removed, watching: payload.watch === true })
        }
        if (url.includes('/stream')) {
          const runId = decodeURIComponent((url.split('runId=')[1] || '').split('&')[0] || '')
          const run = liveRuns.get(runId)
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
          if (!run) { res.write('data: ' + JSON.stringify({ type: 'error', message: 'run-not-found: ' + runId }) + '\n\n'); res.end(); return }
          res.write('data: ' + JSON.stringify({ type: 'snapshot', status: run.status, reasoning: run.reasoning, text: run.text, error: run.error, firstDeltaMs: run.firstDeltaMs, usage: run.usage || null }) + '\n\n')
          if (run.status === 'running') {
            run.subs.add(res)
            req.on('close', () => { run.subs.delete(res) })
          } else {
            res.end()
          }
          return
        }
        if (url.includes('/state')) {
          if (req.method === 'POST') {
            const body = await readBody(req)
            let patch = {}
            try { patch = JSON.parse(body || '{}') } catch { patch = {} }
            const saved = savePluginState(patch)
            return send(200, { ok: true, state: saved, file: STATE_FILE })
          }
          return send(200, { ok: true, state: loadPluginState(), file: STATE_FILE, settings: settingsStatus })
        }
        if (url.includes('/models')) {
          const llm = ctx.get('llm')
          let def = null
          try { const d = ctx.get('agentDefaultModel'); if (d) def = d.currentSelection() } catch { /* fallthrough */ }
          const force = /[?&]force=1/.test(url)
          const now = Date.now()
          // 缓存 + 并行 + 单家超时：任何一家连不上都不能拖慢整张清单（曾经 ollama 会把整表卡住）
          if (!force && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
            return send(200, { ok: true, current: def || lastRoute || null, groups: catalogCache.groups, cached: true, ageMs: now - catalogCache.at, builtMs: catalogCache.builtMs })
          }
          const t0 = Date.now()
          const providers = llm && typeof llm.listProviders === 'function' ? llm.listProviders() : []
          const withTimeout = (p) => new Promise((resolve) => {
            let settled = false
            const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ p, models: [], timeout: true }) } }, CATALOG_PROVIDER_TIMEOUT_MS)
            Promise.resolve()
              .then(() => (llm && typeof llm.listModels === 'function' ? llm.listModels(p.id) : []))
              .then((models) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ p, models: Array.isArray(models) ? models : [] }) } })
              .catch((error) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ p, models: [], error: String(error && error.message ? error.message : error).slice(0, 120) }) } })
          })
          const settledList = await Promise.all(providers.map(withTimeout))
          const groups = settledList.map(({ p, models, timeout, error }) => ({
            id: p.id, name: p.name || p.id,
            models: models.map((m) => ({ id: m.id, name: m.name || m.id })),
            degraded: timeout === true || Boolean(error),
            note: timeout === true ? 'timeout' : (error || null),
          }))
          const builtMs = Date.now() - t0
          if (groups.length > 0) catalogCache = { at: Date.now(), groups, builtMs }
          return send(200, { ok: true, current: def || lastRoute || null, groups, cached: false, builtMs, degraded: groups.filter((g) => g.degraded).map((g) => g.id) })
        }
        if (url.includes('/runs')) {
          const runs = [...liveRuns.values()].map((r) => ({ id: r.id, status: r.status, subs: r.subs.size, chars: (r.text || '').length, reasoningChars: (r.reasoning || '').length, ms: r.startedAt ? Date.now() - r.startedAt : null, aborted: r.abort ? r.abort.signal.aborted : null, error: r.error, provider: r.provider, model: r.model, tier: r.tier, turns: r.turns, history: r.history || null, direction: r.direction || null, version: r.version || null, usage: r.usage || null, reasoningTokens: r.usage ? (r.usage.reasoningTokens || r.usage.reasoning || null) : null, request: String(r.request || '').slice(0, 120), text: String(r.text || '').slice(0, 4000) }))
          return send(200, { ok: true, runs })
        }
        if (url.includes('/run/abort')) {
          const body = await readBody(req)
          let payload = {}
          try { payload = JSON.parse(body || '{}') } catch { payload = {} }
          const run = liveRuns.get(String(payload.runId || ''))
          if (!run) return send(200, { ok: false, error: 'run-not-found' })
          try { run.abort.abort() } catch { /* noop */ }
          publishRun(run, { type: 'aborted' })
          closeRunSubs(run)
          return send(200, { ok: true, runId: run.id, status: run.status, aborted: run.abort.signal.aborted, subs: run.subs.size })
        }
        if (url.includes('/run')) {
          const body = await readBody(req)
          let payload = {}
          try { payload = JSON.parse(body || '{}') } catch { payload = {} }
          const run = startLiveRun(ctx, payload)
          return send(200, { ok: true, runId: run.id, tier: run.tier, forceError: run.forceError })
        }
        if (url.includes('/trace')) {
          // 查证 trace：供浮层消费（小类 2.3 交付"可消费的 trace"，可视渲染属 3.x）
          const last = readJson(join(EVIDENCE, 'tool-loop.json'), null)
          return send(200, {
            ok: true,
            root: last ? last.root : null,
            normal: last && last.normal ? last.normal.trace : [],
            capped: last && last.capped ? last.capped.trace : [],
            normalRounds: last && last.normal ? last.normal.rounds : null,
            cappedRounds: last && last.capped ? last.capped.rounds : null,
            converged: last && last.capped ? last.capped.converged : null,
          })
        }
        if (url.includes('/commands')) {
          const agents = ctx.get('agents')
          const commands = ctx.get('commands')
          const first = agents ? agents.list()[0] : undefined
          let list = []
          try { list = first && commands ? commands.list(first).map((c) => ({ name: c.name, description: c.description })) : [] } catch (error) { list = [{ error: String(error) }] }
          return send(200, { ok: true, sessionId: first ? String(first.id) : null, commands: list })
        }
        if (url.includes('/watch/clear')) {
          const n = sweepWatches.size
          sweepWatches.clear()
          return send(200, { ok: true, cleared: n })
        }
        if (url.includes('/inbox/sweep')) {
          const removed = sweepInbox(ctx, 'DPO-')
          sweepWatches.set('DPO-', Date.now() + 60000)
          return send(200, { ok: true, removed, watching: true })
        }
        if (url.includes('/inbox')) {
          const agents = ctx.get('agents')
          const list = agents ? agents.list() : []
          const view = list.map((agent) => {
            const inbox = agent.inbox || {}
            const pick = (rows) => (rows || []).map((m) => ({
              id: String(m.id),
              text: Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ').slice(0, 120) : '',
            }))
            return { sessionId: String(agent.id), nextTurn: pick(inbox.nextTurn), nextStep: pick(inbox.nextStep) }
          })
          return send(200, { ok: true, sessions: view })
        }
        if (url.includes('/queued/remove')) {
          const body = await readBody(req)
          let payload = {}
          try { payload = JSON.parse(body || '{}') } catch { payload = {} }
          const agents = ctx.get('agents')
          const agent = agents ? agents.get(payload.sessionId) : undefined
          if (!agent) return send(200, { ok: false, error: 'agent-not-found', sessionId: payload.sessionId })
          try {
            agent.inbox.remove(payload.itemId)
            return send(200, { ok: true, itemId: payload.itemId })
          } catch (error) {
            return send(200, { ok: false, error: String(error) })
          }
        }
        if (url.includes('/beacon')) {
          const body = await readBody(req)
          ensureDir()
          appendFileSync(join(EVIDENCE, 'client-beacon.jsonl'), String(body) + '\n')
          return send(200, { ok: true })
        }
        if (url.includes('/events')) return send(200, { ok: true, events })
        if (url.includes('/report')) {
          const body = await readBody(req)
          let report = {}
          try { report = JSON.parse(body || '{}') } catch { report = { parseError: true } }
          const from = Number(report.windowStart || 0)
          const to = Number(report.windowEnd || Date.now())
          const inWindow = events.filter((e) => e.t >= from && e.t <= to)
          report.host = {
            userMessagesInWindow: inWindow,
            userMessageCount: inWindow.length,
            totalRecorded: events.length,
            evidenceFile: REPORT_FILE,
          }
          ensureDir()
          writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
          appendFileSync(join(EVIDENCE, 'selftest-reports.jsonl'), JSON.stringify(report) + '\n')
          // 一次性：报告落盘即消费该命令，任何刷新/重载都不会再自动重跑探针
          if (report.kind === 'selftest' || report.kind === 'selftest-error') {
            try { writeFileSync(CMD_FILE, JSON.stringify({ run: null, consumed: report.token || null, consumedAt: Date.now() }, null, 2)) } catch { /* best effort */ }
          }
          return send(200, { ok: true, file: REPORT_FILE, userMessageCount: inWindow.length, cmdConsumed: report.kind === 'selftest' || report.kind === 'selftest-error' })
        }
        return send(404, { ok: false, error: 'unknown path: ' + url })
      } catch (error) {
        return send(500, { ok: false, error: String(error) })
      }
    },
  }), 'prompt-optimizer: selftest api')

  ctx.logger?.info?.('[dsh-prompt-optimizer] host ready @ ' + API_PATH + ' (evidence: ' + EVIDENCE + ')')
}
