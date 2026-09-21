// dsh-prompt-optimizer 0.6 · 宿主适配层（DshAdapter）
//
// 职责边界：
//   ① 把「当前意图包文本」注册成动态上下文，由**宿主**负责合并/排序/去重（EV-0014）。
//   ② 提供不唤醒的投递：plugin 来源消息 → agent.inject（ADR-0012 的默认档）。
//   ③ 唤醒式投递单独一个方法，且**只允许调用方在已授权场景下使用**（本原型不主动调用它）。
//   ④ **生产触发**（A15）：真实用户输入 → 解释层（唯一 LLM 调用）→ reducer → 编译 → 写上下文。
//      见本文件下方的 `runProductionInput` 与 wire.js。
//
// 明确不做：不做质量展开、不注册路由、不写用户会话内容。
//
// ⚠ 本条曾经写着"**不调用 LLM、不解析用户输入**"——那是 P1 阶段的边界，
//   后来 P2–P5 把解释/编译全实现好了，**但没人把它们接到生产路径上**，
//   于是产品在真实会话里贡献 0 字符（EV-0078）。注释与代码一起过期，是这次事故的一部分：
//   读到"本模块不调用 LLM"的人，没有理由再去问"那谁调用它？"。
//
// 两条 P1-6 实测教训（都写进了实现）：
//   · `ctx.inject` 的回调**不是同步执行**的 → 必须 await 就绪信号，不能假定服务立即可用。
//   · 动态上下文是**全局注册**的：只要文本非空，就会进入**所有**会话（含用户正在用的那个）
//     → 静默待命时文本必须为空（空文本被宿主聚合渲染过滤掉），只在确有内容时才置非空。
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { HOLDOUT_SEAL } from './eval-plan.js'
import {
  createStats, createProjectionDefinition, commitPatch, PROJECTION_KEY, STATE_EVENT,
} from './projection.js'
import { recordUserInput } from './reducer.js'
import { createState } from './schema.js'
import { handleUserInput } from './pipeline.js'
import { SYSTEM_PROMPT, buildUserMessage } from './interpreter.js'
import { drain } from './eval-llm.js'
import { createStateStore, inheritStateForFork } from './store.js'
import {
  isRealUserInput, extractUserText, extractMessageId, extractObservedModel,
  resolveInterpreterCfg, decideInterpret, resolveProfileName,
} from './wire.js'
import { verifyHtmlFile } from './verifier-html.js'
import { loadLlmLib } from './llm-lib.js'
import { registerControlApi, resolvePrompt } from './control-api.js'
import { readPolicy } from './policy.js'
import { runGate, createMemoryLedgerStore, LEVEL, resolveLevel } from './gate.js'
import { detectOldPluginRuntime, mergeOldPluginSignals } from './detect-old.js'
import { decideEnabled } from './rollout.js'
import {
  createEnableGate, parseEnableIntent, resolveEnableDecision, toActiveTriState, PENDING,
  pickEnableIntent, resolveEnableConfigPath, legacyEnableConfigPath,
} from './assembly-gate.js'

// ── 路径常量 ────────────────────────────────────────────────────────
// DSH_HOME 必须**先**定义：下面几个路径都由它派生。
// 用户的 0.6 配置。**读不到就按不启用**（保守方向）——启用必须是显式成立的。
// 回退链：DSH_HOME → USERPROFILE → HOME → os.homedir()。**不写字面用户名**：
// 原先最后一档是写死的一个 Windows 家目录字面量，在 USERPROFILE 未设的环境
// （部分 CI / 服务账号）里会把状态写到**作者的**路径上去（EV-0132）。
const DSH_HOME = process.env.DSH_HOME
  || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh')

// 报告目录**跟着 DSH_HOME 走**（EV-0084）。
// 旧写法把它硬编码成真实 home 的绝对路径，后果有两个，都是实测到的：
//   ① 单测调用 apply() 会把报告写进**真实**证据目录——变异检验跑一遍就是上百份垃圾
//      （实测该目录里 1532 份报告中有 1530 份来自单测）；
//   ② 隔离实例与日常实例的报告**混在同一个目录**，"这份证据是哪个 home 产出的"只能靠猜。
// 现在：真实 home → <home>/po06-reports；隔离实例 → 它自己的；单测 → 临时目录（自动清理）。
const EVIDENCE_DIR = process.env.DSH_PO06_EVIDENCE_DIR || join(DSH_HOME, 'po06-reports')
const CONTEXT_NAME = 'prompt-optimizer:intent'
// order 取 9100：排在宿主与其它插件（110–362 段）之后，使意图包出现在聚合快照靠后位置。
const CONTEXT_ORDER = 9100
// 宿主 llm 模块（消息构造函数所在）的定位**不再写死路径**：见 llm-lib.js 顶部（EV-0132）。
// 原先这里是一条本机绝对路径，别人的机器上投递必然失败、自检因此报"未通过"。
// 自检开关：环境变量或标记文件（后者可在运行期通过"创建文件 + 热重载"触发）
//
// ⚠ **这些开关与自检工作目录一律跟着 DSH_HOME 走**（EV-0101）。
// 原先全部硬编码成真实 home 的绝对路径，后果与 EV-0084 的证据目录同源：
//   ① 在隔离实例里开一个自检，**读的是真实 home 的 flag**，写的是**真实 home 的工作目录**；
//   ② 反过来，真实实例也可能被隔离实例留下的 flag 意外触发。
// 自检本身只在显式开 flag 时运行，但"路径写错家"会让**隔离验证失去意义**。
const SCRATCH_DIR = join(DSH_HOME, 'po06-scratch')
const flag = (name) => join(SCRATCH_DIR, name)
const SELFCHECK_FLAG = flag('run-selfcheck.flag')
const SELF_CHECK = process.env.DSH_PO06_SELFCHECK === '1' || existsSync(SELFCHECK_FLAG)
// P2 自检开关（投影接线 / CAS / 调用量实测）
const P2CHECK_FLAG = flag('run-p2check.flag')
const P2_CHECK = process.env.DSH_PO06_P2CHECK === '1' || existsSync(P2CHECK_FLAG)
// P3 自检开关（流水线接进真实宿主：状态走真实投影，意图包走真实 systemPrompt.context）
const P3CHECK_FLAG = flag('run-p3check.flag')
const P3_CHECK = process.env.DSH_PO06_P3CHECK === '1' || existsSync(P3CHECK_FLAG)
// P6 自检开关（交付门真实链路）
const P6CHECK_FLAG = flag('run-p6check.flag')
const P6_CHECK = process.env.DSH_PO06_P6CHECK === '1' || existsSync(P6CHECK_FLAG)
// P8 自检开关（旧插件运行时探测 / 启动闸门）
const P8CHECK_FLAG = flag('run-p8check.flag')
const P8_CHECK = process.env.DSH_PO06_P8CHECK === '1' || existsSync(P8CHECK_FLAG)
// P8b 自检开关（装配期启用闸门**接线**验证：默认抑制 / 强制放行两侧对照）
const P8BCHECK_FLAG = flag('run-p8bcheck.flag')
const P8B_CHECK = process.env.DSH_PO06_P8BCHECK === '1' || existsSync(P8BCHECK_FLAG)
// E-001 正式运行的入口开关（EV-0087）。**预算必须显式给出**且不得低于上界（否则 runE001 拒绝）。
// 先用小额度单单元跑通链路：
//   DSH_PO06_E001=1 DSH_PO06_E001_ONLY=H-12 DSH_PO06_E001_ARMS=A DSH_PO06_E001_RUNS=1 DSH_PO06_E001_BUDGET=105048
const E001_FLAG = join(DSH_HOME, 'run-e001.flag')
const E001_CHECK = process.env.DSH_PO06_E001 === '1' || existsSync(E001_FLAG)
// P7 冒烟运行器：**会真的调用模型**，所以由显式 flag **且** spec 文件双条件触发；
// 两者缺一就什么都不做——不会有人"不小心"花掉一笔模型调用。
const SMOKE_FLAG = flag('run-smoke.flag')
const SMOKE_SPEC = process.env.DSH_PO06_SMOKE_SPEC || flag('smoke-spec.json')
const SMOKE_CHECK = process.env.DSH_PO06_SMOKE === '1' || existsSync(SMOKE_FLAG)
// 交付门**生产触发**默认关闭：每次交付都启动浏览器是重操作，是否开启属于设置决策（P8）
const GATE_TRIGGER_FLAG = flag('enable-gate-trigger.flag')
const gateLedgers = createMemoryLedgerStore()
// apply 调用量统计（不进入持久状态）
const projectionStats = createStats()

// ── 装配期启用闸门的配置来源 ──────────────────────────────────────────
// 用户的 0.6 配置。**读不到就按不启用**（保守方向）——启用必须是显式成立的。
//
// ⚠ **0.6 不再与 0.5.x 共用 `prompt-optimizer.json`**（EV-0111）。
// 实测（用户真机）：那个文件是 **0.5.x 正在使用的设置**（`tier`/`strategy`/`ui`… 4.9KB）。
// 两者共用一个路径的后果是：**"想试试 0.6"的代价变成"弄坏你每天在用的插件"**——
// 而这个代价完全没必要，启用意图只是一个小 JSON。
// 所以 0.6 用自己的 `po06.json`（可用 `DSH_PO06_CONFIG` 覆盖）；
// 旧路径只做**只读回退**，且**必须带 0.6 标记**（`settingsVersion`）才算数——
// 0.5.x 的文件没有这个标记，因此永远不会被误读成"启用 0.6"（`not-a-0.6-config`）。
const ENABLE_CONFIG_PATH = resolveEnableConfigPath({ home: DSH_HOME, env: process.env })
const LEGACY_ENABLE_CONFIG_PATH = legacyEnableConfigPath(DSH_HOME)
// 当前 profile：**不能写死 web**（EV-0081）。旧插件静态探测查的是这个目录的清单，
// 写死就等于在别的 profile 下回答另一个 profile 的问题——不报错，只给错答案。
const PROFILE_RESOLVED = resolveProfileName({
  argv: process.argv,
  profileExists: (n) => { try { return existsSync(join(DSH_HOME, 'profiles', n)) } catch { return false } },
})
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE_RESOLVED.name)
// 生产接线的**写入台账**（A15 的证据来源）。
// 为什么必须有：EV-0078 的教训是"什么都不发生"时**查不出原因**——
// 插件安静地不做事，用户以为它开着。所以每次用户输入都要留一条**判定结果**，
// 无论解释成没成。按 DSH_HOME 落盘，隔离实例的台账与日常的分开。
const WIRE_LOG_PATH = join(DSH_HOME, 'po06-wire.jsonl')

/** 追加一条生产接线记录。**尽力而为**：台账写不进去也绝不打断会话。 */
function appendWireLog(rec) {
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    writeFileSync(WIRE_LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n',
      { encoding: 'utf8', flag: 'a' })
  } catch { /* best effort */ }
}

/**
 * 解释层默认用的模型：取**宿主自己**正在用的那个（从会话事件里观测）。
 *
 * 两级：**本会话**观测到的优先；没有则用最近一次在**任何**会话里观测到的。
 * 为什么要全局那一级：宿主在**第一条**用户消息之后才发出 `request/header`，
 * 所以全新会话的第一轮是观测不到模型的——那一轮就会跳过解释。
 * 而实际部署里宿主通常只有一条已配置的 provider/model 路由，
 * 用最近观测到的真实路由，比"什么都不做"更符合用户预期，且**仍然是观测来的**、
 * 不是编造的（台账里 `cfgSource:'observed'` 可核）。
 * 说不清来源的模型一律不用——见 wire.js 的 resolveInterpreterCfg。
 */
const observedModelBySession = new Map()
let observedModel = null

function observeModel(sessionId, obs) {
  if (!obs) return
  if (sessionId) observedModelBySession.set(String(sessionId), obs)
  observedModel = obs
}

function modelFor(sessionId) {
  const own = sessionId ? observedModelBySession.get(String(sessionId)) : null
  return own || observedModel
}

/**
 * 还没解释的用户输入（每会话一条）。
 *
 * 为什么需要：宿主总是**先**发用户消息、**后**发 `request/header`，
 * 所以新会话的第一条消息在到达时还不知道该用哪个模型。旧行为是直接放弃这一轮；
 * 现在改成"记下来，等模型一出现立刻补跑"——包因此能落在**同一轮的第 2 步**，
 * 而不是整整晚一轮。
 * 只记**一条**：更新的用户输入会覆盖它（晚到的旧输入没有解释价值，且 reducer 的 CAS 也会拦）。
 */
const pendingInput = new Map()

/**
 * 把生产工作**推迟出事件派发窗口**再跑。
 *
 * 为什么必须这样做（真机实测，EV-0080）：宿主在派发会话事件时，该事件**正在被发布**
 * （append 未结束）。此时任何 `session.append` 都会被拒绝：
 *   `session append cannot reenter while another append is being published`
 * 我们这条链的第一步（初始化状态 / 记录输入 / 推进轮次）就是 append，
 * 所以**同步执行必然失败**——而且失败得很安静（只在台账里留一行 throw）。
 * 推迟到下一个宏任务即可：包不受影响（本来也只从第 2 步起生效）。
 */
function defer(fn) {
  try { setTimeout(() => { try { void fn() } catch { /* 台账已记 */ } }, 0) } catch { /* best effort */ }
}
/** 插件自己的配置（`apply(ctx, config)` 传入；cordis.patch.yml 里是 config: {}）。 */
let pluginConfig = {}

/**
 * 生产侧的解释调用：**一次**不带工具的补全，走宿主已装配的 LLM 服务。
 *
 * 与评估台的 `complete()` 的区别（有意为之）：这里用宿主自己提供的 `system` 槽
 * ——`GenerateOptions.system` 的文档写明"for one-shot callers"，
 * 正是我们这个场景；因此**不需要** import 宿主的 llm 模块（那条硬编码路径
 * 只适合本机评估台，不能进产品）。
 */
async function interpretViaLlm({ llm, cfg, userPrompt }) {
  const t0 = Date.now()
  // 解释层提示词：**用户覆盖优先**（`<home>/po06-prompt.md`），否则内置。
  // 接上这条之后，控制面板里的"保存提示词"才真的改变下一步行为；而 `packetFingerprint`
  // 已经哈希了提示词 ⇒ 改完提示词，意图包缓存会**自动失效重算**（EV-0137 / EV-0143）。
  const stream = llm.stream({
    provider: cfg.provider,
    model: cfg.model,
    system: resolvePrompt({ home: DSH_HOME }).text,
    messages: [{ role: 'user', content: [{ type: 'text', text: String(userPrompt) }] }],
  })
  return await drain(stream, t0)
}

/**
 * **生产触发**（A15）：一次真实用户输入 → 解释 → reducer → 编译 → 写上下文。
 *
 * 零延迟：调用方**不 await** 本函数。所以包从**第 2 步**起才在上下文里
 * （用户显式选择；见 wire.js 顶部说明）。任何失败都只记台账，不抛回会话。
 */
async function runProductionInput(ctx, session, message, { trigger = 'user-message' } = {}) {
  const sid = session && session.id !== undefined ? String(session.id) : ''
  const text = String(message && message.text != null ? message.text : '')
  const messageId = message && message.messageId ? message.messageId : null
  const base = { sessionId: sid, messageId, chars: text.length, trigger }

  try {
    // 用户设置 → 政策（EV-0143）：`assist: off` 就是"只记录、不补充"——
    // **不解释、不注入**（省一次模型调用），并在台账里留下可归因的理由。
    // 这一条让控制面板上那句"只记录、不补充"**真的**是那个意思。
    const pol = readPolicy({ home: DSH_HOME })
    if (!pol.injectPacket) {
      appendWireLog({ ...base, trigger, ok: false, reason: 'assist-off',
        policy: { assist: pol.assist, detail: pol.detail, budget: pol.budget } })
      return
    }

    // 闸门：与上下文贡献处**同一个判定**（ensure 带 TTL 缓存），避免"能解释但不能投递"
    const st = adapter.enableGate ? adapter.enableGate.ensure(sid) : PENDING
    const llm = ctx.get('llm')
    const cfg = resolveInterpreterCfg({ config: pluginConfig, observed: modelFor(sid) })
    const d = decideInterpret({
      // 来源已由**调用方**判定（订阅处只放真人输入进来）。这里恒为 true，
      // 否则"模型稍后才观测到"的补跑会被自己的来源检查挡掉。
      isUserInput: true,
      text,
      gateEnabled: st && st.enabled === true,
      cfg,
      llmAvailable: Boolean(llm && typeof llm.stream === 'function'),
    })
    // 模型还没观测到 ⇒ 记下这条待办：等 `request/header` 到达时**补跑**。
    // 这样包能落在**同一轮的第 2 步**，而不是白等一整轮（宿主总是先发用户消息、后发请求头）。
    if (d.reason === 'no-model-route' && messageId) {
      pendingInput.set(sid, { text, messageId })
    }
    // 记录闸门**码与理由**：`old-plugin-unknown` 这类保守拒绝如果只留一个码，
    // 用户会看到"插件装了却什么都不做"而查不出原因（EV-0078 的教训）。
    if (!d.ok) {
      appendWireLog({
        ...base, trigger, ok: false, reason: d.reason,
        gate: st && st.code, gateReason: (st && st.reason) || null,
        gateProbe: (st && st.probe) || null,
      })
      return
    }

    const t0 = Date.now()
    // 补充程度 → 意图包预算：pipeline 从 `adapter.packetBudget` 取（它本来就是这么设计的）。
    // 设置是**按 home** 的、不按会话，所以写在这里是安全的（不存在"两个会话各要不同预算"的情形）。
    adapter.packetBudget = pol.packetBudgetChars
    const out = await adapter.handleInput(session, {
      messageId,
      text,
      // 档位 → 行为（EV-0143）：补充程度决定意图包预算，自主预算决定一批最多问几个问题。
      // 两个口子都是 pipeline 里**本来就有**的（`budget` / `maxQuestions`），这里只是把它们接上设置。
      budget: pol.packetBudgetChars,
      maxQuestions: pol.maxQuestions,
      policy: pol,
      interpret: async ({ userText, state, sessionId, messageId: mid, observations }) => {
        const um = buildUserMessage({ userText, state, sessionId, messageId: mid, observations })
        const r = await interpretViaLlm({ llm, cfg, userPrompt: um })
        return r.text
      },
    })
    const st2 = adapter.intentStateOf ? adapter.intentStateOf(session) : null
    appendWireLog({
      ...base, trigger, ok: true, outcome: out.outcome, cfgSource: cfg.source,
      provider: cfg.provider, model: cfg.model, ms: Date.now() - t0,
      packetChars: out.packet && out.packet.ok ? out.packet.text.length : 0,
      packetOk: Boolean(out.packet && out.packet.ok),
      revision: st2 ? st2.revision : null,
      stateAfter: adapter.debugStateOf ? adapter.debugStateOf(session) : null,
      // 同一时刻用**从 agents 注册表取到的新 session 对象**再读一次：
      // 若这次能读到，说明问题出在"我手里这个 session 对象过期/换作用域"，
      // 而不是"注册没了"——两者的修法完全不同。
      stateViaAgent: (() => {
        try {
          const a = adapter.agentFor(sid)
          const s = a && (a.session || (typeof a.getSession === 'function' ? a.getSession() : null))
          if (!s) return { ok: false, reason: 'no-agent-session', agentKeys: a ? Object.keys(a).slice(0, 12) : null }
          return adapter.debugStateOf(s)
        } catch (e) { return { ok: false, reason: 'threw:' + String((e && e.message) || e) } }
      })(),
      trace: Array.isArray(out.trace) ? out.trace.map((s) => s.step + (s.ok === false ? ':fail' : '')) : null,
    })
  } catch (e) {
    appendWireLog({ ...base, trigger, ok: false, reason: 'threw:' + String((e && e.message) || e) })
  }
}

/**
 * 读启用意图；任何异常都不抛出，一律回落到保守值。
 *
 * 顺序：① 0.6 自己的配置文件 → ② 旧路径（只读回退）**且必须是"我们的"配置**。
 * 第 ② 步的 `ours` 检查是**安全关键**：0.5.x 的设置文件就在同一个旧路径上，
 * 没有 `settingsVersion` 标记，因此这里会判 `not-a-0.6-config` 并保持不启用。
 */
function readEnableIntent() {
  const readText = (p) => { try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null } }
  return pickEnableIntent(readText(ENABLE_CONFIG_PATH), readText(LEGACY_ENABLE_CONFIG_PATH))
}

/**
 * 解析某个会话的启用判定，并把探测结果映射成**三态**。
 * 注意 `toActiveTriState`：探测拿不到作用域时返回 null（不知道）→ 不启用，
 * 绝不把"没法判"当成"旧插件不在装"（ADR-0033）。
 */
async function decideEnableFor(agentId) {
  const intent = readEnableIntent()
  let active = null
  // 诊断明细：`old-plugin-unknown` 只在"探测没得出结论"时出现，
  // 而**没得出结论的原因**决定了该修什么（缺服务？缺 agent？assemble 抛错？）。
  // 只留一个 code 会让"装了却什么都不做"变成无法归因的谜（EV-0078/0079）。
  const probe = { agentId: String(agentId), hasSp: false, assemble: false, hasAgent: false,
    rt: null, staticActive: null, staticReason: null, agentsType: null, agentsGet: null,
    agentsCount: null, sidInRegistry: null }
  try {
    const agent = adapter.agentFor(agentId)
    const sp = adapter.services.systemPrompt
    probe.hasSp = Boolean(sp && typeof sp.assemble === 'function')
    probe.hasAgent = Boolean(agent)
    // agents 注册表本身的实况：`hasAgent:false` 可能是"服务没接上"、
    // 也可能是"这个 id 还不在注册表里"（时序）——两者要修的地方完全不同。
    const ag = adapter.services.agents
    probe.agentsType = typeof ag
    probe.agentsGet = ag ? typeof ag.get : 'n/a'
    try { probe.agentsCount = ag && typeof ag.list === 'function' ? ag.list().length : null } catch (e) { probe.agentsCount = 'threw' }
    try {
      probe.sidInRegistry = ag && typeof ag.list === 'function'
        ? ag.list().some((a) => a && String(a.id) === String(agentId))
        : null
    } catch { probe.sidInRegistry = 'threw' }
    if (sp && agent) {
      const rt = await detectOldPluginRuntime({ systemPrompt: sp, agent })
      probe.rt = { active: rt.active, confidence: rt.confidence, reason: rt.reason, evidence: rt.evidence }
      let st = null
      try {
        const { detectOldPluginStatic } = await import('./host-migrate.js')
        st = detectOldPluginStatic(PROFILE_DIR)
        probe.staticActive = st ? st.active : null
        probe.staticReason = (st && st.reason) || null
      } catch (e) { probe.staticReason = 'static-threw:' + String((e && e.message) || e) }
      active = toActiveTriState(mergeOldPluginSignals(rt, st))
    }
  } catch (e) {
    probe.threw = String((e && e.message) || e)
    active = null
  }
  const decision = resolveEnableDecision({ intent, sessionId: agentId, oldPluginActive: active })
  return { ...decision, probe }
}

export const name = '@dsh-external/dsh-po06'
/** 版本号从**随包发行的 package.json** 读，不写死（写死就会漂——本项目栽过这类跟头）。 */
const PKG_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version } catch { return null }
})()

class DshAdapter {
  constructor() {
    // **按会话隔离**：意图包文本是 per-session 的。
    // 早期版本用一个全局字符串，会让 A 会话的意图泄漏进 B 会话（违反隔离不变量）。
    // `systemPrompt.context` 的 text(context) 能拿到 `context.agent`，据此取会话 id。
    this.intentBySession = new Map()
    // 意图状态的**权威**在本插件手里（内存 + 自己的存储），不再经会话日志/投影（EV-0081）。
    this.stateBySession = new Map()
    this.stateStore = null
    // 上下文提供者抛错时的去重表（EV-0102）：同一会话同一错误只记一次台账
    this.contextErrors = new Map()
    this.contextDisposer = null
    this.services = { agents: null, sessionController: null, systemPrompt: null, sessionProjections: null }
    this.readyResolvers = []
    this.ready = new Promise((resolve) => this.readyResolvers.push(resolve))
    this.projectionDisposer = null
    this.projectionResolvers = []
    this.projectionReady = new Promise((resolve) => this.projectionResolvers.push(resolve))
  }

  markReady() {
    const rs = this.readyResolvers
    this.readyResolvers = []
    for (const r of rs) { try { r() } catch { /* best effort */ } }
  }

  /** 投影就绪信号（与 systemPrompt 的就绪分开，避免一个慢服务拖住另一个）。 */
  markProjectionReady() {
    const rs = this.projectionResolvers
    this.projectionResolvers = []
    for (const r of rs) { try { r() } catch { /* best effort */ } }
  }

  async waitProjectionReady(timeoutMs = 3000) {
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    const r = await Promise.race([this.projectionReady.then(() => true), timeout])
    if (timer) clearTimeout(timer)
    return r === true
  }

  /**
   * 读某会话的意图状态。**由插件自己拥有**（EV-0081）：内存优先，首次访问时从
   * 插件自己的存储按会话 id 载入，载不到返回 `null`（=尚无状态）。
   *
   * 为什么不再从投影读：投影是**日志的派生视图**，而我们的状态来自模型输出、
   * 不由日志推导；宿主契约原文写着持久化的投影行
   * "is never authoritative, only a fold shortcut"。而把状态写进会话日志这条路
   * 对第三方插件根本不存在（见 store.js 顶部三条）。所以状态的权威在**我们这里**。
   */
  intentStateOf(session) {
    const sid = session && session.id !== undefined ? String(session.id) : ''
    if (!sid) return null
    if (this.stateBySession.has(sid)) return this.stateBySession.get(sid)
    let loaded = this.stateStore ? this.stateStore.load(sid) : null
    // **状态文件读不出来时不许静默从头开始**（EV-0122）：
    // `load()` 把"真的没有"与"文件坏了 / 形状不对"折成同一个 `null`，而下游会把 `null`
    // 当成"尚无状态" ⇒ 新建空状态 ⇒ **`save()` 覆盖掉那份坏文件** ⇒
    // 用户积累的长期约束**静默消失，连证据都没了**。
    // 所以这里先 `inspect()` 分清楚：读不出来就（①）**隔离留证据**、（②）**留一条台账**
    // （原因 + 原路径 + 残骸路径），然后才按"从头开始"继续。
    if (!loaded && this.stateStore && typeof this.stateStore.inspect === 'function') {
      const diag = this.stateStore.inspect(sid)
      if (diag.present && !diag.ok) {
        const quarantined = typeof this.stateStore.quarantine === 'function' ? this.stateStore.quarantine(sid) : null
        this.stateUnreadable = (this.stateUnreadable || 0) + 1
        try {
          appendWireLog({
            sessionId: sid, ok: false, trigger: 'state-unreadable',
            reason: diag.reason, path: diag.path, quarantined,
          })
        } catch { /* best effort */ }
      }
    }
    // **分叉继承**（EV-0091）：宿主分叉会给出新的 sessionId，状态按 id 存 ⇒ 不处理就是"静默无状态"。
    // 只在**首次触达且自己没有状态**时继承；父会话没有状态就照常从头开始（不报错）。
    if (!loaded && session && session.header && session.header.parentSession) {
      const pid = String(session.header.parentSession)
      const parentState = this.stateStore ? this.stateStore.load(pid) : null
      const inherited = inheritStateForFork(parentState, sid, pid)
      if (inherited) {
        loaded = inherited
        try { if (this.stateStore) this.stateStore.save(sid, inherited) } catch { /* 下次再存 */ }
        try { appendWireLog({ sessionId: sid, ok: true, trigger: 'fork-inherit', inheritedFrom: pid, revision: inherited.revision }) } catch { /* best effort */ }
      }
    }
    this.stateBySession.set(sid, loaded)   // 载不到也记下来（null），避免每次访问都读盘
    return loaded
  }

  /** 诊断用：状态来源与规模（不参与任何判定）。 */
  debugStateOf(session) {
    const sid = session && session.id !== undefined ? String(session.id) : ''
    const v = this.intentStateOf(session)
    return {
      ok: true,
      store: this.stateStore ? this.stateStore.dir : null,
      kind: v === null ? 'null' : typeof v,
      revision: v && v.revision !== undefined ? v.revision : null,
      items: v && Array.isArray(v.items) ? v.items.length : null,
      sid: sid || null,
    }
  }

  /**
   * **唯一**的状态落盘出口。所有会改状态的地方都必须经这里——
   * 之前 `commitUserInput` 自己调了一次 `session.append`，就成了绕过纪律的旁路（EV-0081）。
   */
  land(session, state) {
    const sid = session && session.id !== undefined ? String(session.id) : ''
    if (!sid) return { ok: false, code: 'NO_SESSION', reason: 'session.id required' }
    this.stateBySession.set(sid, state)
    const r = this.stateStore ? this.stateStore.save(sid, state) : { ok: true }
    if (r && r.ok === false) return { ok: false, code: 'PERSIST_FAILED', reason: r.reason || null }
    return { ok: true, state }
  }

  /**
   * 提交候选 patch：CAS → reducer → **落进插件自己的存储**。
   * 不经会话日志（那会让宿主拒绝重建会话，EV-0081）。
   */
  commit(session, patch) {
    return commitPatch({
      session,
      currentState: this.intentStateOf(session),
      patch,
      persist: (s, state) => this.land(s, state),
    })
  }

  /**
   * 记录一次用户输入（推进 lastInputRevision，使在途候选作废）。
   *
   * ⚠ 这里**曾经直接** `session.append(STATE_EVENT, next)`，绕过了 `commitPatch`——
   * 于是"生产路径不写会话日志"这条纪律被一个**旁路**破坏了（EV-0081 的反回归测试当场抓到）。
   * 现在统一走 `this.land()`：唯一的落盘出口。
   */
  commitUserInput(session, { messageId }) {
    const cur = this.intentStateOf(session)
    if (!cur) return { ok: false, code: 'NO_BASE_STATE' }
    const next = recordUserInput(cur, { messageId })
    return this.land(session, next)
  }

  /** 新建一个空意图状态（经 reducer 的权威路径提交，避免绕过闸门）。 */
  initIntent(session, { taskId }) {
    const sid = String(session.id)
    return this.commit(session, {
      causeId: 'init',
      baseRevision: 0,
      sessionId: sid,
      taskId: taskId || 'default',
      ops: [{ op: 'set_phase', phase: 'idle' }],
    })
  }

  /**
   * 产品入口：处理一次用户输入（解释 → 提交 → 编译 → 写入动态上下文）。
   * `interpret` 是**注入**的解释函数；真实实现接 LLM，测试/自检传桩。
   */
  async handleInput(session, { messageId, text, interpret, observations, taskId }) {
    const agents = this.services.agents
    if (!agents || typeof agents.get !== 'function') {
      return { outcome: 'no-agents-service', trace: [] }
    }
    return handleUserInput(this, session, { messageId, text, interpret, observations, taskId })
  }

  /** 等待可选注入就绪；超时返回 false（调用方必须处理 false）。 */
  async waitReady(timeoutMs = 3000) {
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    const r = await Promise.race([this.ready.then(() => true), timeout])
    if (timer) clearTimeout(timer)
    return r === true
  }

  /** 更新**某会话**的意图包文本的唯一入口。空字符串 = 该会话静默待命。 */
  setIntentText(sessionId, text) {
    const sid = String(sessionId == null ? '' : sessionId)
    if (!sid) return
    const t = String(text == null ? '' : text)
    if (t) this.intentBySession.set(sid, t)
    else this.intentBySession.delete(sid)
  }

  /** 取某会话当前的意图包文本（诊断/测试用）。 */
  getIntentText(sessionId) {
    return this.intentBySession.get(String(sessionId == null ? '' : sessionId)) || ''
  }

  /** 当前有意图包的会话数（诊断用）。 */
  intentSessionCount() {
    return this.intentBySession.size
  }

  registerContext(ctx) {
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        try {
          this.services.systemPrompt = scope.systemPrompt
          this.contextDisposer = scope.systemPrompt.context({
            name: CONTEXT_NAME,
            order: CONTEXT_ORDER,
            // 按会话渲染：装配 context 携带 agent，据此取该会话的意图包；取不到就是空（静默）
            text: (assemblyCtx) => {
              try {
                const agent = assemblyCtx && assemblyCtx.agent
                const sid = agent && agent.id !== undefined ? String(agent.id) : ''
                if (!sid) return ''
                // ── 启用闸门（A10/A12）──────────────────────────────
                // 灰度 + 设置 + 双重拦截守卫**在这里**生效，而不是只在自检里生效。
                // 未判定时 statusFor 返回 PENDING（=不启用）⇒ 贡献空字符串 ⇒ 等同于没拦截。
                const st = adapter.enableGate ? adapter.enableGate.ensure(sid) : PENDING
                if (!st || st.enabled !== true) return ''
                return this.intentBySession.get(sid) || ''
              } catch (e) {
                // ⚠ **不得静默**（EV-0102）：这条路径若抛错，意图包会在**毫无痕迹**的情况下消失——
                // 正是 EV-0078 那一类事故（产品安静地不做事，用户以为它开着）。
                // 上面两个 `return ''` 是**决定**（没有 agent / 闸门未放行）；这里是**意外**，必须留痕。
                // 去重：同一会话同一错误只记一次，避免"每一步一条"把台账淹掉。
                try {
                  const agent = assemblyCtx && assemblyCtx.agent
                  const sid = agent && agent.id !== undefined ? String(agent.id) : '(no-agent)'
                  const msg = String((e && e.message) || e)
                  if (this.contextErrors.get(sid) !== msg) {
                    this.contextErrors.set(sid, msg)
                    appendWireLog({ sessionId: sid, ok: false, trigger: 'context-provider-threw', reason: msg })
                  }
                } catch { /* 连记录都失败就真的只能放弃 */ }
                return ''
              }
            },
          })
        } finally {
          this.markReady()
        }
      })
      return true
    } catch {
      this.markReady()
      return false
    }
  }

  /** 取当前 live agent；找不到返回 null（调用方必须处理 null，不得猜）。 */
  agentFor(sessionId) {
    const agents = this.services.agents
    if (!agents || typeof agents.get !== 'function' || !sessionId) return null
    try { return agents.get(sessionId) || null } catch { return null }
  }

  buildMessage(llm, text, summary) {
    return llm.createUserMessage({
      content: [{ type: 'text', text: String(text) }],
      source: {
        kind: 'plugin',
        plugin: '@dsh-external/dsh-po06',
        form: 'notice',
        summary: String(summary || '').slice(0, 120),
      },
    })
  }

  /**
   * 不唤醒投递：排入 next-step，不启动生成、不产生模型调用（EV-0020）。0.6 的默认投递方式。
   */
  async deliverNotice(sessionId, text, summary) {
    const agent = this.agentFor(sessionId)
    if (!agent) return { ok: false, reason: 'agent-not-found' }
    if (typeof agent.inject !== 'function') return { ok: false, reason: 'inject-unavailable' }
    try {
      const r = await loadLlmLib()
      if (!r.ok) return { ok: false, reason: r.reason, tried: r.tried }
      const msg = this.buildMessage(r.mod, text, summary)
      agent.inject(msg)
      return { ok: true, messageId: String(msg.id) }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /**
   * 唤醒式投递。**调用方必须已在用户授权范围内**（ADR-0012）。
   * 本原型不主动调用；保留接口以便 P4/P6 在授权路径中复用。
   */
  async deliverAndWake(sessionId, text, summary) {
    const agent = this.agentFor(sessionId)
    if (!agent) return { ok: false, reason: 'agent-not-found' }
    if (typeof agent.followup !== 'function') return { ok: false, reason: 'followup-unavailable' }
    try {
      const r = await loadLlmLib()
      if (!r.ok) return { ok: false, reason: r.reason, tried: r.tried }
      const msg = this.buildMessage(r.mod, text, summary)
      agent.followup(msg)
      return { ok: true, messageId: String(msg.id) }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  dispose() {
    try { if (typeof this.contextDisposer === 'function') this.contextDisposer() } catch { /* best effort */ }
    try { if (typeof this.projectionDisposer === 'function') this.projectionDisposer() } catch { /* best effort */ }
    // 控制 API 的路由也必须在卸载时摘掉：热重载后留着旧路由 = 同一前缀注册两次
    // （宿主路由表会报重复，或旧 handler 继续应答——0.5 的 slot 重复注册是同一类事故）。
    try { if (typeof this.controlApiDisposer === 'function') this.controlApiDisposer() } catch { /* best effort */ }
    this.contextDisposer = null
    this.projectionDisposer = null
    this.controlApiDisposer = null
  }
}

export const adapter = new DshAdapter()

function writeReport(report) {
  // **每一份报告都必须写明自己是哪一份代码写的**。
  // 实测踩到过：注入的是新打包的产物，但被 apply 的是更早缓存的模块实例；
  // 报告里没有这个字段时，"这次验证跑的是哪份代码"只能靠猜——那就不叫证据。
  try { if (!report.moduleUrl) report.moduleUrl = import.meta.url } catch { /* best effort */ }
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    writeFileSync(join(EVIDENCE_DIR, 'adapter-' + Date.now() + '.json'), JSON.stringify(report, null, 2), 'utf8')
  } catch { /* best effort */ }
}

export function apply(ctx, config) {
  pluginConfig = config && typeof config === 'object' ? config : {}
  const report = {
    probe: 'dsh-po06-adapter',
    phase: 'P1-6',
    at: new Date().toISOString(),
    note: '宿主适配层。生产路径：真实用户输入 → 解释 → 编译 → 动态上下文（零延迟，包从第 2 步生效）；自检只在 DSH_PO06_SELFCHECK=1 时运行',
    // **记录真正被加载的是哪一份代码**。这不是装饰：
    //   · 本项目已因"加载路径与依赖路径不一致"吃过一次亏（P0-D2）；
    //   · 实测还遇到过"注入的是打包产物，但注入器复用了更早缓存的模块实例"，
    //     于是跑的根本不是你以为的那份代码。没有这个字段就只能靠猜。
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
    steps: {},
  }

  adapter.services.agents = ctx.get('agents') || null
  adapter.services.sessionController = ctx.get('sessionController') || null
  // 插件自己的按会话状态存储（EV-0081：状态由我们自己拥有，不写会话日志）
  try {
    adapter.stateStore = createStateStore({ home: DSH_HOME })
    report.steps.stateStore = { dir: adapter.stateStore.dir }
  } catch (e) {
    adapter.stateStore = null
    report.steps.stateStore = { ok: false, reason: String((e && e.message) || e) }
  }
  // ⚠ `typeof null === 'object'`：旧诊断把 null 服务报成 "object"，
  // 于是"agents 服务其实一直没接上"这件事**藏在了一份看起来正常的报告里**（EV-0080）。
  // 现在如实区分 null / 缺方法 / 可用。
  const svcDesc = (s, method) => (s == null ? 'null' : (typeof s[method] === 'function' ? 'ok:' + method : 'no-' + method))
  report.steps.services = {
    agents: svcDesc(adapter.services.agents, 'get'),
    sessionController: svcDesc(adapter.services.sessionController, 'prompt'),
  }
  // 服务是**延迟提供**的：apply 时刻 `ctx.get('agents')` 拿不到（实测为 null），
  // 必须用 `ctx.inject` 等它就绪——与 systemPrompt 同一套写法。
  // 不修这一条，闸门永远拿不到 agent ⇒ 永远 `old-plugin-unknown` ⇒ 0.6 永远不启用。
  try {
    ctx.inject(['agents'], (scope) => {
      try {
        if (scope && scope.agents) adapter.services.agents = scope.agents
      } finally { adapter.markReady() }
    })
  } catch { adapter.markReady() }
  // `sessionController` **同样是延迟提供**的：apply 时刻拿不到（实测 headless 与 web 都是 null，
  // 而 web 下 `agents` 已经注入进来了）。此前只在 apply 读一次 ⇒ **永远是 null**，
  // 于是自检里的"会话装配探针"永远跑不到（早先还会因此**抛错**，EV-0131）。
  // 与 agents 同一套写法：就绪后填进 services；宿主不提供时保持 null（**可选能力**，不报错）。
  try {
    ctx.inject(['sessionController'], (scope) => {
      try {
        if (scope && scope.sessionController) adapter.services.sessionController = scope.sessionController
      } catch { /* 保持 null */ }
    })
  } catch { /* 宿主不提供该服务 ⇒ 保持 null；自检会如实记一步"本 profile 不提供" */ }
  // ── 装配期启用闸门（A10/A12）：拦截是否生效由它决定，默认不生效 ──
  adapter.enableGate = createEnableGate({ decide: decideEnableFor })
  report.steps.enableGate = (() => {
    const i = readEnableIntent()
    return {
      configPath: ENABLE_CONFIG_PATH,
      configExists: existsSync(ENABLE_CONFIG_PATH),
      intent: { ok: i.ok, ours: i.ours, reason: i.reason, enabled: i.settings.enabled, rolloutMode: i.rollout.mode },
      note: '未判定期间一律不启用（保守）；判定按 agent 懒触发',
    }
  })()

  report.steps.registerContext = { ok: adapter.registerContext(ctx), name: CONTEXT_NAME, order: CONTEXT_ORDER }
  report.steps.restingTextIsEmpty = adapter.getIntentText() === ''
  // 记录解析出来的 profile：静态探测查的就是这个目录的清单，
  // 写错目录会给出"看着有、其实答错问题"的结论（EV-0081），所以要可复核。
  report.steps.profile = { ...PROFILE_RESOLVED, dir: PROFILE_DIR, exists: existsSync(PROFILE_DIR) }

  // ── 注册意图状态投影（产品路径）────────────────────────────────
  report.steps.registerProjection = (() => {
    try {
      ctx.inject(['sessionProjections'], (scope) => {
        try {
          adapter.services.sessionProjections = scope.sessionProjections
          adapter.projectionDisposer = scope.sessionProjections.register(
            createProjectionDefinition(projectionStats),
          )
        } finally {
          adapter.markProjectionReady()
        }
      })
      return { ok: true, key: PROJECTION_KEY, stateVersion: 1, event: STATE_EVENT }
    } catch (e) {
      adapter.markProjectionReady()
      return { ok: false, reason: String((e && e.message) || e) }
    }
  })()

  // ── P9.2 控制 API：把设置/状态/台账/提示词暴露给控制面板 ─────────────
  // 只有带 webServer 的 profile（web）才有这一层；headless 等没有也不该有。
  // 懒注入（与 agents/sessionController 同一套写法）：apply 时刻服务还没提供。
  // 路由前缀 `/po06/api` **不在**宿主的浏览器信任闸门（只覆盖 `/api`）之内，
  // 所以 handler 自己做 Host/Origin/写头判据——理由与实现见 lib/control-api.js 文件头（EV-0139）。
  try {
    ctx.inject(['webServer'], (scope) => {
      if (!scope || !scope.webServer || typeof scope.webServer.register !== 'function') return
      try {
        adapter.controlApiDisposer = registerControlApi({ webServer: scope.webServer }, {
          home: DSH_HOME, version: PKG_VERSION, now: () => Date.now(),
        })
      } catch (e) {
        appendWireLog({ trigger: 'control-api', ok: false, reason: 'register-failed:' + String((e && e.message) || e) })
      }
    })
    report.steps.controlApi = { ok: true, prefix: '/po06/api', note: '懒注入 webServer；无该服务的 profile 自动跳过' }
  } catch (e) {
    report.steps.controlApi = { ok: false, reason: String((e && e.message) || e) }
  }

  // ── 交付门触发（默认关闭；见 GATE_TRIGGER_FLAG）────────────────
  try {
    const off = ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'deliverables/presented') return
        if (!existsSync(GATE_TRIGGER_FLAG)) return          // 未显式开启 → 不做任何事
        const files = Array.isArray(event.data && event.data.files) ? event.data.files : []
        for (const f of files) {
          const p = f && typeof f.path === 'string' ? f.path : null
          if (!p || !/\.html?$/i.test(p)) continue          // 只对本验证器的适用范围生效
          void runGateFor(session, p).catch(() => {})
        }
      } catch { /* 交付门是旁路，绝不打断会话 */ }
    })
    ctx.effect(() => () => { try { if (typeof off === 'function') off() } catch { /* best effort */ } }, 'dsh-po06: delivery gate trigger')
  } catch { /* 注册失败不影响插件本体 */ }

  // ── 生产触发（A15）：真实用户输入 → 解释 → 编译 → 上下文 ─────────────
  // 这是 EV-0078 缺失的那一环：此前没有任何**生产**代码路径会调用 handleInput，
  // 于是整条链在真实会话里不可达（346 项测试全绿而产品贡献 0 字符）。
  report.steps.productionTrigger = (() => {
    try {
      const off = ctx.on('session/event', (session, event) => {
        try {
          const sid = session && session.id !== undefined ? String(session.id) : ''
          // 先观测宿主自己的模型（解释层默认用它）
          const obs = extractObservedModel(event)
          if (obs) {
            observeModel(sid, obs)
            // 模型刚出现 ⇒ 若有待办输入，立刻补跑（包落在同一轮的第 2 步）
            const p = pendingInput.get(sid)
            if (p) {
              pendingInput.delete(sid)
              defer(() => runProductionInput(ctx, session, p, { trigger: 'model-observed-catchup' }))
            }
            return
          }
          if (!isRealUserInput(event)) return
          // **不 await**：零延迟（用户显式选择）。包从第 2 步起生效。
          defer(() => runProductionInput(ctx, session,
            { text: extractUserText(event), messageId: extractMessageId(event) }))
        } catch { /* 生产触发是旁路，绝不打断会话 */ }
      })
      ctx.effect(() => () => { try { if (typeof off === 'function') off() } catch { /* best effort */ } }, 'dsh-po06: production input trigger')
      return {
        ok: true,
        hook: 'session/event → user/message(source.kind=user)',
        awaited: false,
        log: WIRE_LOG_PATH,
        note: '零延迟：不 await 解释层，故意图包从**第 2 步**起生效；单步任务无包（明知的取舍，非缺陷）',
      }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  })()

  ctx.effect(() => () => adapter.dispose(), 'dsh-po06: adapter dispose')

  if (!SELF_CHECK) {
    // A15：生产触发**注册成功**也是 ok 的必要条件——否则又回到"注册了上下文但没人喂它"
    report.ok = report.steps.registerContext.ok === true
      && report.steps.restingTextIsEmpty === true
      && report.steps.productionTrigger.ok === true
    report.verdict = report.ok
      ? 'ACTIVE: 已注册且**生产触发已接线**（真实用户输入会被解释并编译成意图包；零延迟，包从第 2 步起生效）'
      : 'DEGRADED: 注册成功但生产触发未接线 ⇒ **不会做任何事**（见 steps.productionTrigger）'
    writeReport(report)
    if (P8_CHECK) runP8Check(ctx)
    if (P8B_CHECK) runP8bCheck(ctx)
    if (E001_CHECK) runE001Check(ctx)
    // P7 冒烟：**唯一会花模型钱的路径**。flag 与 spec 必须同时存在。
    if (SMOKE_CHECK) {
      void (async () => {
        try {
          if (!existsSync(SMOKE_SPEC)) {
            writeReport({ probe: 'po06-smoke', ok: false, error: 'spec-missing', specPath: SMOKE_SPEC,
              verdict: 'CHECK: flag 存在但 spec 文件缺失，未调用任何模型' })
            return
          }
          const { runSmoke } = await import('./eval-smoke.js')
          await runSmoke({ ctx, specPath: SMOKE_SPEC, reportDir: EVIDENCE_DIR })
        } catch (e) {
          writeReport({ probe: 'po06-smoke', ok: false, error: String((e && e.message) || e),
            verdict: 'ERROR: 冒烟运行器异常' })
        }
      })()
    }
    if (P6_CHECK) runP6Check(ctx)
    if (P3_CHECK) runP3Check(ctx)
    if (P2_CHECK) runP2Check(ctx)
    return
  }

  void (async () => {
    let testSessionId = null
    try {
      report.steps.injectReady = { ready: await adapter.waitReady(3000) }

      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      if (!sc || !agents) {
        // 这两个服务是**可选/懒提供**的：某些 profile（实测 headless）在 apply 时刻**不提供**它们。
        // 自检**不得因此抛错**（EV-0131）：抛出去整份报告就只剩一个 TypeError，而
        // 前面几步——状态存储 / 启用闸门 / 动态上下文注册 / 静默待命 / 生产触发接线 / 注入就绪
        // ——其实**都过了**，那才是这份自检的价值。**失败要可归因，不要只剩堆栈。**
        report.steps.sessionProbe = {
          ok: false,
          reason: 'services-unavailable-in-this-profile',
          sessionController: sc ? 'present' : 'null',
          agents: agents ? 'present' : 'null',
          note: '本 profile 在 apply 时刻没有提供这两个服务 ⇒ 会话装配探针跳过。'
            + '**这不是产品缺陷**：生产路径不依赖 apply 时刻的这两个服务。'
            + '真实会话投递链路的证据在 EV-0080/0081/0085（真机跑过）；要跑这条探针请用提供它们的 profile（web）。',
        }
        report.ok = true
        report.verdict = 'PARTIAL: 前置步骤全部通过；会话装配探针因本 profile 不提供服务而跳过'
        return
      }
      testSessionId = 'session-po06-adapter-selfcheck-' + Date.now().toString(36)
      report.testSessionId = testSessionId
      await sc.create({ sessionId: testSessionId, cwd: join(SCRATCH_DIR, 'test-workspace') })
      const target = agents.get(testSessionId)
      if (!target) throw new Error('自检会话创建后取不到 agent')

      const sp = adapter.services.systemPrompt
      const M1 = '【意图包 · 自检 A】只读装配验证，不进入任何真实会话。'
      const M2 = '【意图包 · 自检 B】文本已变，验证动态求值。'

      // 只在**自检会话**的作用域里做只读装配；不产生消息投递
      adapter.setIntentText(M1)
      const a1 = await sp.assemble({ agent: target, scope: target })
      const c1 = a1.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembleA = {
        minePresent: Boolean(c1),
        mineChars: c1 ? String(c1.text).length : 0,
        mineIndex: a1.contexts.findIndex((c) => c.name === CONTEXT_NAME),
        contextCount: a1.contexts.length,
        names: a1.contexts.map((c) => c.name),
      }

      adapter.setIntentText(M2)
      const a2 = await sp.assemble({ agent: target, scope: target })
      const c2 = a2.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembleB = {
        minePresent: Boolean(c2),
        changed: Boolean(c2) && String(c2.text).includes('自检 B'),
      }

      // 立刻复位为静默——不让自检文本有任何机会进入别的会话
      adapter.setIntentText('')
      const a3 = await sp.assemble({ agent: target, scope: target })
      report.steps.resetToSilent = {
        minePresent: a3.contexts.some((c) => c.name === CONTEXT_NAME),
        mineChars: (() => {
          const c = a3.contexts.find((x) => x.name === CONTEXT_NAME)
          return c ? String(c.text).length : 0
        })(),
      }

      // 投递验证（不唤醒）：消息应留在队列，且不产生 turn/start
      const events = []
      const off = ctx.on('session/event', (s, e) => {
        try { if (s && String(s.id) === testSessionId) events.push(e.type) } catch { /* best effort */ }
      })
      const d = await adapter.deliverNotice(testSessionId, '【自检投递】不应唤醒。', 'P1-6 selfcheck')
      await new Promise((r) => setTimeout(r, 1200))
      report.steps.deliverNotice = {
        result: d,
        queued: target.inbox.nextStep.some((m) => String(m.id) === String(d.messageId)),
        turnStarted: events.filter((t) => t === 'turn/start').length,
        status: target.status,
      }
      try { off() } catch { /* best effort */ }
      if (d.ok) { try { target.inbox.remove(d.messageId) } catch { /* best effort */ } }
      try { target.cancel('po06-selfcheck-cleanup') } catch { /* best effort */ }

      report.ok = report.steps.assembleA.minePresent === true
        && report.steps.assembleB.changed === true
        && report.steps.resetToSilent.mineChars === 0
        && report.steps.deliverNotice.queued === true
        && report.steps.deliverNotice.turnStarted === 0
      report.verdict = report.ok
        ? 'PASS: 上下文注册+动态求值+静默复位+不唤醒投递 全部成立'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      adapter.setIntentText('')
      writeReport(report)
    }
  })()
}

/** P2 自检：投影接线 / 完整状态事件 / CAS 拒绝 / apply 调用量实测。 */function runP2Check(ctx) {
  const report = {
    probe: 'dsh-po06-p2check',
    phase: 'P2',
    at: new Date().toISOString(),
    note: '投影接线 + CAS + 调用量；只在自己建的测试会话上操作',
    steps: {},
  }
  const baseline = { ...projectionStats, sessionsSeen: projectionStats.sessionsSeen.size }

  void (async () => {
    try {
      report.steps.projectionReady = { ready: await adapter.waitProjectionReady(3000) }
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p2-proj-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: join(SCRATCH_DIR, 'test-workspace') })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session

      // 1) 尚无状态
      report.steps.beforeInit = { state: adapter.intentStateOf(session) }

      // 2) 初始化（经 reducer 权威路径）
      const init = adapter.initIntent(session, { taskId: 'p2check' })
      report.steps.init = { ok: init.ok, code: init.code || null, revision: init.state ? init.state.revision : null }
      report.steps.afterInit = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, phase: s.phase, items: s.items.length } : s
      })()

      // 3) 正常提交：人类来源需求
      const cur = adapter.intentStateOf(session)
      const addHuman = adapter.commit(session, {
        causeId: 'c-add-human',
        baseRevision: cur.revision,
        baseInputRevision: cur.lastInputRevision,
        sessionId,
        ops: [{
          op: 'add_item',
          item: {
            id: 'req-1', kind: 'user_requirement', text: '单 HTML、可预览可操控',
            sourceRefs: [{ kind: 'human', sessionId, messageId: 'm1' }],
          },
        }],
      })
      report.steps.addHuman = { ok: addHuman.ok, code: addHuman.code || null }
      report.steps.afterAddHuman = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, items: s.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) } : s
      })()

      // 4) CAS：用**过期的 baseRevision** 再提交一次（模拟晚到的优化结果）
      const stale = adapter.commit(session, {
        causeId: 'c-stale',
        baseRevision: 0,   // 已过期
        sessionId,
        ops: [{ op: 'set_phase', phase: 'interpreting' }],
      })
      report.steps.staleRejected = { ok: stale.ok, code: stale.code || null, reason: String(stale.reason || '').slice(0, 120) }
      report.steps.afterStale = (() => {
        const s = adapter.intentStateOf(session)
        return s ? { revision: s.revision, phase: s.phase } : s
      })()

      // 5) 用户改口：输入闸门
      const before = adapter.intentStateOf(session)
      const ui = adapter.commitUserInput(session, { messageId: 'm-user-2' })
      report.steps.userInput = { ok: ui.ok, revision: ui.state ? ui.state.revision : null, lastInputRevision: ui.state ? ui.state.lastInputRevision : null }
      const inFlight = adapter.commit(session, {
        causeId: 'c-inflight',
        baseRevision: before.revision,          // 与旧 revision 对齐，专测输入闸门
        baseInputRevision: before.lastInputRevision,
        sessionId,
        ops: [{ op: 'set_phase', phase: 'ready' }],
      })
      report.steps.inFlightRejected = { ok: inFlight.ok, code: inFlight.code || null, reason: String(inFlight.reason || '').slice(0, 120) }

      // 6) 身份闸门（宿主路径）：模型来源不得建 user_requirement
      const cur2 = adapter.intentStateOf(session)
      const badIdentity = adapter.commit(session, {
        causeId: 'c-bad-identity',
        baseRevision: cur2.revision,
        baseInputRevision: cur2.lastInputRevision,
        sessionId,
        ops: [{
          op: 'add_item',
          item: { id: 'req-bad', kind: 'user_requirement', text: '必须离线', sourceRefs: [{ kind: 'model', sessionId }] },
        }],
      })
      report.steps.identityRejected = { ok: badIdentity.ok, code: badIdentity.code || null }

      // 7) 客户端视图（wire）
      try {
        const snap = adapter.services.sessionProjections.snapshot(session)
        report.steps.wireView = snap && snap.values ? snap.values[PROJECTION_KEY] : null
      } catch (e) { report.steps.wireView = 'error: ' + String((e && e.message) || e) }

      // 8) apply 调用量：本会话操作期间的增量
      report.steps.applyStats = {
        baseline,
        now: { ...projectionStats, sessionsSeen: projectionStats.sessionsSeen.size },
        delta: {
          applyCalls: projectionStats.applyCalls - baseline.applyCalls,
          shortCircuits: projectionStats.shortCircuits - baseline.shortCircuits,
          adopted: projectionStats.adopted - baseline.adopted,
          rejected: projectionStats.rejected - baseline.rejected,
        },
        shortCircuitRatio: (projectionStats.applyCalls - baseline.applyCalls) > 0
          ? Math.round(((projectionStats.shortCircuits - baseline.shortCircuits) / (projectionStats.applyCalls - baseline.applyCalls)) * 1000) / 1000
          : null,
      }

      // 9) 恢复验证：checkpoint → restore() 重建
      const sp = adapter.services.sessionProjections
      let cp = null
      try { cp = sp.checkpoint(session) } catch (e) { report.steps.checkpointError = String((e && e.message) || e) }
      report.steps.checkpointRow = cp && cp[PROJECTION_KEY]
        ? { ver: cp[PROJECTION_KEY].ver, seq: cp[PROJECTION_KEY].seq, revision: cp[PROJECTION_KEY].val && cp[PROJECTION_KEY].val.revision }
        : null

      // 9b) 落盘：等待投影缓存写入后，检查磁盘上确实有本键
      await new Promise((r) => setTimeout(r, 1500))
      report.steps.persistedCache = await (async () => {
        try {
          const fsMod = await import('node:fs')
          const file = join(DSH_HOME, 'storages', 'session_projcache', 'sessions', sessionId + '.json')
          if (!fsMod.existsSync(file)) return { file, exists: false }
          const raw = fsMod.readFileSync(file, 'utf8')
          const j = JSON.parse(raw)
          const rows = (j && j.record && j.record.rows) || {}
          const row = rows[PROJECTION_KEY]
          return {
            file, exists: true, size: raw.length,
            hasOurKey: Boolean(row),
            row: row ? { ver: row.ver, seq: row.seq, revision: row.val && row.val.revision } : null,
          }
        } catch (e) { return { error: String((e && e.message) || e) } }
      })()

      // 9c) restore()：用 checkpoint + 全部事件冷读重建，断言与在线状态一致
      const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
      report.steps.eventCount = Array.isArray(events) ? events.length : 'not-array:' + typeof events
      // 9c-1) 全量 checkpoint（与宿主真实启动路径一致：所有注册单元一起恢复）
      // 注意：restore() 返回的 snapshot.values 是 **wire 视图**；完整状态在 out.checkpoint[key].val。
      try {
        const out = sp.restore(cp, events, 0, session.header, session.inheritedEventCount)
        const view = out && out.snapshot && out.snapshot.values ? out.snapshot.values[PROJECTION_KEY] : undefined
        const restoredState = out && out.checkpoint && out.checkpoint[PROJECTION_KEY]
          ? out.checkpoint[PROJECTION_KEY].val : undefined
        const live = adapter.intentStateOf(session)
        report.steps.restore = {
          mode: 'full-checkpoint',
          asOfSeq: out && out.snapshot ? out.snapshot.asOfSeq : null,
          wireView: view || null,
          restoredStatePresent: Boolean(restoredState),
          restoredRevision: restoredState ? restoredState.revision : null,
          liveRevision: live ? live.revision : null,
          revisionsMatch: Boolean(restoredState && live && restoredState.revision === live.revision),
          itemsMatch: Boolean(restoredState && live
            && JSON.stringify(restoredState.items) === JSON.stringify(live.items)),
          restoredItems: restoredState ? restoredState.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
          liveItems: live ? live.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
          refreshedRowKeys: out && out.checkpoint ? Object.keys(out.checkpoint).length : null,
        }
      } catch (e) {
        report.steps.restore = {
          mode: 'full-checkpoint',
          error: String((e && e.message) || e),
          stack: String((e && e.stack) || '').split('\n').slice(0, 6).join(' | ').slice(0, 600),
        }
      }
      // 9c-2) 只带本单元的 checkpoint（隔离"其它单元在折叠我的事件时抛错"这一可能原因）
      try {
        const only = {}
        if (cp && cp[PROJECTION_KEY]) only[PROJECTION_KEY] = cp[PROJECTION_KEY]
        const out2 = sp.restore(only, events, 0, session.header, session.inheritedEventCount)
        const st2 = out2 && out2.checkpoint && out2.checkpoint[PROJECTION_KEY]
          ? out2.checkpoint[PROJECTION_KEY].val : undefined
        const live = adapter.intentStateOf(session)
        report.steps.restoreOnlyMine = {
          restoredStatePresent: Boolean(st2),
          restoredRevision: st2 ? st2.revision : null,
          liveRevision: live ? live.revision : null,
          revisionsMatch: Boolean(st2 && live && st2.revision === live.revision),
          itemsMatch: Boolean(st2 && live && JSON.stringify(st2.items) === JSON.stringify(live.items)),
          restoredItems: st2 ? st2.items.map((i) => ({ id: i.id, kind: i.kind, status: i.status })) : null,
        }
      } catch (e) {
        report.steps.restoreOnlyMine = {
          error: String((e && e.message) || e),
          stack: String((e && e.stack) || '').split('\n').slice(0, 6).join(' | ').slice(0, 600),
        }
      }

      // 10) 卸载后不可读
      try { adapter.projectionDisposer() } catch { /* best effort */ }
      adapter.projectionDisposer = null
      report.steps.afterDispose = { stateOfIsUndefined: adapter.intentStateOf(session) === undefined }

      report.ok = report.steps.init.ok === true
        && report.steps.addHuman.ok === true
        && report.steps.staleRejected.ok === false
        && report.steps.inFlightRejected.ok === false
        && report.steps.identityRejected.ok === false
        && report.steps.identityRejected.code === 'UNAUTHORIZED_KIND'
        && Boolean(report.steps.restoreOnlyMine && report.steps.restoreOnlyMine.revisionsMatch === true)
        && report.steps.afterDispose.stateOfIsUndefined === true
      report.verdict = report.ok
        ? 'PASS: 投影接线 + 三闸门 + checkpoint/restore 一致性 + 卸载即净'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      writeReport(report)
    }
  })()
}

/** P3 自检：把流水线接进**真实宿主**（状态走真实投影，意图包走真实 systemPrompt.context）。 */
function runP3Check(ctx) {
  const TANK = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'
  const report = {
    probe: 'dsh-po06-p3check',
    phase: 'P3',
    at: new Date().toISOString(),
    note: '真实宿主路径 + 桩解释器（不调用模型）；只在自己建的测试会话上操作',
    steps: {},
  }
  void (async () => {
    try {
      await adapter.waitProjectionReady(3000)
      await adapter.waitReady(3000)
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p3-intent-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: join(SCRATCH_DIR, 'test-workspace') })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session

      // 桩解释器：严格按契约输出（逐字引文来自真实原话）
      const stub = async () => JSON.stringify({
        ops: [
          { op: 'add_item', item: { id: 'req-1', kind: 'user_requirement', text: '单 HTML 程序', quote: '制作一个单html程序', sourceRefs: [{ kind: 'human', sessionId, messageId: 'm-1' }] } },
          { op: 'add_item', item: { id: 'req-2', kind: 'user_requirement', text: '不要预览文件夹内的其他文件', quote: '不要预览文件夹内的其他文件', sourceRefs: [{ kind: 'human', sessionId, messageId: 'm-1' }] } },
          { op: 'add_item', item: { id: 'qi-1', kind: 'quality_interpretation', text: '整体比例协调、结构可信', rationale: '来自原话的“真实、帅气”', sourceRefs: [{ kind: 'model', sessionId }] } },
        ],
      })

      const out = await adapter.handleInput(session, { messageId: 'm-1', text: TANK, interpret: stub })
      report.steps.outcome = out.outcome
      report.steps.trace = out.trace.map((x) => x.step)
      report.steps.packetChars = out.packet ? out.packet.text.length : 0

      const st = adapter.intentStateOf(session)
      report.steps.state = st ? { revision: st.revision, items: st.items.map((i) => i.id + '|' + i.kind + '|' + i.status) } : st

      // 真实宿主装配：本会话应看到意图包
      const sp = adapter.services.systemPrompt
      const asm = await sp.assemble({ agent, scope: agent })
      const mine = asm.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.assembledMine = {
        present: Boolean(mine),
        chars: mine ? String(mine.text).length : 0,
        hasRequirements: mine ? String(mine.text).includes('明确要求') : false,
        hasQuality: mine ? String(mine.text).includes('质量解释') : false,
        hasProvenanceNote: mine ? String(mine.text).includes('不是用户新增的命令') : false,
      }

      // 真实宿主装配：**别的会话**不得看到本会话的意图包（跨会话隔离）
      const other = agents.list().find((x) => String(x.id) !== sessionId)
      if (other) {
        const asmOther = await sp.assemble({ agent: other, scope: other })
        const mineOther = asmOther.contexts.find((c) => c.name === CONTEXT_NAME)
        report.steps.assembledOtherSession = {
          agentId: String(other.id),
          chars: mineOther ? String(mineOther.text).length : 0,
          leaked: Boolean(mineOther && String(mineOther.text).length > 0),
        }
      } else {
        report.steps.assembledOtherSession = { skipped: true, reason: 'no other agent' }
      }

      // 清理：本会话恢复静默
      adapter.setIntentText(sessionId, '')
      const asmAfter = await sp.assemble({ agent, scope: agent })
      const mineAfter = asmAfter.contexts.find((c) => c.name === CONTEXT_NAME)
      report.steps.afterClear = { chars: mineAfter ? String(mineAfter.text).length : 0 }
      try { agent.cancel('po06-p3check-cleanup') } catch { /* best effort */ }

      report.ok = out.outcome === 'committed'
        && report.steps.assembledMine.present === true
        && report.steps.assembledMine.hasRequirements === true
        && report.steps.assembledMine.hasQuality === true
        && (report.steps.assembledOtherSession.leaked === false || report.steps.assembledOtherSession.skipped === true)
        && report.steps.afterClear.chars === 0
      report.verdict = report.ok
        ? 'PASS: 真实宿主路径成立（状态→编译→动态上下文），且跨会话不泄漏'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdict = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      writeReport(report)
    }
  })()
}

const htmlVerifierDeps = () => ({
  verify: async (file) => {
    const r = await verifyHtmlFile({ file })
    return { record: r && r.built && r.built.ok ? r.built.record : null, raw: r && r.raw }
  },
  deliver: async (level, payload) => {
    const text = '[交付验证 · 机器结论，不是用户的话]\n' + payload.text
    if (level === LEVEL.WAKE) return adapter.deliverAndWake(payload.sessionId, text, payload.summary)
    return adapter.deliverNotice(payload.sessionId, text, payload.summary)
  },
  ledgerFor: gateLedgers.ledgerFor,
  computeSha: (file) => {
    try { return createHash('sha256').update(readFileSync(file)).digest('hex') } catch { return null }
  },
})

/**
 * 对一份交付物跑交付门。**默认 L0（只记录、不投递）**；
 * 若带 settings 则按其解析等级——自检用它验证 L1/L2 路径。
 */
async function runGateFor(session, file, settingsOverride) {
  const sessionId = String(session.id)
  const st = adapter.intentStateOf(session)
  const rev = st ? st.lastInputRevision : 0
  return runGate(htmlVerifierDeps(), {
    file,
    taskId: st ? String(st.taskId) : 'default',
    sessionId,
    currentInputRevision: rev,
    recordInputRevision: rev,
    settings: settingsOverride || { autoReworkEnabled: false, allowWake: false },
  })
}

/** P6 自检：交付门真实链路 —— 真机验证 + 真实 agent 投递（在自己建的测试会话上）。 */
function runP6Check(ctx) {
  const report = { probe: 'dsh-po06-p6check', phase: 'P6', at: new Date().toISOString(),
    note: '真机验证 + 真实投递；只在自己建的测试会话上；默认等级不投递', steps: {} }
  void (async () => {
    try {
      await adapter.waitProjectionReady(3000)
      const sc = adapter.services.sessionController
      const agents = adapter.services.agents
      const sessionId = 'session-po06-p6-gate-' + Date.now().toString(36)
      report.testSessionId = sessionId
      await sc.create({ sessionId, cwd: join(SCRATCH_DIR, 'test-workspace') })
      const agent = agents.get(sessionId)
      if (!agent) throw new Error('测试会话创建后取不到 agent')
      const session = agent.session
      adapter.initIntent(session, { taskId: 'p6check' })

      // 造一个**确定缺陷**的交付物：画布 0x0
      const dir = join(SCRATCH_DIR, 'gate-fixtures')
      mkdirSync(dir, { recursive: true })
      const bad = dir + '/bad-zero.html'
      writeFileSync(bad, '<!doctype html><html><head><meta charset="utf-8"><title>bad</title></head><body><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=0;c.height=0;</script></body></html>', 'utf8')
      const good = dir + '/good.html'
      writeFileSync(good, '<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=320;c.height=240;const g=c.getContext("2d");g.fillStyle="#345";g.fillRect(0,0,320,240);</script></body></html>', 'utf8')

      // ① L0（默认）：验证会跑，但**不投递**
      const before = agent.inbox.nextStep.length
      const r0 = await runGateFor(session, bad)
      report.steps.L0 = { verdict: r0.verdict, level: r0.level, delivered: r0.delivered, reasons: r0.reasons }
      await new Promise((r) => setTimeout(r, 500))
      report.steps.L0inboxDelta = agent.inbox.nextStep.length - before

      // ② L1：不唤醒投递（消息应排队，且不产生 turn/start）
      // 用**会话事件快照差分**，不注册 effect——
      // 在 apply 返回后的异步续体里 ctx.on 会报 "cannot create effect on inactive context"（实测）。
      const countTurns = () => {
        try { return (session.snapshotEvents() || []).filter((e) => e.type === 'turn/start').length } catch { return -1 }
      }
      const turnsBefore = countTurns()
      const r1 = await runGateFor(session, bad, { autoReworkEnabled: true, allowWake: false })
      await new Promise((r) => setTimeout(r, 800))
      report.steps.L1 = { verdict: r1.verdict, level: r1.level, delivered: r1.delivered, reasons: r1.reasons }
      const turnsAfter = countTurns()
      report.steps.L1turnStarted = turnsAfter - turnsBefore
      report.steps.triggerResult = r1.delivered

      // ③ 好件：不应产生可返工失败
      const r2 = await runGateFor(session, good, { autoReworkEnabled: true, allowWake: false })
      report.steps.good = { verdict: r2.verdict, level: r2.level, reasons: r2.reasons }

      // ④ 交付门触发默认关闭
      report.steps.triggerDefaultOff = !existsSync(GATE_TRIGGER_FLAG)

      try { agent.cancel('po06-p6check-cleanup') } catch { /* */ }

      report.ok = r0.verdict === 'rework-eligible' && r0.level === 'L0-record'
        && report.steps.L0inboxDelta === 0
        && r1.level === 'L1-queue' && Boolean(r1.delivered && r1.delivered.ok)
        && report.steps.L1turnStarted === 0
        && r2.verdict !== 'rework-eligible'
        && report.steps.triggerDefaultOff === true
      report.verdictText = report.ok
        ? 'PASS: 交付门真实链路（L0 不投递 / L1 投递且不唤醒 / 好件不返工 / 触发默认关闭）'
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally { writeReport(report) }
  })()
}

/** P8b 自检：**装配期启用闸门是否真的在生效**（真实宿主；不调模型、不开浏览器）。
 *
 *  为什么必须有这个自检：闸门的判定逻辑单测已经全绿，但"逻辑正确"与
 *  "接线接上了"是两件事——**一个只在自检里生效的守卫等于没有守卫**（A10/A12 缺口）。
 *  这里用**两侧对照**证明接线成立（只有闸门能解释这个差异）：
 *    (a) 默认态：写了意图包文本，但旧插件仍在装配 ⇒ 上下文贡献必须是 **0 字符**；
 *    (b) 强制启用该会话（探针注入，绕过判定）⇒ 同一段文本必须**贡献出来**。
 *  若 (a) 与 (b) 都为空，说明抑制来自别处（接线没生效）；若 (a) 非空，说明闸门没拦住。
 */
/**
 * E-001 的宿主侧入口（EV-0087）：把 flag/env 翻译成 runE001 的参数并跑。
 * 报告写进 `$DSH_HOME/po06-e001/`（跟着 home 走，不写死路径）。
 */
function runE001Check(ctx) {
  const specPath = process.env.DSH_PO06_E001_SPEC || SMOKE_SPEC
  const holdoutPath = join(__dirnameOfIndex(), '..', 'eval', HOLDOUT_SEAL.file)
  const outDir = join(DSH_HOME, 'po06-e001')
  const only = process.env.DSH_PO06_E001_ONLY
  const onlyTaskIds = only ? String(only).split(',').map((s) => s.trim()).filter(Boolean) : null
  const onlyArms = process.env.DSH_PO06_E001_ARMS ? String(process.env.DSH_PO06_E001_ARMS).split(',').map((s) => s.trim()).filter(Boolean) : null
  const onlyRuns = process.env.DSH_PO06_E001_RUNS ? Number(process.env.DSH_PO06_E001_RUNS) : null
  const budget = process.env.DSH_PO06_E001_BUDGET ? Number(process.env.DSH_PO06_E001_BUDGET) : null
  const stage = process.env.DSH_PO06_E001_STAGE || 'S1'
  // 实验条件：去掉【未决项】段（EV-0089）。默认关闭——它是**实验工具**，不是产品行为。
  const dropUnknowns = process.env.DSH_PO06_E001_DROP_UNKNOWNS === '1'
  writeReport({ probe: 'po06-e001-launch', phase: 'P7', at: new Date().toISOString(),
    args: { specPath, holdoutPath, outDir, stage, budget, onlyTaskIds, onlyArms, onlyRuns, dropUnknowns },
    note: '入口已触发；实际运行结果写进 outDir' })
  void (async () => {
    try {
      // 等 llm 服务就绪：本检查在 apply() 时触发，而服务提供是**延迟**的
      // （agents 在 apply 时就实测为 null）。不等就可能白跑一轮、只拿到 llm-unavailable。
      const t0 = Date.now()
      let llm = ctx.get('llm')
      while ((!llm || typeof llm.stream !== 'function') && Date.now() - t0 < 30000) {
        await new Promise((r) => setTimeout(r, 500))
        llm = ctx.get('llm')
      }
      const { runE001 } = await import('./eval-e001.js')
      // 花钱之前先确认宿主 llm 模块能定位到（EV-0132）：拿不到就**不启动**，
      // 报告里写明试过哪些位置——而不是让第一笔调用抛在循环深处。
      const lib = await loadLlmLib()
      if (!lib.ok) {
        writeReport({ probe: 'po06-e001-launch', phase: 'P7', at: new Date().toISOString(),
          error: 'llm-lib-unresolved: ' + lib.reason, tried: lib.tried })
        return
      }
      await runE001({ ctx, holdoutPath, specPath, outDir, stage, budget, llmLib: lib.spec, onlyTaskIds, onlyArms, onlyRuns, dropUnknowns })
    } catch (e) {
      writeReport({ probe: 'po06-e001-launch', phase: 'P7', at: new Date().toISOString(),
        error: String((e && e.stack) || e) })
    }
  })()
}

/** 本模块所在目录（用于定位仓库内的 eval/ 资源）。 */
function __dirnameOfIndex() {
  try { return dirname(fileURLToPath(import.meta.url)) } catch { return '.' }
}

function runP8bCheck(ctx) {
  const report = { probe: 'dsh-po06-p8bcheck', phase: 'P8b', at: new Date().toISOString(),
    note: '装配期启用闸门接线验证：默认抑制 / 强制启用放行（两侧对照）', steps: {} }
  void (async () => {
    const PROBE_TEXT = '【P8b 探针】意图包文本：这段文字只有在启用闸门放行时才应出现在装配上下文里。'
    let sid = ''
    try {
      await adapter.waitReady(3000)
      const agents = adapter.services.agents
      const sp = adapter.services.systemPrompt
      const list = agents && typeof agents.list === 'function' ? agents.list() : []
      const target = list[0]
      report.steps.hasSystemPrompt = Boolean(sp)
      if (!target || !sp) { report.error = 'no agent/systemPrompt to probe'; return }
      sid = String(target.id)

      const mineChars = async () => {
        const asm = await sp.assemble({ agent: target, scope: target })
        const c = (asm.contexts || []).find((x) => x.name === CONTEXT_NAME)
        return c ? String(c.text).length : 0
      }

      // 前置：确认"没有闸门时文本本来是会出现的"——即文本非空且真被渲染
      adapter.setIntentText(sid, PROBE_TEXT)
      report.steps.textLength = adapter.getIntentText(sid).length

      // (a) 默认态：先 forget 掉缓存，让 text() 走真实判定路径
      adapter.enableGate.forget(sid)
      await mineChars()                       // 触发一次判定（异步）
      await new Promise((r) => setTimeout(r, 600))
      const stDefault = adapter.enableGate.statusFor(sid)
      report.steps.gateStatus = { ...stDefault }
      report.steps.charsWhenGated = await mineChars()

      // (b) 强制启用（**仅探针**）：绕过判定，直接注入 enabled=true
      adapter.enableGate.set(sid, { enabled: true, code: 'probe-forced-enabled', reason: 'P8b 探针强制放行' })
      report.steps.charsWhenForced = await mineChars()

      // (c) 双重拦截分支：**不写用户配置**，而是把本机真实探测结果喂给判定函数，
      //     看"若 0.6 已被配置启用（all）"会得到什么结论。
      //     不写 ~/.dsh/prompt-optimizer.json 是刻意的：真实配置迁移需用户同意（ADR-0032）。
      try {
        const agent = adapter.agentFor(sid)
        const rt2 = await detectOldPluginRuntime({ systemPrompt: sp, agent })
        let st2 = null
        try {
          const { detectOldPluginStatic } = await import('./host-migrate.js')
          st2 = detectOldPluginStatic(PROFILE_DIR)
        } catch { st2 = null }
        const merged2 = mergeOldPluginSignals(rt2, st2)
        const tri = toActiveTriState(merged2)
        const wouldBe = resolveEnableDecision({
          intent: parseEnableIntent(JSON.stringify({ settingsVersion: 1, enabled: true, rollout: { mode: 'all' } })),
          sessionId: sid,
          oldPluginActive: tri,
        })
        report.steps.oldPluginTriState = tri
        report.steps.oldPluginEvidence = (merged2 && merged2.evidence || []).slice(0, 3)
        report.steps.wouldBeIfEnabled = wouldBe

        // (d) 把**真实判定结论**注入闸门 → 装配贡献必须仍为 0
        adapter.enableGate.set(sid, wouldBe)
        report.steps.charsWithRealDecision = await mineChars()
      } catch (e) {
        report.steps.oldPluginBranchError = String((e && e.message) || e)
      }

      const a = report.steps.charsWhenGated
      const b = report.steps.charsWhenForced
      const c = report.steps.charsWithRealDecision
      const wb = report.steps.wouldBeIfEnabled || {}
      report.ok = report.steps.textLength > 0
        && a === 0
        && b === report.steps.textLength
        && stDefault.enabled !== true
        // 双重拦截分支：本机旧插件确实在装 ⇒ 结论必须是否决，且据此装配贡献仍为 0
        && (report.steps.oldPluginTriState !== true || wb.code === 'DOUBLE_INTERCEPT')
        && (report.steps.oldPluginTriState !== true || c === 0)
      report.verdictText = report.ok
        ? ('PASS: 闸门真的接在装配路径上——默认态贡献 ' + a + ' 字符（结论 ' + stDefault.code
           + '），强制放行后贡献 ' + b + ' 字符；'
           + '按本机真实探测（旧插件 tri-state=' + report.steps.oldPluginTriState
           + '）若配置启用则结论=' + wb.code + '，据此贡献 ' + c + ' 字符')
        : ('CHECK: 默认 ' + a + ' / 强制 ' + b + ' / 真实判定 ' + c + ' / 文本 ' + report.steps.textLength
           + '，默认结论 ' + stDefault.code + '，真实判定结论 ' + wb.code)
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally {
      try { if (sid) { adapter.setIntentText(sid, ''); adapter.enableGate.forget(sid) } } catch { /* best effort */ }
      writeReport(report)
    }
  })()
}

/** P8 自检：旧插件**运行时**探测 + 启用闸门（不调模型、不开浏览器）。 */
function runP8Check(ctx) {
  const report = { probe: 'dsh-po06-p8check', phase: 'P8', at: new Date().toISOString(),
    note: '运行时探测旧插件是否仍在装配；并核对启用闸门结论', steps: {} }
  void (async () => {
    try {
      await adapter.waitReady(3000)
      const agents = adapter.services.agents
      const list = agents && typeof agents.list === 'function' ? agents.list() : []
      const target = list[0]
      const sp = adapter.services.systemPrompt
      report.steps.hasSystemPrompt = Boolean(sp)
      if (!target) { report.error = 'no agent to scope the probe'; return }

      // 装配结果里的上下文清单（用来核对探测依据）
      const asm = await sp.assemble({ agent: target, scope: target })
      report.steps.contextNames = (asm.contexts || []).map((c) => c.name)

      const rt = await detectOldPluginRuntime({ systemPrompt: sp, agent: target })
      report.steps.runtime = rt

      // 静态探测（本机 profile）
      let st = null
      try {
        const { detectOldPluginStatic } = await import('./host-migrate.js')
        st = detectOldPluginStatic(PROFILE_DIR)
      } catch (e) { st = { error: String((e && e.message) || e) } }
      report.steps.static = st

      const merged = mergeOldPluginSignals(rt, st)
      report.steps.merged = merged

      // 启用闸门：命中则必须拒绝启用
      const decided = decideEnabled({
        rollout: { mode: 'all' },
        sessionId: String(target.id),
        settings: { enabled: true },
        oldPluginActive: merged.active,
      })
      report.steps.gate = decided

      report.ok = rt.confidence === 'runtime'
        && typeof merged.active === 'boolean'
        && (merged.active === false || decided.code === 'DOUBLE_INTERCEPT')
      report.verdictText = report.ok
        ? ('PASS: 运行时探测成立（active=' + merged.active + '，confidence=' + merged.confidence
           + '）；启用闸门结论=' + decided.code)
        : 'CHECK: 见各步骤字段'
    } catch (e) {
      report.error = String((e && e.stack) || e)
      report.verdictText = 'ERROR: ' + String((e && e.message) || e)
    } finally { writeReport(report) }
  })()
}
