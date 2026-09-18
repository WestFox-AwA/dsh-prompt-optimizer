// README「下游形态」口径同步（中英同改）：node evidence/patch-readme-delivery.cjs [--write]
// 每条替换断言"恰好命中 1 次"，命中数不对就整体不写。
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.join(__dirname, '..');
const write = process.argv.includes('--write');

const BANNER_ZH = [
  '> ## ⚠️ 请务必注意：本插件会**按会话的执行体形态**给命令',
  '>',
  '> 会话是 **PTC 模式**（agent preset = `ptc`）时，命令按"**一个程序一次做完**"投影：**清单优先、够用即止、不写工序与暂停点**；**档位的深度一条不减**（同一个极端档，只是换成清单而不是工序）。',
  '> 其他模式按**对话式**形态给出（阶段/步骤、篇幅不设限）。判定是**运行时自动**的（读会话的 agent preset），也可以在「优化模型」弹层里手动指定。',
].join('\n');
const BANNER_EN = [
  '> ## ⚠️ Important: this plugin shapes its command for the **session\u2019s executor**',
  '>',
  '> In a **PTC session** (agent preset = `ptc`) the command is projected for "**one program does it all**": **checklist first, as long as needed and no longer, with no process order or stop points** — and **not one bit of tier depth is removed** (the same Ultra tier, expressed as a checklist instead of a procedure).',
  '> Everywhere else it uses the **chat** shape (stages / steps, no length limit). Detection is **automatic at runtime** (it reads the session\u2019s agent preset), and you can also pin it manually in the Optimizer-model popover.',
].join('\n');

const JOBS = {
  'README.md': [
    ['> ## ⚠️ 请务必注意：本插件针对 **PTC 模式** 进行优化\n>\n> **建议在 PTC 模式下使用本插件**；否则可能**无法实现明显的效果提升**，**不排除在其他模式下出现倒退的可能性**。', BANNER_ZH],
    [
      '- **提示词是部件化组装的**：`V6_CORE` → 档位正文（`V6_TIERS[tier].text`）→ 观察者上下文块 → 产出收件人契约（`OUTPUT_ADDRESSEE_CONTRACT`），由 `buildSystem(tier, { historyMode, observerBlock })` 统一组装——同一句规则只有一份，改一处全局生效。',
      '- **提示词是部件化组装的**：`V6_CORE` → **档位正文（由轴渲染：`depth` / `sequence` / `budget`）** → 观察者上下文块 → **下游形态声明块（`delivery=ptc` 时）** → 产出收件人契约（`OUTPUT_ADDRESSEE_CONTRACT`），由 `buildSystem(tier, { historyMode, observerBlock, delivery })` 统一组装——同一句规则只有一份，改一处全局生效。\n  **不变式**：`delivery` 只投影 `sequence`（工序↔清单）与 `budget`（不设限↔够用即止），**绝不动 `depth` / `enrich` / `grounding`**；`delivery=chat` 时三档产出与改前**逐字节相同**（`evidence/snapshot-v6-prompts.cjs --compare`）。',
    ],
  ],
  'README.en.md': [
    ['> ## ⚠️ Important: this plugin is optimized for **PTC mode**\n>\n> **Use it in PTC mode.** In other modes it may **fail to deliver a noticeable improvement**, and a **regression is not ruled out**.', BANNER_EN],
    [
      '- **Prompts are assembled from parts**: `V6_CORE` -> the tier body (`V6_TIERS[tier].text`) -> the observer context block -> the deliverable-addressee contract (`OUTPUT_ADDRESSEE_CONTRACT`), composed by `buildSystem(tier, { historyMode, observerBlock })` — every rule exists exactly once, so one edit applies everywhere.',
      '- **Prompts are assembled from parts**: `V6_CORE` -> **the tier body (rendered from the axes: `depth` / `sequence` / `budget`)** -> the observer context block -> **the downstream-shape declaration block (when `delivery=ptc`)** -> the deliverable-addressee contract (`OUTPUT_ADDRESSEE_CONTRACT`), composed by `buildSystem(tier, { historyMode, observerBlock, delivery })` — every rule exists exactly once, so one edit applies everywhere.\n  **Invariant**: `delivery` only projects `sequence` (procedure vs checklist) and `budget` (unlimited vs as-long-as-needed), and **never touches `depth` / `enrich` / `grounding`**; with `delivery=chat` all three tiers render **byte-identically** to before (`evidence/snapshot-v6-prompts.cjs --compare`).',
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
    if (n !== 1) { console.log('  ✗ ' + file + '  命中 ' + n + ' 次（应为 1）：' + from.slice(0, 46) + '…'); fail++; continue; }
    src = src.split(from).join(to);
    applied++;
  }
  console.log(file + '：命中并替换 ' + applied + '/' + pairs.length);
  if (write && applied === pairs.length) { fs.writeFileSync(p, src, 'utf8'); console.log('  已写入 ✓'); }
}
console.log('');
console.log(fail === 0 ? (write ? '全部条目已同步 ✓' : '干跑：全部条目可精确命中 ✓（加 --write 写入）') : '❌ ' + fail + ' 条未命中（未写入）');
process.exit(fail === 0 ? 0 : 2);
