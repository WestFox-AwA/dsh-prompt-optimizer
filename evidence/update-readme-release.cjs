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
    '### v0.4.6-beta.1 —— 本版：只读查证 / 观察者上下文 / 预算与压缩（三步改造）',
    '',
    '- **只读查证**：弹层开关（高级/极端档生效）打开后，优化 AI 会**真的读项目**再写要求。修复了一个接线缺陷——把消息数组当字符串传进工具循环，导致 provider 报 `messages[0].content: invalid type: sequence`。实测 ON = 10 次真实工具调用且产出含真实目录结构；读了没找到时**如实说明**，不编造。',
    '- **观察者上下文**：优化 AI 现在能像旁观者一样看这段会话——数据走会话**投影**（会话 AI 真正看到的消息），不是事件重放；`turns` = 最近 10 回合**双方全文**，`full` = 整个投影，`off` = 关闭。注入方式是**结构参数进 system**，不污染你的原话。',
    '- **预算与压缩**：上下文超预算时**分级压缩**并**在注入文本里写明压缩了什么**（例："仅保留最近 4 个回合、助手截断 600 字"），绝不静默丢内容。实测 24672 → 2860 字符、35232 → 2855 字符，压缩后仍能引用真实历史。',
    '- 硬约束：只读开关**默认关闭**；任何异常都**降级**（工具路径失败回落到正常优化、观察者取不到就不注入），**不会给你空结果**。',
    '',
  ],
  en: [
    '### v0.4.6-beta.1 — this release: read-only reconnaissance / observer context / budget & compression',
    '',
    '- **Read-only reconnaissance**: with the popover switch on (advanced/extreme tiers), the optimizer **actually reads the project** before writing requirements. A wiring defect was fixed — a message array was passed where a string was expected, which made the provider reject the request with `messages[0].content: invalid type: sequence`. Measured: ON = 10 real tool calls with real directory facts; when it finds nothing it **says so instead of inventing**.',
    '- **Observer context**: the optimizer can now watch the session like a bystander — sourced from the session **projection** (what the session model actually sees), not event replay. `turns` = last 10 rounds with **both sides in full**; `full` = the whole projection; `off` = disabled. It enters via a **structural parameter into the system prompt**, so your own words stay untouched.',
    '- **Budget & compression**: when context exceeds the budget it is **compressed in stages** and the injected text **states what was compressed** (e.g. "kept the last 4 rounds, assistant replies truncated to 600 chars") — nothing is dropped silently. Measured 24672 -> 2860 and 35232 -> 2855 chars, still referencing real history afterwards.',
    '- Hard constraints: the read-only switch is **off by default**; every failure **degrades** (tool path falls back to normal optimization, observer simply not injected) and **never returns an empty result**.',
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
