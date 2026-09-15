// 在 README 标题行下补一行"最新实测（v0.3.1-beta.1）"，避免旧表格数字造成误读（幂等）。
// 用法：node evidence/patch-readme-top.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
const ZH = '> **最新实测（v0.3.1-beta.1 · 同口径 n=2）**：命令侧 10 道复杂题/满分 180 → **169 分（93.9%）**，发布版对照 127 分（70.8%）、无优化 4 分（2.2%）；配对 **9 胜 / 0 负 / 1 平**，同格噪声平均极差 0.83 分/18（最大 4）。简单任务回归：复杂包泄漏 **0/4**、命令长度 **0.39×**（比发布版更短）、越权索取流程 0/4。评分卡为 0~3 四档细分、确定性判分（不额外消耗 LLM 调用）。'
const EN = '> **Latest measurement (v0.3.1-beta.1, same-caliber n=2)**: command side, 10 complex tasks / max 180 → **169 (93.9%)**; shipped build 127 (70.8%); no-optimization 4 (2.2%). Paired **9W / 0L / 1T**; per-cell noise 0.83 points of 18 on average (max 4). Simple-task regression: zero leakage (0/4), command length **0.39x** (shorter than shipped), no extra process demands. Scoring is a 0-3 four-level rubric graded deterministically (no extra LLM calls).'
for (const [f, line] of [['README.md', ZH], ['README.en.md', EN]]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf('最新实测（v0.3.1-beta.1') >= 0 || t.indexOf('Latest measurement (v0.3.1-beta.1') >= 0) { console.log('SKIP ' + f + '（已有）'); continue }
  const lines = t.split('\n')
  const i = lines.findIndex((l) => l.trim().startsWith('# '))
  if (i < 0) { console.log('MISS ' + f + '（无标题行）'); continue }
  lines.splice(i + 1, 0, '', line)
  fs.writeFileSync(P(f), lines.join('\n'), 'utf8')
  console.log('OK ' + f + '（已插入第 ' + (i + 2) + ' 行）')
}
