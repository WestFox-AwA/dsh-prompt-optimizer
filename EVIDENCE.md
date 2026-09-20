# 证据台账（EVIDENCE）

> 每条证据 = 一个可复核的观察。区分「静态源码 / 集成 / 成品实验 / 人工反馈」。
> 只写实际做过的检查；未做的不写。覆盖范围与限制必须写清楚。

## EV-0001 · 静态 · 定位仓库与工作树状态

- **要支持的结论**：存在正式的 git 源码仓库，且 P0 开始时工作树干净、可安全切分支。
- **方法**：`git remote -v`、`git branch --show-current`、`git status --short`、`git log --oneline -n 8`
- **实际结果**：
  - remote `origin` = `https://github.com/WestFox-AwA/dsh-prompt-optimizer.git`
  - branch = `main`；HEAD = `04a661539cc86080b8e12a6cf453fad9b2d90d3a`；`git describe` = `v0.5.0-beta.1-16-g04a6615`
  - `git status --short` 输出为空（无未提交改动）
  - 仓库 `package.json` 版本 = `0.5.2-beta.1`
- **覆盖范围**：仓库身份与状态。
- **未覆盖**：远端是否与本地同步（未 `git fetch` 比对）。
- **关联**：ADR-0003

## EV-0002 · 静态 + 字节比对 · 0.4.4 基线可复现

- **要支持的结论**：0.4.4 的代码可以从两个独立来源重建且字节一致，可作为对照臂 B。
- **方法**：
  1. `git show v0.4.4-beta.1:lib/index.js` → 取原始字节 → sha256
  2. 解包 `dsh-external-dsh-prompt-optimizer-0.4.4-beta.1.tgz` → 对 `package/lib/index.js` 取 sha256
- **实际结果**：
  - git tag 侧：sha256 `475f0d919a5157192954f9f70879a70ac6d935c8150856823e9ad2d2f6924a63`，152576 bytes
  - tgz 侧：sha256 `475f0d919a5157192954f9f70879a70ac6d935c8150856823e9ad2d2f6924a63`（**完全一致**）
  - tgz 文件本身：223718 bytes，sha256 `df09a43ec91d4dce012b0091194b9f4cf73146109d309a9d5f58ecb19a55891e`
- **覆盖范围**：`lib/index.js` 单文件；`lib/client.js` 与其余文件未逐一比对。
- **未覆盖**：该代码在 dsh `0.1.6-alpha.1` 上能否装配运行（见 EV-0003 待做）。
- **纠错记录**：首次用 PowerShell 重定向 `git show ... > file` 得到的哈希为 `6E51C5B6…`，
  与 tgz 不符。改用 node 直接捕获 git 的原始字节后得到 `475f0d91…`，与 tgz 一致。
  **结论：PowerShell 文本重定向会改变字节（BOM/换行），不得用于二进制比对。**
- **关联**：ADR-0001、baseline-manifest.json → arms.B_044

## EV-0003 · 集成（桩宿主）· B 臂可加载且 apply() 不抛错

- **状态**：已完成（**范围有限**，见「未覆盖」）
- **要支持的结论**：B 臂（0.4.4）的 host 侧代码在当前 Node/dsh 环境下至少能加载并完成注册。
- **方法**：
  1. `git -C <repo> archive --format=tar --output=<tmp.tar> v0.4.4-beta.1`（**不经 PowerShell 管道**）
  2. `tar -xf` 到隔离目录 `C:/Users/WestFox/.dsh/exp/po06/arms/B-044/package`
  3. 校验 `lib/index.js` sha256 == `475f0d91…` → **MATCH**
  4. 用桩宿主探针 `exp/po06/probe-arm.mjs` 动态 import 并调用 `apply(ctx)`（`ctx.get()` 一律返回 `undefined`）
- **实际结果**：
  - `importOk=true`，`exports=[apply, inject, name]`
  - `applyOk=true`，无异常
  - 索取服务：仅 `settings`（其余服务在回调内惰性 `ctx.get`）
  - 订阅事件：`llm/stream`、`session/event`
  - 注册：5 个 effect、1 个 interval（看门狗）、1 条 web 路由 `/prompt-optimizer/api`
  - 日志：`host ready @ /prompt-optimizer/api`
  - 关键静态事实：该版本 `lib/index.js` **只 import Node 内置模块**（fs/url/path/os/module），无裸包依赖
- **覆盖范围**：模块解析、顶层求值、`apply()` 的同步注册路径。
- **未覆盖（重要）**：
  - **未**在真实 dsh `0.1.6-alpha.1` 装配运行；未验证 `llm.stream` 调用、UI 拦截、web 路由实际响应。
  - 桩宿主下 `ctx.get()` 返回 `undefined`，因此"服务缺失时的降级路径"被触发，但"服务存在时的正常路径"未被执行。
  - 未验证浏览器端 `lib/client.js`。
- **结论强度**：足以支持"B 臂不是加载即坏的产物"，**不足以**宣称"B 臂在真实宿主上功能正常"。
  正式实验前仍需一次真实装配冒烟（列入 P1）。
- **为什么必须先做**：若 B 臂跑不起来，"0.6 优于 0.4.4" 的结论无法成立（ADR-0005）。

## EV-0008 · 集成（桩宿主）· B 臂与 D 臂的宿主接触面差异

- **要支持的结论**：0.5.x 相对 0.4.4 增加了什么宿主侧机制——为退化机理分析提供结构事实（不是因果结论）。
- **方法**：同一探针（`probe-arm.mjs`）分别作用于 B 臂与 D 臂；D 臂由 `git archive 04a6615` 重建，
  `lib/index.js` sha256 校验为 `5261a575…` → MATCH。
- **实际结果**：

  | 观测项 | B（0.4.4） | D（0.5.x HEAD） |
  |---|---|---|
  | 模块导出 | `apply, inject, name` | `apply, inject, name, __poVerify, __addresseeVerify` |
  | `ctx.inject` | 无 | `['systemPrompt']` |
  | 注册的系统上下文 | 无 | `prompt-optimizer:capability`（order 118，动态 text 函数） |
  | 订阅事件 | `llm/stream`、`session/event` | 同左 |
  | effect 数 | 5 | 6 |
  | web 路由 | `/prompt-optimizer/api` | 同左 |

- **可支持的推断（非因果）**：D 臂确实多了一条"把本会话实测能力事实注入系统提示词"的通道，
  且该通道在**每个会话每次装配**都会参与提示词组装。这是一个与"提示词越长越可能干扰"假设相关的结构差异。
- **不能支持的推断**：不能由此断定该机制导致了坦克任务退化。退化机理仍未区分（见 EV-0006 与 CHECKPOINT 未完成项）。
- **未覆盖**：未实测该上下文渲染出的文本长度、内容与对工作模型的实际影响。
- **关联**：`baseline-manifest.json` → arms.B_044 / arms.D_05x

## EV-0009 · 集成（真实宿主）· 宿主服务与接口清单

- **要支持的结论**：0.6 需要的宿主能力在真实运行时的存在性（不靠源码推断）。
- **方法**：手写只读探针插件 `exp/po06/probe-plugin`，经超级注入器装入**真实 DSH 进程**，
  在 `apply(ctx)` 内枚举服务与接口并写 JSON 报告（不发送消息、不注册工具/路由）。报告：`exp/po06/probe-reports/live-final-*.json`。
- **实际结果（存在）**：`agents`、`sessions`、`sessionController`、`userQuestions`、`systemPrompt`、`llm`、
  `tools`、`webServer`、`settings`、`sessionProjections`、`sessionProjectionCache`、`storage`、`commands`、
  `attachments`、`jobs`、`skills`。
- **实际结果（不存在）**：`workspace`、`goal`、`logger` —— **三个服务 absent**。
  （计划中若假定用 `ctx.get('workspace')` 或 `ctx.get('goal')` 会直接拿到 undefined。）
- **`sessionProjections` 方法**：`register` / `stateOf` / `snapshot` / `cachedSnapshot` / `checkpoint` / `onChanged` 全部为 function。
- **`agents` registry**：`list` / `get` / `roots` / `create` 为 function；**`selectionFor` 为 undefined**、`dispose` 为 undefined。
- **agent 实例**：`inject` / `steer` / `followup` / `send` / `cancel` / `runMaintenance` 为 function；**`wake` 为 undefined**（内部私有）。
- **inbox**：`append` / `prepend` / `remove` / `replace` / `clear` / `claim` 全为 function。
- **session**：`append` / `header` / `requestHeader` / `snapshotEvents` 为 function，`seq` 为 number。
- **规模事实**：`agents.list().length = 68`，`roots().length = 68`（全部为 root），状态含 `idle` 与 `running`。
- **`ctx.setInterval` 直接读取会抛错**：`cannot get property "timer" without inject`。
- **覆盖范围**：单次进程快照。
- **未覆盖**：`userQuestions.ask` 的实际问答行为、`tools.execute`、`storage` 的具体形状（本轮未调用）。
- **关联**：ADR-0008

## EV-0010 · 集成（真实宿主）· plugin 来源消息全链路 PASS

- **要支持的结论**：0.6 的核心机制——把**非人类来源**的上下文交给工作 AI，并且它真的能看到——成立。
- **方法**：探针在**自建测试会话**上执行：`sessionController.create({sessionId,cwd})` →
  `createUserMessage({source:{kind:'plugin',plugin,form:'notice',summary}})` → `agent.followup(msg)`（next-turn + wake）
  → 捕获 `session/event` 与 `llm/stream` → 写报告。
- **实际结果**（报告 `chain-pass-1789860078620.json`）：
  - 测试会话：`session-po06-p1-chain-mu90h66u`；agent 为 root、创建后 idle
  - 构造：`role=user`、`sourceKind=plugin`、`frozen=true`，messageId 正常
  - 持久日志：出现 `user/message` 事件，**`sourceKind=plugin` / `sourcePlugin` / `sourceForm=notice` 全部保留**
  - 模型实收：捕获到 1 次 `llm/stream`，`provider=deepseek-official`、
    `model=deepseek-v4.1-flash-expires-on-0910`、`messageCount=4`、标记文本出现在请求消息中
  - 助手有回复（`assistant/message`）；判定 **PASS**
- **覆盖范围**：构造 → 投递 → 持久日志 → 模型请求消息 四段。
- **未覆盖**：未验证模型对内容的**理解质量**（只验证"收到了"）；只跑了一个模型组合；未验证 steer/inject(no-wake) 路径。
- **已知探针缺陷（诚实记录）**：报告里 `deliver.landedInNextTurn=false`。
  原因是 `agent.inbox.nextTurn` 是**投影支撑**的读取，在 followup 后立即读取可能尚未反映；
  而消息确实送达（由持久日志证明）。**结论：不要用 inbox 读取做投递断言**（ADR-0007）。
- **关联**：ADR-0007

## EV-0011 · 集成（真实宿主）· 宿主自身已在用同一机制注入上下文

- **要支持的结论**：`source.kind='plugin'` + `form` 不是我们发明的旁路，而是**宿主既有惯用法**；0.6 必须与它共存而不是重复。
- **方法**：用仓库自带多帧解码器
  （`evidence/zstd-frames.cjs`，Node 的 `zstdDecompressSync` 只解首帧，需按 magic 逐帧切）
  解码测试会话 `session.v3.jsonl.zstd`，列出全部 `user/message` 的 source 明细。
- **实际结果**：一个**全新会话**在用户还没说话前，已有 3 条 `user/message`，**全部是 plugin 来源**：

  | 顺序 | source.plugin | form | 字符数 | 内容 |
  |---|---|---|---|---|
  | 1 | `@dsh-external/dsh-po06-probe` | `notice` | 88 | 本次探针注入 |
  | 2 | `@deepseek-ai/dsh-system-prompt` | `snapshot` | 1162 | 运行时上下文快照 |
  | 3 | （技能目录生产者） | `catalog` | 1017 | 技能清单 |

  另有一条 `system/message`（内容长度 0）。
- **可支持的推断**：上下文预算的基线不是 0；0.6 的注入必须考虑与这 ~2.2KB 共存。
  且 `snapshot` 形式的语义是"后来的同生产者快照取代先前的"，天然避免累积；`notice` 会累积。
- **不能支持的推断**：不能由字符数推断 token 占用或对模型的实际影响（未测）。
- **未覆盖**：未核对其它会话是否还有更多来源；未测这些既有注入对任务质量的影响。
- **关联**：ADR-0006

## EV-0012 · 静态 · 插件必须声明 cordis 服务注入

- **要支持的结论**：0.6 插件要用 `ctx.webServer` / `ctx.setInterval` 等，必须声明 `export const inject`。
- **方法**：对照 B/D 两臂源码与探针实测。
- **实际结果**：
  - B 臂 `lib/index.js:17` → `export const inject = ['webServer', 'timer']`
  - D 臂 `lib/index.js:18` → 同一行，另在 `:3548` 用 `ctx.inject(['systemPrompt'], …)` 做可选注入
  - 探针未声明 inject，直接读 `ctx.setInterval` 即抛 `cannot get property "timer" without inject`
  - 而 `ctx.get('agents')` 等**查找式**访问无需声明即可工作
- **结论**：属性式访问（`ctx.webServer`、`ctx.setInterval`）需要声明；`ctx.get(name)` 查找不需要。
- **关联**：ADR-0008

## EV-0013 · 集成（真实宿主）· 动态上下文注册/顺序/卸载 PASS

- **要支持的结论**：`systemPrompt.context()` 可用，且 order 与 dispose 语义符合 0.6 需要。
- **方法**：探针注册两个上下文（order 9001 / 9002，其中一个 `text` 为函数），
  直接调 `systemPrompt.assemble({})` 做确定性检查——**零模型调用**。测完立即 dispose 全部。
- **实际结果**：
  - 注册返回类型：`function`（可用 disposer）
  - 重名注册**抛错**：`prompt context "po06-probe:alpha" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)`
  - 非有限 order **抛错**：`order must be a finite number`
  - 装配后 `contexts` **按 order 升序**：alpha(index 4) 在 beta(index 5) 之前
  - `text` 可以是函数并按 context 求值（得到 `PO06-CTX-BETA-DYNAMIC`）
  - `renderContextSnapshot()` 以 `Current runtime context.` 开头，包含两个标记
  - dispose alpha 后再装配：alpha 消失、beta 保留 ⇒ **卸载即净**
  - 探针自清理：`disposed=2`，`remainingProbeContexts=[]`
- **覆盖范围**：全局作用域注册的装配行为。
- **未覆盖**：agent 作用域的 shadowing 行为（错误信息提示可用 `agent.ctx` 做 per-agent override，本轮未实测）。
- **关联**：ADR-0006

## EV-0014 · 集成（真实宿主）· 宿主保证"无变化不重复注入"

- **要支持的结论**：0.6 不需要自己实现去重——宿主已有。
- **方法**：读 `dsh-agent-loop/lib/index.js` 的 `RuntimeContextProjection`（:300–356）并与 EV-0011/EV-0013 的现象交叉核对。
- **实际结果（源码事实）**：
  - `project(current, sections)`：`if (this.retained?.text === snapshot) return`（:339）
    ⇒ **渲染文本与上次保留快照相同则不产生任何消息**。
  - 变化时构造**一条** `createUserMessage`，`source={kind:'plugin', plugin:SOURCE, form:'snapshot', sections}`（:340–354）。
  - 从无快照且当前为空 ⇒ 不产生消息（:337）；曾有快照而当前为空 ⇒ 发 `CLEARED`（:338）。
  - 该消息在 `preStep` 中作为**步骤消息**追加（`pre-step` waterfall 默认值 `[...claimed, context]`，:894–901）。
- **结论**：所有 `systemPrompt.context()` 贡献被合并为**一条**聚合快照消息；未变化时不重发。
- **未覆盖**：未实测"变化时整条聚合消息重发"的实际 token 代价（含宿主自己的 1003 字符）。
- **关联**：ADR-0006

## EV-0015 · 集成（真实宿主）· 0.5.x 每会话实际注入的动态上下文清单（含原文）

- **要支持的结论**：量化 0.5.x 往工作 AI 里注入了什么，为"是否造成退化"提供结构事实（**不是因果结论**）。
- **方法**：探针带 agent 作用域调 `assemble({agent, scope:agent})`，抽样 4 个会话，dump 各贡献者 name/长度/原文。
- **实际结果**（典型会话）：

  | 贡献者 | 来源 | 字符 |
  |---|---|---|
  | `dsh-super-injector` | 注入器插件 | 362 |
  | `sandbox:policy` | 宿主 | 127 |
  | `approval:policy` | 宿主 | 175 |
  | `prompt-optimizer:capability` | **0.5.x 插件** | 298–339 |
  | **合计** | | **≈1003–1037** |

- **插件原文（339 字符版本）**：
  > 【本会话实测能力】权限档 danger-full-access（文件与进程都不设限）｜审批 不需要任何审批。通道：子进程 ✓ · 视觉截图 ✓（msedge.exe 1s 出图 3797B） · 外部工具服务器：godot-ai ✓。
  > （工具说明里关于受限档的警告……在本会话**不适用**……）
  > 【失败不是结论】"被拒绝/做不到"只能由**当场复测**确认……重测再下判断。
  > 能自动验证的（截图、编译、断言、跑一遍）不要交给用户；只有主观手感或真机体验才交回……
- **确认的冗余（原文对照）**：插件首句「权限档 danger-full-access｜审批 不需要任何审批」
  与宿主 `sandbox:policy`、`approval:policy` **陈述同一事实**（约 60 字符重复）。
  真正新增的信息是**通道探测结果**（约 100 字符）；其余约 180 字符是**通用行为规则**。
- **可作为候选解释、但本轮不能结论的**：那两条通用规则（"失败不是结论"、"能自动验证的不要交给用户"）
  会**鼓励工作 AI 去尝试环境验证**。在坦克这类任务里，这可能把预算导向环境对抗而非成品质量。
  **必须由实验区分**，不得当作已证实的退化原因。
- **未覆盖**：未测这 339 字符对任务结果的实际影响；未统计"通道探测"与真实可用性的一致率。
- **关联**：ADR-0009

## EV-0016 · 静态 · `assemble()` 的作用域依赖性

- **要支持的结论**：读上下文不能只看全局装配，否则会误判"插件没注入"。
- **方法**：先 `assemble({})`（无作用域）再 `assemble({agent, scope:agent})`，对比同一贡献者的文本长度。
- **实际结果**：无作用域时 `sandbox:policy`/`approval:policy`/`prompt-optimizer:capability` **全为 0 字符**；
  带作用域时分别为 127 / 175 / 339 字符。
- **结论**：这些上下文是**按 agent 作用域求值**的；任何"注入体积/内容"的检查必须带作用域，
  否则会得出"注入为空"的错误结论（本轮差点据此误判）。
- **关联**：EV-0015

## EV-0017 · 集成（真实宿主）· 回问通道负例（未触达用户界面）

- **要支持的结论**：`userQuestions.ask` 的校验守卫在触达 answerer **之前**抛错，可安全地做负例测试。
- **安全设计**：只跑校验阶段用例（全部发生在 `user-questions/request` waterfall 之前）；
  **递增推进**——先跑最靠前的守卫，若其未按预期抛错则立即停止，不执行其余用例。
- **实际结果**（`abortedEarly:false`，即守卫顺序与源码一致）：

  | 用例 | 抛出 | code |
  |---|---|---|
  | 已 abort 的 signal | ✓ | `ASK_ABORTED` |
  | 空问题列表 | ✓ | `EMPTY_QUESTIONS` |
  | 伪造 agent（非 live） | ✓ | `CALLER_NOT_LIVE` |
  | intent.approve 不在 options | ✓ | `BAD_INTENT` |
  | intent 缺 detail | ✓ | `BAD_INTENT` |

- **覆盖范围**：5 个校验分支；`userQuestions.ask` 存在且为 function。
- **未覆盖（重要）**：
  - **正向提问路径完全未测**——它会真的弹到用户界面，属于打扰用户的操作，留到 P4 并与用户约定时机。
  - `DELEGATED_CALLER`（owned child）**未实测**：需要创建一个非 root 的子 agent（本机 68 个 agent 全是 root）。
    该分支仅由源码确认（`dsh-user-questions/lib/index.js:59`），不计作已验证。
- **关联**：ADR-0010

## EV-0018 · 集成（真实宿主）· 投影注册/事件折叠/checkpoint/卸载 PASS

- **要支持的结论**：`sessionProjections.register` 可用于承载 0.6 的意图状态，且卸载即净。
- **方法**：注册临时投影（key `po06probe`、stateVersion 1、不带 `wire`），在自建测试会话上追加
  2 个 `po06probe/tick` + 1 个无关事件，读 `stateOf` / `checkpoint` / `snapshot`，最后 dispose。
- **实际结果**：
  - `register` 返回 disposer（function）
  - 初值 `{n:0,last:null}`；两个 tick 后 `{n:2,last:'b'}` ⇒ **按事件折叠正确**
  - 无关事件时 `apply` **返回同一引用**（宿主 `Object.is` 判变化，符合要求）
  - `checkpoint(session)` 含本键：`{ver:1, seq:5, val:{n:2,last:'b'}}`
  - **不声明 `wire` 时 `snapshot()` 不暴露该键**（`wire` 决定客户端可见性）
  - dispose 后 `stateOf(...)` 返回 `undefined` ⇒ **卸载即净**
- **宿主已注册的投影键（23 个，实测）**：
  `title, titleInput, llmRetry, sandboxMode, goal, tokenUsage, contextPressure, contextBreakdown,
  turnBoundary, sessionStats, turnOutline, agentPreset, subagentCatalog, subagentTiming, subagent,
  permissions, modelSelection, sessionListMetadata, imageLimits, todos, plan,
  subagentModelSelectionPolicy, inbox`
- **性能事实（重要）**：本次测试窗口内本探针的 `apply` 被调用 **1407 次**。
  原因是注册单元由 `drive(session, event)` 驱动，且 cell 首次触及时要折叠该会话**全部历史事件**；
  因为宿主有 68 个在册会话，代价按"会话数 × 事件数"增长，而不是只算目标会话。
- **覆盖范围**：注册/驱动/读/checkpoint/卸载。
- **未覆盖**：
  - **跨重启恢复未测**（需要重启 DSH 后由 `session-projection-cache` hydrate；本轮只验证了 checkpoint 产出）。
  - `wire.viewSchema.parse` 路径未测（未声明 wire）。
  - 未测多进程/并发下的 CAS 行为（宿主当前为单进程）。
- **关联**：ADR-0011

## EV-0020 · 集成（真实宿主）· 投递 API 语义：inject / steer / cancel

- **要支持的结论**：0.6 需要区分"只附着上下文"与"唤醒工作 AI"，并需要可靠的取消。
- **方法**：自建测试会话 `session-po06-p1-wake-mu90p4et`，采集其全部 `session/event`，
  依次验证 inject（不唤醒）、remove、steer（唤醒后立即 cancel）、cancel 后再 inject。
- **实际结果**：

  | 步骤 | 观测 |
  |---|---|
  | `agent.inject(msg)`（idle） | `status=idle`、`turn/start` 增量 **0**、`inbox.nextStep=1`、spliced **1** 次、消息仍在队列 ⇒ **不唤醒** |
  | `agent.inbox.remove(id)` | 返回 true、`nextStep=0`、消息消失 ⇒ 可精确移除 |
  | `agent.steer(msg)` + 立即 `cancel` | `turn/start` 增量 **1** ⇒ **确实唤醒**；`assistant/message` 增量 **0** |
  | 取消记录 | `turn/end` 的 reason = `{"kind":"aborted","reason":"po06-probe-cancel"}` ⇒ **取消原因被持久记录** |
  | 事件类型集合 | 仅 `agent/inbox/spliced`、`turn/start`、`turn/end` —— **无 `step/start`** |
  | cancel 后 | `status=idle`、`nextStep=0`、`nextTurn=0` ⇒ inbox 被清空 |
  | cancel 后再 inject | `turn/start` 增量 0、`status=idle`、`nextStep=1` ⇒ 注入仍正常 |

- **重要成本结论**：无 `step/start` ⇒ 本次 steer **没有产生任何模型调用**，取消在第一步之前生效。
- **对 ADR-0007 的修正性说明**：本轮 `agent.inbox.nextStep` 读取**可靠**（消息未被认领，读数与持久事件一致）。
  P1-1 的假阴性源于 `followup` 会立即认领消息造成的竞态，而非 inbox 读取普遍不可信。
  **结论收紧为**：对"未被认领的排队消息"可信；对"刚投递且会立即唤醒"的消息不可信（改用持久日志）。
- **覆盖范围**：idle agent 的 inject/steer/cancel；单次会话。
- **未覆盖**：running agent 上的 steer（其真实用途）；`cancel` 的 `keepInbox` 选项；多 agent 并发隔离。
- **关联**：ADR-0012

## EV-0021 · 集成（真实宿主）· 测试会话清单（供清理）

- **说明**：P1 探针在磁盘上留下以下测试会话（均在
  `~/.dsh/sessions/--C-Users-WestFox-.dsh-exp-po06-test-workspace--/`），作为可复核证据保留：
  `session-po06-p1-chain-mu90h5hw`、`session-po06-p1-chain-mu90h66u`、
  `session-po06-p1-proj-mu90ntu1`、`session-po06-p1-wake-mu90p4et`。
- **清理方式**：删除上述会话目录即可；它们是探针自建的，不含用户对话内容。
  （注：两个 `chain-*` 中各执行过一次真实模型调用，见 EV-0010。）

## EV-0022 · 集成（真实宿主）· 最薄 DshAdapter 原型 PASS，并暴露两个实现陷阱

- **要支持的结论**：0.6 的宿主接入层可以落地，且不依赖 LLM。
- **方法**：`po06/`（`@dsh-external/dsh-po06@0.6.0-alpha.0`）注入真实宿主，用标记文件触发自检；
  自检建**自己的**测试会话 `session-po06-adapter-selfcheck-mu90rma5` 做只读装配与不唤醒投递。
- **实际结果（PASS）**：
  - `registerContext` ok；上下文名 `prompt-optimizer:intent`，order 9100
  - 静默待命：`restingTextIsEmpty=true`（空文本不渲染，不污染任何会话）
  - 装配序（实测）：`dsh-super-injector → sandbox:policy → approval:policy → prompt-optimizer:capability → prompt-optimizer:intent`
    ⇒ 0.6 的意图包排在**末位**（index 4）
  - 动态求值：置入自检 B 文本后 `changed=true`
  - 静默复位：文本清空后该贡献仍注册但 **0 字符**
  - **不唤醒投递**：`deliverNotice` 返回 ok、消息入队 `queued=true`、**`turnStarted=0`**、`status=idle`
- **两个实现陷阱（首次运行真实踩到，已写进实现与兼容性报告）**：
  1. **`ctx.inject` 的回调不是同步执行的**。第一次自检 `assembleCheck` 报 `no systemPrompt`
     而上下文其实已注册成功（其文本已出现在活跃会话上下文里）⇒ 必须 `await` 就绪信号。
  2. **动态上下文是全局注册的**：第一次自检把占位文本留在非空状态，
     导致该文本进入了**当时活跃的用户会话**上下文（本会话可见）。
     ⇒ 静默待命时**文本必须为空**；只在确有内容时才置非空。
- **未覆盖**：未测 LLM 相关能力（原型刻意不含）；未测重启后行为。
- **关联**：ADR-0006/0009/0012、`compatibility-report.md`

## EV-0023 · 单元 · P2 reducer：18/18 通过，且经变异检验确认测试会咬人

- **要支持的结论**：意图状态的核心闸门（来源身份、CAS、用户改口）在纯函数层成立，且测试非假绿。
- **方法**：`po06/lib/schema.js` + `po06/lib/reducer.js`（纯函数：无 IO、无宿主、无时间、无随机）；
  `node po06/test/reducer.test.mjs`；再跑 `node po06/test/mutate-check.cjs` 做变异检验。
- **实际结果**：**18/18 pass，0 fail**（`exit=0`）。覆盖：
  建状态初值、人类来源可建 user_requirement、非人类来源被拒、`kind` 不可变（质量解释不得升格）、
  CAS 旧 revision 拒绝、用户改口后旧输入修订拒绝、supersedes 令旧条目退出有效集合、
  重复 id / 未知条目拒绝、入参不被修改、同输入两次结果相同、不变量、sourceRef 形状、空 ops。

  **变异检验**（`po06/test/mutate-check.cjs`，3 个变异全部被捕获，源文件字节还原）：

  | 变异 | 被捕获 | 变红的测试 |
  |---|---|---|
  | 身份闸门恒真 | ✓ | 2（两条身份闸门用例） |
  | CAS 判断禁用 | ✓ | 2（CAS 用例 + 用户改口用例） |
  | 用户输入闸门禁用 | ✓ | 1（STALE_AFTER_INPUT 用例） |

  还原后 `restoredByteIdentical=true`、`afterRestore 18/0`。
- **过程中修掉的一个真实缺陷（假绿）**：首版把"人类来源"判断写在形状校验器 `validateNewItem` 里，
  导致 reducer 的 `UNAUTHORIZED_KIND` 分支**永不可达**，而测试仍全绿——
  "看起来在做事的死代码"会掩盖真实缺口。已把职责重划：**schema 只管形状，reducer 管权威**，
  并补了 `形状校验器不越权` 用例防止身份判断偷偷跑回校验器。
- **同类缺陷**：`update_item` 的不可变字段检查也不可达（被 schema 白名单提前拦下），已删除并注明执法点。
- **覆盖范围**：reducer 与 schema 的纯逻辑。
- **未覆盖**：与宿主投影的接线（P2 下半）、跨重启恢复、并发/多进程 CAS。
- **关联**：ADR-0011、PLAN-0.6.md §7.2/§7.3

## EV-0024 · 环境 · 两个会毁文件的 PowerShell 陷阱（已固化进脚本注释）

- **背景**：在 Windows PowerShell 5.1 中做文本变异时，连续两次"变异失败"都不是变异本身造成的，
  而是工具链毁掉了源文件。两次都靠备份还原，并最终确认源文件字节一致。
- **陷阱一**：`Set-Content -Encoding utf8` 会写入 **BOM**，Node 的 ESM 加载器因此报
  `SyntaxError: Unexpected token '}'`。表现酷似"代码写坏了"。
- **陷阱二**：`Get-Content -Raw` 会把**无 BOM 的 UTF-8**（含中文注释）按 ANSI 解读，
  写回时内容已被破坏。**读-改-写循环在 PowerShell 里不安全。**
- **连带故障**：脚本首行 `$ErrorActionPreference='Stop'` 会把 node 的 stderr 当成终止错误，
  于是在**还原之前**中止——源文件留在损坏状态。
- **处置**：所有涉及源码读写的自动化一律用 node（`fs`）；PowerShell 只用于调起与查看。
  该结论已写进 `po06/test/mutate-check.cjs` 的文件头注释。
- **关联**：ADR-0011（工具链规范）

## EV-0025 · 集成（真实宿主）· P2 投影接线 PASS：三条闸门在宿主路径上生效

- **要支持的结论**：意图状态不只是单元测试里成立——它在**真实宿主的投影 + 事件提交**路径上同样成立。
- **方法**：`po06/lib/projection.js`（投影定义 + `commitPatch`）接进适配器，注入真实宿主，
  在自建测试会话 `session-po06-p2-proj-mu90wobv` 上走完整提交路径（标记文件 `run-p2check.flag` 触发，已删除）。
- **实际结果（PASS）**：

  | 步骤 | 观测 |
  |---|---|
  | 投影注册 | `projectionReady=true` |
  | 尚无状态 | `beforeInit.state = null`（与"空状态"区分开） |
  | 初始化 | `ok`，`revision=1`，`phase=idle` |
  | 人类来源需求提交 | `ok`，`revision=2`，条目 `req-1/user_requirement/active` |
  | **CAS 旧 revision** | **拒绝**：`STALE_REVISION`，`baseRevision=0 but current revision=2`；状态保持 `revision=2` 未变 |
  | 用户改口 | `commitUserInput` → `revision=3`、`lastInputRevision=3` |
  | **在途补丁** | **拒绝**：`STALE_REVISION`（`baseRevision=2` vs current 3） |
  | **身份闸门（宿主路径）** | **拒绝**：`UNAUTHORIZED_KIND`（模型来源建 user_requirement） |
  | 客户端视图 | `wire` 视图正确：`{revision:3, phase:'idle', activeCount:1, unresolvedQuestions:0}` |
  | 卸载 | `stateOf` 返回 `undefined` ⇒ **卸载即净** |

- **whole-value 规则落实**：状态事件 `prompt-optimizer/state-changed` 携带**完整新状态**，
  `apply` 只做"校验并采纳"，不做计算（符合宿主 whole-value 事件约定）。
- **apply 短路实测（ADR-0011）**：本窗口 `applyCalls=6`、`shortCircuits=3`、`adopted=3`、
  `shortCircuitRatio=0.5`；`sessionsSeen=1`。
- **与 P1-4 的 1407 次对照（诚实说明）**：两次测量的窗口活动量不同——
  P1-4 的窗口里**本机正在活跃工作**（其它会话持续产生事件），P2 窗口仅数秒且只有测试会话在动。
  因此"1407"反映的是**繁忙窗口**，不是稳定开销。apply 调用量随**宿主总事件量**增长，与注册者无关。
- **未做到的一件事（明确记录）**：我原本想分离"首次折叠历史"与"增量驱动"两类调用，**没有做到**。
  原因：`apply(state, event)` 的入参**不含会话标识**，无法从内部判断当前是在折叠历史还是增量驱动。
  要分离必须换测量位置（在 `drive` 外层包装计数，或按注册时刻前后分段计时），留待需要时再做。
- **关联**：ADR-0011、PLAN-0.6.md §7.3

## EV-0026 · 集成（真实宿主）· checkpoint 落盘 + restore() 重建一致性 PASS

- **要支持的结论**：意图状态能被持久化，并可从 checkpoint + 日志尾部重建出**与在线完全一致**的状态。
- **重要限定**：本轮验证的是 `restore()` 的**重建计算**（直接调用宿主公开方法），
  **不是**宿主启动时的 hydrate 接线——后者需要真正重启 DSH，本轮**未做**（会中断用户正在使用的会话）。
- **方法**：在自建测试会话 `session-po06-p2-proj-mu90zuf2` 上提交 3 次状态变更后，
  读 `checkpoint` → 等 1.5s 读磁盘缓存 → 调 `restore(cp, events, 0, header, inheritedEventCount)`。
- **实际结果**：

  | 观测 | 值 |
  |---|---|
  | 在线 checkpoint 行 | `{ver:1, seq:5, revision:3}` |
  | 磁盘缓存文件 | 存在（3997 B），**含本插件键**（`hasOurKey:true`） |
  | 磁盘缓存行 | `{ver:1, seq:2, revision:null}` ⇒ **滞后于在线状态** |
  | restore 结果 | `asOfSeq:5`；wire 视图 `{revision:3, phase:'idle', activeCount:1}` |
  | 重建状态 | `revision=3` == 在线 `revision=3`；**`itemsMatch: true`** |
  | 重建条目 | `[{id:'req-1', kind:'user_requirement', status:'active'}]` 与在线逐字段一致 |
  | 刷新后的 checkpoint 行数 | 24（全部注册单元） |

- **两个接口事实（必须记住）**：
  1. `restore()` 返回的 `snapshot.values[key]` 是 **wire 视图**，不是完整状态；
     完整状态在 **`out.checkpoint[key].val`**。第一版断言错在这里，误报 `itemsMatch:false`。
  2. **投影缓存是滞后的**（磁盘 `seq:2` vs 在线 `seq:5`）。
     这本身不是缺陷——宿主的设计是"checkpoint + 前向重放日志尾部"，滞后由重放补齐。
- **关联**：EV-0027、ADR-0015

## EV-0027 · 集成（真实宿主）· apply 短路比实测 0.999

- **要支持的结论**：ADR-0011 的"首句短路并返回同一引用"确实把开销压到了可接受范围。
- **方法**：同一窗口内统计 `applyCalls / shortCircuits / adopted`。
- **实际结果**：`applyCalls=2097`、**`shortCircuits=2094`**、`adopted=3`、`rejected=0`，
  **`shortCircuitRatio = 0.999`**（约 8 秒的繁忙窗口）。
- **结论**：在本机这种繁忙宿主下，单次 `apply` 的绝大多数调用只做一次字符串前缀判断即返回同一引用。
  这与 P1-4 的 1407 次并不矛盾——**调用次数多，但每次极廉价**；ADR-0011 的约束是对的，
  且它是"次数多"能被接受的前提。
- **未覆盖**：未测单次调用的纳秒级耗时；未分离"首次折叠历史"与"增量驱动"（见 EV-0025 说明）。
- **关联**：ADR-0011

## EV-0028 · 静态 + 集成 · 恢复路径的隐性缺陷：`stateSchema` 缺失

- **要支持的结论**：宿主 `register()` **不校验** `stateSchema`，缺了它只在恢复时才爆炸。
- **方法**：读 `dsh-session-projection/lib/index.js` 的 `restore()`（:297）与缓存读路径（:255），
  对照本插件首版投影定义（未声明 `stateSchema`）。
- **实际结果（源码事实）**：
  - `:297` `let state = usable ? def.stateSchema.parse(row.val) : def.init(...)`
    —— **不在 try/catch 内**，缺 `stateSchema` 会抛 `TypeError`。
  - `:255` 另一条读路径的 `def.stateSchema.parse(row.val)` **在 try/catch 内**，缺了会被静默跳过。
  - `register()` 只校验 `stateVersion` 是非负整数，**不校验 stateSchema**。
- **影响**：这是一个"注册、提交、读取全部正常，只有恢复时才失败"的隐性缺陷。
  P2 首版**带着这个缺陷通过了全部自检**——是 P2-3 的恢复验证把它暴露出来的。
- **处置**：补上 `stateSchema`（zod 风格最小实现，只需 `.parse`）；
  新增 `po06/test/projection.test.mjs` 把"必需字段齐全"钉成断言；
  并在 `mutate-check.cjs` 增加变异项 `projection: stateSchema-removed`，确认该断言会变红。
- **关联**：ADR-0015

## EV-0029 · 单元 · P3 编译器：16/16 通过，标签化 + 预算丢弃 + 范围审计

- **要支持的结论**：意图包可以被**确定性、可审计**地编译出来，且不会把机器解释冒充成用户要求。
- **方法**：`po06/lib/compiler.js`（纯函数，无 IO / 无 LLM / 无宿主），
  `node po06/test/compiler.test.mjs`；纳入 `mutate-check.cjs`。
- **实际结果**：**16/16 pass**。覆盖：
  - 六节标签化渲染（明确要求 / 质量解释 / 已查证事实 / 实现选项 / 建议 / 未决项）
  - **`明确要求` 节只含 user_requirement/user_decision**，质量解释与建议各自成节
  - 每条渲染行**必须带来源**（`（来源：human msg:m1）` 形式）
  - **空节不出现**；无有效条目时编译为**空文本**（静默待命）
  - 已撤销 / 被取代的条目**不进入编译**
  - 超预算时按固定顺序丢弃（建议 → 实现选项 → 事实 → 质量解释）并写明丢了什么
  - **必保节（明确要求）永不被丢弃**
  - 审计能抓出「非人类来源冒充要求」与「缺来源被渲染」
  - 确定性：同输入两次结果一致
- **产品含义**：`quality_interpretation` 永远出现在「质量解释（…不是新增命令）」节里，
  与「明确要求」物理分开——**这是"主动质量展开"与"不越界"能同时成立的结构保证**。
- **未覆盖**：真实模型是否会遵守这些标签（需 P3 实验）；标签文本本身的措辞优劣（需成品对照）。
- **关联**：PLAN-0.6.md §6/§9、ADR-0016

## EV-0030 · 方法 · 变异检验抓出"测不到目标"的弱测试

- **要支持的结论**：变异检验不只是形式——它能发现**测试自身**的漏洞。
- **实际结果**：编译器首次 8 个变异中，`compiler: audit-human-source-check-removed`
  **未被捕获**（`caught:false, failCount:0`）。原因：我那条"审计能抓出非人类来源冒充要求"的用例
  塞进 `requirements` 的是 `quality_interpretation`，而它被**另一条独立检查**（禁止类型）拦下——
  于是"人类来源"那条检查即使被删除，测试依然全绿。**该检查实际上一直没有被真正验证。**
- **处置**：新增探针用例，改用**不在禁用类型列表里**的 `observed_fact` 冒充要求，
  使"人类来源"检查成为唯一会触发的原因；并加了反向断言
  （确认这条探针不会被"禁止类型"规则顺带拦下，否则它无法单独验证目标检查）。
  补齐后 8/8 变异全部被捕获。
- **方法论教训（已写入 ADR-0013 补充）**：为一个检查设计变异项时，必须确认
  **该变异只会让目标检查失效**；若测试同时被别的检查兜住，等于目标检查未被验证。
- **关联**：ADR-0013

## EV-0031 · 单元 · P3 解释层契约：18/18 通过，逐字引文使"发明要求"可机械拦截

- **要支持的结论**：单次任务路径里唯一需要 LLM 的环节，其**输出可被机械校验**，
  不依赖"相信模型不会乱写"。
- **方法**：`po06/lib/interpreter.js`（纯函数，**不调用任何模型**）
  + `po06/test/interpreter.test.mjs`（18 项）+ 变异项 4 个。
- **核心机制（ADR-0017）**：`user_requirement` / `user_decision` 必须携带 `quote`，
  且该引文必须是**用户原话的字面子串**（`String.prototype.includes`，不做归一化）。
  - 允许：把原话**拆成原子要求**（每条各自引用原话的一段）。
  - 挡住：模型把自己的推断写成用户要求（引文对不上即**整份输出被拒**，不落半个补丁）。
  - 引文本身**不进入状态**（只在校验时使用后丢弃）。
- **实际结果（18/18）覆盖**：
  - 契约文本含关键约束条款；用户消息含逐字原话、sessionId/messageId、已知状态
  - `extractJson` 容错：裸 JSON / ```json 围栏 / 前后废话；无 JSON→`NO_JSON`，坏 JSON→`BAD_JSON`
  - **逐字引文**：通过 / 改写被拒 / 缺 quote 被拒 / 不误伤解释类条目
  - **闸门**：不得创建 `user_decision`（`KIND_NOT_ALLOWED`）、不得用未授权 op（`OP_NOT_ALLOWED`）、
    超量条目被拒（`TOO_MANY_ITEMS`）、超长条目截断并警告（不整条丢）
  - **双层防线**：即便引文是真的，只要 sourceRefs 不是 human，reducer 仍以
    `UNAUTHORIZED_KIND` 拒绝——解释层与 reducer 各自独立把关
  - 空 ops 视为 noop 而非错误
- **未覆盖**：真实模型是否遵守契约（是否愿意照抄引文）——**只能由 P3 实验回答**；
  本轮的 18 项全部是离线契约检查，**不含任何模型行为证据**。
- **关联**：ADR-0016、ADR-0017

## EV-0032 · 集成（离线）· C 臂流水线端到端联调：12/12；并抓到"假 OK"缺陷

- **要支持的结论**：解释 → 提交 → 编译 → 动态上下文的整条链路在**不花模型预算**的前提下
  行为与故障路径都可验证。
- **方法**：`po06/lib/pipeline.js`（编排，解释器**注入**）
  + `po06/test/pipeline.test.mjs`（12 项，解释器为伪造实现，**不调用任何模型**）。
  伪造解释器严格按契约输出（带逐字引文），跑的是开发集 D-01 的真实原话。
- **实际结果（12/12）覆盖**：
  - 端到端提交成功；意图包同时含【明确要求】与【质量解释】；上下文被更新
  - **质量展开不进入「明确要求」节**（越界防线，含分块断言）
  - **伪造引文（发明要求）→ 解析被拒 → 状态与上下文都不含该条**
  - **解释期间用户改口 → 晚到补丁被丢弃**（`outcome='input-changed'`），且**根本不尝试 commit**
  - **解释期间发生并发提交（非用户输入）→ dryRun 针对当前状态拒绝**（`STALE_REVISION`）
  - 显式过期补丁被 reducer 拒绝，revision 不变
  - 解释器抛错 → 不提交、上下文不含错误文本
  - 空 ops → noop，不报错
  - 模型伪造 human 来源（引文为真）→ reducer 以 `UNAUTHORIZED_KIND` 拒绝
  - `trace` 逐步可定位；确定性（同输入两次产出包一致）
- **本轮抓到的真实缺陷（重要）**：`dryRun` 原本用的是**解释开始前**读的那份快照去校验。
  于是 CAS 变成"旧 revision 比旧 revision"——**永远相等、永远通过**，
  这个最该拦下晚到补丁的地方反而给出**假 OK**（最终靠 `commit` 重读状态兜住，但权威检查失效）。
  **发现过程**：我先写了一条自己都不信的"用户改口"测试（注释里承认它没测到晚到），
  把它改成真实竞态后测试**立刻变红**，缺陷才暴露。
- **处置**：解释结束后**重读当前状态**，显式检查 `lastInputRevision` 是否变化，
  以 `INPUT_CHANGED_DURING_INTERPRETATION` 直接丢弃；`dryRun` 改为针对 `current`。
- **变异检验**：新增 2 个流水线变异。其中 `pipeline: dryRun-uses-stale-snapshot`
  第一次**未被捕获**——因为它被 `recheck` 提前拦下（防线重叠掩盖了目标）。
  按 ADR-0013 补充规则新增"并发提交"探针（使 `inputChanged=false` 而 `revisionChanged=true`，
  dryRun 成为唯一能拦下的地方），随后 14/14 全部被捕获。
- **未覆盖**：真实模型行为（是否遵守契约、是否愿意照抄引文）——**仍需 P3 对照实验**。
- **关联**：ADR-0018、ADR-0013

## EV-0033 · 集成（真实宿主）· C 臂接入真实宿主 PASS，并修掉跨会话泄漏缺陷

- **要支持的结论**：整条链路在**真实宿主**里成立——状态走真实投影、意图包走真实
  `systemPrompt.context`、并且**不泄漏到别的会话**。本轮**零模型调用**（解释器为桩）。
- **方法**：适配器新增 `handleInput()`（解释函数注入）；标记文件 `run-p3check.flag` 触发自检；
  自检在自建会话 `session-po06-p3-intent-*` 上用桩解释器（引文取自真实原话）跑完整链路。
- **先修掉的一个设计缺陷（重要）**：适配器原先把意图包存成**一个全局字符串**，
  意味着 **A 会话的意图会进入 B 会话的上下文**。已改为 `Map<sessionId, text>`，
  并让 `systemPrompt.context` 的 `text(assemblyCtx)` 从 `assemblyCtx.agent.id` 取会话——
  取不到则返回空串（静默）。
- **实际结果（PASS）**：

  | 观测 | 值 |
  |---|---|
  | 流水线结果 | `committed` |
  | trace | `init → recordInput → interpret → parse → recheck → dryRun → commit → setContext` |
  | 状态 | `revision=3`；条目 `req-1/req-2 (user_requirement)`、`qi-1 (quality_interpretation)` |
  | 意图包 | 192 字符 |
  | **本会话装配** | 贡献存在、192 字符、含「明确要求」「质量解释」「不是用户新增的命令」表头 |
  | **另一会话装配** | **0 字符、`leaked=false`** ⇒ 跨会话隔离在真实宿主上成立 |
  | 清理后 | 0 字符 |

- **覆盖范围**：真实 `sessionProjections` + 真实 `systemPrompt.context` + 真实 agent scope。
- **未覆盖**：
  - **真实 LLM 解释器**（本轮是桩）——仍是 P3 对照实验的内容。
  - 未测 UI 侧（本插件目前无 client 端）。
- **新增测试**：`po06/test/pipeline.test.mjs` 增至 13 项（新增跨会话隔离用例）。
- **关联**：ADR-0019、ADR-0016

## EV-0034 · 真实模型 · 解释层契约首次冒烟：一次调用即通过（P3 关键证据）

- **要支持的结论**：逐字引文契约与"不发明约束"的要求，在**真实模型**上是否成立。
  这是 P3 最不确定的假设（编译器/流水线测试都无法回答）。
- **方法**：开发侧挂工具 `po3_smoke` 在宿主进程内发起**一次** `llm.stream` 调用，
  使用 `interpreter.js` 的 `SYSTEM_PROMPT` + `buildUserMessage`，输入为开发集 D-01 的原话。
  产出后用真实的 `parseInterpreterOutput` → `reduce` → `compileAudited` 离线走完全链路。
- **成本**（一次调用，已记录）：`deepseek-official/deepseek-v4.1-flash-expires-on-0910`，
  7580 ms，思考 2758 字，用量 `input 717 / output 1843 / total 2560`，`finish=stop`。
- **实际结果（首次即通过）**：
  - **`parsedOk: true`，`provenanceProblems: []`** ⇒ 模型**遵守逐字引文契约**；
    5 条 `user_requirement` 的引文全部能在原话里逐字找到
    （`不要预览文件夹内的其他文件` / `制作一个单html程序` / `极其精细的现代主战坦克模型` / `可以预览` / `操控`）。
  - 产出 11 条：5 `user_requirement` + 3 `quality_interpretation` + 2 `unknown` + 1 `proposal`。
  - **未发明任何硬约束**：没有"必须离线""禁止联网""只能用某个库"。
  - **最关键的一条**：CDN / 外部依赖这个分叉被写成 **`unknown`**
    （"单个 HTML 文件是否允许通过 CDN 等外部地址引入 three.js…还是必须内联自包含"），
    即**没有被替用户拍板**；three.js 本身只出现在 **`proposal`** 里。
- **编译结果**（离线，用真实输出驱动）：
  781 字符 / 预算 1200 / **零丢弃** / `problems: []`；
  四节齐全：requirements(5) / quality(3) / proposals(1) / unknowns(2)。
  完整文本存 `exp/po06/probe-reports/packet-from-smoke.txt`。
- **与用户报告的 0.5.x 失败模式对比（本条的真正价值）**：
  用户反馈 0.5.x 会凭空加"禁联网/禁依赖"并把质量目标压掉；
  同一道题上，0.6 把同一分叉放进了**未决项**，并把质量词展开成**有边界、带标签**的解释。
- **覆盖范围**：一次调用、一个模型、一道题、`temperature=0.3`。
- **未覆盖（不得外推）**：
  - **n=1**。不能据此宣称"模型总会遵守契约"或"质量一定更好"。
  - 未测其它模型、其它温度、其它任务类型。
  - **未测工作 AI 收到该包后的成品质量**——那才是 P3 的对照实验，**仍未做**。
- **关联**：ADR-0016、ADR-0017、`EVAL-REGISTRY.md` E-001

## EV-0035 · 单元 · P4 澄清规划：20/20 通过，问对问题而不变问卷

- **要支持的结论**：澄清可以做到"**只问会改变下一步的用户偏好**"，
  且**不重复问、不拿超时当同意**——全部在纯函数层可验证（不触达用户界面）。
- **方法**：`po06/lib/clarifier.js`（纯函数）+ `po06/test/clarifier.test.mjs`（20 项）+ 5 个变异项。
  同时扩展 `schema.js`/`reducer.js`：`unknown` 条目可携带 `unknownClass` 与 `blocksAction`
  （且**只对 `unknown` 合法**，误用在其它 kind 上会被 schema 拒绝）。
- **三分类（ADR-0020）**：

  | `unknownClass` | 处置 | 测试 |
  |---|---|---|
  | `user_preference` | **候选提问** | 成为提问候选 ✓ |
  | `lookupable_fact` | 交给查证，**不丢回用户** | 路由到 `lookup`、`mode=none` ✓ |
  | `implementation_detail` | 交给工作 AI 自行决定 | 路由到 `decide`、`mode=none` ✓ |
  | 缺省/非法值 | 保守视为 `user_preference` | ✓ |

- **防问卷的四道闸**：
  1. `blocksAction === false` 的条目不打扰（用户显式声明不影响下一步）。
  2. 每批默认最多 **2** 问（可收紧到 1，`0` 则完全不问），其余进 `deferred`。
  3. **同一 decisionId 一旦问过（任何非 `proposed` 状态）永不再问**——
     这是"前置优化器与工作 AI 不重复问"的机制保证。
  4. 支持限定范围的**授权自主**：`isDelegatedFor(state, id, 'color')` 为真、
     换到 `'layout'` 为假（只在该范围免问）。
- **语义隔离**：`answered` 必须带 `answerSource`；拒答/跳过/授权是**四种不同状态**；
  **超时不做任何状态转移**（`onTimeout()` 返回 `op:null` + 理由 `timeout-is-not-consent`），
  专门防止有人图省事把超时写成授权。
- **变异检验**：5 个新变异全部被捕获（去掉"已问过"检查、去掉批次上限、
  把可查事实改道去问、把超时当授权、不要求 answerSource）。
  累计 **19 个变异跨 6 个源文件，全部被捕获**。
- **未覆盖**：
  - **未接真实 `userQuestions.ask`**——正向提问会打扰用户，按 ADR-0010 留到与用户约定的时机；
    本轮的 `planningToOps` 只产出 `add_question` 状态，**不会弹窗**。
  - 未验证模型是否会给 `unknownClass` 打对分类（需一次真实调用，属 P4 后续）。
- **关联**：ADR-0010、ADR-0020

## EV-0036 · 集成（离线）· 澄清接入流水线；并修掉"规划不幂等"的设计缺陷

- **要支持的结论**：澄清能在**不弹窗**的前提下接进主链路，且对同一决定**只规划一次**。
- **方法**：`pipeline.js` 的 `committed` / `noop` 两条路径上于 `finish` 之前调用
  `planAndRecordClarification()`；只在 `mode==='ask'` 时写 `add_question`（状态 `proposed`）。
  `po06/test/pipeline.test.mjs` 增至 16 项；`interpreter.js` 的契约加入 `unknownClass` 说明。
- **实际结果**：
  - 用户偏好未知 → trace 出现 `clarify(mode=ask)` + `recordQuestions(ok)`，
    状态里 question 的 status = **`proposed`（不是 `asked`）** ⇒ **确实没有触达用户界面**。
  - 可查事实 / 实现细节 → `mode=none`，分别进 `routed.lookup` / `routed.decide`，**不记录问题**。
  - trace 步骤序列变为 `init → recordInput → interpret → parse → recheck → dryRun → commit → clarify → setContext`。
- **本轮抓到的设计缺陷（ADR-0021）**：集成测试报 `must not re-ask the same decision: expected "none", got "ask"`。
  根因是 `alreadyHandled()` 只把**终态**算作已处理，而流水线记录的问题永远停在 `proposed`
  （因为我们从不真的去问）→ 每次输入都会**重新规划同一个问题**，
  而记录时又会因**重复 id** 被 reducer 拒绝。即"规划说该问、记录却失败"的不自洽。
- **处置**：新增 `hasQuestion()`（任何状态，含 `proposed`），规划层改用它 ⇒
  **规划对每个 decisionId 只发生一次**；"把问题投递给用户"是另一步（读 `proposed` 记录）。
  另加显式用例证明"重复记录会被 reducer 以 `DUPLICATE_ITEM` 拒绝"——
  正是这条推动了把幂等性上移到规划层。
- **变异检验**：累计 **20 个变异跨 6 个源文件，全部被捕获**。
  过程中一条旧变异因源码行改写而报 `ANCHOR-MISSING`——
  变异检验**把它当失败报出而非静默跳过**，这是正确行为；已将其改写为瞄准 `hasQuestion` 实现。
- **未覆盖**：真实提问路径（遵守 ADR-0010，需与用户约定时机）；
  模型能否正确给出 `unknownClass`（需一次真实调用）。
- **关联**：ADR-0020、ADR-0021

## EV-0037 · 真实模型 · `unknownClass` 契约**未被遵守**（两次实测，含一次修复尝试）

- **要支持的结论**：模型是否会按契约给 `unknown` 打分类——整个澄清路由建立在这之上。
- **方法**：开发侧挂工具 `po4_unknown_smoke` 发起真实 `llm.stream` 调用（同 EV-0034 的设置），
  产出后用真实 `parseInterpreterOutput` → `reduce` → `planClarification` 走完整链路。
- **实测 1（散文规则已在契约里）**：
  - `parsedOk=true`（逐字引文契约**仍然守住**）；两个 `unknown` 的 `unknownClass` **均为 `(absent)`**。
  - 结果：两者都回落到默认 `user_preference`，`plan.mode='ask'`、2 个问题。
  - 成本：2719 tokens / 8102 ms。
- **失败的修复尝试**：我判断"模型是照着 JSON 示例输出的，而示例里没有 `unknownClass`"，
  于是把该字段**加进示例**并加强提示（"上面示例里的字段就是全部字段"）。**该假设被证伪**：
- **实测 2（字段已在示例里）**：
  - 两个 `unknown` 的 `unknownClass` **仍然 `(absent)`**。
  - 成本：2293 tokens / 6234 ms。
- **结论（n=2）**：该模型**不输出**这个字段，散文规则与 JSON 示例都试过。
  **不得假定分类可用**；澄清路由的 `lookup` / `decide` 分流当前**拿不到输入**。
- **实际影响评估（诚实版）**：
  - 退化方向是"未知一律当作用户偏好"⇒ 可能把**本该自己去查的事实**拿去问用户。
  - 但问卷风险被**批次上限（默认 2）**兜住——最坏情况是每次最多 2 个问题，不会变成问卷。
  - 两次实测中分类结果**碰巧都是对的**（CDN 政策、车型、操控范围确实都是用户偏好），
    但这属于运气，不是机制在起作用。
- **处置**：
  1. **保留**路由机制（它正确且有 21 项测试），等分类来源可用时即刻生效；
  2. 让"契约未遵守"**可见**：`planClarification` 新增 `unclassified` 计数并进 trace——
     不许静默当作分类成功；
  3. 不追加第三次猜测性修复。若将来要让分类真正可用，应改用**独立的、可验证的分类步骤**
     （例如一条只问分类的短调用，或由宿主侧规则推导），并同样先用真实调用验证。
- **未覆盖**：其它模型是否也如此（只测了一个模型）。
- **关联**：ADR-0022、ADR-0020

## EV-0038 · 单元 · P5 长任务：`task`/`turn` 作用域 15/15 通过

- **要支持的结论**：**"只改颜色，其他别动"这类本轮指令不该变成永久约束**——
  否则后续每一轮都被它绑住；同时长期目标不能被本轮指令挤掉。
- **方法**：`schema.js` 增 `SCOPES`、状态增 `turnId`；`reducer.js` 增 `advance_turn` op
  与条目 `scope`/`turnId`；`compiler.js` 增「本轮要求（仅本轮有效）」节并按 `where` 过滤。
  `po06/test/longtask.test.mjs`（15 项）+ 4 个变异项。
- **实际结果（15/15）**：
  - 缺省 `scope='task'`；`scope='turn'` **只对 `user_requirement`/`user_decision` 合法**
    （机器解释不可"只在某一轮有效"）。
  - 编译分节：本轮条目进「本轮要求（仅本轮有效，下一轮不再适用）」，
    **长期目标与约束仍在「明确要求」里**（测试直接断言 `单 HTML 程序` 与
    `不要预览文件夹内的其他文件` 都还在）。
  - **推进轮次后上一轮的本轮指令退役**（`status='superseded'`，**不删除**，保留可追溯），
    长期条目**保持 active**。
  - 退役后的本轮指令**不再出现在意图包**里，且空节不渲染。
  - 新一轮的本轮指令与上一轮互不影响。
- **两条场景复核（对应用户原话）**：
  - 「只改颜色，其他别动」→ 工作 AI 同时看到：本轮只改颜色 + 长期仍是单 HTML + 不得预览其他文件，
    且本轮指令被明确标注「仅本轮有效」，不会被读成永久禁令。
  - 「换个风格」→ 新风格生效，**原交付约束不丢**，审计通过。
- **撤销**：`supersedes` 让旧决定退出编译、新决定生效（`标题用蓝色` 不再渲染）。
- **变异检验**：4 个新变异全部被捕获（去掉退役、把 scope 恒为 task、
  去掉 requirements 的 where 过滤、去掉 turn 作用域的 kind 守卫）。
  累计 **25 个变异跨 7 个源文件，全部被捕获**；7 套单测 **115 项**全绿。
- **未覆盖**：
  - **未接真实宿主**：`advance_turn` 目前由调用方显式触发；"何时算新的一轮"（用户新消息？
    agent 新 turn？）**尚未接线**，这是 P5 剩余的关键问题。
  - 未测压缩/重启/fork 后作用域是否保持（属 P5 后续）。
- **关联**：ADR-0023

## EV-0039 · 集成（离线）· 定义并接线"新一轮"：一条用户消息 = 一轮

- **要支持的结论**：`advance_turn` 的触发时机有了明确口径并已接线、可验证。
- **口径（ADR-0024）**：**一条用户消息 = 一轮**；`turnId = 'turn:' + messageId`。
  - **理由**：`turn` 级指令限定的是"这一次请求"；用户下一句话就是在对新请求提要求。
  - **明确排除**：**agent 内部的 turn（工具调用循环）不算新的一轮**——
    否则工作 AI 多步执行会把本轮指令提前退役。
- **接线位置**：`pipeline.js` 在 `recordInput` **之后**、读 `base` **之前**提交 `advance_turn`。
  必须在解释之前推进，否则解释器看到的还是上一轮的 `turn` 级指令，可能据此重复添加已过期内容。
- **实际结果（pipeline 19/19）**：
  - 第 2 条消息的 `turn` 指令在其本轮内有效；第 3 条消息到达时该指令**退役为 `superseded`**，
    长期目标 `req-html` **保持 active**；意图包里"只改颜色"消失、"单 HTML 程序"仍在。
  - **幂等**：`turnId` 由 `messageId` 决定，同一条消息重复处理**不会误退役本轮的 `turn` 条目**
    （测试直接断言再次处理后仍为 `active`）。
  - **解释器看到的是推进后的状态**：它看到旧 `turn` 条目已是 `superseded`、且 `turnId` 已是新的，
    不会基于过期状态做判断。
- **变异检验**：2 个新变异全部被捕获（去掉 `advance_turn` 调用、去掉 `turnId` 幂等判断）。
  累计 **27 个变异跨 7 个源文件，全部被捕获**；7 套单测 **124 项**全绿。
- **未覆盖**：
  - **未在真实宿主上跑多轮**（本轮是离线桩）；真实多轮需真实模型调用。
  - **steering 语义未定**：用户在 agent 运行中途插话时算不算新的一轮——当前实现算，
    但这意味着"只改颜色"会立刻失效。**该语义需要在真实长任务上观察后再定**。
  - 压缩/重启/fork 后 `turnId` 与作用域的保持未测。
- **关联**：ADR-0023、ADR-0024

## EV-0040 · 单元 · P5-3 保持性：省略声明、序列化往返、压缩、fork 继承 9/9

- **要支持的结论**：长任务跨越**预算压缩、持久化重启、fork** 之后，作用域与状态语义仍然成立；
  且"装不下"必须**明说**而不是静默。
- **方法**：`po06/test/carryover.test.mjs`（9 项）+ 3 个变异项。
- **先修掉的一个真实缺口**：`compile()` 一直在计算 `droppedSummary`，但**从来没有把它渲染进意图包**——
  也就是超预算时会**悄悄丢东西**，而计划明确要求"写明压缩了什么"。
  现已渲染为【本次省略】并附"若其中有用信息影响判断，请向我确认"。
- **本轮修正的第二个问题**：省略声明**本身要占字符**，而必保节永不丢弃，
  因此存在**无论如何都装不下**的情形。按计划"显式降级"的要求，
  改为渲染【预算不足】说明；丢弃循环重写为**把声明本身计入预算**（每轮重算）。
- **实际结果（9/9）**：
  - 丢弃发生时意图包**写明**省略了什么并邀请确认；装不下时**显式降级**（`overBudget` + 包内说明）。
  - **序列化往返**：含 `scope`/`turnId` 的状态经 JSON → `stateSchema.parse` 后，
    `turnId`、条目的 `scope`/`turnId`/`status` **全部保持**（重启路径）。
  - **压缩安全（本项目依赖的强性质）**：**仅凭最后一条状态事件**即可重建出**与实时状态相等**的完整状态；
    "折叠全部事件"与"只折叠最后一条"结果一致 ⇒ 压缩丢掉旧事件**不丢状态**（whole-value 事件的直接收益）。
  - **fork 继承**：从 `init` 折叠被继承的事件前缀，得到与父会话一致的快照；
    子会话推进轮次**只影响自己那份状态**（纯函数，父快照未被触碰）。
  - 非本插件事件在折叠时**返回同一引用**（ADR-0011 在恢复路径同样成立）。
- **变异检验**：3 个新变异全部被捕获（不渲染省略声明、去掉预算不足说明、破坏全值采纳）。
  累计 **30 个变异跨 8 个源文件，全部被捕获**；8 套单测 **127 项**全绿。
- **未覆盖**：
  - **真实重启**（宿主启动时 hydrate）**仍未验证**——需真重启，会中断用户会话。
  - **真实 fork** 未在宿主上跑（本轮是折叠语义层验证）。
  - 压缩对 `turnId`/作用域的影响只在"全值事件"层面证明，未在宿主真实压缩后核对。
- **关联**：ADR-0025、ADR-0023

## EV-0041 · 单元 · P6 验证器与有限反馈：24/24 通过

- **要支持的结论**：机器检测到的"不对劲"**不会自动变成返工**——
  基础设施故障、未知、审美建议都被挡在返工门外；返工受**任务级**总预算约束。
- **方法**：`po06/lib/verifier.js` + `po06/lib/feedback.js`（纯函数）
  + `po06/test/feedback.test.mjs`（24 项）+ 4 个变异项。
- **验证侧的硬约束（均有用例）**：
  - 结论必须绑定**产物 sha256**；缺了直接拒绝（"结论必须绑定产物版本"）。
  - 每条检查必须有 **observation**；没有观察就不是证据。
  - `pass`/`fail` 必须有 **evidenceRefs**；`unknown`/`infra` 可无。
  - 必须显式声明 **coverage 与 notCovered**（机器检查通过**不等于**作品合格）。
  - 结果只有五种；**只有 `fail` 进入可返工集合**。
  - `isStale`：产物变了旧记录即过期，**未知 hash 视为过期**（保守）。
- **返工侧的六道门（均有用例）**：① 有可返工失败 ② 绑定当前产物版本 ③ 未被用户新输入作废
  ④ 在用户授权范围内 ⑤ 任务级预算未耗尽 ⑥ 不是同一失败的重复投递。
  基础设施故障被拒的理由是 `infrastructure-error-is-not-a-product-defect`；
  全部 unknown 被拒的理由是 `unknown-result-is-not-evidence`。
- **去重键跨产物版本累计**：`dispatchedKeys` **不随版本变化而清空**，
  因此"每版各修一次"无法绕过总预算（测试显式验证换版本后仍在 2 轮上限内停止）。
- **返工指令文本**：只陈述观察到的现象与复现条件，
  推测原因**标注"未证实"**，并明写"不要扩大改动范围"；
  测试断言其中**不含**"重写整个/全部推倒"这类越权要求。
- **本轮调整的一处判断**：`shouldStop` 原先把"轮数耗尽"排在"无进展"之前。
  两者同时成立时，"无进展"告诉用户的是**修了但没用**，"轮数耗尽"只说明预算用完——
  前者诊断价值更高，故**报告优先级改为按信息量排序**（显式停止 > 无进展 > 时间 > 次数 > 轮数）。
- **变异检验**：4 个新变异全部被捕获（把 infra 当可返工、去掉 evidence 要求、
  关掉过期判断、关掉去重）。累计 **34 个变异跨 9 个源文件，全部被捕获**；9 套单测 **151 项**全绿。
- **未覆盖**：
  - **未接真实验证器**（没有任何真实截图/几何检测接进来），本轮只验证了**判定逻辑**。
  - **未接真实投递**（返工消息尚未经 `agent.inject`/`followup` 发出去）。
  - 端口/进程类验证（EV-0023 的 `infrastructure_error` 真实场景）未在宿主上跑通。
- **关联**：ADR-0026、ADR-0012

## EV-0042 · 真机 · HTML 交付物验证器：4 个已知期望分类的样本全部判对（5/5）

- **要支持的结论**：真的接了一个验证器，且它**确实在检测**（不是形式上的壳）。
- **方法**：`po06/lib/verifier-html.js` —— 用**真机 CDP**（msedge headless + Node 内置 WebSocket，
  零第三方依赖）打开被交付的 HTML，采样 DOM 状态、未捕获异常、画布后备缓冲尺寸与帧内中心像素。
  测试：`po06/test/verifier-html.test.mjs`，本机浏览器 = `msedge.exe`。
- **四个样本与期望分类（全部判对）**：

  | 样本 | 期望 | 实测 |
  |---|---|---|
  | 好件（画布 640×480 + WebGL 清屏） | 无可返工失败 | ✓ `actionableFailures.length === 0` |
  | 坏件·画布 `width=0,height=0` | `fail` | ✓ observation 含实测尺寸 `0x0`，带证据引用 |
  | 坏件·加载即抛未捕获异常 | `fail` | ✓ observation **引用真实错误原文** `PO06-FIXTURE-BOOM` |
  | 可疑件·画布有尺寸但恒为纯色 | **`unknown`，不得 fail** | ✓ `canvas-content-sampled` 为 `unknown` |
  | 文件不存在 | `fail`，且**不启动浏览器** | ✓ 仅 1 条 check，短路返回 |

- **适用范围写进了记录本身**：`coverage`（文件可读/能打开/DOM ready/无异常/画布尺寸非零）与
  `notCovered`（审美与构图/玩法正确性/性能/非画布视觉缺陷/用户是否满意）随每条记录一起产出——
  机器检查通过**不等于**作品合格，这一点是数据结构层面的，不靠人记得。
- **本轮由我自己的规则逼出来的修正**：P6-1 定的"fail 必须有 evidenceRefs"让"文件不存在"这条**建记录失败**。
  规则本身是对的（没证据的失败不该成立），修的是证据引用——应指向**我们检查过的那个路径**。
- **一处明确的覆盖排除（诚实登记）**：`verifier-html.js` **不纳入变异检验**——
  每个变异要真机跑一遍浏览器（数秒级），会让变异检验从秒级涨到分钟级，收益不成比例。
  它的可证伪性由**四个已知期望分类的样本**承担（上表），并已写进 `mutate-check.cjs` 的文件头。
- **未覆盖**：
  - 未接**返工投递**（返工指令尚未经 `agent.inject` 发出）——P6 剩余。
  - 只测了单文件 HTML 一类交付物；未测多文件、需联网、需长初始化的页面。
  - **未测"好件但初始化慢"**：真实项目里 2 秒时还挂着错误覆盖层、45 秒才跑起来的页面，
    当前采样策略（见画布有尺寸即停）可能给出过早的结论。
- **关联**：ADR-0026、ADR-0027

## EV-0043 · 单元 · P6-3 交付门：三级投递 14/14 通过

- **要支持的结论**：验证结论能按**授权等级**投递，且默认什么都不发；
  同时"产物不合格"的判断**不被授权状态污染**。
- **方法**：`po06/lib/gate.js`（编排：验证 → 六道门判定 → 按等级投递，三件都可注入）
  + `po06/test/gate.test.mjs`（14 项，**离线桩**，不启动浏览器、不调模型）+ 4 个变异项。
- **三级投递（ADR-0028）**：

  | 等级 | 行为 | 何时启用 |
  |---|---|---|
  | **L0 record**（默认） | 只记录与展示，**什么都不发** | 未开启自动返工 |
  | **L1 queue** | `inject` 排入下一步，**不唤醒** | 开启自动返工 |
  | **L2 wake** | `followup`/`steer` 唤醒，**会让工作 AI 立刻动起来** | 用户显式允许唤醒 |

- **实际结果（14/14）覆盖**：
  - 默认 L0：验证照跑、verdict 为 `rework-eligible`，但**一次都没投递**，理由 `delivery-level-is-record-only`。
  - L1：投递一次并记账；指令里含"未证实"与"不要扩大改动范围"。
  - L2：仅在显式开启时发生。
  - 全部通过 → `pass`；只有 unknown → `inconclusive`（**两者不再糊成一个结论**）。
  - 基础设施故障 → `infrastructure_error`，不进入修作品流程。
  - 未授权 → 仍判 `rework-eligible` 但**零投递**。
  - 用户改口 → `superseded-by-newer-user-input`。
  - **任务级预算跨产物版本生效**：第 3 轮被拦。
  - **台账已停 → 连验证器都不跑**（省成本）。
  - 验证器抛错 / 无记录 → 明确标记且不投递。
  - **投递失败不消耗预算**（`repairRounds` 保持 0）——否则失败了还照样扣额度。
- **本轮由失败用例逼出的两处语义修正（都写进了 ADR-0028）**：
  1. **授权被混进了"产物是否有缺陷"的判断**。已拆开：六道门回答"这份产物是否确实不合格"，
     "能不能发出去"由投递等级决定。未授权时 verdict 仍是 `rework-eligible`，只是零投递。
  2. **"全部通过"与"没有可判定证据"被糊成同一个结论**（原为 `pass-or-inconclusive`）。
     已拆为 `pass` 与 `inconclusive`——二者对用户的含义完全不同。
- **另注**：预算用例中第 3 轮实际返回 `stopped / no-progress`，
  而非"轮数耗尽"——这正是 ADR-0026 的**报告优先级**在起作用（"修了但没用"信息量更大）。
  测试已按此语义断言，并注明原因。
- **变异检验**：4 个新变异全部被捕获（默认等级不保守、L0 仍投递、投递失败照样扣额度、去掉预检停止）。
  累计 **38 个变异跨 10 个源文件，全部被捕获**。
- **未覆盖**：**未接真实宿主触发**（监听 `deliverables/presented` 并调用 `runGate`），
  本轮只验证了编排逻辑；真实投递（`agent.inject`）也未接线。
- **关联**：ADR-0026、ADR-0028、ADR-0012

## EV-0044 · 集成（真实宿主 + 真机浏览器）· 交付门全链路 PASS

- **要支持的结论**：交付门在**真实宿主**上端到端成立——真机验证 → 判定 → 按等级真实投递。
- **方法**：`po06/lib/index.js` 接入 `verifyHtmlFile` 与 `runGate`；标记文件触发自检；
  自检在自建会话上对**确定缺陷件**与**好件**各跑一次真机验证。
  交付门**生产触发默认关闭**（`enable-gate-trigger.flag`），因为每次交付都启动浏览器是重操作。
- **实际结果（PASS）**：

  | 步骤 | 观测 |
  |---|---|
  | **L0（默认）** | `rework-eligible`、等级 `L0-record`、`delivered: null`、**inbox 增量 0** ⇒ 默认什么都不发 |
  | **L1** | `rework-eligible`、等级 `L1-queue`、投递成功（有 messageId）、**`turnStarted: 0`** ⇒ 排队但不唤醒 |
  | 好件 | `verdict: pass`、`reasons: []` ⇒ 不产生可返工失败 |
  | 触发开关 | 默认关闭（`triggerDefaultOff: true`） |

- **真实宿主上抓到的三个问题（都修了）**：
  1. **`ctx.on` 在 `apply` 返回后的异步续体里会报 `cannot create effect on inactive context`**。
     自检里原本用 `ctx.on` 监听事件，已改为**会话事件快照差分**（`snapshotEvents()`），不注册 effect。
     （`apply` 内**同步**注册的监听不受影响。）
  2. **`pass` 永远不可达**：`中心像素采样`被设计成恒 `unknown`（不据此判失败），
     却被计入"全部通过"，导致**好件永远只能是 `inconclusive`**。
     已引入 `informational` 标记：这类**只作观察留档、不参与判定**的检查不阻碍 `pass`。
  3. **误导性配对**：出现 `verdict: pass` 旁边挂着 `unknown-result-is-not-evidence`
     （那条理由讲的是"为何未进入返工"，与 verdict 无关）。已在判 pass 时清空。
- **一处实现缺陷（自查发现）**：`computeSha` 首版写成 `await import(...)`（异步），
  而调用方是同步使用 —— 已改为顶层同步 import。
- **未覆盖**：
  - **真实触发路径未跑**：`deliverables/presented` 监听已注册但默认关闭，
    因此"真实交付时自动验证"这条链路**只在默认关闭状态下验证过**（断言 `triggerDefaultOff === true`）。
  - 采样策略对**慢初始化页面**仍可能过早判定（EV-0042 已登记）。
  - `pass` 的判定依赖 `informational` 标记正确使用；若将来有人把决定性检查误标为 informational，
    会造成漏判——**目前没有守卫**（已知缺口）。
- **关联**：ADR-0028、ADR-0029

## EV-0045 · 单元 · P8 配置迁移：14/14 通过（不机械映射、旧状态不冒充需求）

- **要支持的结论**：旧配置迁移**不会**在用户不知情的情况下改变语义；
  无法映射的项**要用户决定**，旧状态**不得**冒充已确认需求。
- **方法**：`po06/lib/migration.js`（纯函数）+ `po06/test/migration.test.mjs`（14 项）+ 4 个变异项。
  样本取自本机真实旧配置的字段集（`tier/permission/model/readTools/delivery/strategy/ui/
  turns/historyMode/fullOn/perSession/outcomes/revision`）。
- **实际结果（14/14）**：
  - **每个档位映射都带解释，且显式声明可逆性**：`off` 声明"**等价**、完全可逆"；
    `basic/advanced/extreme` 一律声明 `partial` 且注释里说明**不等价**（例如旧高级的"读文件权限"
    在 0.6 里属于会话策略，不由该项决定）。
  - **未知档位 / 档位缺失 → 进 `unmappable`，不猜**。
  - **语义不同的旧项全部如实列出**：`permission / delivery / reasoningEffort / turns /
    historyMode / fullOn / readTools / strategy`，每条都有**自足的理由**。
  - **旧会话级配置标 `legacy-unverified`**，说明里写明"**不得**导入为已确认要求"。
  - **`applyMigration` 缺用户选择即抛错**（不猜），给齐后才产出新设置；
    新设置里**不含** `tier` / `strategy` 等旧字段。
  - **回滚 = 原样还原备份**（深拷贝，返回对象被改动不影响备份）；
    无备份时如实失败并给出 `no-backup`。
  - 迁移报告含 dry-run 标记、解释、待决项、旧状态处置与可逆性。
- **本轮由失败用例逼出的两处质量问题**（都是**源文件**的问题，不是测试太严）：
  1. `off` 的说明只写了"语义一致"，没说清这是**等价**映射 → 已改为显式声明"**等价**、完全可逆"。
  2. `fullOn` 的理由只写了"**同上**" → 依赖上下文的理由不算理由，已改写为自足说明。
- **变异检验**：4 个新变异全部被捕获（旧状态标为 imported、不要求用户选择、
  回滚按引用返回、三档声称完全等价）。累计 **42 个变异跨 11 个源文件，全部被捕获**。
- **未覆盖**：**未在真实旧配置上跑过一次真迁移**（本轮用样本 fixture）；
  宿主侧的读写接线（备份、dry-run、写回）尚未实现。
- **关联**：ADR-0030

## EV-0019 · 集成（真实宿主）· 0.5.x 在本地被探测出的历史会话规模

- **要支持的结论**：`agents.list().length = 68`、全部为 root；这是 EV-0018 中 apply 调用量大的直接原因。
- **方法**：探针枚举 `agents.list()` 与 `agents.roots()`。
- **实际结果**：68 / 68；状态集合为 `{idle, running}`。
- **未覆盖**：这些会话是本次运行期加载的，未必等于磁盘上全部历史会话数。
- **关联**：ADR-0011

## EV-0004 · 静态 · 版本化安装目录已被批量覆盖（缺陷 P0-D1）

- **要支持的结论**：本地版本目录不能作为版本存档或 A/B 切换手段。
- **方法**：对四个目录的 `lib/index.js` 取 sha256、字节数与 mtime；与 dev HEAD 比对。
- **实际结果**：
  | 目录 | bytes | sha256 | mtime |
  |---|---|---|---|
  | `dsh-prompt-optimizer-0.4.3-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.4.4-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.5.0-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.5.2-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | dev 仓库 `lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
- **根因定位（静态）**：`evidence/probe.cjs` 第 20–35 行——`readdirSync(base)` 过滤
  `dsh-prompt-optimizer` 前缀目录，随后 `copyFileSync(from, path.join(inst.pkgDir,'lib',f))` 逐文件覆盖。
- **覆盖范围**：`lib/index.js`；各目录 `package.json` 版本字段确实各不相同（0.4.3 / 0.4.4 / 0.5.0 / 0.5.2），
  说明覆盖只发生在 `lib/` 等被同步的文件上。
- **未覆盖**：未逐一检查各目录其它文件（README/CHANGELOG 等）是否也被覆盖。
- **关联**：ADR-0001、ADR-0002

## EV-0005 · 静态 · 运行实例路径与 profile 依赖不一致（缺陷 P0-D2）

- **要支持的结论**：需要显式校验"源码/产物/装配入口/浏览器 bundle"四者一致，否则归因会错位。
- **方法**：`dev_plugin_status` 读 loader entry；读 `~/.dsh/profiles/web/package.json` 依赖；
  读 junction 目标。
- **实际结果**：
  - loader entry = `…/dsh-prompt-optimizer-0.4.3-beta.1/package/lib/index.js`（其 package.json 写 `0.4.3-beta.1`）
  - profile dependency = `file:C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer-0.5.2-beta.1/package`
  - junction 目标 = `C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer-0.5.2-beta.1\package`
  - 三者指向的 `lib/index.js` 字节相同（`5261a575…`）→ 行为一致，仅标签矛盾
- **解释（待验证）**：运行中的 dsh 进程在 profile 指向 0.4.3 时启动，之后 profile 被改指 0.5.2 但未重启。
- **未覆盖**：未查 DSH 进程启动时间来证实该解释。
- **关联**：ADR-0001

## EV-0006 · 静态 · 活动配置与真实生效策略

- **要支持的结论**：评估 0.5.x 行为时，必须记录 state 中的 `strategy`，不能按 README 推断。
- **方法**：读 `~/.dsh/prompt-optimizer.json`；对照 `lib/index.js` 的 `strategyNow()` / `buildSystem()`。
- **实际结果**：
  - state：`strategy=v6`、`tier=off`、`permission=review`、`readTools=true`、`delivery=chat`、
    `turns=10`、`historyMode=turns`、`fullOn=true`、`reasoningEffort=high`、`revision=2234`
  - 代码：`buildSystem` 的 `v6` 分支使用 `LANG_ONLY_SYSTEM` / `STRATEGY_V5_SYSTEM + V044_MID_TAIL` /
    `STRATEGY_V5_SYSTEM + V044_ASK_OVERRIDE`，并追加 `CLOSING_SELFCHECK`、ask 条款与 delivery 投影。
  - 顶层 `tier=off` ⇒ 新会话默认不拦截。
- **覆盖范围**：state 文件与策略选择逻辑。
- **未覆盖**：本次未实跑验证 `delivery`/`effort` 的实发值；截断与工具轮次的实际行为未测。
- **关联**：baseline-manifest.json → arms.D_05x.liveConfigAtP0

## EV-0007 · 静态 · 计划文档入仓且逐字节一致

- **要支持的结论**：仓库内的 `PLAN-0.6.md` 就是经审查的主文档，没有被改写。
- **方法**：复制后取 sha256，与落盘审查时的值比对。
- **实际结果**：`2734fdbd0afd03f37ff30e1968528af074bd518d87519e31f764bd46dffec62a`（81134 bytes），
  与 `.dsh/docs/prompt-optimizer/V0.6-MASTER-PLAN.md` 相同。
- **关联**：ADR-0004
