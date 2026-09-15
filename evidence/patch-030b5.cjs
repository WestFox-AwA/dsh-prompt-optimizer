// v0.3.0-beta.5 补丁：CHANGELOG 条目 + README（中英）产物级数字更新 + 版本字符串（幂等）。
// 用法：node evidence/patch-030b5.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const P = (f) => path.join(root, f)
const rep = (f, pairs) => {
  let t = fs.readFileSync(P(f), 'utf8')
  let n = 0
  for (const [a, b] of pairs) {
    const c = t.split(a).length - 1
    if (c !== 1) { console.log('  SKIP(' + c + ') ' + f + ': ' + a.slice(0, 36)); continue }
    t = t.split(a).join(b); n += 1
  }
  fs.writeFileSync(P(f), t, 'utf8'); console.log('  ' + f + ' edits=' + n)
}

// 1) CHANGELOG
const CH = [
  '## v0.3.0-beta.5 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**产物级 n=7/条件 + 验证器三项修正 + 一次结论更正**',
  '',
  '1. **产物级采样翻倍到 n=7/条件**（H1 法线盒体 1、H2 操控 2、H3 审计并修复反向面 4）：**发布版 5/7 = 71.4% · v0.3 5/7 = 71.4%（打平）**。',
  '   - H1、H2 两条件**全部通过**，独立审计 inwardFaces 全 0（"该看见的面都看得见"在产物级成立）。',
  '   - H3 两条件各 2/4，**四份失败全部是"接口未暴露到全局"**（验证器取不到几何，无法独立审计）；命令侧 4/4 都已要求该接口 ⇒ 瓶颈在执行 AI 的接口一致性。',
  '   - 如实结论：**产物级目前不区分两个条件**；有区分度的是命令侧（88.9% vs 73.9%）。',
  '2. **验证器三项修正**（上一轮误判的根因，已更正）：',
  '   - "单文件"判定：允许 CDN 引入 three.js，只把"依赖本地外部脚本"视为非单文件；',
  '   - "操控取值可用"：键位值接受字符串 / 数组 / 子映射对象三种形态，灵敏度须 0<s≤1、反转须为布尔（比"只看键名存在"严格）；',
  '   - 题型感知：法线/修复题不把操控项计入失败（H2 操控题才要求）。',
  '   - 自证保持：gold **16/16 PASS**；bad（绕序反转）**FAIL 且独立审计 inwardFaces=12**。',
  '3. **结论更正（诚实标注）**：上一轮曾报告"v0.3 的 H2 产物 0/2、键位在但取值不可用"，并据此声称做了一次优化——复核后确认那是**验证器过严**造成的误判，该"优化"**没有被证据支持**；本版不再声称它带来提升，仅保留"可配置项须给出可校验取值"这一规格澄清。',
  '4. **命令侧（同批，未变）**：无优化 2.2% · 发布版 73.9%（133/180）· v0.3 **88.9%（160/180，目标线）**；配对胜 7 / 负 2 / 平 1；同格重复采样平均极差 0.93 分/18。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.0-beta.5') >= 0) console.log('CHANGELOG: 已有 beta.5')
else { ch = ch.replace('## v0.3.0-beta.4 — 2026/09/15', CH + '## v0.3.0-beta.4 — 2026/09/15'); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 beta.5') }

// 2) README 中英：产物级段落改为最新数字
rep('README.md', [
  ['**产物级验证（单文件 HTML，独立审计，不依赖浏览器）**：H1 法线盒体 / H2 操控 / H3 审计并修复反向面，两条件各 2 次采样 —— **发布版 4/5 = 80% · v0.3 4/5 = 80%**；H1、H2 两条件**各自 100%**（独立审计 `inwardFaces` 全为 0），H3 各 1/2（剩余失败是"接口未暴露到全局"，属执行 AI 的接口一致性）。',
   '**产物级验证（单文件 HTML，独立审计，不依赖浏览器）**：H1 法线盒体 / H2 操控 / H3 审计并修复反向面，**两条件各 7 份产物** —— **发布版 5/7 = 71.4% · v0.3 5/7 = 71.4%（打平）**；H1、H2 两条件**全部通过**（独立审计 `inwardFaces` 全为 0），H3 各 2/4，四份失败**全是"接口未暴露到全局"**（属执行 AI 的接口一致性，命令侧 4/4 都已要求）。**产物级目前不区分两个条件**，有区分度的是命令侧。'],
])
rep('README.en.md', [
  ['**Artifact-level verification (single-file HTML, independent audit, no browser)**: H1 normals box / H2 controls / H3 audit-and-fix inverted faces, 2 samples per condition — **shipped 4/5 = 80% vs v0.3 4/5 = 80%**; H1 and H2 are 100% in both conditions (independent audit: zero inward faces), H3 is 1/2 each (remaining failures are "interface not exposed globally", i.e. the executor side).',
   '**Artifact-level verification (single-file HTML, independent audit, no browser)**: H1 normals box / H2 controls / H3 audit-and-fix inverted faces, **7 artifacts per condition** — **shipped 5/7 = 71.4% vs v0.3 5/7 = 71.4% (tie)**; H1 and H2 pass in both conditions (independent audit: zero inward faces), H3 is 2/4 each and all four failures are "interface not exposed globally" (executor side; the command demanded it 4/4 times). **The artifact level currently does not discriminate between conditions** — the command side does.'],
])

// 3) 版本字符串
for (const [f, from, to] of [['lib/client.js', '0.3.0beta4', '0.3.0beta5'], ['lib/client.js', 'build: "v0.3.0-beta.4"', 'build: "v0.3.0-beta.5"']]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(from).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + from); continue }
  fs.writeFileSync(P(f), t.split(from).join(to), 'utf8'); console.log('VER APPLY ' + f + ' (' + c + ')')
}
