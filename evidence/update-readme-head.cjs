// 一次性维护脚本：更新两份 README 的头部（标题版本号 + 把 7–11 行的过期口径块换成 "0.4 与 0.1 的区别"）。
// 用法：node evidence/update-readme-head.cjs            干跑（只打印将要做什么）
//       node evidence/update-readme-head.cjs --write    实际写入
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')
const VER = 'v0.4.3-beta.1'

const ZH = [
  '> ### 0.4 与 0.1 的区别（一页看懂）',
  '>',
  '> **0.1 = 改写器**：把用户的话改通顺（病句、错别字、标点、指代），输出仍是那句话的润色版——**它不补内容**，用户没写到的部分，下游 AI 照样不知道。',
  '>',
  '> **0.4 = 需求补全器**：用户通常只说一句（10–200 字），它把这句话补成一份**完整、具体的要求说明**——对象落到具体文件/界面/模块、结果是什么样子、在哪些使用情形下要成立（双击打开/离线/窄窗口/换语言主题）、边界怎么处理、范围到哪里。',
  '> **不写流程、不写步骤、不写验收清单、不写验证纪律、不写禁止事项**——这些是下游 AI 自己的能力；写进去只会占它的注意力预算、收束它的解法空间。',
  '>',
  '> 实测（同一句 20 字请求）：系统提示词 **515 字符**（0.3.x 为 6478），产出 **422 字符**（0.4→0.4.1→0.4.3：4588→2164→422），管理性文字 **全 0**。',
  '> 管理性文字是有代价的：旧策略要求"逐步验证并贴证据"，把下游程序撑爆，**10/24 格被判预算截断而白扔**。',
]
const EN = [
  '> ### 0.4 vs 0.1 in one page',
  '>',
  '> **0.1 = a rewriter**: it smooths the user\'s sentence (grammar, typos, punctuation, references) and outputs a polished version of that same sentence — **it adds no content**, so whatever the user left unsaid stays unknown downstream.',
  '>',
  '> **0.4 = a requirement completer**: the user usually types one short sentence (10–200 chars); 0.4 turns it into a **complete, concrete statement of what is wanted** — which object exactly (file/screen/module), what the result looks like, which usage situations must hold (double-click open / offline / narrow window / other language or theme), how edges behave, and what the scope is.',
  '> **It writes no workflow, no steps, no acceptance checklist, no verification discipline, no prohibitions** — those are the downstream AI\'s own abilities; writing them costs attention budget and narrows the solution space.',
  '>',
  '> Measured (same 20-character request): system prompt **515 chars** (0.3.x: 6478), output **422 chars** (0.4 -> 0.4.1 -> 0.4.3: 4588 -> 2164 -> 422), management prose **zero**.',
  '> Management prose is not free: the old strategy demanded "verify step by step and paste the evidence", which blew up the executor program — **10 of 24 cells were discarded as budget-truncated**.',
]

const jobs = [
  { file: 'README.md', block: ZH },
  { file: 'README.en.md', block: EN },
]
const write = process.argv.includes('--write')
for (const job of jobs) {
  const p = path.join(REPO, job.file)
  const lines = fs.readFileSync(p, 'utf8').split('\n')
  const before = lines.slice(0, 12)
  const title = lines[0].replace(/\*\*v[0-9][^*]*\*\*/, '**' + VER + '**')
  const out = [title].concat(lines.slice(1, 6), job.block, lines.slice(11))
  console.log('--- ' + job.file + ' ---')
  console.log('  标题: ' + lines[0].slice(0, 60) + '  →  ' + title.slice(0, 60))
  console.log('  替换第 7–11 行（' + (before.length - 6) + ' 行）为 ' + job.block.length + ' 行新内容；总行数 ' + lines.length + ' → ' + out.length)
  if (write) { fs.writeFileSync(p, out.join('\n'), 'utf8'); console.log('  已写入 ✓') }
}
if (!write) console.log('\n（干跑；加 --write 实际写入）')
