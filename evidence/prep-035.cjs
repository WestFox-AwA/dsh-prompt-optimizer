// v0.3.5-beta.1 发布准备：版本串 + CHANGELOG（含否定结果）+ 提交信息。
// 用法：node evidence/prep-035.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.4beta1', '0.3.5beta1'],
  ['lib/client.js', 'build: "v0.3.4-beta.1"', 'build: "v0.3.5-beta.1"'],
  ['package.json', '"version":  "0.3.4-beta.1"', '"version":  "0.3.5-beta.1"'],
  ['package.json', '（v0.3.4-beta.1 · 复杂任务能力包', '（v0.3.5-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.5-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**规格澄清：自检入口与交付物同体（H3 前沿未攻下，如实记录否定结果）**',
  '',
  '- 改动（⑦ 的补充）：`window.__selfcheck()` 必须**在脚本顶层直接可调用**（不得只挂在 `load`/`DOMContentLoaded` 回调里、不得依赖用户先操作才挂载）；**交付前必须真跑一次并把输出原样贴出**。',
  '- 动机：H3（审计并修复反向面网格）六份产物**全部缺统一自检入口**，怀疑是"挂载时机"造成第三方取不到。',
  '',
  '**复测（同口径，H3 两条件各 3 份）**',
  '',
  '| 条件 | H3 得分（0~3 分档） | 分布 0/1/2/3 |',
  '|---|---|---|',
  '| 发布版 0.2.2-beta.1 | 0/18 | 6/0/0/0 |',
  '| **0.3.5-beta.1** | **0/18** | **6/0/0/0** |',
  '',
  '- **否定结果（诚实标注）**：本版改动**没有让 H3 有任何一份满足判据**（0/6 对 0/6），因此**不声称提升**；该改动仅作为规格澄清保留（对 H1/H2 亦无副作用：三题合计 V3 12/42 = 28.6%、发布版 0/42 = 0%，V3 的 4 份满分仍全部来自 H1/H2）。',
  '- **新观察到的执行侧现象**：H3 本轮出现 **528 字节与 1072 字节的近空产物**（执行 AI 基本没产出）——说明该题对执行侧本身偏难，第三方复跑失败未必全是"入口形态"问题，下一轮需要先排查"为什么 H3 的产物会近乎为空"。',
  '- 规模：极端档 6192 字符（普通档仍 1405）；约束闸门 34 项断言全 PASS。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.5-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.5')
else { const a = '## v0.3.4-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.5') }
fs.writeFileSync(path.join(__dirname, 'commit-msg-037.txt'), [
  'feat(prompt): v0.3.5-beta.1 —— 自检入口与交付物同体（H3 前沿未攻下，记录否定结果）',
  '',
  '- ⑦ 补充：__selfcheck() 必须在脚本顶层直接可调用（不得只挂 load/DOMContentLoaded、不得依赖用户操作后才挂载）；交付前必须真跑一次并原样贴出输出',
  '- 复测（H3 两条件各 3 份）：0.3.5 0/18（6/0/0/0）· 发布版 0/18（6/0/0/0）⇒ 没有一份满足判据，故不声称提升',
  '- 三题合计（0~3 分档）：V3 12/42 = 28.6% · 发布版 0/42 = 0%；V3 的 4 份满分仍全部来自 H1/H2',
  '- 新观察：H3 出现 528/1072 字节近空产物（执行侧偏难），下一轮先排查"为什么 H3 产物近乎为空"',
  '- 规模：极端档 6192 字符；约束闸门 34 项断言全 PASS；版本串 0.3.5beta1 / build v0.3.5-beta.1',
  '- 证据：evidence/cx-037-h3.json、artifact-score.json（逐份明细与分布）',
].join('\n'), 'utf8')
console.log('MSG 已写')
