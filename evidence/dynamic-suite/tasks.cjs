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
    check: (run) => {
      const got = run.readFile('app.log');
      if (got === null) return { ok: false, why: 'app.log 不见了' };
      if (got !== expected) return { ok: false, why: '内容不符：' + JSON.stringify(got.slice(0, 140)) };
      return { ok: true, why: '逐行一致' };
    },
  };
}

const FAMILIES = {
  'config-json': familyConfigJson,
  'cli-args': familyCli,
  'seeded-bug': familySeededBug,
  'log-rewrite': familyLogRewrite,
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
