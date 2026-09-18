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
    '### v0.4.6-beta.6 —— 本版：根治「假事实」（身份层 + 证据层 + 契约层）',
    '',
    '- **病灶（真实项目实测）**：只读工具读到了**别的会话的目录**（`C:\\Users\\WestFox\\.dsh`，不是这次运行所属的会话），产出却把这处的所见写成「**已核实的事实**」（"工作目录下不存在任何工程文件…只有 `attachments/v1/objects/**` 二进制对象"），下游据此**不再看真实项目**；同一句原话三次还跑出**互相冲突的硬约束**（一次"唯一允许的外部资源是 CDN three.js"、一次"不得出现 `https://`"＝要求从零手写 WebGL 渲染器，用户从没要求）。',
    '- **身份层**：会话 / 工作目录 / 下游形态**只解析一次**（按本次运行上报的 sessionId）；**解析不到就不猜**——不派工具、不注入观察者、形态回落对话式，退化成"纯需求重述"（0.4.3 行为），**绝不产出假事实**。判定可在 `/runs` 的 `context` / `toolRoot` 核对。',
    '- **证据层**：只有**本次实际读到**的路径与符号才允许写成"事实"（查证账本随工具结果一并注入）；**只列过目录不等于知道内容**；一次文件内容都没读到就不写"事实 / 现状"段。',
    '- **契约层**：新增【事实必须有出处】【只写下游无法自知的】，并把【歧义】改为「**保守不得升级成新的硬约束**」（用户没提 ≠ 禁止）。提示词变更可逐行审计（`evidence/diff-v6-prompts.cjs`），本轮差异只有这三条 + 歧义扩写。',
    '- **止血杠杆**：策略可**运行时**拨动（状态文件 `strategy` 或 `DSH_PO_STRATEGY`）；`strategy=v5` 即回到 0.4.3 的"纯需求重述"，便于同题对照与快速回退，不必改代码。',
    '- **实测**（你的原话 + 你的会话目录）：工具根 = 该会话目录 ✓（不再是 `.dsh`）；产出里假事实、"已核实"、事实段**全部消失** ✓；不再禁止 https ✓；不给 sessionId 时 `readTools=false`、形态回落对话式、观察者写明原因 ✓；同题 v5 = 1428 字纯需求重述（对照）✓。',
    '',
  ],
  en: [
    '### v0.4.6-beta.6 — this release: root-curing "false facts" (identity + evidence + contract layers)',
    '',
    '- **The defect (measured on a real project)**: the read-only tools read **another session\u2019s directory** (`C:\\Users\\WestFox\\.dsh`, not the session this run belonged to), yet the deliverable wrote what it saw there as **"verified facts"** ("no project files exist in the working directory... only `attachments/v1/objects/**` binaries") \u2014 so the downstream AI stopped looking at the real project. The same sentence also produced **mutually contradictory hard constraints** across runs (one allowed CDN three.js, another forbade `https://` outright, i.e. demanded a hand-written WebGL renderer the user never asked for).',
    '- **Identity layer**: session / working directory / downstream shape are resolved **exactly once**, from the sessionId reported by this run; **nothing is ever guessed** \u2014 when they cannot be resolved, no tools are dispatched, no observer context is injected, and the shape falls back to chat (a pure requirement restatement, i.e. 0.4.3 behaviour), **never false facts**. The decision is auditable in `/runs` under `context` / `toolRoot`.',
    '- **Evidence layer**: only paths and symbols **actually read during this run** may be written as facts (an evidence ledger is injected alongside the tool results); **listing a directory is not knowing its contents**; if no file content was read, no facts/status section is written at all.',
    '- **Contract layer**: two new structural clauses (facts must have a source; write only what the downstream cannot know by itself) and the ambiguity rule now reads "**a conservative reading must not escalate into new hard constraints**" (the user\u2019s silence is not a prohibition). Prompt changes are auditable line by line (`evidence/diff-v6-prompts.cjs`) \u2014 this round only adds those clauses and widens the ambiguity one.',
    '- **Stop-the-bleeding lever**: the strategy can be switched **at runtime** (state key `strategy` or `DSH_PO_STRATEGY`); `strategy=v5` returns to 0.4.3\u2019s pure requirement restatement for side-by-side comparison and fast rollback, with no code change.',
    '- **Measured** (your own sentence, your own session directory): tool root = that session\u2019s directory (no longer `.dsh`) \u2713; false facts, "verified" claims and any facts section **all gone** \u2713; no more blanket `https` prohibition \u2713; without a sessionId, `readTools=false`, chat shape, and the observer states why \u2713; the same request under v5 = a 1428-char pure requirement restatement (the control) \u2713.',
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
