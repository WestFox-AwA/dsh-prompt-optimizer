// 产出收件人闸门验证（判官自检）：node evidence/verify-addressee.cjs
// 判据：坏标（转交语/包装）必拦；金标（纯指令）必过且**一字不改**；正文里的"复制/告诉我"不得误伤；任何路径绝不返回空。
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

// —— 实测坏标：用户把极端档产物原样贴回来时的真实开头（0.4.6-beta.1 线上发生）——
const BAD_HEAD = '把下面这段整条发给工作 AI（原话里的两件事：开关默认开、标签改名并把按钮挪到右侧）。';
const DIRECTIVE = [
  '【任务】改 dsh-prompt-optimizer 两处，别的一律不碰：',
  '1. 只读工具开关默认值由「关」改为「开」。',
  '2. 标签改为「只读权限：」，控件放到该文本右侧同一行。',
  '',
  '【验收】不传显式参数时一次 optimize 里 tools 非空（/runs 的 toolLoopDebug 有内容）。',
].join('\n');

// —— 金标：合法指令（必须一字不改）——
const GOLD = [
  '把这段代码复制到 src/utils.ts 里，保持缩进与现有风格一致。',
  '改动只进 lib/index.js；不要动 client.js 的布局。',
  '跑一次全量测试，完成后告诉我结果。',
].join('\n');
const GOLD_TAIL = DIRECTIVE + '\n' + '如果还需要调整参数，请修改 config.json 后重跑。';
const GOLD_TELL = DIRECTIVE + '\n' + '做完把耗时写进 evidence/timing.md，完成后告诉我。';

const cases = [
  { name: '坏标·实测转交语开头 + 分隔线包装', input: BAD_HEAD + '\n\n---\n\n' + DIRECTIVE + '\n\n---', expect: 'strip', mustContain: '【任务】', mustNotContain: '发给工作 AI' },
  { name: '坏标·仅尾部转交语', input: DIRECTIVE + '\n\n如果需要调整，告诉我。', expect: 'strip', mustContain: '【任务】', mustNotContain: '告诉我' },
  { name: '坏标·"以下是优化后的提示词"开场', input: '以下是我为你优化后的提示词：\n\n' + DIRECTIVE, expect: 'strip', mustContain: '【任务】', mustNotContain: '优化后的提示词' },
  { name: '坏标·光杆分隔线包装（无转交语）', input: '---\n\n' + DIRECTIVE + '\n\n---', expect: 'strip-fence', mustContain: '【任务】', mustNotContain: '---' },
  { name: '金标·纯净指令必须一字不改', input: GOLD, expect: 'same' },
  { name: '金标·正文含"复制到"不得误伤', input: GOLD, expect: 'same' },
  { name: '金标·末尾"修改 config.json"不得误伤', input: GOLD_TAIL, expect: 'same' },
  { name: '金标·末尾"同步更新 CHANGELOG"不得误伤', input: DIRECTIVE + '\n' + '如果需要调整文案，请同步更新 CHANGELOG.md。', expect: 'same' },
  { name: '金标·末尾"先改 lib 再跑测试"不得误伤', input: DIRECTIVE + '\n' + '需要修改的地方先改 lib/index.js，再跑一次测试。', expect: 'same' },
  { name: '金标·末尾"完成后告诉我"不得误伤', input: GOLD_TELL, expect: 'same' },
  { name: '降级·整段都是转交语（剥完为空）', input: '把下面这段整条发给工作 AI', expect: 'never-empty' },
  { name: '降级·空串', input: '', expect: 'never-empty' },
  { name: '降级·非字符串', input: null, expect: 'never-empty' },
];

(async () => {
  const mod = await import(MOD);
  const V = mod.__addresseeVerify;
  if (!V || typeof V.enforceAddressee !== 'function') { console.error('❌ 取不到 __addresseeVerify.enforceAddressee'); process.exit(1); }
  const { enforceAddressee, OUTPUT_ADDRESSEE_CONTRACT } = V;

  console.log('契约块长度 = ' + OUTPUT_ADDRESSEE_CONTRACT.length + ' 字符（每个策略的 system 都会追加）');
  console.log('');
  let bad = 0;
  for (const c of cases) {
    const r = enforceAddressee(c.input);
    const src = typeof c.input === 'string' ? c.input : '';
    let ok = true, why = '';
    if (c.expect === 'same') {
      ok = r.text === src && r.triggered === false;
      why = ok ? '' : '预期一字不改，实际 ' + JSON.stringify({ triggered: r.triggered, action: r.action, after: r.after });
    } else if (c.expect === 'never-empty') {
      // 空入 → 空出（本就无内容可给）是正确行为；非空入 → 绝不返回空
      ok = typeof r.text === 'string' && (src ? r.text.length > 0 : r.text === '');
      why = ok ? '' : '预期绝不返回空/不抛错，实际 ' + JSON.stringify({ text: String(r.text).slice(0, 40), action: r.action });
    } else {
      const stripped = r.triggered === true && r.text !== src && r.text.length > 0;
      ok = stripped && (!c.mustContain || r.text.includes(c.mustContain)) && (!c.mustNotContain || !r.text.includes(c.mustNotContain));
      why = ok ? '' : '预期剥掉包装，实际 ' + JSON.stringify({ triggered: r.triggered, action: r.action, head: r.text.slice(0, 60) });
      if (c.expect === 'strip-fence' && ok) ok = /fence/.test(String(r.action));
    }
    if (!ok) bad++;
    console.log((ok ? '✓' : '❌') + ' ' + c.name);
    console.log('    action=' + r.action + '  before=' + r.before + ' → after=' + r.after + (r.head ? '  head="' + r.head + '"' : ''));
    if (!ok) console.log('    ↳ ' + why);
  }
  console.log('');
  console.log(bad === 0 ? '判定：判官有效——坏标全部拦下且金标一字未动。' : '判定：❌ ' + bad + ' 条未达预期（判官不可用，不得据此改动上游）。');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
