// v0.3.1-beta.1 文档补丁：CHANGELOG 新条目 + README 中英命令侧数字更新（幂等）。
// 用法：node evidence/patch-031.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
const rep = (f, pairs) => {
  let t = fs.readFileSync(P(f), 'utf8'); let n = 0
  for (const [a, b] of pairs) { const c = t.split(a).length - 1; if (c !== 1) { console.log('  SKIP(' + c + ') ' + f + ': ' + a.slice(0, 34)); continue } t = t.split(a).join(b); n += 1 }
  fs.writeFileSync(P(f), t, 'utf8'); console.log('  ' + f + ' edits=' + n)
}

const CH = [
  '## v0.3.1-beta.1 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '> 命名变更：自本版起线性迭代（0.3.1、0.3.2 …），不再使用 v0.4 / 0.3.0-beta.N 这套叫法。',
  '',
  '**"先防后查"跑分定论（同口径 n=2）**',
  '',
  '| 版本（同口径 n=2，10 题/满分 180） | 复杂题 | 配对 | 简单任务回归 |',
  '|---|---|---|---|',
  '| 仅硬闸门（0.3.0-beta.3 口径） | 88.9%（160/180） | 7 胜 / 2 负 / 1 平 | PASS（泄漏 0/4、长度 1.37×→修正后 0.95×） |',
  '| **本版：闸门 + 先防后查** | **93.9%（169/180）** | **9 胜 / 0 负 / 1 平** | **PASS（泄漏 0/4、长度 0.39×、越权索取流程 0/4）** |',
  '| 发布版 0.2.2-beta.1（对照） | 70.8%（127/180） | — | — |',
  '| 无优化（对照） | 2.2%（4/180） | — | — |',
  '',
  '- 噪声：同格重复采样平均极差 **0.83 分/18**（最大 4）。结论表述：**先防后查把硬闸门付出的约 5 分补了回来**（88.9% → 93.9%，配对由 7-2-1 改善到 9-0-1），且简单任务比之前更克制（长度 0.95× → **0.39×**、越权索取流程 0/4）。',
  '- 提示词规模：高级/极端 5755 / 5753 字符（普通档仍 1405，闸门含"普通档不得出现能力包"反向断言）；约束闸门 34 项断言全 PASS。',
  '',
  '**先防后查（本版能力核心）**：① 先押注首要失效 ② 最小可跑切片 + 逐层验收 ③ 机器可判定不变量（几何/交互/数据/并发/性能五域给数值判据） ④ 惯例优先（默认键位取自平台惯例） ⑤ 失败即报告、不许静默降级。详见 0.3.0-beta.5 条目的诊断表。',
  '',
  '**进度可视化**：`node evidence/dashboard.cjs --watch` 每 3 秒重写 `evidence/dashboard.html`（单文件、内嵌数据、浏览器自动刷新），面板含命令侧各条件得分、产物级通过率与分题、数据新鲜度与"近期活动"。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.1-beta.1') >= 0) console.log('CHANGELOG: 已有 0.3.1-beta.1')
else { const anchor = '## v0.3.0-beta.5 — 2026/09/15'; ch = ch.indexOf(anchor) >= 0 ? ch.replace(anchor, CH + anchor) : (CH + '\n' + ch); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 0.3.1-beta.1') }

rep('README.md', [
  ['**换算满分 144 → 131**', '**换算满分 180 → 169**'],
  ['| **0.2.1-beta.2（修完两个"推活"缺陷）** | **10** | **10** | **10**（高级档） |', '| **0.3.1（先防后查）** | **93.9%** | **169/180** | **9 胜 0 负 1 平** |'],
])
rep('README.en.md', [
  ['**0.2.1-beta.2 (after the two "push-back" fixes)** | **10** | **10** | **10** (Advanced) |', '**0.3.1 (prevent-then-check)** | **93.9%** | **169/180** | **9W-0L-1T** |'],
])
