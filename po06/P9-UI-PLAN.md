# P9 · 用户控制界面（承接主计划 §14「用户交互与运行状态」）

> 起因（2026-09-21，用户实测反馈）：卸载 0.5 装 0.6 后"没有任何 UI"。
> 核查结论：**不是设计上不该有**——主计划 §14.1 明确要求"面向用户的最小界面"，
> 而 P0–P8 九期里没有一期承接它，我也没把它挂到任何一期上 ⇒ **实现漏项**。
> 用户的判断成立：**没有控制面的产品无法被用户掌握**。本文件是补做这一期的计划与验收标准。

## 用户明确要求的五件事（原话归纳，2026-09-21）

1. **控制**：开关、档位（关闭 / 自动辅助 / 补充程度 / 自主操作预算）
2. **了解情况**：它在做什么、当前意图包、条目出处（你说过 / 机器补充 / 无出处）、每轮结果与成本
3. **选择档位与模型**：解释层用哪个 provider/model（现状：只能跟随会话模型）
4. **回退**：关掉、撤销条目、回到上一版意图包
5. **查看/编辑提示词**：解释层提示词现在写死在 `lib/interpreter.js`，改它要改代码重打包

## 硬约束

- **不回退到 0.5**；交付基线停在 0.6。
- 每个子阶段都要有：单元测试 + 变异体（被捕获）+ 可复核的真机证据。
- **界面不得改变"包从第 2 步起生效"这一既定语义**，也不得把内部 schema/phase/hash 堆进主流程（§14.1）。
- 设置项**表达行为**，不用"高级/极端必然更强"的暗示（§14.1）。
- 写设置必须**原子 + 读回校验**（沿用 ADR/EV-0123 的纪律），并在写入前**备份**。
- 客户端的旧实例竞态必须处理（0.5 的 issue #9：slot 按 **id** 去重，重挂前必须先释放；
  HMR 会重新求值插件 ⇒ 需要单例闸门。这两条是 0.5 用真实事故换来的，照抄）。

## 已侦察到的宿主契约（本机实测，2026-09-21）

| 事项 | 结论 |
|---|---|
| 宿主 HTTP 路由 | `ctx.webServer.register({ kind: 'prefix', path, handler: async (req, res) => … })`，挂在 `inject = ['webServer']` 上（0.5 的可用样本：`lib/index.js:3678`） |
| 客户端加载 | 包声明 `dsh.client = { platform: 'web', inject: [...], external?: [...] }`；`dsh-client-modules` 扫描 loader 条目、组合模块图、**自动服务该文件并把注入行写进页面** |
| 客户端文件格式 | `window.__ModuleLoader__.load({ id, factory: (require) => { … } })`，内部 `require("react")`；0.5 的 `lib/client.js`（4536 行、295 KB）是**可读**样本 |
| 插槽注册 | `ctx.slots.inject("<slot>", () => ctx.slots.register({ name: "<slot>", id: "<唯一id>", order }, Component))`，`inject = ['slots', 'locale']` |
| 可用插槽（本机 47 个，摘关键） | `settings.plugins.tab`、`settings.plugin.item`、`settings.section`、`sidebar.right.pane.tab`、`conversation.input.dock`、`conversation.input.overlay`、`conversation.composer.dock`、`shell.overlay`、`conversation.session.header.actions` |
| 设置项渲染 | 宿主自带 settings-plugins 用 `renderSlot("settings.plugins.tab", {}, { only: <row.id> })` ⇒ **每个插件一行、一个 tab** |

## 分期与验收标准

### P9.1 设置模型（host）
把 §14.1 的设置落地，并保持向后兼容：
```json
{ "settingsVersion": 1, "enabled": true, "rollout": { "mode": "all" },
  "assist": "auto",                 // off | auto  —— 关闭 / 自动辅助
  "budget": { "level": "standard" },// minimal | standard | generous —— 自主操作预算
  "detail": { "level": "standard" },// minimal | standard | detailed —— 补充程度
  "model": null }                   // null = 跟随会话；或 { provider, model }
```
**验收**：① 解析器对缺字段/坏字段一律回落保守默认并有单测；② 读写原子 + 读回校验；
③ 旧配置（只有 enabled/rollout）行为不变；④ 变异体：把"回落保守"改成"回落最激进"必须被捕获。

### P9.2 控制 API（host）
`po06/lib/control-api.js`，路由前缀 `/po06/api`：
- `GET /status` → 开关、灰度、设置、版本、当前 profile、提示词来源与版本
- `GET /state?session=<id>` → 当前意图条目（含出处分类）+ 最近一版包全文 + revision
- `GET /turns?limit=n` → 台账里最近 n 轮（结果/包字数/耗时/模型）
- `POST /settings` → 原子写回 + 备份 + 读回校验
- `POST /rollback` → `{kind:'disable'|'item'|'packet'}`
- `GET|POST /prompt` → 读/写解释层提示词覆盖

**验收**：① 每个端点有单测（成功/坏输入/越权字段）；② 写操作必须过"备份 + 读回"；③ 端点在**未授权请求**下不得泄露/写入（与宿主 token 门禁的关系要实测并记录）；④ 变异体：去掉读回校验、去掉备份、接受未知字段 各自被捕获。

### P9.3 客户端面板（client）
`po06/lib/client.js`（module-loader 格式）：
- `settings.plugins.tab` → **控制页**：开关 / 补充程度 / 自主预算 / 解释层模型 / 提示词查看编辑 / 回退
- `sidebar.right.pane.tab` → **实时面板**：当前包、条目与出处、最近轮次与成本、一键回退
- `conversation.input.dock` → **小指示器**：开/关、当前包字数、点开实时面板

**验收**：① `node --check` 通过 + 客户端文件有静态守卫（不得出现 `document.write`、必须带单例闸门与 id 去重防护）；
② 真机 GUI 里**看得见**（截图或 DOM 断言 `[data-po06=...]` 存在）；③ 开/关切换后 `po06.json` 真的变了（读回验证）；
④ 卸载后不得残留 DOM（0.5 的教训：`ctx.effect` 生命周期）。

### P9.4 提示词外置
`SYSTEM_PROMPT` 允许被 `<home>/po06-prompt.md` 覆盖；控制页可查看/编辑/重置；**改动影响解释层输出**，
所以：① 覆盖内容参与包缓存指纹（EV-0137 的 `packetFingerprint` 已经哈希了提示词 ⇒ 自动失效重编译）；
② 改完要在界面上明说"下一轮生效、包缓存会重算"；③ 有单测与变异体。

### P9.5 验证与发布
测试 + 变异全绿；真机 GUI 走一遍五件事；打包 **beta.6**；装到 `web` profile；
`verify-artifact --tag v0.6.0-beta.6` PASS；README/CHECKPOINT 如实更新（含"哪些还没做"）。

## 明确不做（本期）

- 不改"包从第 2 步生效"的语义；不做多轮预览编辑（§14.2 的输入法/竞态那部分留给后续）。
- 不做 0.5 的 PTC/对话式投影选择（0.6 不按形态投影，ADR 已有结论）。
- 不在控制页里暴露内部 schema/phase/hash（§14.1 的明确要求）。
