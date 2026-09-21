# 0.6 发布检查表（RELEASE-CHECKLIST）

> 用途：**没有全部通过，就不发版**。每条都必须附证据（命令输出 / 文件 / 哈希），
> 不接受"应该没问题"。当前状态：**未发布**（绝大多数条目尚未满足）。

## A. 工程硬门（可程序验证）

| # | 条件 | 状态 | 证据 |
|---|---|---|---|
| A1 | 全部单测通过 | ✅ 满足 | **40 套 / 543 项**（`check-release.mjs` 全量复核） |
| A2 | 变异检验全部被捕获、源文件字节还原 | ✅ 满足 | **214 个变异 / 38 个源文件**（装配闸门 6（含 BOM 假阴性 1） + 判定保质期 3、预算闸门 5+花费闸门 4+**编排 4**、留出集判据 3+3、迁移保留 2、共存 3、**成本依据 7**、**生产接线 8**、**宿主资源定位 5 + 静态守卫 1 + 文档检查器 2**） |
| A3 | 真机验证器对已知样本判对 | ✅ 满足 | **12 项**（好/坏×2/可疑/缺失 + 采样不早退 + 不泄漏 + GL 计数不变量 + 外部依赖可观测 + 全套件零残留） |
| A4 | 交付门真实链路通过（L0 不发送 / L1 不唤醒） | ✅ 满足 | EV-0044 |
| A5 | 跨会话不泄漏 | ✅ 满足 | EV-0033（另一会话装配 0 字符） |
| A6 | 重启后状态恢复 | ✅ **满足（真机）** | **EV-0081 修复后**：隔离 home、**两个独立进程**、真实模型。新进程 trace = `recordInput→advanceTurn→interpret→parse→clarify→setContext`——**没有 `init`**，revision **4 → 6** 续上；状态存在插件自己的 `po06-state/<sid>.json`。修复前此门**根本过不去**，因为会话读不出来（见 A16） |
| A7 | 真实多轮 / fork 行为 | 🟡 **多轮✅（真机）；fork 已实现＋单测✅，真机未验** | **多轮（EV-0085）**：SDK JSON-RPC 通路在一个长驻进程里连发两轮——第 1 轮 `committed`（包 406 / rev 4 / items 4 / 首步 `init`），第 2 轮 `committed`（包 **548** / rev **7** / items **6** / 首步 **`recordInput` 无 `init`**）⇒ 状态跨轮延续并增长；会话日志 seq 映射显示**第 2 轮 step1 的装配快照带包**，内容是**第 1 轮**的包 ⇒ 第 2 轮模型确实看到了第 1 轮的要求。"零延迟"由此精确化为：**包永远落后一步**（同轮第 2 步起；跨轮下一轮可见；单步轮次等到下一轮）。**fork（EV-0091 / ADR-0039）**：宿主分叉给**新 sessionId**（`SessionHeader.parentSession`），而状态按 id 存 ⇒ 不处理会**静默丢失累积约束**；已实现继承（深拷贝 / 改写归属 / 留出处，仅在首次触达且自身无状态时）。**单测 20/20 含别名反例；3 个变异守住浅拷贝/归属/出处**。⚠ **真机分叉未验**；⚠ 含 fork 的 web 端到端亦未验 |
| A8 | 配置迁移在真实文件上执行过 | ⛔ **未执行（且现在不应执行）** | **只读 dry-run 已做**（EV-0062，`scripts/migrate-report.mjs`）：逐字节证明未写、未建备份；**8 项需你决定**。**ADR-0036 已实现**（EV-0064）：迁移不再删除旧键，真实配置上 `lostTopLevel` 由 **6 → `[]`**。规则就绪，但**"要不要真写"仍需你明确同意**；旧插件仍在装时写配置属高危动作 |
| A9 | 包 / UI / 模板 / schema / 装配入口版本一致 | ✅ 满足 | `npm pack` 实测：`dsh-external-dsh-po06-0.6.0-beta.6.tgz`（**149.1 KB / 35 个文件**，sha256 `1c183b6cd129d02289cc669af6ba63eee7869d89b4f96ac5acafbac3009d0471`）；包内容 = `files` 清单（**30 个 lib**（含 P9 的 `settings.js`/`control-api.js`/`client.js`）+ `package.json` + `README.md` + bundle 层 + 封存题集）；版本三处一致（`package.json` = README = git tag `v0.6.0-beta.6`，由 `check-release` 的版本检查兜住）。⚠ **仍为 `private:true`**（`npm publish` 会被拒）——这是**故意**的：只发 GitHub Release 附件，避免把未经效果验证的包误发上公共注册表 |
| A10 | 灰度与装配接线 | ✅ 满足（判定带保质期） | `po06/lib/assembly-gate.js` 接在 `systemPrompt.context` 上；**EV-0054 真实宿主两侧对照 PASS**。判定带 **TTL**：首版是永久缓存，会让守卫只"对过一次"——旧插件运行时被注入时不再撤销（EV-0061/ADR-0035）。⚠ 由**真实配置文件**驱动的端到端仍缺（写 `~/.dsh/prompt-optimizer.json` 需你同意）；⚠ **没有装配变化信号接到 `invalidate()`**，撤销最坏等一个 TTL |
| A11 | 卸载后无残留 | ✅ 满足 | **两条链路都验过**：① `scripts/install-drill.mjs`（包内容/仓库外 import/源树字节，EV-0056）；② `scripts/npm-drill.mjs`（**真实 npm 安装/卸载**，EV-0057）——装得上（**未装 cordis 也可** ⇒ peer 确实 optional）、版本一致、另起进程可 import（**且坏件确实 import 失败**）、卸载后 `node_modules` 与 `package.json` **零残留** |
| A12 | 双重拦截守卫接入装配流程 | ✅ 满足 | 本机旧插件 tri-state=`true`（运行时证据"存在动态上下文 prompt-optimizer:capability（342 字符）"）⇒ 判定 `DOUBLE_INTERCEPT` ⇒ 装配贡献 **0 字符**（EV-0054） |
| A13 | **"验证跑的是哪一份代码"可复核** | ✅ 满足 | 每份报告带 `moduleUrl`。此前只有 adapter 报告有，导致无法判断"这次 apply 跑的是哪份代码"——**实测确实遇到注入新产物却 apply 了旧缓存实例**（EV-0056；现象已记录、**根因未查明**） |
| A14 | **能通过标准通道被装配**（`dsh plugin add` + `bundles`） | ✅ 满足 | 原先**缺 `dsh.bundle`**：`dsh plugin add` 打印 "declares no dsh.bundle — installed as a plain dependency, **not a profile layer**" ⇒ **装上但永远不会生效**（EV-0066）。已补 `cordis.patch.yml` + `dsh.bundle.patch` 并入 `files`；重装后警告消失、`bundles` 自动收录、`--dump-config` 出现 `- id: dsh-po06` 且无 duplicate/not found。**已在第二个 profile（隔离 home 的 `headless`）复现**（EV-0078） |
| A15 | **生产可达性**：每条用户可见能力都有**生产侧调用点**或**真实会话投递证据** | ✅ **满足（headless 真机全链）**；⚠ **web 端到端未验** | **EV-0078（缺口）→ EV-0079（接线）→ EV-0080（跑通）→ EV-0083（web 装配核验）**。headless 真机（隔离 home、真实模型）：台账 `outcome:committed`、`packetChars:327`、trace 走满 `init→…→setContext`；会话日志宿主快照 **485→814 字符**、`source.sections` 含 `prompt-optimizer:intent`；包逐条引用用户原话并把拿不准的事标成**未决项**。**web profile 装配已核验**（`moduleUrl` = web 那份；`profile={name:'web',source:'argv'}`；`stateStore` 已接；`productionTrigger.ok:true`；verdict `ACTIVE`）。⚠ **但"web 里真的把包送进模型历史"仍无证据**：web 接口是 WebSocket/Typert（非 REST），P8b 探针需要 live agent 而刚启动的实例没有 |
| A16 | **不得损坏会话日志**：0.6 跑过的会话必须仍能被宿主打开/续跑 | ✅ **满足（真机）** | **EV-0081（缺陷）→ 同轮修复。** 根因：状态被当作自定义会话事件追加，而该事件**没有 `ignorable` 标记** ⇒ 宿主"拒绝重建整个会话"。查证三条：① `Session.append` 的信封只收 `sourceEventSeqs`/`surfaceOp`，**插件无法置 `ignorable`**；② 事件类型表是**构建期静态**的，第三方无法注册；③ 投影缓存按宿主契约"**never authoritative, only a fold shortcut**"，不是持久化机制 ⇒ **状态必须由插件自己拥有**。修法：新增 `po06/lib/store.js`（`<DSH_HOME>/po06-state/`，原子替换，会话 id 消毒防穿越），`commitPatch` 加 `persist` 出口，`land()` 是唯一落盘出口。真机验证：**`--session-id` 无错**（修复前 `refusing to interpret the log`），且会话日志**零 append**。⚠ `po06-state` 尚无淘汰策略（`keep` 字段未实现） |
| A18 | **发出去的包 == tag 里那份代码**（逐字节，可重跑） | ✅ 满足 | `scripts/verify-artifact.mjs --tag <tag> --tgz <path>`（EV-0133）：成员集合 == tag 内 `files` 声明、逐成员与 `git show <ref>:…` 字节相同、版本四处一致、checklist 登记的 sha256（完整/缩写）与实物一致。**beta.4 实测 PASS**（32 成员 / 27 lib / 比对 32 全同）。⚠ 未接进 `check-release`（门禁跑在打包**之前**，而它核对的是**已发出**的文件）⇒ 它是发版步骤里的**人工命令**，写在下面的打包步骤里 |

> **隔离验证配方（EV-0066 + EV-0069：**启动已实测通过**）**：
> ```powershell
> $env:DSH_HOME = 'C:\Users\WestFox\.dsh-po06-iso'      # 独立 home：profile/配置/会话全分开
> dsh plugin --profile web add <po06.tgz>               # 装 0.6（dsh 会自动写进 bundles）
> # 再在 <home>\prompt-optimizer.json 写 {settingsVersion:1, enabled:true, rollout:{mode:'all'}}
> dsh --profile web --port 0 --no-open                  # --port 0 = 让 OS 挑空闲端口，不抢 3080
> ```
> 实测：启动成功；HTTP **200**、29,427 字节、含 `__DSH_BOOT__`；0.6 从**隔离 home** 加载；
> 闸门判 **`enabled: true`（0.6 首次进入 enabled）**；该 profile 里**只有 dsh-po06**（无 0.5.x）。
> 全程未碰日常 home/profile/配置。
> ⚠ 想用 P8b 探针看"默认态是否贡献意图包"，**必须先在那个实例里有一个会话**——
> 新 home 的 `agents.list()` 是空的，探针会报 `no agent to probe`（EV-0069）；
> 读源码确认探针取的是 `agents.list()[0]`，所以**刚启动的实例永远探不到**（EV-0083）。
> ⚠⚠ **每次换 profile 或重建后，必须重新核对"装进去的是哪一份"**：
> `dsh plugin add <同一个 tgz 路径>` 会因 pnpm 缓存复用而**装回旧代码**
> （实测在 web profile 上重演：`profile/stateStore/trigger` 全是 `undefined`、verdict 还是旧串）。
> **每次构建用新路径**，装完先 `Select-String` 一下新代码里的标志串再跑（EV-0079/EV-0083）。

| A17 | 打包产物自足性**进发版门**（不再靠人记得跑） | ✅ 满足 | `check-release` 现在会跑 `install-drill.mjs`（约 1 秒）：tgz 只含 `files` 声明的东西、`eval/` **只允许封存题集**、bundle 层与题集都在、仓库外可 import、源树字节未变。**此前这条演练红了好几轮却没人知道**——没有任何东西会跑它（EV-0110） |

## B. 效果门（**当前全部未满足**）

| # | 条件 | 状态 |
|---|---|---|
| B1 | 留出集冻结且未参与调参 | ✅ 已封存（**v2**） | `HOLDOUT-v2.md` sha256 `509db317…`（**每次运行前自动校验**，不符即拒绝）。v2 = v1 的 18 题**逐字节未改** + 追加 H-19/H-20（ADR-0040，由测试逐题校验）；v1 文件保留以备复核 |
| B2 | E-001 对照运行完成 | 🟡 **S1 跑完 36/36；截至 S1，没有任何一条可信判据显示两臂有差别（EV-0095）** | 用户授权 S1（上界 105,048），**实测 103,368**（run1 42,884 因仪表缺陷白花；run2 49,623 完整；机制实验 10,861）。**可信判据**：36/36 全产出、0 失败；放大 **A0/C0**（不判别）；答案长度相当（14,521 / 13,249 字符）；**完全指定任务（H-07/08/09）的必要内容 A 7/9 · C 7/9（无差别）**；分析可复现（`node po06/scripts/analyze-e001.mjs`）。**⚠ 已撤回**：据"实现细节类问句 A4/C9"称"0.6 让模型多问不该问的事"——该指标不可靠（`classifyQuestion` 单词命中且 impl 优先，标记词含任务名词 `package`；删掉这一个词后 C 臂坏分降 25% 而 A 臂不变），逐条读出的 C 臂问句多为**风险与后果提示**（那是想要的行为）。**⚠ 无效/缺口**：H-11 无工具下不可满足（EV-0093）；"约束守住"无直接仪器。**"该不该问"已由用户判读完成（EV-0105）**：61 条真问句（A 25 / C 36）中两臂**各 0 条**被判"不该问" ⇒ **该判据非区分，在 S1 上作废**（它曾是 0.6 的主要卖点）；9 条重复**全部是臂内重复、跨臂 0 条**；未标记 7/9 条仍计入分母（未标记 ≠ 合格）。⚠ n=3/题、单模型、单次；S2/S3 未跑。**B 臂（0.4.4）仍无实测成本依据** |
| B2b | 「约束守住」判据**有适用题且有仪器**（新增 S4） | ✅ 已就绪（**未跑**） | 留出集 v2 追加 H-19 / H-20（含"引依赖"禁令，ADR-0040）。仪器经**离线**验证：**六种真实违规形态全部判出**（安装命令任意包名 / pip / require / ESM import / Python import / 散文提库名），标准库·相对路径·明确拒绝**零误报**；2 个变异守住"漏检"与"误报"两条路径（EV-0108）。**S4 预算：2 题 / 上界 35,016 / 期望 11,672**（`node po06/scripts/plan-e001.mjs` 可复核）。⚠ **零花费，未在任何模型上跑过**——这只证明"测得动"，**不证明"守得住"** |
| B3 | 存在 B 臂（0.4.4）可复现基线 | ✅ 哈希已冻结 | tag `v0.4.4-beta.1` = `475f0d91…` |
| B4 | 关键类别无明显退化 | ⛔ 无数据 |
| B5 | 严重失败率不恶化 | ⛔ 无数据 |
| B6 | 用户负担（提问/纠正）不增加 | ⛔ 无数据 |
| B7 | 总成本在门槛内 | ⛔ 无数据 |

> 已跑的那次 **A/C n=1** 对照（`exp/po06/bench/D-01/`）**不计入** B2：
> n=1、系统提示词被简化、缺 B/D 臂、无用户评分。

## C. 用户裁决项（只有用户能定）

| # | 条件 | 状态 |
|---|---|---|
| C1 | 用户认可坦克成品质量（A 臂 vs C 臂） | ⛔ **待答** |
| C2 | 用户同意真实迁移执行 | ⛔ **待答** |
| C3 | 用户约定真实提问联调时机 | ⛔ **待答** |
| C4 | 用户同意重启宿主做 hydrate 验证 | ⛔ **待答** |

## D. 发布动作（按顺序，未开始）

1. 版本对齐：`package.json` / 插件内署名 / README / Release tag **同一版本**。
2. 打包并记录产物 sha256；与源码 hash 一起登记。
3. 隔离环境装配 → 验证 host 侧 `apply()`、路由、原文直通。
4. 真实 GUI 刷新验证（**不得**另起服务器冒充当前 GUI）。
5. 灰度：先 `allowlist` 一个会话，跑通再扩大。
6. 回滚演练：装回旧包 → 验证旧会话可读、消息不重复。
7. 发布说明：写明已验证项、**未验证项**、已知限制、回滚方式。
8. **发布前必跑**：`node po06/scripts/check-tag-target.mjs <tag> --remote`。
   判据是"**tag 名里的版本号 == 该 tag 所指提交里 `po06/package.json` 的 version**"——
   挡的是"产物在、名字对、指向却是另一条线"（EV-0150 的实测事故：API 自动建的 tag 落在了 `main`）。
   顺序也固定：**先推 tag，再发 Release**（让 API 用已有 tag，而不是替你造一个）。

### G 段进度（0.6.0-beta.11 → beta.14 · P10 操作面对齐 0.5：引擎两件能力 + 五控件栏）

> 起因：用户实测反馈 **"我不适应 0.6 的操控/检测模式，能不能让 0.6 对上 0.5 的 UI"**（允许改文案与架构，但整体操作类似）。
> 计划与规格：`po06/P10-UI-ALIGN-PLAN.md`、`po06/P10-0.5-UI-SPEC.md`（含 0.5 的 10 条**不要照抄**的缺陷）。

| 步 | 状态 | 证据 |
|---|---|---|
| 1 设置契约 | ✅ | `tier`(推导) / `permission` / `historyMode` / `turns` / `readTools`；定点核对 23/23；EV-0148 |
| 2 会话上下文 | ✅ 已装机 | `session-context.js`：每会话 12 回合、单段 4000 字、旁观者声明、5 级降级**写进注入文本** |
| 3 只读工具 | ✅ 已装机 | `read-tools.js`：read/glob/grep + 根目录词法&realpath 双校验 + 轮次 3/硬顶 6 + 60s + 不静默回落 |
| 4 **断线修复** | ✅ | 真机台账照出 `policyFor` 缺三个字段 ⇒ 上下文与工具**在真机上永不生效**（三个开关是死开关）；已修并经 `readPolicy` 核对 252 字/3 回合；**EV-0149** |
| 5 五控件栏 | ✅ **渲染已验** | 挂 `conversation.input.left`(order 20)：档位 关闭/轻度/标准/重度、权限 审查/自动、上下文 0~10 + 回合/全文、读项目文件、模型选择（+ 行尾 detail 开关）；旧的 dock 胶囊退役 |
| 6 打包与装机 | ✅ | **beta.14** 装进 `web` profile：**33/33 个 lib 逐字节一致**；热重载 `client ✓`；真机 `/status` = `0.6.0-beta.14` |
| 7 **真机 DOM（渲染）** | ✅ | 全新浏览器 profile + 真实页面实测：**16 个 `data-po06` 标记全在**（`bar/tier/tier-*/perm/perm-*/ctx-wrap/ctx/ctx-num/ctx-mode/readtools/model/detail`），**值与后端一致**（`tier=light`(轻度)、`perm=auto`、`ctx=6`、`mode=turns`、`rt=off`），**几何 690×52 @ y=418**（排除"被输入区裁掉/尺寸塌成 0"） |
| 8b **引擎在生产里生效**（真机） | ✅ | 用户正在用的 3080 进程实测 `/po06/api/turns`：`histChars=7066`、`histTurnsRead=4`、`toolsEnabled=false`、`via=plain` —— **上下文真的被注入了**（EV-0149 修好前该值恒为 0）；读文件关着时确实不派工具。`/turns` 现有 12 个 P10 归因字段（`packetOverBudget/OverBy/Budget`、`historyChars/TurnsRead/Available`、`toolsEnabled/Reason/Rounds/Calls/Fallback`、`interpretVia`）。<br>**仍未验**：界面上 `turn-facts` 那一行的**渲染**（数据源已验；浏览器探针因单次吐 568KB 日志、会冲掉执行者上下文，本轮主动跳过） || 8 真机**交互**复验 | 🟡 **一半** | **真机接口往返已验证**：设 `heavy` ⇒ 三项变 `[auto,detailed,generous]`、设 `off` ⇒ `[off,standard,standard]`、设回 `light` ⇒ `[auto,standard,standard]`（与 `TIER_PRESETS` 逐项吻合）；每次写盘 `backup=yes`；**不带写头的 POST 被 403 拒**（跨站写防线在真机有效）；用户设置已还原为 `light`。<br>**仍未验**：「浏览器里点一下 → 真的发出那次 POST」这一段（客户端 78 条载荷断言跑在假 React + 假 fetch 上） |
| 9 浮层按 0.5 形态重排 | ❌ 未做 | 条目/轮次/提示词编辑仍在旧浮层里；`shell.overlay` 仍是占位 |
| 10 发布（beta.14） | ✅ | tag `v0.6.0-beta.14` + Release（tgz + `SHA256SUMS`）；**先推 tag 再发 Release**，落点正确 |
| 11 发布（beta.16，与装机版本对齐） | ✅ | tag `v0.6.0-beta.16` + Release：tgz 189,390 B、sha256 `1ff70cfb9a48e10a3ef81be865591ad32bdd4a2f26f207dc30e98edba555573c`；标记 `prerelease`（第 8 步那半格未验） |
| 12 **tag 落点事故（已修）** | ✅ 修 | 发 beta.16 时我**忘了先建本地 tag** ⇒ GitHub API 自动建的 tag 落在**默认分支 `main`（0.5 那条线）**：强制更新输出为 `+ 634c16b...70f23ee (forced update)`，其中 `634c16b` = `refs/heads/main`。已本地建 annotated tag 并强制覆盖远端，**用 API 复核落点 = `14c6acc`**（beta.16 提交）。<br>**教训**：**永远先推 tag，再发 Release**——否则产物在、名字对、指向却是另一条线（本项目最忌的"看着对、其实是别的"） |
| 13 **要求①：控件栏两层化**（2026-09-21 用户临时要求） | ✅ **真机几何已验** | `bar`(外层, `flexDirection:column`) = **489×50 @ y=419**、`bar-row-1` = 475×22 @ y=419、`bar-row-2` = 489×24 @ y=445、**`stacked: true`**；19 个 `data-po06` 标记齐。判据是**量到的矩形**（一排直线时外层只会 ~22-24px 高），不是"源码里写了 column"。**EV-0151** |
| 14 **要求②：`?` 帮助按钮**（2026-09-21 用户临时要求） | ✅ **真机已验** | 点击真机 `[data-po06="help-btn"]` ⇒ `help-pop` 打开、**2132 字 / 11 节**、`leak:false`（无〔依据〕/无实现者说明）、来源行自报 `…\dsh-po06\HELP-0.6.md（2632 字）`；同时 `GET /po06/api/help` = `source:file / chars:2632 / 11 节`。正文**只有一个真相来源**（包里的 md，客户端不内置副本）。<br>顺带修两处静默分叉：① md 里一条没包在〔依据〕里的实现者注记会被显示 ⇒ 移进实现者区；② 该 md **不在 `files` 白名单**⇒ 真装出来读不到 ⇒ 已加进 `files` + 守卫测试钉住（client-file 14/14、control-api 14/14）。**EV-0151** |
| 15 要求③：每轮结果**复用弹窗**（可看"这一轮改了什么" + 可改） | 🔁 **方案已改** | 原设计（事后查看：`/turns` 透出 `packetText` + `POST /turn-edit` + 手改下一轮生效）由子代理实现时**中途失败、无交付报告**；我已**全部回退**（原因：方案随之改成"发送前审阅"，且未完成代码不入库）。<br>**新方案**见第 17 行：弹窗＝**发送前的审查面**（0.5 形态），编辑后的文本就是本轮注入的包 |
| 16 发布（beta.17 / beta.18） | ❌ **未发** | 两个版本都**只装机、未发 Release**：beta.17（控件栏两层化）装机并真机验过、beta.18（`?` 帮助）装机并真机验过（`/status` = `0.6.0-beta.18`；33/33 lib 与仓库逐字节一致、`HELP-0.6.md` 已随包装进 profile）。<br>**待做**：先推 tag 再发 Release（beta.17 / beta.18），并用 `scripts/check-tag-target.mjs` 复核落点（G 段第 12 行的教训）。 |
| 17 **要求③ + "同轮生效" ＝ P11 前置拦截** | 🟡 **步骤 1 已完并真机验接线** | 用户 2026-09-21 拍板：走 **0.5 的拦截法**（**每条都拦**、**不设超时**、保留手动"跳过"；「关闭」档不拦）；**不预取草稿**（用户否："不读未发送的内容"）；不做中途注入的"即时块"（拦截法已用真解释达成同轮）。<br>0.5 机制逐条行号见 `po06/P11-INTERCEPT-PLAN.md`（捕获阶段 Enter/click、发送按钮 aria-label 白名单、`preventDefault+stopPropagation`、`inputActions` 放行、重复拦截去重、关闭档停用、审查/自动、fail-open 按原文发出、单例闸门）。<br>**唯一新建的轮子 = 宿主按需解释**：`runInterceptInput` + `POST /po06/api/interpret`（复用 `runProductionInput`，台账 `trigger:'intercept'`，只写内存态动态上下文、**不改会话内容**）。**真机验接线（3080）**：空 session ⇒ 400 `session-required`、假 session ⇒ 400 `session-not-found`、缺写头 ⇒ 403——**三次都没碰任何真实会话**；单测 `control-api` **15/15**（无 hook ⇒ 501+处置说明；hook 抛错 ⇒ 500 由 handler 兜住，不冒给连接）。<br>**未做**：客户端拦截本身（监听/去重/单例闸门/浮层审查-自动/放行链路）与"拦下 → POST → 真的发出去"全链真机验证。<br>**代价（写进文档）**：每轮 +21–57 s（真机台账），换来整轮上下文一致 |

> ⚠ **本段未跑的门（必须随发布如实登记）**：全量测试、变异检验、`check-release`、
> **真机 + 真模型的端到端**（"模型是否真去调工具、上下文是否真改善产出"完全没验）。
> 客户端跑过的是：`node --check` + `client-file.test.mjs` 13/13 + 一个临时脚本（迷你 React 真渲染 + 假 fetch，78 条断言，脚本已删）。
> 过程中它抓出一个真问题：**只靠 DOM `disabled` 挡不住程序化事件**，仍会真的写盘 ⇒ 已加处理函数级守卫。

> **两处「0.5 有、0.6 有意不同」**：`readTools` 默认**关**（0.5 默认开，工具轮次要花时间与 token）；
> 工具轮次 **3 / 60s**（0.5 是 5 / 90s，解释层是旁路，不该拖住一轮对话的观感）。

### F 段进度（0.6.0-beta.10 · UI 热修：模型选择 / 提示词编辑与撤销 / 注册自愈）

> 起因是用户实测反馈。**先纠正一个我自己的误判**：上一轮我对外说"重装 + 重启就会好"，
> 实际根因是宿主把"这个包没有客户端"**缓存成了永久结论**（EV-0144）——
> 这属于"说了没有证据支持的话"，记在这里。

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = 根 README = `README.en.md` = `po06/README.md` = **0.6.0-beta.10** |
| 2 打包 + sha256 | ✅ | `dsh-external-dsh-po06-0.6.0-beta.10.tgz`（**153.5 KB / 36 个文件**，sha256 `dc3ab3ce33a8c3d18f9dcbab5e060f9170709f3d65470addae15410688c49e3e`） |
| 3 装配 | ✅ | 用发行版自带安装器 `dsh plugin --profile web add <tgz>` 装入用户日常 profile；**装出来的 `lib/` 与仓库逐文件一致 31/31** |
| 4 真机可用性 | ✅ | 热重载后实测：`/po06/api/status` = **200 / beta.10**、`/po06/api/models` = **35 个模型、0 错误**、`prompt.text` = **1708 字**、客户端 bundle **200**、`client ✓`；真实 Edge DOM：`dock → panel → controls / items / turns / prompt`（EV-0146） |
| 5 灰度 | 🟡 直接 `all` | 同前几段 |
| 6 回滚 | ✅ 可回 | profile 备份 + 依赖可指回上一版 tgz |
| 7 发布说明 | ✅ | 本节 + `po06/UI-HOTFIX.md` + EV-0146/0147；**tag `v0.6.0-beta.10` 已推、GitHub Release 已发布**（含 `tgz` + `SHA256SUMS` 两个附件，公开可下载已复验）：<https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.6.0-beta.10> |

> ⚠ **本段与 D/E 段的关键差别**：**没有重跑 `check-release`**（用户明确要求跳过非必要测试）。
> 因此"543 项测试 / 214 个变异全绿"**只对 beta.9 那棵树成立**，不覆盖 beta.10 的四处改动
> （`model` 接线、`/models` 端点、提示词 `text` + `undo`、`apply` 里的注册自愈）。
> 本段第 2、4 步的数字，就是本轮实际跑过的全部验证。

### E 段进度（0.6.0-beta.9 · P9.5 真机界面落地：注册自愈 + 设置真的生效）

> 本轮起因是用户实测反馈：**"重启后完全没有 UI"**。查出真因不是界面代码坏，而是宿主 `client-modules`
> 把"这个包没有客户端"缓存成了 `NULL` 且**永不复核**（EV-0144）——进程在坏清单那一次启动后，
> 磁盘上再修好也不会注册界面。处置：重打 beta.9 → 逐文件镜像 → **热重载（免重启）** → 定点清缓存重解析。

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = 根 README = `po06/README.md` = 本次 **0.6.0-beta.9** |
| 2 打包 + sha256 | ✅ | `npm pack` ⇒ `dsh-external-dsh-po06-0.6.0-beta.9.tgz`（**152.3 KB / 36 个文件**，sha256 `01f1bc3a5ee2efd429c10c6a072a5cfff68446576c1766bcbed05c256f7819bf`）；**tgz 与仓库 `lib/` 逐文件一致 31/31** |
| 3 隔离装配 | ✅ | profile `web` 的 `node_modules/.../lib` 镜像后 31/31 字节一致；依赖由 beta.8 指向 **beta.9** tgz |
| 4 **真机 UI 可见性** | ✅ **已闭环** | 在用户正在用的 **PID 82276** 内热修后：`clientModules.table`/`graph()` 出现本包；真机 Edge DOM：`dock → panel → controls / items / turns / prompt`，**4 个 `<select>`**（辅助 / 补充程度 / 预算 / 模型）+ 保存提示词 / 恢复内置（EV-0144） |
| 5 灰度 | 🟡 直接 `all` | 用户自己的 profile；`allowlist` 路径仍未在真机灰度过 |
| 6 回滚 | ✅ 可回 | 见 `CHECKPOINT.md`「用户每日 profile 已换成 0.6」；本轮新增备份 `package.json.bak-20260921051954` |
| 7 发布说明 | 🟡 **部分** | 本节 + EV-0144/0145 已写；**`v0.6.0-beta.9` 的 tag / GitHub Release 尚未创建** |

> - 本节**闭环了 D 段（beta.8）第 4 步**那条"⏳ 进行中"的验收（真机可见性）。
> - beta.8 遗留的 ⚠ 三项里，**提示词已接到解释层**（EV-0143）；**模型下拉**与**条目级/包级回退（仍 501）**仍未做。
> - `check-release` 门禁在版本号抬到 beta.9 之后**尚未重跑**（EV-0145 已声明）。

### D 段进度（0.6.0-beta.8 · P9 用户界面第一版·注册修复）

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = 根 README = `po06/README.md` = 本次 tag **0.6.0-beta.8** |
| 2 打包 + sha256 | ✅ | `npm pack` ⇒ `dsh-external-dsh-po06-0.6.0-beta.8.tgz`（**150.0 KB / 35 个文件**，sha256 `2d72c890a05c53aaa28cab70e8523d00930de212481f65b82b90235072606a86`）；`verify-artifact --tag v0.6.0-beta.8` ⇒ **PASS** |
| 3 隔离装配 | ✅ | `check-install --profile web --expect-version 0.6.0-beta.6`（逐文件 sha256 比对） |
| 4 **真机 UI 可见性** | ✅ 见 **E 段**（beta.9 闭环） | ~~要在真实浏览器里确认 `[data-po06=dock\|panel\|settings]` 出现在 DOM~~ → E 段已用真机 Edge DOM 证实 **不接受"应该会出现"** |
| 5 灰度 | 🟡 直接 `all` | 用户自己的 profile；`allowlist` 路径仍未在真机灰度过 |
| 6 回滚 | ✅ 可回 | 见 `CHECKPOINT.md`「用户每日 profile 已换成 0.6」一节（含备份路径与命令） |
| 7 发布说明 | ✅ | 本节 + `po06/P9-UI-PLAN.md` + `po06/README.md` |

> **beta.6 相对 beta.5 的内容**（P9 前三步）：
> ① **P9.1 设置模型**（EV-0138）：`assist/detail/budget/model` + 保守回落 + 原子写 + 备份 + 读回；
> ② **P9.2 控制 API**（EV-0139）：`/po06/api/*`（状态 / 意图与出处 / 轮次 / 写设置 / 回退 / 提示词），
>    自带 Host・Origin・写头三条信任判据（宿主闸门只覆盖 `/api`，插件路由不在其内）；
> ③ **P9.3 客户端面板**（EV-0140）：输入框旁指示器 + 详情/控制浮层 + 设置页；静态守卫 10 项 + 4 个变异体。
> ⚠ **未做**：提示词尚未接到解释层（P9.4）、模型下拉未接模型目录、条目级/包级回退仍返回 501。

### D 段进度（0.6.0-beta.5 · EV-0136 / EV-0137）

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = 根 README = `po06/README.md` = 本次 tag **0.6.0-beta.5** |
| 2 打包 + sha256 | ✅ | `npm pack` ⇒ `dsh-external-dsh-po06-0.6.0-beta.5.tgz`（**135.0 KB / 32 个文件**，sha256 `53536857…6aee9`）；`verify-artifact --tag v0.6.0-beta.5` **PASS** |
| 3 隔离装配 | ✅ | 见下（`check-install --expect-version 0.6.0-beta.5` 逐文件 sha256 比对） |
| 4 **真实 GUI 刷新** | ⛔ **未做** | 需要用户在自己的会话里跑；**不得**另起服务器冒充 |
| 5 灰度 | 🟡 **直接用了 `all`** | 为用户"跑实际项目"而设；`allowlist` 路径有单测但**未在真机灰度过** |
| 6 回滚演练 | 🟡 **部分** | 关掉 = 改/删 `po06.json`（已验解析器行为）；**"装回旧包 + 旧会话可读 + 消息不重复"未演练** |
| 7 发布说明 | ✅ | 本节 + `po06/README.md` 的「未验证」表 |

> **beta.5 相对 beta.4 的内容**（都在 `lib/`，所以必须重新打包）：
> ① **意图包缓存带解释器指纹**（EV-0137）——不再跨配置静默串包、不再覆盖前几轮的包。
>    **这一条直接决定 S4 能不能信**：E-001 由插件内的启动器触发，跑的就是这份代码。
> ② 问句计数改为**高/低置信拆分**（EV-0136）——`answer-audit.js` 的 `questionConfidence/questionBreakdown`；
>    它不在生产路径上，但会随包发行（评估工具是**故意**随包发的：`runE001` 要在装出来的插件里找到题集与工具）。
> ⚠ 真机 GUI 刷新（第 4 步）与回滚演练（第 6 步）**仍未做**。

### D 段进度（0.6.0-beta.4 · EV-0132）

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = 根 README = `po06/README.md` = 本次 tag **0.6.0-beta.4**；门禁会拦"README 里没有当前版本号" |
| 2 打包 + sha256 | ✅ | `npm pack` ⇒ `dsh-external-dsh-po06-0.6.0-beta.4.tgz`（**133.4 KB / 32 个文件**，sha256 `91a74f60…5227d`），落在 `<home>/po06-beta/`。**发布前必跑一次产物核对**（EV-0133）：`node po06/scripts/verify-artifact.mjs --tag v0.6.0-beta.4 --tgz <该 tgz 路径>` ⇒ PASS（32 成员 / 27 lib / 与 tag 逐字节相同 / 登记哈希一致） |
| 3 隔离装配 | ✅ | 隔离 profile `po06beta` 升级装到 beta.4；`check-install.mjs --expect-version 0.6.0-beta.4` 逐文件 sha256 比对通过（见下） |
| 4 **真实 GUI 刷新** | ⛔ **未做** | 需要用户在自己的会话里跑；**不得**另起服务器冒充 |
| 5 灰度 | 🟡 **直接用了 `all`** | 为用户"跑实际项目"而设；`allowlist` 路径有单测但**未在真机灰度过** |
| 6 回滚演练 | 🟡 **部分** | 关掉 = 改/删 `po06.json`（已验解析器行为）；**"装回旧包 + 旧会话可读 + 消息不重复"未演练** |
| 7 发布说明 | ✅ | 本节 + `po06/README.md` 的「未验证」表 + GitHub Release notes |

> **beta.4 相对 beta.3 的内容**（都是**用户可感知**的修复，不是重构）：
> ① **宿主 llm 模块路径不再写死**（EV-0132）——别人的机器上自检的投递步骤**不再必然失败**；
> ② 家目录回退用 `os.homedir()`，不再有写死用户名（EV-0132）；
> ③ 真实浏览器定位覆盖更多安装位置（EV-0124）；
> ④ 配置迁移写入改为**原子 + 读回校验**（EV-0123）；
> ⑤ 自检在"服务此刻不可用"时**如实记一步**而不是崩（EV-0131）；
> ⑥ 陈旧临时目录清扫进发版门（EV-0129）；
> ⑦ **带 BOM 的 `po06.json` 不再被判"读不懂"**（EV-0132，隔离实例实测抓到）——记事本/脚本
> 写出的配置也能正常启用，不再"看起来什么都没发生"。
> ⚠ 真机 GUI 刷新（第 4 步）与回滚演练（第 6 步）**仍未做**——beta.4 依然是"让用户试一次"的包。

### D 段进度（0.6.0-beta.3 · 2026-09-20）

| 步 | 状态 | 证据 |
|---|---|---|
| 1 版本对齐 | ✅ | `package.json` = README = tag **0.6.0-beta.3**（`check-release` 会拦"README 里没有当前版本号"） |
| 2 打包 + sha256 | ✅ | `npm pack` ⇒ `dsh-external-dsh-po06-0.6.0-beta.3.tgz`（**120.6 KB**，30 个文件），落在 `<home>/po06-beta/` |
| 3 隔离装配 | ✅ | 新建 profile `po06beta`（发行版模板）→ `dsh plugin add` ⇒ `--dump-config` 出现 `# == @dsh-external/dsh-po06`；`remove`→`add` 往返也验过（EV-0112） |
| 4 **真实 GUI 刷新** | ⛔ **未做** | 需要用户在自己的会话里跑；**不得**另起服务器冒充 |
| 5 灰度 | 🟡 **直接用了 `all`** | 为用户"跑实际项目"而设；`allowlist` 路径有单测但**未在真机灰度过** |
| 6 回滚演练 | 🟡 **部分** | 关掉 = 改/删 `po06.json`（已验解析器行为）；**"装回旧包 + 旧会话可读 + 消息不重复"未演练** |
| 7 发布说明 | ✅ | 本节 + `po06/README.md` 的「未验证」表 + GitHub Release notes |

> ⚠ **D 段未走完就发的是 beta**：第 4、6 步没做完，所以这个包**不能**当成"可以扩大使用"的版本；
> 它的用途是**让用户在自己的真实项目里试一次**。第 5 步直接跳到 `all` 也是同一个原因——
> 只在一台机器、一个隔离 profile 上，范围清楚。

## E. 当前结论

**仍不满足发布条件。** 工程侧的缺口与效果侧的空白如下（**本节的清单与上表必须一致**——
此前它把已经验过两次的 A11 仍列为缺口，属于台账自相矛盾）：

0. **⚠ 最重要的一条（EV-0078 / ADR-0038）**：**A1–A14 全绿曾经掩盖了"插件在真实会话里什么都不做"。**
   0.6 的意图流水线在生产路径上**不可达**（唯一调用点在自检里，且用桩解释器），
   真实会话实测贡献 **0 字符**。⇒ **"工程侧接近收尾"这句话在 A15 修好之前不成立**；
   **E-001 在 A15 通过前禁止运行**（否则买到的是"C 臂没运行"伪装成的"没有差别"）。

1. **工程上剩余**：**A15 生产可达性（最高优先）**、重启恢复（A6）、真实多轮/fork（A7）、
   真实配置迁移（A8），以及 A9/A10 两个"⚠"标注的部分（`private:true` 未改、
   真实配置文件驱动的端到端未做、装配变化信号未接到 `invalidate()`）。
2. **效果上**：**一次正式对照都没有跑过**——0.6 至今没有任何证据表明它比无插件或 0.4.4 更好。
   `exp/po06/bench/D-01/` 那次 **A/C/D 三臂 + 联网/断网**对照虽已做，
   但 **n=1、单模型、单题、无用户评分**，按 B2 的门槛**不计入**。

> ⚠️ 特别提醒：本项目的测试与变异数量（**543 项单测 + 214 个变异**）**只说明内部一致性**，
> **不说明有用**——EV-0078 就是这句话的实证：它们全绿时，产品在真实会话里一行都没跑。
>
> ⚠️ 另一条同样重要的提醒：这三轮里**修掉的三个仪器缺陷**
> （采样早退 / 进程与磁盘泄漏 / GL 计数参数位次，见 EV-0049/0052/0053）
> 每一个都曾独立地产生**看起来确凿的错误结论**。
> 仪器可信度是结论可信度的前提——ADR-0034。
