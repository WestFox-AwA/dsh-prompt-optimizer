// README 行为口径同步（中英逐条同改）：node evidence/patch-readme-behavior.cjs [--write]
// 每条替换都断言"恰好命中 1 次"，命中数不对就整体不写（避免半个文件被改坏）。
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.join(__dirname, '..');
const write = process.argv.includes('--write');

const JOBS = {
  'README.md': [
    ['> **0.4 = 需求补全器**：', '> **0.4 = 需求补全器（三档）**：'],
    [
      '> **不写流程、不写步骤、不写验收清单、不写验证纪律、不写禁止事项**——这些是下游 AI 自己的能力；写进去只会占它的注意力预算、收束它的解法空间。',
      '> **补到什么程度由档位决定**：普通＝只把话说清楚、不读项目，长度跟随原话（可压缩）；高级＝**先用只读工具查证项目**，再给「目标 → 现状事实 → 阶段性任务 → 边界与不许碰的东西」；极端＝查到问题本质，细到几乎每一步怎么做，并允许在不违背意图的前提下**正向丰富**。\n> 三档都**不写流程仪式**（阶段闸门 / 打勾 / 贴证据）与通用教学——那些是下游 AI 自己的能力，写进去只会占它的注意力预算、收束它的解法空间。'.replace(/\\n/g, '\n'),
    ],
    [
      '> 实测（同一句 20 字请求）：系统提示词 **515 字符**（0.3.x 为 6478），产出 **422 字符**（0.4→0.4.1→0.4.3：4588→2164→422），管理性文字 **全 0**。',
      '> 实测（同一句 20 字请求，当前 v6，含观察者上下文块 1654 字符）：系统提示词 高级 **2542** / 极端 **2687** 字符；产出 普通 **306** / 高级 **2008** / 极端 **3954** 字符（0.4.3 时代为 515 / 422）。**流程仪式类管理文字仍为 0**——三档都不写。',
    ],
    [
      '- **体量**：系统提示词 515 字符（0.3.x 为 6478）；同一句请求的产出 422 字符（0.4 → 0.4.1 → 0.4.3：4588 → 2164 → 422），管理性文字全 0。',
      '- **体量**：系统提示词按档位组装，实测（含观察者上下文块 1654 字符）高级 **2542** / 极端 **2687** 字符（0.4.3 时代为 515）；同一句请求的产出 普通 **306** / 高级 **2008** / 极端 **3954** 字符，流程仪式类管理文字全 0。',
    ],
    [
      '- **提示词是部件化组装的**：`RELAY_IDENTITY` → **实质优先** → 档位正文 → `FACT_RULES` → `OUTPUT_CONTRACT` → `PROCESS_RULES`，历史纪律按运行时的**回合 or 全文**模式二选一注入（`buildSystem(tier, { historyMode })`）——同一句规则只有一份，改一处全局生效。现版长度：普通 1405 / 高级 2424 / 极端 2422 字符。',
      '- **提示词是部件化组装的**：`V6_CORE` → 档位正文（`V6_TIERS[tier].text`）→ 观察者上下文块 → 产出收件人契约（`OUTPUT_ADDRESSEE_CONTRACT`），由 `buildSystem(tier, { historyMode, observerBlock })` 统一组装——同一句规则只有一份，改一处全局生效。实测长度（含观察者块）：高级 **2542** / 极端 **2687** 字符。（`RELAY_IDENTITY` / `FACT_RULES` / `PROCESS_RULES` 是 v4/v5 遗留常量，只在回退策略里用。）',
    ],
    [
      '- 优化请求只发送**你的输入文本**，以及（高级/极端档）**当前项目的目录树摘要与关键文件名**；极端档的只读查证限定在项目根目录内，不写盘、不执行命令。',
      '- 优化请求发送**你的输入文本**与按你的设置读入的**会话上下文**（回合 / 全文，见下条）；**只读权限**开启时（默认开启），高级/极端档还会用 `read/glob/grep` **读项目文件**——限定在会话工作目录内、**不写盘、不执行命令**；基础档始终不读项目。',
    ],
  ],
  'README.en.md': [
    ['> **0.4 = a requirement completer**:', '> **0.4 = a requirement completer (three tiers)**:'],
    [
      '> **It writes no workflow, no steps, no acceptance checklist, no verification discipline, no prohibitions** — those are the downstream AI\'s own abilities; writing them costs attention budget and narrows the solution space.',
      '> **How far it completes is decided by the tier**: Low = just says it clearly, reads no project, length follows your own words (may be compressed); High = **verifies the project with read-only tools first**, then gives Goal -> current facts -> staged tasks -> boundaries and off-limits; Ultra = digs down to the essence and spells out almost every step, and may enrich positively as long as it never contradicts your intent.\n> None of the three writes process ritual (stage gates / checkmarks / pasted evidence) or generic teaching — those are the downstream AI\'s own abilities, and writing them only costs attention budget and narrows the solution space.'.replace(/\\n/g, '\n'),
    ],
    [
      '> Measured (same 20-character request): system prompt **515 chars** (0.3.x: 6478), output **422 chars** (0.4 -> 0.4.1 -> 0.4.3: 4588 -> 2164 -> 422), management prose **zero**.',
      '> Measured (same 20-character request, current v6, including the 1654-char observer context block): system prompt High **2542** / Ultra **2687** chars; output Low **306** / High **2008** / Ultra **3954** chars (the 0.4.3 era: 515 / 422). **Process-ritual prose is still zero** — none of the three tiers writes it.',
    ],
    [
      '- **Size**: system prompt 515 chars (0.3.x: 6478); output for the same request 422 chars (0.4 -> 0.4.1 -> 0.4.3: 4588 -> 2164 -> 422), management prose zero.',
      '- **Size**: the system prompt is assembled per tier; measured (including the 1654-char observer context block) High **2542** / Ultra **2687** chars (the 0.4.3 era: 515); output for the same request Low **306** / High **2008** / Ultra **3954** chars, with zero process-ritual prose.',
    ],
    [
      '- **Prompts are assembled from parts**: `RELAY_IDENTITY` → **substance first** → tier body → `FACT_RULES` → `OUTPUT_CONTRACT` → `PROCESS_RULES`, and the history discipline is injected according to the runtime **turns-or-full-text** mode (`buildSystem(tier, { historyMode })`) — every rule exists exactly once, so one edit applies everywhere. Current lengths: Low 1405 / High 2424 / Ultra 2422 characters.',
      '- **Prompts are assembled from parts**: `V6_CORE` -> the tier body (`V6_TIERS[tier].text`) -> the observer context block -> the deliverable-addressee contract (`OUTPUT_ADDRESSEE_CONTRACT`), composed by `buildSystem(tier, { historyMode, observerBlock })` — every rule exists exactly once, so one edit applies everywhere. Measured lengths (observer block included): High **2542** / Ultra **2687** chars. (`RELAY_IDENTITY` / `FACT_RULES` / `PROCESS_RULES` are v4/v5 legacy constants, used only by rollback strategies.)',
    ],
    [
      '- Optimization requests send only **the text you typed**, plus (High/Ultra) a **directory-tree summary and key file names of the current project**. Ultra-tier read-only checks are confined to the project root: no writes, no command execution.',
      '- Optimization requests send **the text you typed** plus the **session context** read according to your settings (turns / full text, see the next bullet). While **read-only access** is on (the default), the High and Ultra tiers also use `read/glob/grep` to **read project files** — confined to the session working directory, **no writes, no command execution**; the Low tier never reads the project.',
    ],
  ],
};

let fail = 0;
for (const [file, pairs] of Object.entries(JOBS)) {
  const p = path.join(REPO, file);
  let src = fs.readFileSync(p, 'utf8');
  let applied = 0;
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    if (n !== 1) { console.log('  ✗ ' + file + '  命中 ' + n + ' 次（应为 1）：' + from.slice(0, 48) + '…'); fail++; continue; }
    src = src.split(from).join(to);
    applied++;
  }
  console.log(file + '：命中并替换 ' + applied + '/' + pairs.length);
  if (write && applied === pairs.length) { fs.writeFileSync(p, src, 'utf8'); console.log('  已写入 ✓'); }
}
console.log('');
console.log(fail === 0 ? (write ? '全部条目已同步 ✓' : '干跑：全部条目可精确命中 ✓（加 --write 写入）') : '❌ ' + fail + ' 条未命中（未写入）');
process.exit(fail === 0 ? 0 : 2);
