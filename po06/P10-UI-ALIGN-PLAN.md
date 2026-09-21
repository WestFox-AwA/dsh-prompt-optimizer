# P10 · 把 0.6 的操作面对齐 0.5（用户实测反馈驱动）

> 起因（用户原话，2026-09-21）：**"能不能让0.6对上0.5的UI呢? 不然我实在是不适应0.6的操控/检测模式。
> 可以改0.5的文本,UI架构,但整体操作应当类似。"**
> 追加决定：**档位按钮文案 = 关闭 / 轻度 / 标准 / 重度（四个档位的预设程度不变）**；
> 范围 = **只对齐操控形态**（检视面保留 0.6 自己的条目 + 轮次台账）；
> 引擎 = **上下文与只读工具两样都补**。

## 0.5 的实测操作面（来源：`dsh-prompt-optimizer-0.5.2-beta.1/package/lib/client.js`）

| 维度 | 0.5 的实现 |
|---|---|
| 挂载点 | `conversation.input.left` + `shell.overlay`（0.6 现在用 `conversation.input.dock`） |
| 档位 | 一根滑杆：关闭 / 普通 / 高级 / 极端（→ 本计划改为 关闭 / 轻度 / 标准 / 重度） |
| 优化权限 | 审查 / 自动 |
| 上下文模式 | 回合（0~10，`CTX_TURNS_MAX = 10`）/ 全文 |
| 读项目文件 | 开 / 关（文案：「已开启：优化 AI 会读项目文件后再写要求」） |
| 执行端 | PTC / 对话式 / 自动（**本计划不做**：0.6 不干预产物形态，搬回来要重新定义语义） |
| 模型 | 会话默认 / 具体模型（另有 reasoningEffort 档） |
| 检视动作 | `/prompt-optimizer/api/{state,beacon,trace,run,run/abort,outcome}`：跑一次 / 中止 / 判定 / 查看证轨迹 |

## 双方向映射（0.5 控件 → 0.6 机制）

| 0.5 控件 | 0.6 现状 | 本计划处置 |
|---|---|---|
| 档位 四档 | 拆在 辅助 / 补充程度 / 自主预算 | **档位是糖**：拨档位 = 一次性写这三项（`TIER_PRESETS`）；`tier` **不落盘**，由三项**推导**（`tierOf`），不构成预设时显示"自定义" |
| 优化权限 审查/自动 | 无 | 新增字段 `permission`；**语义**：`review` = 优化结果先给出处待确认，`auto` = 直接生效（引擎落地在下一步） |
| 上下文模式 回合/全文 | **没有**（解释层拿不到会话上下文） | 新增字段 `historyMode` + `turns`；引擎补"会话上下文" |
| 读项目文件 开/关 | **没有**（解释层无工具） | 新增字段 `readTools`；引擎补"只读工具循环 read/glob/grep + 轮次上限 + trace" |
| 执行端 PTC/对话式/自动 | 无 | **不做**（要重新定义 0.6 语义，等用户明确要求） |
| 模型 | ✅ 已有 | 只改排版为 0.5 形态 |
| run/outcome/trace | 只有条目/轮次/台账/提示词编辑 | **不做**（用户选了"只对齐操控形态"） |

档位预设（"预设程度不变"）：

| 档位 | assist | detail | budget |
|---|---|---|---|
| 关闭 | `off` | standard | standard |
| 轻度 | `auto` | standard | standard |
| 标准 | `auto` | detailed | standard |
| 重度 | `auto` | detailed | generous |

## 引擎：0.6 缺的两件（已核实的事实）

- **上下文**：0.6 现在**没有**。解释层是单次 `llm.stream`，消息里只有「你的原话 + sessionId/messageId + 已知意图条目」
  （`po06/lib/interpreter.js:76-96`），而 `observations` 在生产路径**根本没传**（`po06/lib/index.js:287` 收，调用点没给）。
- **只读工具**：0.6 现在**没有**（无 `tools`、无工具循环）。
- **但宿主支持**：`GenerateOptions.tools?: ToolSchema[]`（`dsh-llm/lib/types/types.d.ts:456`），
  且 0.5 有现成可借鉴的实现：`runToolLoop`（`0.5.2-beta.1/lib/index.js:1905-2020`）——
  轮次上限 `maxRounds`、deadline、收敛判定、`capped` 收敛提示、`trace`、越界探针 `scopeProbe`、
  证据账本 `renderEvidenceLedger`、以及 `executeReadOnlyTool(root, name, args)` 的根目录约束。

## 执行顺序（每步都要能单独验收）

1. **设置契约**（本步已落地）：`tier`(推导) / `permission` / `historyMode` / `turns` / `readTools`
   —— 值域、默认、保守回落、`problems` 如实上报；`describeSettings` 出中文字面。
   验收：定点核对 23 项（档位往返、显式覆盖、非法值回落、未知键仍被报出、custom 不冒充预设）。
2. **会话上下文**：从 `session/event` 累积每会话的回合（用户原话 + 工作 AI 正文/工具次数），
   按 `historyMode`（`turns` 用最近 `turns` 回合 / `full` 与工作 AI 所见一致）拼进解释层 user message。
   验收：回合模式只带最近 N 轮；全文模式带全文；切模式后**下一次**解释即可见差别（台账记 `historyMode/turns`）。
3. **只读工具循环**：`read/glob/grep`（根目录约束 + 越界拒绝）、轮次上限（默认 3）、deadline、
   工具调用与结果进 `trace`，并写入台账（`toolsRounds/toolCalls`）。
   验收：关掉开关时**零工具调用**；打开时能引用项目事实且越界路径被拒；轮次上限真的封顶。
4. **界面换成 0.5 形态**：挂 `conversation.input.left`；档位滑杆（关闭/轻度/标准/重度）+ 优化权限 +
   上下文模式(+回合数) + 读项目文件 + 模型；0.6 的条目/轮次/提示词编辑**收进同一浮层**。
   验收：真机 DOM 出现 `[data-po06='tier']` 等控件；拨档位后 `/status` 的三项确实跟着变；
   刷新页面后设置仍在（落盘）。
5. **打包与发布**：beta.11 → 装进 `web` profile → 真机复验 → tag + Release（沿用 EV-0147 的流程）。

## 进度登记（逐轮更新，只写有证据的事实）

| 步骤 | 状态 | 证据 / 缺口 |
|---|---|---|
| 1 设置契约 | ✅ 完成 | `settings.js` 四字段 + 档位糖 + 自身推导；定点核对 23/23；EV-0148；commit `eda8565`/`0735911` |
| 2 会话上下文 | ✅ 实现并装机 | `session-context.js`（每会话 12 回合 / 单段 4000 字 / 200 会话上限；`renderObserverBlock` 带旁观者声明与 5 级降级标注）；commit `d464b69` |
| 3 只读工具 | ✅ 实现并装机 | `read-tools.js`（read/glob/grep + 根目录词法&realpath 双校验 + 轮次 3/硬顶 6 + 60s 时限 + trace + 不静默回落）；commit `d464b69` |
| 装机 | ✅ | **beta.11** 装进 `web` profile：33/33 lib 逐字节一致；热重载 `client ✓`；真机 `/status` = `0.6.0-beta.11`，新字段 `permission/historyMode/turns/readTools` 全部暴露（commit `be7891c`，**尚未 push：网络不通**） |
| 4 界面换成 0.5 形态 | 🔄 本轮开始 | 规格见 `P10-0.5-UI-SPEC.md`（含逐字文案行号索引） |
| 5 打包/发布 | ⏸ | beta.11 已打包装机；tag + Release 待界面完成后再做（否则又要点两次） |

**独立复验（父 agent 自己撞的断言，不采信子代理自述）**：关掉开关 ⇒ `{enabled:false, reason:'setting-off'}`；
开着但无会话 cwd ⇒ `{enabled:false, reason:'no-session-cwd'}`（0.5 那条"宁可少读"）；
开着且有 cwd ⇒ `{enabled:true, root:<会话 cwd>}`；不传 `context` ⇒ 消息形状不变；传 ⇒ 旁观者块出现；
`createSessionHistory()` 暴露 `observe/setCwd/getCwd/turnsOf/stats/forget`；4 个文件 `node --check` 全过。

**两处默认值变动（用户需知情，未擅自改）**：
- `turns` 默认 **6** ⇒ **默认就会注入最近 6 回合上下文**（这正是"让解释层真的看到上下文"）。要默认静默改 `DEFAULT_SETTINGS.turns = 0` 一行。
- `readTools` 默认 **关**（0.5 默认开）⇒ 开关会给每轮加工具轮次，成本不得悄悄放大。照搬 0.5 改一行。

**最大的证据缺口（如实说，未覆盖）**：生产链路**端到端未验**——`runProductionInput` 有"未导出 + 启用闸门 + `agents` 服务"三重门槛，
定点核对贯通不了，故"接线真的被调用"目前**只有源码静态核对**支撑；真机 + 真模型下"模型是否真去调工具、注入是否真改善产出"完全没验。



## 明确不做 / 已知取舍

- **不做**"执行端 PTC/对话式/自动"与 `run/outcome/trace` 检视面（用户选"只对齐操控形态"）。
- 条目级/包级历史回退**仍未实现**（`/rollback` 的 `item`/`packet` 仍 501）。
- **`readTools` 默认关**（0.5 那边默认开）：开关会给每轮加上工具轮次，时间与 token 都要花，
  计划的不变量是"不得悄悄放大成本/自主权"。要完全照搬 0.5 的默认，改 `DEFAULT_SETTINGS.readTools = true` 一行即可
  ——**这是一处等用户拍板的默认值**，已在代码注释里写明。
- 本阶段**不重跑全量门禁**（用户要求跳过非必要测试）；每步只跑"这一点改动"的定点核对，
  并在 `RELEASE-CHECKLIST.md` 里如实登记"哪些门没跑"。
