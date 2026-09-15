// v0.3.3 发布准备：版本串 + CHANGELOG 条目 + 提交信息文件。
// 用法：node evidence/prep-033.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
for (const [f, a, b] of [
  ['lib/client.js', '0.3.2beta1', '0.3.3beta1'],
  ['lib/client.js', 'build: "v0.3.2-beta.1"', 'build: "v0.3.3-beta.1"'],
  ['package.json', '"version":  "0.3.2-beta.1"', '"version":  "0.3.3-beta.1"'],
  ['package.json', '（v0.3.2-beta.1 · 复杂任务能力包', '（v0.3.3-beta.1 · 复杂任务能力包'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(b) >= 0 && t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(a).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + a); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' (' + c + ')')
}
const CH = [
  '## v0.3.3-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**把"统一自检入口"写死（不留"或等价"口子），并测到该判据上的真实变化**',
  '',
  '- 改动：`⑦ 统一自检入口` 由"如 `window.__selfcheck()` 或等价"改为**写死**——必须提供 `window.__selfcheck()`，返回 `{checks:[{name,pass,evidence}],pass}`（每项带证据字符串、顶层 pass 为全部通过的布尔），**交付必须附真实运行输出**；只给 `__selftest` 等单项函数、或换个名字，都算未交付。',
  '- 动机（上轮基线）：14 份既有产物 **0/14** 提供统一自检入口 —— "或等价"的写法在实践中没有被执行，导致第三方无法复跑（这正是产物级失败的根因）。',
  '',
  '**复测（新判据：统一自检入口 + 独立法线审计）**',
  '',
  '| 条件 | H1 产物通过 | 独立审计 inwardFaces |',
  '|---|---|---|',
  '| 发布版 0.2.2-beta.1 | **0/2** | [0, 0]（法线本身正确） |',
  '| **0.3.3-beta.1** | **1/2** | [0, 0]（法线本身正确） |',
  '| （上轮基线：全部 14 份旧产物） | 0/14 | — |',
  '',
  '- **诚实标注**：样本很小（H1 两条件各 2 份），提升只体现在"统一自检入口"这一判据上（0/2 → 1/2），**不能外推为"产物质量整体提升"**；法线审计在发布版与候选版都已是 0 内向面（即该题的法线正确性本来就达标）。',
  '- 另记：发布版有一份 H1 产物只有 167 字节（执行 AI 基本没产出），属执行侧失败，未计入判据结论。',
  '- 规模：极端档 6115 字符（普通档仍 1405）；约束闸门 34 项断言全 PASS。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.3-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.3')
else { const a = '## v0.3.2-beta.1 — 2026/09/15'; ch = ch.indexOf(a) >= 0 ? ch.replace(a, CH + a) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.3') }
fs.writeFileSync(path.join(__dirname, 'commit-msg-033.txt'), [
  'feat(prompt): v0.3.3-beta.1 —— 统一自检入口写死（0/14 基线 → H1 1/2）',
  '',
  '- ⑦ 由"如 window.__selfcheck() 或等价"改为写死：必须 window.__selfcheck() 返回 {checks:[{name,pass,evidence}],pass}，',
  '  每项带证据字符串、顶层 pass 布尔；交付必须附真实运行输出；只给 __selftest 等单项函数算未交付',
  '- 动机：上轮基线显示 14 份既有产物 0/14 提供统一自检入口（"或等价"在实践中不被执行），第三方因此无法复跑',
  '- 复测（新判据，H1 两条件各 2 份）：0.3.3 1/2 · 发布版 0/2 · 旧产物 0/14；独立审计 inwardFaces 两条件均 [0,0]',
  '- 诚实标注：样本小，提升仅体现在该判据上，不外推为产物质量整体提升；发布版一份 H1 产物仅 167 字节（执行侧失败）',
  '- 规模：极端档 6115 字符；约束闸门 34 项断言全 PASS；版本串 0.3.3beta1 / build v0.3.3-beta.1',
].join('\n'), 'utf8')
console.log('MSG 已写')
