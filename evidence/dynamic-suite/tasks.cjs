// 动态试题模板（防过拟合）：每次用**随机种子**生成新实例，参数、名字、缺陷位置、期望值全部随种子变化。
// 题面刻意写成"用户那种懒句子"（短、口语、带一点约束），因为要测的就是"这句话能不能被优化得更好"。
// 判分由 harness 用**机械校验**完成（跑命令 / 逐字节比对），执行体看不到判据。
const path = require('node:path');

// ── 可复现随机（mulberry32）──
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// ── 家族 A：把 config.json 升到 v2（逐字节判定）──
function familyConfigJson(r, id) {
  const keys = ['name', 'retries', 'note', 'endpoint', 'timeout'];
  const name = pick(r, ['demo', 'alpha', 'runner', 'zephyr']);
  const retries = int(r, 1, 7);
  const extraKey = pick(r, ['note', 'endpoint', 'timeout']);
  const extraVal = extraKey === 'note' ? pick(r, ['"keep"', '"ok"', '"v1"']) : (extraKey === 'timeout' ? String(int(r, 5, 30)) : '"http://x/y"');
  const seeded = '{"name":"' + name + '","retries":' + retries + ',"' + extraKey + '":' + extraVal + '}';
  const expected = '{"name":"' + name + '","retries":' + retries + ',"' + extraKey + '":' + extraVal + ',"enabled":true,"version":2}\n';
  return {
    id, family: 'config-json', seedFiles: { 'config.json': seeded },
    prompt: '把 config.json 升级到 v2：加上 enabled=true 和 version=2，原来的字段和键序都不许变，别的文件别动。',
    reference: (dir) => { require('node:fs').writeFileSync(path.join(dir, 'config.json'), expected) },
    check: (run) => {
      const got = run.readFile('config.json');
      if (got === null) return { ok: false, why: 'config.json 不见了' };
      if (got !== expected) return { ok: false, why: '内容不等于期望：' + JSON.stringify(got.slice(0, 160)) };
      return { ok: true, why: '逐字节一致' };
    },
  };
}

// ── 家族 B：写 cli.js（stdout/stderr/退出码 判定）──
function familyCli(r, id) {
  const defName = pick(r, ['anon', 'guest', 'nobody', 'user0']);
  const defCount = int(r, 1, 4);
  const argName = pick(r, ['alice', 'bob', 'carol', 'dave']);
  const argCount = int(r, 5, 9);
  const bogus = pick(r, ['--bogus', '--nope', '--wat']);
  return {
    id, family: 'cli-args', seedFiles: {},
    prompt: '写个 cli.js（只用 node 内置能力）：能认 --name=X、--count=N、--verbose 三个参数，缺省 ' + defName + '/' + defCount + '/false；正常就打印一行 name=<name> count=<count> verbose=<true|false>；遇到不认识的参数就往 stderr 打一行 unknown flag: <原样参数> 并用退出码 2 结束，这时候 stdout 不许有东西。',
    reference: (dir) => {
      const fs = require('node:fs');
      fs.writeFileSync(path.join(dir, 'cli.js'), [
        'const args = process.argv.slice(2)',
        "let name = '" + defName + "', count = '" + defCount + "', verbose = false",
        'for (const a of args) {',
        "  if (a.startsWith('--name=')) name = a.slice(7)",
        "  else if (a.startsWith('--count=')) count = a.slice(8)",
        "  else if (a === '--verbose') verbose = true",
        "  else { process.stderr.write('unknown flag: ' + a + '\\n'); process.exit(2) }",
        '}',
        "console.log('name=' + name + ' count=' + count + ' verbose=' + (verbose ? 'true' : 'false'))",
        '',
      ].join('\n'));
    },
    check: (run) => {
      const a = run.exec('node', ['cli.js', '--name=' + argName, '--count=' + argCount, '--verbose']);
      const b = run.exec('node', ['cli.js']);
      const c = run.exec('node', ['cli.js', bogus]);
      const want1 = 'name=' + argName + ' count=' + argCount + ' verbose=true\n';
      const want2 = 'name=' + defName + ' count=' + defCount + ' verbose=false\n';
      const want3 = 'unknown flag: ' + bogus + '\n';
      if (a.stdout !== want1 || a.status !== 0) return { ok: false, why: '第1组: ' + JSON.stringify(a) };
      if (b.stdout !== want2 || b.status !== 0) return { ok: false, why: '第2组: ' + JSON.stringify(b) };
      if (c.stdout !== '' || c.stderr !== want3 || c.status !== 2) return { ok: false, why: '第3组: ' + JSON.stringify(c) };
      return { ok: true, why: '三组 IO 全对' };
    },
  };
}

// ── 家族 C：修一个**种进去的真 bug**（跑 check.js 判定）──
function familySeededBug(r, id) {
  const n = int(r, 4, 9);
  const bugKind = pick(r, ['offbyone', 'compare', 'accumulate', 'awaits']);
  const src = {
    offbyone: 'export function sumTo(n) {\n  let s = 0\n  for (let i = 1; i < n; i += 1) s += i\n  return s\n}\n',
    compare: 'export function maxOf(list) {\n  let m = list[0]\n  for (const x of list) if (x < m) m = x\n  return m\n}\n',
    accumulate: 'export function product(list) {\n  let p = 0\n  for (const x of list) p *= x\n  return p\n}\n',
    awaits: 'export async function loadTwice(fetchOnce) {\n  const a = fetchOnce()\n  const b = fetchOnce()\n  return [a, b]\n}\n',
  }[bugKind];
  const check = {
    offbyone: "import { sumTo } from './lib.mjs'\nconst n = " + n + "\nlet want = 0\nfor (let i = 1; i <= n; i += 1) want += i\nconst got = sumTo(n)\nif (got !== want) { console.error('sumTo(' + n + ') = ' + got + '，应为 ' + want); process.exit(1) }\nconsole.log('ok')\n",
    compare: "import { maxOf } from './lib.mjs'\nconst list = [" + [int(r, -9, 9), int(r, 10, 30), int(r, -20, -10)].join(', ') + "]\nconst want = Math.max(...list)\nconst got = maxOf(list)\nif (got !== want) { console.error('maxOf(' + JSON.stringify(list) + ') = ' + got + '，应为 ' + want); process.exit(1) }\nconsole.log('ok')\n",
    accumulate: "import { product } from './lib.mjs'\nconst list = [" + [int(r, 2, 5), int(r, 2, 5), int(r, 2, 5)].join(', ') + "]\nconst want = list.reduce((a, b) => a * b, 1)\nconst got = product(list)\nif (got !== want) { console.error('product(' + JSON.stringify(list) + ') = ' + got + '，应为 ' + want); process.exit(1) }\nconsole.log('ok')\n",
    awaits: "import { loadTwice } from './lib.mjs'\nlet calls = 0\nconst loadTwiceAsync = async () => { calls += 1; return 'v' + calls }\nconst r = await loadTwice(loadTwiceAsync)\nif (!Array.isArray(r) || r[0] !== 'v1' || r[1] !== 'v2') { console.error('loadTwice 返回 ' + JSON.stringify(r) + '，应为 [\"v1\",\"v2\"]'); process.exit(1) }\nconsole.log('ok')\n",
  }[bugKind];
  return {
    id, family: 'seeded-bug', seedFiles: { 'lib.mjs': src, 'check.js': check },
    prompt: 'lib.mjs 有问题：跑 node check.js 会报错。修好它，只改 lib.mjs，别动 check.js。',
    reference: (dir) => {
      const fs = require('node:fs');
      const fixed = {
        offbyone: 'export function sumTo(n) {\n  let s = 0\n  for (let i = 1; i <= n; i += 1) s += i\n  return s\n}\n',
        compare: 'export function maxOf(list) {\n  let m = list[0]\n  for (const x of list) if (x > m) m = x\n  return m\n}\n',
        accumulate: 'export function product(list) {\n  let p = 1\n  for (const x of list) p *= x\n  return p\n}\n',
        awaits: 'export async function loadTwice(fetchOnce) {\n  const a = await fetchOnce()\n  const b = await fetchOnce()\n  return [a, b]\n}\n',
      }[bugKind];
      fs.writeFileSync(path.join(dir, 'lib.mjs'), fixed);
    },
    check: (run) => {
      const res = run.exec('node', ['check.js']);
      if (res.status !== 0) return { ok: false, why: 'check.js 仍失败：' + JSON.stringify(res.stderr.slice(0, 160) || res.stdout.slice(0, 160)) };
      const nowCheck = run.readFile('check.js');
      if (nowCheck !== check) return { ok: false, why: 'check.js 被改动了（不许动判据）' };
      return { ok: true, why: 'check 通过且判据文件未动' };
    },
  };
}

// ── 家族 D：按规则改写日志文件（逐行判定）──
function familyLogRewrite(r, id) {
  const rows = [];
  const n = int(r, 3, 6);
  for (let i = 0; i < n; i += 1) {
    const h = int(r, 0, 23); const m = int(r, 0, 59); const s = int(r, 0, 59);
    rows.push({ h, m, s, tag: pick(r, ['boot', 'sync', 'warn', 'done']) });
  }
  const pad = (x) => String(x).padStart(2, '0');
  const src = rows.map((x, i) => '2026-09-' + pad(int(r, 1, 28)) + 'T' + pad(x.h) + ':' + pad(x.m) + ':' + pad(x.s) + 'Z ' + x.tag + ' #' + (i + 1)).join('\n') + '\n';
  // 期望：把 ISO 时间改成 "HH:MM:SS"，其余逐字不变
  const expected = rows.map((x, i) => pad(x.h) + ':' + pad(x.m) + ':' + pad(x.s) + ' ' + x.tag + ' #' + (i + 1)).join('\n') + '\n';
  return {
    id, family: 'log-rewrite', seedFiles: { 'app.log': src },
    prompt: 'app.log 里每行开头那个 ISO 时间太长了，改成只要时分秒（HH:MM:SS），后面照原样留着，直接改这个文件。',
    reference: (dir) => { require('node:fs').writeFileSync(path.join(dir, 'app.log'), expected) },
    check: (run) => {
      const got = run.readFile('app.log');
      if (got === null) return { ok: false, why: 'app.log 不见了' };
      if (got !== expected) return { ok: false, why: '内容不符：' + JSON.stringify(got.slice(0, 140)) };
      return { ok: true, why: '逐行一致' };
    },
  };
}

// ── 家族 E：README 用法与实际脚本对齐（**必须读仓库才知道正确用法**）──
function familyReadmeSync(r, id) {
  const flags = ['--dry-run', '--json', '--quiet', '--force'];
  const tool = [
    '#!/usr/bin/env node',
    "import { readFileSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    "const flags = new Set(args.filter((a) => a.startsWith('--')))",
    "const file = args.find((a) => !a.startsWith('--')) || 'input.txt'",
    "if (flags.has('--help')) { console.log('usage: tool.mjs " + flags.join(' ') + " <file>'); process.exit(0) }",
    "const text = readFileSync(file, 'utf8')",
    "if (flags.has('--json')) { console.log(JSON.stringify({ file, lines: text.split('\\n').length })); process.exit(0) }",
    "if (!flags.has('--quiet')) console.log(text.trim())",
    "if (flags.has('--dry-run')) console.log('(dry run)')",
    '',
  ].join('\n');
  const readme = ['# tool', '', '## Usage', '', '```', 'node tool.mjs <file>', '```', '', 'Prints the file.', ''].join('\n');
  const badFlag = '--verbose';   // README 不许出现脚本里没有的旗标
  return {
    id, family: 'readme-sync', seedFiles: { 'tool.mjs': tool, 'README.md': readme, 'input.txt': 'hello\nworld\n' },
    prompt: 'README 里的用法和 tool.mjs 对不上了，改成跟脚本实际一致。',
    // 参考解：把四个旗标都写进 README（形式不限）
    reference: (dir) => {
      const fs = require('node:fs');
      fs.writeFileSync(path.join(dir, 'README.md'), ['# tool', '', '## Usage', '', '```', 'node tool.mjs ' + flags.join(' ') + ' <file>', '```', '', 'Flags: ' + flags.join(', ') + '. Default file: input.txt.', ''].join('\n'));
    },
    // 判据**按语义**判：脚本没被改 + 四个旗标都写到了 + 不出现脚本里没有的旗标（形式不限，避免"必须逐字一样"的假阴性）
    check: (run) => {
      const rd = run.readFile('README.md');
      const tool2 = run.readFile('tool.mjs');
      if (rd === null) return { ok: false, why: 'README.md 不见了' };
      if (tool2 !== tool) return { ok: false, why: 'tool.mjs 被改动了（本次只该改 README）' };
      if (!/node\s+tool\.mjs/.test(rd)) return { ok: false, why: 'README 里没有 node tool.mjs 的调用形式' };
      const missing = flags.filter((f) => rd.indexOf(f) < 0);
      if (missing.length) return { ok: false, why: 'README 仍缺旗标：' + JSON.stringify(missing) };
      if (rd.indexOf(badFlag) >= 0) return { ok: false, why: 'README 写了脚本里没有的旗标 ' + badFlag };
      return { ok: true, why: '四个旗标与调用形式都在，未虚构旗标' };
    },
  };
}

// ── 家族 F：抽出重复逻辑共用（**必须读两个模块**，且行为不许变）──
function familyReuseExtract(r, id) {
  const minLen = int(r, 1, 4);
  const maxLen = int(r, 20, 60);
  const name = 'normalize' + pick(r, ['Id', 'Code', 'Key', 'Tag']);
  const body = (fn) => [
    'export function ' + fn + '(v) {',
    "  const t = String(v == null ? '' : v).trim().toLowerCase()",
    '  if (t.length < ' + minLen + ' || t.length > ' + maxLen + ') return null',
    '  return t',
    '}',
    '',
  ].join('\n');
  // ⚠️ 测试值必须**尊重同一份约束**：合法值长度 ≥ minLen，非法值长度 < minLen
  //   （首版没这么做，参考解自己就断言失败——试题自校验当场抓出来了）
  const okLen = Math.min(maxLen, Math.max(minLen, 3));
  const rawA = '  ' + 'AbC'.padEnd(okLen, 'd') + '  ';
  const rawB = '  Qq'.padEnd(okLen + 2, 'e') + ' ';
  const wantA = rawA.trim().toLowerCase();
  const wantB = rawB.trim().toLowerCase();
  const shortRaw = 'x'.repeat(Math.max(0, minLen - 1));
  const a = "import { strictEqual } from 'node:assert'\n\n" + body(name + 'A') + "\nexport function runA() {\n  strictEqual(" + name + "A(" + JSON.stringify(rawA) + '), ' + JSON.stringify(wantA) + ")\n  strictEqual(" + name + "A(" + JSON.stringify(shortRaw) + "), null)\n  return 'A ok'\n}\n";
  const b = "import { strictEqual } from 'node:assert'\n\n" + body(name + 'B') + "\nexport function runB() {\n  strictEqual(" + name + "B(" + JSON.stringify(rawB) + '), ' + JSON.stringify(wantB) + ")\n  strictEqual(" + name + "B(" + JSON.stringify(shortRaw) + "), null)\n  return 'B ok'\n}\n";
  const test = "import { runA } from './a.mjs'\nimport { runB } from './b.mjs'\nconsole.log(runA(), runB())\n";
  const sharedName = 'shared-' + name.toLowerCase() + '.mjs';
  return {
    id, family: 'reuse-extract', seedFiles: { 'a.mjs': a, 'b.mjs': b, 'test.mjs': test },
    prompt: 'a.mjs 和 b.mjs 里那段规范化逻辑是复制粘贴的，抽成一个共用模块，两边都用它；对外行为一点都不能变。',
    reference: (dir) => {
      const fs = require('node:fs');
      const core = 'export function ' + name + '(v) {\n' + "  const t = String(v == null ? '' : v).trim().toLowerCase()\n" + '  if (t.length < ' + minLen + ' || t.length > ' + maxLen + ') return null\n  return t\n}\n';
      fs.writeFileSync(path.join(dir, sharedName), core);
      fs.writeFileSync(path.join(dir, 'a.mjs'), "import { strictEqual } from 'node:assert'\nimport { " + name + " } from './" + sharedName + "'\n\nexport const " + name + "A = " + name + "\n\nexport function runA() {\n  strictEqual(" + name + "A(" + JSON.stringify(rawA) + '), ' + JSON.stringify(wantA) + ")\n  strictEqual(" + name + "A(" + JSON.stringify(shortRaw) + "), null)\n  return 'A ok'\n}\n");
      fs.writeFileSync(path.join(dir, 'b.mjs'), "import { strictEqual } from 'node:assert'\nimport { " + name + " } from './" + sharedName + "'\n\nexport const " + name + "B = " + name + "\n\nexport function runB() {\n  strictEqual(" + name + "B(" + JSON.stringify(rawB) + '), ' + JSON.stringify(wantB) + ")\n  strictEqual(" + name + "B(" + JSON.stringify(shortRaw) + "), null)\n  return 'B ok'\n}\n");
    },
    check: (run) => {
      const t = run.exec('node', ['test.mjs']);
      if (t.status !== 0) return { ok: false, why: 'test.mjs 失败：' + JSON.stringify((t.stderr || t.stdout).slice(0, 140)) };
      if (run.readFile('test.mjs') !== test) return { ok: false, why: 'test.mjs 被改动了（判据文件不许动）' };
      const a2 = run.readFile('a.mjs') || '';
      const b2 = run.readFile('b.mjs') || '';
      // 逻辑必须真的搬走：两个原模块里不再有 toLowerCase
      if (/toLowerCase/.test(a2) || /toLowerCase/.test(b2)) return { ok: false, why: '重复逻辑仍留在 a.mjs / b.mjs 里' };
      // 必须真的新增了共用模块（不限定文件名/函数名）
      const files = run.list().filter((f) => f.endsWith('.mjs') && f !== 'a.mjs' && f !== 'b.mjs' && f !== 'test.mjs');
      const hasCore = files.some((f) => /toLowerCase/.test(run.readFile(f) || ''));
      if (!hasCore) return { ok: false, why: '没有找到承载共用逻辑的新模块（新增文件：' + JSON.stringify(files) + '）' };
      const bothImport = [a2, b2].every((s) => /import\s*\{[^}]*\}\s*from\s*'\.\/[\w.-]+\.mjs'/.test(s));
      if (!bothImport) return { ok: false, why: '两个模块没有都改为从共用模块导入' };
      return { ok: true, why: '逻辑已抽出共用、行为不变、判据文件未动' };
    },
  };
}

// ── 家族 G：按规则精确改写（懒句子不说清的细节，正是要测的）──
function familyExactTransform(r, id) {
  const n = int(r, 3, 6);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push([pick(r, ['alpha', 'bravo', 'charlie', 'delta', 'echo']), String(int(r, 100, 999)), pick(r, ['ok', 'warn', 'fail'])]);
  }
  const src = ['name|code|status'].concat(rows.map((x) => x.join('|'))).join('\n') + '\n';
  // 期望：删掉 code 列（保留表头 name|status 与其余列序），分隔符仍是 |
  const expected = ['name|status'].concat(rows.map((x) => x[0] + '|' + x[2])).join('\n') + '\n';
  return {
    id, family: 'exact-transform', seedFiles: { 'table.txt': src },
    prompt: 'table.txt 里的 code 列没用了，去掉这一列，其它别动。',
    reference: (dir) => { require('node:fs').writeFileSync(path.join(dir, 'table.txt'), expected) },
    check: (run) => {
      const got = run.readFile('table.txt');
      if (got === null) return { ok: false, why: 'table.txt 不见了' };
      if (got !== expected) return { ok: false, why: '内容不符：' + JSON.stringify(got.slice(0, 140)) };
      return { ok: true, why: '逐行一致（含表头）' };
    },
  };
}

// ── 家族 H：仓库里有约定文档（懒句子不读就会漏三处同步）──
// 这是在测"brief 是否把仓库约定带进命令"——插件的读工具/上下文正是为这件事存在的。
function familyConvention(r, id) {
  const flag = pick(r, ['--upper', '--reverse', '--number', '--trim']);
  const transform = {
    '--upper': { code: "out = out.toUpperCase()", desc: '把输出转成大写' },
    '--reverse': { code: "out = out.split('').reverse().join('')", desc: '把输出反转' },
    '--number': { code: "out = out.split('\\n').map((l, i) => (i + 1) + ': ' + l).join('\\n')", desc: '给每行加行号' },
    '--trim': { code: "out = out.replace(/[ \\t]+/g, ' ')", desc: '把连续空白压成一个空格' },
  }[flag];
  const tool = [
    '#!/usr/bin/env node',
    "import { readFileSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    "const file = args.find((a) => !a.startsWith('--')) || 'input.txt'",
    "let out = readFileSync(file, 'utf8').trim()",
    "if (args.includes('--help')) { console.log('usage: node tool.mjs [--trim] <file>'); process.exit(0) }",
    'console.log(out)',
    '',
  ].join('\n');
  const readme = ['# tool', '', '## Usage', '', '```', 'node tool.mjs <file>', '```', '', 'Flags: `--trim`.', ''].join('\n');
  const test = "import { test } from 'node:test'\nimport { strictEqual } from 'node:assert'\nimport { execFileSync } from 'node:child_process'\n\ntest('default prints file', () => {\n  const out = execFileSync('node', ['tool.mjs', 'input.txt'], { encoding: 'utf8' })\n  strictEqual(out.trim(), 'hello world')\n})\n";
  const conv = ['# 仓库约定（必须遵守）', '', '1. 任何新增的命令行旗标，必须**同时**出现在三处：`--help` 输出、README 的 Usage 段、`tests/` 下的测试里。', '2. 新增行为必须有一条 `node:test` 用例；`node --test` 必须全绿。', '3. 不要改动与本任务无关的文件。', ''].join('\n');
  // 诱饵大文件：把仓库快照的上下文预算吃掉，模拟"关键约定被截断在预算之外"的真实情况
  const decoys = {};
  for (let i = 1; i <= 3; i += 1) decoys['logs/build-' + i + '.log'] = Array.from({ length: 40 }, (_, k) => 'build step ' + (k + 1) + ' ok ' + 'x'.repeat(60)).join('\n') + '\n';
  const input = 'hello world\n';
  // 参考解里那条测试必须**真的通过**（否则自校验会拦下来）
  const expectedOut = { '--upper': 'HELLO WORLD', '--reverse': 'dlrow olleh', '--number': '1: hello world', '--trim': 'hello world' }[flag];
  return {
    id, family: 'convention-in-repo',
    seedFiles: Object.assign({ 'CONVENTIONS.md': conv, 'tool.mjs': tool, 'README.md': readme, 'input.txt': input, 'tests/tool.test.mjs': test }, decoys),
    // 任务**必须动到**的文件：快照里永远给全（其余文件按预算竞争）
    essential: ['tool.mjs', 'input.txt'],
    prompt: '给 tool.mjs 加一个 ' + flag + ' 参数：' + transform.desc + '。',
    reference: (dir) => {
      const fs = require('node:fs');
      const impl = '#!/usr/bin/env node\nimport { readFileSync } from \'node:fs\'\nconst args = process.argv.slice(2)\nconst file = args.find((a) => !a.startsWith(\'--\')) || \'input.txt\'\nlet out = readFileSync(file, \'utf8\').trim()\nif (args.includes(\'--help\')) { console.log(\'usage: node tool.mjs [--trim] [' + flag + '] <file>\'); process.exit(0) }\nif (args.includes(\'' + flag + '\')) { ' + transform.code + ' }\nconsole.log(out)\n';
      fs.writeFileSync(path.join(dir, 'tool.mjs'), impl);
      fs.writeFileSync(path.join(dir, 'README.md'), readme.replace('Flags: `--trim`.', 'Flags: `--trim`, `' + flag + '`.'));
      fs.writeFileSync(path.join(dir, 'tests', flag.slice(2) + '.test.mjs'), "import { test } from 'node:test'\nimport { strictEqual } from 'node:assert'\nimport { execFileSync } from 'node:child_process'\n\ntest('" + flag + " works', () => {\n  const out = execFileSync('node', ['tool.mjs', '" + flag + "', 'input.txt'], { encoding: 'utf8' })\n  strictEqual(out.trim(), " + JSON.stringify(expectedOut) + ")\n})\n");
    },
    check: (run) => {
      // ① 行为真的生效
      const a = run.exec('node', ['tool.mjs', flag, 'input.txt']);
      if (a.status !== 0) return { ok: false, why: '带 ' + flag + ' 跑不起来：' + JSON.stringify((a.stderr || a.stdout).slice(0, 120)) };
      const firstLine = a.stdout.split('\n')[0].trim();
      if (!firstLine) return { ok: false, why: '没有输出' };
      // ② 三处同步（约定）
      const help = run.exec('node', ['tool.mjs', '--help']);
      if (help.stdout.indexOf(flag) < 0) return { ok: false, why: '--help 里没有 ' + flag + '（违反仓库约定 1）' };
      const rd = run.readFile('README.md') || '';
      if (rd.indexOf(flag) < 0) return { ok: false, why: 'README 里没有 ' + flag + '（违反仓库约定 1）' };
      const files = run.list().filter((f) => f.indexOf('tests/') === 0);
      const tested = files.some((f) => (run.readFile(f) || '').indexOf(flag) >= 0);
      if (!tested) return { ok: false, why: 'tests/ 里没有 ' + flag + ' 的用例（违反仓库约定 1/2）' };
      const t = run.exec('node', ['--test']);
      if (t.status !== 0) return { ok: false, why: 'node --test 未全绿：' + JSON.stringify((t.stdout + t.stderr).slice(-160)) };
      return { ok: true, why: '行为生效且三处同步、测试全绿' };
    },
  };
}

// ── 家族 I：同一改动散落多处（只改一处即失败）──
function familyMultiPlace(r, id) {
  const oldPort = pick(r, ['3000', '5173', '8000', '4000']);
  const newPort = pick(r, ['8181', '9090', '7070', '6060']);
  const name = pick(r, ['api', 'gateway', 'worker', 'relay']);
  const app = [
    "import { readFileSync } from 'node:fs'",
    "const cfg = JSON.parse(readFileSync('config.json', 'utf8'))",
    "export const port = cfg.port",
    "if (port !== " + newPort + ") { console.error('port mismatch: ' + port); process.exit(1) }",
    "console.log('" + name + " listening on ' + port)",
    '',
  ].join('\n');
  const cfg = JSON.stringify({ name, port: Number(oldPort) }, null, 2) + '\n';
  const readme = ['# ' + name, '', '启动：`node app.mjs`（默认端口 ' + oldPort + '）。', ''].join('\n');
  const test = "import { execFileSync } from 'node:child_process'\nimport { strictEqual } from 'node:assert'\nconst out = execFileSync('node', ['app.mjs'], { encoding: 'utf8' })\nstrictEqual(out.trim().endsWith('" + newPort + "'), true, '实际输出：' + out.trim())\nconsole.log('ok')\n";
  return {
    id, family: 'multi-place-sync',
    seedFiles: { 'app.mjs': app, 'config.json': cfg, 'README.md': readme, 'test.js': test },
    essential: ['config.json', 'app.mjs', 'test.js'],
    prompt: '把 ' + name + ' 的端口从 ' + oldPort + ' 改成 ' + newPort + '。',
    reference: (dir) => {
      const fs = require('node:fs');
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ name, port: Number(newPort) }, null, 2) + '\n');
      fs.writeFileSync(path.join(dir, 'README.md'), readme.replace(oldPort, newPort));
    },
    check: (run) => {
      const cfg2 = run.readFile('config.json') || '';
      const rd = run.readFile('README.md') || '';
      const app2 = run.readFile('app.mjs') || '';
      if (cfg2.indexOf(newPort) < 0) return { ok: false, why: 'config.json 未改到新端口' };
      if (rd.indexOf(newPort) < 0) return { ok: false, why: 'README 未同步新端口' };
      const leftovers = [['config.json', cfg2], ['README.md', rd], ['app.mjs', app2]].filter(([, s]) => s.indexOf(oldPort) >= 0).map(([f]) => f);
      if (leftovers.length) return { ok: false, why: '旧端口仍残留在：' + JSON.stringify(leftovers) };
      const t = run.exec('node', ['test.js']);
      if (t.status !== 0) return { ok: false, why: 'test.js 失败：' + JSON.stringify((t.stdout + t.stderr).slice(-140)) };
      return { ok: true, why: '三处一致且测试通过' };
    },
  };
}

// ── 家族 J：格式只能从既有文件推断（懒句子不说格式）──
function familyFormatInfer(r, id) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  const items = [];
  for (let i = 0; i < 3; i += 1) items.push({ name: pick(r, ['apple', 'plum', 'fig', 'kiwi']), qty: String(int(r, 1, 99)) });
  const line = (x, i) => pad(x.name, 10) + '| ' + pad(x.qty, 3) + '| #' + (i + 1);
  const src = items.map(line).join('\n') + '\n';
  const addName = pick(r, ['banana', 'mango', 'pear']);
  const addQty = String(int(r, 1, 99));
  const expected = src + line({ name: addName, qty: addQty }, items.length) + '\n';
  return {
    id, family: 'format-infer', seedFiles: { 'records.txt': src },
    prompt: 'records.txt 里再加一条：' + addName + '，数量 ' + addQty + '。',
    reference: (dir) => { require('node:fs').writeFileSync(path.join(dir, 'records.txt'), expected) },
    check: (run) => {
      const got = run.readFile('records.txt');
      if (got === null) return { ok: false, why: 'records.txt 不见了' };
      if (got !== expected) return { ok: false, why: '逐字节不符：' + JSON.stringify(got.slice(-80)) };
      return { ok: true, why: '按既有格式追加，逐字节一致' };
    },
  };
}

const FAMILIES = {
  'config-json': familyConfigJson,
  'cli-args': familyCli,
  'seeded-bug': familySeededBug,
  'log-rewrite': familyLogRewrite,
  'readme-sync': familyReadmeSync,
  'reuse-extract': familyReuseExtract,
  'exact-transform': familyExactTransform,
  'convention-in-repo': familyConvention,
  'multi-place-sync': familyMultiPlace,
  'format-infer': familyFormatInfer,
};

/** 生成一批实例：seed 决定一切；families 可指定子集（用于留出/轮换）。 */
function buildTasks(seed, perFamily, families) {
  const r = rng(seed);
  const names = families && families.length ? families : Object.keys(FAMILIES);
  const out = [];
  for (const f of names) {
    for (let i = 0; i < perFamily; i += 1) {
      out.push(FAMILIES[f](r, f + '-' + seed + '-' + (i + 1)));
    }
  }
  return out;
}

module.exports = { buildTasks, FAMILIES, rng };
