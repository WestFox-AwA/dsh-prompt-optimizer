// 一次性维护脚本：把两份 README 里"按 0.2/0.3 写的过期版本史 + 旧版本字样"换成 0.4 系列的现状说明。
// 用法：node evidence/update-readme-history.cjs           干跑
//       node evidence/update-readme-history.cjs --write   写入
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')
const VER = 'v0.4.3-beta.1'

const ZH = [
  '### v0.4.3-beta.1 —— 本版：需求补全器（0.4 系列）',
  '',
  '- **策略换代**：从"改写器"（0.1）改为"需求补全器"（0.4）——把用户一句 10–200 字的请求，补成一份完整具体的要求说明（对象、结果、使用情形、边界、范围）。',
  '- **不写流程**：不写步骤、不写验收清单、不写验证纪律、不写禁令——这些是下游 AI 自己的能力；写进去只会占它的注意力预算、收束它的解法空间。',
  '- **体量**：系统提示词 515 字符（0.3.x 为 6478）；同一句请求的产出 422 字符（0.4 → 0.4.1 → 0.4.3：4588 → 2164 → 422），管理性文字全 0。',
  '- 推导与实测见 `evidence/ARCHITECTURE-v5.md`；更早版本的逐项变更见 `CHANGELOG.md`。',
  '',
  '作者：**啃轮胎的西狐** · 版本 **0.4.3-beta.1** · 版本日期 **2026/09/16**（插件内 `?` 面板最底部也有同样署名）',
]
const EN = [
  '### v0.4.3-beta.1 — this release: a requirement completer (0.4 line)',
  '',
  '- **Strategy replaced**: from a rewriter (0.1) to a requirement completer (0.4) — a single 10–200 character request becomes a complete, concrete statement of what is wanted (object, result, usage situations, edges, scope).',
  '- **No workflow**: no steps, no acceptance checklist, no verification discipline, no prohibitions — those are the downstream AI\'s own abilities; writing them costs attention budget and narrows the solution space.',
  '- **Size**: system prompt 515 chars (0.3.x: 6478); output for the same request 422 chars (0.4 -> 0.4.1 -> 0.4.3: 4588 -> 2164 -> 422), management prose zero.',
  '- Derivation and measurements: `evidence/ARCHITECTURE-v5.md`; per-version details: `CHANGELOG.md`.',
  '',
  'Author: **啃轮胎的西狐** · version **0.4.3-beta.1** · date **2026/09/16** (the same credit also sits at the bottom of the in-plugin `?` panel)',
]

const START = ['### v0.3.0-beta.1', '### v0.3.0-beta.1']
const END = ['作者：**啃轮胎的西狐** · 版本', 'Author: **啃轮胎的西狐**']
const CUR = ['当前此插件版本', 'current version of this plugin']
const write = process.argv.includes('--write')

const jobs = [
  { file: 'README.md', block: ZH, start: START[0], end: END[0], cur: CUR[0] },
  { file: 'README.en.md', block: EN, start: START[1], end: END[1], cur: CUR[1] },
]
for (const job of jobs) {
  const p = path.join(REPO, job.file)
  const lines = fs.readFileSync(p, 'utf8').split('\n')
  const si = lines.findIndex((l) => l.includes(job.start))
  let ei = -1
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes(job.end)) { ei = i; break }
  console.log('--- ' + job.file + ' ---')
  if (si < 0 || ei < 0 || ei < si) { console.log('  ⚠️ 没找到版本史区间（start=' + si + ' end=' + ei + '），跳过'); continue }
  const out = lines.slice(0, si).concat(job.block, lines.slice(ei + 1))
  console.log('  版本史区间：第 ' + (si + 1) + '–' + (ei + 1) + ' 行（' + (ei - si + 1) + ' 行）→ ' + job.block.length + ' 行新内容')
  let curFixed = 0
  for (let i = 0; i < out.length; i++) {
    if (out[i].includes(job.cur)) {
      const before = out[i]
      out[i] = out[i].replace(/v\d+\.\d+\.\d+(?:-beta\.\d+)?/g, VER)
      if (out[i] !== before) { curFixed++; console.log('  「' + job.cur + '」行版本号 → ' + VER + '（第 ' + (i + 1) + ' 行）') }
    }
  }
  console.log('  修正"当前版本"字样 ' + curFixed + ' 处；总行数 ' + lines.length + ' → ' + out.length)
  if (write) { fs.writeFileSync(p, out.join('\n'), 'utf8'); console.log('  已写入 ✓') }
}
if (!write) console.log('\n（干跑；加 --write 实际写入）')
