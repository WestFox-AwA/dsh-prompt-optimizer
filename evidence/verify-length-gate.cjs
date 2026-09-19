// 膨胀闸门（F6 修订）桩单测：node evidence/verify-length-gate.cjs
// 口径：**自产文字**受档位倍率约束；**带出处的搬运**不受倍率约束（只计数）；总字数有硬上限。
// 起因：b666002 里读仓库臂 506 字（16.9×）被判越界 6/6，而产物几乎全是搬运 —— 按总字数罚等于砍掉它唯一的价值来源。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

(async () => {
  const V = (await import(MOD)).__poVerify;
  const G = V.evaluateLengthGate;
  if (typeof G !== 'function') { console.error('❌ __poVerify.evaluateLengthGate 未导出'); process.exit(1) }

  const RAW = '给 tool.mjs 加一个 --reverse 参数：把输出反转。';   // 24 字
  const rawLen = RAW.length;

  // ① 原话直通 → 放行
  check('原话直通 → 放行', G('extreme', rawLen, RAW).over, false);

  // ② 自产注水（长、无出处）→ 罚下，原因是 self-added
  const padding = Array.from({ length: 40 }, (_, i) => '第 ' + (i + 1) + ' 条要求：把这件事做得更细一些，注意保持一致性，不要遗漏任何细节。').join('\n');
  const g2 = G('extreme', rawLen, padding);
  check('自产注水 → 罚下', { over: g2.over, reason: g2.overReason && g2.overReason.split(':')[0] }, { over: true, reason: 'self-added' });

  // ③ 密集搬运（每行都带 路径:行号）→ 放行（即使总字数远超倍率）
  const cited = [
    '按 CONVENTIONS.md:3-4，新增旗标必须同时出现在三处：',
    '- tool.mjs:6 的 --help usage 串；',
    '- README.md:9 的 Flags 行；',
    '- tests/tool.test.mjs 里补一条用例，node --test 必须全绿。',
    'CONVENTIONS.md:5：不要动与本任务无关的文件。',
    'tool.mjs:3-4 是参数解析入口，tool.mjs:5 的 trim() 保持原样。',
  ].join('\n');
  const g3 = G('extreme', rawLen, cited);
  check('密集搬运（全行带出处）→ 放行', g3.over, false);

  // ④ 搬运型豁免：自产略超倍率，但出处占比 ≥50% 且密度 ≥0.5 → 放行
  const mixed = [
    '按 CONVENTIONS.md:3-4，新增旗标必须同时出现在三处（--help、README、tests）。',
    'README.md:9 当前写的是 Flags: --trim.，要在后面加上新旗标。',
    'tests/tool.test.mjs 已存在，按它的写法补一条 node:test 用例，跑 node --test 必须全绿。',
    'tool.mjs:3-4 的参数解析分支就是落点；tool.mjs:5 的无条件 trim() 不要动。',
    '另外请务必注意代码风格保持一致，注意边界，注意错误处理，注意注释，注意命名，注意可读性，注意性能，注意安全，注意可维护性。',
  ].join('\n');
  const g4 = G('extreme', rawLen, mixed);
  check('搬运型豁免（自产超限但出处占比高）→ 放行', { over: g4.over, transferLike: g4.transferLike }, { over: false, transferLike: true });

  // ⑤ 硬上限：总字数超 4000 → 罚下，原因是 hard-cap
  const huge = Array.from({ length: 120 }, (_, i) => '第 ' + (i + 1) + ' 条：README.md:' + (i + 1) + ' 处需要同步修改，保持与实现一致。').join('\n');
  const g5 = G('extreme', rawLen, huge);
  check('总字数超硬上限 → 罚下', { over: g5.over, reason: g5.overReason && g5.overReason.split(':')[0] }, { over: true, reason: 'hard-cap' });

  // ⑥ 档位倍率确实生效：同样一段自产文字，普通档（上限 1.5×+120=156）判越界，极端档（4×+120=216）不判
  //    样本长度刻意落在两档上限之间（≈186 字）
  let mid = '';
  for (let i = 1; mid.length < 186; i += 1) mid += (mid ? '\n' : '') + '第 ' + i + ' 条自产说明：把事情交代清楚，避免歧义。';
  mid = mid.slice(0, 186);
  const basicLimit = G('basic', rawLen, '').selfLimit;
  const extremeLimit = G('extreme', rawLen, '').selfLimit;
  check('档位倍率生效（样本长度落在两档上限之间）', { basic: G('basic', rawLen, mid).over, extreme: G('extreme', rawLen, mid).over, basicLimit, extremeLimit, midLen: mid.length },
    { basic: true, extreme: false, basicLimit, extremeLimit, midLen: 186 });

  let bad = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c.got)); console.log('      期望 ' + JSON.stringify(c.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：闸门分两栏工作正常 ✓（自产受倍率约束、搬运只计数、总字数有硬上限）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
