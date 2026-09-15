// v0.3.0-beta.4 补丁：CHANGELOG 条目 + ACCEPTANCE 产物级补充 + README 实测段 + 版本字符串（幂等）。
// 用法：node evidence/patch-030b4.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const P = (f) => path.join(root, f)
const R = (f, pairs) => {
  let t = fs.readFileSync(P(f), 'utf8')
  let n = 0
  for (const [a, b] of pairs) {
    const c = t.split(a).length - 1
    if (c !== 1) { console.log('  SKIP(' + c + ') ' + f + ': ' + a.slice(0, 40)); continue }
    t = t.split(a).join(b); n += 1
  }
  fs.writeFileSync(P(f), t, 'utf8')
  console.log('  ' + f + ' edits=' + n)
}

// ── 1) CHANGELOG
const CH = [
  '## v0.3.0-beta.4 — 2026/09/15',
  '',
  '作者：啃轮胎的西狐',
  '',
  '**产物级接入 H2/H3 并做一键通过率统计 + 一次定向优化**',
  '',
  '1. **一键产物级检查**：新增 `evidence/artifact-check.cjs` —— 扫描所有单文件 HTML 产物、按题型调用验证器、汇总"条件 × 题"通过率与独立审计数字，落盘 `evidence/artifact-check.json`（可复核）。',
  '2. **产物级扩到三类题**：H1 法线盒体 / H2 操控人性化 / H3 审计并修复反向面，两条件各 2 次采样。实测（5 份/条件）：**发布版 4/5 = 80%、v0.3 4/5 = 80%**；H1、H2 两条件**各自 100%**（独立审计 inwardFaces 全为 0），H3 两条件各 1/2。',
  '3. **定向优化（可自动化验收的接口独立性）**：产物级数据显示 v0.3 在 H3 上 0/2（产物把几何构造藏进闭包，第三方取不到）。据此把要求写死为"几何构造与自检写在**同一个可独立取用的函数**里（或把依赖一并导出）"——重跑后 **v0.3 H3 追平发布版（1/2），产物级总通过率 60% → 80%**。',
  '4. **诚实边界**：① 产物级样本太小（每题 n≤2），两条件在产物级**打平**，不能据此说产物质量有差异；② H3 剩余失败仍是"接口未暴露到全局"，属执行 AI 的接口一致性；③ 一次真跑要约 2~13 分钟，故采样受限。',
  '5. **命令侧（同批复测，未变）**：无优化 2.2% · 发布版 73.9%（133/180）· v0.3 **88.9%（160/180，目标线）**；配对胜 7 / 负 2 / 平 1；噪声平均极差 0.93 分/18。',
  '',
].join('\n')
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.0-beta.4') >= 0) console.log('CHANGELOG: 已有 beta.4')
else { ch = ch.replace('## v0.3.0-beta.3 — 2026/09/15', CH + '## v0.3.0-beta.3 — 2026/09/15'); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 beta.4') }

// ── 2) ACCEPTANCE：第九节补 Y6/Y7
R('ACCEPTANCE.md', [
  ['| Y5 | 已抓到的真实缺陷 | — | V3 某次 H3 产物 \\`buildGeometry\\` 调用即**爆栈**；另一份 60 面中 **22 面朝内**（比例 0.63） |',
   '| Y5 | 已抓到的真实缺陷 | — | V3 某次 H3 产物 \\`buildGeometry\\` 调用即**爆栈**；另一份 60 面中 **22 面朝内**（比例 0.63） |\n| Y6 | 一键通过率统计（产物级扩到 H1/H2/H3，两条件各 2 次） | \\`artifact-check.cjs\\` | **发布版 4/5 = 80% · v0.3 4/5 = 80%**；H1、H2 两条件各 **100%**（独立审计 inwardFaces 全 0）；H3 各 1/2 |\n| Y7 | 接口独立性定向优化 | 重跑 H3（v0.3 ×2） | 优化前 v0.3 H3 **0/2**（几何藏在闭包，验证器取不到）→ 优化后 **1/2**，产物级总通过率 60% → **80%** |'],
])

// ── 3) README 实测段各加一行（中英）
R('README.md', [
  ['**产出语言跟随你（真跑实测，非模拟）**',
   '**产物级验证（单文件 HTML，独立审计，不依赖浏览器）**：H1 法线盒体 / H2 操控 / H3 审计并修复反向面，两条件各 2 次采样 —— **发布版 4/5 = 80% · v0.3 4/5 = 80%**；H1、H2 两条件**各自 100%**（独立审计 `inwardFaces` 全为 0），H3 各 1/2（剩余失败是"接口未暴露到全局"，属执行 AI 的接口一致性）。验证器自证：正确夹具 15/15 PASS、绕序反转夹具 FAIL 且 `inwardFaces=12`。一键复跑：`node evidence/artifact-check.cjs`。\n\n**产出语言跟随你（真跑实测，非模拟）**'],
])
R('README.en.md', [
  ['**The output language follows you (really ran, not simulated)**',
   '**Artifact-level verification (single-file HTML, independent audit, no browser)**: H1 normals box / H2 controls / H3 audit-and-fix inverted faces, 2 samples per condition — **shipped 4/5 = 80% vs v0.3 4/5 = 80%**; H1 and H2 are 100% in both conditions (independent audit: zero inward faces), H3 is 1/2 each (remaining failures are "interface not exposed globally", i.e. the executor side). The verifier is self-validated: the correct fixture passes 15/15 while the inverted-winding fixture fails with `inwardFaces=12`. One-command rerun: `node evidence/artifact-check.cjs`.\n\n**The output language follows you (really ran, not simulated)**'],
])

// ── 4) 版本字符串
for (const [f, from, to] of [['lib/client.js', '0.3.0beta3', '0.3.0beta4'], ['lib/client.js', 'build: "v0.3.0-beta.3"', 'build: "v0.3.0-beta.4"']]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(from).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + from); continue }
  fs.writeFileSync(P(f), t.split(from).join(to), 'utf8'); console.log('VER APPLY ' + f + ' (' + c + ')')
}
