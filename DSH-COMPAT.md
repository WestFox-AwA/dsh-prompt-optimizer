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

## 六、升级可行性与操作步骤（2026-09-15 补充实测）

### 6.1 这个版本能装吗？能 —— 但要带 `--prefer-online`

- `0.1.6-alpha.1` 的 launcher 声明 **64 个兄弟依赖**指向 `^0.1.6-alpha.1`，逐一核对 registry：
  **64/64 均已发布** → 发布完整（`evidence/dsh-release-check.cjs`）。
- 但直接 `npm install` 实测报过 `ETARGET: No matching version found for @deepseek-ai/dsh-native-command@^0.1.6-alpha.1`
  —— 而该版本确实存在（registry packument 里有）。这是 npm 本地缓存里的陈旧 packument 造成的解析异常，
  加 **`--prefer-online`** 后同一命令**安装成功**（临时前缀试装通过：`TEMP-INSTALL OK: @deepseek-ai/dsh@0.1.6-alpha.1`）。
  **升级命令必须带这个参数**，否则会以为"版本不存在"。

### 6.2 升级前必须在 DSH 停止时进行（Windows 文件锁）

运行中的 dsh 进程**加载着全局树里的原生模块**（实测 PID 23872）：

```
…\@deepseek-ai\dsh\node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node
…\@deepseek-ai\dsh\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64-0.35.4.node
…\@deepseek-ai\dsh\node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.18.6.dll
…\@deepseek-ai\dsh\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll
```

Windows 下被加载的文件无法替换 → 在线升级会半途失败并留下**混合版本树**。所以流程是：
**退出 DSH → 安装 → 重新启动**。

### 6.3 静态预检结论（在不触碰运行实例的前提下做的）

| 检查 | 方法 | 结果 |
|---|---|---|
| 接口是否还在 | 用 **0.1.6 完整依赖树**跑同一套探针（`dsh-compat2.cjs`） | **风险项 0** |
| 新版本能否启动 | `node <0.1.6>/lib/bin.js --version` | `0.1.6-alpha.1` |
| 本插件还能否被装配 | `node <0.1.6>/lib/bin.js --profile web --dump-config` | 组合结果里仍有 `prompt-optimizer`（以及 super-injector / graded-mode） |
| 客户端半边是否照旧 | 对比两棵树里的 `dsh-client-*` 包 | 47 → 49，`client-modules` / `cordis-client-runner` 在 |

### 6.4 操作步骤（DSH 外面执行）

```powershell
# 1) 退出 DSH：在跑 dsh web 的窗口按 Ctrl+C（或关掉窗口）
# 2) 体检（可选）：确认没有残留 dsh 进程
pwsh -File "$env:USERPROFILE\.dsh\dsh-upgrade.ps1" -Check
# 3) 升级（脚本内含停机检查 + --prefer-online + 安装后核对 profile/junction）
pwsh -File "$env:USERPROFILE\.dsh\dsh-upgrade.ps1"
# 4) 启动
dsh web
# 回滚（如需）：
pwsh -File "$env:USERPROFILE\.dsh\dsh-upgrade.ps1" -Version 0.1.5-rc.1
```

脚本：`~/.dsh/dsh-upgrade.ps1`（不在本仓库内，属本机运维脚本）。

### 6.5 仍未验证

- **没有真的在 0.1.6 运行时下跑过插件**（当前实例仍是 0.1.5-rc.1，无法在不重启的情况下换运行时）。
  以上均为"静态接口 + 组装 + 试装"三级预检；升级重启后需要再做一轮活体验收
  （`apply` beacon 版本、槽位渲染、`range-demo` 自检、历史 `source`、控制台 0 报错）。

## 七、0.1.6-alpha.1 升级后活体验收（2026-09-15，实测）

升级已完成：全局 `@deepseek-ai/dsh@0.1.6-alpha.1`（新进程 14:25 启动）。逐项验收结果：

| 检查项 | 方法 | 结果 |
|---|---|---|
| 插件是否仍被装配 | loader entries | **active**，加载自 `plugins/dsh-prompt-optimizer-0.1.8-beta.1/package/lib/index.js` |
| 宿主 HTTP 路由 | `/state` `/cmd` `/models` | 全部 **200 ok** |
| 客户端半边是否加载 | 客户端 beacon | `apply build=v0.1.8-flat`（14:26:42）、`css-probe rules=3266` |
| 状态恢复链 | beacon 序列 | `overlay-mounted → ui-restored → per-session-restored → tier-change → state-loaded → css-probe → catalog-loaded` 全过 |
| 捕获阶段拦截 | beacon | `keydown-enter`（verdict 按档位判定；档位=off 时为 false 属预期） |
| 控件几何 + 无障碍 | 客户端自检 `range-demo` | **PASS=true**：回合 0/5/10 → 8.5%/49.3%/90.1%，全文 关/开，aria 回合 `max=10`、全文 `max=1`「全文 开」，扁平（无渐变/无阴影/26px）、贴底（行高 26 ≤ 容器 28）、模式钮两态切换正常 |
| 历史读取（deprecated API + 投影层） | `/run` + `/runs` | `turns=2 → source=seed`（`ownEvents` 在 0.1.6 仍可用，读到 10274 事件）/ 2 回合；`turns=10 → source=projection` / 10 回合 / 3183 字；`full → 31 回合 / 59768 字 / 整回合省略 102` |
| 设置往返 | `/state` 读→写回同值→读 | 一致（tier/permission/turns/historyMode/fullOn/perSession=10 个会话；revision 递增） |
| 运行→浮层→放行/回退 全链路 | 客户端自检 `release-race-demo` | **PASS=true**：放行后 submit 增量 1、回退 0、守卫用例 0（`done-after-settle` 有据） |
| 控制台报错 | beacon 扫描 | **0 条** |

### 验收中发现并修掉的两处（新版主题字宽变化引发）

1. **控件胶囊 2px 拥挤**：0.1.6 主题下数字盒变宽（29px），胶囊正好卡在 `min-width:156px`、轨道也到
   `min-width:64px`，已无可收缩空间 → 模式按钮那 2px 负外边距变成"压住数字盒 2px"（文字仍有 7px 右内边距净空，
   无视觉重叠，但余量归零）。修法：`.dpo-cap[data-tone=ctx]` 的 `min-width` 156 → **164**；
   实测变为 **模式钮右余量 0px、与数字盒重叠 0px**，轨道同时从 64 → 71px 更舒展。
2. **自检断言未考虑禁用态**：档位=off 时滑块 `tabIndex` 本就该是 `-1`，旧断言写死要求 `"0"` → 误报。
   改为按 `data-disabled` 取期望值（`-1` / `0`），并把该状态记入 beacon（`disabled` / `wantTab`）。

> 验收时处于**档位=off**（升级前把插件关掉了），所以控件是禁用态；几何 / aria / 交互均照常验证过。
> 想恢复拦截：把档位滑块从「关闭」移到「开启」即可。

## 八、复现（接口核对）

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
