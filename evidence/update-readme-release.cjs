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
    '### v0.4.5-beta.1 —— 本版：优化 AI 思考强度可选（适配所有模型）',
    '',
    '- **新增**：优化模型弹层里多了一个「优化 AI 思考强度」选择行，档位来自**模型自己声明的**能力（`llm.resolveModelInfo` → `reasoning.efforts` / `defaultEffort`），不硬编码；模型没声明档位时显示"保持模型默认"。',
    '- 取值语义：`模型默认` = 不显式设置（交给适配器默认，实测 deepseek-flash 为 `high`）；其余为显式档位。换到不支持所选档位的模型时自动回落为"模型默认"，避免下一次调用被拒。',
    '- 落到调用的方式：`llm.stream({ provider, model, reasoningEffort, ... })`；未选时不传该字段（保持历史行为不变）。每次运行的 `/runs` 记录新增 `effort` 字段，用于核对"设置是否真的生效"。',
    '- 验证（`evidence/verify-effort.cjs`）：9 次真实调用中，`/runs` 记录的 `effort` 与设置值**逐次一致**（off/off/off、max/max/max、未设置为空）；适配器层 `resolveCallConfig` 对 off/low/high/max 原样保留、对非法值明确报错 ⇒ **设置确实进入模型调用**。',
    '- 如实说明：该 provider **不上报 reasoning tokens**，且单次"思考字数"噪声很大（同档位内 1956–10377 波动），因此**行为层面的强度差异尚未被证实**；要测量需更多次数或换用上报 reasoning tokens 的 provider。',
    '',
  ],
  en: [
    '### v0.4.5-beta.1 — this release: optimizer reasoning effort is selectable (works for every model)',
    '',
    '- **New**: the optimizer-model popover gains an "Optimizer reasoning effort" row. The levels come from what the **model itself declares** (`llm.resolveModelInfo` -> `reasoning.efforts` / `defaultEffort`) — nothing hard-coded; a model that declares none shows "keeping the model default".',
    '- Semantics: `Model default` = do not set explicitly (use the adapter default; measured `high` for deepseek-flash); other entries are explicit levels. Switching to a model that does not support the chosen level falls back to "model default" so the next call is never rejected.',
    '- How it reaches the call: `llm.stream({ provider, model, reasoningEffort, ... })`; when unset the field is not sent (historic behaviour preserved). Each run now records `effort` in `/runs` so the setting can be audited.',
    '- Verification (`evidence/verify-effort.cjs`): across 9 real calls the recorded `effort` matched the setting every time (off/off/off, max/max/max, empty when unset); at the adapter level `resolveCallConfig` preserves off/low/high/max and rejects an invalid value outright -> **the setting does reach the model call**.',
    '- Honest caveat: this provider **does not report reasoning tokens**, and single-run "reasoning chars" are very noisy (1956-10377 within one level), so a behavioural difference in effort is **not yet demonstrated**; measuring it needs more repetitions or a provider that reports reasoning tokens.',
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
