// v0.3.6-beta.1：H3 可信测量结果入档 + 版本串 + 提交信息。
// 用法：node evidence/prep-036.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.5beta1', '0.3.6beta1'],
  ['lib/client.js', 'build: "v0.3.5-beta.1"', 'build: "v0.3.6-beta.1"'],
  ['package.json', '"version":  "0.3.5-beta.1"', '"version":  "0.3.6-beta.1"'],
  ['package.json', '（v0.3.5-beta.1 · 复杂任务能力包', '（v0.3.6-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.6-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**H3 首次可信测量：候选版 4/6 对发布版 0/6，并抓到真实产物缺陷**',
  '',
  '量具修复后（执行体声明"无工具、直接产出完整文件"）重测 H3（审计并修复反向面网格），两条件各 2 份：',
  '',
  '| 条件 | 新样本得分（0~3 分档） | 明细 |',
  '|---|---|---|',
  '| **v0.3.6-beta.1** | **4/6** | r1 = **3 分**（入口齐备 + 修复正确 + 独立审计通过，inwardFaces=0）；r0 = **1 分**（有入口，但独立审计发现 **24 个内向面**） |',
  '| 发布版 0.2.2-beta.1 | 0/6 | r0 = 0 分（无入口，且 **10 个内向面**未修好）；r1 = 0 分（无入口，法线本身正确） |',
  '',
  '- **真实缺陷**：候选版那份"声称修好、实测 24 个内向面"的产物，正是用户最初描述的失效模式（该看见的面看不见）；说明"要求写明自检 + 第三方复跑"确实能把这类假完成揪出来。',
  '- **可靠性而非能力**：候选版 2 份里 1 份拿满、1 份假完成 ⇒ 能力存在但**不稳定**；这正是下一轮要压的方向。',
  '- 第二主指标（三题 0~3 分档）：**V3 16/42 = 38.1%（分布 8/1/0/5）· 发布版 0/42 = 0%（14/0/0/0）**——首次出现"1 分档"（部分做到）样本，区分度提升。',
  '- 诚实标注：H3 每格 n=2，样本很小；结论只针对"该题该量具下的形态差异"，不外推。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.6-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.6')
else { const a = '## v0.3.5-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.6') }
const ZH = '> **H3 可信测量（v0.3.6-beta.1，量具修复后）**：审计并修复反向面网格，两条件各 2 份 —— **v0.3.6 4/6**（1 份满分、1 份"声称修好但实测 24 个内向面"）· **发布版 0/6**（0 分两份，其中一份 10 个内向面未修好）。三题合计 0~3 分档：**V3 16/42 = 38.1%（8/1/0/5）· 发布版 0/42 = 0%**。样本小（n=2），仅作辅证。'
for (const [f, line, marker] of [['README.md', ZH, 'H3 可信测量'], ['README.en.md', '> **H3 credible measurement (v0.3.6-beta.1, after fixing the rig)**: audit-and-fix inverted mesh, 2 artifacts per condition — **v0.3.6 4/6** (one full score, one "claimed fixed but 24 inward faces measured") vs **shipped 0/6**. Combined 0-3 tier metric across three tasks: **v0.3.6 16/42 = 38.1% (8/1/0/5) vs shipped 0/42 = 0%**. Small sample (n=2); supporting evidence only.', 'H3 credible measurement']]) {
  const t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(marker) >= 0) { console.log('SKIP ' + f); continue }
  const ls = t.split('\n')
  const i = ls.findIndex((l) => l.indexOf('> **产物级第二主指标') === 0 || l.indexOf('> **Second artifact-level metric') === 0)
  ls.splice(i >= 0 ? i : 4, 0, line)
  fs.writeFileSync(P(f), ls.join('\n'), 'utf8'); console.log('README ' + f + ' 已插入 H3 测量行')
}
fs.writeFileSync(path.join(__dirname, 'commit-msg-039.txt'), [
  'feat(metric): v0.3.6-beta.1 —— H3 首次可信测量 4/6 对 0/6，抓到"声称修好但 24 个内向面"的假完成',
  '',
  '- 量具修复后重测 H3（两条件各 2 份）：v0.3.6 4/6（r1 满分 3；r0 有入口但独立审计 24 个内向面）· 发布版 0/6（无入口两份，其中一份 10 个内向面未修好）',
  '- 真实缺陷：候选版那份"声称修好、实测 24 个内向面"正是用户描述的失效模式（该看见的面看不见）',
  '- 可靠性 vs 能力：2 份里 1 份满分、1 份假完成 ⇒ 能力存在但不稳定，是下一轮主攻方向',
  '- 第二主指标（三题 0~3 分档）：V3 16/42 = 38.1%（分布 8/1/0/5）· 发布版 0/42 = 0%；首次出现"1 分档"样本，区分度提升',
  '- 文档：CHANGELOG 新增 0.3.6-beta.1 条目（含明细表与诚实标注）；README 中英新增 H3 可信测量行',
  '- 证据：evidence/cx-039-h3.json、artifact-score.json（逐份明细）、artifacts/H3*（新 4 份 30~42KB，无近空产物）',
].join('\n'), 'utf8')
console.log('MSG 已写')
