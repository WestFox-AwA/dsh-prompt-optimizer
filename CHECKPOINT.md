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

- **P1 进行中**。已完成 P1-1（plugin 来源消息全链路）。剩余：P1-2 动态上下文作用域、
  P1-3 回问通道、P1-4 投影注册与恢复、P1-5 steer/inject 行为、P1-6 compatibility-report 与最薄 DshAdapter。

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
- ADR-0007：投递/验证一律以**持久日志**为准；`agent.inbox.*` 即时读取曾给出假阴性。
- ADR-0008：显式声明 cordis 服务注入；缺失服务必须降级。

## 未完成 / 失败

- **留出集未编写封存**（≥18 题）——必须在 C 臂冻结前完成，否则 P7 不成立。
- **P1 剩余四项**：动态上下文作用域与顺序、回问通道行为、投影注册/恢复/卸载、steer 与 inject(no-wake) 路径。
- **B 臂真实装配未验证**：仅在桩宿主下验证了加载与注册；未在真实 dsh 中跑过 LLM 调用与 UI 拦截。
- **未验证**：0.5.x 退化的具体机理；目前只有用户体验描述 + EV-0008/EV-0011 的结构事实，没有区分候选解释。
- **探针遗留物**：两个测试会话留在磁盘
  （`~/.dsh/sessions/--C-Users-WestFox-.dsh-exp-po06-test-workspace--/session-po06-p1-chain-*`），
  作为可复核证据保留；不需要时可整目录删除。profile patch 中留有一条 probe 的 disabled 条目（注入器写入，防自装配）。

## 下一步第一条具体动作

P1-2：验证**动态上下文的作用域与顺序**——用 `ctx.inject(['systemPrompt'], scope => scope.systemPrompt.context({...}))`
注册一个带 `order` 的贡献，确认它（a）只作用于本会话、(b) 组装顺序符合 `order`、
(c) 卸载后从装配中消失、(d) 无变化时不重复出现在请求里。
需要再注入一个探针（这次必须声明 `export const inject`），得到证据后**立即卸载**。

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
