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
