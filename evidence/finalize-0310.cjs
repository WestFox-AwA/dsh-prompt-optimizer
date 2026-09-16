// 任务③：修 CHANGELOG 数字偏差 + 写入 PTC 结构差距与代理对比结论 + 0.3.10-beta.2 发布准备。
// 用法：node evidence/finalize-0310.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) 修数字偏差
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
const fixes = [
  ['advanced 1312 → **1726**，extreme 1421 → **1835** 字符', 'advanced 1312 → **1627**，extreme 1421 → **1736** 字符（实测值；此前脚本预估写成 1726/1835，已更正）'],
  ['- 规模：advanced 1312 → **1726**，extreme 1421 → **1835** 字符（仍远低于 0.3.8 的 6480/6478）；普通档保持 0.1.1 原文（1273）。',
   '- 规模（实测）：advanced 1312 → **1627**，extreme 1421 → **1736** 字符（各 +315；仍远低于 0.3.8 的 6480/6478）；普通档与 0.1.1 逐字相同（1273）。'],
]
let n = 0
for (const [a, b] of fixes) { const c = ch.split(a).length - 1; if (c === 1) { ch = ch.replace(a, b); n++ } else console.log('FIX SKIP(' + c + '): ' + a.slice(0, 30)) }
fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8')
console.log('CHANGELOG 修正 ' + n + '/' + fixes.length)

// 2) CHANGELOG 新增 0.3.10-beta.2（含同批代理对比）
const CMP = [
  '## v0.3.10-beta.2 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**同批代理指标验证 A/B/C 生效（5 题 × 3 策略，同一次运行）**',
  '',
  '| 策略 | 平均字数 | 硬约束/条 | 流程闸门·阶段/条 | 计划(goal/todo)/条 | 失败预案/条 | 一次成程序/条 |',
  '|---|---|---|---|---|---|---|',
  '| 0.1.1（回退基线） | 1769 | 3.6 | 8.6 | 1.0 | 1.2 | 0 |',
  '| 0.3.8（旧重约束） | 3004 | 35.6 | 11.2 | 1.0 | 0.6 | 0 |',
  '| **0.3.10（0.1.1 + A/B/C）** | **807** | **2.0** | **0.2** | **0** | **0** | **0.6** |',
  '',
  '- 读法：A（交付形态）把"流程闸门/阶段"从 8.6~11.2 压到 **0.2**、"计划(goal/todo)"压到 **0**；B/C 把"失败预案"压到 **0**、硬约束从 3.6（0.1.1）/35.6（0.3.8）压到 **2.0**；平均字数比 0.1.1 还短 54%（**807 vs 1769**），并首次出现"一次成程序"类表述（0.6/条）。',
  '- 数据：`evidence/ptc-proxy-compare.json`（逐题明细）；脚本 `evidence/ptc-ab.cjs` 与 staging 工具 `ptcproxy`。',
  '- **诚实标注**：这是**关键词代理指标**（测"有没有出现"，不测效果），且**未在真 PTC 中验证**；本版**不声称提升**。真实验证入口：`evidence/ptc-manual-packet-v0310.md`（B 组已用 0.3.10 重生成）。',
  '- 本轮同时修正上一版文档里的数字偏差（预估 1726/1835 → 实测 **1627/1736**）。',
  '',
].join('\n')
ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.10-beta.2') >= 0) console.log('beta.2 条目已有')
else { const a = '## v0.3.10-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CMP + a) : (CMP + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG beta.2 ✓') }

// 3) PROMPT-OPTIMIZATION：追加 PTC 方向章节
const SEC = [
  '## 十、PTC 方向：为什么回退、以及 0.1.1 的三条增量（2026/09/15）',
  '',
  '### 10.1 环境事实（先查清，再谈优化）',
  '- DSH 自带预设 `ptc`（PTC 模式）：功能完整的编码 Agent，**默认不提供 workflow 工具**；其他工具通过 PTC SDK 呈现，**让模型用一个 TypeScript 程序组合多步操作**。',
  '- 因此 PTC 的消费方式是"**一个程序、一次执行**"，每次往返都要重新起程序 —— 这与"逐步/逐层/每阶段贴输出"这类节奏天然冲突。',
  '',
  '### 10.2 结构差距（0.1.1 vs 0.3.8，extreme 档，`evidence/ptc-gap-analysis.json`）',
  '',
  '| 指标 | 0.1.1 | 0.3.8 |',
  '|---|---|---|',
  '| 提示词字数 | 1421 | 6478（4.6×） |',
  '| 小标题数 | 0 | 18 |',
  '| 必须/不得 | 7（4.9/千字） | 93（14.4/千字） |',
  '| 流程编排（阶段/todo/goal） | 6 | 16 |',
  '| 流程闸门（切片/逐层/停手） | 0 | 16 |',
  '| 失效模式清单（逐域） | 0 | 29 |',
  '| 自检证据（贴输出/明细/对账） | 2 | 29 |',
  '',
  '机制解释：闸门类要求把工作拆成多轮（PTC 里最贵）；清单类要求挤占程序所需上下文并压掉模型自身判断 —— 与"过度约束 → 随机应变下降、调试拘谨、开发时间变长"的实测反馈一致。',
  '',
  '### 10.3 0.1.1 的真实短板与三条增量',
  '0.1.1 现场产出的命令里**自己也带 PTC 敌对物**（"阶段 1~4 + 失败预案 + 7 条验收"、"先建立 todo 列表"、"先建立 goal…按阶段推进"），因为它没说清单要面向什么消费者。补丁：',
  '- **A 交付形态**：下游是 PTC 型执行体（一个程序一次做完）；不得要求分阶段/逐步/每阶段贴输出/先建 goal·todo/先规划再动手。',
  '- **B 验收瘦身**：验收最多 3 条，每条可机器判定（数值/存在性/逐字符相等/退出码/可解析）。',
  '- **C 删预案**：不写失败预案，压成一句"任何不确定处走最保守路径并在交付里注明"；拿不准处宁可留白。',
  '- 实现：`buildSystem` 的 legacy 分支 = `LEGACY_V011[tier] + PTC_RULES`（advanced/extreme）；basic 与 0.1.1 逐字相同。实测 1627 / 1736 字符（0.1.1 前缀 + 315）。',
  '',
  '### 10.4 同批代理指标（5 题 × 3 策略，`evidence/ptc-proxy-compare.json`）',
  '',
  '| 策略 | 字数 | 硬约束/条 | 闸门·阶段/条 | 计划/条 | 预案/条 | 一次成程序/条 |',
  '|---|---|---|---|---|---|---|',
  '| 0.1.1 | 1769 | 3.6 | 8.6 | 1.0 | 1.2 | 0 |',
  '| 0.3.8 | 3004 | 35.6 | 11.2 | 1.0 | 0.6 | 0 |',
  '| **0.3.10** | **807** | **2.0** | **0.2** | **0** | **0** | **0.6** |',
  '',
  '### 10.5 诚实边界（必须一起读）',
  '1. 以上是**关键词代理指标**：只测"有没有出现某类要求"，**不测真实效果**；',
  '2. **未在真 PTC 环境中验证**：需要人工包（`evidence/ptc-manual-packet-v0310.md`）实测才能定论；',
  '3. 因此 v0.3.9/v0.3.10 **均不声称提升**，只声称"移除了与 PTC 消费方式冲突的要求，并补了一条交付形态指引"；',
  '4. 已知缺陷：插件活实例曾出现"热重载后仍走旧策略"，已用产出指纹验证（0.3.8 指纹 0 命中）确认本版生效；后续改动仍需指纹复验。',
  '',
].join('\n')
let po = fs.readFileSync(P('PROMPT-OPTIMIZATION.md'), 'utf8')
if (po.indexOf('## 十、PTC 方向') >= 0) console.log('§10 已有')
else { fs.writeFileSync(P('PROMPT-OPTIMIZATION.md'), po.replace(/\s*$/, '') + '\n\n---\n\n' + SEC, 'utf8'); console.log('§10 ✓') }

// 4) 版本串 + 提交信息
for (const [f, a, b] of [
  ['lib/client.js', '0.3.10beta1', '0.3.10beta2'],
  ['lib/client.js', 'build: "v0.3.10-beta.1"', 'build: "v0.3.10-beta.2"'],
  ['package.json', '"version":  "0.3.10-beta.1"', '"version":  "0.3.10-beta.2"'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f)
}
fs.writeFileSync(path.join(__dirname, 'commit-msg-044.txt'), [
  'docs(ptc): v0.3.10-beta.2 —— 同批代理指标验证 A/B/C 生效 + 修正数字偏差 + 写入 PTC 章节',
  '',
  '- 同批对比（5 题 × 3 策略，同一运行）：闸门·阶段/条 8.6(0.1.1) / 11.2(0.3.8) → 0.2(0.3.10)；计划(goal/todo) 1.0/1.0 → 0；',
  '  失败预案 1.2/0.6 → 0；硬约束 3.6/35.6 → 2.0；平均字数 1769/3004 → 807；一次成程序类表述 0/0 → 0.6',
  '- 修正 CHANGELOG 数字偏差：预估 1726/1835 → 实测 1627/1736（advanced/extreme）',
  '- PROMPT-OPTIMIZATION 新增 §10：PTC 环境事实 / 结构差距表 / 0.1.1 短板与三条增量 / 同批代理表 / 诚实边界',
  '- 人工包 B 组已用 0.3.10 重生成：evidence/ptc-manual-packet-v0310.md',
  '- 证据：evidence/ptc-proxy-compare.json（逐题明细）、ptc-gap-analysis.json',
  '- 诚实标注：代理指标、未在真 PTC 验证、不声称提升；活实例已用产出指纹确认为新策略（0.3.8 指纹 0 命中）',
].join('\n'), 'utf8')
console.log('MSG ✓')
