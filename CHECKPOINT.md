# 当前执行检查点（CHECKPOINT）

> 本文件是跨会话恢复的唯一入口。任何人（或 AI）接手 0.6 迭代时，先读本文件，再读 `PLAN-0.6.md`。
> 规则：只写有证据的事实。「已完成」必须附哈希/命令/文件；未验证的必须写在「未完成」。

- **规范版本**：`PLAN-0.6.md` sha256 `2734fdbd0afd03f37ff30e1968528af074bd518d87519e31f764bd46dffec62a`（81134 bytes）
- **仓库绝对路径**：`C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer`
- **远端**：`https://github.com/WestFox-AwA/dsh-prompt-optimizer.git`
- **分支**：`dev/0.6`（P0 新建，从 `main` @ `04a6615` 切出）；`main` 保持干净未动
- **当前阶段**：P0 进行中（资产定位已完成，基线冻结与实验登记已建立；尚未进入 P1）
- **宿主**：dsh `0.1.6-alpha.1` · node `v24.19.0` · git `2.53.0.windows.1` · Windows 11 build 26200

## 已完成（附证据）

1. **定位正式源码仓库** — `C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer`（含 `.git`、`lib/`、`evidence/`）。
   证据：`git remote -v` → origin 指向 GitHub 仓库；`git status --short` 为空。
2. **建立隔离开发分支** — `dev/0.6`。
   证据：`git branch --show-current` → `dev/0.6`。
3. **冻结 0.4.4 基线（可复现）** — `git show v0.4.4-beta.1:lib/index.js`
   = sha256 `475f0d919a5157192954f9f70879a70ac6d935c8150856823e9ad2d2f6924a63`（152576 bytes, LF）。
   交叉印证：`dsh-external-dsh-prompt-optimizer-0.4.4-beta.1.tgz` 内同名文件哈希**完全一致**。
4. **冻结当前 0.5.x 基线** — dev HEAD `04a6615` 的 `lib/index.js`
   = sha256 `5261a575c2aef77df8cf64fcd5f943b512250aaa52a217c53cfd287e9afe2b0a`（272741 bytes）。
5. **采集运行实例真实身份** — loader entry 在 0.4.3 目录，其 `lib/index.js` 哈希 = 上述 HEAD 值；
   profile 依赖/junction 指向 0.5.2 目录，内容同为该哈希。
6. **采集活动配置** — `~/.dsh/prompt-optimizer.json`：`strategy=v6`、`tier=off`、`permission=review`、
   `readTools=true`、`delivery=chat`、`turns=10`、`historyMode=turns`、`fullOn=true`、`reasoningEffort=high`、`revision=2234`。
7. **发现并定位两个漂移缺陷** — 见 `DECISIONS.md` ADR-0001 / ADR-0002 与 `baseline-manifest.json` 的 `knownDefectsFoundDuringP0`。
8. **落盘基线清单** — `baseline-manifest.json`（本仓库根）。
9. **计划文档入仓** — `PLAN-0.6.md`（与已审查的主文档逐字节一致）。
10. **重建两个实验臂到隔离目录并通过哈希校验** —
    `C:/Users/WestFox/.dsh/exp/po06/arms/B-044/package`（0.4.4，`475f0d91…` ✓）、
    `C:/Users/WestFox/.dsh/exp/po06/arms/D-05x/package`（HEAD，`5261a575…` ✓）。
    重建方式：`git archive --format=tar --output=<file>` + `tar -xf`（**不可用 PowerShell 管道**，会损坏二进制）。
11. **B 臂可加载性验证（桩宿主，范围有限）** — 见 `EVIDENCE.md` EV-0003：import 与 `apply()` 均通过，
    仅索取 `settings`，订阅 `llm/stream` + `session/event`，注册 1 路由 + 1 看门狗；该 lib 只依赖 Node 内置模块。
    **尚未**在真实 dsh 中装配运行，因此还不能宣称"功能正常"。
12. **B/D 宿主接触面对照** — 见 EV-0008：D 臂多出 `ctx.inject(['systemPrompt'])` 与
    `prompt-optimizer:capability`（order 118）上下文注册，B 臂没有。这是结构差异，不是因果结论。

## 正在进行

- **P2 进行中**。已完成：schema + 纯函数 reducer + 单元/变异检验（上半）、投影接线 + 三闸门宿主路径验证（下半）。
  剩余：跨重启恢复验证、与 P1 适配器的完整接线（编译层在 P3）。

### P2 下半结论（投影接线）

- **交付物**：`po06/lib/projection.js`（投影定义 + `commitPatch`），适配器新增
  `intentStateOf` / `commit` / `commitUserInput` / `initIntent`。
- EV-0025（PASS，自建会话 `session-po06-p2-proj-mu90wobv`）：
  投影注册、whole-value 状态事件、**CAS 拒绝**（`STALE_REVISION`）、**在途补丁拒绝**、
  **身份闸门拒绝**（`UNAUTHORIZED_KIND`，宿主路径）、wire 视图、卸载即净 —— 全部成立。
  三条闸门**不再只是单元测试**，在真实提交路径上同样有效。
- `apply` 短路实测：本窗口 6 次调用、短路 3 次、采纳 3 次、`shortCircuitRatio=0.5`。
- **与 P1-4 的 1407 次对照**：窗口活动量不同——P1-4 时本机正在活跃工作，P2 窗口仅数秒。
  apply 调用量随**宿主总事件量**增长，1407 属于繁忙窗口，不是稳定开销。
- **没做到的事（已记录）**：原计划分离"首次折叠历史"与"增量驱动"两类调用，**未能做到**——
  `apply(state, event)` 入参不含会话标识，无法从内部区分。要分离需换测量位置（包装 `drive` 外层或分段计时）。

### P2 上半结论（意图状态核心）

- **交付物**：`po06/lib/schema.js`、`po06/lib/reducer.js`、`po06/test/reducer.test.mjs`、
  `po06/test/mutate-check.cjs`。
- EV-0023：**18/18 pass**；三个变异（身份闸门、CAS、输入闸门）**全部被测试捕获**，还原字节一致。
- 已实现的闸门：来源身份（非人类来源不得建 user_requirement/user_decision）、
  `kind` 不可变（质量解释不得升格）、CAS（旧 revision 拒绝）、用户改口闸门（`lastInputRevision`）、
  supersedes 取代关系、重复/未知条目拒绝、纯函数性与确定性。
- **修掉的假绿缺陷**：首版把身份判断放在形状校验器里，reducer 分支不可达而测试仍全绿。
  已重划职责——**schema 只管形状，reducer 管权威**。
- 运行方式：`node po06/test/reducer.test.mjs`、`node po06/test/mutate-check.cjs`。

### 工具链规范（EV-0024，必须遵守）

**涉及源码读写的自动化一律用 node**，不要用 PowerShell 做读-改-写：
`Set-Content -Encoding utf8` 会写 BOM（Node ESM 报语法错误）；
`Get-Content -Raw` 会把无 BOM 的 UTF-8 按 ANSI 解读而毁掉中文。
另外脚本里 `$ErrorActionPreference='Stop'` + node 的 stderr 会导致**还原步骤被跳过**，源文件留在损坏状态。

### P1-6 结论（最薄 DshAdapter + 兼容性报告）

- **交付物**：`po06/`（`@dsh-external/dsh-po06@0.6.0-alpha.0`）与 `compatibility-report.md`。
- EV-0022（PASS）：上下文注册 / 动态求值 / 静默复位 / **不唤醒投递**（`turnStarted=0`）全部成立。
  装配序实测：`dsh-super-injector → sandbox:policy → approval:policy → prompt-optimizer:capability → prompt-optimizer:intent`。
- **两个实现陷阱（已写进实现）**：
  1. `ctx.inject` 回调**异步**——必须 await 就绪，否则会误判"服务不存在"。
  2. 动态上下文**全局生效**——静默待命时文本必须为空，否则会进入**所有**会话（含用户正在用的）。
- 原型生产路径为**静默待命**：不调 LLM、不解析输入、不注册路由；自检由
  `exp/po06/run-selfcheck.flag` 触发（用完已删除）。

## 未完成 / 失败

- **留出集未编写封存**（≥18 题）——必须在 C 臂冻结前完成，否则 P7 不成立。
- **P1 未验证项（不得当作可用，清单见 `compatibility-report.md` 第五节）**：
  跨重启状态恢复、running agent 上的 `steer`、`wire.viewSchema` 路径、正向提问、
  `DELEGATED_CALLER`、多进程 CAS、0.4.4 在真实宿主的装配运行。
- **未验证**：0.5.x 退化的具体机理（仍只有用户体验描述 + 结构事实，没有区分候选解释）。
- **探针遗留物**：`~/.dsh/exp/po06/probe-reports/` 下的报告文件；测试会话见 EV-0021；
  `profile patch` 留有 probe 与 po06 的 disabled 条目（注入器写入，防自装配）。

### P1 已完成项（附证据）

1. **宿主服务与接口清单（真实进程）** — EV-0009。方法：只读探针插件经超级注入器装入真实 DSH，
   在 `apply(ctx)` 内枚举并写 JSON。**已卸载探针**（否则每次重启都会重跑测试并产生模型调用）。
   关键：`workspace`/`goal`/`logger` **absent**；`selectionFor`/`wake` 为 undefined；
   `sessionProjections` 六个方法齐全；agent 的 inject/steer/followup/send/cancel 齐全。
   本机 68 个 agent 全部是 root。
2. **plugin 来源消息全链路 PASS** — EV-0010。专用测试会话 `session-po06-p1-chain-mu90h66u`：
   构造（frozen、role=user、kind=plugin）→ `agent.followup` 投递 → 持久日志保留 source →
   模型实收（`deepseek-official/deepseek-v4.1-flash-expires-on-0910`，标记文本在请求中）→ 助手回复。
3. **宿主已在用同一机制** — EV-0011。全新会话在用户发言前已有 3 条 plugin 来源 user/message：
   运行时快照（`snapshot`,1162 字符）、技能目录（`catalog`,1017 字符）、探针（`notice`,88 字符）。
   ⇒ 上下文预算基线不是 0；0.6 必须避让且用 `snapshot` 取代语义（ADR-0006）。
4. **服务注入声明规则** — EV-0012：属性式 `ctx.webServer`/`ctx.setInterval` 需 `export const inject` 声明；
   `ctx.get()` 查找不需要但可能返回 undefined。

### P1 引入的设计修正

- ADR-0006：意图包改用 `form:'snapshot'`（取代语义），不用 `notice`；且不重复宿主已有注入。
  **已获机制支撑**：宿主 `RuntimeContextProjection.project()` 在文本未变时不产生消息（EV-0014），
  `systemPrompt.context()` 按 order 升序、dispose 即净（EV-0013）。⇒ 去重与合并**由宿主负责**。
- ADR-0007：投递/验证一律以**持久日志**为准；`agent.inbox.*` 即时读取曾给出假阴性。
- ADR-0008：显式声明 cordis 服务注入；缺失服务必须降级。
- ADR-0009：0.6 **不重复**陈述权限档/审批（宿主已说）；通道探测结果只按需注入；
  **通用行为规则不默认常驻**，要留必须接受 A/B 检验。

### P1-2 结论（动态上下文）

- EV-0013：注册/order/dispose 全部符合预期，零模型调用验证（`assemble()` 可脱开 agent 调用）。
- EV-0014：**"无变化不重复注入"是宿主保证的**，0.6 不必自己实现。
- EV-0015：真实每会话动态上下文 ≈1003–1037 字符，其中 0.5.x 插件占 298–339；
  已用原文对照确认其首句与宿主 `sandbox:policy`/`approval:policy` **重复**。
- EV-0016：这些上下文**按 agent 作用域求值**——不带作用域装配会读到 0 字符（本轮差点误判）。

### 遗留的取舍（留给 P2 用实测决定）

所有 `systemPrompt.context()` 贡献被合并为**一条**消息，所以 0.6 的文本一变，整条聚合快照（含宿主约 1003 字符）都会重发。
两种方案待测：(a) 并入聚合快照；(b) 像技能目录那样另发一条独立 `snapshot` 消息自行管理取代。

### P1-3 结论（回问通道）

- EV-0017：5 个校验分支全部在触达 answerer **之前**抛错，可安全测试：
  `ASK_ABORTED` / `EMPTY_QUESTIONS` / `CALLER_NOT_LIVE` / `BAD_INTENT`×2。
  递增推进（先验守卫顺序）确认源码读解正确，`abortedEarly:false`。
- **未测**：正向提问（会打扰用户，留到 P4 并约定时机）；`DELEGATED_CALLER`（需非 root 子 agent）。
- ADR-0010：P4 之前不实现任何会真实发问的路径。

### P1-4 结论（投影）

- EV-0018：注册/事件折叠/checkpoint/卸载全部 PASS；**无变化返回同一引用**符合宿主 `Object.is` 语义；
  不声明 `wire` 则不暴露给客户端快照。
- 实测宿主已注册 **23 个投影键**（清单见 EVIDENCE.md EV-0018）。
- **性能硬约束**：本探针 `apply` 在一次测试窗口内被调用 **1407 次**——注册单元对**所有会话的所有事件**被驱动，
  且首次触及要折叠该会话全部历史（本机 68 个会话）。
- ADR-0011：0.6 的 `apply` 第一句必须是 `event.type` 短路并返回同一引用；禁止在其中做 IO/LLM/序列化。

### P1-5 结论（投递语义）

- EV-0020（测试会话 `session-po06-p1-wake-mu90p4et`，**零模型调用**）：
  - `inject`（next-step）在 idle 下 **不唤醒**：`turn/start` 增量 0、消息留在队列
  - `inbox.remove(id)` 可精确移除
  - `steer` **确实唤醒**（`turn/start` 增量 1），立即 `cancel` 后无 `assistant/message`
  - 取消原因被持久写入：`turn/end.reason = {"kind":"aborted","reason":"po06-probe-cancel"}`
  - 无 `step/start` ⇒ 取消在第一步之前生效，**没有产生模型调用**
  - `cancel` 清空 inbox；之后 `inject` 仍正常
- **ADR-0007 收紧**：inbox 读取对"未被认领的排队消息"**是可靠的**；
  只在"刚投递且会立即唤醒"时不可靠（P1-1 的假阴性属后者）。
- ADR-0012：投递分级——`inject` 为默认（不唤醒）；`followup`/`steer` 仅限**已授权动作**；
  未授权时只排队等用户下次发言，不得自行唤醒。

## 未完成 / 失败

- **留出集未编写封存**（≥18 题）——必须在 C 臂冻结前完成，否则 P7 不成立。
- **P1 剩余两项**：steer 与 inject(no-wake) 路径（P1-5）、compatibility-report 与最薄 DshAdapter（P1-6）。
- **B 臂真实装配未验证**：仅在桩宿主下验证了加载与注册；未在真实 dsh 中跑过 LLM 调用与 UI 拦截。
- **未验证**：0.5.x 退化的具体机理；目前只有用户体验描述 + EV-0008/EV-0011 的结构事实，没有区分候选解释。
- **探针遗留物**：两个测试会话留在磁盘
  （`~/.dsh/sessions/--C-Users-WestFox-.dsh-exp-po06-test-workspace--/session-po06-p1-chain-*`），
  作为可复核证据保留；不需要时可整目录删除。profile patch 中留有一条 probe 的 disabled 条目（注入器写入，防自装配）。

## 下一步第一条具体动作

P2 收尾：验证**跨重启恢复**。步骤——
（1）在测试会话上提交若干状态事件（含一次 supersede 与一次 retract）；
（2）记录提交后的 `stateOf` 与 `checkpoint` 行；
（3）**重启 DSH**（需要用户配合或改用隔离实例——不得在用户工作中随意重启其宿主）；
（4）重启后读同一会话的 `stateOf`，断言 `revision/items/status` 与重启前一致；
（5）把结果写进 `EVIDENCE.md`。
若无法在不打扰用户的前提下重启，则改为**隔离实例**验证，或明确标注为未验证。

## 不能遗忘的边界

- **禁止**依赖目录名判断版本；一切以 `baseline-manifest.json` 的 sha256 为准。
- **禁止**运行 `evidence/probe.cjs` 的默认（同步）模式去做实验——它会把仓库 lib 广播覆盖所有安装目录（P0-D1）。
  如确需该行为，用 `--no-sync`。
- 原话必须保留；机器补充不得冒充用户来源；AI 解释不得升级为已确认需求。
- 质量展开要**主动**（用户明确要求保留提示词优化能力），但不得新增产品目标或硬约束。
- 未获授权不发布、不外发、不扩大权限。
- 效果结论只来自真实成品对照；文本长度、条款数量、推理 token 都不是质量证据。

## 活跃后台任务 / 子代理

- 无。

## 测试 / 实验状态

- 尚未运行任何模型实验。`EVAL-REGISTRY.md` 登记为 `registered` 状态，无结果。

## 备份 / 回滚点

- `main` 分支未动，`04a6615` 即回滚点。
- 实验臂一律从 git tag / tgz 重建，可随时重放。
