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
    '### v0.4.6-beta.2 —— 本版：只读权限默认开 / 文案与位置 / 产出物收件人（治根）',
    '',
    '- **只读权限默认开**：状态文件里**缺失该键 = 开**，只有**显式 `false`** 才算关（已保存的显式值不被改写）。实测：删掉键后 `/state` → `true`；不传参数跑极端档 = **6 次真实工具调用**；显式关 = 0 次调用且产出 4000 字。',
    '- **文案与位置**：标签改为「**只读权限：**」（en：`Read-only access:`），开关移到标签**同一行的右侧**，说明保留在下一行。真实 DOM 实测：`sameLine=true / dy=0 / btnRightOfLabel=true / overflowRight=-25`（不出界、不截断）。',
    '- **产出物收件人（治根）**：此前契约只规定"内容要像一条能发出去的命令"，**从未规定产出物的收件人**，于是模型会写出**对老板说的话**（"把下面这段整条发给工作 AI…"），直接转发会误导会话 AI。现在两层根治：**契约层**把收件人写进 system（全策略生效）；**闸门层**在唯一产出出口强制剥离首尾转交语与包装（正文里的"复制到/告诉我"不误伤；剥完不足 20 字整段回退，**绝不返回空**），`done.text` 成为**定稿**。',
    '- 实测：用出问题的那句原话复现，产出 **`no-hit`（转交语根本没生成）**；闸门判官自检 **13/13**（坏标全拦、金标一字未动）；工具链强制失败时回落无工具路径、产出 **3816 字非空**。',
    '- 硬约束：只读权限**默认开启**（覆盖上一版的"默认关闭"）；任何失败都**降级**且**不会给你空结果**。降级声明落在运行记录（`/runs`），**不写进产出物**——否则又变成对老板说话。',
    '',
  ],
  en: [
    '### v0.4.6-beta.2 — this release: read-only access on by default / label & position / the deliverable\u2019s addressee (root fix)',
    '',
    '- **Read-only access is now on by default**: a **missing key means on**; only an **explicit `false`** counts as off (an explicitly saved value is never rewritten). Measured: delete the key and `/state` returns `true`; a run with no explicit arguments made **6 real tool calls**; explicit off = 0 calls with a 4000-char result.',
    '- **Label & position**: the label is now **"只读权限："** (`Read-only access:` in English) with the switch moved to **the right of it on the same line**; the explanation stays on the next line. Measured in the real DOM: `sameLine=true / dy=0 / btnRightOfLabel=true / overflowRight=-25` (no overflow, no clipping).',
    '- **The deliverable\u2019s addressee (root fix)**: the contract only ever demanded that the content read like a sendable command — it **never defined who the deliverable is addressed to**, so the model would write **things meant for the boss** ("forward this whole block to the working AI…"), which misleads the downstream AI when pasted verbatim. Two layers now fix it: the **contract layer** writes the addressee into the system prompt (all strategies), and the **gate layer** strips leading/trailing relay phrases and wrappers at the single output exit (legitimate body text such as "copy to…" is never touched; if fewer than 20 chars would remain, the original is kept — **never an empty result**), with `done.text` as the authoritative final text.',
    '- Measured: re-running the exact sentence that failed produced **`no-hit` (the relay phrase was never generated)**; the gate\u2019s judge self-test passed **13/13** (every bad case intercepted, every gold case untouched); a forced tool-chain failure fell back to the no-tools path and still produced **3816 non-empty chars**.',
    '- Hard constraints: read-only access is **on by default** (superseding the previous release\u2019s off-by-default); every failure **degrades** and **never returns an empty result**. Degradation is recorded in the run record (`/runs`), **not inside the deliverable** — that would be talking to the boss again.',
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
