// v0.3.7-beta.1：诚实记录"假完成仍存在" + 版本串 + 提交信息。
// 用法：node evidence/prep-037.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.6beta1', '0.3.7beta1'],
  ['lib/client.js', 'build: "v0.3.6-beta.1"', 'build: "v0.3.7-beta.1"'],
  ['package.json', '"version":  "0.3.6-beta.1"', '"version":  "0.3.7-beta.1"'],
  ['package.json', '（v0.3.6-beta.1 · 复杂任务能力包', '（v0.3.7-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.7-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**加"改完必须复检"（⑦b）——但"假完成"仍在，如实记录**',
  '',
  '- 改动（⑦b）：任何修复/优化之后必须**重跑同一个自检入口**并贴出输出，且**修复前后数字都要给**（例："反向面 24 → 0"）；只声称"已修好"而没有复检输出视为未完成。动机来自上一轮抓到的那份"声称修好、实测 24 个内向面"。',
  '',
  '**复测（H3 两条件各 1 份，n=1）**',
  '',
  '| 条件 | 得分 | 明细 |',
  '|---|---|---|',
  '| **v0.3.7-beta.1** | **1** | 统一自检入口**已具备**（上版常缺），但独立审计仍测到 **21 个内向面** ⇒ "假完成"模式**依旧存在** |',
  '| 发布版 0.2.2-beta.1 | 0 | 无统一自检入口；但独立审计 `inwardFaces=0`（几何本身修对了） |',
  '',
  '- **诚实结论**：本版改动**没有消除假完成**（n=1，样本极小，只说明"仍然存在"，不足以说明频率）。把 0.3.5~0.3.7 三份候选样本合起来看：**1 份满分（inward=0）、2 份假完成（24 / 21 个内向面）** ⇒ 该题的核心问题已经清晰：**入口能落地了，但"几何真的修好了没有"仍靠不住**。',
  '- 第二主指标：**V3 17/45 = 37.8%（分布 8/2/0/5）· 发布版 0/45 = 0%（15/0/0/0）**；"1 分档"（部分做到）样本增至 2 份。',
  '- 规模：极端档 6314 字符（普通档仍 1405）；约束闸门 34 项断言全 PASS。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.7-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.7')
else { const a = '## v0.3.6-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.7') }
fs.writeFileSync(path.join(__dirname, 'commit-msg-040.txt'), [
  'feat(prompt): v0.3.7-beta.1 —— 加"改完必须复检"（⑦b）；假完成仍在，如实记录',
  '',
  '- ⑦b：修复/优化后必须重跑同一自检入口并贴输出，且给出修复前后数字；只声称"已修好"而无复检输出视为未完成',
  '- 复测（H3 各 1 份，n=1）：候选版得 1 分 —— 入口已具备，但独立审计测到 21 个内向面，"假完成"依旧存在；发布版 0 分（无入口，但 inwardFaces=0）',
  '- 三份候选样本合计：1 份满分（inward=0）· 2 份假完成（24/21 个内向面）⇒ 核心问题已清晰：入口能落地，但"几何真的修好没有"仍靠不住',
  '- 第二主指标：V3 17/45 = 37.8%（分布 8/2/0/5）· 发布版 0/45 = 0%；"1 分档"样本增至 2 份',
  '- 规模：极端档 6314 字符；约束闸门 34 项断言全 PASS；版本串 0.3.7beta1 / build v0.3.7-beta.1',
  '- 证据：evidence/cx-040-h3.json、artifact-score.json',
].join('\n'), 'utf8')
console.log('MSG 已写')
