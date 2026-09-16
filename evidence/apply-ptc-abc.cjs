// 0.1.1 + A/B/C 补丁：在回退后的 0.1.1 策略上，加一段"面向 PTC 执行体的交付形态"要求。
//   A 交付形态：一次执行/一个程序即可完成；禁止分阶段、逐步、每阶段贴输出、先建 goal/todo
//   B 验收瘦身：验收 ≤3 条且每条可机器判定
//   C 删预案：不写失败预案，压成一句"不确定处走最保守路径并注明"
// 同时：快照验证 + 版本串 0.3.10-beta.1 + CHANGELOG 条目 + 提交信息。
// 用法：node evidence/apply-ptc-abc.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) 插入 PTC_RULES 并改写 buildSystem 的 legacy 分支
let src = fs.readFileSync(P('lib/index.js'), 'utf8')
const RULES = [
  '// 面向 PTC 型执行体的交付形态（A/B/C 三条，见 CHANGELOG v0.3.10）：',
  '// A 一次成程序（禁止分阶段/逐步/逐步贴输出/先建 goal·todo）；B 验收 ≤3 条且可机器判定；C 不写失败预案。',
  'const PTC_RULES = [',
  '  "# 交付形态（下游是 PTC 型执行体）",',
  '  "- 下游**用一个程序（一段脚本、一次执行）**把多步做完，没有逐步工具、每次往返都要重新起程序；所以命令要写成"一次交给它就能一次做完"的形态。",',
  '  "- 不得要求分阶段、逐步、每阶段贴输出、先建 goal/todo、先规划再动手——这类节奏在 PTC 里等于多轮往返，只会拉长时间、拉低成功率。",',
  '  "- 验收标准**最多 3 条**，每条必须**可机器判定**（数值、存在性、逐字符相等、退出码、可解析），不要散文式清单。",',
  '  "- 不要写失败预案；用一句话交代"任何不确定处走最保守路径并在交付里注明"即可。",',
  '  "- 拿不准的细节宁可留白让执行体自己决定，也不要堆"必须/不得"去钉死它；硬约束只保留真正不可协商的那几条。",',
  '].join("\\n")',
].join('\n')
if (src.indexOf('const PTC_RULES = [') >= 0) console.log('PTC_RULES 已存在')
else {
  const anchor = 'const LEGACY_V011 = '
  if (src.indexOf(anchor) < 0) { console.error('未找到 LEGACY_V011 锚点'); process.exit(1) }
  src = src.replace(anchor, RULES + '\n' + anchor)
  console.log('INSERT PTC_RULES ✓')
}
// buildSystem：legacy 分支持改为"0.1.1 + PTC_RULES（advanced/extreme）"
const OLD = 'return o.projectContext === true ? LEGACY_V011[tier] + "\\n\\n" + ADVANCED_CONTEXT_SUFFIX : LEGACY_V011[tier]'
const NEW = [
  'const base = tier === "basic" ? LEGACY_V011[tier] : LEGACY_V011[tier] + "\\n\\n" + PTC_RULES',
  '    return o.projectContext === true ? base + "\\n\\n" + ADVANCED_CONTEXT_SUFFIX : base',
].join('\n')
if (src.indexOf('const base = tier === "basic"') >= 0) console.log('buildSystem 已改')
else if (src.indexOf(OLD) >= 0) { src = src.replace(OLD, NEW); console.log('PATCH buildSystem ✓') }
else console.log('PATCH buildSystem ✗ 未找到锚点')
fs.writeFileSync(P('lib/index.js'), src, 'utf8')

// 2) 版本串
for (const [f, a, b] of [
  ['lib/client.js', '0.3.9beta1', '0.3.10beta1'],
  ['lib/client.js', 'build: "v0.3.9-beta.1"', 'build: "v0.3.10-beta.1"'],
  ['package.json', '"version":  "0.3.9-beta.1"', '"version":  "0.3.10-beta.1"'],
  ['package.json', '（v0.3.9-beta.1 · 0.1.1 策略回退版', '（v0.3.10-beta.1 · 0.1.1 + PTC 交付形态'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f)
}

// 3) CHANGELOG 条目
const CH = [
  '## v0.3.10-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**在 0.1.1 基础上加"面向 PTC 的交付形态"（A+B+C），不再走 0.3.x 的重约束路线**',
  '',
  '### 为什么（结构分析，见 evidence/ptc-gap-analysis.cjs / .json）',
  '',
  '| 指标（extreme 档） | 0.1.1 | 0.3.8 |',
  '|---|---|---|',
  '| 提示词字数 | 1421 | 6478（4.6×） |',
  '| 小标题数 | 0 | 18 |',
  '| 必须/不得类硬约束 | 7（4.9/千字） | 93（14.4/千字） |',
  '| 流程编排（分阶段/todo/goal） | 6 | 16 |',
  '| **流程闸门（切片/逐层/停手）** | **0** | **16** |',
  '| **失效模式清单（逐域）** | **0** | **29** |',
  '| 自检证据（贴输出/明细/对账） | 2 | 29 |',
  '',
  '机制：PTC 执行体用**一个程序**组合多步、没有逐步工具，**每次往返都要重新起程序**。因此"切片/逐层验收/每阶段贴输出"在 PTC 里等于强制多轮往返（耗时暴涨），"十几条领域清单"则挤占程序需要的上下文并压掉模型自己的判断——这与"过度约束→随机应变下降、调试拘谨、时间变长"的实测反馈一致。',
  '',
  '### 本版三条补丁（只加这三条，其余保持 0.1.1 原文）',
  '- **A 交付形态**：下游是 PTC 型执行体（一个程序一次做完）；**不得**要求分阶段、逐步、每阶段贴输出、先建 goal/todo、先规划再动手。',
  '- **B 验收瘦身**：验收标准**最多 3 条**，每条必须**可机器判定**（数值/存在性/逐字符相等/退出码/可解析）。',
  '- **C 删预案**：不写失败预案，压成一句"任何不确定处走最保守路径并在交付里注明"；拿不准处宁可留白，不要堆"必须/不得"。',
  '- 规模：advanced 1312 → **1726**，extreme 1421 → **1835** 字符（仍远低于 0.3.8 的 6480/6478）；普通档保持 0.1.1 原文（1273）。',
  '',
  '### 诚实边界',
  '- 上述差距是**关键词代理指标**（测"有没有出现"，不测效果）；机制推理是解释性的，**尚未在真 PTC 中验证**。',
  '- 本版**不声称提升**：它只声称"移除了与 PTC 消费方式冲突的要求，并补上一条交付形态指引"。真实验证用 `evidence/ptc-manual-packet.md`（人工 PTC 测试包）。',
  '- 待修 bug：插件活实例热重载后 `/run` 仍走旧策略（0.3.8 指纹），需单独排查路由/模块缓存。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.10-beta.1') >= 0) console.log('CHANGELOG 已有')
else { const a = '## v0.3.9-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG ✓') }

// 4) 提交信息
fs.writeFileSync(path.join(__dirname, 'commit-msg-043.txt'), [
  'feat(prompt): v0.3.10-beta.1 —— 0.1.1 + 面向 PTC 的交付形态（A+B+C）',
  '',
  '- A 交付形态：下游是 PTC 型执行体（一个程序一次做完）；不得要求分阶段/逐步/每阶段贴输出/先建 goal·todo',
  '- B 验收瘦身：验收 ≤3 条且每条可机器判定；C 删失败预案（压成一句"走最保守路径并注明"）',
  '- 结构分析依据（ptc-gap-analysis）：0.1.1 1421 字/0 小标题/7 硬约束；0.3.8 6478 字/18 小标题/93 硬约束，',
  '  其中 0.3.8 独有"流程闸门 16 处 + 失效模式清单 29 处"——正好是 PTC（一个程序、多轮昂贵）最不友好的两类',
  '- 规模：advanced 1312→1726、extreme 1421→1835（普通档保持 0.1.1 原文 1273）',
  '- 诚实边界：代理指标 + 机制推理，未在真 PTC 验证；不声称提升；人工测试包已备（ptc-manual-packet.md）',
  '- 待修：活实例热重载后 /run 仍走旧策略，需排查路由/模块缓存',
].join('\n'), 'utf8')
console.log('MSG ✓')
