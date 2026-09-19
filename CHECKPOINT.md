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

- **P6 进行中**。已完成验证记录与有限反馈的**判定逻辑**（24/24 + 变异检验）。
  剩余：**接真实验证器**（目前一个都没有）、**接真实投递**（返工消息尚未发出）。

### P6-1 结论（验证器与有限反馈判定）

- **交付物**：`po06/lib/verifier.js`、`po06/lib/feedback.js`、`test/feedback.test.mjs`（24 项）。
- EV-0041：结论绑定产物 sha256；每条检查必须有 observation；pass/fail 必须有 evidenceRefs；
  必须声明 coverage / notCovered；**只有 `fail` 可返工**；
  六道门（可返工失败 / 当前版本 / 未被新输入作废 / 已授权 / 预算未耗尽 / 非重复投递）。
- **ADR-0026**：`infrastructure_error` 与 `unknown` **一律不触发修作品**；
  返工指令只陈述现象、推测原因标注"未证实"、必须声明改动边界；
  预算按**任务**计而非按版本重置；停止原因**按信息量排序**报告。
- **未接实物**：目前**没有任何真实验证器**（截图/几何检测），也**没有把返工消息发出去**——
  本轮只证明了判定逻辑正确。这两项是 P6 剩余工作。
- 累计 **34 个变异跨 9 个源文件全部被捕获**；9 套单测共 **151 项**全绿。

### P5-3 结论（保持性）

- **先修掉一个真实缺口**：`droppedSummary` 一直被计算却**从未渲染进意图包** ⇒ 超预算时**静默丢内容**。
  现已渲染【本次省略】并邀请确认。
- **装不下就明说**：必保节永不丢弃 ⇒ 存在真装不下的情形；已渲染【预算不足】，
  并把**声明本身计入预算**（丢弃循环每轮重算）。
- EV-0040（9/9）：序列化往返保持 `scope`/`turnId`；**仅凭最后一条状态事件即可重建与实时相等的状态**
  ⇒ 压缩丢旧事件不丢状态（whole-value 的直接收益）；fork 继承一致且子会话推进不影响父快照。
- **ADR-0025**：省略必须声明；whole-value 是压缩安全的前提，**必须有测试守着**
  （已加"最后一条事件重建 == 实时状态"的断言）。
- 累计 **30 个变异跨 8 个源文件全部被捕获**；8 套单测共 **127 项**全绿。

### P5-2 结论（何时算新的一轮）

- **口径（ADR-0024）**：**一条用户消息 = 一轮**，`turnId = 'turn:' + messageId`
  （由 messageId 派生 ⇒ 天然幂等）。**agent 内部 turn（工具调用循环）不算新轮**。
  推进发生在 `recordInput` 之后、解释之前——否则解释器会基于上一轮的过期状态判断。
- EV-0039：第 3 条消息到达时，上一轮的 `turn` 指令**退役**、长期目标**保留**、
  意图包里旧指令消失而长期目标仍在；重复处理同一条消息**不会误退役**；解释器看到推进后的状态。
- **已知未定（诚实登记，需实测后再定）**：**用户中途插话（steering）算不算新的一轮**——
  当前**算**，但这意味着插一句"顺便看看履带"会让"只改颜色"立刻失效。
  该语义需要在真实长任务上观察，可能改为"插话不推进轮次"。
- 累计 **27 个变异跨 7 个源文件全部被捕获**；7 套单测共 **124 项**全绿。

### P5-1 结论（长任务作用域）

- **交付物**：`schema.js`（`SCOPES`、状态 `turnId`）、`reducer.js`（`advance_turn` op、条目 `scope`/`turnId`）、
  `compiler.js`（「本轮要求（仅本轮有效）」节 + `where` 过滤）、`test/longtask.test.mjs`（15 项）。
- EV-0038：本轮指令**不跨轮留存**，长期目标**不被挤掉**；`turn` 只对用户指令合法；
  退役是 `superseded` 而非删除（保留可追溯）。
  两条场景复核通过：「只改颜色，其他别动」与「换个风格」都不会丢原有交付约束。
- **ADR-0023**：`task`/`turn` 两作用域；必保节现在含 `turnScope` 与 `requirements` 两类。
- **未接线的关键问题**：`advance_turn` 目前由调用方显式触发——
  **"用户每条新消息算一轮" 还是 "agent 每个 turn 算一轮" 尚未定**，必须先定清并实测再接线。
- 累计 **25 个变异跨 7 个源文件全部被捕获**；7 套单测共 **115 项**全绿。

- **P4 进行中**。已完成：澄清规划（分类/预算/去重/授权/语义隔离）**并接入流水线**。
  剩余：真实提问路径（须先与用户约定时机，ADR-0010）、`unknownClass` 的真实模型验证。

### P4-3 结论（真实模型验证 `unknownClass`：**否证**）

- EV-0037：**两次真实调用都没输出 `unknownClass`**。
  第一次散文规则已在契约里；我据此判断"模型照示例输出"，把字段**加进 JSON 示例**并加强提示，
  第二次**仍然没有** ⇒ **我的假设被证伪**，且我停止继续猜测性修复（ADR-0022）。
- **实际影响（诚实评估）**：退化方向是"未知一律当用户偏好"——
  可能把**本该自己查的事实**拿去问用户；但问卷风险被**批次上限（默认 2）**兜住。
  两次实测中分类结果碰巧都对，但那是运气，不是机制。
- **处置**：保留路由机制（21 项测试）；新增 `unclassified` 计数进 trace，
  让"契约未遵守"**可见**而不是静默降级。将来要让分类可用，须换**独立可验证的分类步骤**。
- 累计 **21 个变异跨 6 个源文件全部被捕获**；6 套单测共 **100 项**全绿。

- **交付物**：`pipeline.js` 新增 `planAndRecordClarification()`；`interpreter.js` 契约加入 `unknownClass`。
- EV-0036：偏好未知 → `clarify(mode=ask)` + `recordQuestions(ok)`，question 状态为
  **`proposed`（不是 `asked`）** ⇒ **确实没触达用户界面**；
  事实/实现细节 → `mode=none` 并分流到 `lookup` / `decide`，不记录问题。
  trace 步骤序列：`… → commit → clarify → setContext`。
- **抓到的设计缺陷（ADR-0021）**：`alreadyHandled` 只认清终态，而问题永远停在 `proposed`
  ⇒ 每次输入重复规划、记录时撞重复 id（"规划说该问、记录却失败"）。
  已新增 `hasQuestion()` 并把**幂等性放在规划层**；拆开 plan / record / ask 三种职责。
- 累计 **20 个变异跨 6 个源文件全部被捕获**；6 套单测共 **98 项**全绿。

### P4 上半结论（澄清规划）

- **交付物**：`po06/lib/clarifier.js`、`po06/test/clarifier.test.mjs`（20 项）；
  `schema.js`/`reducer.js` 扩展 `unknown` 的 `unknownClass` 与 `blocksAction`（**只对 unknown 合法**）。
- EV-0035：三分类分流、四道防问卷闸（分类/预算/去重/授权）、
  超时不做任何状态转移、`answered` 必须带人类来源 —— 全部成立。
- **ADR-0020**：只问用户偏好；事实与实现细节分别路由给查证与工作 AI。
  同一 decisionId 一旦问过（非 `proposed`）**永不再问**——这是"不重复问"的机制保证。
- **未触达用户界面**：本轮只写 `add_question` 状态，不弹窗（遵守 ADR-0010）。
- 累计 **19 个变异跨 6 个源文件，全部被捕获**；6 套单测共 94 项全绿。

- **P3 进行中**。编译层、解释层契约、**C 臂流水线接线**均已完成（全部离线，零模型预算）。
  **剩余唯一一件需要模型预算的事：真实基线对照（A/D/C）。**

### P3 真实模型冒烟结论（EV-0034，本轮）

- **一次调用即通过契约**：`parsedOk=true`、`provenanceProblems=[]`——5 条 `user_requirement`
  的引文全部能在原话里逐字找到；**未发明任何硬约束**。
- **最关键的一条**：CDN/外部依赖分叉被写成 **`unknown`**（未替用户拍板），
  three.js 只出现在 **`proposal`**。这与用户报告的 0.5.x「凭空加禁联网/禁依赖」形成直接对比。
- 真实输出编译出的意图包：**781 字符 / 预算 1200 / 零丢弃 / 审计通过**，四节齐全。
  文本存 `exp/po06/probe-reports/packet-from-smoke.txt`。
- 成本已登记：`deepseek-official/deepseek-v4.1-flash-expires-on-0910`，
  7580 ms，input 717 / output 1843 / total 2560。
- **性质限定（不得外推）**：n=1、单模型、单题。
  **成品质量对照（A/D/C）仍未运行**，因此**不能宣称 0.6 优于任何版本**。

- **交付物**：`po06/lib/pipeline.js`、`po06/test/pipeline.test.mjs`（12 项）。
  解释器是**注入**的，故测试与产品编译**完全不调用模型**。
- EV-0032：端到端提交、越界防线、发明要求被拒、**两类竞态**（用户改口 / 并发内部提交）、
  解释器抛错、noop、伪造来源被 reducer 拦、trace 可定位、确定性 —— 全部成立。
- **抓到的真实缺陷（ADR-0018）**：`dryRun` 原本用解释开始前的**旧快照**校验，
  CAS 变成"旧比旧"，对晚到补丁给出**假 OK**。已改为解释后重读当前状态
  并显式检查输入修订（`INPUT_CHANGED_DURING_INTERPRETATION`）。
  **发现路径值得记住**：我先写了一条自己都不信的测试（注释里承认没测到晚到），
  把它改诚实之后，测试立刻变红，缺陷才暴露。
- **变异检验**：14 个变异跨 5 个源文件，全部被捕获。
  其中 `dryRun-uses-stale-snapshot` 第一次未被捕获（被 `recheck` 掩盖），
  按 ADR-0013 补充规则另设"并发提交"探针后才捕获。

### P3 解释层结论（唯一需要 LLM 的环节的契约）

- **交付物**：`po06/lib/interpreter.js`、`po06/test/interpreter.test.mjs`（18 项）。
- EV-0031：`extractJson` 容错、闸门（kind/op 白名单、条目数上限、超长截断）、
  **逐字引文校验**全部成立；**18 项全部是离线契约检查**。
- **ADR-0017（核心机制）**：`user_requirement` 必须带 `quote`，且必须是用户原话的**字面子串**；
  对不上则整份输出被拒。这把"机器替用户发明要求"从信任问题变成**字符串比对问题**。
  与 reducer 的来源身份检查构成**双层防线**。
  **边界**：它只挡"凭空发明"，挡不住"把'真实、帅气'解释得过宽"——后者靠 ADR-0009/0016 与成品实验。
- 变异检验：12 个变异跨 4 个源文件，**全部被捕获**，源文件字节还原。

### P3 上半结论（编译层）

- **交付物**：`po06/lib/compiler.js`、`po06/test/compiler.test.mjs`（16 项）。
- EV-0029：六节标签化渲染；`明确要求` 节**只含 human 来源**条目；每条带来源；空节不出现；
  无条目则编译为空文本（静默待命）；已撤销条目不渲染；超预算按固定顺序丢弃并写明；
  **必保节永不被丢弃**；审计能抓冒充与缺来源。
- **ADR-0016（核心）**：意图包按**来源身份**分节——质量展开有地方放（「质量解释…不是新增命令」节），
  且不会被读成用户命令。**"主动质量展开"与"不违背本意"由此在结构上同时成立**，
  不再依赖措辞上的自由裁量。
- EV-0030：变异检验抓出**我自己的弱测试**——"人类来源"检查从未被真正验证
  （探针条目被另一条检查兜住）。已改用不会被兜住的探针并加反向断言；现 8/8 变异被捕获。
  规则补进 ADR-0013：**每条检查都要有一个"只能由它触发"的探针用例**。
- **未验证**：工作模型会不会**无视**这些标签（把"质量解释"仍当硬约束）——只能由成品实验回答。

### P2 收尾结论（持久化与恢复）

- EV-0026（PASS，自建会话 `session-po06-p2-proj-mu90zuf2`）：
  在线 checkpoint `{ver:1,seq:5,revision:3}`；磁盘缓存**含本插件键**；
  `restore()` 重建出 `revision=3` 且 **`itemsMatch:true`**（条目逐字段一致）；刷新 24 个单元行。
- **两个接口事实**：`restore().snapshot.values[key]` 是 **wire 视图**，完整状态在 `checkpoint[key].val`；
  **磁盘缓存滞后**（`seq:2` vs 在线 `seq:5`），由"checkpoint + 前向重放日志尾部"补齐，不是缺陷。
- EV-0027：`apply` **短路比实测 0.999**（2097 次调用 / 2094 次短路）。次数多但每次极廉价——
  ADR-0011 的约束正是"次数多"能被接受的前提。
- **EV-0028 / ADR-0015（本轮抓到的最重要缺陷）**：宿主 `register()` **不校验 `stateSchema`**，
  而 `restore()` 会调用 `def.stateSchema.parse()`（不在 try/catch 内）。
  首版投影**没写 `stateSchema`**，于是注册/提交/读取全绿、**只有恢复时才抛 TypeError**。
  已补上，并新增结构回归测试 + 变异项，确保该断言会变红。
  教训固化为规则：**只在恢复/重启时才走的代码路径，必须有独立验收。**
- **仍未验证**：宿主**启动时**的 hydrate 接线（需真重启，会中断用户会话）——已登记，不得当作已通过。
  新增测试：`po06/test/projection.test.mjs`（9 项）；变异项扩到 5 个、跨两个文件。
- **C 臂尚未接进真实宿主**：`pipeline.js` 目前只在离线桩上验证过；
  真实接线（`interpret` 接 LLM、状态走宿主投影、`setIntentText` 进 `systemPrompt.context`）
  属 P3 对照实验的一部分，**未做**。变量：`po06/lib/index.js` 里的适配器已具备所需方法。

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

**P3 只剩一件事：真实基线对照——它消耗模型预算与时间，开工前需要用户确认时机。**
在本轮及此后，除非用户明确同意开跑，**不要自行发起**。
准备就绪后的执行顺序（用户同意后）：
1. 建 `exp/po06/bench/D-01/`；按 `EVAL-REGISTRY.md` 冻结模型/参数/预算。
2. 跑 **A 臂**（插件关闭）与 **D 臂**（当前 0.5.x，代码身份 `5261a575…`）：同题产出成品，存文件 + sha256。
3. 记录每次调用数、token、耗时（写进 `EVAL-REGISTRY.md` 的 attempt 台账）。
4. 用 §18.6 的 0-4 分锚点做**盲评**（隐藏版本标签），给出首份对照结论。
在此之前若仍要做无预算的工作：可先写 C 臂的**接线**（解释层 → reducer → 编译器 → 动态上下文），
并用假解释结果做端到端离线联调。

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
