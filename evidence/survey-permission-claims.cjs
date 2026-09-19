// 「开了 danger-full-access，AI 还说自己没权限 / 不跑调试截图」到底什么情况 —— 全量会话普查
//   node evidence/survey-permission-claims.cjs [最多会话数=0(全部)] [--examples]
// 数据源（都是只读）：
//   ~/.dsh/sessions/**/session*.jsonl.zst*  → 多帧解码（evidence/zstd-frames.cjs）
//     档位取自日志事件：sandbox/mode · approval/policy · permission/preset（取最后一次）
//     正文取自 assistant/message；动作取自 tool/call + tool/ptc-dispatch
// 判据刻意分开：提及沙箱 ≠ 声称没权限；声称没权限 ≠ 没真跑验证。四类分别计数，例句原样打印。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');
const LIMIT = Number(process.argv[2] || 0);
const SHOW = process.argv.includes('--examples');
const OUT = path.join(__dirname, 'survey-permission-claims.json');

const CLAIMS = [
  ['无权限', /(没有|无|缺少|不具备)[^。；\n]{0,8}权限|权限(不足|受限|不够|被限)|没有(写|执行|读|访问)[^。；\n]{0,4}权限/],
  ['沙箱限制', /(被|受)?沙箱[^。；\n]{0,8}(限制|禁止|拦截|不允许|挡住)|沙箱环境[^。；\n]{0,6}(无法|不能)|sandbox[^.\n]{0,20}(restrict|deny|block|prevent)/i],
  ['无法验证/测试/截图/调试', /无法(进行)?(验证|测试|调试|截图|预览|运行|实机|访问|启动)|不能(验证|测试|调试|截图|预览|运行)|没法(验证|测试|调试|截图|运行)|我(无法|不能)(为你|帮你)?(验证|确认)/],
  ['把验证推给用户', /(需要|请|得|只能|麻烦)(你|您|用户)(自己)?[^。；\n]{0,10}(检查|确认|看看|验证|运行|测试|试一下|截图)/],
  ['声称缺少能力/工具', /我(没有|不具备)[^。；\n]{0,10}(工具|能力|手段|权限)|没有(可用的)?(浏览器|截图|可视化)[^。；\n]{0,6}(工具|能力|手段)/],
];
const SHOTISH = /msedge|chrome|chromium|headless|screenshot|playwright|puppeteer|--screenshot|read_image/i;
const RUNTASK = /^(pwsh|bash|shell|run_code|workflow|subagent|subagent_fork)$/;

const files = [];
(function walk(d, depth) {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) {
      const st = fs.statSync(p);
      files.push({ p, sid: path.basename(d), m: st.mtimeMs, size: st.size });
    }
  }
})(ROOT, 0);
files.sort((a, b) => b.m - a.m);
const targets = LIMIT ? files.slice(0, LIMIT) : files;
console.log(`会话日志 ${files.length} 个，本次分析 ${targets.length} 个\n`);

const last = (evts, type) => {
  for (let i = evts.length - 1; i >= 0; i--) if (evts[i].type === type) return evts[i].data;
  return null;
};
const textOfMessage = (msg) => {
  const parts = [];
  const push = (c) => {
    if (typeof c === 'string') { parts.push(c); return }
    if (Array.isArray(c)) { for (const b of c) push(b); return }
    if (c && typeof c === 'object') {
      if (typeof c.text === 'string' && c.type !== 'tool-result') parts.push(c.text);
      if (c.content !== undefined && c.content !== c) push(c.content);
    }
  };
  push(msg && msg.content);
  return parts.join('\n').trim();
};

const rows = [];
let t0 = Date.now();
for (const f of targets) {
  let evts;
  try {
    const r = decodeAll(f.p);
    evts = r.text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  } catch { continue }
  const mode = last(evts, 'sandbox/mode');
  const policy = last(evts, 'approval/policy');
  const presetEv = last(evts, 'permission/preset');
  const assistant = [];
  const calls = [];
  for (const e of evts) {
    if (e.type === 'assistant/message') {
      const t = textOfMessage(e.data && e.data.message);
      if (t) assistant.push(t);
    } else if (e.type === 'tool/call') {
      calls.push({ name: (e.data && e.data.name) || '?', args: String((e.data && e.data.arguments) || '') });
    } else if (e.type === 'tool/ptc-dispatch') {
      calls.push({ name: (e.data && (e.data.name || e.data.tool)) || 'ptc', args: String((e.data && e.data.arguments) || '') });
    }
  }
  const all = assistant.join('\n');
  const hits = {};
  const samples = [];
  for (const [name, re] of CLAIMS) {
    const g = new RegExp(re.source, 'gi');
    let m; let c = 0;
    while ((m = g.exec(all))) {
      c++;
      if (SHOW && samples.length < 4) samples.push(`[${name}] …${all.slice(Math.max(0, m.index - 70), m.index + 150).replace(/\s+/g, ' ')}…`);
      if (c > 50) break;
    }
    if (c) hits[name] = c;
  }
  const shot = calls.filter((c) => SHOTISH.test(c.name) || SHOTISH.test(c.args));
  const taskCalls = calls.filter((c) => RUNTASK.test(c.name));
  rows.push({
    sid: f.sid, when: new Date(f.m).toISOString().slice(0, 16).replace('T', ' '),
    mode: (mode && mode.mode) || '?', approval: (policy && policy.policy) || '?',
    preset: presetEv ? String(presetEv.preset) : '(none)',
    msgs: assistant.length, calls: calls.length, tasks: taskCalls.length, shots: shot.length,
    chars: all.length, hits, samples,
    shotNames: [...new Set(shot.map((c) => c.name))].slice(0, 4),
  });
}
console.log(`解码完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const group = (r) => `${r.mode}+${r.approval}`;
const by = {};
for (const r of rows) (by[group(r)] ||= []).push(r);
console.log('档位(sandbox+approval)      会话  有条目  跑了任务  跑过截图/浏览器  出现"声称"类句子  其中同时跑过截图');
for (const [k, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  const withMsgs = list.filter((r) => r.msgs > 0).length;
  const withTask = list.filter((r) => r.tasks > 0).length;
  const withShot = list.filter((r) => r.shots > 0).length;
  const withClaim = list.filter((r) => Object.keys(r.hits).length > 0).length;
  const claimShot = list.filter((r) => Object.keys(r.hits).length > 0 && r.shots > 0).length;
  console.log(`${k.padEnd(26)} ${String(list.length).padStart(5)} ${String(withMsgs).padStart(6)} ${String(withTask).padStart(9)} ${String(withShot).padStart(16)} ${String(withClaim).padStart(16)} ${String(claimShot).padStart(18)}`);
}
const tally = {};
for (const r of rows) for (const [k, v] of Object.entries(r.hits)) tally[k] = (tally[k] || 0) + v;
console.log('\n声称类句子分布（条数）:', JSON.stringify(tally, null, 0));
const dfa = rows.filter((r) => r.mode === 'danger-full-access');
console.log(`\ndanger-full-access 会话 ${dfa.length} 个：`);
console.log(`   跑过任务命令: ${dfa.filter((r) => r.tasks > 0).length}`);
console.log(`   真的用过截图/浏览器: ${dfa.filter((r) => r.shots > 0).length}  (工具名: ${JSON.stringify([...new Set(dfa.flatMap((r) => r.shotNames))])})`);
console.log(`   正文里出现"声称"类句子: ${dfa.filter((r) => Object.keys(r.hits).length > 0).length}`);
if (SHOW) {
  console.log('\n—— 例句（按时间倒序，最多 14 条）——');
  let n = 0;
  for (const r of rows) {
    if (!Object.keys(r.hits).length) continue;
    console.log(`\n[${r.sid.slice(8, 20)}] ${r.when} ${r.mode}+${r.approval} preset=${r.preset} msgs=${r.msgs} tasks=${r.tasks} shots=${r.shots} 命中=${Object.keys(r.hits).join(',')}`);
    for (const s of r.samples) console.log('   · ' + s.slice(0, 330));
    if (++n >= 14) break;
  }
}
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1));
console.log(`\n明细已写入 ${path.relative(process.cwd(), OUT)}`);
