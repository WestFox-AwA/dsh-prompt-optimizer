// README 版本同步：node evidence/update-readme-release.cjs <version> [--write]
// 做四件事（中英两份 README 同时）：
//   ① 标题版本号 ② 安装示例里的 tgz 文件名 ③ 历史段插入本版条目 ④ 作者行的版本/日期
// 说明：条目正文按版本内置（这里是 0.4.4-beta.1）；换版本时改 NOTE 即可。
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')

const ver = process.argv[2] || '0.4.4-beta.1'
const write = process.argv.includes('--write')
const date = '2026/09/17'

const NOTE = {
  zh: [
    '### v0.4.5-beta.2 —— 本版：思考强度文字溢出修复',
    '',
    '- **修复（UI）**：弹层里的「优化 AI 思考强度」一行原先复用 `.dpo-pop-foot`（无 `flex-wrap`）+ `.dpo-btn`（`flex:1`），五个档位把文字挤出弹层。现改用专用样式 `.dpo-effort-row` / `.dpo-effort-btn`：**可换行 + 省略号 + `max-width:100%`**，档位标签只留档位名（"（模型默认档）"移入悬停提示），并在上方单独一行给出"不选则用模型默认：x"。',
    '- 结构验证：`text-overflow:ellipsis` 命中 8 处、`max-width:100%` 命中、`dpo-effort-btn` 标记已替换、旧的 `dpo-pop-foot`+effort-row 写法残留 0。',
    '- 功能重新验证：每档真跑 2 次，`/runs` 记录的 `effort` 与设置**逐次一致**（off/off、max/max、未设置为空）⇒ 修复未影响设置链路。',
    '- 行为层（思考字数）仍受噪声主导（off 均值 8745 / max 8300 / 未设置 2788），**仍不下结论**；该 provider 不上报 reasoning tokens。',
    '',
  ],
  en: [
    '### v0.4.5-beta.2 — this release: text overflow fix for the effort row',
    '',
    '- **UI fix**: the "Optimizer reasoning effort" row reused `.dpo-pop-foot` (no `flex-wrap`) plus `.dpo-btn` (`flex:1`), so five levels pushed the text outside the popover. It now uses dedicated `.dpo-effort-row` / `.dpo-effort-btn` styles: **wrapping + ellipsis + `max-width:100%`**; level labels keep only the level name ("(model default)" moved into the tooltip) and a separate line shows "unset uses the model default: x".',
    '- Structural check: `text-overflow:ellipsis` in 8 places, `max-width:100%` present, `dpo-effort-btn` markup in place, and zero leftovers of the old `dpo-pop-foot` + effort-row combination.',
    '- Feature re-verified: 2 real runs per level; the `effort` recorded in `/runs` matched the setting every time (off/off, max/max, empty when unset) — the fix did not disturb the setting path.',
    '- Behaviour (reasoning chars) is still noise-dominated (off avg 8745 / max 8300 / unset 2788), so **still no conclusion**; this provider does not report reasoning tokens.',
    '',
  ],
}

const AUTHOR = {
  zh: '作者：**啃轮胎的西狐** · 版本 **' + ver + '** · 版本日期 **' + date + '**（插件内 `?` 面板最底部也有同样署名）',
  en: 'Author: **啃轮胎的西狐** · version **' + ver + '** · date **' + date + '** (the same credit also sits at the bottom of the in-plugin `?` panel)',
}

for (const [file, lang] of [['README.md', 'zh'], ['README.en.md', 'en']]) {
  const p = path.join(REPO, file)
  let lines = fs.readFileSync(p, 'utf8').split('\n')
  const before = lines.slice()
  // ① 标题版本
  lines[0] = lines[0].replace(/\*\*v[0-9][^*]*\*\*/, '**v' + ver + '**')
  // ② 安装示例 tgz
  let tgzFixed = 0
  for (let i = 0; i < lines.length; i++) {
    if (/dsh-external-dsh-prompt-optimizer-[0-9][^\s`]*\.tgz/.test(lines[i])) {
      const nv = lines[i].replace(/dsh-external-dsh-prompt-optimizer-[0-9][^\s`]*\.tgz/g, 'dsh-external-dsh-prompt-optimizer-' + ver + '.tgz')
      if (nv !== lines[i]) { lines[i] = nv; tgzFixed++ }
    }
  }
  // ③ 历史段插入（插在本版之前；若已存在则跳过）
  const marker = '### v' + ver
  if (!lines.some((l) => l.startsWith(marker))) {
    const at = lines.findIndex((l) => /^### v0\.[0-9]/.test(l))
    if (at >= 0) lines = lines.slice(0, at).concat(NOTE[lang], lines.slice(at))
  }
  // ④ 作者行
  let authorFixed = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('作者：') || lines[i].startsWith('Author:')) {
      lines[i] = AUTHOR[lang]
      authorFixed++
      break
    }
  }
  console.log('--- ' + file + ' ---')
  console.log('  ① 标题 → ' + lines[0].slice(0, 58))
  console.log('  ② 安装示例 tgz 修正 ' + tgzFixed + ' 处')
  console.log('  ③ 本版条目 ' + (lines.some((l) => l.startsWith(marker)) ? '已存在/已插入' : '未插入 ✗') + '；行数 ' + before.length + ' → ' + lines.length)
  console.log('  ④ 作者行修正 ' + authorFixed + ' 处')
  if (write) { fs.writeFileSync(p, lines.join('\n'), 'utf8'); console.log('  已写入 ✓') }
}
if (!write) console.log('\n（干跑；加 --write 实际写入）')
