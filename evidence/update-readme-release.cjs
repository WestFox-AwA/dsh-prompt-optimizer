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
    '### v0.4.6-beta.3 —— 本版：修「高级/极端看不到思考过程」+ 问号面板文案对齐 + README 口径同步',
    '',
    '- **修复（思考透传）**：工具循环调用时漏传 `onDelta`、只回传思考字数计数、且工具分支把 `reasoning` 硬编码为空串——三处断点让**高级/极端档的「思考」栏永远是空的**（基础档不走工具循环所以一直正常）。现已把思考接回**与不派工具时同一条**透传通道；**三档定义未动**（grounding / decompose / enrich 与温度一字未改）。实测：思考字数 基础 3333、高级 **0 → 2817**、极端 **0 → 7396**；浏览器内实跑极端档，「思考」栏摘要 = **`— tok · 6497 字`**。',
    '- **问号面板文案与行为对齐**：原先那一节写的是 v0.2.1 / v5 时代的规则（"实质优先 / 流程长度 / 硬约束 / 防过度"），与 v6 的"不写流程仪式与通用教学"**正好相反**。现按三档定义重写：档位（并注明**三档的思考过程都显示在「思考」栏**）、只读权限（默认开启）、优化器会做什么（收件人 / 语言层 / 保真 / 歧义 / 产出即命令）、上下文（回合＝最近 0~10 回合**双方全文**、超限六级压缩并声明）。中英面板**各 7 节 / 各 24 行**，`i18n-demo` 自检中英各跑一次 `pass: true`。',
    '- **README 口径与实测同步**：修掉 6 处过时描述（中英同改）——"不写步骤/不写验收清单"（与高级/极端档相反）、"系统提示词 515 字符 / 产出 422 字符"（实测 高级 2542 / 极端 2687 字符）、"组装是 `RELAY_IDENTITY` → … → `PROCESS_RULES`"（v4/v5 遗留）、"只发送输入文本 + 目录树摘要"（该机制在活路径从未注入）。',
    '- 版本号：文档标题、安装示例的 tgz 文件名、面板落款三处已同步为 **0.4.6-beta.3**；`releases/latest` 别名链接始终指向最新版。',
    '',
  ],
  en: [
    '### v0.4.6-beta.3 — this release: fixes "no reasoning visible on High/Ultra" + help-panel text aligned + README claims synced',
    '',
    '- **Fix (reasoning pass-through)**: the tool loop called the stream helper without `onDelta`, returned only a reasoning *character count*, and the tool branch hard-coded `reasoning` to an empty string — three breakpoints that left the **Thinking pane permanently empty on High/Ultra** (Low never enters the tool loop, so it always worked). Reasoning now flows through **the same channel as the no-tools path**; the **three tier definitions are untouched** (grounding / decompose / enrich and temperature unchanged). Measured: reasoning chars Low 3333, High **0 -> 2817**, Ultra **0 -> 7396**; a real in-browser Ultra run shows the Thinking fold summarised as **`— tok · 6497 字`**.',
    '- **Help panel (question-mark popover) aligned with real behaviour**: that section still described the v0.2.1 / v5 rules ("substance first / process weight / hard constraints / no over-process"), which are the **opposite** of v6\u2019s "no process ritual, no generic teaching". It now describes the three tiers (and notes that **all three show their reasoning in the Thinking pane**), read-only access (on by default), what the optimizer does (addressee / language layer / fidelity / ambiguity / output-is-the-command) and context (turns = last 0–10 turns **with both sides verbatim**; over budget it compresses in six stages and says so). The panel renders **7 sections / 24 rows in both languages**, and the `i18n-demo` self-check passes in both.',
    '- **README claims synced with measurements**: six stale statements fixed in both languages — "writes no steps / no acceptance checklist" (the opposite of what High/Ultra do), "system prompt 515 chars / output 422 chars" (measured: High 2542 / Ultra 2687 chars), "assembled as `RELAY_IDENTITY` -> ... -> `PROCESS_RULES`" (v4/v5 legacy), and "sends only your text plus a directory-tree summary" (that block is never injected on the live path).',
    '- Version numbers: the doc title, the tgz filename in the install example and the in-panel credit are all **0.4.6-beta.3**; the `releases/latest` alias link always points at the newest version.',
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
