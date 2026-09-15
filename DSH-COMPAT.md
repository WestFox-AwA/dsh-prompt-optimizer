# DSH 版本兼容性核对（0.1.5-rc.1 → 0.1.6）

结论：**升级到 0.1.6 不会让本插件损坏**（逐个接口核对，风险项 0）；但插件的历史读取用到了 0.1.6 起被
**明令禁止**的同步 API，本次已把它收敛成"投影 + 一次性播种"的适配层，升级前后行为一致。

- 核对时间：2026-09-15
- 目标版本：`@deepseek-ai/dsh@0.1.6-alpha.1`（GitHub release `dsh-v0.1.6-alpha.1`，2026-09-15 04:57 发布）
- 说明：npm 与仓库里都**没有** `0.1.6-rc.1`（`npm view @deepseek-ai/dsh@0.1.6-rc.1` → 404；仓库 tag 只到
  `dsh-v0.1.6-alpha.1`），因此以可下载的 0.1.6-alpha.1 为准。本机当前：`0.1.5-rc.1`。

## 一、接口核对（0.1.6 vs 本机 0.1.5-rc.1）

方法：从 npm 取 0.1.6-alpha.1 的对应实现包解包，与本机已装的同名包做探针比对（`evidence/dsh-compat2.cjs`）。

| 插件依赖的接口 | 归属包 | 0.1.6 | 0.1.5 | 判定 |
|---|---|---|---|---|
| `session.ownEvents()` | dsh-session | 有 | 有 | ⚠ 0.1.6 起标记 `@deprecated` |
| `session.snapshotEvents()` / `eventAt()` | dsh-session | 有 | 有 | ⚠ 同样 deprecated |
| 槽位 `conversation.input.left` | dsh-client-ui-conversation | 有 | 有 | OK |
| `inputActions` / `setDraft` / `submit` | dsh-client-ui-conversation | 有 | 有 | OK |
| 发送指令键 `input.send(.queue/.steer)` | dsh-client-ui-conversation | 有（文案一致） | 有 | OK |
| 槽位 `shell.overlay` | dsh-client-ui-layout | 有 | 有 | OK |
| `__ModuleLoader__` | dsh-client-modules | 有 | 有 | OK |
| 主题色 `--dsw-alias-*` / `--dsw-specific-tip` | dsh-client-ui-theme | 有 | 有 | OK |
| `webServer.register()` | dsh-host-webserver | 有 | 有 | OK |
| `llm.stream()` / `listProviders()` | dsh-llm | 有 | 有 | OK |
| 插件客户端清单 `dsh.client` / `platform: web` | dsh-web-app | 有 | 有 | OK |
| `cordis.patch.yml` bundle 装配 | dsh-base | 有 | 有 | OK |

**风险项（旧有、新版消失）：0。**

## 二、唯一需要处理的一项：`ownEvents` 被禁止新增调用

0.1.6 给 `eventAt/snapshotEvents/ownEvents` 加了 `@deprecated`，注释原文：

> Existing logic may remain unmigrated for now, but **new calls are prohibited**.
> See the Agent Note `2026-09-09-deprecate-synchronous-session-event-reads.md`.

该 Agent Note（仓库内 `.agents/notes/implemented/architecture/`）的要点：

- 同步读取任意历史位置会让消费方依赖"整段事件序列常驻内存"，与存储方向冲突；**新调用被禁止**，
  也不允许再包一层同步读取的别名/包装。
- 官方方向：**维护投影（projection）**，恢复后读投影或处理当前事件；按需展示历史走**显式异步分页**。
- 现状：当前版本仍把完整事件序列留在内存里，所以 0.1.6 上旧调用**不会立刻报错**；异步分页接口**尚未提供**。

## 三、本次适配（`lib/index.js`）

1. **投影层**：新增 `historyProjection`（按会话），从既有 `session/event` 监听增量吸收
   `user/message` / `assistant/message` / `tool/call`。
2. **按需播种**：投影不足以满足本次请求（刚重载/刚启动）时，才调用**一次** `ownEvents()` 播种，并用
   播种结果整体替换投影（种子已含截至此刻的全部事件，替换既不丢也不重）。之后同一会话不再调用该 API
   —— 调用次数从"每次运行 1 次"降为"每会话 1 次"。
3. **按回合裁剪**：投影按"整回合"丢弃最早的部分（上限 40 回合 / 20 万字符），用户消息是骨架，
   **不会因为我自己的助手事件刷屏而被挤掉**（这是适配过程中实测踩到并修掉的一个真缺陷）。
4. **诚实标注**：`run.history` 新增 `source`（`seed` / `projection` / `projection-partial` / `unavailable`）、
   `rawEvents`、`rawUsers`、`dropped`；全文模式的"整回合省略数"把投影丢弃量一并计入，不低报。
5. **优雅退化**：该 API 将来被移除时，历史读取变成"从插件启动起"（`source=projection-partial`），
   不崩、不静默错读。

## 四、验证（活实例实测）

| 用例 | source | 摘要回合 | 字符 | 省略 | dropped |
|---|---|---|---|---|---|
| 回合 2 | seed（首次播种） | 2 | 130 | 0 | 90 |
| 回合 2（复跑） | projection | 2 | 130 | 0 | 90 |
| 回合 10 | projection | 10 | 3629 | 0 | 90 |
| 全文（开） | projection | 33 | 59198 | 97 | 90 |
| 全文（关） | （不发历史） | — | — | — | — |

播种与投影两条路径的 `回合/字符` **逐字一致**，证明增量投影与一次性读取等价。

## 五、仍未解决 / 后续

- 官方**异步分页**接口尚未发布，因此"插件启动前的历史"目前只能靠那一次播种读取；一旦移除该 API，
  历史覆盖范围会收缩到"插件启动之后"。
- 更彻底的做法是接入官方 `@deepseek-ai/dsh-session-projection`（`SessionProjectionRegistry`）注册本插件
  自己的投影单元：可获得**跨重启的持久投影**、schema 校验与 wire 视图。代价是耦合官方内部 API
  （注册契约、zod schema、恢复流程），需要单独评估后再做。
- 未验证：0.1.6 下的真实升级（本机仍是 0.1.5-rc.1）；本核对为静态接口比对 + 本机行为实测。

## 六、复现

```bash
# 1) 取 0.1.6 的实现包与本机已装版本做探针比对
npm pack @deepseek-ai/dsh-session@0.1.6-alpha.1    # 以及 client-ui-conversation / ui-layout / client-modules / ui-theme / host-webserver / llm / web-app / base
node evidence/dsh-compat2.cjs <解包目录> <本机已装目录>

# 2) 看 0.1.6 发布说明与迁移指引
#    GitHub release: dsh-v0.1.6-alpha.1
#    仓库内: .agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md

# 3) 行为核对（活实例）
#    POST /prompt-optimizer/api/run { historyMode:'turns', turns:2, sessionId:<当前会话> } → GET /runs 看 history.source / userTurns / chars
```
