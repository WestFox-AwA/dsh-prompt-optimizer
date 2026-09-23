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
//   ② **绝不自我触发**：投递本身也是一条 `user/message`（0.1.6 写作 `source.kind === 'plugin'`，
//      0.1.7 起改由生产者自报 kind，见 ADR-0087）。
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
  // 只认 kind === 'user'。插件投递（0.1.6 是 'plugin'、0.1.7 起是 'plugin:<包名>'，见 ADR-0087）
  // / 'skill-catalog' / 其它一律排除——这是**正向白名单**，所以换了名字也不会漏。
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

/**
 * 曾经这里写死过 `['web','headless','tui']`。**已撤**（EV-0121）：
 * 宿主实际发行 **5** 个 profile 模板——`acp / web / headless / sdk / sdk-minimal`
 * （`@deepseek-ai/dsh-app-boot` 的 `PROFILE_TEMPLATES`）——
 * 而写死的清单里少了 `acp` / `sdk` / `sdk-minimal`，还多了一个根本不存在的 `tui`。
 * 后果与 EV-0081 修掉的那个缺陷**一模一样**（只是换了个触发方式）：
 * `dsh sdk …` 解析不出 profile ⇒ 退回 `web` ⇒ 插件去查 **`profiles/web` 的清单**，
 * 而进程跑的是 `sdk` ⇒ 双重拦截守卫可能给出**相反**的结论（该拒的放行、该放的拒绝）。
 * ⇒ 判据不再靠清单，而是**靠现实**：位置参数里哪一个**真的是 profile 目录**。
 * 清单会随产品漂移，文件系统不会。
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 从 argv 里挑出**位置参数**（跳过 `-x` / `--flag` 及其取值，并跳过 argv 前导的
 * `(可执行文件, 脚本路径)` 两项——`process.argv` 的固定形状）。
 * 没有宿主级 flag 规格，所以按最通行的约定：`-`/`--` 开头的视为 flag；
 * 不含 `=` 的 flag 顺带吃掉下一个参数（那通常是它的取值）。
 */
function positionalArgs(args) {
  // argv 前导：`[node, /path/to/bin.js, …]`。只在**看起来确实是**前导时才跳，
  // 这样 `['sdk','任务']` 这种"只有参数"的数组（测试/离线分析）不会被误跳。
  const looksLikePrologue = args.length >= 2
    && (/node(\.exe)?$/i.test(args[0]) || /[\\/]/.test(args[0]) || /\.(js|mjs|cjs)$/i.test(args[1]))
  const out = []
  for (let i = looksLikePrologue ? 2 : 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('-')) {
      if (!a.includes('=') && i + 1 < args.length && !args[i + 1].startsWith('-')) i += 1
      continue
    }
    out.push(a)
  }
  return out
}

/**
 * 解析**当前到底跑在哪个 profile 上**。
 *
 * 为什么需要（EV-0081）：旧插件探测的静态一路写死了 `profiles/web`，
 * 于是在 headless / 自建 profile 下，它查的是**另一个 profile 的清单**——
 * 结论看着有、其实答的不是那个问题。这类"查错对象"的缺陷不会报错，只会给错答案。
 *
 * 纯函数：不读文件、不看真实 process。`profileExists` 由调用方注入。
 * @param argv          进程参数（`--profile X` / `--profile=X` / 裸子命令 `web`）
 * @param profileExists (name) => boolean；**位置参数形式必须靠它校验**（见上面的说明）
 * @returns {{name:string, source:'argv'|'subcommand'|'default'|'fallback', requested:string|null}}
 */
export function resolveProfileName({ argv = [], profileExists } = {}) {
  const args = Array.isArray(argv) ? argv.map(String) : []
  let requested = null
  let source = null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--profile' && i + 1 < args.length) { requested = args[i + 1]; source = 'argv'; break }
    if (a.startsWith('--profile=')) { requested = a.slice('--profile='.length); source = 'argv'; break }
  }
  if (!requested) {
    // 裸子命令形式：`dsh web` 等价于 `--profile web`。**按"它真的是不是 profile"判定**，
    // 不按清单判定。注入不了 profileExists 的纯调用方（测试/离线分析）退化为"第一个候选词"。
    const positions = positionalArgs(args).filter((a) => PROFILE_NAME_RE.test(a))
    const canCheck = typeof profileExists === 'function'
    const hit = canCheck ? positions.find((p) => { try { return profileExists(p) } catch { return false } }) : positions[0]
    if (hit) { requested = hit; source = 'subcommand' }
  }
  if (!requested) return { name: 'web', source: 'default', requested: null }
  if (typeof profileExists === 'function' && !profileExists(requested)) {
    return { name: 'web', source: 'fallback', requested }
  }
  return { name: requested, source, requested }
}
