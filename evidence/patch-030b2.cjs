// v0.3.0-beta.2 收尾补丁：ACCEPTANCE 数字更新 + 版本字符串切换（幂等）。
// 用法：node evidence/patch-030b2.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const P = (f) => path.join(root, f)

// 1) ACCEPTANCE：题量/满分/实测数字
let acc = fs.readFileSync(P('ACCEPTANCE.md'), 'utf8')
const ACC_EDITS = [
  ['8 道题 × 6 条要点 × 4 档', '10 道题 × 6 条要点 × 4 档'],
  ['**全表满分 144**', '**全表满分 180**'],
  ['| X1 | 复杂任务总分（8 题 × 2 次采样 = 48 格，并发 4） | `cxlab` + `cx-grade.cjs` | 无优化 6/288（换算 3/144）· 发布版 201/288 = **69.8%**（101/144，及格线）· **v0.3 265/288 = 92.0%**（132/144，**目标线**）；全程 **230 秒** |',
    '| X1 | 复杂任务总分（10 题 × 2 次采样 = 60 格，并发 4） | `cxlab` + `cx-grade.cjs` | 无优化 8/360（换算 4/180）· 发布版 273/360 = **75.8%**（136/180，及格线）· **v0.3 325/360 = 90.3%**（163/180，**目标线**）；全程 **289 秒** |'],
  ['| X6 | 已知边界（如实） | — | ① 测的是**命令侧**（优化器要求工作 AI 做什么），不是最终产物质量；答案侧对复杂题的评分成本高，本轮未做全量；② 单格 n=2，个别格仍可能差 1~2 分；③ C6（数据迁移）发布版已满分，该题不再有区分度 |',
    '| X6 | 答案侧首轮（5 题 × 3 条件 = 15 格，relay→solve→judge） | `cx-answer-grade.cjs` | 无优化 51.1% · **v0.3 47.8%** · 发布版 23.3%；数据/持久化题 v0.3 **17/18 vs 发布版 0/18**。**局限**：执行 AI 无工具，3D 题全体贴地板、"无优化"因输出宽泛虚高 → 只作辅证 |\n| X7 | 已知边界（如实） | — | ① 主指标是**命令侧**（优化器要求工作 AI 做什么），不等于最终产物质量；② 单格 n=2，同格平均极差 1.07 分/18（最大 7），C3/C9 的 −1 在噪声内；③ C5/C6 双方均满分，这两题已无区分度 |'],
]
let n = 0
for (const [a, b] of ACC_EDITS) {
  const c = acc.split(a).length - 1
  if (c !== 1) { console.log('ACC SKIP(' + c + '): ' + a.slice(0, 36)); continue }
  acc = acc.split(a).join(b); n += 1
}
fs.writeFileSync(P('ACCEPTANCE.md'), acc, 'utf8')
console.log('ACCEPTANCE edits: ' + n + '/' + ACC_EDITS.length)

// 2) 版本字符串：0.2.2 → 0.3.0 的遗留（client.js 面板署名 / build 标记）
const VER = [
  ['lib/client.js', '0.3.0beta1', '0.3.0beta2'],
  ['lib/client.js', 'build: "v0.3.0-beta.1"', 'build: "v0.3.0-beta.2"'],
]
for (const [f, from, to] of VER) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('VER SKIP ' + f + ' (' + to + ')'); continue }
  const c = t.split(from).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + from); continue }
  fs.writeFileSync(P(f), t.split(from).join(to), 'utf8')
  console.log('VER APPLY ' + f + ' ' + from + ' → ' + to + ' (' + c + ')')
}
