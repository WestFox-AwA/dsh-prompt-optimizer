// README「身份层 / 证据层」口径同步（中英同改）：node evidence/patch-readme-identity.cjs [--write]
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.join(__dirname, '..');
const write = process.argv.includes('--write');

const JOBS = {
  'README.md': [
    [
      '- 优化请求发送**你的输入文本**与按你的设置读入的**会话上下文**（回合 / 全文，见下条）；**只读权限**开启时（默认开启），高级/极端档还会用 `read/glob/grep` **读项目文件**——限定在会话工作目录内、**不写盘、不执行命令**；基础档始终不读项目。',
      '- 优化请求发送**你的输入文本**与按你的设置读入的**会话上下文**（回合 / 全文，见下条）；**只读权限**开启时（默认开启），高级/极端档还会用 `read/glob/grep` **读项目文件**——限定在**本次运行所属会话**的工作目录内、**不写盘、不执行命令**；基础档始终不读项目。\n  **身份层**：会话 / 工作目录 / 下游形态只解析一次，且**解析不到就不猜**——不派工具、不注入观察者、形态回落对话式（退化成"纯需求重述"，绝不会把别的会话目录里的现状当成你的项目事实）。判定结果可在 `/runs` 的 `context` / `toolRoot` 里核对。\n  **证据层**：只有**本次实际读到**的路径与符号才允许被写成"事实"（查证账本随工具结果一并注入）；只列过目录不等于知道内容；一次都没读到就不写"事实 / 现状"段。',
    ],
    [
      '，由 `buildSystem(tier, { historyMode, observerBlock, delivery })` 统一组装——同一句规则只有一份，改一处全局生效。',
      '，由 `buildSystem(tier, { historyMode, observerBlock, delivery })` 统一组装（工具路径下另有**证据账本** `renderEvidenceLedger`，随工具结果注入）——同一句规则只有一份，改一处全局生效。',
    ],
  ],
  'README.en.md': [
    [
      '- Optimization requests send **the text you typed** plus the **session context** read according to your settings (turns / full text, see the next bullet). While **read-only access** is on (the default), the High and Ultra tiers also use `read/glob/grep` to **read project files** — confined to the session working directory, **no writes, no command execution**; the Low tier never reads the project.',
      '- Optimization requests send **the text you typed** plus the **session context** read according to your settings (turns / full text, see the next bullet). While **read-only access** is on (the default), the High and Ultra tiers also use `read/glob/grep` to **read project files** — confined to the working directory of **the session this run belongs to**, **no writes, no command execution**; the Low tier never reads the project.\n  **Identity layer**: the session, its working directory and the downstream shape are resolved exactly once, and **nothing is ever guessed**: when they cannot be resolved, no tools are dispatched, no observer context is injected, and the shape falls back to chat (a pure requirement restatement \u2014 the plugin will never pass another session\u2019s directory contents off as facts about your project). The decision is visible in `/runs` under `context` / `toolRoot`.\n  **Evidence layer**: only paths and symbols **actually read during this run** may be written as facts (an evidence ledger is injected alongside the tool results); listing a directory is not knowing its contents; if nothing was read, no facts/status section is written at all.',
    ],
    [
      ', composed by `buildSystem(tier, { historyMode, observerBlock, delivery })` — every rule exists exactly once, so one edit applies everywhere.',
      ', composed by `buildSystem(tier, { historyMode, observerBlock, delivery })` (on the tool path an **evidence ledger**, `renderEvidenceLedger`, is injected alongside the tool results) — every rule exists exactly once, so one edit applies everywhere.',
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
console.log(fail === 0 ? (write ? '全部条目已同步 ✓' : '干跑：可精确命中 ✓') : '❌ ' + fail + ' 条未命中');
process.exit(fail === 0 ? 0 : 2);
