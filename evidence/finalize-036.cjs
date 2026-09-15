// 固化 0~3 分档第二指标：CHANGELOG 追加 + ACCEPTANCE 补 Y8/Y9 + README 第二指标行改为分档口径 + 提交信息。
// 用法：node evidence/finalize-036.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) CHANGELOG：作为 0.3.4 条目的补充小节
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
const anchor = '**产物级（同一把尺子，v0.3.3 起写死的判据）**'
const add = [
  '**产物级 0~3 分档（第二主指标升级，本轮）**',
  '',
  '规则：**3** = 统一自检入口齐备 + 独立法线审计通过 + 其余判据全过；**2** = 入口 + 法线审计过但仍有判据未过；**1** = 有入口但审计未过/无法审计；**0** = 连入口都没有（第三方无法复跑）。',
  '',
  '| 条件 | 得分 | 百分比 | 分布 0/1/2/3 |',
  '|---|---|---|---|',
  '| **v0.3.4-beta.1** | **12/36** | **33.3%** | **8 / 0 / 0 / 4** |',
  '| 发布版 0.2.2-beta.1 | 0/36 | 0% | 12 / 0 / 0 / 0 |',
  '',
  '- 分题：V3 的 H1 法线 **6/12**、H2 操控 **6/12**、**H3 审计并修复反向面 0/12**（四份都缺统一自检入口 —— 这是尚未攻下的前沿）。',
  '- 诚实标注：V3 的得分是"全有或全无"形态（4 份拿满 3 分、8 份因缺入口得 0），说明当前瓶颈是**入口落地率**而不是判据质量；样本仍小（每格 n=4）。',
  '',
  anchor,
].join('\n')
if (ch.indexOf('产物级 0~3 分档（第二主指标升级，本轮）') >= 0) console.log('CHANGELOG: 已有分档小节')
else if (ch.indexOf(anchor) >= 0) { ch = ch.replace(anchor, add); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已追加分档小节') }
else console.log('CHANGELOG: 锚点未找到')

// 2) ACCEPTANCE：补 Y8/Y9
let acc = fs.readFileSync(P('ACCEPTANCE.md'), 'utf8')
const y = '| Y7 |'
const lines = acc.split('\n')
const i = lines.findIndex((l) => l.indexOf(y) === 0)
if (i >= 0 && acc.indexOf('| Y8 |') < 0) {
  lines.splice(i + 1, 0,
    '| Y8 | 产物级 0~3 分档（第二主指标） | `artifact-score.cjs` | **v0.3.4 12/36 = 33.3%（分布 8/0/0/4）· 发布版 0/36 = 0%（12/0/0/0）**；分题 H1 6/12、H2 6/12、H3 0/12 |',
    '| Y9 | 分档规则 | 同上 | 3 = 入口齐备 + 法线审计过 + 全判据过；2 = 入口 + 审计过；1 = 有入口但审计未过/不可审计；0 = 无入口 |')
  fs.writeFileSync(P('ACCEPTANCE.md'), lines.join('\n'), 'utf8'); console.log('ACCEPTANCE: 已补 Y8/Y9')
} else console.log('ACCEPTANCE: 跳过（Y7 未找到或已有 Y8）')

// 3) README：第二指标行改为 0~3 分档口径
const ZH = '> **产物级第二主指标（0~3 分档，v0.3.4-beta.1）**：3 = 统一自检入口齐备 + 独立法线审计通过 + 全判据过；2 = 入口 + 审计过；1 = 有入口但审计未过；0 = 无入口。H1/H2/H3 三题各 4 份：**v0.3.4 12/36 = 33.3%（分布 8/0/0/4）· 发布版 0/36 = 0%（12/0/0/0）**；分题 H1 6/12、H2 6/12、H3 0/12（H3 为尚未攻下的前沿）。样本仍小，仅作辅证。'
const EN = '> **Second artifact-level metric (0-3 tiers, v0.3.4-beta.1)**: 3 = unified self-check entry + independent normals audit + all criteria pass; 2 = entry + audit pass; 1 = entry present but audit failed; 0 = no entry. Three tasks x 4 artifacts: **v0.3.4 12/36 = 33.3% (distribution 8/0/0/4) vs shipped 0/36 = 0% (12/0/0/0)**; per task H1 6/12, H2 6/12, H3 0/12 (H3 is the unconquered frontier). Small sample; supporting evidence only.'
for (const [f, newLine, marker] of [['README.md', ZH, '产物级第二主指标'], ['README.en.md', EN, 'Second artifact-level metric']]) {
  const t = fs.readFileSync(P(f), 'utf8')
  const ls = t.split('\n')
  const i = ls.findIndex((l) => l.indexOf(marker) >= 0 && l.indexOf('>') === 0)
  if (i < 0) { console.log('README ' + f + ': 未找到第二指标行'); continue }
  ls[i] = newLine
  fs.writeFileSync(P(f), ls.join('\n'), 'utf8'); console.log('README ' + f + ': 第二指标行已改为分档口径')
}

// 4) 提交信息
fs.writeFileSync(path.join(__dirname, 'commit-msg-036.txt'), [
  'test(artifact): 产物级升级为 0~3 分档第二指标 —— 12/36 对 0/36（H3 为前沿）',
  '',
  '- 新增 evidence/artifact-score.cjs：每份产物给 0~3 分（3 全过 / 2 入口+法线审计过 / 1 有入口但审计未过 / 0 无入口），零额外 LLM 成本',
  '- 实测（三题各 4 份 = 12 份/条件）：v0.3.4 12/36 = 33.3%（分布 8/0/0/4）· 发布版 0/36 = 0%（12/0/0/0）',
  '- 分题：H1 法线 6/12 · H2 操控 6/12 · H3 审计并修复反向面 0/12（四份均缺统一自检入口，是尚未攻下的前沿）',
  '- 诚实标注：V3 呈"全有或全无"（4 份满分、8 份零分），瓶颈在入口落地率而非判据质量；每格 n=4 样本仍小',
  '- 文档：CHANGELOG 追加"产物级 0~3 分档"小节；ACCEPTANCE 补 Y8/Y9；README 中英第二指标行改为分档口径',
  '- 证据：evidence/artifact-score.json（含逐份明细与分布）',
].join('\n'), 'utf8')
console.log('MSG 已写')
