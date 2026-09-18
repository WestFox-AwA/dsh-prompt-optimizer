# 只读工具路径：协议结论与未解之谜（2026/09/17）

## 已用宿主实验**证实**的协议事实（可复现）

用宿主 `llm.stream` 直接实验（provider=deepseek-official / model=deepseek-flash）：

| 实验 | 结果 |
| --- | --- |
| 带 tools + `messages[0].content` 为**内容块数组** `[{type:'text'}]` | ✅ 接受，模型正常发出 tool-call |
| 带 tools + `content` 为**纯字符串** | ❌ `DeepSeek Messages transport failed`（TRANSPORT） |
| 第 2 轮把工具结果放进**独立 `role:'tool'` 消息** | ❌ `DeepSeek Messages history ends with unresolved tools` |
| 第 2 轮把工具结果放进**紧随 assistant 的 `role:'user'` 消息**（content 含 `tool-result` 块） | ✅ 接受，模型给出结论（实测答出 `package.json` 的 version = `0.4.6-beta.1`） |
| 复刻插件形状：**长 system + 3 工具 + 长 user** | ✅ 接受（2 次 tool-call） |
| 长 system + 无工具 + 长 user | ✅ 接受（5257 字产出） |

**结论 1**：provider 要的是 **Anthropic Messages 风格**——assistant 带 `tool-call` 块 → 紧跟一条 **user** 消息携带 `tool-result` 块。
插件里的 `toolResultMessages()` 恰好就是这个形态（`role:'user'` + `tool-result`）✓，**无需修改**。

**结论 2**：插件当前工具路径失败（`toolLoopError: messages[0].content: invalid type: sequence, expected a string`，400 INVALID_REQUEST，`toolLoopRounds=1`、`toolCalls=0`）
**无法用等价请求从宿主复现**（上表最后两行都成功）。⇒ 差异在**插件自身那条调用路径**的请求构造里，而不是协议或 provider。

## 下一步的精确诊断动作（下次接手从这里开始）

1. 在 `executeLiveRun` 的工具分支里，把**实际发给模型的 messages 形状**（条数、每条 role 与 content 类型、system 长度、tools 数量）写进 `run.toolLoopDebug`，并从 `/runs` 读出；
2. 若形状与复刻实验一致而仍 400，则继续二分：把 `relayMessage()` 的**历史块**替换为空块、把 system 换成短串，逐个排除；
3. 修复通过后，判据是 **`verify-readtools.cjs` 的 ON 组：toolCalls > 0 且产出中出现真实项目事实**（例如它读到的真实文件内容）。

## 当前安全状态

- 开关 `readTools` **默认关闭**；
- 即使打开，工具路径拿不到产出会**降级回正常路径**（实测 ON → 正常产出 3930 字），**不会给空结果**；
- `/runs` 已暴露诊断字段：`readTools / toolCalls / toolNames / toolLoopError / toolLoopRounds / toolLoopTrace`。

## 进度（用户要求的三步）

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 修通工具路径 | 🟡 **协议层已查清并证实**；插件侧 400 的真凶已缩小到"本路径的请求构造"，尚未定位/修复 |
| 2 | 上下文观察者视角（回合=最近 10 回合双方全文；全文=会话 AI 当前上下文） | ⬜ 未开始（仅有结构入口 `buildSystem({observerBlock})`） |
| 3 | 溢出与压缩（预算→分级压缩→在产出里声明压缩了什么） | ⬜ 未开始 |
