// v0.3.8-beta.1（收尾轮）：版本串 + CHANGELOG（含"未测"标注与 0.3.1→0.3.8 汇总）+ README 收尾段 + 提交信息。
// 用法：node evidence/prep-038.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.7beta1', '0.3.8beta1'],
  ['lib/client.js', 'build: "v0.3.7-beta.1"', 'build: "v0.3.8-beta.1"'],
  ['package.json', '"version":  "0.3.7-beta.1"', '"version":  "0.3.8-beta.1"'],
  ['package.json', '（v0.3.7-beta.1 · 复杂任务能力包', '（v0.3.8-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.8-beta.1 — 2026/09/15（收尾轮）',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**第三方口径复检（⑦c）——候选改动，尚未测**',
  '',
  '- 诊断（来自上一轮）：0.3.5~0.3.7 三份 H3 候选样本中 **2 份"假完成"**（自检说修好了、独立审计实测 24 / 21 个内向面）⇒ 问题已从"入口没落地"转移到"**自检结果与真实几何不一致**"。',
  '- 改动（⑦c）：自检必须**逐项给出被检查对象明细**（几何逐面判定或用"检查面数 = 网格面数"对账并给出反向面索引；数据逐条或抽样明细）；检查数少于实际对象数时必须说明跳过了什么、为什么；**只给汇总数字不算完成**，且第三方按明细能复算出同一个数字。',
  '- **诚实标注：本改动尚未测量**（本轮无剩余采样预算）。它作为候选进入 0.3.8，下一轮按同口径测 H3（目标 n≥2/条件）后再决定保留或回退；**不声称任何提升**。',
  '',
  '**0.3.1 → 0.3.8 能力与指标汇总（同口径，n≥2 处已标注）**',
  '',
  '| 版本 | 主线改动 | 命令侧（满分 180） | 产物级 0~3 分档（三题） |',
  '|---|---|---|---|',
  '| 0.3.1-beta.1 | 先防后查（押注首要失效/最小切片/机器可判定不变量/惯例优先/失败即报告） | **169（93.9%）**，配对 9-0-1 | — |',
  '| 0.3.2-beta.1 | ＋切片闸门、统一自检入口（"或等价"） | 165（91.4%），噪声内 | — |',
  '| 0.3.3-beta.1 | 自检入口**写死**（`__selfcheck` 结构 + 真实输出） | 165（91.9%） | 12/36（33.3%） |',
  '| 0.3.4-beta.1 | ＋命令侧子指标（入口要求 100% vs 发布版 0%） | 165（91.9%） | 12/36 |',
  '| 0.3.5-beta.1 | 入口与交付物同体 | 未测（规格澄清） | H3 仍 0/18（后判定为量具混淆） |',
  '| 0.3.6-beta.1 | 量具修复后 H3 首次可信测量 | — | **17/45（37.8%）**；H3 4/6 对 0/6 |',
  '| 0.3.7-beta.1 | ＋改完必须复检（⑦b） | — | H3 仍出现假完成（21 个内向面） |',
  '| **0.3.8-beta.1** | ＋第三方口径对账（⑦c，**未测**） | — | 待测 |',
  '',
  '- 发布版对照（0.2.2-beta.1）：命令侧 125（69.2%）· 产物级 0/45（0%）。',
  '- 两条主指标的分工：**命令侧**量"要求是否写进命令"（规格层，n=2 有噪声估计）；**产物级 0~3 分档**量"执行体是否真的做到并可被第三方复跑"（执行层）。',
  '',
  '**仍未解决（如实列出）**',
  '1. **假完成**：入口能落地，但自检数字与真实几何不一致（H3 三样本里 2 份）；⑦c 是针对它的候选对策，未验证。',
  '2. **产物级样本小**（每格 n≤4），且 H3 单次生成 2~18 分钟，采样成本高。',
  '3. **H2/H3 的"2 分档"从未出现**（要么全过要么 0/1），说明中间档判据还不够敏感。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.8-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.8')
else { const a = '## v0.3.7-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.8') }
const ZH = '> **版本能力汇总（0.3.1 → 0.3.8）**：命令侧（10 题/满分 180，n=2）0.3.1 = **169（93.9%，配对 9-0-1）**，0.3.3~0.3.4 = 165（91.9%，噪声内）；发布版对照 125（69.2%）。产物级 0~3 分档（三题各 4~6 份）：**V3 17/45 = 37.8%（分布 8/2/0/5）· 发布版 0/45 = 0%**。仍未解决：H3 的"假完成"（自检数字与真实几何不一致，3 份样本里 2 份），0.3.8 的 ⑦c 对账要求是针对它的候选对策但**尚未测量**。'
for (const [f, line] of [['README.md', ZH], ['README.en.md', '> **Version capability summary (0.3.1 -> 0.3.8)**: command side (10 tasks / max 180, n=2) 0.3.1 = **169 (93.9%, paired 9W-0L-1T)**, 0.3.3-0.3.4 = 165 (91.9%, within noise); shipped build 125 (69.2%). Artifact 0-3 tier metric (3 tasks): **v0.3.8 17/45 = 37.8% (distribution 8/2/0/5) vs shipped 0/45 = 0%**. Still open: H3 "false completion" (self-check numbers disagree with the real geometry in 2 of 3 samples); 0.3.8 ships a candidate counter-measure (7c reconciliation) that is **not yet measured**.']]) {
  const t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf('版本能力汇总（0.3.1 → 0.3.8）') >= 0 || t.indexOf('Version capability summary (0.3.1') >= 0) { console.log('SKIP ' + f); continue }
  const ls = t.split('\n')
  const i = ls.findIndex((l) => l.indexOf('> **最新实测') === 0 || l.indexOf('> **Latest measurement') === 0)
  ls.splice(i >= 0 ? i + 1 : 3, 0, line)
  fs.writeFileSync(P(f), ls.join('\n'), 'utf8'); console.log('README ' + f + ' 已插入汇总行')
}
fs.writeFileSync(path.join(__dirname, 'commit-msg-041.txt'), [
  'feat(prompt): v0.3.8-beta.1 —— 第三方口径对账（⑦c，未测）+ 0.3.1→0.3.8 收尾汇总',
  '',
  '- 诊断：0.3.5~0.3.7 三份 H3 候选里 2 份"假完成"（自检称修好、独立审计实测 24/21 个内向面）⇒ 问题已从"入口落地"转到"自检与真实几何不一致"',
  '- ⑦c：自检必须逐项给明细（几何逐面或"检查面数=网格面数"对账并给反向面索引），检查数少于对象数要说明跳过什么；只给汇总数字不算完成，第三方按明细能复算出同一数字',
  '- 诚实标注：⑦c 尚未测量，作为候选进入 0.3.8，不声称提升；下一轮按同口径测 H3（目标 n≥2）后决定保留或回退',
  '- 文档：CHANGELOG 新增 0.3.8 条目（含 0.3.1→0.3.8 能力/指标汇总表与"仍未解决"三条）；README 中英插入版本能力汇总行',
  '- 指标现状：命令侧 169（93.9%，n=2）· 产物级 0~3 分档 V3 17/45=37.8% 对发布版 0/45=0%',
  '- 证据：evidence/artifact-score.json、cx-040-h3.json、selfcheck-metric.json、dashboard（生成物，已移出版本控制）',
].join('\n'), 'utf8')
console.log('MSG 已写')
