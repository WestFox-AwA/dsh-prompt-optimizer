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

## EV-0046 · 单元 · P8 灰度开关与迁移/回滚演练：11/11 通过

- **要支持的结论**：灰度**保守默认**且**绝不双重拦截**；迁移与回滚有**可重复执行的演练**。
- **方法**：`po06/lib/rollout.js`（纯函数）+ `po06/test/rollout.test.mjs`（11 项，含一次
  **完整迁移/回滚演练**，全程在**临时目录**，**不碰真实配置**）+ 4 个变异项。
- **实际结果（11/11）**：
  - **保守默认**：非法或缺失配置一律回落 `off`，并记录回落原因；`null` 配置同样不启用。
  - **allowlist 精确匹配**：`session-a` **不会**匹配 `session-ab` / `session-` / `SESSION-A`；
    空 allowlist 等同全不启用；空/null 会话 id 一律不启用。
  - **稳定可复现**：同输入多次判定结论一致（无随机成分）。
  - **双重拦截守卫**：旧插件仍在装配 **且** 0.6 已启用 ⇒ **拒绝启用**，
    理由明写后果（"一条消息会被两个拦截器处理两次"）。
    这是最容易造成"消息被改两次"的事故点，**由代码拦住，不靠人记得**。
  - `decideEnabled` 给出**单一结论 + 可机读原因**（`rollout-off` / `session-not-in-allowlist` /
    `settings-disabled` / `DOUBLE_INTERCEPT` / `enabled`）。
  - `all` 模式的报告带 ⚠️ 警告并提醒确认旧版已卸载。
- **迁移/回滚演练（可重复执行）**：
  ① dry-run **不改文件**（逐字节比对）→ ② 迁移前**备份** → ③ **缺选择即抛错**（不猜）→
  ④ 写回后旧字段（`tier`/`strategy`）**不存在**、`legacyState` 保留 →
  ⑤ **回滚后与原文件逐字节一致** → ⑥ 备份在回滚后**不被自动删除**。
- **变异检验**：4 个新变异全部被捕获（非法配置回落 all、allowlist 用前缀匹配、
  去掉双重拦截守卫、忽略设置开关）。累计 **46 个变异跨 12 个源文件，全部被捕获**。
- **未覆盖**：
  - **未在真实配置文件上执行过迁移**——演练全程在临时目录；真实执行属发布阶段，
    且必须先有用户明确的迁移决定。
  - 宿主侧的"读取旧配置 / 写回 / 备份路径选择"尚未接线。
  - 灰度与宿主装配的关系（如何探测"旧插件仍在装配"）**只定义了接口，未实现探测**。
- **关联**：ADR-0031、ADR-0030

## EV-0047 · 单元 · P8 宿主侧迁移接线与旧插件探测：11/11 通过

- **要支持的结论**：迁移能安全地在真实配置上执行——**默认不改任何东西**，改之前必有退路。
- **方法**：`po06/lib/host-migrate.js` + `test/host-migrate.test.mjs`（11 项，
  **全程临时目录，未碰真实配置**）+ 4 个变异项。
- **两条安全性质（均有用例）**：
  1. **默认 dry-run**：不显式传 `dryRun:false` 就**绝不写配置**（测试做逐字节比对）。
  2. **写之前必须备份**，备份失败即中止（不带着"没有退路"的状态去改用户配置）。
- **实际结果（11/11）**：
  - 默认 dry-run：文件**逐字节不变**；报告标 `dry-run：是` 并披露 `legacy-unverified` 处置。
  - 无配置：如实说"按全新安装处理"，**不算失败**。
  - **缺选择 → 中止，且连备份目录都不创建、配置不动**（先算后写，算不出来就不碰）。
  - 给齐选择 → 备份 + 写回；备份内容**与迁移前文件逐字节一致**；旧字段（`tier`/`strategy`）消失；
    `legacyState.disposition` 记录在案。
  - **回滚逐字节还原**，且**备份在回滚后保留**（那是唯一的退路）。
  - 无备份时回滚如实失败（`no-backup`），**不动配置**。
  - **配置损坏**：不抛错、不写文件，如实报 `unreadable-config:`。
- **旧插件探测（静态）**：profile 干净 → 判为不在装；`dependencies` / `bundles` / 模块目录
  三者任一命中 → 判为在装，并**给出具体证据**。
  探测结果显式标注 `confidence: 'static'` 与 `caveat`：
  **装了但被禁用时会误报**——这是刻意的保守方向（宁可挡住新版，也不冒双重拦截的风险）。
- **变异检验**：4 个新变异全部被捕获（dry-run 不再是默认、缺选择仍继续、
  去掉模块目录探测、去掉 bundle 探测）。累计 **50 个变异跨 13 个源文件，全部被捕获**。
- **未覆盖**：
  - **未在真实 `~/.dsh` 上执行**（这是刻意的；真实执行属发布阶段，需用户明确决定）。
  - 探测是**静态**的，不是运行时活性检查；"装了但禁用"会误报。
  - 未测备份目录不可写、磁盘满等故障注入场景。
- **关联**：ADR-0031、ADR-0032

## EV-0048 · 集成（真实宿主）· 旧插件**运行时**探测 + 启用闸门 PASS（一次"说不"的验证）

- **要支持的结论**：双重拦截守卫不是摆设——它**在该拦住的时候真的拦住了**。
- **方法**：`po06/lib/detect-old.js` —— 不靠读清单，而是**直接查装配结果**：
  旧插件在装配时必然注册动态上下文 `prompt-optimizer:capability`
  （P1 已在真实装配清单里见过它，EV-0009/0015）。
  标记文件触发 P8 自检；桩测 11 项 + 真实宿主复核。
- **实际结果（真实宿主，PASS）**：

  | 观测 | 值 |
  |---|---|
  | 装配上下文清单 | `dsh-super-injector, sandbox:policy, approval:policy, **prompt-optimizer:capability**, prompt-optimizer:intent` |
  | **运行时探测** | `active: true`、`confidence: 'runtime'`、证据「存在动态上下文 prompt-optimizer:capability（341 字符）」 |
  | 静态探测 | 亦命中（dependencies + 模块目录），作为旁证 |
  | 合并结论 | `active: true`，证据来自两个来源 |
  | **启用闸门** | **`enabled: false`、`code: 'DOUBLE_INTERCEPT'`**，理由："旧版插件仍在装配中…一条消息会被两个拦截器处理两次。请先卸载旧版，再开启 0.6。" |

- **为什么这次"拒绝"是好结果**：旧插件**确实仍在装配**（本机 0.5.x 一直在运行），
  所以闸门拒绝启用 0.6 是**正确行为**。
  一个永远说"可以"的守卫等于不存在；这次它在该拦的时候拦住了。
- **相对静态探测的改进**：静态探测会把"装了但被禁用"误报为在装；
  运行时探测**直接读装配事实**，能区分这两种情况。
  两者合并时仍取**保守方向**（任一命中即判"可能仍在装配"）。
- **一个必须记住的边界**：探测依赖 per-agent 作用域（EV-0016）；
  拿不到 agent 时**返回 unknown 而不是"不在装"**——不猜。
- **变异检验**：3 个新变异全部被捕获（无作用域时谎报 active、合并时忽略静态命中、
  把 0.6 自己的上下文名误当旧插件）。累计 **53 个变异跨 14 个源文件，全部被捕获**。
- **未覆盖**：**真实卸载旧插件后再复测**（应转为 `active: false` 并放行）未做——
  那需要卸载你正在用的 0.5.x，属发布阶段动作，需你决定。
- **关联**：ADR-0031、ADR-0033

## EV-0049 · 真机仪器缺陷 · 采样提前收工把「默认 300×150 画布」当成「渲染器装配过」

- **要支持的结论**：**仪器本身会撒谎**。在把任何 A/B/C/D 对照当成产物结论之前，
  必须先证明测量工具在测它声称要测的东西。
- **缺陷**：`verifier-html.js` 的采样循环条件是「有画布且尺寸非零就收工」。
  但 HTML 规范规定 canvas 的 `width/height` **默认就是 300×150**——
  一个从未被渲染器碰过的画布同样"尺寸非零"，于是循环在**第一次采样（约 1.2s）**就退出。
  （讽刺的是：测试文件里早就写着这个默认值——因为坏件夹具必须显式置 `0×0` 才能失败——
  但那条知识没有进入真正决定行为的代码路径。）
- **后果（实测）**：D-01 的 D 臂被读成 `page-loads: fail（readyState=loading）`、
  画布 `300x150`。看起来像"页面起不来"，实际上只是**在 1.2s 时读了它**。
  A/C 只是恰好在 1.2s 前就绪，所以没露馅。
- **修复**（`po06/lib/verifier-html.js`，VALIDATOR 1.0.0 → 1.1.0）：
  提前收工必须同时满足「DOM 就绪」**且**「后备缓冲已被设成非默认尺寸」；
  若 DOM 已就绪而缓冲仍为默认值，再给 `settleMs`（默认 8s）观察窗口后收工。
  `page-loads` 的 observation 现在**必须写出真实等待时长与采样次数**——
  `fail` 必须意味着"真的等满了"，否则无法区分"早退"与"真的加载不完"。
  另：默认尺寸缓冲不再静默通过，改为在 `canvas-nonzero` 上标注 `suspectedCause`
  （但不升级为可返工失败——小块画布用 CSS 放大也可能是像素风的有意设计）。
- **证据**：新增 3 条用例——2 条纯函数判定（含"D.html 那种情形绝不允许提前收工"），
  1 条真机端到端夹具（从未设过尺寸的画布必须采样≥2 次、`page-loads` 判 pass、
  且必须披露 300x150）。验证器套件 5 → **11 项，11/11 通过**。
- **未覆盖**：其它模块是否存在同类「提前收工即下结论」的模式，未逐一审计。
- **关联**：ADR-0034、EV-0052（这条缺陷的**诱因**是机器被泄漏进程拖慢）

## EV-0050 · 真机 · D-01 三臂联网/断网对照：A/C 断网**什么都没有**，D 自足

- **要支持的结论**：在"能不能跑"这个轴上，三臂**联网时无法区分**；
  真正的差别是**产物能不能脱离网络**——而这是原任务（"单 html 程序"）里没被回答的问题。
- **方法**：`exp/po06/bench/D-01/reverify.mjs`，每臂重复 N 次，记录
  readyState / 画布缓冲 / 中心像素 / 外部请求成败 / 绘制调用。
  断网用 CDP `Network.emulateNetworkConditions{offline:true}`（`file://` 不受影响）。
- **实际结果（联网，3 次/臂，全部稳定）**：

  | 臂 | 判定 | 画布 | 外部请求 | 绘制调用 | 三角形 | 首帧 |
  |---|---|---|---|---|---|---|
  | A（原话直发） | 全 pass | 1250x658 | **13 成功** | 699 | 31,976 | t+1508ms |
  | C（原话+0.6意图包） | 全 pass | 1250x658 | **13 成功** | 1001 | 41,478 | t+1614ms |
  | D（0.5.x 命令输出） | 全 pass | 1250x658 | **0** | 4465–4512 | 7.25M–7.32M | t+355ms |

- **实际结果（断网，2 次/臂，全部稳定）**：

  | 臂 | 判定 | 画布 | 外部请求 | 绘制调用 |
  |---|---|---|---|---|
  | A | 无画布 | **无** | 7 失败（ERR_INTERNET_DISCONNECTED） | **0** |
  | C | 无画布 | **无** | 8 失败 | **0** |
  | D | 全 pass | 1250x658 | 0 | ~4.6k（7.4M 三角形） |

- **截图旁证**：断网时 A 是**纯黑页面上一个永远转的 "LOADING …"**（4.5KB PNG）；
  C 只剩静态 HTML 外壳、没有画布；D 的 UI 与画面照旧。
- **为什么这条重要**：A/C 都把 three.js 挂在 `unpkg.com` 上，
  所以"产物能不能跑"里混进了"网通不通"。这不是产物的缺陷、也不是产物的优点，
  而是一条**稳定性事实**：依赖外部地址的产物，渲染结果不再只由自己决定。
  0.6 的意图包把「CDN 还是内联自包含」标成**未决问题**（EV-0034），
  而这次对照给出了这个问题**不回答的代价**。
- **未覆盖**：n=1/臂（同一句话只生成了一次产物），单一模型、单一题目；
  未测"网络慢"（只测了通/断两态）；未测产物在弱网下的表现。
- **关联**：ADR-0034、EV-0051

## EV-0051 · 真机 · 「画了多少三角形」不等于「画出来了」：730 万三角形、零 NaN、仍然看不到车体

- **要支持的结论**：现有交付门里**没有一个信号**能区分"渲染器在跑"与"画面里有该有的东西"；
  而这两件事的差距，正是用户抱怨的那一类失败。
- **方法**：在页面脚本执行前注入（`Page.addScriptToEvaluateOnNewDocument`）包装
  `drawElements/drawArrays/drawElementsInstanced/drawArraysInstanced`，
  按**图元模式**分别累计三角形/点/线；同时扫描 `bufferData/bufferSubData`
  与 uniform 上传中的 NaN。绝不包装 `getError`（它会清错误标志，包装即改变页面行为）。
- **实际结果**：见 EV-0050 表。关键观察：
  - D 臂在 0.7s 内提交 **约 4 500 次绘制、730 万个三角形**，首帧 t+355ms，
    **NaN 计数为 0**，无未捕获异常，画布 1250×658——**全部"健康"**。
  - 可是对照截图：初始视角、12s、20s、以及**滚轮拉远 + 拖拽转视角之后**，
    D 的画面始终只有天空/雾的渐变与 UI，**看不到任何车体**；
    而只画了 3.2 万三角形的 A、4.1 万三角形的 C，都是一辆一眼认得出的坦克。
  - ⇒ 三角形数量与"Oh, it worked"**不是正相关**；把它当质量代理会得出相反结论。
- **尚未确定**：D 的车体为何不可见（相机/矩阵放置？被后画的不透明天空遮挡？
  几何退化到视锥外？）——**没有读它 2174 行源码**，故只报事实、不给机制。
- **已排除**：NaN（0 次）、着色器编译失败（其自带的错误覆盖层未出现）、
  上下文创建失败（画布已建且尺寸正确）、相机不响应输入（视角确实变了）。
- **未覆盖**：审美与玩法（车体是否"精致"、"帅气"）——**这是你的判断，不是我的**。
- **关联**：ADR-0034、EV-0028、EV-0050

## EV-0052 · 工程 · 验证器泄漏 595 个无头浏览器进程、12.2GB 磁盘——并且反噬了测量本身

- **要支持的结论**：**测量工具的卫生问题会污染测量结果**，不只是占磁盘。
- **缺陷**：`verifier-html.js` 的清理是 `child.kill()` + `catch {}` 后删 profile。
  Windows 上 `kill` 只终止我们 spawn 的那个进程，其 renderer/gpu/crashpad
  子进程会变成孤儿继续存活并**锁住 profile 目录**；`rmSync` 因此失败，
  而失败被 `catch {}` 静默吞掉 ⇒ **每次验证都悄悄漏一个 3-15MB profile**。
- **实际结果**：清理时实测 **595 个无头 Edge 进程**（全部 msedge 共 605 个）、
  69 个残留 profile；杀掉进程树后删除，**释放 12,463 MB**。
- **反噬（本次最重要的教训）**：595 个浏览器抢 CPU/内存期间做的测量**自相矛盾**——
  同一份字节（sha256 未变）两次测出不同结论：
  C 一次报 1250x658 WebGL 画布、另一次连续 8 次采样"页面中没有 canvas 元素"（9.9s）；
  D 一次报 300x150 + loading、另一次报 1250x658 + complete。
  我据此差点写下"0.5.x 的产物起不来"这种**错误结论**。
  在干净机器上重测：三臂各 3 次，**全部稳定**。
- **修复**：清理改为三层——先 CDP `Browser.close` 请浏览器自己关，
  再 `taskkill /PID <pid> /T /F` 树杀（`/T` 连子孙），最后带重试删目录；
  结果写进 `raw.profileCleanup`（`'ok'` 或失败路径），**不再静默**。
  并新增 `sweepStaleProfiles()`：启动时只清扫 10 分钟以上的陈旧 profile，
  避免误伤并发进行的验证。
- **证据**：新增 2 条用例（profile 必须真删掉；新 profile 绝不能被清扫）。
  实测：套件跑完 **无头进程 0、残留 profile 0**。
- **未覆盖**：非 Windows 平台的退出/删除语义未实测（本机只有 Windows）。
- **关联**：ADR-0034、EV-0049

## EV-0053 · 仪器缺陷 · `drawArrays` 的 count 参数位次取错，差点把「画了几何」读成「0 个三角形」

- **要支持的结论**：新增的观测能力本身也必须被反向检验，否则它会以更高的可信度说谎。
- **缺陷**：GL 计数器最初对所有函数都按 `arguments[1]` 取顶点数。但
  - `drawElements(mode, count, type, offset)` → count 在 `[1]`
  - `drawArrays(mode, first, count)` → count 在 **`[2]`**，`[1]` 是 `first`（通常是 0）
  手写 WebGL 恰恰最常用非索引 `drawArrays`——它正是 D 臂用的方式（`kinds={drawArrays}`）。
- **后果**：第一版读数把 D 臂报成"94 次绘制、**0 个三角形**"，
  看起来像"几何根本没建出来"。修正后同一份产物读数为
  **4 465–4 512 次绘制、725–732 万个三角形**——结论**完全相反**。
- **修复**：按函数分别指定 count 位次；并按图元模式分开累计
  （TRIANGLES/STRIP/FAN → 三角形，POINTS → 点，LINES/LOOP/STRIP → 线），
  避免把点线误算成三角形。观测文案里明确标注**累计值、非单帧**。
- **证据**：新增用例断言**不变量**而非固定数字——
  `顶点 = 3×三角形 + 点`（夹具每帧 `drawArrays(TRIANGLES,0,300)` + `drawArrays(POINTS,0,50)`
  ⇒ 每帧 350 = 300 + 50）；若位次再取错，三项会同时归零而被抓住。
- **未覆盖**：`drawElementsIndirect`/`multiDraw*` 等 WebGL2 扩展路径未计数。
- **关联**：ADR-0034、EV-0051

## EV-0054 · 集成（真实宿主）· 装配期启用闸门**真的接在装配路径上**（两侧对照 PASS）

- **要支持的结论**：灰度与双重拦截守卫**不再只是自检里的逻辑**，而是决定"拦截到底生不生效"的开关。
  在此之前它们是纯函数 + 自检调用，装配路径上的 `systemPrompt.context` 贡献是**无条件**注册的
  ——**一个只在自检里生效的守卫等于没有守卫**（RELEASE-CHECKLIST 的 A10/A12 缺口）。
- **交付物**：`po06/lib/assembly-gate.js`（新）+ `po06/test/assembly-gate.test.mjs`（13 项）
  + 5 个变异项 + `index.js` 的 P8b 真实宿主自检。
- **设计要点（每条都对应一个失效形态）**：
  1. **默认关、异步判定**：`text(ctx)` 是同步的，旧插件探测是异步的 ⇒ 未决期间只能按保守方向
     处理（不启用）。误报代价是"新版暂不启用"，漏报代价是"一条消息被处理两次"——不对价。
  2. **按 agent 懒判定并缓存**：灰度是 per-session、探测依赖 per-agent 作用域（ADR-0016），
     `apply()` 时还没有 agent。
  3. **绝不把旧配置当成"已启用 0.6"**：本机 `prompt-optimizer.json` 是 **0.5.x 写的**，里面同样有
     `enabled: true`。照它启用就等于让**旧版的启用状态冒充新版的用户决定**（ADR-0030）。
     故只有带 0.6 自己的 `settingsVersion` 标记的配置才被采纳。
  4. **探测结果必须走三态**：`mergeOldPluginSignals()` 在**拿不到作用域**时也返回 `active: false`，
     照抄它会让守卫在最需要它的场景下失效 ⇒ 只有 `confidence === 'runtime'` 才配说"确实不在装"，
     否则是 `null`（不知道）→ 不启用。
- **实际结果（真实宿主，两侧对照 PASS）**：

  | 观测 | 值 |
  |---|---|
  | 写入会话的意图包文本 | 40 字符 |
  | **默认态**装配贡献 | **0 字符**（闸门结论 `rollout-off`） |
  | **强制放行**（探针注入 enabled）后贡献 | **40 字符** |
  | 本机旧插件 tri-state | `true` |
  | 运行时证据 | 「装配结果里存在动态上下文 `prompt-optimizer:capability`（342 字符）」 |
  | 若 0.6 已被配置启用（all）的结论 | `DOUBLE_INTERCEPT`（enabled:false） |
  | 据此真实判定装配贡献 | **0 字符** |

- **为什么这是两侧对照**：只有 (a) 默认 0 与 (b) 强制 40 同时成立，
  才能排除"贡献为空是因为文本根本没写进去/接线没生效"；
  再把 (c) 本机真实探测结果喂给判定函数、(d) 按该结论装配，
  证明的是**双重拦截分支**（而不只是灰度分支）也在装配路径上生效。
- **刻意未做**：由**真实配置文件**驱动的端到端（写 `~/.dsh/prompt-optimizer.json`）。
  那是用户的真实配置，需明确同意（ADR-0032）。因此 (c)(d) 是"真实探测 + 真实判定函数 + 真实装配"
  的组合验证，**不是**配置文件驱动的全链路——不得当作 A8 已完成。
- **同时完成**：`npm pack` 实测（A9）——`dsh-external-dsh-po06-0.6.0-alpha.0.tgz` 65.7KB，
  sha256 `af9dd42b…`，内容 = `files` 清单（17 个 lib + `package.json` + `README.md`）。
- **验证方法**：`node po06/test/assembly-gate.test.mjs`（13 项）+ 5 个变异项
  + `node po06/scripts/check-release.mjs`（16 套 238 项 / 58 变异 全绿）。
- **未覆盖**：真实配置文件驱动的端到端；`private:true` 未改（发布前动作）；
  完整卸载演练（A11）仍未做。
- **关联**：ADR-0030、ADR-0031、ADR-0032、ADR-0033、ADR-0034、EV-0048

## EV-0055 · 静态+单元 · P7 留出评估：封存校验与预算闸门就绪（**一次生成都没跑**）

- **要支持的结论**：P7 之前的状态不是"跑了但没结论"，而是**根本跑不起来**
  （留出集已封存，却没有任何运行器）。本轮把"能不能跑、要花多少、授权够不够"
  变成可复核的东西——**在预算授权之前，代码层面拒绝花钱**。
- **交付物**：`po06/lib/eval-plan.js`（纯函数）+ `po06/scripts/plan-e001.mjs`（入口）
  + `po06/test/eval-plan.test.mjs`（14 项）+ `po06/eval/plan-E001.json`。
- **实际结果**：

  | 观测 | 值 |
  |---|---|
  | 留出集实测 sha256 | `71b8956d8960f75d72003ef3ed14a9b1324b882404d26c39876a0d03638814ac` |
  | 与封存值比对 | **一致**（题数 18 / 编号 H-01..H-18 齐全无重复） |
  | 默认模式（未授权预算） | `dry-run`——只出计划，**不做任何生成** |
  | 18 题 × n=3 × A+C 两臂 | **上界 4,555,494 / 期望 1,974,047 tokens** |

- **三条闸门都被实测验证会拒绝**（退出码 2）：
  1. 预算低于**上界** ⇒ 拒绝（`授权 1000000 < 上界 4555494`）。按上界而非期望值授权，
     是为了避免"跑到一半没钱了"留下半套数据。
  2. 声明 `--arms A,B,C` ⇒ 拒绝：**B 臂（0.4.4）没有实测成本依据**，
     本模块**不编造单价**（标 `unknown` 即拒跑）。
  3. `--runs 1` ⇒ 拒绝：留出集自己写明"n=1 不得用于结论"。
- **成本数字是怎么来的（必须连同假设一起读）**：单题实测**只有一处**——
  `exp/po06/bench/D-01/` 那道大视觉题（A 40,090 / C 44,271 / D 65,446 tokens）。
  非大视觉题按 **0.15 折扣**估计，并在计划文本里显式标注**"这是假设，不是测量"**。
  上界（所有题都按大视觉题计价）才是预算闸门的依据。
- **⚠ 本条的期望值已被 EV-0077 取代**：非视觉题的 **0.15 折扣假设**已换成 **EV-0063 的实测锚点**，
  并补上了此前**漏计的解释层**。S1 期望 **227,775 → 35,016**；全量期望 **1,974,047 → 1,600,398**；
  上界 4,555,494 → **4,591,098**。**引预算数字请用 EV-0077**，本条保留为当时的记录。
- **未覆盖 / 阻塞**：**运行器尚未编写**（生成、评分、非补偿判定计数都还没有）；
  B 臂需要先测出 0.4.4 的单题成本并加载该版本插件；**预算授权只能由用户给出**。
- **关联**：ADR-0027、ADR-0034、EV-0054、`po06/RELEASE-CHECKLIST.md` B2

## EV-0056 · 集成 · **打包产物**装配演练 PASS；并发现"注入的未必是你要验的那份代码"

- **要支持的结论**：此前**所有**验证都跑在源码树上，而真正会发出去的是 `npm pack` 的 tgz。
  两者不是一回事：`files` 清单若漏了某个被 import 的模块 ⇒ 源码树全绿、装出来直接崩；
  源码树里 `test/` `eval/` `scripts/` 都在，装了之后**不在** ⇒ lib 里若偷偷依赖它们，源码树永远查不出来。
- **交付物**：`po06/scripts/install-drill.mjs` + `po06/eval/install-drill.json`。
- **实际结果（PASS）**：

  | 观测 | 值 |
  |---|---|
  | tgz | `dsh-external-dsh-po06-0.6.0-alpha.0.tgz` 71,766 字节，sha256 `ae6ee24f…` |
  | 内容集合 | **18 个 lib 模块 + package.json + README**；无 test/ scripts/ eval/ 夹带 |
  | **仓库外动态 import** | 成功，导出 `adapter, apply, name` ⇒ 包**自足** |
  | 源树字节 | 演练前后**未变** |
  | 宿主侧装配 | 注入**解包出来的那份**（不是源码树）后 `apply()` 正常：`registerContext.ok=true`、投影 `promptOptimizerIntent` 注册成功 |

- **顺带得到的一条真实配置事实**：`~/.dsh/prompt-optimizer.json` **确实存在**（0.5.x 写的），
  而闸门判为 `not-a-0.6-config` / `rolloutMode: off` ⇒ **旧配置不会被当成"已启用 0.6"**
  （ADR-0030 的防护在真实文件上生效，不只是单测）。
- **发现（未根因）**：注入**新打包**的产物时，`apply()` 的报告里**没有** `moduleUrl` 字段——
  而该字段是打包**之后**才加进源码的，说明那次 `apply()` 跑的是**更早缓存的模块实例**，
  不是被指向的那份代码。空 flag、空环境变量下**可复现**（同一秒出现两份 adapter 报告，一份带字段一份不带）。
  后果：注入式验证可能验的是旧代码。这一条**只记录现象与证据，不做机制结论**——
  要根因需要读注入器的模块缓存实现，本轮未做。
- **已加入的防线**：`writeReport()` 现在给**每一份**报告补 `moduleUrl`
  （此前只有 adapter 报告有，自检报告没有），使"这次验证跑的是哪份代码"可复核而不用猜。
  这与 P0-D2（加载路径与依赖路径不一致）是同一类问题。
- **未覆盖 / 不确定性**：14:41 那次重载的 P8b 复测**无结论**——
  报告为 `no agent/systemPrompt to probe`（当时没有 live agent 可作用域化），**不是闸门回归**；
  EV-0054 的 PASS 仍然成立（它产生于一次显式清缓存的重载之后，且 12:46 复现了同一组两侧对照）。
  注入器模块缓存行为**未根因**；`dev_reload_package` 有的路径报"清缓存 1 模块"、有的路径不报，差别未查明。
- **关联**：ADR-0030、ADR-0034、EV-0054、`po06/RELEASE-CHECKLIST.md` A9/A11/D3

## EV-0057 · 集成 · 真实 **npm 安装/卸载**链路 PASS——并因此修正了一条"永远为真"的断言

- **要支持的结论**：本机日常走的是 **junction 注入**路径，**真实 npm 安装链路从未被测过**。
  两者测的不是一回事：npm 会不会接受这个包（`private:true`、`exports`/`main` 指向）、
  `peerDependencies.cordis` 是否**确实**可选（这是"没装 cordis 也能装上"的前提）、
  卸载是否**真的一点不剩**。
- **交付物**：`po06/scripts/npm-drill.mjs` + `po06/eval/npm-drill.json`。
- **实际结果（PASS）**：

  | 观测 | 值 |
  |---|---|
  | 真实 `npm install <tgz>` | 成功，落盘版本 `0.6.0-alpha.0`（与 `package.json` 一致） |
  | **未安装 cordis** | 仍然装上 ⇒ `peerDependenciesMeta.cordis.optional === true` 属实 |
  | 另起进程 import 装好的那份 | 成功，导出 `adapter, apply, name` |
  | 真实 `npm uninstall` | `node_modules/@dsh-external/dsh-po06` 条目消失、`@dsh-external` 作用域目录**空**、`package.json` 依赖项**未残留** |

- **过程中被自己的反向对照抓到一个真问题（重要）**：我最初把"能 import"写在**同一个进程**里，
  于是反向对照（把入口文件改名后再 import）**居然仍然成功**——因为 ESM 有模块缓存，
  同进程 `import()` 命中缓存后**根本不碰文件系统**。这条断言因此**永远为真**，
  哪怕包已经损坏也会报通过。
  修法：import 检查改为**另起 node 进程**执行；修好后反向对照立即成立
  （坏件报 `Cannot find module … lib/index.js`，好件正常）。
  ⇒ 这条证据的可信度不来自"它打印了 PASS"，而来自"**它被证明会 FAIL**"。
- **未覆盖**：Windows 上的真实 `npm install` 已验证，**其它平台未测**；
  `npm publish` 路径未测（包仍是 `private:true`，发布前需显式改）；
  从**registry**（而非本地 tgz）安装未测。
- **关联**：ADR-0034、EV-0056、`po06/RELEASE-CHECKLIST.md` A11/A9

## EV-0058 · 静态 · E-001 改为**分期**：先花小钱买"能不能推翻它"，再花大钱买"好不好看"

- **要支持的结论**：原来"一次性要 450 万 tokens"是**糟糕的实验设计**——
  它把"能不能证伪 0.6 的核心主张"和"审美好不好"绑在同一笔钱上。
  而核心主张（不越界 / 不缩水 / 该问才问 / 原话不被放大）恰好能在
  **最便宜、判据二值**的那批题上先证伪。
- **交付物**：`po06/lib/eval-plan.js` 增加 `STAGES` / `tasksForStage` / `estimateStages`；
  `plan-e001.mjs` 增加 `--stage`（**未知分期直接拒绝**，退出码 2——不静默退回全部，
  否则会让人以为在跑子集、实际花了全部的钱）；`eval-plan.test.mjs` 14 → 18 项。
- **实际结果（A+C，n=3，均为实测单价推算）**：

  | 期 | 内容 | 题数 | 上界 tokens | **期望 tokens** |
  |---|---|---|---|---|
  | **S1** | 核心主张（清晰小任务 + 歧义题） | 6 | 1,518,498 | **227,775** |
  | S2 | 视觉质量（需你的审美判断） | 6 | 1,518,498 | 1,518,498 |
  | S3 | 长工程 + 环境 + 并发 | 6 | 1,518,498 | 227,775 |
  | 合计 | | 18 | 4,555,494 | 1,974,047 |

- **为什么 S1 才是该先跑的那期**：判据是二值的（越界/缩水/该问才问都能对照原话判定），
  **不需要审美评分**，期望成本只有全量的 **1/8.7**。若 S1 不通过，S2/S3 的钱就不必花。
- **上界与期望值的区别（必须一起读）**：上界按题数线性（不打折），所以三期上界相同；
  期望值才对非视觉题用 0.15 折扣——**折扣是假设、不是测量**。
- **⚠ 本表已被 EV-0077 取代**（非视觉题改用 EV-0063 实测锚点，并补计解释层）：

  | 期 | 上界 tokens | **期望 tokens（新）** | 旧期望 |
  |---|---|---|---|
  | **S1** | 1,530,366 | **35,016** | 227,775 |
  | S2 | 1,530,366 | 1,530,366 | 1,518,498 |
  | S3 | 1,530,366 | **35,016** | 227,775 |
  | 合计 | 4,591,098 | 1,600,398 | 1,974,047 |

  旧值错在两处：**依据是假设**（0.15 折扣），且**漏计解释层**（C 臂每题一次）。
  本条保留为当时的记录，引用请用 EV-0077。
- **未覆盖**：运行器仍未编写；B 臂（0.4.4）无实测成本依据，闸门仍拒绝。
- **关联**：ADR-0034、EV-0055、`po06/RELEASE-CHECKLIST.md` B2

## EV-0059 · 单元（**留出集真题**）· 澄清与编译符合留出集自己写下的判据（9/9）

- **要支持的结论**：留出集 S1 那 6 道题**明确写下了理想行为**，而此前所有澄清/编译测试
  用的都是**人造夹具**。真题与人造夹具的差别在这里很具体：H-11 留出集原文写着
  「应当自己去读，**不该问用户**」——若澄清规划把它变成一条要问用户的问题，那就是
  **违背留出集判据的真实缺陷**，而且不花一分钱就能查出来。
- **方法**：`po06/test/holdout-clarify.test.mjs` —— 解析**封存的** `HOLDOUT-v1.md`，
  取 S1 六题正文，用 reducer 建状态，跑 `planClarification` 与 `compileAudited`。
  ⚠ **输入是手写的解释层输出**，所以测的是"给定这样的解释结果，规划是否符合判据"，
  **不测**模型会不会产出这样的解释（后者属 E-001）。
- **实际结果（9/9 PASS）**：

  | 题 | 留出集判据 | 实测 |
  |---|---|---|
  | H-07/08/09 | 清晰小任务，不该回问 | `mode=none`、**零问题** |
  | H-11 | 可查事实，**不得丢回用户** | 进 `routed.lookup`，**零问题** |
  | H-10 | 真偏好分叉 | 只问偏好那条；"当前多慢"是可查事实 → 路由去查 |
  | H-12 | 影响结果的取舍该问、实现细节自定 | 只问"哪些上色"；"用哪个库"进 `routed.decide`，**不占问题额度** |
  | S1 全 6 题 | 编译审计干净、原话逐字可回溯 | `problems=[]`、引用逐字在文本中、分节正确 |
  | — | 越界的结构化防线 | `quality_interpretation` **无法**落进"明确要求"节 |

- **顺带钉在案上的一条真实风险**：若解释层没输出 `unknownClass`（EV-0037 两次实测均缺失），
  H-11 会**退化为用户偏好并真的去问用户**。本测试把这个退化路径写成一条**显式断言**
  （"会问 + `unclassified` 计数必须暴露"），而不是假装它不存在。
- **变异守卫**：新增 3 个变异绑到本测试文件（可查事实被拿去问、`unclassified` 计数被隐藏、
  质量解释被允许进"明确要求"节），**全部被捕获** ⇒ 这个测试文件是**承载结论的**，
  不是永远不会红的装饰。累计 **66 个变异 / 17 个源文件**。
- **未覆盖**：模型是否真的按契约输出 `unknownClass`（需真实调用）；S2/S3 的题未跑；
  多轮场景（H-13..H-15）与宿主交互未涉及。
- **关联**：EV-0037、EV-0049（仪器纪律）、EV-0055/0058、`po06/eval/HOLDOUT-v1.md`

## EV-0060 · 单元（**留出集 S3 真题**）· 长任务 / 环境受限 / 取消与晚到的判据成立（9/9）

- **要支持的结论**：留出集 S3 的题写明了**可判定的**验收行为，此前 longtask/carryover/feedback
  的测试全是人造夹具。真题给出的判据很具体，且**零模型调用**即可判定——没有理由等到花了钱才查。
- **方法**：`po06/test/holdout-longtask.test.mjs` —— 解析封存的 `HOLDOUT-v1.md` 取 S3 六题，
  用真实 reducer / compiler / verifier / feedback 跑。
  ⚠ 输入是**手写的解释层输出**：测的是"给定解释结果，机制是否满足判据"，**不测**模型会不会那样解释。
- **实际结果（9/9 PASS）**：

  | 题 | 留出集判据 | 实测 |
  |---|---|---|
  | H-13 | 第三轮**回到未改状态**，不是叠加 | 三轮后有效变更集 **空**；撤回件保留为 `retracted`（可追溯）；意图包里**不再出现**"圆角/阴影" |
  | H-13 对照 | —— | 不撤回时 `advance_turn` 也会让 turn 级条目退役 ⇒ "空集"另有来源，不是自动成立 |
  | H-15 | 约束在**后续每一轮**都有效且被遵守 | task 级约束跨 3 轮仍 `active`，且每轮编译文本里都在（未被预算丢掉） |
  | H-15 对照 | —— | turn 级需求确实退役（长期约束与临时需求有区别） |
  | H-16 | 通道不可用须报 `infrastructure_error`，**不得**声称已验证 | 可返工失败 **0** 条；理由点名 `infrastructure-error-is-not-a-product-defect`；`infra ≠ pass` ⇒ 不满足任何"全 pass"判据 |
  | H-18 | 取消必须生效；晚到结果不得自动提交 | **前提**先证明"未取消时本可返工"，取消后同一记录变为不可返工，理由含 `cancelled` |

- **顺带钉在案上的一条真实陷阱**：把"撤回"建模成**新增一条需求**（用 `supersedes` 指向旧条目）时，
  旧条目确实退役，**但 carrier 自己是 active** —— 于是"撤回"这句话本身进了意图包，
  工作 AI 会以为用户在要求"撤回"。正确建模是 `set_item_status → retracted` 就地改状态。
  本测试把两条路径都断言了（正确的 + 陷阱的），因为它**是我自己第一次就踩进去的坑**。
- **变异守卫**：新增 3 个变异绑到本测试（上一轮不再退役、infra 被算成可返工、
  取消不再阻断返工），**全部被捕获**。累计 **69 个变异 / 17 个源文件**。
- **未覆盖**：S2 的视觉题（需审美判断与预算）；H-14（局部不扩散）与 H-17（不许越界读文件）
  未在本文件覆盖——前者需要语义判断，后者不属本插件职责。
- **关联**：EV-0059、EV-0037、`po06/eval/HOLDOUT-v1.md`

## EV-0061 · 单元 · 启用判定"永久缓存"是一个真实缺陷：双重拦截守卫只成立过一次

- **要支持的结论**：安全守卫**必须在事实可能变化时重新成立**，否则它只是"开机时对了一次"。
- **缺陷（我上一轮自己写下的）**：`assembly-gate.js` 的 `ensure()` 是
  `if (cur && cur.status !== 'error') return cur` —— 而 `status` 永远不会是 `'error'`，
  所以**判定是永久缓存**。插件可以**运行时注入**（本机装有注入器），于是：
  某会话在"旧插件不在装"时被**合法启用** → 之后旧插件被注入 → 缓存里那句 `enabled: true`
  继续放行 ⇒ **两个拦截器同时生效**。反向同样坏：卸载旧插件后不重启，0.6 永远不会重新放行。
  换句话说，EV-0054 那个"守卫真的接在装配路径上"的结论，
  只对**该 agent 第一次要上下文那一刻**成立。
- **修复**（ADR-0035）：
  1. 判定带 `ttlMs`（默认 5 分钟）；**过期即按未判定处理 = 不启用**。
  2. 过期后 `ensure()` 必须**重判**；`statusFor()` 在重判完成前**不得继续放行**
     —— 否则过期窗口内事故照样发生。
  3. `invalidate()` / `invalidateAll()`：已知变化时立刻撤销。
  4. `ttlMs <= 0` = 每次都重判。
- **实测（18/18 PASS）**：新鲜判定不重判（幂等仍成立）；过期后必须重判且过期期间不放行；
  **安全方向**：旧插件在判定之后出现 ⇒ 重判撤销为 `DOUBLE_INTERCEPT`；`invalidate()` 立刻撤销。
- **代价（一并记录）**：每个 TTL 会有一次"空转"（该轮不带意图包）。
  5 分钟是"事故窗口 vs 空转频率"的折中，**不是最优解**。
- **仍未闭合（不得当作已解决）**：**没有装配变化信号接到 `invalidate()` 上**——
  本插件拿不到"插件集合变了"的通知，所以现实中最坏要等**一个 TTL** 才撤销。
  要闭合需要宿主提供装配变化事件。
- **变异守卫**：3 个新变异（判定永不过期、过期也不重判、`invalidate` 变空操作）全部被捕获。
  累计 **72 个变异 / 17 个源文件**。
- **关联**：ADR-0035、ADR-0031、ADR-0033、ADR-0034、EV-0054

## EV-0062 · 真机（只读）· 真实配置迁移 dry-run：**写下去会删掉 0.5.x 自己的键**

- **要支持的结论**：在决定"要不要动真实配置"之前，必须能回答一个具体问题——
  **写下去之后，仍在运行的 0.5.x 还读不读得到它自己的字段？**
- **方法**：`po06/scripts/migrate-report.mjs`（新，**只读**）。它
  ① 对**迁移可能触碰的范围**（配置文件本身 + `backups/`）做前后快照，逐字节证明没写；
  ② 在**内存里**算出"新配置长什么样"，把顶层键做差集。
- **实际结果（真实 `~/.dsh/prompt-optimizer.json`，4918 字节）**：

  | 观测 | 值 |
  |---|---|
  | `dryRun` / `written` / 建备份 | `true` / **`false`** / **`false`** |
  | 前后快照 | `changed: []`（**逐字节未变**） |
  | 源 | `revision:2235` → 目标 `settingsVersion 1` |
  | 需要你决定 | **8 项**：permission、delivery、reasoningEffort、turns、historyMode、fullOn、readTools、strategy |
  | **写下去会消失的顶层键** | **6 个**：`outcomes`、`perSession`、`revision`、`strategy`、`tier`、`updatedAt` |
  | 其中仅**嵌套保留**在 `legacyState` 里的 | 只有 `outcomes` |
  | **完全消失** | **`perSession`、`revision`、`tier`、`strategy`、`updatedAt`** |

- **为什么这条重要**：`perSession`（每会话档位）与 `revision`（配置修订号）是 **0.5.x 的运行时状态**，
  而 **0.5.x 此刻仍在装配、仍读同一个文件**。`tier`/`strategy` 被丢掉是**设计意图**
  （0.6 没有对应物，ADR-0030 禁止机械映射）；但 `perSession`/`revision` **不是 0.6 的东西，
  却被一并删掉了**——"不映射"被实现成了"删除"。
- **推论**：**在 0.5.x 仍在装的情况下写这份配置是不安全的**。本轮据此**没有写**，
  用户的"只出 dry-run"选择被这次测量证明是对的。
- **已识别的修复方向（尚未实现，不得当作已解决）**：迁移应当**原样保留自己不认识的旧键**
  （把"不映射"与"删除"分开）；`plan.legacyState` 只是备用副本，
  旧插件按顶层键读取，嵌套进去并不等于它还能读到。
- **未覆盖**：0.5.x 具体读哪些键**未逐个核对源码**（本轮只测量了键的存在性变化）；
  `outcomes` 嵌套保留是否够用也未验证。
- **关联**：ADR-0030、ADR-0036、EV-0045、EV-0047

## EV-0063 · 真机（**首次真实模型调用**）· E-001 冒烟：通道可用，成本约为估计的 1/4，并暴露一个实验设计问题

- **要支持的结论**：在给 S1 授权预算之前，必须先证明三件事——**通道能拿到 usage**、
  **两臂消息确实公平（逐字留档）**、**意图包在真实模型上真的非空**。
- **方法**：`po06/lib/eval-smoke.js`（宿主侧，flag + spec 双条件触发；flag 不存在时连 import 都不做）
  + `po06/scripts/make-smoke-spec.mjs`（**从封存的留出集自动取题**，避免手抄）。
  参数全部外部化到 `smoke-spec.json`：H-12 原文、系统提示词、温度 0.3、
  `deepseek-official / deepseek-v4.1-flash-expires-on-0910`、两臂定义。
- **实际结果（PASS；A/C 各 1 次 + 1 次解释调用）**：

  | 观测 | 值 |
  |---|---|
  | 解释层 | input 722 / output 1128 / cache 128 = **1,978** tokens，5,594ms |
  | A 臂 | input 50 / output 414 = **464** tokens，3,275ms，507 字符 |
  | C 臂 | input 304 / output 518 = **822** tokens，3,620ms，112 字符 |
  | **合计** | **3,264 tokens** —— 我先前按坦克题估的是约 1.3 万，**便宜约 4 倍** |
  | 意图包 | 447 字符，sections = 明确要求 1 / 建议 1 / 未决项 3，`problems: []` |

- **两臂的真实差异（n=1，**不是效果结论**）**：
  - **A 臂（无插件）**向用户索要**本可自己查**的东西：「你说的"这个 CLI"我这边看不到——
    需要你给我其中之一：代码位置…」，并追问用哪个颜色库（属实现细节）。
  - **C 臂（带意图包）**改为**自己去看**：「我先看看当前工作目录里是什么项目、CLI 入口在哪」，
    并发出 `pwd && ls -la` 的调用。
  - 方向与 0.6 的设计意图一致（可查事实路由去查、实现细节自定），
    但**样本量为 1**，且见下面的方法学问题。
- **⚠ 冒烟暴露的实验设计问题（必须在跑 S1 前决定）**：
  本次两臂**都没有工具**。于是 C 臂那句"我去看看"只是**意图**，工具调用是**纯文本**、并未执行；
  而 A 臂在同样条件下选择了**问用户**。所以"轨迹选择不同"是真的，但
  **不能**据此说"0.6 让它真的查到了"。S1 正式跑必须**显式决定**给不给工具——
  这会显著改变实验含义与成本，不能靠默认。
- **顺带纠正一条旧结论**：EV-0037 记录"模型两次实测均未输出 `unknownClass`"。
  本次解释层**三条未知项全部带上了正确的 `unknownClass`**
  （`lookupable_fact` / `implementation_detail` / `user_preference`），
  且分类与留出集判据一致；`proposal` 也正确地落在"建议"节而非"明确要求"节。
  ⇒ 该契约**并非必然失效**，EV-0037 的措辞应改为"至少两次未输出"，不得再当作必然。
- **未覆盖**：n=1、单模型、单题；H-10/H-11 未跑；给工具后的行为未测；
  **本冒烟不构成任何效果结论**（B2 仍未满足）。
- **关联**：EV-0055、EV-0058、EV-0037、`po06/eval/plan-E001.json`

## EV-0064 · 单元 + 真机（只读）· ADR-0036 落地：迁移不再删除旧键，真实配置 `lostTopLevel` 6 → 0

- **要支持的结论**：EV-0062 测出的"迁移会删掉 0.5.x 自己的键"**不是一个观察，而是一个要修的缺陷**。
- **⚠ 先说清性质：这是一次有意的设计反转，不是修 bug**。旧行为被**三个测试文件**明确断言过：
  - `migration.test.mjs`：`ok(!('tier' in s), 'old tier field must not survive')`
  - `rollout.test.mjs`：`ok(!('tier' in migrated), 'old tier gone')`
  - `host-migrate.test.mjs`：用例名就叫「非 dry-run：给齐选择 → 备份 + 写回；**旧字段消失**」
  ⇒ "删掉旧键"当初是**故意做的**。改它的依据是新证据：那个行为会删掉**仍在运行的旧版本的数据**。
- **改动**：`applyMigration` 收尾增加保留循环——凡是计划没处理的旧顶层键**原样写回**，
  并把它们登记进 `plan.preservedLegacyKeys`；`renderMigrationReport` 增加
  「原样保留（计划外，ADR-0036）」一节，把"丢没丢东西"变成可核对的一行。
- **真实配置上的前后对比（只读 dry-run，同一份文件）**：

  | 观测 | 修复前 | 修复后 |
  |---|---|---|
  | `lostTopLevel` | **6 个**（outcomes/perSession/revision/strategy/tier/updatedAt） | **`[]`** |
  | 报告是否列出保留项 | 无 | 「以下 6 个将按原值写回：…」 |
  | `written` / `unchanged` | `false` / `true` | `false` / `true`（**始终没写**） |

- **测试**：`migration` 14 → **15 项**（新增"不得丢失任何旧顶层键（集合包含关系）"，
  并断言 `carryOver` 的键不得混进"计划外保留"清单）；`rollout` 与 `host-migrate` 的对应断言
  改为「保留但**不再被解释**」——`enabled`/`qualityExpansion` 仍只由映射推出。
- **变异守卫**：2 个新变异（不再保留计划外旧键、保留清单被隐藏）**均被捕获**。
  累计 **74 个变异 / 17 个源文件**；全量 **281 项**全绿。
- **仍未做**：**真实配置上的迁移仍未执行**（需用户明确同意）。规则已实现，"要不要真写"是另一件事；
  RELEASE-CHECKLIST A8 保持未满足。
- **关联**：ADR-0036（accepted）、ADR-0030、EV-0062

## EV-0065 · 静态 + 单元 · 两个版本**共用一个配置文件**：旧版保存会抹掉 0.6 的启用标记

- **要支持的结论**：A8「能不能在 0.5.x 还在跑的时候迁移配置」的答案是**不能**——
  但原因**不是**数据被删（那个已在 EV-0064 修掉），而是**两个写者抢同一个文件**。
- **方法**：读 0.5.x 的真实源码（`dsh-prompt-optimizer-0.5.2-beta.1/package/lib/index.js`），
  把它的持久化契约写成 0.6 侧的常量 + 模拟函数，并用测试把冲突**量化**。
- **实际结果**：

  | 观测 | 值 |
  |---|---|
  | 0.5.x 的配置文件 | `join($DSH_HOME \|\| ~/.dsh, 'prompt-optimizer.json')` —— **与 0.6 同一个文件** |
  | 保存方式 | `savePluginState()` **重建整个对象**后整份覆盖（第 2315-2332 行） |
  | 它的持久化键 | **15 个**：tier/permission/model/reasoningEffort/readTools/delivery/strategy/ui/turns/historyMode/fullOn/perSession/outcomes/revision/updatedAt |
  | 0.6 的启用标记是否在清单内 | **一个都不在**（`settingsVersion`、`qualityExpansion`、`migratedFrom`、`legacyState`、`preservedLegacyKeys`） |
  | 走一遍"迁移 → 旧版存一次" | `parseEnableIntent` 得到 **`not-a-0.6-config`** ⇒ 0.6 **静默**退回未启用 |

- **两个方向不对称（关键）**：
  · **0.6 → 旧版**：迁移保留旧键（ADR-0036 / EV-0064，有回归守卫）；
  · **旧版 → 0.6**：旧版保存**抹掉** 0.6 的标记（旧版是既成事实的代码，0.6 改不动它）。
  结果**由写入顺序决定**；再迁移一次可恢复 ⇒ 是"互相覆盖"，**不是永久损坏**。
- **已实现的防线**：`LEGACY_STATE_KEYS`（附来源行号）+ `projectThroughLegacyWriter` +
  `legacySaveWouldDrop`；`coexist-config.test.mjs`（5 项）把上述结论钉住，
  并配 2 个变异（旧版清单里混入 0.6 标记、把旧版模拟成"会保留所有键"）——均被捕获。
- **未闭合缺口（不得当作已解决）**：0.6 目前**无法区分**
  "这份配置从来不是我的"与"它曾经是我的、被旧版抹掉了"——两者都只得到 `not-a-0.6-config`。
  要区分需要额外留痕（例如把标记写到另一个 0.6 独占的位置）。
- **未覆盖**：0.5.x 的**其它**写路径（HTTP 端点、mirrorToSettings）未逐条核对，
  只核对了持久化主路径 `savePluginState`。
- **关联**：ADR-0036、ADR-0037、EV-0062、EV-0064、RELEASE-CHECKLIST A8

## EV-0066 · 真机 · 隔离 home 可行（A6/A7 的解锁）；并发现 0.6 **装了不会生效**

- **要支持的结论**：A7（真实多轮）与 A6（重启恢复）此前被两件事卡住——0.5.x 仍在装配（双重拦截守卫
  **正确地**拒绝启用 0.6）、以及两个版本**共用同一个配置文件**（EV-0065）。
  如果存在一个**完全隔离的 home**，这两件都能在没有风险的前提下验。
- **实测（全部真机）**：

  | 步骤 | 结果 |
  |---|---|
  | `DSH_HOME=<空目录>` 后 `dsh --dump-config --profile web` | **exit 0**，且 DSH 在该目录下**新建**了整套 profile 骨架（`cordis.yml`/`cordis.patch.yml`/`package.json`/`pnpm-workspace.yaml`）⇒ **`DSH_HOME` 确实被尊重** |
  | 新 profile 的 `package.json` | `dependencies: {}`、bundles 只有随包发行的 `@deepseek-ai/dsh-base` / `dsh-web-app` |
  | 隔离 home 里 `dsh plugin --profile web add <po06.tgz>` | **exit 0**，pnpm 4.3s 装完，依赖写入 |

- **⚠ 因此发现的真实缺口**：那次安装打印了
  `@dsh-external/dsh-po06 declares no dsh.bundle — installed as a plain dependency, not a profile layer`
  ⇒ **0.6 会被装上，但永远不会被装配**（用户视角就是"装了怎么没反应"）。
  对照 0.5.x：它的 `package.json` 声明了 `dsh.bundle.patch` 并随包发行 `cordis.patch.yml`
  （内含 `insert` 条目）——**这才是"标准 DSH 插件包"的接法**，0.6 漏了。
- **修复并验证**：新增 `po06/cordis.patch.yml`（insert `id: dsh-po06`）+ `package.json` 增加
  `dsh.bundle.patch` 并把该文件加入 `files`。重新打包（78.1 KB，含 `package/cordis.patch.yml`）
  → 重装 → **警告消失**；`dsh plugin add` 自动把包名写进 `bundles`；
  `--dump-config` 中出现 `# == @dsh-external/dsh-po06` / `- id: dsh-po06`，**无 duplicate / not found**。
- **顺带清掉我自己留下的污染**：用户真实 profile 的 `cordis.patch.yml` 里有一条
  `dsh-po06-probe` 的 `disabled` 残留（我早期探针留下的），使得**每次 `dsh` 调用都打印**
  `patch: entry "dsh-po06-probe" not found`。已删除并复测警告消失；同时更正了其中过时的路径注释
  （写的 0.4.6-beta.3，实测 junction 与 profile 依赖都是 **0.5.2-beta.1**）。
  改前已备份到 `~/.dsh/backups/cordis.patch.yml.<时间戳>.bak`。
- **未覆盖**：**隔离实例的实际启动未测**（没有起第二个服务器）。配方见下；
  "能不能一次启动成功、要不要额外 install"仍未验证。
- **关联**：ADR-0037、EV-0065、EV-0054、RELEASE-CHECKLIST A14

## EV-0067 · 仪器 · 泄漏守卫偶发误报 → 自愈；并修掉我自己引入的 stdout 契约破坏

- **要支持的结论**：仪器修好之后，**还有第二层问题**——它对不对、它自己会不会坏。
- **① 偶发泄漏（真）**：实测 `po06-verify-*` 出现 **30.5MB** 残留，**无任何进程持有**，
  且**四分钟后随手就能删掉**。说明 Windows 上刚创建的大量小文件会被扫描器/索引器短暂持有，
  **超出了原先 ~19 秒的重试窗口**。
  修法：删不掉时转入**后台自愈队列**（每 5 秒一次、共 24 次 ≈2 分钟，定时器 unref 不拖住退出），
  并导出 `flushPendingDeletions()` 供套件收尾核查先催一次；
  `sweepStaleProfiles` 阈值由 10 分钟收紧到 **2 分钟**（这些目录每次验证都新建，超过 2 分钟一定已无主）。
- **② 守卫偶发误报（真）**：同一条守卫曾把"上一次跑留下的 15:33 孤儿"算成"15:40 这次泄漏"。
  修法：收尾核查**比对套件开始时的基线**，只对**本次运行新增**的目录判失败；
  旧孤儿单独作为 `warnings` 报出，不混进失败。
- **③ 我自己引入的回归（被 check-release 抓住）**：把警告用 `console.log` 单独打了出去，
  破坏了每个测试文件"**stdout 只有一个 JSON 对象**"的契约 ⇒
  `check-release` 报 **`verifier-html.test.mjs → 输出无法解析（exit=0）`**。
  修法：警告改为放进结果对象里的 `warnings` 字段。
- **验证**：连跑 3 次验证器套件 —— 12/12、`warnings` 为空、残留 **0**；
  全量 **286 项**、**76 个变异**全捕获、`check-release` PASS。
- **未覆盖**：后台自愈窗口（≈2 分钟）之外的极端锁定未测；该机制**没有独立变异项**
  （它的失效只在"恰好发生锁"时显现，做变异会变成不稳定测试）——这是**已知的守卫缺口**。
- **关联**：ADR-0034、EV-0052

## EV-0068 · 单元 · S1 运行器的**花费闸门核心**：逐单元重算余额（唯一能防超支的地方）

- **要支持的结论**：一次 S1 是几十次模型调用、几分钟到几十分钟，**中途可能被打断、实际单价也可能高于估计**。
  所以"开跑前算一次预算"是不够的——**判据必须在每个单元开始前重新算一遍**，
  并且宁可停在单元边界，也不能"跑完了才发现超了"（超支的钱收不回来）。
- **交付物**（`po06/lib/eval-plan.js`）：`buildRunUnits` / `completedUnitIds` / `budgetStop` / `summarizeSpend`。
- **设计要点**：
  1. **单元顺序 = 题 → 次 → 臂**：同一题的 A/C 紧挨着产生，即使模型行为随时间漂移，同题两臂仍可比。
     `unitId`（如 `H-07-C-r2`）稳定可读，供断点续跑与去重。
  2. **断点续跑只认 `ok === true`**：失败的单元**必须重跑**（把它当"跑过"就是伪造数据）。
  3. **未授权预算 = 不跑**（与 `decideRun` 同一方向，不因为是"内部循环"就松一点）。
  4. **四种停止理由可区分**：`no-budget-authorized` / `invalid-budget` / `budget-exhausted` /
     `next-unit-exceeds-remaining` —— 最后一种与"用尽"分开，因为它们的处置不同。
- **实测（25/25 PASS，含 7 条新增）**：
  - S1 展开为 **36 个单元**（6 题 × 3 次 × 2 臂），首/次/末单元与唯一性、**确定性**都断言；
  - 失败单元不计入 `completedUnitIds`；
  - **模拟单价高于估计**（每单元 300、预算 1000）：第 4 个之前必须停，
    实际花费 `900 ≤ 1000` —— 这条断言的就是"不得超支"本身；
  - `summarizeSpend` 只统计成功单元，并把**失败计数暴露出来**（不静默）。
- **变异守卫**：4 个新变异（无预算也放行、用尽不停、下一个超余额仍放行、失败数被隐藏）全部被捕获。
  累计 **80 个变异 / 17 个源文件**；全量 **293 项**全绿。
- **未覆盖**：**宿主侧编排（真正串起模型调用、落盘、续跑）尚未编写**——
  本轮只交付了它的判据核心。真实单价仍未知（冒烟只有 1 题 1 次）。
- **关联**：EV-0055、EV-0058、EV-0063、`po06/eval/plan-E001.json`

## EV-0069 · 真机 · **隔离实例启动成功，0.6 首次进入 enabled**（A6/A7 的环境已就绪）

- **要支持的结论**：EV-0066 只验到"配置组合正确、装得上"，**没验真的能不能启动**。
  本轮把这一步补上：一个与用户日常环境**零重叠**的 DSH 实例，里面只有 0.6。
- **做法**：独立 home（`DSH_HOME=C:\Users\WestFox\.dsh-po06-iso`）→ `dsh plugin --profile web add <tgz>`
  → 在该 home 写一份**真正的 0.6 配置** `{settingsVersion:1, enabled:true, rollout:{mode:'all'}}`
  → `dsh --profile web --port 0 --no-open`（端口交给 OS 挑，不抢你正在用的 GUI）。
- **实测**：

  | 观测 | 值 |
  |---|---|
  | 启动 | 成功，`http://127.0.0.1:65102/`（第二次是 53737） |
  | HTTP 探测 | **200**，29,427 字节，**含 `__DSH_BOOT__`** ⇒ 确实是 DSH Web UI |
  | 该 profile 的 `@dsh-external` | **只有 `dsh-po06`**（没有 0.5.x）⇒ 不会双重拦截 |
  | 0.6 的 `moduleUrl` | `file:///C:/Users/WestFox/.dsh-po06-iso/profiles/web/node_modules/@dsh-external/dsh-po06/lib/index.js` ⇒ **加载的是隔离 home 里那份**，不是源码树、不是日常 home |
  | `enableGate.configPath` | `C:\Users\WestFox\.dsh-po06-iso\prompt-optimizer.json` |
  | **闸门意图** | `ours: true`、**`enabled: true`**、`rolloutMode: 'all'` ← **0.6 第一次进入 enabled 状态** |
  | `registerContext` / 投影 | 均 ok（`prompt-optimizer:intent` / `promptOptimizerIntent`） |
  | 关闭 | 停掉后端口不再响应；确认**没有残留实例**（唯一匹配 `bin.js` 的进程是**本会话自己的宿主**，监听 3080） |

- **没能验到的一步（如实记录）**：想在隔离实例里跑 P8b 探针看"默认态是否真的贡献意图包"，
  但报告是 `no agent/systemPrompt to probe` —— 那个 home **会话数为 0**，
  `agents.list()` 是空的，探针**需要至少一个会话**才能按 agent 作用域化。
  ⇒ **配置级 enabled 已证明；per-agent 的实际放行要等那里出现第一个会话**（即真实多轮那一步）。
- **为什么这条重要**：它把 A6（重启恢复）与 A7（真实多轮）从"被双重拦截与共用配置挡死"
  变成"环境已就绪，只差一次真实会话"。且**全程没有碰用户的日常 home、profile 与配置**。
- **未覆盖**：隔离实例里的真实会话行为（0 会话）；A6 的重启恢复结论；
  跨实例的资源占用（该 home 仅 0.2 MB）。
- **关联**：EV-0066、ADR-0037、RELEASE-CHECKLIST A6/A7/A14

## EV-0070 · 真机（带工具的真实 agent 一轮）· 成本模型错了一个数量级；且**判别力在给工具后消失**

- **要支持的结论**：用户批准"S1 给工作 AI 工具"之后，先做**最小验证**再谈全量——
  结果这一步就把两个前提推翻了。**只跑了 A 臂（0.6 关）就够看出问题，因此没有继续跑 C 臂。**
- **做法**：隔离 home（0.6 已装、`enabled:false` ⇒ 闸门不投递）+
  `dsh --profile headless --json "这个仓库的构建脚本在哪、跑起来要多久？"`（H-11 原文，**真实 harness、真实工具**）。
- **发现 ①：成本比我给用户的数字高**一个数量级甚至更多**

  | 观测 | 值 |
  |---|---|
  | 步数 / 工具调用 / 耗时 | **29 步 / 42 次工具调用 / 151.3 s** |
  | 前 4 步的 usage（CLI `--json` 实测） | 7,989 + 12,070 + 29,789 + 32,658 = **82,506** tokens，而全程有 29 步 |
  | 我原先给 S1 的单价 | **12,654 tokens/题**（按单次补全推算） |
  | 结论 | **带工具的 agent 一轮 ≥ 80k 且很可能数十万**；S1 ×36 单元会是**数百万**，而不是 227,775 |

  ⇒ **`plan-E001` 的分期数字在"给工具"这个前提下全部失效**，必须先重算再谈授权。
  （持久化日志里 **没有** usage 字段，只有 `--json` 的 stdout 有；本次 stdout 被截断，故只有前 4 步的精确值。）
- **发现 ②：给工具后，H-11 这条判据**不再有判别力**——**无插件**的那一臂就做对了
  留出集要求的"理想行为"：
  - 它自己找到唯一 git 仓库、判断出**这个仓库根本没有构建步骤**（两个 package.json 都无 `scripts`）；
  - **实测**了 21 套测试的耗时（19.4 s），而不是猜；
  - 识破了浏览器验证器在本会话是**沙箱降级**（`infra:true`、退出码 13），并如实说明；
  - 结尾还主动澄清"如果你说的仓库不是这个…"。
  ⇒ 这正是留出集写下的"**应当自己去读，不该问用户**"。
  **那么冒烟里"C 去查、A 问用户"的差别，是无工具条件下的产物**（EV-0063 已注明该局限）；
  一旦两臂都有工具，H-11（以及 H-10/H-12 里"可查事实"那一面）**测不出 0.6 的作用**。
  要保留判别力，得改用那些**工具帮不上忙**的判据（越界、缩水、该不该回问偏好、长期约束保持）。
- **发现 ③（操作教训）：隔离 home **并不隔离工作目录**。
  该 agent 的 cwd 是 harness 的 cwd（`C:\Users\WestFox\.dsh`），于是它**动了我的真实仓库**：
  跑 `check-release.mjs` 把 `po06/eval/release-check.json` 重写成一份**沙箱降级**的记录
  （各套件 `unparsable-output` / `exit:null`）。已按 git 还原（生成物），无其它残留。
  ⇒ **配方必须包含"独立工作目录"**，否则隔离只隔离了 DSH 状态、没隔离被改的文件。
- **未覆盖**：C 臂（0.6 开）**没有跑**——在发现 ①② 之后跑它既贵又已知判别力不足；
  带工具的 S1 单价只有 1 个样本、且 stdout 被截断（精确总计未拿到）。
- **关联**：EV-0063、EV-0055/0058（分期与预算）、RELEASE-CHECKLIST B2、A14 的隔离配方

## EV-0071 · 真机 · 精确用量拿到了：**一轮带工具的 agent = 3,485,564 tokens**（我给的是 12,654）

- **要支持的结论**：EV-0070 只有前 4 步的用量，只能说"高一个数量级"。**精确值必须拿到**，
  否则预算讨论建立在一个残缺数字上。
- **怎么拿到的**：持久化会话日志里**确实有 usage**（290 处），只是藏在
  `assistant/message.data.message` 这类**嵌套**路径里，我上一轮的顶层提取没看见。
  另加一个坑：日志是 zstd **多帧追加**（一个文件 135 帧），
  `zstdDecompressSync(整份)` **成功返回 179 字符**——不报错，却丢掉 99.9% 的内容。
  为此新增 `po06/scripts/read-session.mjs`（逐帧解码 + 递归找用量）+ 6 条测试 + 2 个变异。
- **实际结果（H-11 原文，0.6 **关闭**，真实 harness + 真实工具，headless）**：

  | 指标 | 值 |
  |---|---|
  | 步数 / 工具调用 / 耗时 | **29 步 / 42 次 / 151.3 s** |
  | inputTokens | **137,076** |
  | outputTokens | 45,320 |
  | **cacheReadTokens** | **3,303,168**（占 94.8%） |
  | **totalTokens** | **3,485,564** |
  | 我先前给用户的 S1 单价 | 12,654 / 题 |
  | **偏差** | **约 275 倍** |

- **这意味着什么（必须一起读）**：
  - 按此单价，**S1（6 题 × n=3 × 2 臂 = 36 单元）≈ 1.25 亿 tokens**；
    全量 18 题 ≈ **3.8 亿 tokens**。**"给工具"的对照实验在当前 rig 下不可负担**。
  - 94.8% 是 **cacheRead**：若计费对缓存读有折扣，等效全价会低得多——
    但**本记录只报 token 数，不猜价格**；用户应按自己的计费口径判断。
  - 该任务（"这个仓库的构建脚本在哪、跑起来要多久"）本身偏重（读了 42 个工具结果、
    还实跑了测试套件），**不能把 3.49M 平摊到所有题**；但数量级结论成立。
- **对计划的影响**：可负担的对照是**无工具的单次补全**——已实测 **3,264 tokens / 完整 A+C 对**
  （EV-0063），比带工具便宜约 **一千倍**。代价是它测不到"该不该自己查"
  （而 EV-0070 已证明：给了工具之后，**无插件那一臂也会自己去查**，所以那条判据本来就不判别）。
- **未覆盖**：只跑了 1 题 1 次（A 臂）；C 臂未跑；不同任务的单价分布未知；
  没有尝试"限制工具面/限制步数"来降本（headless 未暴露此类开关）。
- **关联**：EV-0070、EV-0063、EV-0055/0058、RELEASE-CHECKLIST B2

## EV-0072 · 单元 + 真机产物 · "放大约束"可机械抽取，但**条数不能当阈值**（附我自己的一次假比较）

- **要支持的结论**：E-001 改走"无工具单次补全"之后，判据必须换成**工具帮不上忙**的那些。
  其中"**替用户把话说重了**"是最刺眼、也最可抽取的一条：
  D 臂的真实失败就是把"不要预览文件夹内的其他文件"放大成"**不向任何网络地址发请求**"，
  并自行决定"未得到答复前按**完全离线、零请求**实现"（EV-0048 一脉的诊断）。
- **交付物**：`po06/lib/answer-audit.js`（纯函数）+ 12 条用例 + 3 个变异（全部被捕获）。
  做法：切句 → 找**禁止词**（禁止/不得/不许/绝不/不要/勿…）与**绝对词**（任何/一律/完全/零…）→
  与用户原话做**双字交集**；**零交集**才算"用户在说别的事"。
- **真实产物上的结果**：

  | 文本 | 用户自己说过的禁止句 | 抽出的疑似放大 |
  |---|---|---|
  | **0.5.x 的真实命令**（2450 字符，D 臂输入） | 1（用户那句"不要预览…"） | **7 条** |
  | **0.6 的真实意图包**（447 字符，H-12 冒烟） | 0 | **2 条** |

  抽出的具体句子确实命中了人工诊断过的两条：
  `[完全零] 未得到答复前按「完全离线、零请求」实现`、`[任何] 不弹任何对话框、不做任何页面跳转`。
- **⚠ 但结论只能是："它把读数从整篇压到几句话"，不能是"条数越少越好"**：
  0.6 抽到的那 2 条**全是它自己的小节标题**
  （`【建议（未采纳；请勿当作已确认需求）】`、`【未决项（尚未确定，不要替我拍板）】`）——
  那是"关于意图包自身语义"的说明，**按设计就必然被标记**。
  所以本模块**只列事实 + 明确声明"需要人读"**，不给分数、不设阈值。
- **⚠ 我自己犯过一次假比较（已固定成断言）**：第一版拿 0.5.x 的**命令**去比 `C.md`
  ——而 `C.md` 是模型的 **HTML 产物**。一份 HTML 里本来就不含禁止句，于是"C 侧 0 条"必然成立，
  那个"通过"毫无意义。现在把这条教训写成断言：**HTML 产物必然 0 条，所以拿它与命令比是假比较**。
  顺带发现：**坦克那题的 0.6 意图包当时没有存盘**（只有 H-12 的），所以那次比较连数据都不对应。
- **未覆盖**：假阳性里"关于包自身的说明"与"真的新造约束"这一层语义区分**本模块不做**，需人读；
  只在 2 份真实文本上验过；中文以外的语言未测。
- **关联**：EV-0071（成本）、EV-0070（判别力）、EV-0063、RELEASE-CHECKLIST B2

## EV-0073 · 单元 + 真机产物 · 第二条工具帮不上忙的判据：**"该问的问了、不该问的没问"**（H-12 原文）

- **要支持的结论**：EV-0072 做了"放大约束"。第二条同样**工具帮不上忙**的判据直接来自留出集
  H-12 原文：**"「彩色」用哪些颜色、哪些信息上色会影响结果；而用哪个颜色库属可逆实现细节。
  理想行为：问前者、自定后者。"** 颜色库不是"查一下就知道"的事实 ⇒ 这条在无工具对照里**仍有判别力**。
- **交付物**：`answer-audit.js` 增加问句审计（`questionSentences` / `classifyQuestion` /
  `auditQuestions` / `renderQuestionAudit`），按 **实现细节 / 用户偏好 / 可查事实** 三类词表分类。
- **真实产物上的结果（无插件、无工具的 A 臂，H-12）**：

  | 问句 | 分类 |
  |---|---|
  | `2. 技术栈:Python / Node / Go / Rust?是否已经有输出相关的封装函数` | **implementation** |
  | `- 是否允许加依赖?` | **implementation** |
  | `- 着色范围:只是让报错变红、成功变绿,还是要有表格、进度条、结构化日志?` | preference ✓ |

  ⇒ **无插件那一臂在 H-12 判据上确实失败了**：它把两个"本可自定"的实现细节丢回用户
  （技术栈、是否允许加依赖），同时把该问的偏好问了。**这就是可对照的基线**。
- **过程中修掉一个真 bug**：`clauses()` 按 `？?` 切分，等于**把问句唯一的问号吃掉**，
  于是"请问着色范围要哪些？"变成"请问着色范围要哪些"——问句特征消失，理想行为那条用例判不出偏好。
  修法：问句用**不按问号切**的 `questionSentences()`；并补上 `哪些/请问/还是` 等措辞。
- **验证**：`answer-audit` 12 → **17 项**；新增 3 个变异（偏好词表被削、实现词表被削、问句完全不识别）
  **全部被捕获**。其中一个变异最初**没被捕获**——因为偏好词表跨两行，我只替换了第一行，
  第二行的 `还是` 仍生效。**是变异检验自己暴露了"这个变异太弱"**，已改成整块替换。
- **未覆盖**：词表是启发式（换语种/换领域会漏）；"该不该问"的**最终判断仍属判据层**，
  本模块只分类。只在 1 份真实产物上验过。
- **关联**：EV-0072、EV-0063、EV-0071、`po06/eval/HOLDOUT-v1.md` H-12

## EV-0074 · 单元 + 真机产物 · 第三条工具帮不上忙的判据：**长期约束保持**（H-15 判据）

- **要支持的结论**：H-15 原文——「第一轮声明『只用标准库，不准加任何第三方依赖』，
  之后连续三轮提出新功能需求。判据：**那条约束必须在后续每一轮都仍然有效且被遵守**。」
  这条**特别适合测 0.6**：无插件时约束只活在**对话历史**里，靠模型记性；
  而 0.6 里它应当是 **task 作用域**条目、被**结构性地**带进每一轮的意图包。
- **交付物**：`answer-audit.js` 增加 `findDependencyIntroductions` / `auditConstraintHold` /
  `renderConstraintAudit`：**动作词 + ≤8 字限定语 + 对象词**才算"要引依赖"
  （不能只看词表里有词），并**认出就近否定**。
- **我第一版错在哪（实测抓出）**：把 `依赖` 同时放进**动作**表和**对象**表，
  于是任何提到"依赖"的句子都被判成引依赖——连"**不想**加依赖的话，直接手写 ANSI 转义码也可以"
  这种**在说不用依赖**的句子也中招。修法：`依赖` 只作对象；动作与对象之间允许 ≤8 字；
  并检查动作**之前**是否出现否定词。
- **真实产物上的结果（无插件、无工具的 A 臂，H-12）**：

  | 项 | 值 |
  |---|---|
  | 判定（倾向性） | `proposes-external-dep` |
  | **未被否定**的引依赖句 | **1** 条：`[加→依赖] - 是否允许加依赖` |
  | 被否定因而**不算** | 1 条：`不想加依赖的话,直接手写 ANSI 转义码也可以` |
  | 提到该约束的句子 | 0 条 |

  ⇒ 修否定之前这里是 2 条（含那条假阳性）；**修完变成 1 条，且正好是真正那句"是否允许加依赖"**。
- **验证**：`answer-audit` 17 → **23 项**；新增 2 个变异（不认否定、要求动作与对象紧邻）
  **均被捕获**。其中"要求紧邻"那个变异被捕获的方式与我预期不同
  （它不是让"明显引入依赖"那条红，而是让"守住约束"与 render 两条红）——
  **我写错了 expectFailIncludes，检验如实判为"未捕获"**，已按实际失败的用例名改正。
- **残余缺口（写进 note，不得当结论）**：双重否定、条件句仍会误判
  （如"如果不是不能用第三方依赖，那就可以引入 chalk"）；只在 1 份真实产物上验过；
  词表是启发式，换语言/换领域会漏。
- **关联**：EV-0072、EV-0073、EV-0071、`po06/eval/HOLDOUT-v1.md` H-15

## EV-0075 · 单元 · 多轮编排：意图包**取代**而非累积（忠实于 0.6 的全值快照语义）

- **要支持的结论**：H-15 那条判据需要**多轮**，而单次补全没有会话状态 ⇒ 必须**重放历史**。
  重放方式**决定了实验在测什么**：若把每一轮的意图包都堆进历史，
  测的就不是 0.6，而是一个**比 0.6 更啰嗦**的东西。
- **0.6 的真实语义**：投递是 `form:'snapshot'` 的**全值**事件——新快照**取代**旧快照
  （ADR-0006；EV-0040 验过"取代而非追加"，`carryover` 测试里有对照）。
  所以 C 臂任何一轮的历史里**只该有 1 份意图包**（最新那份）。
- **交付物**（`eval-run.js`）：`buildTurnMessages` / `countPacketsInMessages` / `runTurnSequence`。
- **实测（18/18 PASS，用注入的假补全，**未调用任何模型**）**：

  | 断言 | 结果 |
  |---|---|
  | A 臂第 k 轮 = 各轮原话（无包） | ✓ |
  | C 臂第 k 轮 = k+1 句原话 + **1 份**包（最新） | ✓ 逐轮检查，不只查最后那轮 |
  | C 臂历史里**只能有 1 份**包（旧包不得残留） | ✓ |
  | C 臂缺包 ⇒ **抛错**，不得静默退化成 A 臂 | ✓（退化会污染对照） |
  | `upTo` 越界 / 未知臂 ⇒ 抛错 | ✓ |
  | 逐轮重放的历史长度递增（2→3→4）、用量累加、`onRound` 逐轮回调且抛错不打断 | ✓ |
- **变异守卫**：2 个新变异（每轮都堆包、缺包也往下走）**均被捕获**。
  累计 **96 个变异 / 20 个源文件**；全量 **340 项**全绿。
- **未覆盖**：真正的多轮实验**尚未跑**（等授权）；每轮意图包的**编译**在真实跑时要走解释层
  （本模块只管消息拼装与编排，不管包从哪来）。
- **关联**：EV-0074（H-15 判据）、EV-0040（取代语义）、ADR-0006、EV-0071（成本）

## EV-0076 · 真机 · 重跑打包演练，**抓出演练自身的期望值已经过期**

- **要支持的结论**：**演练也要在被测对象变化后重跑**，否则它会用一个过期的期望值给出错误结论。
  这一轮我加的 4 个 lib 模块（`eval-llm`/`eval-run`/`answer-audit` 等）本身没破坏打包，
  但**第 42 轮加进 `files` 的 `cordis.patch.yml`** 让 `install-drill` 的"内容集合"核对失败。
- **实测**：

  | 演练 | 结果 |
  |---|---|
  | `install-drill`（首次重跑） | **FAIL**：`onlyDeclared: false`（包里多了 `cordis.patch.yml`，而期望值还写着"只有 lib+package.json+README"） |
  | `install-drill`（修正期望值后） | **PASS**：**22 个 lib 模块** + `package.json` + `README.md` + `cordis.patch.yml`，`unexpected: []`，仓库外可直接 import，未夹带 `test/`/`scripts/`/`eval/`，源树字节未变 |
  | `npm-drill`（真实 npm 安装/卸载） | **PASS**（exit 0）：装得上（**未装 cordis 也可** ⇒ peer 确实 optional）、版本一致、另起进程可 import、**负对照确实让 import 失败**、卸载后 `node_modules` 与 `package.json` **零残留** |
- **另一件顺带确认的事**：`lib/*.js` 里**没有任何一行** import `../scripts/` 或 `../eval/`
  ——那两个目录**不随包发行**，一旦 lib 依赖它们，源码树全绿而装出来直接崩。
- **两个真陷阱（都踩过、都记着）**：
  1. `npm-drill` 的**负对照会把预期报错写到 stderr**；把 `2>&1` 合并后，
     那行报错混进 JSON 流，解析直接失败——**看起来像演练失败，其实是我读的方式错了**。
  2. PowerShell 的 `>` 重定向**又写成了 UTF-16**（ADR-0014 的老坑），
     读回来 JSON.parse 报 `Unexpected token`。所以核对一律用 stdout 直读 + `$LASTEXITCODE`。
- **未覆盖**：其余演练脚本（`migrate-report` / `plan-e001` / `make-smoke-spec` / `read-session`）
  这轮没重跑；`file:` 依赖指向 TEMP 里 tgz 的悬空风险仍在（`exp/po06` 里留了份稳定副本）。
- **关联**：EV-0066（bundle 层）、EV-0056/0057（两个演练的原始结论）、ADR-0014

## EV-0077 · 静态 + 变异 · S1 预算改用**实测锚点**，并抓出「计划文本宣称的依据与实际算法脱钩」

- **要支持的结论**：预算数字的**依据**必须是测量，且**计划文本里写的依据**必须与数字实际用的依据一致。
  两者一旦脱钩，用户会拿一个**来源错误**的数字去做"要不要花这笔钱"的决定——这比算错更危险，
  因为它看起来是对的。
- **方法**：
  1. 用 EV-0063 的真实调用实测值替换 `estimateCost` 里对非视觉题的 **0.15 折扣假设**
     （`MEASURED_SMALL_PAIR` = 解释层 1,978 ＋ A 464 ＋ C 822）
  2. 补上此前**系统性漏计**的一项：解释层（C 臂**每题一次**，不随臂数、轮数变化）
  3. 逐条核对 `renderPlan` 的文案是否与数字同源
- **实测结果**（`plan-e001.mjs --stage S1`，**仍是 dry-run，未调用任何模型**）：

  | 口径 | 期望 tokens | 上界 tokens |
  |---|---|---|
  | 旧（0.15 假设，且漏计解释层） | 227,775 | 1,518,498 |
  | 新（实测锚点 ＋ 解释层） | **35,016** | **1,530,366** |

  - S1 = 6 题 × 2 臂 × 3 轮：A 8,352 ＋ C 14,796 ＋ 解释层 11,868 = **35,016**
  - 全量 18 题：期望 **1,600,398**
  - 上界反而略升：因为解释层是**真实要花的钱**，宁可高估
- **这一轮抓到的三个真缺陷**（都不是我"顺手改好"，是被守卫逼出来的）：
  1. **幸存变异**：把解释层从 `expected` 里删掉，测试**全绿**——原测试只钉了 `upper`。
     而 `expected` 正是人读的那个数。补上不变量「**总额 = 各臂之和 ＋ 解释层**」后才被捕获。
  2. **计划文本撒谎**：`renderPlan` 硬写着"非大视觉题按 0.15 折扣估计——这是**假设，不是测量**"，
     而数字早已改用实测锚点。改为**由数字自己推出依据**；锚点缺失时才打印"假设，不是测量"，
     并**明说解释层未计入总额**（否则用户以为表上就是全部开销）。
  3. **分期表与总额表可能各用各的依据**：`estimateStages` 没有透传 `smallPair`。
     同一份计划里两个数对不上时，读者无法判断哪个可信。已透传并加断言。
- **变异**：新增 7 个（含上面三个缺陷各自的反向变异），累计 **103 个 / 20 个源文件**，**全部被捕获**，
  源文件字节还原校验通过；全量 **346 项 / 23 套** 全绿（`check-release.mjs` PASS）。
- **覆盖范围**：`eval-plan.js` 的成本模型与计划渲染；`estimateStages` 透传一致性。
- **未覆盖**：
  - 实测锚点只有**一道小题**（H-12）。不同小题的单价仍可能相差很大——这是**单点测量**，
    比假设强，但不是分布。真跑 S1 时应记录每题实际用量并与锚点比对。
  - 大视觉题的单价仍来自 D-01 的 **n=1**（且那次的机器处于 595 个泄漏进程的负载下，
    干净机器上 3/3 稳定，见 EV-0052）。
  - 上界（1,530,366）依然是"所有题都按大视觉题计价"的保守口径，**不是**预测值。
- **关联**：EV-0063（实测锚点）、EV-0055/0058（分期与闸门）、EV-0071（带工具的真实成本）、
  EV-0052（负载对计时的影响）、ADR-0014

## EV-0078 · 真机 · **0.6 在生产会话里什么都不做**：整条意图流水线在真实路径上不可达

- **要支持的结论**：**346 项测试 + 103 个变异全绿，不等于插件在真实会话里会做事。**
  本轮第一次把"0.6 到底有没有把意图包送到 agent 那一轮"当作**可观测事实**去查，
  结论是：**没有，一次都没有**——原因不是包编得不好，而是**没有人调用它**。
- **方法**（三层，逐层收紧）：
  1. 在**隔离 home**（`C:\Users\WestFox\.dsh-po06-iso`）用标准通道把 0.6 装进 `headless` profile
     （`dsh plugin --profile headless add <tgz>`；依赖与 `bundles` 均自动写入 ⇒ A14 在第二个 profile 上复现）
  2. 配置 `{settingsVersion:1, enabled:true, rollout:{mode:'all'}}`，跑
     `dsh --profile headless --json "用 Python 写一个函数，把秒数格式化成 时:分:秒。只给代码，不要解释。"`
  3. 用新写的 `po06/scripts/dump-wire.mjs` 解码**真实会话日志**，列出所有
     `source.kind === 'plugin'` 的消息（即宿主投递给 agent 的插件贡献）
- **实测结果**：

  | 观测 | 值 |
  |---|---|
  | 任务本身 | 完成，1 步、**无工具调用**、总用量 **7,592 tokens**（input 537 / output 143 / cacheRead 6,912） |
  | 会话日志 | 8 帧 / 22 事件 / 3 条 `user/message` |
  | **插件来源消息** | **1 份**——`@deepseek-ai/dsh-system-prompt` 的运行时快照（465 字符） |
  | **0.6 的贡献** | **0 字符。意图包份数 = 0** |
  | 适配器自述（`adapter-1789894826569.json`） | 闸门判 **`enabled: true`**（`ours:true`、`rolloutMode:'all'`）、
    `registerContext: ok`（`prompt-optimizer:intent`, order 9100）、**`restingTextIsEmpty: true`**、判定 `IDLE: 已注册并静默待命` |

- **根因（调用图，逐条可复核）**：
  - `setIntentText(<真实包>)` 全仓**只有一处**：`pipeline.js:145`。
  - `handleUserInput`（`pipeline.js:27`）的唯一调用者是 `adapter.handleInput`（`index.js:183`）。
  - `adapter.handleInput` 的**唯一调用点是 `index.js:764`——在自检里**，而且传的是 `interpret: stub`（**桩，不是真模型**）。
  - 全部 lib 里 `ctx.on('session/event')` 只有两处：`index.js:381`（只过滤 `deliverables/presented`，
    即**交付闸门**）与 `index.js:477`（自检）。
  - 真正会调模型的 `complete()`（`eval-llm.js`）**只被 `eval-smoke.js` / `eval-run.js` import**
    ——**只有评估台在用，产品路径从不用**。
  ⇒ **意图状态 / 澄清 / 编译 / 包装载这条链，在真实会话里没有任何触发者。
  没被触发的路径不是"待验证"，是"不存在"。**
- **为什么这条比它看起来更严重**：
  - **E-001 会是一个零实验**：C 臂注入 0 字符 ⇒ C ≡ A，跑完只会得到"没有差别"，
    而真相是"C 臂根本没运行"。**必须先修可达性，再花钱跑对照**（否则那笔钱买到的是一条会误导人的结论）。
  - A1–A14 全绿与"插件会做事"**正交**：这些门禁测的是**库行为**与**打包/装配**，
    **没有一条**问"这段代码在生产里有没有被调用"。**"全部通过"当时并不蕴含"会做事"。**
  - 此前 EV-0069 把"0.6 首次进入 enabled"记为里程碑——那只是**闸门判定**，不是**投递**。
    本轮把两者分开了：**判定 ≠ 投递**。
- **覆盖范围**：真实 home、真实装配、真实会话日志、真实模型调用（无工具单次任务）。
- **未覆盖**：
  - 只验了 headless 单轮；**web 多轮**未验（但根因是调用图缺失，与 profile 无关——多轮同样不会有包）。
  - 未验 `DSH_PO06_SELFCHECK=1` 的自检路径（它用桩解释器，只能证明编译与投递链本身可跑）。
- **关联**：EV-0069（判定不是投递）、ADR-0038（生产可达性作为门禁）、
  `po06/RELEASE-CHECKLIST.md` A15、EV-0066（装配层）、ADR-0012

## EV-0079 · 真机 + 集成 · 生产接线**已实现并验证**；真实会话里仍挡在闸门（`old-plugin-unknown`）

- **要支持的结论**：EV-0078 的缺口（生产路径不可达）已经**接线修好**，
  并且"接线真的通"这句话有**两条独立证据**：单元/集成级（假宿主走真实 `apply()`）
  与真机级（真实会话 + 真实模型）。同时如实记下**还没通的那一段**。
- **交付物**：`po06/lib/wire.js`（纯函数：来源判定 / 文本提取 / 模型解析 / 跳过判定）、
  `po06/lib/index.js` 的 `runProductionInput` + `session/event` 订阅、
  `po06/test/wire.test.mjs`（11 项）、`$DSH_HOME/po06-wire.jsonl`（**生产写入台账**）。
- **① 单元/集成级：11/11 通过**（`node po06/test/wire.test.mjs`，**假 LLM，零花费**）
  - 走的是**真实 `apply(ctx)`**：假 ctx 只提供宿主真实提供的面（`on`/`effect`/`get`/`inject`），
    并带一个**忠实的最小投影服务**（`register`/`stateOf`/按事件 fold）与 `append(type,data)` 同形的 session。
  - 台账实测走完整条链：`init → recordInput → advanceTurn → interpret → parse → recheck
    → dryRun → commit → clarify → setContext`，`outcome=committed`，**`packetChars: 114`**
    ——意图包真的写进了该会话的上下文。
  - 三条守护：① 插件自己的投递**不得**再触发解释（防自激循环，两次调用数相等）；
    ② 闸门未放行 ⇒ **一次模型调用都不发生**；③ 没有模型路由 ⇒ 跳过且不写包。
- **② 真机级：接线**执行了**，但被闸门拦在解释之前**（这是本轮的新发现，也是下一步）
  - 隔离 home、真实装配、真实模型：`wire.jsonl` 对每条真实用户输入都留下判定记录——
    这正是 EV-0078 时**完全没有的**可观测性。
  - 记录内容：`ok:false, reason:'gate-disabled', gate:'old-plugin-unknown'`（两轮皆然）。
  - 根因在闸门本身（ADR-0033 的保守方向）：`decideEnableFor` 只在
    **`sp && agent` 都拿得到**时才把旧插件判定为 `runtime` 置信；否则 `active=null`
    ⇒ `toActiveTriState` 返回 `null` ⇒ `resolveEnableDecision` 判 `old-plugin-unknown` ⇒ **不启用**。
    在 headless 里这一步没拿到（`ctx.inject` 回调非同步是已知的 P1-6 教训）。
  - **含义**：即使接线修好，**在拿不到 per-agent 作用域的环境里 0.6 仍会保持关闭**。
    这是"宁可不用，也不与旧版双拦截"的既定取舍——但它必须**说得清**，
    所以本轮给台账补上 `gateReason`，让"装了却什么都不做"永远有据可查。
- **顺带抓到的三个坑（都不是产品缺陷，但都能伪造结论）**：
  1. **`dsh plugin add <同一个 tgz 路径>` 不会刷新已安装的副本**：pnpm 打印
     "Lockfile is up to date, resolution step is skipped"，装进去的仍是旧代码
     （实测：`wire.js` 不存在、`runProductionInput` 命中 0 次，mtime 还是上一版）。
     **改用每次构建唯一的新路径**后才真正装上（`wire.js` 存在、命中 3 次）。
     ⇒ 这正是 A13 存在的理由；**验证前必须先核对装进去的那份代码**。
  2. **语法非法的变异体被记成"变异存活"**：把 `if (x) return …` 改成 `if (false) {`
     会留下未闭合括号 ⇒ 套件 import 失败、输出不可解析 ⇒ `r.fail` 为 `undefined`
     ⇒ 既不算捕获也不报错。**差一点让我去削弱测试**。已修：套件输出不可解析一律记为
     `UNPARSABLE-SUITE-OUTPUT`（工具/变异体故障），**不得**混进"存活"名单；
     并把两个变异体改成只改条件（语法合法）。
  3. **我在源码上重犯了 ADR-0014**：用 PowerShell `Get-Content -replace | Set-Content`
     改测试文件，中文全部变成乱码（`mojibake=true`）。已用编辑器后端整体重写。
     **规则本来就有，是我没遵守**——记在这里，比记在 ADR 里更有用。
- **变异**：新增 6 个（来源过滤失效 = 自激循环、闸门放行、空输入仍解释、**编造模型路由**、
  半截配置被接受、缺 messageId 编造），累计 **109 个 / 20 个源文件，全部被捕获**；
  测试 **357 项 / 24 套**；`check-release.mjs` PASS。
  其中"生产订阅里的来源过滤"**故意不加变异**：它与 `decideInterpret` 里的检查是双重保险，
  删任一层都不会出事，单独立变异只会得到一个永远存活的假信号。
- **未覆盖 / 未验证**：
  - **web profile（用户真正用的那个）尚未验**：`old-plugin-unknown` 是在 headless 观察到的；
    web 下 `systemPrompt`/`agent` 是否可达未测。EV-0054 曾在**用户真机**上拿到过
    `runtime` 置信（当时 0.5.x 在装 ⇒ 正确地判 DOUBLE_INTERCEPT），
    说明"能观测到存在"这条路是通的；**"能确证不存在"这条路还没验过**。
  - `PROFILE_DIR` 在 `decideEnableFor` 里**硬编码为 `profiles/web`**，
    非 web profile 下静态探测查的是别的目录（本轮发现，未修）。
  - 零延迟取舍的后果未在真实多步任务上观察（单步任务拿不到包，属**已知取舍**）。
- **关联**：EV-0078（缺口的发现）、ADR-0038（A15）、ADR-0033（闸门保守方向）、
  ADR-0035（判定保质期）、EV-0054（真机闸门对照）、EV-0056/A13（验的是哪份代码）、ADR-0014

## EV-0080 · 真机 · **0.6 首次在真实会话里跑通全链**：意图包进了模型历史（327 字符）

- **要支持的结论**：EV-0078 的"生产路径不可达"已彻底闭环——不只是接线写好了，
  而是**真实宿主 + 真实模型**下，意图包真的出现在 agent 的**消息历史**里。
- **真机证据（隔离 home、headless、真实模型、独立工作目录）**：
  - 台账：`outcome:"committed"`、**`packetChars: 327`**、`revision: 4`、`items: 3`，
    trace 走满 `init→recordInput→advanceTurn→interpret→parse→recheck→dryRun→commit→clarify→setContext`
  - 会话日志：宿主快照由 **485 → 814 字符**（多出的正是我们的包），
    且 `source.sections` 里出现贡献者名 **`prompt-optimizer:intent`**
  - 包的实际内容（逐字）：
    ```
    [插件辅助上下文 · 不是用户新增的命令]
    任务 default · 意图修订 4。用户原话保留在本轮人类消息中，以下仅为辅助说明。
    【明确要求】
    - 用 pwsh 执行命令 Start-Sleep -Seconds 10。（来源：human msg:d2eeb41b-…）
    - 命令执行后，回复内容只包含 OK，不附加任何其他说明。（来源：human msg:…）
    【未决项（尚未确定，不要替我拍板）】
    - 若 pwsh 不存在或 Start-Sleep 执行失败，仍然只回复 OK，还是改为报告失败原因？（来源：model）
    ```
    ⇒ 它**逐条引用用户原话**，并把"模型自己拿不准的事"标成**未决项**而不是替用户拍板
    ——正是宗旨里"不违背用户本意、有信息差就回问"的行为。
- **为此修掉的四个真缺陷（每一个单独存在都足以让 0.6 在真机上什么都不做）**：
  1. **`agents` 服务从来没接上**：`apply` 时 `ctx.get('agents')` 返回 **null**，
     而闸门的运行时探测需要 `agent` 才能判"旧插件不在装" ⇒ 永远 `old-plugin-unknown` ⇒ 永远不启用。
     改为 `ctx.inject(['agents'], …)`（与 `systemPrompt` 同一套写法）后闸门立刻判 **`enabled`**。
     附带修掉一个**会说谎的诊断**：`services: { agents: typeof … }` 对 null 打印 `"object"`
     （`typeof null === 'object'`），于是"服务没接上"这件事**藏在了一份看起来正常的报告里**。
     现在如实区分 `null` / `no-get` / `ok:get`。
  2. **不能在会话事件派发窗口里 append**：真机抛
     `session append cannot reenter while another append is being published`。
     我们这条链的第一步（初始化/记录输入/推进轮次）就是 append ⇒ **同步执行必然失败**。
     修法：`defer()` 推迟到下一个宏任务。**这条同时暴露了假宿主的缺陷**——
     第一版假 session 没有这条约束，于是"测试全绿、真机全败"。现已让假宿主复刻该禁令，
     并加了变异体（去掉 defer 即变红）。
  3. **宿主先发用户消息、后发 `request/header`** ⇒ 新会话第一条消息到达时还不知道用哪个模型。
     旧行为是放弃这一轮；改为**记住待办**，模型一出现立刻补跑 —— 包因此落在**同一轮的第 2 步**
     而不是整整晚一轮。
  4. **生命周期**：若一轮在后台解释完成前就结束了，投影读取会返回 `undefined`
     ⇒ `state-lost`（那一笔解释调用的钱白花）。实测：1 步的短轮必失败，
     把轮次拉长到 10 秒（`Start-Sleep`）后稳定 `committed`。
     ⇒ 长驻的 web 会话不受影响；**一次性短任务可能白跑一次解释**（已知代价，非缺陷）。
- **仪器缺陷（本条最该记住的一件）**：`dump-wire.mjs` 一开始对**同一个会话**报
  `包=false` 并把宿主每步重发快照误报成"累积"。若信了它，结论会写成
  "包仍然没进历史"——**与事实相反**。已修：改为按**结构指纹**判定
  （`source.sections[].name` 里有没有我们的注册名），文案只作兜底；
  "累积"只统计**本插件自己**的消息（宿主每步重发是它自己的全值语义，不是我们累积）。
  并给这个仪器补了 5 项单测（仪器也要被检验，ADR-0034）。
- **验证**：`check-release.mjs` PASS（**25 套 / 362 项**）；变异 **110 个 / 20 个源文件全部被捕获**；
  本轮新增变异含"去掉 defer""去掉来源过滤""编造模型路由"等。
- **未覆盖**：
  - **web profile（用户日常那个）仍未验**：以上全部在隔离 home 的 headless 上取得。
    `PROFILE_DIR` 仍硬编码为 `profiles/web`（非 web profile 下静态探测查错目录，未修）。
  - 长驻进程内的"第 2 步起带包"只在**原理**上成立（包已写入上下文），
    未在一次真实多步 web 会话里逐轮核对。
- **关联**：EV-0078/0079、ADR-0038、ADR-0034（仪器先被检验）、EV-0070（独立工作目录）、ADR-0012

## EV-0081 · 真机 · **P0：0.6 写过的会话会变得无法再打开**——自定义事件未标记 `ignorable`

- **要支持的结论**：0.6 的持久化方式**本身是错的**：它把状态当作自定义会话事件追加进会话日志，
  而宿主对这种未知事件类型的态度是——**拒绝重建整个会话**。
  也就是说：包是投递成功了，但**那条会话从此不能再被打开**。这比"什么都不做"严重得多。
- **复现（一条命令，错误原文如下）**：
  ```powershell
  $env:DSH_HOME='C:\Users\WestFox\.dsh-po06-iso'
  dsh --profile headless --json --session-id <任何被 0.6 写过的会话> "只回答 OK"
  ```
  > `failed to observe session "…": session "…" contains event type "prompt-optimizer/state-changed"
  > (seq 15) unknown to this harness and not marked ignorable; **refusing to interpret the log**
  > — it was likely written by a newer harness`
- **根因（逐条读宿主源码确认，不是推测）**：
  1. `SessionEvent.ignorable` 的语义是**强制**的：宿主类型注释原文——
     「Absent means required: a reader meeting an unrecognized type without this marker
     **MUST refuse to reconstruct the session**」。
  2. `Session.append(type, data, ...opts)`（`dsh-session/lib/index.js:1236`）构造信封时
     **只**接受 `sourceEventSeqs` / `surfaceOp` 两个字段——**插件根本无法通过 append 置上 `ignorable`**。
  3. 未知类型是否被容忍，由写入侧决定（`dsh-session-log-deepseek/lib/index.js:56`：
     `!KNOWN.has(type) && event.ignorable === true` 才当不透明记录保留）。
  4. `KNOWN_SESSION_EVENT_TYPES` 是**构建期静态**的（`dsh-session-format-catalog` 由脚本生成），
     插件无法在运行期注册自己的事件类型；实测该集合里 `prompt-optimizer` 出现 **0** 次。
  ⇒ **"把状态当作自定义会话事件写进日志"这条路在当前宿主上不可用**，
  不是参数没传对，而是**这条路本身不存在**。
- **影响范围（已实测确认，不是推断）**：
  - 隔离 home 里 0.6 写过的会话**全部**进入该状态（本轮就是因此在 A6"重启恢复"上撞墙——
    之前一直以为是 `restore()` 的问题，实际是**会话根本读不出来**）。
  - **用户日常 home 未受影响**：真实 `prompt-optimizer.json` 仍是 0.5.x 的状态文件
    （`tier/permission/strategy/perSession/…`），真实 `profiles/web` 的 bundles 是
    `dsh-base`/`dsh-web-app`/`dsh-super-injector`/`dsh-graded-mode`——**没有 `dsh-po06`**。
    0.6 从未在真实 home 启用过，真实会话里没有这个事件类型。
- **为什么这条改变了 A15 的结论**：EV-0080 证明"包能进模型历史"是真的，但那只覆盖
  **会话进行中**；本条说明**会话的持久化被破坏了**。一个会损坏用户会话日志的插件，
  无论效果多好都不能发布——所以 A15 从"✅ 满足"改判为**带条件**，并新增 A16 硬门。
- **修法（下一轮的架构决定，方向已明确）**：
  - 首选：**状态改由插件自己的存储持久化**（按会话 id 存 JSON，放在 `DSH_HOME` 下），
    不再往会话日志里写任何自定义事件。会话日志回到"宿主自己的东西"，污染面归零。
  - 备选：查明宿主是否有**外部事件的正规写入通道**（宿主注释引用了
    `.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md`，
    说明这是被设计过的能力），若有则按该通道写。
  - 无论选哪条，都必须附一条**真机回归**：0.6 跑过之后 `--session-id` 仍能打开该会话。
  - 现存被污染的日志只在我自己的隔离 home 里，属测试区，可整体重建。
- **未覆盖**：宿主是否提供"外部事件"正规通道**尚未查证**（下一轮第一件事）。
- **关联**：EV-0080（投递成功）、ADR-0038（A15）、`po06/RELEASE-CHECKLIST.md` A16、ADR-0015（投影）

### EV-0081 的修复与验证（同轮完成，见 EV-0082 的收尾）

- **查证结果：没有可用的外部事件通道。** 读宿主源码逐条确认：
  ① `Session.append(type, data, ...opts)` 的信封只收 `sourceEventSeqs`/`surfaceOp`，
  **插件无法置 `ignorable`**；② `KNOWN_SESSION_EVENT_TYPES` 是**构建期静态**的
  （`scripts/gen-session-format-catalog.ts` 生成），第三方插件无法运行期注册；
  ③ 一线插件（`goal/change`、`plan/mode`、`schedule/change`）之所以能写，是因为它们
  **本身就是一线**、类型已进静态表——这条路对第三方**不存在**；
  ④ 投影缓存**不是**持久化机制：宿主契约原文写着
  "A row is never authoritative, only a fold shortcut"——它是日志的派生视图，
  而我们的状态来自模型输出、**不由日志推导**。
  ⇒ **结论：状态必须由插件自己拥有。**
- **修法**：新增 `po06/lib/store.js`——插件自己的按会话状态存储
  （`<DSH_HOME>/po06-state/<sessionId>.json`，整份覆盖，原子替换：先写 `.tmp` 再 rename）。
  会话 id 按**不可信输入**处理（白名单字符 + 长度上限），杜绝路径穿越。
  `commitPatch` 增加 `persist` 出口：传了就**永不** append；不传才走会话事件（只留给自检/既有单测）。
  适配器新增**唯一**落盘出口 `land()`。
- **顺带抓到一个旁路**：`commitUserInput` 曾**自己**调 `session.append`，绕过 `commitPatch`——
  于是"生产路径不写会话日志"这条纪律被一个旁路破坏。反回归测试当场抓到（`got ["prompt-optimizer/state-changed"]`）。
- **真机验证（隔离 home、真实模型、两个独立进程）**：

  | 检查 | 结果 |
  |---|---|
  | 第一轮提交 | `outcome:committed`、`packetChars:243`、`revision:4`、`items:2`；**会话日志零 append**；状态落在 `po06-state/<sid>.json`（1085 B） |
  | **A16 会话可再打开** | ✅ `--session-id` **无错**（修复前是 `refusing to interpret the log`），该轮正常完成 |
  | **A6 重启后状态恢复** | ✅ 新进程 trace = `recordInput→advanceTurn→interpret→parse→clarify→setContext`，**没有 `init`**，revision **4 → 6** 续上 |
  | 包仍在历史里 | 该会话有 **2 份**带包快照（730 字符，`source.sections` 含 `prompt-optimizer:intent`） |

- **未覆盖**：web profile 未验（同上）；`po06-state` 的清理策略（目前只给了 `keep` 字段，**未实现淘汰**）。
- **关联**：EV-0080、ADR-0038、ADR-0015、`po06/RELEASE-CHECKLIST.md` A6/A16

## EV-0082 · 工具 · **变异检验会把源文件留在"已变异"状态**（我的工具差点让我修错地方）

- **要支持的结论**：一个会**改写被测源码**的工具，必须能证明"跑完源码回到原样"，
  并且必须在**开跑前**确认上一次没有留下残骸。否则后续每一次测试跑的都是**被改过的代码**，
  而失败信息会指向**无辜的地方**。
- **事故经过（真实发生在本轮）**：我用
  `node po06/test/mutate-check.cjs 2>&1 | Select-Object -First N` 看结果。
  `Select-Object -First` 会**提前关闭管道**，node 进程在
  "变异体已写入、`finally` 还没执行"的瞬间被杀 ⇒ `po06/lib/index.js` 里留下
  `const r = { ok: true } /*MUTANT*/`（把存储写入整段删掉了）。
- **代价**：此后 `wire.test.mjs` 有两项失败（"A6 载不回状态"）。我据此开始排查
  store 的读写路径——**方向完全错了**，真因是文件里躺着一个变异体。
  写了一个独立诊断脚本才定位到（store 单独跑完全正常）。
- **修法**：
  1. **开跑前自检**：扫描所有 `file:` 目标里有没有残留的 `/*MUTANT*/`；
     有就打印 `LEFT-OVER-MUTANT` + 文件清单 + 恢复方法，并以退出码 **3 拒绝运行**。
  2. 既有保障保留：跑完**逐字节**比对还原（`byteIdentical`）。
  3. **操作纪律（写进这里，因为它比代码更容易再犯）**：
     调用本脚本时**绝不**把输出接给会提前终止管道的消费者
     （`Select-Object -First` / `head` 等），一律先 `Out-String` 收全再筛。
- **同时修掉的一个**错断言**：我原本断言"消毒后的路径不含 `..`"——错的。
  `.._.._evil.json` 里确实含 `..`，但那只是文件名里的普通字符、不构成穿越。
  正确的不变量是**包含关系**（`resolve(path)` 必须仍在存储目录内）。
  断言写错会让人去改**正确的代码**。
- **验证**：加自检后 `mutate-check` 报 **116 个变异全部被捕获、源文件字节还原**；
  启动自检本身也守住了"我不再管道截断"这件事（若再犯，会看到 `LEFT-OVER-MUTANT` 而不是一堆莫名其妙的失败）。
- **关联**：ADR-0034（仪器先被检验）、EV-0081、ADR-0014（不要用 shell 做源码读改写）

## EV-0083 · 真机 · web profile **装配正确**；并给 `po06-state` 补上淘汰策略

- **要支持的结论**：① 0.6 在**用户真正使用的 web profile** 里能以当前这份代码正确装配、
  接线齐全、profile 解析正确；② 上一轮新增的状态存储**不会无限增长**（这是我上轮留下的缺口，
  而"把用户磁盘写满"正是本项目被明确要求避免的事）。
- **web profile 实测（隔离 home，`dsh --profile web --port 0 --no-open`）**：

  | 观测 | 值 |
  |---|---|
  | `moduleUrl` | `…/.dsh-po06-iso/profiles/web/node_modules/@dsh-external/dsh-po06/lib/index.js`（**web 那一份**） |
  | `profile` | `{name:'web', source:'argv', requested:'web', exists:true}` ⇒ EV-0081 前半段的 `PROFILE_DIR` 修复**在真实 web profile 上成立** |
  | `stateStore` | `{dir:'…/po06-state'}` |
  | `productionTrigger` | `ok:true`，钩子 `session/event → user/message(source.kind=user)`，`awaited:false` |
  | `services` | `{agents:'null', sessionController:'null'}` —— **如实报 `null`**（旧诊断会把 null 打成 `"object"`，见 EV-0080） |
  | verdict | **`ACTIVE: 已注册且生产触发已接线`** |

- **⚠ 又是"装进去的不是你以为的那份"（A13 的形态在 web 上重现）**：第一次读取报告时
  `profile/stateStore/trigger` 全是 `undefined`、verdict 还是旧的 `IDLE: 已注册并静默待命`
  ——iso **web** profile 的依赖指向旧 tgz，pnpm 复用了缓存抽取。换成**新路径**重装后报告才正确。
  ⇒ 该陷阱与 profile 无关，**换 profile 也要重新核对装进去的那份**（第 2 次踩，已进检查表）。
- **未覆盖（明确记录，不含糊）**：**web 下的端到端投递未验**。原因不是懒：
  web 的接口是 **WebSocket/Typert 流**（`dsh-api-gateway`），不是 REST，驱动它要手写协议；
  而插件自带的 P8b 探针读 `agents.list()[0]`，**刚启动的 web 实例没有 live agent**
  （读 `runP8bCheck` 源码确认，非推测）。所以"web 里真的把包送进模型历史"这件事**仍无证据**。
  已知头less 下同一条代码路径端到端通过（EV-0080/0081 修复验证），
  故剩余风险集中在 **web 特有的服务接线时机**，而不是插件逻辑本身。
- **`po06-state` 淘汰策略（本轮补上）**：`createStateStore({keep})` 在每次 `save` 后
  只保留最近 `keep`（默认 200）份；淘汰**尽力而为**（失败绝不让本次保存失败——
  保存成功是正确性问题，淘汰只是空间问题）。上限取非法值（0/负/NaN/Infinity/字符串）
  一律**退回默认**：`keep=0` 会让 prune 把刚写的文件也删掉，那是**静默自毁**。
  新增 2 项测试（含"最新那份永不被误删"）+ 3 个变异（不淘汰 / 淘汰方向反了 / 上限校验失效）。
- **验证**：`check-release` PASS；变异 **119 个 / 20 个源文件全部被捕获**、源文件字节还原；
  临时目录清理生效（完整跑一遍后 `%TEMP%` 里 `po06-*` 目录数为 **0**）。
- **关联**：EV-0080（诊断如实）、EV-0081（PROFILE_DIR）、EV-0082（工具纪律）、A13、A16

## EV-0084 · 真机 + 工具 · web 实例**启动时没有 live agent**；并修掉"证据目录写死"造成的自我污染

- **要支持的结论**：① web profile 下"能不能验到端到端"这件事本身是**有答案的**，不是含糊的"还没做"；
  ② 证据目录必须跟着 `DSH_HOME` 走，否则**测试会往真实证据目录里倒垃圾**、不同 home 的证据混在一起。
- **① web 端到端为什么验不了（实测，非推测）**：在隔离 home 启动 web 实例，让插件自带的
  P8b 探针跑（它专门验"装配期闸门有没有真的接在上下文贡献上"）：
  报告停在 **`{hasSystemPrompt: true}` + `error: 'no agent/systemPrompt to probe'`**
  ——`hasSystemPrompt` 为真，但 **`agents.list()` 是空的**：web 实例即使 home 里有 13 个已存会话，
  **启动时也没有 live agent**（agent 是打开会话时才建的）。
  读 `runP8bCheck` 源码印证：它取 `agents.list()[0]`。
  ⇒ 要验 web 端到端，**必须先有一个真实会话**（驱动 GUI 或手写 Typert WebSocket 客户端）。
  这条把"未验"从"没来得及"变成了**一个有证据的结论 + 一条明确的下一步**。
- **② 自我污染（实测数字）**：`EVIDENCE_DIR` 原本硬编码为
  `C:/Users/WestFox/.dsh/exp/po06/probe-reports`（真实 home 的绝对路径），后果两条：
  - 单测调用 `apply()` 也会写报告 ⇒ 该目录 **1532 份报告里有 1530 份来自单测**
    （变异检验每跑一轮就多几十份）；
  - 隔离实例与日常实例的报告**混在同一个目录**，"这份证据是哪个 home 产出的"只能靠 moduleUrl 猜。
  改为 `process.env.DSH_PO06_EVIDENCE_DIR || join(DSH_HOME, 'po06-reports')`：
  真实 home → `<home>/po06-reports`；隔离实例 → 它自己的；**单测 → 临时目录（随 exit 钩子自动清理）**。
- **清理与验证**：按"其 `enableSite.configPath` 落在系统临时目录"这一**判据**筛出测试产物，
  删除 **1015** 份、保留 **517** 份真实运行记录（判据明确、可复核，不是"看着像就删"）。
  验证：单跑一遍套件后旧目录文件数 **不变**；完整变异检验（120 个变异）后增长 **0**。
- **顺带修掉两处自己的错误**：
  1. **残留的探针开关**：本轮早些时候我建了 `run-p8bcheck.flag` 用于 web 验证，**忘了删**——
     于是此后**每一次** `apply()`（含所有单测）都会额外跑一遍 P8b 探针（2 次 assemble + 等待），
     既拖慢测试又污染报告。已删除，并记住：**开一次探针就要负责关掉它**。
  2. **变异体自己在制造污染**：`evidence-dir` 那个变异体第一版把路径换回**真实的遗留目录**，
     于是每跑一轮变异检验都会往那里丢几份垃圾。改成指向另一个派生路径即可让断言照样变红、
     而**不产生任何副作用**——"验证手段本身不能污染被验证的环境"。
- **验证**：`check-release` PASS（25 套 / 369 项）；变异 **120 个全部被捕获**、源文件字节还原；
  遗留证据目录增长 **0**；`%TEMP%` 里 `po06-*` 目录 **0**。
- **未覆盖**：web 端到端（见①的结论与下一步）；`eval-smoke` 的 `OUT_DIR` 仍是硬编码绝对路径
  （同类问题，未改）。
- **关联**：EV-0083（web 装配核验）、EV-0069（探针需要会话）、EV-0082（工具纪律）、A13

## EV-0085 · 真机 · **真实多轮（A7）**：长驻进程连发两轮，跨轮约束真的进了第二轮的模型上下文

- **要支持的结论**：① 0.6 在**长驻进程**里的多轮行为成立（不只是"两个进程各跑一轮"）；
  ② 跨轮的约束**真的出现在后一轮的模型上下文里**（长期约束保持，S3 关注的性质）；
  ③ 顺带把"零延迟"的真实语义**精确刻画**出来，而不是停留在"包从第 2 步起"。
- **怎么做到的（这条路本身也是发现）**：宿主带了 **SDK JSON-RPC 服务**
  （`dsh-sdk-jsonrpc-server`，方法只有 `initialize` / `session/prompt` / `shutdown`，
  通知有 `session/created` / `session/event` / `agent/status`）。
  `sdk` 是**内置 profile**（`--from-default-profile sdk` 会被拒绝；直接 `--profile sdk` 用），
  但仍可以为它建用户层 ⇒ `dsh plugin --profile sdk add <tgz>` 装上了 0.6。
  于是我用一段临时驱动器（NDJSON-JSON-RPC over stdin/stdout）在**一个长驻进程**里
  造会话并连发两轮提示词。**这是可编程驱动真实会话的通路**，
  也说明 web 端到端要验的话，除了 GUI 自动化还有 SDK 这条路（见 EV-0084 的下一步）。
- **实测（隔离 home、真实模型、一个进程、两轮）**：

  | 轮 | 台账结果 | 包大小 | revision | items | trace 首步 |
  |---|---|---|---|---|---|
  | 第 1 轮 | `committed` | 406 字符 | 4 | 4 | **`init`** |
  | 第 2 轮 | `committed` | **548 字符** | **7** | **6** | **`recordInput`（无 `init`）** |

  ⇒ 状态**跨轮延续并增长**（items 4→6、包 406→548），第 2 轮没有重新初始化。
  状态落盘 `po06-state/sess-a7-*.json`（2488 B）。
- **跨轮约束确实进了模型上下文（会话日志 seq 映射）**：

  ```
     4 turn/start
     6 step/start
     8 user/message  user                 ← 第 1 轮原话
     9 user/message  plugin               ← 第 1 轮 step1 装配：**无包**（解释还没跑完）
    10 user/message  skill-catalog
    17 turn/end
    19 turn/start
    21 step/start
    22 user/message  user                 ← 第 2 轮原话（只补了一条新约束）
    23 user/message  plugin [含意图包]     ← **第 2 轮 step1 装配：带包**
    27 turn/end
  ```
  seq 23 里那份包是**第 1 轮的包**（revision 4，只引用第 1 轮的消息 id），
  而第 2 轮自己的包（548 字符 / revision 7）是在它那唯一一步之后才写好的。
  ⇒ **第 2 轮的模型确实看到了第 1 轮编译出的要求**（"把秒数格式化为 时:分:秒"+ "只允许一句话"），
  而第 2 轮只说了"函数名必须叫 fmt_duration"。
- **由此精确刻画"零延迟"的真实语义**（这条比"包从第 2 步起"有用得多）：
  **包永远落后一步。** 同一轮内：第 2 步起可见；跨轮：第 N+1 轮的模型看到第 N 轮的包；
  **单步轮次则要等到下一轮**。这是用户选定取舍的必然结果，不是缺陷——
  但它是**可观测、可预期**的，而且"下一轮一定看得到"这一点让累积的约束不会丢失。
- **验证**：`check-release` PASS（25 套 / 369 项）；变异 120 个全部被捕获。
- **未覆盖**：fork 行为（A7 的另一半）未验；web GUI 端到端未验（EV-0084）；
  SDK 通路是**内置 profile**，与 web profile 的服务装配仍有差异（但两者核心 bundle 相同）。
- **关联**：EV-0084（web 为何验不了）、EV-0080/0081（投递与持久化）、ADR-0023/0024（轮次语义）、ADR-0012

## EV-0086 · 静态 · 成本上界不再跨类借价：S1 授权门槛从 43× 降到 3×

- **要支持的结论**：上界的口径必须与它**唯一用途**（别跑到一半没钱）相称。
  把闸门抬到不切实际的高度，只会让它被绕过——**那比没有闸门更糟**。
- **问题**：旧上界是 `unit × 题数 × 轮数`，而其中的 unit 是 D-01 那道**大视觉题**（坦克）的实测单价。
  于是 S1（6 道澄清/歧义小题、**零道**大视觉题）的上界 = 1,530,366，期望值只有 35,016 ⇒ **43 倍**。
  这不是保守，是**类别错误**：它要覆盖的风险本是"某一题用量高于锚点"，
  而不是"这道小题其实是道大视觉题"。
- **改法**：新增 `UPPER_MARGIN = 3`（方差余量，**不是折扣**）；两类题各用自己的实测锚点
  （大视觉题 → D-01；非视觉题 → EV-0063 的 464/822），解释层同样上浮并单列 `interpreter.upper`。
- **数字**：S1 期望 35,016（不变）；上界 **1,530,366 → 105,048**（≈ 期望 × 3）。
- **新增测试**：「上界与期望值的比例必须与余量同量级」（< 10 且 ≥ 余量）——
  专门防止以后又跨类借价（过大）或偷偷打折（过小）；另更新三处编码旧公式的断言
  （含「S2 期望值 = 上界」→「上界 = 期望值 × 余量」）。
- **B2 的阻断同时解除**：此前 B2 标着"A15 通过前禁止运行"，因为 C 臂会注入 0 字符。
  现 A15/A16/A6/A7(多轮) 均已转绿 ⇒ **阻断理由消失**，B2 改为"等预算授权"。
- **验证**：eval-plan **32/32**；`check-release` PASS（**25 套 / 370 项**）；变异 **120 个**全部被捕获、源文件字节还原。
- **未覆盖**：余量取 3 是**判断**而非测量（锚点本身是单次实测，见 EV-0077 的未覆盖）；
  真跑 S1 后应把实际用量回填、据此校准余量。
- **关联**：EV-0077（实测锚点）、EV-0063（小题实测）、EV-0085（口径澄清同类工作）、ADR-0034

## EV-0088 · 真机 · **E-001 / S1 首次跑完（36/36）**；判据给出不利于 0.6 的初步信号

- **要支持的结论**：E-001 从"跑不起来"变成"跑完了、有产物、可分析"；
  并且**第一次拿到了真实的效果数据**（无论它是否好看）。
- **先立入口**（EV-0087 记的缺口）：新增 `po06/lib/eval-e001.js` + `index.js` 的 `runE001Check` 触发。
  三段顺序固定：① 封存校验 ② **逐题**解释层（C 臂的包是"题的属性"，`runEvaluation` 只收单个 packet）
  ③ 单元循环（交给 `runEvaluation`，带开跑前拒绝 + 预算闸门 + 续跑）。
- **自检（先花小钱验管道）**：1 题 × A/C × 1 轮 ⇒ **PASS**，seal 通过、包 347 字符、
  2 个单元全产出。**实测 3,586 tokens**，与 EV-0063 锚点预测的 3,264 相差 ~10%——锚点再次被独立印证。
- **正式 S1（6 题 × A/C × 3 轮 = 36 单元）**：
  - 结果：**36/36 全部产出，0 失败**；`ok:true`。
  - 花费（两轮合计，均在授权上界内）：**run1 42,884 + run2 49,623 = 92,507 / 上界 105,048**。
  - 组成：解释层 14,211（6 题，平均 2,369/题）＋ 单元 35,412（36 个，平均 984/单元）。
- **⚠ run1 白花了（我的仪表缺陷，必须记下）**：第一版 `runUnits` 的 record **只存 `chars` 不存正文**
  （`eval-run.js` 里 `r.text` 就在手边却没留下）。E-001 要判的是**答案质量**，而质量只能从正文判——
  **钱花了，产物不在**。已修（record 加 `text`/`reasoning`，并按单元落 `units/<unitId>.md`）。
  教训与 ADR-0034 同源：**跑之前先问"判据需要的东西存下来了吗"**——我先验了"单元能跑通"，
  没验"判据需要的证据会留下"。
- **S1 判据结果（用三件工具，跑在 36 份真实产物上）**：

  | 判据 | A 臂（无插件） | C 臂（0.6） | 读法 |
  |---|---|---|---|
  | 可疑放大（越少越好） | **0** | **0** | 两臂都没放大 ⇒ **这条不判别**（但至少说明 C 没有把包里的东西变成新硬约束） |
  | 答案里的问句总数 | 27 | **41** | C **问得更多** |
  | ├ "用户偏好"类（该问） | 8 | 12 | 该问的确实问了 |
  | └ **"实现细节"类（不该问）** | **5** | **12** | **C 明显更多** —— 与"该问才问、实现细节自己定"的设计意图**相反** |
  | 需人工阅读 | 0 | 0 | 无 |

  按题看问句（A/C）：H-07 1/5、H-08 2/3、H-09 7/9、H-10 9/7、H-11 2/3、**H-12 6/14**。
- **可复核的机制假设（尚未验证）**：包里有【未决项】段。C 臂模型看到这些"尚未确定"的条目后，
  很可能**把它们当成该问用户的问题抛了出来**——于是把本该自己定的实现细节也问回给用户。
  这与宗旨里"有信息差也进行回问"的**边界**有关：回问该限于**用户偏好**，不该扩到实现细节。
  **这是下一步最该查的一条**（可做：对比"带未决项"与"去掉未决项"的 C 臂，看 implQ 是否下降）。
- **诚实的边界**：n=3/题，单一模型、单次运行；`implQ` 分类是**标记法**（EV-0073），
  可能把反问/设问误计；"问得多"本身不等于"更差"（也可能是更谨慎）——**需要人读**才能定性，
  我只报了可机器判定的计数。
- **验证**：`check-release` PASS（25 套 / 370 项）；变异 120 个全部被捕获。
- **关联**：EV-0087（入口缺口）、EV-0063（锚点）、EV-0073（问句分类）、ADR-0034（先验仪器）、B2

## EV-0090 · 真机 · 机制实验：**【未决项】段不是"多问实现细节"的原因**（假设被否证）

- **要支持的结论**：EV-0088 提出的机制假设——"包里的【未决项】段让 C 臂把实现细节问回给用户"——
  **不成立**。否证它同样重要：否则会去"修"一个没坏的东西（删掉一段其实有用的内容）。
- **实验设计**：H-07、H-12（EV-0088 里 C 臂问句偏高的两题），**C 臂 × 3 轮**，
  条件 = 去掉【未决项】整段（`stripUnknownSection`，EV-0089），与 run2 的对应单元比较。
- **实测**（花费 10,861：解释层 5,208 ＋ 6 个单元 5,653；6/6 产出、0 失败）：

  | 条件 | 单元 | 问句总数 | **实现细节类（不该问）** | 用户偏好类（该问） |
  |---|---|---|---|---|
  | 带【未决项】（run2） | 6 | 19 | **6** | 4 |
  | 去【未决项】（run3） | 6 | 15 | **6** | 5 |

  ⇒ 去掉那一段**减少了问句总数（19→15），但"不该问"的那一类一条没少（6→6）**。
  **机制假设被否证**：多问实现细节不是【未决项】段造成的。
- **因此不该做的"修复"**：删掉【未决项】段。它看起来仍承担真实职责（把模型自己拿不准的事标出来、
  不替用户拍板，见 EV-0080 的包内容），而删掉它对目标问题**没有帮助**。
- **诚实的边界（含一个明确的混淆项）**：
  - n 很小：2 题 × 3 轮 = 每组 6 个单元；问句分类是**标记法**（EV-0073），可能误计。
  - **⚠ 混淆项**：两个条件的包来自**两次不同的解释层运行**（run2 的包没落盘，基线只能取自 run2），
    所以两组之间的差异**不止"有没有那一段"**——解释层本身是非确定性的，包内容会变。
    ⇒ 严格的做法是**编译一次、两个条件共用同一个包**。EV-0089 已让包落盘并可复用，
    下一次做这个对照时只需要付费跑单元（同 2 题约 11k，全 6 题约 33k），不必再付解释层。
- **花费账（对用户预算负责）**：本实验 10,861；E-001 累计 **103,368 / 105,048**（授权内，余 1,680）。
  **用户为"小实验"额外批的 3.5k 没有用到**——按实测单价选 2 题而非 3 题，落回了原授权额度内。
- **下一步（按价值排序）**：
  1. **编译一次、双条件共用包**重做本对照（消掉混淆项）；顺带把题数扩到 6。
  2. 若 implQ 仍不降，则"多问实现细节"的成因在别处（候选：包整体让模型更谨慎；
     或**无包时模型本来就不问**，而有包时任何"结构化提示"都会抬高提问倾向）。
  3. B2 仍缺 **B 臂（0.4.4）** 对照。
- **关联**：EV-0088（假设来源）、EV-0089（包落盘/复用 + 实验工具）、EV-0073（分类法）、ADR-0034

## EV-0091 · 静态 + 单元 · 分叉会话的意图状态继承（ADR-0039）；**真机分叉未验**

- **要支持的结论**：EV-0081 把状态改成"按 sessionId 存在插件自己的存储"之后，
  **分叉会静默丢失全部累积约束**——这是一个由那次改动**引入**的缺陷，必须补上，
  否则分叉出来的会话会因为"没有任何提示"而让人以为插件坏了。
- **依据（读宿主类型定义，非推测）**：`SessionHeader.parentSession?: SessionId`
  （"The session this one was forked from (seed lineage), if any"）＋
  `Session.inheritedEventCount`（"Number of leading events inherited from this Session's fork parent"）
  ⇒ 分叉 = **新 sessionId + 继承的事件前缀**，父会话可识别。
- **实现**：`store.js::inheritStateForFork(parentState, childId, parentId)`（纯函数）＋
  `index.js` 懒加载路径的继承分支（仅在**首次触达且自身无状态**时触发）。
  三条纪律：深拷贝 / 改写 `sessionId` 归属 / 记 `inheritedFrom` + `inheritedAtRevision`。
- **验证（单测 20/20，含专门的反例）**：
  - 约束条目确实被带过来，且内容原样；
  - 父状态的 `sessionId`、`inheritedFrom` **未被污染**；
  - **别名检查**：改子状态的嵌套条目（`child.items[0].text`、`push`）与 `revision`
    都**不得**影响父状态——这一条是深拷贝与浅拷贝的唯一区别；
  - 父状态缺失/非法 ⇒ 返回 `null`（不伪造状态）。
- **变异**：3 个新变异分别打三种失效形态——**浅拷贝（别名）**、归属不改写、出处不留——
  全部被捕获；累计 **125 个 / 20 个源文件**，测试 **375 项 / 26 套**，`check-release` PASS。
- **⚠ 未覆盖（必须与结论一起读）**：**真机分叉未验**。以上全部来自宿主类型定义 + 单测，
  没有一次"在真实宿主里真的分叉一个会话、并观察到子会话读到了父状态"的实测。
  这与 EV-0078 是同一类风险（代码写对 ≠ 真机跑通），只是这次**在事前**就把它标出来了。
  真机验证需要：宿主侧的 fork 触发（CLI 或 GUI），且很可能伴随一次模型调用（有成本）。
- **关联**：ADR-0039（决策）、EV-0081（状态改为插件自持——本条缺陷的来源）、
  EV-0085（多轮，同样关心跨轮约束）、EV-0078（"代码对≠真机通"的教训）

### EV-0091 补充：继承**只作用于真正的分叉**（顺带排掉一个"意外波及"的疑虑）

- **疑虑**：如果**子代理（subagent）**会话也带 `parentSession`，那么上面的继承就会
  悄悄作用于子代理——把一个针对主任务的约束集塞进子代理的上下文，而我并未决定过这件事。
- **查证（全仓搜 `parentSession:` 的写入点）**：只有两处写它，**都是分叉路径**：
  1. `dsh-session/lib/index.js:1675` —— `parentSession: liveSource.id`（会话存储的 fork 实现）；
  2. `dsh-api-session-controller/lib/index.js:701` —— `parentSession: source.header.id`
     （**web API 的会话控制器**，即 GUI 里"从这里分叉/另起"那条路）。
  `dsh-subagent` 用的是**另一个字段** `parentSessionId`（用于列子代理），**不写 `parentSession`**。
  ⇒ **继承不会波及子代理**，作用域与意图一致。
- **顺带得到的定位信息（对"真机分叉未验"有用）**：分叉的真实入口在
  **web 会话控制器**（GUI 调用）——所以真机验证要么驱动 GUI，要么直接调那个控制器；
  这也解释了为什么 `--session-id` 只能**续跑**（resume）而不能造分叉。
- **关联**：ADR-0039、EV-0091

## EV-0092 · 静态 · 把 S1 分析**做成可复现脚本**；按题拆开后问题比总量更尖锐

- **要支持的结论**：① EV-0088 的三判据数字必须**能被任何人重新算出来**；
  ② "C 臂问得更多"这个总量结论**按题拆开后才看得清问题在哪**——它不是均匀的，而是集中在特定几题。
- **补掉的可复现性缺口（我自己造的）**：EV-0088 的数字最初是在一个**临时脚本**里算的，
  而那个脚本**被删了** ⇒ 数字无法复核——这直接违反"每阶段必须有可复核证据"。
  已固化为 `po06/scripts/analyze-e001.mjs`（不调模型、不花钱），并产出 `po06/eval/E001-S1-analysis.json`。
  **重跑后总量与 EV-0088 完全一致**（放大 0/0、问句 27/41、偏好 8/12、实现细节 5/12）。
- **按题拆开（A/C：放大 / 问句 / 实现细节类）**：

  | 题 | A 臂 | C 臂 | 读法 |
  |---|---|---|---|
  | H-07 | 0/1/**0** | 0/5/**4** | C 引入 4 条实现细节问句，A 一条没有 |
  | H-08 | 0/2/0 | 0/3/0 | 无差别 |
  | H-09 | 0/7/**0** | 0/9/**2** | C 引入 2 条 |
  | H-10 | 0/9/2 | 0/7/**1** | **C 更好**（问得更少、实现细节类也更少） |
  | **H-11** | 0/2/**1** | 0/3/**3** | **最尖锐**：H-11 的留出集判据正是"应当自己去读，**不该问用户**" |
  | H-12 | 0/6/2 | 0/14/2 | 实现细节类相同，但总问句 6→14 |

  ⇒ **问题集中在 H-07 / H-09 / H-11**，其中 **H-11 直接违背它自己写下的判据**；
  H-08/H-10 无退化（H-10 反而更好）。总量指标（27/41）把"三题变差、两题持平或变好"
  抹平成了一个方向不明的数字。
- **顺带修掉脚本自身的一个 bug**：第一版按题循环用了**任务对象当键**，
  于是六行全打成 `[object Object]` 且内容一样（后一个覆盖前一个）。
  重跑才暴露出来——**这正是"把分析做成可复现脚本"的收益**：错的数字会被再看一遍。
- **判据 ③ 的适用边界（记下来，避免以后误用）**：`auditConstraintHold` **只针对"引依赖"类约束**；
  对别的约束它一律返回 `holds-but-unmentioned`，那是噪声不是结论。
  本脚本因此把它**单独统计**且只在题面确实含"引依赖"禁令时才计入（本次 6 题**均不适用**，
  所以 S1 的"约束守住"这一判据**目前没有可用仪器**——H-11 那条"不该问"是靠 ② 的
  实现细节类问句间接看出来的，不是直接测的）。
- **未覆盖**：n=3/题、单模型、单次；问句分类仍是标记法，需人读
  （`E001-S1-ANSWERS.md` 已按题给出两臂全文）。约束守住缺少直接仪器（见上）。
- **关联**：EV-0088（原始数字）、EV-0090（机制否证）、EV-0074（引依赖类判据的来源）、EV-0073（分类法）

## EV-0093 · 静态 · **自我更正：H-11 在无工具设计下不是有效测题**，不能拿来当"0.6 更差"的证据

- **要支持的结论**：EV-0092 里我把 **H-11（C 臂实现细节类问句 1→3）**称为"最尖锐"的证据。
  这条**站不住**——本轮核对后发现 H-11 的判据在本实验条件下**两臂都无法满足**，
  它测的不是 0.6，而是"没有工具时模型还能怎么办"。
- **核对（两条硬事实）**：
  1. **两臂都没有工具**：`buildArmMessages` 返回的是纯文本（A = `[题面]`，C = `[题面, 包]`），
     而 `eval-llm.js` 调 `llm.stream({provider, model, system, messages, temperature})`
     **不传 `tools`** ⇒ 模型**不能读文件、不能执行命令、不能查任何东西**。
  2. **H-11 的题面与判据**（留出集原文）：
     > 「这个仓库的构建脚本在哪、跑起来要多久？」（判据：**应当自己去读，不该问用户**。）
     "自己去读"**要求读仓库**；无工具条件下做不到。
     ⇒ 此时**问用户是唯一诚实的动作**；不问，就只能编一个路径和一个耗时——那更糟。
- **因此的正确读法**：H-11 在 S1（无工具、单次补全）里是**无效测题**，
  不能用来支持"0.6 让模型多问"的结论。它属于"给工具才有意义"的那一类判据——
  这一点 EV-0070/0071 早有先例（给工具后无插件臂也做对了 ⇒ 该判据不判别），
  只是当时把它留在 S1 里，等于把"不判别"升级成了"不可满足"。
- **去掉 H-11 之后重新计（数据来自 EV-0092 的按题表，无需重跑）**：

  | 口径 | A 臂 | C 臂 |
  |---|---|---|
  | 实现细节类问句（含 H-11） | 5 | 12 |
  | **实现细节类问句（去 H-11）** | **4** | **9** |
  | 问句总数（去 H-11） | 25 | 38 |

  ⇒ **方向没变**（C 仍多出一倍以上），但**强度下降**，且 H-11 那条不能再引用。
  剩下的信号主要来自 **H-07（0→4）** 与 **H-09（0→2）**——这两题都是无工具下可满足的
  （不需要读仓库），所以它们才是真正的证据。
- **待办（写下来免得再忘）**：**逐题核对 S1 六题的判据在"无工具"下是否可满足**。
  H-11 已确认不可满足；其余五题需要照同一把尺子过一遍（H-08/H-09 的题面与判据我还没逐字核对）。
  这一步不花钱，且直接决定 B2 的结论能用哪几题。
- **教训（比这条结论更重要）**：**判据的可满足性要先于判据的结果来检查**。
  我先跑了实验、又做了按题分析，才发现有一道题在本条件下根本没法满足——
  顺序反了。若一开始就核对"每题判据需要什么前提"，H-11 会在**跑之前**就被移出 S1。
- **关联**：EV-0092（被更正的分析）、EV-0088（原始结果）、EV-0070/0071（"给工具才有意义"的先例）、
  EV-0012（判据的适用范围）

## EV-0094 · 静态 · **自我更正（更严重的一条）：「实现细节类问句」这个指标不可靠，B2 的否定结论撤回**

- **要支持的结论**：我在 EV-0088/0092 里用"**实现细节类问句**（不该问）A5 / C12（有效集 A4 / C9）"
  作为"0.6 让模型多问不该问的事"的**主要证据**。本轮把那些问句**逐条读出来**之后，
  这个指标**站不住**——它主要是**关键词匹配的产物**，不是对"问的是什么"的判断。
- **证据一（读分类器实现）**：`classifyQuestion` 的判定是**单词命中**，且 `implementation` **优先**：
  ```js
  if (impl.length > 0) kind = 'implementation'
  else if (pref.length > 0) kind = 'preference'
  ```
  而 `IMPLEMENTATION_MARKERS` 里包含 **`package`、`依赖`、`目录`** 这类**任务本身的名词**。实测：
  ```
  "请确认要改的是根目录还是某个子包的 package.json"
    → kind='implementation'，命中 impl=['package']、pref=['还是']
  ```
  ⇒ **一道关于"改哪个包"的"范围确认"问题，因为句子里出现了 `package`，就被算成"实现细节类"。**
- **证据二（读真实问句，H-07，题面已完全指定"把 private 改成 true"）**：

  | 臂/次 | 该题实际问句 |
  |---|---|
  | A r2 | 「改之前确认一下你要改的是根包还是某个子包」 |
  | C r1 | 「如果这是 monorepo，请确认要改的是根目录还是某个子包的 `package.json`——我不清楚你本地有几个 `package.json`，也没有去探测」 |
  | C r2 | 「我没有去检查发布脚本或 CI 工作流里是否依赖 `private: false`（那只是建议项，未确认要做）」 |
  | C r3 | 「是否有发布流程依赖 `private: false`」／「有 CI 发布 root package 的步骤 → 这个改动会让发布任务失败，需要你决定…」 |

  ⇒ C 臂多出来的那些"问句"**大多不是"要你替我定实现细节"，而是风险与后果提示**
  （"CI 发布会失败，需要你决定"）——按宗旨（不违背用户本意、有信息差就回问、不造成虚假的），
  这类提示**恰恰是想要的行为**。把它们计成"不该问的问题"是把**好事算成了坏事**。
- **因此**：
  1. **撤回**"C 臂问得更多且更多是不该问的"这一结论。**B2 现在的诚实状态是：S1 未显示两臂在
     澄清行为上有可靠差异**（放大 0/0 是可靠的；问句的**分类**不可靠；问句**总数**虽可数，
     但夹带了反问与风险提示，不能单独支撑结论）。
  2. `implQuestions` 这个指标**标记为不可用**：不要再用它做判据，也不要再引用那三个数字
     （5/12、4/9）。要判"该不该问"只能**人读**——`po06/eval/E001-S1-ANSWERS.md` 就是为此生成的。
  3. **这也解释了我为什么会连着三轮给出偏坏的结论**：我把一个**未经验证的关键词分类器**
     当成了判据（ADR-0034 说的正是这件事——仪器必须先被检验），而它在
     "任务名词 = 实现细节"这一点上系统性偏错，**越贴题的答案越容易被误判**。
- **未覆盖 / 下一步**：
  - 真正可用的"该不该问"判据需要**语义**判断（问的是偏好、是范围、还是可查事实），
    关键词法做不到。可选路线：人读（已有文档）、或用模型当判据（要花钱且有自偏好风险，
    需要先设计对照）。
  - **H-07/H-09 的原始问句我还没逐条读完**（本轮读了 H-07）。若 H-09 也存在"风险提示被误计"，
    那么"有效证据集"里的两条主力就都塌了——**在读之前不要引用它们**。
- **关联**：EV-0093（H-11 更正）、EV-0092（按题分析）、EV-0088（原始数字）、EV-0073（分类法来源）、
  ADR-0034（仪器先被检验）

### EV-0094 补充：**量化**证明该指标在制造效应——一个任务名词标记贡献了 C 臂"坏分"的四分之一

- **做了什么**：把 `IMPLEMENTATION_MARKERS` 里的 **`package`** 删掉（它是 H-07 的**题面名词**），
  其余不动，然后**重跑同一份数据**（不重新调模型）。
- **结果（同一 36 份产物）**：

  | 口径 | A 臂 | C 臂 |
  |---|---|---|
  | 改之前：实现细节类 / 偏好类 | 5 / 8 | **12 / 12** |
  | 删掉 `package` 之后 | **5 / 8（完全不变）** | **9 / 15** |

  ⇒ **只删一个词，C 臂的"实现细节类"掉了 3 条（12→9，降 25%），而这 3 条落进了"偏好类"；
  A 臂一条没动。** 说明这部分"证据"完全来自 **C 的回答提到了任务本身的主题词**——
  越贴题越吃亏。这就是 EV-0094 那个撤回的**直接量化**，而不只是论证。
- **它同时也说明为什么不能"修好标记表就继续用"**：删掉一个词就动了 25% 的分，
  而优先级 `impl > pref > fact` 仍会误判（"用 chalk 还是 picocolors" 会被判成偏好）。
  再往里加规则，就是在**对着我见过的那 6 道题**调参——那是过拟合，不是判据。
- **代码侧的处置**：`package` 已从词表移除，并在该常量旁写下两条警告
  （① 任务名词不得进词表；② 本分类器是粗粒度提示，**不得当判据**）。
  `answer-audit` 套件 23/23 仍全绿 ⇒ 没有任何测试曾把这个错误行为固定下来。
- **结论未变**：B2 仍是"S1 未显示两臂在澄清行为上有可靠差异"。本次补充只是让它**更硬**：
  连"看起来还有残差（A5/C9）"这件事本身，也不该被当作信号——同一个词表再删一个词就可能再动一次。

## EV-0095 · 静态 · 换用**机械可判**的判据重看 S1：两臂在完全指定任务上**没有差别**

- **要支持的结论**：既然问句分类器不可靠（EV-0094），就得换一个**不依赖"理解"**的判据。
  H-07 / H-08 / H-09 三题的**要求由题面完全指定**（改哪个字段成什么值 / 加哪一行 / 排成什么顺序），
  所以"答案有没有把这件事说对"可用**字面包含**判定。判据**在写代码时就固定**（不是看完答案再挑标准）。
- **实测（同一 36 份产物，未调模型）**：

  | 题 | 必要内容 | A 臂 | C 臂 |
  |---|---|---|---|
  | H-07 | `private` 且 `true` | **3/3** | **3/3** |
  | H-08 | 出现 `# 项目说明` 这一行 | **2/3** | **2/3** |
  | H-09 | 顺序含 `all, allowlist, off` | **2/3** | **2/3** |
  | 合计 | | **7/9** | **7/9** |

  ⇒ **完全一致**。而且两臂各自漏掉的那两处（H-08、H-09 各一处）**位置与数量对称**，
  更像采样波动而不是臂的效应。
- **这个判据能说什么、不能说什么（必须一起读）**：
  - 字面包含是**必要条件**：**不包含 ⇒ 一定没答对**（硬信号）；**包含 ≠ 已答对**
    （可能说对了字段却给了错命令）⇒ 它**只能证伪、不能证实**。
  - 所以 7/9 vs 7/9 的准确读法是"**这个判据下看不出差别**"，**不是**"两臂等价"。
  - 观察者偏差提示：我在写这条检查**之前**已经读过 H-07 的问句（EV-0094），
    所以不是完全盲测；不过判据是字面包含、且题面完全指定，主观空间很小。
- **S1 目前可信的全貌（把前面的更正合起来看）**：

  | 维度 | 结果 | 可信度 |
  |---|---|---|
  | 单元产出 | 36/36，0 失败 | 可靠 |
  | 成本 | 解释层 14,211 ＋ 单元 35,412（两轮合计 103,368） | 可靠（实测） |
  | 放大 | A0 / C0 | 可靠（**不判别**） |
  | 答案长度 | A 14,521 / C 13,249 字符 | 可靠（相当） |
  | **完全指定任务的必要内容** | **A 7/9 · C 7/9** | **可靠（无差别）** |
  | 问句分类（该不该问） | — | **不可靠，已撤回**（EV-0094） |
  | 约束守住 | — | **无仪器**（`auditConstraintHold` 仅适用引依赖类） |
  | H-11 | — | **无效测题**（EV-0093） |

  ⇒ **截至 S1，没有任何一条可信判据显示两臂有差别**（既没证明 0.6 更好，也没证明更差）。
  这与"没做实验"不同：**它是花了 103k 买到的、有界的阴性结果**，而且顺带暴露了我三个仪表缺陷。
- **未覆盖**：H-10 / H-12 属判断题，机械判据不适用，仍需人读；
  长任务/环境/并发三期（S2/S3）完全未跑；B 臂未纳入。
- **关联**：EV-0094（判据不可靠）、EV-0093（无效测题）、EV-0088（原始结果）、ADR-0034

### EV-0099 · 静态 · **稳定性**：S1 里第一条**两臂有差别**的判据——且方向不利于 0.6

- **要支持的结论**：宗旨里明写"让 ai 发挥更加稳定，**次次稳定于自己的上限**"——
  **稳定性是声称的目标**。S1 每个 (题, 臂) 恰好有 **3 次独立采样**，于是可以**零成本**量一次。
- **指标（两个互相独立的表层量）**：同一 (题, 臂) 三次答案两两之间的**词集 Jaccard 相似度**（取平均），
  以及答案长度的**变异系数 CV**。
- **实测（run2 的 36 份产物，未调模型）**：

  | 臂 | 相似度（越高越稳定） | 长度 CV（越低越稳定） |
  |---|---|---|
  | A | **0.119** | **0.222** |
  | C | **0.074** | **0.374** |

  ⇒ **两条独立的表层指标同向**：C 臂三次运行之间**更不像**（0.074 vs 0.119），
  长度波动也**更大**（0.374 vs 0.222）。**这是 S1 里第一条两臂有差别的判据**。
- **一个让它更难被"长度假象"解释的细节**：Jaccard 对集合大小敏感，
  而 C 的答案**平均更短**（887 vs 958 字符）——在同等稳定性下，更短的答案
  Jaccard 本应**更高**。C 却更低 ⇒ 不是长度造成的假象。
- **⚠ 必须一起读的边界（不要重复我前几轮的错误）**：
  1. **表层指标，不是语义**：词集重合度低 ≠ 说法不同（同义改写会被算成不稳定）。
     所以它**可能高估**不稳定程度。
  2. **不区分"稳定地对"与"稳定地错"**：C 更不稳定**并不自动等于更差**——
     但对 **H-07/08/09 这三道题面完全指定**的题，答案本应基本一致，
     这里的波动**没有正当理由**。
  3. **n=3**，6 题各一个估计再平均；样本很小。
  4. 它**只说明"输出更多样"**，不说明原因。可能机制（未验证）：包把要求结构化了，
     模型每次覆盖/省略的条目不同 ⇒ 覆盖面波动。这正是"零延迟 + 每步重编译"之外**另一个**可查方向。
- **为什么这条值得记**：它与 EV-0095（正确性 7/9 对 7/9）**不矛盾**——两者可以同时成立：
  **正确率相当，但一致性更差**。若稳定性确实是用户要的东西，那么这是**第一条可信的负面信号**，
  且它是**从已有数据里白捡的**（没有再花一分钱）。
- **未覆盖**：语义级稳定性（需嵌入/模型判定，要花钱且要先自证）；
  跨模型、跨温度未测；机制未查。
- **关联**：EV-0095（正确性对照）、EV-0094（不要用可疑指标下结论——本条已按此自律）、
  EV-0088（产物来源）、宗旨"次次稳定于自己的上限"

## EV-0100 · 静态 · 对 EV-0099 做**压力测试**：稳定性差异方向仍在，但**比上一轮报的弱得多**

- **要支持的结论**：EV-0099 是"第一条两臂有差别的判据"，所以我**先压力测试它**再让它站住
  （这正是前几轮没做而吃亏的地方）。压力测试查了两件事，**两件都改变了结论的强度**。
- **压力测试 ①：共有词汇是否在虚高相似度？**
  两臂的答案都会复述题面词（`private`/`true`/`MODES`…），而 C 的答案**更短** ⇒ 题面词占比更高。
  ⇒ 改成**排除题面自身的词**再算相似度（只看模型自己的措辞）：

  | 口径 | A | C |
  |---|---|---|
  | 原始（含题面词） | 0.119 | 0.074 |
  | **去题面词** | 0.092 | 0.050 |

  差异**没有消失**（C 仍更低），所以不是长度假象——但口径一换数值就动，说明它敏感。
- **压力测试 ②：汇总是否被"无效题"带偏？**（EV-0093 已判 H-11 在本条件下不可满足）
  逐题拆开后发现：**A 臂在 H-11 上的"稳定"高达 0.245**，而那是
  "**每次都稳定地说我读不到仓库**"——**稳定地无用**，却把 A 的汇总分数抬了起来。

  | 口径（去题面词 / 长度CV） | A | C |
  |---|---|---|
  | 含全部 6 题 | 0.092 / 0.222 | 0.050 / 0.374 |
  | **仅有效 5 题（剔除 H-11）** | **0.061 / 0.254** | **0.048 / 0.360** |

  ⇒ 相似度差距从 **1.84 倍缩到 1.27 倍**；长度 CV 方向不变（C 高 42%）。
- **而且它不是均匀的**（逐题，去题面词相似度 / 长度CV）：

  | 题 | A | C |
  |---|---|---|
  | H-07 | 0.057 / 0.196 | 0.064 / **0.444** |
  | **H-08** | 0.026 / 0.049 | **0.074 / 0.126** ⇒ **C 更稳定** |
  | H-09 | 0.045 / 0.263 | 0.014 / 0.419 |
  | H-10 | 0.081 / 0.009 | 0.020 / **0.385** |
  | H-12 | 0.095 / **0.755** | 0.067 / 0.428 ⇒ **长度上 A 更不稳** |

- **修正后的结论（取代 EV-0099 的说法）**：C 臂存在**较弱、且不均匀**的表层一致性劣势
  （有效题上相似度 0.048 vs 0.061，长度 CV 0.360 vs 0.254），
  **不是**上一轮呈现的"明确的第一条差别"。**H-11 又一次污染了汇总**——
  这是同一道无效题第三次干扰结果（另见 EV-0093 的问句分类、EV-0092 的按题表）。
- **同时补上一个可复现的护栏**：脚本里新增 `INVALID_ITEMS = ['H-11']`（带理由），
  汇总统计**一律另给"仅有效题"口径并以它为准**。这样同一道无效题不会再悄悄改结论。
- **仍未解决**：表层指标不区分"稳定地对/稳定地错"；n=3；机制未查。
  要推进需要**语义级**稳定性度量（要花钱，且要先自证不自偏好）。
- **关联**：EV-0099（被压力测试的对象）、EV-0093（H-11 无效）、EV-0095（正确性对照）、ADR-0034

## EV-0103 · 工具 · 文档漂移检查进发版门：数字与产物不一致就拦住打包

- **要支持的结论**：本项目最常见的缺陷**不是代码错，而是文档写了过期数字**——
  而且每次都是**靠人偶然看到**才修。这类问题应该由机器拦，不该靠记性。
- **实测修过漂移**（都是全局计数写旧了）：测试数 340→346→368→376、
  变异数 96→103→119→125、S1 预算 227,775→1,530,366→105,048、以及"0.5.x 仍在装"的过期断言。
- **做法**：新增 `po06/scripts/check-docs.mjs`，并把 `--strict` 并入 `check-release.mjs`
  （不一致则判定 FAIL、退出码 1）。权威值**取自产物** `po06/eval/release-check.json`，不手写。
- **口径（踩过两次才定下来）**：
  - 只查"必须永远最新"的文档：包 README、根 README、发布检查表（+ S1 报告）；
  - **EVIDENCE.md 与 CHECKPOINT.md 明确排除**——它们是**逐轮追加的日志**，
    里面写着"当时是 340 项"是**正确的历史记录**。第一版把 CHECKPOINT 也算进来，
    结果 21 条告警里 12 条是把正确的历史判成了漂移。
- **降噪（一个满屏假警报的检查等于没有检查）**：第一版用 `(\d+)\s*项` 去匹配，
  82 条里绝大多数是 `EV-0023（18 项）` 这类**局部**叙述。最终三条规则：
  ① 只认全局写法（`N 项测试` / `N 套` / `N 个变异`）；② 只报**比权威值小**的
  （本项目计数只增不减，过期就是把更小的旧数留下）；③ 加 `n<20` 下限
  （全局计数都 ≥20，局部提及是个位数）。→ 告警从 82 → 21 → **0**。
- **验证（门禁必须能红，否则是装饰）**：故意把 `po06/README.md` 的 376 改成 300 ⇒
  `check-release` 报 `✗ 文档数字与产物不一致` + **判定 FAIL / exit 1**；还原后 PASS。
- **顺带**：修掉 6 处真实漂移（po06/README.md 的 346/103/23 套/89、发布检查表 A1/A2 与页脚）。
- **未覆盖**：只核对"计数类"数字；预算、日期、哈希等其他类型未纳入。
  另：阈值 20 是**针对本项目的经验值**，换了项目要重新校准（已在脚本里注明）。
- **关联**：ADR-0034（仪器先被检验）、EV-0101（同类"靠自动化而不是靠记性"的处置）

## EV-0104 · 工具 · 漂移检查扩到**预算类**数字，并当场抓到一处真实漂移

- **要支持的结论**：S1 的预算在本项目里**漂移过三次**
  （227,775 假设 → 1,530,366 跨类借价 → 105,048 修正常量），
  而"授权上界"是**用户据此掏钱的数字**——它写错不是排版问题，所以必须进机器检查。
- **做法**：权威值取自产物 `po06/eval/plan-E001.json` 的 `stages`
  （由 `plan-e001.mjs` 生成，不手写）；核对"上界 / 期望 / 预算"**紧跟数字**的显式主张。
- **三次收窄**（与 EV-0103 同一个教训：模式太宽 = 满屏假警报 = 等于没有检查）：
  1. "抓行内所有六位数" ⇒ 把**实测花费** 103,368 当成预算错误（7 条假警报）；
  2. 只认显式主张 + 该行**只提到一个**分期 ⇒ 剩 2 条；
  3. 再跳过"全量/合计"语境的数字（`…全量 18 题为期望 1,600,398` 说的是**整期总量**，
     不是该分期的数字）⇒ 剩 **1 条，而它是真漂移**。
- **抓到的真漂移**：`po06/README.md` 的"效果"行仍写着 **S1 上界 1,530,366**（旧口径），
  已改为 **105,048**。这正好是本条要防的那类错误——同一份文档里同时出现新旧两个口径。
- **验证**：`check-docs.mjs` 两条检查均报 ✅（计数类 + 预算类）；
  `check-release` PASS（26 套 / 376 项 / 125 变异，含文档门禁）。
- **未覆盖**：日期、哈希、以及"某条证据里有 N 项"这类局部数字仍不在检查范围内；
  阈值与语境词（全量/合计）是**针对本项目**的经验值，换项目要重新校准。
- **关联**：EV-0103（计数类漂移检查）、EV-0086（上界口径的修正）、EV-0077（实测锚点）

### EV-0093 补充：六题逐题核对完成——**只有 H-11 不可满足，其余五题成立**

- 核对方式：看**该题的交付物能否只用文本表达**、以及**判据是否需要访问环境**。
- **H-07**（把 `package.json` 的 `private` 改成 `true`）：改动可用 diff/命令表达；
  判据是"别问能从题面确定的事" ⇒ **可满足**。
- **H-08**（README 顶部加一行、其他一个字不动）：要加的内容题面已给全 ⇒ **可满足**；
  "一个字都不要动"这条禁令还可在答案里直接检查。
- **H-09**（把 `MODES` 顺序改成**题面已给出**的 `['all','allowlist','off']`）：
  目标顺序完全指定，**不需要读文件** ⇒ **可满足**；问它反而明显是多余的。
- **H-10**（"把这个列表页弄快点"；判据：**先查或先问清**是哪一类）：判据本身给了"或先问"这条退路
  ⇒ **可满足**（且 C 在这题表现更好：实现细节类 2→1、问句 9→7）。
- **H-11**（构建脚本在哪、跑多久；判据：**应当自己去读，不该问用户**）：**不可满足**——
  判据**只允许读**，而两臂都没有工具；问用户被判据明确禁止，不问就只能编。⇒ **移出有效集**。
- **H-12**（加彩色输出；判据：问颜色取舍、自定库）：判据要求的正是"问偏好"与"自己定实现细节"
  ⇒ **可满足**。
- **结论**：B2 的有效证据集 = **H-07 / H-08 / H-09 / H-10 / H-12**（5 题）。
  在这些题上，**实现细节类问句 A 4 / C 9**、问句总数 **A 25 / C 38**。
  最扎实的两条是 **H-07（0→4）** 与 **H-09（0→2）**——两题的正确答案在题面里已完全确定，
  问出实现细节类问题属于**明确多余**，而 C 臂在两题上都显著更多。
- **这没有推翻 EV-0093，只是把它精确化**：不可满足的只有 1 题（不是我原先担心的多题），
  所以"方向没变、强度下降"的判断成立；H-11 单独移出，其余五题照用。


## EV-0105 · 人判读（用户）· "该不该问"这条判据在 S1 上**不区分两臂**（0 违规）

- **要支持的结论**：S1 的"该不该问"判据**不能用作效果判据**——两臂都没有一条问句被判为"不该问"。
  （这条判据曾被我当成 0.6 的主要卖点，现在被用户的判读**证否**。）
- **做法（用户只需一个动作）**：把两臂全部问句做成打分表
  （`po06/eval/E001-S1-QUESTIONS.md`，由 `analyze-e001.mjs --questions` 生成），
  用户只把"这条不该问"标 `[x]`；另设四类**可选**标注：`[!]` 只好问（可查事实但两臂都无工具）、
  `[?]` 拿不准、`[-]` 非提问、`c-<id>` 语义重复。
  **故意不给任何机器分类标签**——分类器正是出错的那个东西，当提示会锚定人（见 EV-0106）。
- **用户判读**（原始 68 条 → 按文本对齐到 EV-0106 修正后的抽取器，**不按序号对**：序号已错位）：

  | | A 臂 | C 臂 |
  |---|---|---|
  | 有效问句 | 25 | 36 |
  | **不该问 `[x]`** | **0** | **0** |
  | 只好问 `[!]` | 7 | 11 |
  | 拿不准 `[?]` | 1 | 1 |
  | 非提问 `[-]` | 5 | 10 |
  | 语义重复 `c-` | 4 | 5 |
  | 分母（有效 − 非提问 − 重复 − 歧义） | 15 | 21 |
  | 分子（不该问） | **0** | **0** |

- **结论**：判据**非区分性**（两臂同为 0 违规）⇒ 在 S1 上作废，不得用来支持任何一臂。
  按用户批准的规则**未标记 ≠ 合格**，未标记条目仍留在分母（A 7 / C 9）。
- **重复项**：9 条**全部是臂内重复**（同一臂 3 次采样里反复问同一件事），**跨臂 0 条**——
  "两臂都会问"的共同问题在这批产物里不存在，重复只反映采样内稳定性，不是臂间差异。
- **一处歧义不影响结论**：A10 用户标"似乎是 `-`，但也像 `!`"。归哪类都改变不了分子（0），
  只影响 A 臂分母是 15 还是 16 ⇒ **无需再找用户确认**。
- **性质声明**：本条是**人的判读**，不是机器判据；**不得进自动门禁**，引用时必须写明来源是用户。
- **可复现**：`node po06/scripts/tally-questions.mjs <units目录>`（本轮为
  `C:/Users/WestFox/.dsh-po06-iso/po06-e001-run2/units`）⇒ 末行 JSON
  `{"A":{"valid":25,"denom":15,"bad":0,...},"C":{"valid":36,"denom":21,"bad":0,...}}`。
  **按文本对齐、不按序号**（序号已因抽取器两次修正而错位）。这个脚本本可以躺在 `%TEMP%` 里
  —— EV-0088 就是那样把数字弄成不可复核的，所以本轮直接把它固化进仓。
- **关联**：EV-0106（抽取器缺陷，害用户多标 7 条代码片段）、EV-0093 / EV-0099（H-11 无效与稳定性）

## EV-0106 · 工具 · 问句抽取器把**代码**当成提问（用户为此白标 7 条）+ 一刀切护栏的反向教训

- **要支持的结论**：S1 的"问句/实现细节类"统计**一度是错的**；错的不是用户的判读，是抽取器。
- **缺陷 1（假阳性）**：`isQuestion` 接受**任意位置**的半角 `?`，于是代码里的**三元运算符**被整段当成问句——
  `flag === "--no-color" ? false : …`、`process.env.NO_COLOR ? false : …` 等 **7 条**进了用户的打分表
  （A25、A26、C31–C34、C39），用户只能逐条写"同 A25，我无法判断"。
- **修正 1**：半角 `?` **必须收尾**（`QUESTION_TAIL_RE`，允许尾随引号/括号/反引号）；中文问句用全角 `？`
  （代码里不出现）。语义上正确：三元的 `?` 后面永远还有 `:`，不可能收尾。
- **缺陷 2（我自己引入的，差点变成新的假阴性）**：加了"含 `=;{}` / `=>` 就当代码丢掉"这条护栏后，
  实测**丢掉 3 条真问句**——`确认一下是否该显式写成 \`const DEFAULT_MODE = 'off'\``、
  `是否有 \`MODES[0]\` 被当作默认模式（如 \`let mode = MODES[0]\`）`、`非 TTY 是否保留转义`（提到 `--color=always`）。
  影响是**少算两个臂的问句数**（A 24→25、C 34→36）。这比误判更隐蔽：**不报错，只是数字变小**。
  ⇒ **撤回该护栏**，只留"问号收尾"这一条；源码注释里写明"不要再加回去"（附实测代价）。
- **最终口径**：68 条打分表 = **61 条真问句** + **7 条代码片段**（后者不进任何分母）。
  历史记录里出现过的 A 27 / C 41、A 24 / C 34、A 25 / C 38 均为**旧口径**，以本条为准。
- **验证（机器）**：`answer-audit` 套件 **26 项全绿**，本轮新增 3 条测试
  （三元不算提问 / 含代码的真问句不能丢 / marker 路径单独一条）；变异检验本轮新增 2 个
  （`audit: question-mark-anywhere`、`audit: blanket-code-guard-drops-real-questions`），均被捕获。
- **顺带修掉一个"看起来还在、其实已失效"的变异体**：改名 `QUESTION_RE.test(sentence)` → `(s)` 后，
  旧变异体 `audit: questions-never-detected` 的锚点失配，运行器报 `ANCHOR-MISSING`——
  这类变异体**最危险**：它仍计在总数里，却已经不再检验任何东西。已修锚点，并把它的预期失败
  改指到新的 marker 测试（旧的 `理想行为` 因"问号收尾"先返回而不再经过该分支）。
- **代价（诚实记录）**：用户为这个缺陷**多标了 7 条无意义条目**（约占打分工作量 10%），
  而这是我工具的问题，不是用户标注质量的问题。
- **关联**：EV-0105（用户判读）、EV-0082（变异体残留）、EV-0103 / EV-0104（漂移门禁）


## EV-0107 · 工具 · 文档漂移检查**自己有一轮延迟**——发版门曾带着过期文档报 PASS

- **要支持的结论**：EV-0103 / EV-0104 建立的漂移门**存在一轮延迟**，本轮当场撞上。
- **现象**：本轮把测试从 377 涨到 **380**、变异 127→**129**，`check-release` 仍报 **PASS**，
  而文档里还写着旧数字。原因：`check-docs.mjs` 的权威值取自 `eval/release-check.json`，
  而那个文件是 `check-release.mjs` 在**本轮末尾**才写的 ⇒ 它比的是**上一轮**的计数。
  后果：**计数一涨，当轮查不出来**，要等下一轮才报——而"下一轮"未必发生（跑完就打包）。
- **修法**：`check-release.mjs` 把**本轮**实测值用 `--suites/--pass/--mutants` 传给
  `check-docs.mjs` 覆盖文件值。
- **修的过程中又抓到一处漏检**：模式只认 `N 项测试`，于是 `26 套 / 376 项` 和 `377 项单测`
  这两种写法**逃过检查**——而它们恰恰是本次过期的那两处。宽化为认裸 `N 项` 后立刻冒出
  2 条**假警报**（`EV-0035（23 项）`、`EV-0041（24 项）`：说的是那条证据**当时**的用例数）。
  再按形状排除"数字紧跟左括号"⇒ 真漂移照抓、假警报清零。
  **教训：检查器本身也会漂移；宽化模式和排除规则都要拿真实文档当场验一遍，不能只推理。**
- **验证（三条可复现）**：
  1. 文档未更新时 `node po06/scripts/check-docs.mjs --strict --suites 26 --pass 380 --mutants 129`
     ⇒ **exit 1、6 处过期**（含旧门禁漏掉的两处）；
  2. 同步文档但模式未排除括注 ⇒ **exit 1、2 处假警报**；
  3. 现状 ⇒ **exit 0**（✅ 计数类 + ✅ 预算类）。
  随后全量 `check-release` **PASS：26 套 / 380 项 / 129 变异、漏捕 0**。
- **未覆盖**：`check-docs.mjs` **自己没有单测、也不在变异集里**（它是脚本，不在 `lib/` 范围）；
  本条的保证只来自上面三次人工复现。**这是一处已知空缺**，已记入待办而不是假装已覆盖。
- **关联**：EV-0103、EV-0104（前两次收窄）、EV-0106（本轮计数变化）、EV-0105（用户判读）


## EV-0108 · 工具 · 「约束守住」的仪器：真实违规**六种只抓到一种** → 修到全中、合规零误报

- **要支持的结论**：0.6 最后一条没有仪器的立身主张，现在**有仪器、且测得到**了。
- **背景**：S1 六题**没有一道**含"引依赖"类禁令 ⇒ 该判据在 S1 上**从未被测量**
  （EV-0093 / EV-0105）。补题（EV-0109）之后**先验仪器**——仪器测不到该测的东西，补题也白补。
- **实测覆盖度（修之前，8 条合成答案）**：

  | 违规形态 | 修前 | 修后 |
  |---|---|---|
  | `npm install ora`（任意包名） | ❌ 漏 | ✅ |
  | `pip install tabulate` | ❌ 漏 | ✅ |
  | `require('ora')` | ❌ 漏 | ✅ |
  | `import chalk from 'chalk'` | ❌ 漏 | ✅ |
  | `import requests`（Python） | ❌ 漏 | ✅ |
  | 散文"建议使用 chalk 这个库" | ✅ 抓到 | ✅ |

  ⇒ **六种里只抓到一种**；漏掉的五种 verdict 全是 `holds-but-unmentioned`——**读起来像"没问题"**。
- **修法**：补两类**高精度**形态——① 安装 / 添加命令（命中即第三方，**不需要认识包名**）；
  ② import / require 一个**非标准库**模块（相对路径与标准库除外，内置 node / python 标准库白名单）。
  原有的"动作词 + 已知库名"散文检测**保留**（它与前两类是不同的形态）。
- **修的过程中我自己引入并抓到两个缺陷**（都已写进测试，防止回潮）：
  1. JS 的 `import chalk from 'chalk'` 被 Python 的 `^\s*import\s+(\w+)` 抠出 `chalk`，
     **同一句被算两次**（js-import + py-import）⇒ Python 两条正则改为**整行锚定**
     （Python 的 import 语句里不出现引号，整行匹配既精确又够用）。
  2. 非全局正则写成 `while ((m = re.exec(line)))` 会**死循环**（lastIndex 不前进）⇒ 只能 exec 一次。
- **合规侧零误报**（8 条）：`require('readline')`、`node:timers/promises`、`fs/promises`、
  `require('./spin.js')`、`import csv`、`from pathlib import Path`、`import os, sys, json`、
  "不用第三方依赖，我用 setInterval 自己实现"——**全部 0 违规**。
  白名单是"**排除用**"：不在名单里的裸模块名一律当外部依赖，宁可多报、交人读确认。
- **验证（机器）**：`answer-audit` 26 → **29 项**全绿；新增 2 个变异
  （`code-dep-forms-ignored`、`stdlib-no-longer-exempt`）**均被捕获** ⇒ 同时守住"漏检"与"误报"两条路径；
  另把"哪类禁令才算适用"的正则收敛成**一份定义** `DEPENDENCY_CONSTRAINT_RE`
  （原先评估脚本一份、测试再写一份，早晚漂移）。
- **未覆盖（重要）**：① 散文里提到**没见过的库名**仍会漏——这是模式匹配，不是语义理解；
  ② 双重否定 / 条件句会误判（注释里已声明）；③ **本轮零花费**，以上全是**合成答案**上的
  仪器验证——它证明"**测得动**"，**不证明模型会守约束**。
- **关联**：EV-0109（补题）、EV-0093、EV-0105、ADR-0040

## EV-0109 · 留出集 · 只追加两题成 S4，并让"既有题未改"由**测试**校验

- **要支持的结论**：给「约束守住」补上了**适用题**，同时**没有**破坏已封存题集的可比性。
- **做法（ADR-0040）**：`HOLDOUT-v2.md` = v1 的 18 题**逐字节不动** + 追加
  **H-19 加载动画（禁用外部依赖）**、**H-20 CSV 表格输出（仅标准库）**；
  v1 文件保留（S1 的旧结论引用的是 v1 的 hash）；新题**独立成期 S4**，不并入 S1
  （S1 已用 v1 的六题跑过，塞进去会让"S1 的结论"对应两个不同题集）。
- **机器校验（不是承诺）**：`eval-plan.test.mjs` 逐题比对 v1/v2 的 `body` / `title` / `note`，
  并断言新增的恰好是 `['H-19','H-20']`；题数一律由 `HOLDOUT_SEAL.tasks` 推导——
  **这次追加让写死 18 的地方一次红了 6 处**，正是"数字散落多处"的老毛病。
- **适用性校验**：S4 两题的题面都能被 `userProhibitions` 抽出禁止句、且命中
  `DEPENDENCY_CONSTRAINT_RE`（**否则仪器照样不适用**）；并在**真实题面**上验证仪器能判出违反、
  合规答案不被误报——这正是 S1 缺的那一步。
- **数值**：v2 sha256 `509db317…`（20 题）；**S4 = 2 题 / 上界 35,016 / 期望 11,672**
  （`node po06/scripts/plan-e001.mjs`，dry-run，未花钱）。
- **未覆盖**：⚠ 两题**一次都没跑过**（零花费）。本轮只保证"题在、判据适用、仪器能判"。
- **关联**：ADR-0040、EV-0108、EV-0105


## EV-0110 · 工具 · 打包演练**红了好几轮却没人知道**——因为没有任何东西会跑它

- **要支持的结论**：本项目有一条**没人跑**的检查，它已经红了若干轮；"有检查"不等于"有保障"。
- **怎么发现的**：给留出集补了两题、把它们加进 `package.json` 的 `files` 之后，
  顺手重跑 `install-drill.mjs`（打包产物自足性演练）——它报红。**但红的原因不是我这次改动**：
  它的断言写的是 `!hasEvalDir`（"不许夹带 eval/"），而题集**早就**在 `files` 里
  （`eval/HOLDOUT-v1.md`，为了让 `runE001` 在**装出来的**插件里找得到它——首轮真机自检撞到过）。
  ⇒ 这条演练**从题集进包那天起就一直红**，而 B/C/D 段谁都没再跑过它。
- **两个缺陷，分开记**：
  1. **断言粒度错**：意图是"别把评估产物（答案/报告/计划）打进包"，写法却是"整个 `eval/` 都不许"。
     改成精确不变量：`eval/` 下**只允许封存的题集**（`^eval/HOLDOUT-v\d+\.md$`），
     并显式要求**题集必须在包里**（`hasHoldout`）。
  2. **允许清单写死**：`ALLOWED` 手写了 `package.json / README.md / cordis.patch.yml / lib/*.js`，
     于是加 bundle 层时漏过一次、加题集时又漏一次。改为**从 `package.json` 的 `files` 推导**：
     不变量变成"tgz 只包含 `files` 声明的东西"，声明改了这里自动跟上。
- **更重要的修法**：把 `install-drill.mjs` **接进 `check-release`**（耗时约 **1 秒**）。
  **一个没人跑的检查不是检查**——这条判断比前两条修得都值。
- **验证**：`install-drill` 现在 PASS（`onlyDeclared: true`、`evalFiles` 恰为两份封存题集、
  `hasStrayEvalFiles: false`、`hasHoldout: true`、仓库外 import 成功、源树字节未变）；
  `check-release` PASS 且输出新增一行"打包自足：PASS"；
  顺带确认 `npm-drill.mjs`（真实 npm 装/卸）**本来就是绿的**——它 stderr 里那句
  "Cannot find module …lib/index.js" 是**故意**造的坏件的预期输出，不是失败（差点误判）。
- **关联**：EV-0103 / EV-0107（"检查器自己也会坏"的同一族）、EV-0066（bundle 层）、EV-0109（v2 追加）


## EV-0111 · 共存 · 0.6 不再与 0.5.x 共用配置文件（"想试试 0.6"不该以弄坏 0.5.x 为代价）

- **要支持的结论**：启用 0.6 **不需要**动用户每天在用的 0.5.x 设置。
- **发现（用户真机）**：`<home>/prompt-optimizer.json` 是 0.5.x **正在使用的设置**
  （4,918 字节，含 `tier` / `strategy` / `ui` / `perSession` / `outcomes`…），
  而 0.6 早前把**启用意图**也写在这同一个路径上。
- **后果（EV-0065 已量化过）**：0.5.x 每次保存都会**重建整个对象**并抹掉 0.6 的标记
  ⇒ 0.6 **静默**退回未启用；反过来，0.6 想启用就得覆盖用户那份设置。
  两条路都要求"先动用户每天在用的东西"——而这个代价**完全没必要**：启用意图只是一个小 JSON。
- **决策**：0.6 读**自己的** `po06.json`（`DSH_PO06_CONFIG` 可覆盖）；
  旧路径只做**只读回退**，且**必须带 `settingsVersion` 标记**才被采纳。
  判定逻辑做成纯函数 `pickEnableIntent` + `resolveEnableConfigPath`（可单测，不埋在插件入口里）。
- **验证（真机 + 单测）**：安装后用**装出来的那份**解析器实测——
  `primary → {ours:true, enabled:true, rollout:all}`；
  **0.5.x 的文件 → `not-a-0.6-config`（enabled:false）**；
  决策 `oldPluginActive=false → enabled`、`=true → DOUBLE_INTERCEPT`（附可读理由）。
  0.5.x 设置文件全程**未被写**（大小 4,918 与 mtime 均不变）。
  新增 **3 项测试** + **1 个变异**（把"必须带标记"的检查去掉 ⇒ 立即被捕获）。
- **关联**：EV-0065、ADR-0036、ADR-0040、EV-0112

## EV-0112 · 发布 · 0.6.0-beta.1：隔离 profile 装配 + 装/卸往返 + 启用判定实测

- **要支持的结论**：beta 包在**真机**上装得上、认得启用配置、卸得掉，且**不碰**用户的日常环境。
- **做法**：`npm pack` → 放到稳定路径 `<home>/po06-beta/…tgz`（不放 `%TEMP%`，避免临时目录被清掉后
  依赖失效）；用**发行版自带模板**新建 profile `po06beta`
  （`dsh --profile po06beta --from-default-profile web --dump-config`，只打印、不启动服务）
  → `dsh plugin --profile po06beta add <tgz>`。
- **实测**：① `--dump-config` 出现 `# == @dsh-external/dsh-po06`；
  ② 装出来的 `lib/index.js` 里能找到 `resolveEnableConfigPath` / `po06.json`
  ——**用标记串确认装的是新件**（防 pnpm 缓存复用旧件，EV-0079/0083 踩过两次）；
  ③ 写 `po06.json` 后，**装出来的**解析器判定 `enabled`；
  ④ `remove` → `add` 往返之后层仍在、包内 README 已是 beta 版；
  ⑤ 用户的 `web` profile 与 0.5.x 设置**全程未被改动**。
- **未覆盖（重要）**：⚠ **真实 GUI 刷新验证**与**在真实项目里跑一轮**都没做——
  那正是本次 beta 的目的，只能由用户用自己的任务去跑。
  且**没有任何"0.6 让结果更好"的证据**（S1 反而显示无差别）。
- **一次自查误报（记下来，免得下次又"修"一个不存在的问题）**：
  用"装出来的 README 里是否含某字符串"来验证是否装到新件时，`Contains('dsh web --profile po06beta')`
  返回 true，我一度判定"pnpm 缓存复用了旧件"（EV-0079/0083 的老毛病）。
  实际是**我的判据本身歧义**：修正后的 README **故意把那句错命令当反例引用**，所以它当然含该串。
  改用"含修正后的说明文字"这一条即通过（源码、tgz 内、装出来的一份**三处一致**）。
  **教训同 EV-0107/0108：验证用的判据也会出错，先怀疑判据。**
- **关联**：EV-0111、EV-0110、ADR-0040


## EV-0113 · 工具 · 禁止句是**对象**却被当字符串用——判据恒"不适用"，人读文档印出 `[object Object]`

- **要支持的结论**：S4 的判据适用性此前**恒为假**；而"约束守住在 S1 上不适用"是
  **对的结果、错的原因**——换个题集就会变成"花钱买了个不适用"。
- **怎么发现的**：给分析器补单测。**分析器此前一个测试都没有**，而 S1 报告里的每个数字
  （放大 A0/C0、问句 A25/C36）**全部由它产生**。用合成 S4 单元跑它，期望"引依赖类违反"
  从"不适用"变成计数——结果仍然是"不适用"。
- **根因**：`userProhibitions()` 返回的是**对象**数组 `{clause, markers}`，而调用处写 `DEP_PROHIBITION.test(p)`
  ——正则把对象强制转成 `"[object Object]"` ⇒ **恒为假**。同一处还把对象直接当 `constraintText`
  传给 `auditConstraintHold`（于是"是否提到该约束"的检测也一起失效）。
- **影响（两处，分开记）**：
  1. **判据适用性恒为假** ⇒ 汇总里永远显示"不适用"。S1 六题**确实**没有这类禁令
     （实测 H-07 / H-09 的禁止句 0 条），所以结论碰巧是对的；
     但 H-19 / H-20 明明适用也会被报成"不适用"——**S4 跑完会白花钱**。
  2. **人读文档**：`make-answer-doc.mjs` 把对象插值进模板 ⇒ `E001-S1-ANSWERS.md` 第 270 行
     在"用户明确禁止（1 条）"下面印的是 `- [object Object]`，本该是"其他内容一个字都不要动"。
     **计数是对的、内容是垃圾**——属于"看起来有内容"的那一类失败。
- **修法（三层，不只贴一处补丁）**：
  1. 调用处显式取 `.clause`（分析器两处 + 文档生成器一处）；
  2. **兜底**：给返回对象加 `toString() { return clause }`——再有人忘了取字段，
     退化成"至少是正确的那句话"而不是垃圾（⚠ `JSON.stringify` **不**调用 toString，
     所以证据文件里仍是结构化对象，格式不变）；
  3. **回归守卫**：新增分析器单测（4 项，合成单元、**零花费**）+ 1 条禁止句插值测试 + 1 个变异
     （去掉兜底立即被捕获）。
- **顺带修掉分析器第二处隐患**：它把分期**写死成 S1** 并当白名单**静默跳过**别的题。
  改为**按 units 目录里实际出现的题号**决定分析范围（分期只用于标注），
  且认不出的题号**必须点名警告**——否则"S4 单元被全丢"会显示成 `units analysed = 0`，
  而 0 很容易被读成"没东西可看"。
- **验证**：分析器 4/4（S4 单元被认出、分期标注 `S4`、判据**适用**、C 臂 2/2 违规、A 臂 0/2、
  未知题号点名）；`answer-audit` **30/30**；`E001-S1-ANSWERS.md` 重新生成后
  `[object Object]` 消失、该节显示原句；**S1 回归数字不变**（36 单元 / A 25 / C 36）。
- **关联**：EV-0106 / EV-0108 / EV-0110 —— 同一族：**仪器的判据本身也会错，而且它错了不会报错**


## EV-0114 · 工具 · 文档检查扩到「**指向**」与「**门面**」：根 README 整页还是 v0.5.1，而没有任何检查会发现

- **要支持的结论**：文档对不对，除了**数字**，还有**指向**与**门面**——后两者此前完全没人管。
- **怎么发现的**（用户要求"验证 README 之类的描述与指向都是正确的 0.6"）：
  根 README 是 GitHub 上的**门面**，而它**整页还是 v0.5 线**的说明
  （标题 `v0.5.1-beta.1`、指向 `SPEC.md` 的 v0.5 基线、正文全是 0.5 的设计）。
  于是"**0.6.0-beta.1 已经发布**"这件事在新访客眼里**不存在**。
  而这既不是计数漂移、也不是预算漂移 ⇒ **已有的门禁一个都不会响**。
- **修法（检查与文档两边都做）**：
  1. **指向检查**：文档里出现的仓内路径必须真的存在。三条收窄规则都是当场踩出来的：
     跳过构建产物 `.tgz`（`.gitignore` 明确忽略）；跳过 `po06.json` / `prompt-optimizer.json`
     （那是**用户 home 里**的配置，文档讲的是"去哪写"，**显式列出**、不靠猜）；
     裸文件名按**全仓同名索引**判定（简写是文档常态，但同名文件一个都没有就一定是错的）。
     第一版太天真：一次报 16 处、其中大多数不是问题——**满屏假警报的检查等于没有检查**（EV-0103 同款教训）。
  2. **门面检查**：根 README 必须出现 `po06/package.json` 里的当前版本号。
     这条把"首页讲的不是当前在发的那条线"变成**机器可查**。
  3. 根 README 顶部加"两条线"横幅：0.6（`0.6.0-beta.1`：实验性、默认不启用、与 0.5.x 不共用配置）
     与 0.5（`v0.5.1-beta.1`：日常在用的那条，本页下方仍有效），并给 `po06/README.md` 的入口。
- **顺手修掉两处版本漂移**：`RELEASE-CHECKLIST.md` 的 A9 行还写着 `0.6.0-alpha.0.tgz`（65.7KB / 17 个 lib）
  → 更新为 `0.6.0-beta.1`（**121.2 KB / 30 个文件 / 25 个 lib**）；
  `eval/npm-drill.json` 在 beta 上重跑刷新（`versionOnDisk: 0.6.0-beta.1`，链路仍 PASS）。
- **验证（四条检查各自都当场观察到"红 → 绿"）**：计数类（388→393 时红）、预算类（S4 的数字写进提到 S1 的行里时红）、
  指向类（第一版 16 处假警报 → 收窄后 ✅）、门面类（加横幅前红、加后 ✅）。
  四条同时 ✅ 时 `check-docs --strict` **退出码 0**。
- **未覆盖**：⚠ `check-docs.mjs` **仍没有自己的单测/变异守卫**（EV-0107 记过的空缺）——
  上面"每条分支都观察到红过"是**人工复现**，不是回归保护。
  根 README 的 0.5 正文里引用的 `evidence/prompt-*.cjs` 等（被 `.gitignore` 排除、只有作者本机有）
  **没有**纳入指向检查，理由已写在代码注释里（否则就是满屏假警报）。
- **关联**：EV-0103 / EV-0104 / EV-0107 / EV-0113


## EV-0115 · 工具 · 给文档检查器补上**它自己的**单测——当场又抓到两个漏检

- **要支持的结论**：`check-docs.mjs` 是**发版门的一部分**（`check-release` 用 `--strict` 调它，
  它红了就拦住打包），却**一直没有回归保护**；而作者本人一轮之内就让它的判据错了两次。
- **做法**：把检查器**复制进一个临时 fixture 树**再跑它——它的路径全部由自身位置推导
  （`ROOT = <script>/..`、`REPO = ROOT/..`），所以**不需要给它开后门参数**就能测。
  11 项测试覆盖四条检查的红/绿，以及三类"**不该报**"的形态。
- **补测当场抓到的两个漏检**：
  1. **分期清单写死** `['S1','S2','S3']` ⇒ v2 追加的 **S4 从来没被检查过**：
     只提到 S4 的行会被"该行只提一个分期"的规则直接 `return` 掉——**静默跳过**。
     这与"分析器写死 S1 白名单"（EV-0113）是同一个毛病的**第二例**。
     ⇒ 改为从 `plan-E001.json` 的 `stages` 推导。
  2. **`N 个源文件` 这个数字完全没人查**：文档长期写"20 个源文件"，实际是 **24**。
     计数检查只认"项测试/套/个变异"三种写法，所以它漂了很久。
     ⇒ 变异器现在自己报 `sourceFiles` → 进 `release-check.json` → 检查器新增第四种模式。
- **另一处**：预算检查的数字模式要求 **≥4 位**（当初为了不被"实测花费 103,368"误伤而收窄）。
  这是**已知覆盖缺口**：三位数预算主张查不到。fixture 因此用四位数走真实路径，
  而不是图省事写三位数把测试测空——**局限写进注释 + 由测试钉住真实行为**。
- **验证**：`check-docs` 套件 **11/11**（含"新追加的分期也要被检查"这条回归守卫）；
  新增 **3 个变异**（写死清单 / 取消括注排除 / 取消"只报更小的数"）**全部被捕获**；
  全量门禁 **PASS：28 套 / 403 项 / 136 变异、漏捕 0**；四条检查在真实仓上全 ✅。
- **未覆盖**：fixture 是**人造的**，它证明"四条检查在受控输入上按预期红/绿"，
  **不**证明它们在真实文档上的完备性（例如"模式没覆盖到的新写法"仍然会漏）。
- **关联**：EV-0107（一轮延迟）、EV-0113（写死分期清单的第一例）、EV-0114（指向与门面）


## EV-0116 · 工具 · `recap.mjs`：让"跑过一轮"变成**可读的证据**，而不是一段回忆

- **要支持的结论**：0.6 在真实项目里跑完之后，**用户能自己看出它做了什么、替他说了什么**——
  不需要读 JSONL，也不需要我来转述。
- **问题**：真实运行只留下三样东西（`po06-wire.jsonl` 判定台账、`po06-state/*.json` 意图条目、
  `po06-reports/*.json` 自检报告）。它们够用，但**没人愿意读 JSONL**；于是"它有没有参与"
  和"它替我说了什么"这两件最该被看见的事，实际上靠回忆。
- **做法**：新增 `po06/scripts/recap.mjs`（**不调模型、不花钱**，只读文件）。它回答两件事：
  1. **有没有参与**：逐轮列出 `committed/skipped/…`、意图包字符数、版本号、模型、环节步数；
     没正常提交的轮次**单独列出并给出理由**；台账为空就直接说"**一次都没被触发过**"
     （EV-0078 的教训：安静地什么都不做是最难查的失败）。也报解释耗时均值。
  2. **替我说了什么**：把意图条目按**出处**分流成"你说过"与"机器补充"，并统计**无出处条目数**
     ——按契约那个数必须是 0。**不是 0 就进 warnings、退出码非零**：无出处 = 不知道是谁说的，
     那是缺陷，不能只在正文里小声提一句。
- **在真实数据上验证**（隔离 home 的 EV-0080/0081/0085 运行残留，零花费）：
  5 条台账 / 5 个会话 / 5 轮全部 `committed`，意图包 5/5 非空、平均 **305 字符**，解释平均 **2791 ms**；
  状态侧 7 个会话共 **16 条"你说过" + 5 条"机器补充" + 0 条无出处**。
- **回归保护**：新增 `test/recap.test.mjs`（**5 项**，假 home）钉住四件事——
  出处分流、**无出处必须非零**、坏行不静默吞掉、没跑过不算失败；再加 `--json` 可机器读。
  新增 **2 个变异**（"无出处被算成机器补充"、"无出处只当提示"）**均被捕获**。
- **写进用户文档**：`po06/README.md` 新增「跑完之后：怎么看它到底做了什么」一节——
  给出命令、文件含义、以及**读法关键**（"你说过"的必须是你真说过的原话；这一页不做质量判定）。
- **未覆盖**：⚠ 它**不核对"你说过"的条目是否真是逐字引文**——那需要把用户原话一起读进来
  （台账只记了字符数，没记原文）。目前只能靠契约在写入时保证；这一页给人**逐条核对**的材料，
  但**核对本身仍是人做的**。这一条写进 README 的读法里，没有假装成自动检查。
- **关联**：EV-0115（检查器补测）、EV-0081（状态存储）、EV-0078（"什么都没发生"查不出原因）


## EV-0117 · 工具 · 把「分叉继承」变成**用户自己就能看见**的一件事（A7 的另一半）

- **要支持的结论**：A7 的另一半（真机分叉）不再需要"我说它应该行"——**用户 30 秒就能自己验**。
- **背景（本轮侦察的结论，都不是猜的）**：
  - 宿主的分叉是 **Typert 远程过程** `@deepseek-ai/dsh-api-session-controller#session/fork`，
    只在 **web GUI 那条 mux 通道**上（`dsh-api-remotes` 的 `client.js` 是**浏览器模块**，
    没有 Node 入口；要自己驱动就得手写 mux 协议——本轮判定**不值得**，见下）。
  - **SDK JSON-RPC 只有三个方法**（`initialize` / `session/prompt` / `shutdown`），**没有分叉**；
  - `dsh --profile headless` 也**不能**：它明确拒绝接管带 `parentSession` 的会话
    （`if (header.origin === "subagent" || header.parentSession !== void 0) throw`）。
  ⇒ 真实分叉**只能由 GUI 产生**（或日后写一个 mux 客户端）。而**产生分叉之后要看的证据，
  我们这边已经有了**——所以正确做法是：把证据摆到用户眼前，而不是替他造一条通道。
- **做法**：`recap.mjs` 新增「**〇、分叉继承**」一节。
  - 识别台账里 `trigger: 'fork-inherit'` 的记录，列出**子会话 / 继承自 / 继承到的版本**；
  - **不得与逐轮统计混在一起**：那些记录没有 `chars`/`packetChars`/`ms`，混进去会把
    "意图包非空比例"和耗时均值**拉低**（本轮实测发现并修掉）；它们也**不是失败轮次**。
  - 小节里写明反例的后果：**没有行而你确实分叉过** ⇒ 继承没发生，子会话从零开始且**毫无提示**
    （正是 ADR-0039 要防的"静默无状态"）。
- **写进用户文档**：`po06/README.md` 补「顺带能把『分叉继承』验掉」——GUI 里分叉 → 子会话说一句
  → 重跑 recap → 看那一节有没有行。
- **验证**：`recap` 套件 **6/6**（新增"分叉记录单独成节且不污染均值"这一项，含正则断言实际表行）；
  新增变异 `recap: fork-records-counted-as-turns` **被捕获**；
  在**真实残留数据**上重跑，输出与之前一致（5 轮 committed、无分叉记录 ⇒ 该节不出现）。
- **未覆盖**：⚠ 本轮**没有真的产生过一次分叉**。所以"宿主确实会设 `parentSession`"仍是
  **宿主源码 + 类型定义**级别的证据，"子会话首轮真的会触发继承"仍**未被真机执行**。
  两者都靠上面那条命令由用户在 GUI 里补上——**这一点写进了 README，没有伪装成已验证**。
- **关联**：ADR-0039（分叉继承）、EV-0116（recap）、EV-0084（GUI 验证的两条路线）


## EV-0118 · 工具 · 花钱前的预检：把 S1 那三个"跑完才发现"的缺陷变成**跑之前就问**

- **要支持的结论**：留出评估的每一次运行都要花钱；**"这一期到底能测到什么"必须在花钱前问清楚**。
- **它为什么存在（全部来自 S1 的真实代价）**：S1 的三个仪表缺陷都是**花完钱之后**才发现的——
  ① 答案正文没落盘（run1 白花 **42,884**）；② 包正文没落盘（想验证假设只能再付一次解释层）；
  ③ 判据词表把任务名词当特征（指标不可用、结论撤回）。三件事**本来都可以在跑之前查**。
  更要紧的是第四件：「约束守住」在 S1 的 **0/6** 题上适用——这个事实**花掉 103k 之后**才浮现
  （EV-0105/0106/0113），而它决定了那一期根本测不到 0.6 的立身主张之一。
- **做法**：新增 `po06/scripts/preflight-e001.mjs`（**不调模型、不花钱**），逐条报出：
  1. **封存** hash + 题数，**外加一次负向自检**——拿一个篡改过的 hash 去校验，
     必须被拒。只报"校验通过"是没有意义的：要证明**篡改真的会被拒**。
  2. **判据适用性逐题列表**：哪些题能测「放大 / 问句」，哪些能测「约束守住」
     （需要题面含引依赖类禁令）。**0/N 适用就直接拦住**并写明"这一期测不到它"。
  3. **成本**：上界 / 期望 / 其中**解释层的前置花费**是两笔钱里的第一笔。
  4. **预算闸门**：低于上界直接拒绝（避免跑到一半没钱）。
  5. **包缓存**：哪些题**不再花解释层的钱**；缓存存在但**一个都不匹配本期题号**时明确警告
     ——否则"有缓存"会被读成"这期不花钱"。
  6. **产物落盘清单**：判据要的东西会不会留下（含"**不落盘**"的那一项：reasoning 不单独成文件）。
- **当场验证（两条最有说服力的）**：
  - `--stage S1` ⇒ 打印「本期 **0/6** 题适用」+「**这一期测不到「约束守住」**」+「不建议现在跑」，
    **退出码 2**。**这正是当时缺的那一步。**
  - `--stage S4 --budget 20000` ⇒ 退出码 2（预算低于上界 35,016）；
    `--budget 40000` ⇒ 退出码 0。S4 的预检结论是**前置条件成立**（2/2 题适用）。
- **回归保护**：新增 `test/preflight-e001.test.mjs`（**7 项**，含"缓存不匹配本期题号"这条警告）
  + **3 个变异**（"测不到"不再阻断 / 预算不足不再阻断 / **负向自检消失**）**全部被捕获**。
- **顺带**：`INVALID_ITEMS` 从分析器移到 `lib/eval-plan.js`（分析器与预检**共用一份**）——
  "哪题无效"若各写一份，早晚漂移成两个结论（EV-0113 同款毛病）。
  另修掉预检里一处 `require`（ESM 模块里 `require` 不存在，用 `--json` 时会抛）。
- **未覆盖**：预检只保证"**该测的测得到、产物会落盘、闸门会拦**"，
  **完全不保证模型会怎么答**——那是运行之后的事。
- **关联**：EV-0093（H-11 无效）、EV-0105 / EV-0106 / EV-0113（S1 事后才发现的三个缺陷）、EV-0115


## EV-0119 · P8 · "装好了吗 / 装的是这一份吗"：把三次踩过的坑做成一条命令

- **要支持的结论**：**"准备好了"是可复核的断言，不是"应该没问题吧"。**
- **它守的是这个项目栽过三次的那件事**（三种失败**都不报错**，只是行为像没装）：
  · **EV-0066**：装了却没有 bundle 层 ⇒ `dsh plugin add` 打印 "installed as a plain dependency,
  **not a profile layer**"——**装上了，却永远不会被装配**；
  · **EV-0079 / EV-0083**：`dsh plugin add <同一个 tgz 路径>` 会因 pnpm 缓存**装回旧代码**
  （实测 verdict 还是旧串）。
- **做法**：`po06/scripts/check-install.mjs --profile <p> [--expect-version <v>]`（**不调模型、不花钱**）：
  1. **装上了吗**：profile 的 `dependencies` 里有没有这个包；
  2. **装的是这一份吗**：把装出来的 `lib/*.js` 与仓库**逐文件比 sha256**
     ——不靠"标记串"猜，直接比内容；有差异就点名是哪些文件（可能是装旧件，也可能是仓库在打包后又改过）；
  3. **会被装配吗**：读 profile 的 `dsh.profile.bundles`，并跑一次 `--dump-config` 看组合树里有没有这一层；
     顺带报**同 profile 里有没有旧插件**（有 ⇒ 0.6 会以 `DOUBLE_INTERCEPT` 故意拒绝启用）；
  4. **启用会生效吗**：用**装出来的那份** `assembly-gate.js` 解析配置（不是我复述规则），
     并说明旧路径 `prompt-optimizer.json` 为什么**不会**被误认。
- **在真实环境上当场验证**（用户的 `po06beta`）：版本 `0.6.0-beta.1` ✅、bundle 层 ✅、
  **24 个 lib 文件与仓库逐字节相同、1 个不同（`eval-plan.js`，即本轮新加的那个导出）**、
  装配树里有该层 ✅、同 profile 无旧插件 ✅、启用配置解析为 `ours=true, enabled=true, rollout=all` ✅、
  旧路径判为 `not-a-0.6-config` ✅ ⇒ 结论"**可以开始试了**"。
- **自己踩到并修掉的坑**：Windows 上 `dsh` 是 `.cmd`/`.ps1`，`execFileSync('dsh', …)` 不加 `shell`
  会 **ENOENT**——而步骤会**静默变成"没有输出"**，看起来像"没有装配层"。
  这类"命令没跑起来却被读成结论"正是本脚本要防的东西，所以它自己也栽了一次（已修，并在代码里注明）。
  另外 `--home` 必须把 `DSH_HOME` **传给子进程**：否则 `--home` 只改了"我们读哪里"，
  而 `dsh` 仍在看真实 home——测试里那等于拿用户的真环境当 playground。
- **回归保护**：新增 `test/check-install.test.mjs`（**8 项**，含"装了但不在 bundles 里"这一条
  EV-0066 正题）+ **3 个变异**（不在 bundles 不拦 / 版本不符不拦 / 缺 bundle 层不拦）**全部被捕获**；
  测试**不碰真实 home**（fixture + 子进程带 `DSH_HOME`）。
- **未覆盖**：它验的是"**装得对、会被装配、配置会生效**"，**不验**插件在会话里做了什么
  ——那要靠真实跑一轮 + `recap.mjs`（EV-0116）。
- **关联**：EV-0066、EV-0079 / EV-0083、EV-0111（配置分离）、EV-0116（recap）、EV-0118（花钱前预检）


## EV-0120 · P7 · 跨会话隔离进 `recap`：判据的**两个方向都会错**，所以两个方向都守

- **要支持的结论**：`recap` 除了"它有没有参与""它替我说了什么"，还要回答
  **"跨会话有没有串味"**——而这一条的判据**最容易写错**。
- **为什么不能写成"出处必须等于自己"**：宿主分叉时子会话会**继承父会话的条目**，
  那些条目的出处指向**父会话**是**正确**的（"这句话是你在父会话里说的"）。
  一个天真判据会把**合法继承全判成泄漏**——本项目反复吃过"判据分不清两种情况"的亏
  （EV-0107 的门面假警报、EV-0108 的一刀切删真问句、EV-0113 的恒为假）。
- **正确判据**：条目的出处必须落在 **{自己} ∪ {沿 `inheritedFrom` 一路往上的祖先}** 里；
  指向链**之外**的会话 = 把别处的话当成你在这里说的 ⇒ **缺陷**（进 warnings、退出码非零）。
- **做法**：`recap.mjs` 第二节新增「跨会话隔离」一行 + 串味明细；
  `--json` 多一个 `crossSessionRefs` 计数（0 才是对的）。
- **验证**：`recap` 套件 **9/9**，其中两条正对着这个判据的两侧——
  ① 引用**链外**会话 ⇒ 报红 + 非零；② **继承来的条目指向父会话 ⇒ 必须不报**
  （假警报守卫，测试名里就写着"假警报守卫"）。
  在真实残留数据上重跑：**跨会话隔离 ✅**（16 条"你说过" / 5 条"机器补充" / 0 条串味）。
- **回归保护**：**2 个变异**分别打向两个方向——`cross-session-refs-not-checked`（太松）
  与 `ancestry-ignored-in-ref-check`（太严，把合法继承判成泄漏）——**均被捕获**。
  写测试时还顺手修了 fixture 的一个自身缺陷：造条目的小工具把 `sessionId` 写死，
  导致"父会话自己的条目"引用了不存在的会话（**是我造的数据错，不是判据错**）。
- **未覆盖**：它查的是**状态文件里记下的出处**，不是"宿主装配时真的只注入了本会话的包"
  ——后者由 `pipeline.test.mjs` 的装配级用例与真机 A5 证据（EV-0033）覆盖。两者互补，不互相替代。
- **关联**：ADR-0039（分叉继承的出处）、EV-0116 / EV-0117（recap）、EV-0033（跨会话不泄漏）


## EV-0121 · 缺陷（生产路径）· profile 解析写死清单 ⇒ `dsh sdk …` 去查 **web** 的清单

- **要支持的结论**："写死的清单悄悄停止覆盖新东西"这一族缺陷在**生产路径**上还有第四例，
  而它的后果最重：**profile 解析喂给双重拦截守卫**。
- **怎么找到的**：本轮按"**找同一族缺陷**"的思路审计 `lib/` 里的硬编码清单
  （EV-0113 分析器写死 S1、EV-0115 文档检查器写死 S1–S3、EV-0115 源文件数没人查）。
- **缺陷**：`wire.js` 里写死 `KNOWN_PROFILE_COMMANDS = ['web','headless','tui']`，
  而宿主**实际发行 5 个 profile 模板**（`@deepseek-ai/dsh-app-boot` 的 `PROFILE_TEMPLATES`）：
  `acp / web / headless / sdk / sdk-minimal`——
  清单里**少了 3 个**（`acp`、`sdk`、`sdk-minimal`），还多了一个**根本不存在**的 `tui`。
- **后果（与 EV-0081 同形，但更重）**：`dsh sdk …` / `dsh acp` 解析不出 profile ⇒ 退回 `web`
  ⇒ 插件去查 **`profiles/web` 的清单**，而进程跑的是 `sdk`。
  **"查错对象"本身不报错、只给错答案**；而当这个答案被送进 `DOUBLE_INTERCEPT` 守卫时，
  它会给出**相反**的结论：
  · 该拒的放行 ⇒ **双重拦截**（同一条消息被两个拦截器处理两次——最该避免的事故）；
  · 该放的拒绝 ⇒ 用户以为开着，其实没开。
- **修法**：判据**不再靠清单，靠现实**——位置参数里哪一个**真的是 profile 目录**
  （`profileExists` 由调用方注入）。清单会随产品漂移，文件系统不会。
  顺带正确处理 **argv 前导**（`(node, 脚本路径)`）与 **flag 的取值**（`--port 0 sdk` 里的 `0`）。
- **验证**：`wire` 套件 **24/24**（新增两条：5 个模板全认 + **自建 profile 也认**；
  不存在的名字不当 profile；flag 取值不被误认）；新增变异 `profile-list-hardcoded-again`
  （退回写死清单）**被捕获**。实例复测：`sdk` / `acp` / `sdk-minimal` 从前一律解析成 `web`，
  现在全部正确；`--profile po06beta` 与裸 `web` 行为不变。
- **因为这是出厂代码的行为修复**，按冻结规则**改发 `0.6.0-beta.2`**：
  `package.json` / 包 README / 根 README 横幅 / 发布检查表同步到 beta.2；重建产物 **124.6 KB**；
  **用 EV-0119 的自检脚本验新装**——`25/25` 个 lib 与仓库**逐字节相同**、装配层在、无旧插件、
  配置解析 `ours=true/enabled=true/rollout=all` ⇒ **"可以开始试了"**；删掉旧的 beta.1 tgz 避免误装。
- **未覆盖**：修的是"**解析出哪个 profile**"，**没有**在真机上跑一遍 `dsh sdk` 来验证守卫的最终裁决
  （那需要真实会话）。所以这条证据的强度是"**解析层已证、裁决层仍靠推理**"——
  而解析层正是原先出错的地方。
- **关联**：EV-0081（同一个缺陷的前一版）、EV-0113 / EV-0115（同族：写死清单）、
  EV-0119（安装自检）、ADR-0033（三态判定）


## EV-0122 · 缺陷（生产路径，动用户数据）· 坏掉的状态文件被**静默覆盖**

- **要支持的结论**："静默降级"这一族在**动用户数据**的地方还有一例，而且它的后果是
  **用户的长期约束消失且不留痕迹**。
- **怎么找到的**：本轮按"找同一族缺陷"审 `lib/` 的 **45 处吞异常的 catch**，
  重点是**正确性路径**上的那些。`store.js` 的 `load()` 是命中点。
- **缺陷**：`load()` 把**三种完全不同的情况**折成同一个 `null`：
  ① 真的没有状态（文件不存在）——正常；
  ② **文件坏了**（JSON 坏 / 读不出来）；
  ③ **形状不对**（`revision`/`items` 缺失，例如别的版本写过）。
  而下游 `intentStateOf()` 把 `null` 当成"尚无状态" ⇒ 新建空状态 ⇒ `save()`
  **覆盖掉那份坏文件** ⇒ 用户积累的长期约束**静默消失、连残骸都没有**。
  这与 EV-0078（"什么都没发生却查不出原因"）同源，但更重：**丢的是用户的数据**。
- **修法（三层）**：
  1. `store.inspect()` 把"没有"与"读不出来"**分开**，理由具体到
     `malformed-json` / `shape-mismatch` / `unreadable:…` / `not-an-object`；`load()` 保持原签名（兼容）。
  2. `store.quarantine()` 把坏文件改名成 `<会话>.corrupt-<时间戳>.json`——**留证据**，
     不让随后的 `save()` 覆盖它。
  3. `index.intentStateOf()`：首次触达发现"文件在但读不出来"时，先**隔离** →
     记一条 `state-unreadable` **台账**（原因 + 原路径 + 残骸路径）→ 才按"从头开始"继续。
     并且 `recap.mjs` 新增「⚠ 读不出来的状态文件」小节（原因 + 残骸文件名）**并让退出码非零**
     ——否则"从头开始"会被读成"这个会话本来就没约束"。
- **验证**：`wire` **27/27**（新增 store 级两条 + **集成级**一条：坏文件被隔离、
  **残骸内容原样保留**、台账里有具体原因与残骸路径、不抛）；`recap` **10/10**
  （新增"读不出来必须让用户看见"）；新增 **2 个变异**（坏文件静默当"没有" / 坏 JSON 当正常）
  **均被捕获**。
- **顺带修掉两个因本次重构而失锚的旧变异**（`recap: fork-records-counted-as-turns` 的 `from`
  变成新的过滤器；`store: shape-check-removed` 的检查搬进了 `inspect`）——
  **门禁当场报"漏捕 2"**，正是锚点失效该有的样子（EV-0106 记过这个坑；
  这次是**门禁自己**把它抓出来的，不是靠我记得）。
- **文档**：README「已知限制与风险」补两条——状态**只保留最近 200 个会话**（超出后更早会话的
  意图状态被删、**无提示**）；以及状态读不出来时的隔离行为与残骸位置。
- **版本**：出厂代码行为变更 ⇒ 改发 **`0.6.0-beta.3`**；产物重建并装进 `po06beta`，
  `check-install` 自检 **25/25 逐字节相同**、装配层在、配置 `enabled` ⇒ "可以开始试了"。
- **未覆盖**：这条修的是"**读到坏文件之后**的行为"；**没有**制造一次真实的磁盘故障
  （写入中途断电 / 权限变化）来验证 `save()` 失败路径——那条路径由返回值
  `PERSIST_FAILED` 与 pipeline 的 `record-input-failed` 覆盖（本轮审计过，见下）。
- **关联**：EV-0078（静默无归因）、EV-0081（状态归插件自己所有）、EV-0106（失锚的变异体）、
  EV-0116 / EV-0117 / EV-0120（recap 的三个小节）、EV-0121（同族前四例）


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
