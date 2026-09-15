// v0.3.4-beta.1 发布准备：版本串 + CHANGELOG + README 子指标行 + 提交信息。
// 用法：node evidence/prep-034.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.3beta1', '0.3.4beta1'],
  ['lib/client.js', 'build: "v0.3.3-beta.1"', 'build: "v0.3.4-beta.1"'],
  ['package.json', '"version":  "0.3.3-beta.1"', '"version":  "0.3.4-beta.1"'],
  ['package.json', '（v0.3.3-beta.1 · 复杂任务能力包', '（v0.3.4-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.4-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**补齐量尺：0.3.3 的"统一自检入口"要求在命令侧首次被测到**',
  '',
  '- 背景：前两轮发现 0.3.3 的改动在**命令侧评分卡上测不到**（评分卡没有该要点），于是补一个**独立确定性子指标**，用同一批命令直接量它（零额外 LLM 成本，脚本 `evidence/selfcheck-metric.cjs`）。',
  '- 子指标三项：① 命令是否要求统一自检入口 ② 是否写明返回结构（`checks` / `pass` / `evidence`） ③ 是否要求附**真实运行输出**。',
  '',
  '**同批命令（10 题 × 2 次采样 = 60 格，291 秒）**',
  '',
  '| 条件 | 子指标：三项齐备 | 命令侧总分（满分 180） | 配对 |',
  '|---|---|---|---|',
  '| **0.3.4-beta.1（=0.3.3 提示词）** | **100%（20/20）** | **331/360 = 91.9%**（165/180） | **9 胜 / 0 负 / 1 平** |',
  '| 发布版 0.2.2-beta.1 | **0%（0/20）** | 249/360 = 69.2%（125/180） | — |',
  '| 无优化 | 0% | 8/360 = 2.2% | — |',
  '',
  '- 噪声：同格重复采样平均极差 **0.87 分/18**（最大 5）。',
  '- 子指标明细：V3 提到入口/结构/要求实跑输出 **各 100%**；发布版分别 **0% / 0% / 5%**。',
  '- **诚实标注**：子指标测的是"**要求是否写进命令**"（规格层），不等于执行方真的照做——执行侧落地率见产物级指标（H1/H2 各 2/4 对 0/4、旧基线 0/14）。两条指标一起看才算完整。',
  '',
  '**产物级（同一把尺子，v0.3.3 起写死的判据）**：H1 法线 2/4 对 0/4 · H2 操控 2/4 对 0/4 → **合计 4/12（33.3%）对 0/12（0%）**，旧产物基线 0/14；独立法线审计两条件均 0 内向面。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.4-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.4')
else { const a = '## v0.3.3-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.4') }
const ZH = '> **命令侧子指标（v0.3.4-beta.1）**：命令是否要求"统一自检入口 + 返回结构 + 真实运行输出"—— 同批 60 格：**v0.3.4 三项齐备 100%（20/20）· 发布版 0%（0/20）**；同批总分 91.9% 对 69.2%（配对 9 胜 0 负 1 平，噪声 0.87 分/18）。该子指标衡量"要求是否写进命令"，执行侧落地率见产物级指标。'
const EN = '> **Command-side sub-metric (v0.3.4-beta.1)**: does the command demand a unified self-check entry + return shape + real run output — same 60 cells: **v0.3.4 100% complete (20/20) vs shipped 0% (0/20)**; same-batch total 91.9% vs 69.2% (paired 9W-0L-1T, noise 0.87 of 18). The sub-metric measures whether the requirement is written into the command; executor-side landing rate is the artifact metric.'
for (const [f, line] of [['README.md', ZH], ['README.en.md', EN]]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf('命令侧子指标（v0.3.4-beta.1）') >= 0 || t.indexOf('Command-side sub-metric (v0.3.4-beta.1)') >= 0) { console.log('SKIP ' + f); continue }
  const lines = t.split('\n')
  const i = lines.findIndex((l) => l.indexOf('> **最新实测（v0.3.1-beta.1') === 0 || l.indexOf('> **Latest measurement (v0.3.1-beta.1') === 0)
  const at = i >= 0 ? i + 1 : 3
  lines.splice(at, 0, line)
  fs.writeFileSync(P(f), lines.join('\n'), 'utf8'); console.log('README ' + f + ' 已插入子指标行')
}
fs.writeFileSync(path.join(__dirname, 'commit-msg-034b.txt'), [
  'feat(metric): v0.3.4-beta.1 —— 补命令侧子指标：统一自检入口要求 100% vs 发布版 0%',
  '',
  '- 新增 evidence/selfcheck-metric.cjs（确定性、零额外 LLM 成本）：量命令是否要求 ① 统一自检入口 ② 返回结构(checks/pass/evidence) ③ 真实运行输出',
  '- 同批 60 格（10 题 × 2 次采样，291 秒）：0.3.4 三项齐备 100%（20/20）· 发布版 0%（0/20；提到实跑输出仅 5%）· 无优化 0%',
  '- 同批命令侧总分：0.3.4 331/360 = 91.9%（165/180）· 发布版 249/360 = 69.2%（125/180）；配对 9 胜 0 负 1 平；噪声平均极差 0.87/18（最大 5）',
  '- 诚实标注：子指标衡量"要求是否写进命令"（规格层），执行侧落地率另由产物级指标衡量（H1/H2 各 2/4 对 0/4、旧基线 0/14）',
  '- 文档：CHANGELOG 新增 0.3.4-beta.1 条目（背景/表格/噪声/两条指标关系）；README 中英新增"命令侧子指标"一行',
  '- 证据：evidence/cx-036.json、selfcheck-metric.json、cx-grade.json',
].join('\n'), 'utf8')
console.log('MSG 已写')
