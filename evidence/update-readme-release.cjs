// README 版本同步：node evidence/update-readme-release.cjs <version> [--write]
// 做四件事（中英两份 README 同时）：
//   ① 标题版本号 ② 安装示例里的 tgz 文件名 ③ 历史段插入本版条目 ④ 作者行的版本/日期
// 说明：条目正文按版本内置（这里是 0.4.4-beta.1）；换版本时改 NOTE 即可。
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')

const ver = process.argv[2] || '0.4.4-beta.1'
const write = process.argv.includes('--write')
const date = '2026/09/18'

const NOTE = {
  zh: [
    '### v0.4.6-beta.5 —— 本版：思考强度**真正生效**（含守卫与可证伪验证）',
    '',
    '- **接线**：正式优化路径此前**从不发送** `reasoningEffort`（只有内部自检路径 `streamOnce` 会发），所以弹层里的档位一直是装饰品，`/runs.effort` 记的也只是配置值。现在真发，并新增 **`effortSent`（实发值）** 与 `effortNote`（未发原因）供核对。',
    '- **守卫**：**只在该模型确实声明了该档位时才发**——换过模型后残留的档位不会再让正式优化直接失败。七个分支有确定性单测（含本机跑不到的"模型声明了档位但缺 `max`"）。',
    '- **实测**（同一请求、各 4 次；`evidence/effort-live.json`）：`off` 组思考文本 **0 / 0 / 0 / 0 字**，`max` 组 **3260 / 1974 / 2193 / 2274 字（中位 2234）**，两组 `effortSent` 分别是 `"off"` / `"max"` —— **类别级差异**，证明该字段确实抵达了模型。',
    '- **更正一条旧结论**：v0.4.5 写的"off 均值 8745 / max 8300，行为层面的强度差异尚未被证实"——那三组当时**实际发出去的东西完全一样**，差异纯属噪声；README 对应历史条目已加更正注。',
    '- 弹层提示补一句"该模型未声明所选档位时不会发送"。其余一切未动：`delivery=chat` 三档 system 仍**逐字节不变**（15/15），投影不变式与 i18n parity 回归全过。',
    '',
  ],
  en: [
    '### v0.4.6-beta.5 — this release: reasoning effort **actually takes effect** (with a guard and a falsifiable check)',
    '',
    '- **Wiring**: the live optimization path **never sent** `reasoningEffort` (only the internal self-check path `streamOnce` did), so the popover level was decorative and `/runs.effort` recorded the configured value only. It is now really sent, and `/runs` additionally reports **`effortSent`** (what was actually sent) and `effortNote` (why nothing was sent).',
    '- **Guard**: the field is sent **only when the model actually declares that level** — a leftover level from a previous model can no longer make a real optimization fail. Seven branches are pinned by a deterministic unit test (including "declares levels but not `max`", which this machine\u2019s model catalog cannot produce).',
    '- **Measured** (same request, 4 runs each; `evidence/effort-live.json`): the `off` group produced **0 / 0 / 0 / 0 chars** of reasoning, the `max` group **3260 / 1974 / 2193 / 2274 (median 2234)**, with `effortSent` of `"off"` / `"max"` respectively — a **categorical difference**, proving the field reaches the model.',
    '- **A previous conclusion corrected**: v0.4.5 reported "off avg 8745 / max 8300, behavioural difference not yet demonstrated" — those three groups **actually sent exactly the same thing**, so the difference was pure noise; the corresponding README history entry now carries a correction note.',
    '- The popover hint gained "not sent when this model does not declare the selected level". Nothing else moved: with `delivery=chat` all three tiers still render **byte-identically** (15/15), and the projection invariant plus i18n parity regressions all pass.',
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
