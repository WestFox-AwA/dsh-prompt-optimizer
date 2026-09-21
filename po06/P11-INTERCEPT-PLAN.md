# P11 · 前置拦截（"第一轮发，第一轮就回"）——直接照搬 0.5 的机制

> 用户决定（2026-09-21，原话）：
> **"我觉得几十秒的等待是有意义的，即 0.6 以前一直使用的『拦截法』，只要能够实际提升模型能力效果和稳定性，
> 多几十秒毫无怨言（因为正常工作一轮，模型都是二三十分钟的水准，几十秒只占 3% 左右）"**
> **"不设超时。但你应该知道『自动/审查』对此是有作用的。你可以前往 0.5.x 的插件中学习，
> 它拥有极其完备、闭环的拦截法机制和相关 UI，你完全可以直接抄过来，不必重新造轮子。"**
> **"不接受预取（不读未发送的内容）"**；拦截范围 = **每条都拦**（除「关闭」档）。

## 0. 为什么必须改（现状的机制，已查实）

| 事实 | 证据 |
|---|---|
| 触发**不等待**：用户消息一来就 `defer` 跑解释层，注释写着"零延迟…包从**第 2 步**起生效；单步任务无包（明知的取舍，非缺陷）" | `lib/index.js:1133-1135`（旧行号）/ 触发处注释 |
| 投递 = **动态 system 上下文**，每次模型调用装配时**现读** `intentBySession.get(sid)` | `lib/index.js:811-830`（`systemPrompt.context({ text: (assemblyCtx) => … })`） |
| 包由 **pipeline** 写入：`adapter.setIntentText(session.id, packet.text)` | `lib/pipeline.js:145`（清空在 `:140`） |
| 解释层实测耗时 **21–57 秒** | 真机 `/po06/api/turns`：`ms=21286 / 37502 / 38802 / 56913` |

⇒ 单步回合 = 包只能在**下一次模型调用**（= 下一轮）被读到 = **用户说的"一轮延迟"**；
多步回合 = 同轮中途才到（本轮对话就是实例：包里有本轮消息的要求，说明它是中途到的）。

**关键澄清（机制层面）**：动态上下文**只在每次模型调用装配时读一次**，所以中途注入**不会打断**正在生成的那一次调用；
它造成的是**同一轮内前后不一致**（前几步没包、后面突然有包）。拦截法把这不一致**根治**。

## 1. 0.5 的机制（照抄对象，逐条给行号）

来源：`C:\Users\WestFox\.dsh\po05-src\lib\client.js`（main 分支 = 0.5.2 线，302 KB）。

| # | 部件 | 0.5 的做法 | 行号 |
|---|---|---|---|
| 1 | **拦截点** | `window` 上的**捕获阶段**监听（早于 React 根容器与编辑器自身处理器）：`keydown`（Enter）+ `click` | `3095`、`3121`、`3152` |
| 2 | **判据（唯一真源）** | `interceptKey(e)` / `interceptClick(e)`：读**此刻编辑器里真实存在的字**（React 快照会滞后），命中发送按钮才接管 | `539-564`、`458-465` |
| 3 | **发送按钮识别** | 按 `aria-label` 白名单（`SEND_LABELS`，从 locale 服务取）+ "卡片里最后一个按钮"兜底；`isSendLabel()` | `483-515` |
| 4 | **接管动作** | `preventDefault()` + `stopPropagation()` ⇒ 消息**不进宿主**；记一行 `intercepts` | `3121-3163` |
| 5 | **跑优化** | `interceptAndOptimize(text)`：按档位/权限决定"自动提交"还是"转审查态" | `1234-1290` |
| 6 | **放行** | `store.latest.actions.submit()`（`inputActions`）+ 需要时先 `setDraft(优化后的文本)` | `1285`、`1616`、`1708` |
| 7 | **原文还原** | 拦截发生在发送前，草稿通常还在；被清空则**显式写回**原文 | `1203` |
| 8 | **自动 / 审查** | `review` = 不自动发送，产出放进可编辑 textarea，点「确认提交」才发；`auto` = 完成即发，**出错/空产出也 fail-open 按原文发出** | `P10-0.5-UI-SPEC.md §5` |
| 9 | **去重** | 同一次发送可能同时命中 Enter 与 click ⇒ `coalesced` 标记，计数不双算 | `443-453` |
| 10 | **关闭档** | 档位=关闭 ⇒ 权限段禁用**且拦截停用**（完全走原生发送） | `2316` |
| 11 | **单例闸门** | 只有持 token 的实例有权拦截与渲染（否则旧实例"后台跑、无 UI"） | `16-17`、`3000` |
| 12 | **闭环 UI** | 浮层：状态行（含耗时）/ 产出（可编辑）/ 底栏五变体（`foot-review` `‹ 回退`+`确认提交`+`重新生成`；`foot-error` `重试`+`按原文发出`）/ 关闭后 46px 悬浮球 | `P10-0.5-UI-SPEC.md §3` |

**我们能拿到 `inputActions`**（这是 0.5 放行的前提，必须确认过）：
`conversation.input.left` 是 `scope: 'session'` 的 list 槽 ⇒ 宿主按 `SessionStandardProps` 注入
`useConversation` / `useInput` / **`inputActions`**（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:204-255`）。
宿主渲染处传 `{}` 只是**额外** props（`lib/client.js:16260`），标准 props 由槽机制注入 —— 0.5 正是这么用的（`client.js:1003`）。

## 2. 0.6 要新建的那一个轮子（其余全部照抄）

0.5 的解释层跑在**客户端**（拦截后本地发起），所以它自己就能"先解释、后发送"。
0.6 的解释层在**宿主**（`pipeline` → `adapter.setIntentText`），而且现在**只由 `session/event` 触发**——
消息被拦下 ⇒ 宿主根本不知道有这条消息 ⇒ **必须新增"按需解释"入口**。这是唯一的新轮子：

```
客户端拦下发送
  → POST /po06/api/interpret {sessionId, text}      （新端点；要写头 x-po06）
     → index.js: runInterceptInput(sessionId, text)  （新函数）
        → 复用 runProductionInput(ctx, session, {text}, {trigger:'intercept'})
           ⇒ 该函数已含：档位/闸门判定 → 上下文 → 解释层 → 编译 → pipeline 写 setIntentText
     → 返回 {ok, packet, chars, ms, reason}
  → 包已在动态上下文里 ⇒ 放行消息（inputActions.submit()）
  → 宿主开始这一轮 ⇒ **第一个模型调用就带包**
```

失败/无包一律 **fail-open**：客户端按**原文**放行，并在界面明说（不设超时、不静默卡住）。

## 3. 分步（每步都可独立验收）

| 步 | 内容 | 验收判据 |
|---|---|---|
| **1 宿主按需解释** | `interpretNow(sessionId, text)` + `POST /interpret`（含无 hook 时如实 501） | 单测：成功返回包、无 session 400、无 hook 501、异常不抛；台账出现 `trigger:'intercept'` |
| **2 真机验证端点** | 对真机 3080 打一次 `POST /interpret`（用**用户已有会话**的 id） | 返回 `chars>0`，且**下一轮**装配能读到（`/api/status` + 台账可查）；**不改变会话内容**（只是把包写进内存态） |
| **3 客户端拦截** | 捕获阶段 Enter/click + 判据 + 去重 + 单例闸门 + 关闭档停用 | 真机 DOM 探针：拦截计数 +1、消息**未落库**、浮层出现；关闭档时**不拦** |
| **4 放行与 fail-open** | `setDraft` + `submit`；失败/无包按原文发出 | 真机：从"拦下"到"消息真的发出去"的**点击→POST→落库**全链（这正是此前一直没验的那一格） |
| **5 审查 / 自动 + 弹窗**（= 要求③） | 产出可编辑 textarea + 底栏（确认提交 / 按原文发出 / 重新生成 / 跳过）；**编辑后的文本就是本轮注入的包** | 真机：改一行→确认提交→本轮包里就是改后的文本（台账/上下文可查） |
| **6 文案与文档** | `HELP-0.6.md` 第 1/3 节改写（删掉"下一轮生效"、写清"拦截 + 可跳过 + 审查/自动"）；README 同步 | doc 守卫测试 + 人读 |

## 4. 必须写进文档的两条"代价"

1. **每轮多等 21–57 秒**（实测值），换来"整轮上下文一致"；「关闭」档 = 0 等待（不拦）。
2. **解释层失败/无包 ⇒ 按原文发出**（fail-open），界面明示；**永不静默丢消息**。

## 5. 不做的（明确记录）

- ~~打字预取草稿~~（用户否：不读未发送的内容）；
- ~~即时块中途注入~~（拦截法已用真解释达成同轮；中途注入正是用户担心的那种做法）；
- ~~等超时自动放行~~（用户选：不设超时，只保留手动"跳过"）。

---

## 6. 界面复刻（第 6 轮，2026-09-21）：**把 0.5 的浮层整块搬过来**

用户原话：**"当前拦截 UI 依然与 0.5 差距巨大…你完全可以直接把 0.5 的相关 UI 拿过来用，完全没必要重新自己制作"**。
于是本轮**不再手搓面板**：`lib/client.js` 里的手写 `intercept` 面板整个删掉，换成 `InterceptPanel` / `InterceptBall` /
`OvFold` 三个组件（**结构、层级、配色、底栏变体逐块对照 0.5**），动作仍然接 0.6 既有的处理函数
（`confirmHold` / `sendOriginal` / `regenHold` / `skipHold` / `beginHold`）——**拦截判定与放行逻辑一行未动**。

### 6.1 逐块搬运表（行号 = `C:\Users\WestFox\.dsh\po05-src\lib\client.js`，0.5.2 线）

| 0.5 行号 | 0.5 的东西 | 0.6 落在哪 |
|---|---|---|
| 1930-1970 | 浮层外壳：可拖的头 / 滚动体 / **底栏在滚动区之外** / 右下角改尺寸把手 | `InterceptPanel` 的根 + `ovHead`/`ovScroll`/`ovFoot`/`ovGrip` |
| 1940-1945 | 头：标题 + 档位徽标 + 「本会话已拦截 N 次」+「W×H / ↘」 | 头那一节（`intercept-title` / `intercept-tier` / `intercept-count` / `intercept-head-hint`） |
| 1516-1522 | 状态行：`优化中…`/`已完成`/`失败` + 徽标 | `intercept-status`（徽标差异见 6.2①） |
| 1543-1553 | 产出窗（`.dpo-pane` + `.dpo-pane-body`） | 只读包视图 `intercept-packet`（自动档 / 放行之后） |
| 1562-1590 | 审查窗：`以下内容将原样发给工作 AI（可直接编辑） · N 字` + textarea | `intercept-caption` + `intercept-text`（可编辑 textarea） |
| 1487-1501 / 3449-3460 | `disclosure`（`›` 箭头 + 标题 + 摘要 + 展开体） | `OvFold`（原文折叠 `intercept-fold-original`） |
| 1554-1558 | 错误行：`失败：` + 人话，完整原因挂 `title` | `intercept-reason` |
| 1622-1687 | 底栏五变体（foot-review / foot-sent / foot-error / foot-idle / foot-regen） | 底栏四变体（见 6.3） |
| 1797-1835 / 3533-3539 | 46px 悬浮球：档位着色、拖动移动、单击回看 | `InterceptBall`（`intercept-ball`） |
| 1146-1185 | 位置/尺寸夹紧（最小 400×320、不出视口、窗口变化重新夹紧） | `clampOvPos` / `clampOvSize` / `reflow` 那个 resize effect |
| 3259-3272 / 3222-3256 / 3616-3637 | 浮层的 CSS（token、几何、扁平化后的配色） | `S.ov*` 一串内联样式对象 + `OVS` 常量 |
| 293 | `TIER_TONES` 四档色 | `TIER_TONES`（off/light/standard/heavy 逐档对应） |

### 6.2 必须改的三处"真相差异"（不是偷懒，是 0.6 拿不到）

1. **首字 ms / 上下文 N 回合 · M 字 / Σ tok 三个徽标不显示**。0.5 的这三个数来自客户端自己跑的 SSE 流
   （`run.firstPaintMs` / `run.history` / `run.usage`）；0.6 的 `POST /interpret` 只回
   `{packet, chars, ms, unsourced}` ⇒ 显示它们只能靠**编**。改成真实拥有的：优化中「已用 N 秒」、
   完成后总耗时、包字数。**宁可少显示，不拿 0 或估算顶上。**
2. **`‹ 回退` 的语义**。0.5 的 `回退`（1189 `rollbackYes`）= 停止优化 + **不发送** + 原文留在输入框，
   它靠 `run.settled` 挡住还在飞的 SSE 回调（0.5:1694-1702 的注释写得很清楚）。0.6 的 `beginHold`
   回调没有这个标记 ⇒ 在"优化中"清 hold，在飞的响应回来**照样会把消息放行**（用户以为取消了、
   几十秒后消息却发出去）。放行逻辑本轮不许动 ⇒ 优化中**不给回退**；审查态的 `‹ 回退` 落成
   "这一轮不注入优化包、按原文发出"（`sendOriginal`）——这在 0.6 里就是"回到原文"的真实含义：
   **0.6 从不改写用户的原话，能回退的只有包**。
3. **审查文案**。0.5 写"以下内容将**原样发给**工作 AI"是因为它**改写了草稿**；0.6 的包是旁路注入、
   原话照发 ⇒ 文案改成"以下内容将在本轮**原样注入给**工作 AI（可直接编辑）"，并补一行
   "你的原话不会被改写——它按原文发出"。
   **唯一的例外**：0.5 的"没有产出就不留球"（1446）改掉了——只要还挂着一次拦截就留球（标"优化中"），
   否则"收起"之后用户再也看不见"消息还被拦着"（那是吞消息的隐患）。

### 6.3 底栏：0.5 五变体 → 0.6 四阶段

| 阶段 | 变体（`data-po06-foot`） | 按钮 |
|---|---|---|
| `review` | `review` | `‹ 回退`(=`intercept-original`) / `确认提交`(`intercept-confirm`) / `重新生成`(`intercept-regen`) |
| `optimizing` | `idle` | `跳过并直接发送`(`intercept-skip`) |
| `sent` / `skipped` / `failed` | `sent` | `已发送 · 仅供查看` + `关闭`(`intercept-close`) + `重新生成` |
| `error`（**放行失败**，消息还没出去） | `error` | `重试`(`intercept-retry`) / `按原文发出`(`intercept-original`) |
| `failed`（fail-open，消息已按原文出去） | `sent` | 同 `sent`（**不给"重试/按原文发出"**——那会二次发送） |

### 6.4 有意**没有**搬的

- **`run/outcome/trace` 三块**：0.5 的「成了 / 要返工」裁决（1627-1643）、「查证动作」折叠（1106-1141）。
  0.6 没有 runId、也没有工具轨迹 ⇒ 没有真相可依。**不搬。**
- **头里的硬编码版本串**：0.5 的头写死版本；0.6 的版本来自 `/status.version`（显示在「详情」面板）。
  不制造第二份真相 ⇒ 不搬。
- **回归/回滚确认块**（1948-1951 `rollback-confirm`）：它只为 0.5 的"不发送回退"服务（见 6.2②），
  0.6 没有那个动作 ⇒ 不搬。
- **`foot-regen`（重新生成的方向输入框）**（1644-1649 + 1569-1581）：0.6 的 `/interpret` 不接受
  "重跑方向"参数 ⇒ 输入框会是装饰品。不搬（只留 `重新生成` 按钮 = 同原文重跑）。
- **CSS 伪类与关键帧**：`:hover` / `:active` / `@keyframes`（脉冲、微光、球入场）/ 毛玻璃 / 渐变。
  0.6 只用内联样式（不注入 `<style>`）；用 JS 状态模拟 hover 只会更脆 ⇒ 只搬**结构**：
  布局、层级、配色、常驻底栏、可拖头、把手、收成球。

### 6.5 真机可读的锚点（本轮新增，全部在 `data-po06`）

面板根 `intercept`（`data-po06-phase` = 阶段、`data-po06-view=panel`），头：`intercept-head` /
`intercept-state-dot` / `intercept-title` / `intercept-tier` / `intercept-count` / `intercept-head-hint` /
`intercept-collapse`；体：`intercept-scroll` `intercept-run` `intercept-status` `intercept-elapsed`
`intercept-chars` `intercept-via` `intercept-unsourced` `intercept-wait` `intercept-review`
`intercept-caption` **`intercept-text`**（可编辑）/ `intercept-packet`（只读）`intercept-reason`
`intercept-fold-original`（`-head-` / `-body-`）；底栏 `intercept-foot`（`data-po06-foot=sent|review|error|idle`）
`intercept-foot-inner` `intercept-actions` + 按钮 `intercept-original` `intercept-confirm` `intercept-regen`
`intercept-skip` `intercept-retry` `intercept-close` `intercept-sent-tag`；把手 `intercept-grip`；
球 `intercept-ball`（`data-po06-sent` / `data-po06-phase`）+ `intercept-ball-label`。
