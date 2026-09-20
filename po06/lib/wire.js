// P8 · **生产接线**（A15）：真实用户输入 → 解释 → 编译 → 动态上下文
//
// 为什么需要这个文件（EV-0078）：0.6 曾经在真实会话里**贡献 0 字符**——
// 意图状态 / 澄清 / 编译 / 投递整条链在生产路径上**不可达**：
// `setIntentText(<真实包>)` 只有一个上游，而它只被**自检**调用（还传桩解释器）。
// 于是 346 项测试全绿，产品却一次都没跑过。
//
// 本文件的存在就是为了让"**生产侧调用点**"变成可指认的东西（ADR-0038 的 A15）。
//
// 三条设计约束（都来自实测，不是偏好）：
//   ① **零延迟**（用户选择）：不在 `system-prompt/assemble` 里等待，绝不拖慢首步。
//      代价是包从**第 2 步**起才在上下文里；单步任务（一次答完）拿不到包。
//      这是明知的取舍，写在这里以免日后被误当成 bug。
//   ② **绝不自我触发**：投递本身也是一条 `user/message`（`source.kind === 'plugin'`）。
//      若不过滤来源，就会"包触发解释、解释产出新包"，形成自激循环。
//      所以只认 `source.kind === 'user'`——这是防循环的第一道也是唯一一道闸。
//   ③ **拿不到模型就不解释**：宁可这一轮不投递，也不编造一个没有依据的包。
//
// 纯函数模块：不读文件、不读时间、不调 LLM、不碰 ctx。全部逻辑可确定性测试。

/** 真正来自**人**的用户输入。插件/技能目录等一律不算。 */
export function isRealUserInput(event) {
  if (!event || event.type !== 'user/message') return false
  const d = event.data
  if (!d || !d.source) return false
  // 只认 kind === 'user'。'plugin'（我们自己的包！）/ 'skill-catalog' / 其它一律排除。
  return d.source.kind === 'user'
}

/** 取用户输入的纯文本（只取 text 块）。 */
export function extractUserText(event) {
  const d = event && event.data
  const content = d && d.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n')
}

/** 消息 id。**必需**：它同时是幂等键（advance_turn）与因果 id，缺了就不能安全推进轮次。 */
export function extractMessageId(event) {
  const d = event && event.data
  const id = d && d.id
  return typeof id === 'string' && id ? id : null
}

/**
 * 从会话事件里读出**宿主自己**正在用的 provider/model。
 * 这是解释层最合理的默认来源：与工作 AI 同模型，不需要用户额外配置，
 * 也不会出现"解释用 A 模型、执行用 B 模型"这种难以归因的组合。
 */
export function extractObservedModel(event) {
  if (!event) return null
  const d = event.data
  if (!d) return null
  if (event.type === 'request/header') {
    const c = d.header && d.header.config
    if (c && typeof c.provider === 'string' && typeof c.model === 'string') {
      return { provider: c.provider, model: c.model }
    }
    return null
  }
  if (event.type === 'request/context') {
    if (typeof d.provider === 'string' && typeof d.model === 'string') {
      return { provider: d.provider, model: d.model }
    }
  }
  return null
}

/**
 * 解释层该用哪个模型。**显式配置优先**，否则用宿主观测到的。
 * 都拿不到 ⇒ 不解释（`ok:false`），不猜、不留空 provider 去撞服务端报错。
 */
export function resolveInterpreterCfg({ config, observed } = {}) {
  const c = config && config.interpreter
  if (c && typeof c.provider === 'string' && c.provider && typeof c.model === 'string' && c.model) {
    return { ok: true, provider: c.provider, model: c.model, source: 'config' }
  }
  if (observed && typeof observed.provider === 'string' && typeof observed.model === 'string'
    && observed.provider && observed.model) {
    return { ok: true, provider: observed.provider, model: observed.model, source: 'observed' }
  }
  return { ok: false, reason: 'no-model-route' }
}

/**
 * 本轮到底解不解释。**把所有跳过原因集中在一处**，这样"什么都没发生"永远能说清是为什么——
 * 静默跳过正是 EV-0078 那种事故的温床。
 * @returns {{ok:boolean, reason:string}}
 */
export function decideInterpret({ isUserInput, text, gateEnabled, cfg, llmAvailable }) {
  if (!isUserInput) return { ok: false, reason: 'not-user-input' }
  if (!text) return { ok: false, reason: 'empty-text' }
  if (gateEnabled !== true) return { ok: false, reason: 'gate-disabled' }
  if (!llmAvailable) return { ok: false, reason: 'llm-unavailable' }
  if (!cfg || cfg.ok !== true) return { ok: false, reason: (cfg && cfg.reason) || 'no-model-route' }
  return { ok: true, reason: 'ok' }
}
