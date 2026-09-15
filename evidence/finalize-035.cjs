// 0.3.5 轮：把 H2 复测结果写进 CHANGELOG 与 README（幂等），并生成提交信息。
// 用法：node evidence/finalize-035.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) CHANGELOG：在 0.3.3 条目内把复核扩到两题
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
const old = '- **n=4 复核（本轮）**：H1 两条件各 4 份 —— **0.3.3 = 2/4 通过 · 发布版 = 0/4**（上轮 n=2 为 1/2 对 0/2，两轮方向一致）；独立审计法线均为 0 内向面。'
const neu = [
  '- **n=4 复核（两题，同一把尺子）**：',
  '  - H1 法线盒体：**0.3.3 = 2/4 通过 · 发布版 = 0/4**（上轮 n=2 为 1/2 对 0/2）；独立审计法线均为 0 内向面。',
  '  - H2 操控题：**0.3.3 = 2/4 通过 · 发布版 = 0/4**；独立审计法线均为 0 内向面。',
  '  - 合计：**0.3.3 = 4/12（33.3%）· 发布版 = 0/12（0%）**；旧产物基线 0/14。判据相同：产物是否提供 `window.__selfcheck()` 且返回 `{checks:[{name,pass,evidence}],pass}`。',
].join('\n')
if (ch.indexOf('H2 操控题：**0.3.3 = 2/4') >= 0) console.log('CHANGELOG: 已含 H2 复核')
else if (ch.indexOf(old) >= 0) { ch = ch.replace(old, neu); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已扩为两题') }
else console.log('CHANGELOG: 锚点未找到')

// 2) README：把第二主指标行更新为两题合计
const ZH_OLD_START = '> **产物级第二主指标（v0.3.3-beta.1）**'
const ZH_NEW = '> **产物级第二主指标（v0.3.3-beta.1）**：单文件 HTML 产物必须提供**统一自检入口** `window.__selfcheck()`（返回 `{checks:[{name,pass,evidence}],pass}`）—— 同一把尺子两题各 4 份：H1 法线 **2/4 对 0/4**、H2 操控 **2/4 对 0/4**，合计 **v0.3.3 4/12（33.3%）· 发布版 0/12（0%）**；旧产物基线 **0/14**。独立法线审计两条件均 0 内向面。样本仍小，仅作辅证。'
const EN_NEW = '> **Second artifact-level metric (v0.3.3-beta.1)**: single-file HTML artifacts must expose a **unified self-check entry** `window.__selfcheck()` returning `{checks:[{name,pass,evidence}],pass}` — same yardstick, 4 artifacts per task per condition: H1 normals **2/4 vs 0/4**, H2 controls **2/4 vs 0/4**, total **v0.3.3 4/12 (33.3%) vs shipped 0/12 (0%)**; legacy baseline **0/14**. Independent normals audit: zero inward faces in both conditions. Small sample; supporting evidence only.'
for (const [f, startMarker, newLine] of [['README.md', ZH_OLD_START, ZH_NEW], ['README.en.md', '> **Second artifact-level metric', EN_NEW]]) {
  let t = fs.readFileSync(P(f), 'utf8')
  const lines = t.split('\n')
  const i = lines.findIndex((l) => l.indexOf(startMarker) === 0)
  if (i < 0) { console.log('README ' + f + ': 未找到旧行'); continue }
  lines[i] = newLine
  fs.writeFileSync(P(f), lines.join('\n'), 'utf8')
  console.log('README ' + f + ': 已更新为两题合计')
}

// 3) 提交信息
fs.writeFileSync(path.join(__dirname, 'commit-msg-035.txt'), [
  'test(artifact): 统一自检入口判据跨题型复测 —— H2 操控 2/4 vs 发布版 0/4（两题合计 4/12 对 0/12）',
  '',
  '- H1 法线盒体：0.3.3 2/4 · 发布版 0/4（上轮 n=2 为 1/2 对 0/2）',
  '- H2 操控题：0.3.3 2/4 · 发布版 0/4（本轮新增，同一把尺子）',
  '- 合计：0.3.3 4/12 = 33.3% · 发布版 0/12 = 0% · 旧产物基线 0/14；独立法线审计两条件均 0 内向面',
  '- 判据：产物是否提供 window.__selfcheck() 且返回 {checks:[{name,pass,evidence}],pass}（0.3.3 起写死）',
  '- 诚实标注：样本小（每格 n=4），差异只体现在该判据上，不外推为产物质量整体提升',
  '- 文档：CHANGELOG 复核扩为两题；README 中英第二指标行更新为两题合计',
  '- 证据：evidence/cx-035-h2.json（原始产出）、artifact-check.json、artifacts/（24 份）',
].join('\n'), 'utf8')
console.log('MSG 已写')
