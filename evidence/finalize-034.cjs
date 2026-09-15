// 0.3.3 复核（n=4）+ README 第二指标：写文档并提交（幂等）。
// 用法：node evidence/finalize-034.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) CHANGELOG：在 0.3.3 条目内追加 n=4 复核
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
const anchor = '- 规模：极端档 6115 字符（普通档仍 1405）；约束闸门 34 项断言全 PASS。'
const add = [
  '- **n=4 复核（本轮）**：H1 两条件各 4 份 —— **0.3.3 = 2/4 通过 · 发布版 = 0/4**（上轮 n=2 为 1/2 对 0/2，两轮方向一致）；独立审计法线均为 0 内向面。',
  '  诚实标注：样本仍小（n=4），且该差异**只体现在"统一自检入口"这条判据**上；发布版从不满足它，是因为发布版提示词没有这条要求（而非产物法线有问题）。',
  '- 规模：极端档 6115 字符（普通档仍 1405）；约束闸门 34 项断言全 PASS。',
].join('\n')
if (ch.indexOf('n=4 复核') >= 0) console.log('CHANGELOG: 已有 n=4 复核')
else if (ch.indexOf(anchor) >= 0) { ch = ch.replace(anchor, add); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已追加 n=4 复核') }
else console.log('CHANGELOG: 锚点未找到')

// 2) README 第二主指标（标题下那行"最新实测"之后再补一行）
const ZH = '> **产物级第二主指标（v0.3.3-beta.1）**：单文件 HTML 产物必须提供**统一自检入口** `window.__selfcheck()`（返回 `{checks:[{name,pass,evidence}],pass}`）—— H1 法线题两条件各 4 份：**v0.3.3 2/4 通过 · 发布版 0/4**；旧产物基线 **0/14**。独立法线审计两条件均 0 内向面。该指标样本仍小，只作为辅证。'
const EN = '> **Second artifact-level metric (v0.3.3-beta.1)**: single-file HTML artifacts must expose a **unified self-check entry** `window.__selfcheck()` returning `{checks:[{name,pass,evidence}],pass}` — H1 normals task, 4 artifacts per condition: **v0.3.3 2/4 pass vs shipped 0/4**; legacy baseline **0/14**. Independent normals audit: zero inward faces in both conditions. Sample is still small; treat as supporting evidence only.'
for (const [f, line, marker] of [['README.md', ZH, '产物级第二主指标'], ['README.en.md', EN, 'Second artifact-level metric']]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(marker) >= 0) { console.log('SKIP ' + f + '（已有）'); continue }
  const lines = t.split('\n')
  const i = lines.findIndex((l) => l.indexOf('最新实测（v0.3.1-beta.1') >= 0 || l.indexOf('Latest measurement (v0.3.1-beta.1') >= 0)
  const at = i >= 0 ? i + 1 : 2
  lines.splice(at, 0, line)
  fs.writeFileSync(P(f), lines.join('\n'), 'utf8')
  console.log('OK ' + f + '（插入第 ' + (at + 1) + ' 行）')
}

// 3) 提交信息
fs.writeFileSync(path.join(__dirname, 'commit-msg-034.txt'), [
  'test(artifact): H1 提到 n=4 —— 统一自检入口判据 2/4 vs 发布版 0/4（两轮方向一致）',
  '',
  '- 复测：H1 两条件各 4 份产物，0.3.3 通过 2/4、发布版 0/4（上轮 n=2 为 1/2 对 0/2）；独立审计法线均 0 内向面',
  '- 判据：产物是否提供 window.__selfcheck() 且返回 {checks:[{name,pass,evidence}],pass}（0.3.3 起写死的必须项）',
  '- 旧产物基线 0/14；发布版从不满足该判据，是因为其提示词没有这条要求（不是法线有问题）',
  '- 文档：CHANGELOG 0.3.3 条目追加 n=4 复核；README 中英标题区新增"产物级第二主指标"一行（标注样本小、仅作辅证）',
  '- 证据：evidence/cx-034-h1.json（原始产出）、artifact-check.json（判分/失败原因）、artifacts/H1*（8 份）',
].join('\n'), 'utf8')
console.log('MSG 已写')
