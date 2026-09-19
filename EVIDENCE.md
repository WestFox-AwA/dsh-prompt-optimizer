# 证据台账（EVIDENCE）

> 每条证据 = 一个可复核的观察。区分「静态源码 / 集成 / 成品实验 / 人工反馈」。
> 只写实际做过的检查；未做的不写。覆盖范围与限制必须写清楚。

## EV-0001 · 静态 · 定位仓库与工作树状态

- **要支持的结论**：存在正式的 git 源码仓库，且 P0 开始时工作树干净、可安全切分支。
- **方法**：`git remote -v`、`git branch --show-current`、`git status --short`、`git log --oneline -n 8`
- **实际结果**：
  - remote `origin` = `https://github.com/WestFox-AwA/dsh-prompt-optimizer.git`
  - branch = `main`；HEAD = `04a661539cc86080b8e12a6cf453fad9b2d90d3a`；`git describe` = `v0.5.0-beta.1-16-g04a6615`
  - `git status --short` 输出为空（无未提交改动）
  - 仓库 `package.json` 版本 = `0.5.2-beta.1`
- **覆盖范围**：仓库身份与状态。
- **未覆盖**：远端是否与本地同步（未 `git fetch` 比对）。
- **关联**：ADR-0003

## EV-0002 · 静态 + 字节比对 · 0.4.4 基线可复现

- **要支持的结论**：0.4.4 的代码可以从两个独立来源重建且字节一致，可作为对照臂 B。
- **方法**：
  1. `git show v0.4.4-beta.1:lib/index.js` → 取原始字节 → sha256
  2. 解包 `dsh-external-dsh-prompt-optimizer-0.4.4-beta.1.tgz` → 对 `package/lib/index.js` 取 sha256
- **实际结果**：
  - git tag 侧：sha256 `475f0d919a5157192954f9f70879a70ac6d935c8150856823e9ad2d2f6924a63`，152576 bytes
  - tgz 侧：sha256 `475f0d919a5157192954f9f70879a70ac6d935c8150856823e9ad2d2f6924a63`（**完全一致**）
  - tgz 文件本身：223718 bytes，sha256 `df09a43ec91d4dce012b0091194b9f4cf73146109d309a9d5f58ecb19a55891e`
- **覆盖范围**：`lib/index.js` 单文件；`lib/client.js` 与其余文件未逐一比对。
- **未覆盖**：该代码在 dsh `0.1.6-alpha.1` 上能否装配运行（见 EV-0003 待做）。
- **纠错记录**：首次用 PowerShell 重定向 `git show ... > file` 得到的哈希为 `6E51C5B6…`，
  与 tgz 不符。改用 node 直接捕获 git 的原始字节后得到 `475f0d91…`，与 tgz 一致。
  **结论：PowerShell 文本重定向会改变字节（BOM/换行），不得用于二进制比对。**
- **关联**：ADR-0001、baseline-manifest.json → arms.B_044

## EV-0003 · 集成 · 0.4.4 在当前宿主可装配运行

- **状态**：**未执行（待做）**
- **要支持的结论**：B 臂在 dsh `0.1.6-alpha.1` 上可用。
- **计划方法**：从 tag 重建到独立目录 → 装配到隔离 profile 或临时加载 → 确认 host 侧 `apply()` 正常、
  无接口缺失报错、`/prompt-optimizer/api/state` 可访问。
- **为什么必须先做**：若 B 臂跑不起来，"0.6 优于 0.4.4" 的结论无法成立（ADR-0005）。

## EV-0004 · 静态 · 版本化安装目录已被批量覆盖（缺陷 P0-D1）

- **要支持的结论**：本地版本目录不能作为版本存档或 A/B 切换手段。
- **方法**：对四个目录的 `lib/index.js` 取 sha256、字节数与 mtime；与 dev HEAD 比对。
- **实际结果**：
  | 目录 | bytes | sha256 | mtime |
  |---|---|---|---|
  | `dsh-prompt-optimizer-0.4.3-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.4.4-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.5.0-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | `dsh-prompt-optimizer-0.5.2-beta.1/package/lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
  | dev 仓库 `lib/index.js` | 272741 | `5261a575…` | 2026-09-19T21:04:10 |
- **根因定位（静态）**：`evidence/probe.cjs` 第 20–35 行——`readdirSync(base)` 过滤
  `dsh-prompt-optimizer` 前缀目录，随后 `copyFileSync(from, path.join(inst.pkgDir,'lib',f))` 逐文件覆盖。
- **覆盖范围**：`lib/index.js`；各目录 `package.json` 版本字段确实各不相同（0.4.3 / 0.4.4 / 0.5.0 / 0.5.2），
  说明覆盖只发生在 `lib/` 等被同步的文件上。
- **未覆盖**：未逐一检查各目录其它文件（README/CHANGELOG 等）是否也被覆盖。
- **关联**：ADR-0001、ADR-0002

## EV-0005 · 静态 · 运行实例路径与 profile 依赖不一致（缺陷 P0-D2）

- **要支持的结论**：需要显式校验"源码/产物/装配入口/浏览器 bundle"四者一致，否则归因会错位。
- **方法**：`dev_plugin_status` 读 loader entry；读 `~/.dsh/profiles/web/package.json` 依赖；
  读 junction 目标。
- **实际结果**：
  - loader entry = `…/dsh-prompt-optimizer-0.4.3-beta.1/package/lib/index.js`（其 package.json 写 `0.4.3-beta.1`）
  - profile dependency = `file:C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer-0.5.2-beta.1/package`
  - junction 目标 = `C:\Users\WestFox\.dsh\plugins\dsh-prompt-optimizer-0.5.2-beta.1\package`
  - 三者指向的 `lib/index.js` 字节相同（`5261a575…`）→ 行为一致，仅标签矛盾
- **解释（待验证）**：运行中的 dsh 进程在 profile 指向 0.4.3 时启动，之后 profile 被改指 0.5.2 但未重启。
- **未覆盖**：未查 DSH 进程启动时间来证实该解释。
- **关联**：ADR-0001

## EV-0006 · 静态 · 活动配置与真实生效策略

- **要支持的结论**：评估 0.5.x 行为时，必须记录 state 中的 `strategy`，不能按 README 推断。
- **方法**：读 `~/.dsh/prompt-optimizer.json`；对照 `lib/index.js` 的 `strategyNow()` / `buildSystem()`。
- **实际结果**：
  - state：`strategy=v6`、`tier=off`、`permission=review`、`readTools=true`、`delivery=chat`、
    `turns=10`、`historyMode=turns`、`fullOn=true`、`reasoningEffort=high`、`revision=2234`
  - 代码：`buildSystem` 的 `v6` 分支使用 `LANG_ONLY_SYSTEM` / `STRATEGY_V5_SYSTEM + V044_MID_TAIL` /
    `STRATEGY_V5_SYSTEM + V044_ASK_OVERRIDE`，并追加 `CLOSING_SELFCHECK`、ask 条款与 delivery 投影。
  - 顶层 `tier=off` ⇒ 新会话默认不拦截。
- **覆盖范围**：state 文件与策略选择逻辑。
- **未覆盖**：本次未实跑验证 `delivery`/`effort` 的实发值；截断与工具轮次的实际行为未测。
- **关联**：baseline-manifest.json → arms.D_05x.liveConfigAtP0

## EV-0007 · 静态 · 计划文档入仓且逐字节一致

- **要支持的结论**：仓库内的 `PLAN-0.6.md` 就是经审查的主文档，没有被改写。
- **方法**：复制后取 sha256，与落盘审查时的值比对。
- **实际结果**：`2734fdbd0afd03f37ff30e1968528af074bd518d87519e31f764bd46dffec62a`（81134 bytes），
  与 `.dsh/docs/prompt-optimizer/V0.6-MASTER-PLAN.md` 相同。
- **关联**：ADR-0004
