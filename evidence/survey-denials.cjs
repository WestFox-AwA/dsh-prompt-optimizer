// 「为什么开了 danger-full-access 还说自己没权限/不截图」普查：
//   node evidence/survey-denials.cjs [会话数=60] [--examples]
//   档位：从会话日志第一帧（zstd 头帧）解出 sandbox/approval/preset
//   行为：走插件 /transcript 路由取真实对话（含工具调用摘要）
//   判据：助手文本里出现「沙箱/无权限/无法测试·调试·截图」等候选句 + 是否真的跑过截图/浏览器
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');
const API = process.env.PO_API || 'http://127.0.0.1:3080/prompt-optimizer/api/transcript';
const N = Number(process.argv[2] || 60);
const SHOW = process.argv.includes('--examples');

const files = [];
const walk = (d, depth) => {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) files.push({ p, dir: path.basename(d), m: fs.statSync(p).mtimeMs, size: fs.statSync(p).size });
  }
};
walk(ROOT, 0);
files.sort((a, b) => b.m - a.m);

// 头帧解出档位（后续帧是消息，zstdDecompressSync 只吃第一帧）
const headFacts = (p) => {
  try {
    const head = zlib.zstdDecompressSync(fs.readFileSync(p)).toString('utf8');
    const g = (k) => (new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"').exec(head) || [])[1];
    const preset = (/"preset"\s*:\s*"([^"]*)"/.exec(head) || [])[1];
    return { sandbox: g('sandbox') || '?', approval: g('approval') || '?', preset: preset || '(null)', cwd: g('cwd') || '' };
  } catch { return { sandbox: '?', approval: '?', preset: '?', cwd: '' } };
};

const EXCUSES = [
  ['沙箱', /沙箱|sandbox/i],
  ['声称无权限', /(没有|无|缺少|不具备)[^。；\n]{0,6}权限|权限(不足|受限|不够)|没有(写|执行|读)?权限/],
  ['声称无法测试/调试/截图/验证', /无法(进行)?(测试|调试|截图|验证|运行|实机|预览|访问)|不能(测试|调试|截图|验证|运行|预览)|没法(测试|调试|截图|验证|运行)/],
  ['把验证推给用户', /(需要|请|得|只能)(你|您|用户)(自己)?[^。；\n]{0,8}(检查|确认|看看|验证|运行|测试|截图)|我(无法|不能)(为你|帮你)?(验证|确认)/],
];
const SHOTISH = /msedge|chrome|headless|screenshot|截图|read_image|playwright|puppeteer/i;

(async () => {
  const targets = files.slice(0, N);
  const rows = [];
  for (const f of targets) {
    const sid = f.dir;
    const fact = headFacts(f.p);
    let j = null;
    try {
      const r = await fetch(`${API}?sessionId=${sid}&n=400&chars=1400`);
      j = await r.json();
    } catch { j = null }
    const msgs = (j && j.rows) || [];
    const assistant = msgs.filter((m) => m.role === 'assistant' && m.text);
    const calls = [];
    for (const m of msgs) for (const t of (m.tools || [])) calls.push(t);
    const hits = {};
    const samples = [];
    for (const m of assistant) {
      const t = m.text.replace(/\s+/g, ' ');
      for (const [name, re] of EXCUSES) {
        if (re.test(t)) {
          hits[name] = (hits[name] || 0) + 1;
          if (SHOW && samples.length < 3) {
            const m2 = re.exec(t);
            samples.push(`${name}: …${t.slice(Math.max(0, m2.index - 60), m2.index + 160)}…`);
          }
        }
      }
    }
    const shot = calls.filter((c) => SHOTISH.test(c));
    const cmd = calls.filter((c) => /call:(pwsh|run_code|shell|bash)\b/.test(c));
    rows.push({ sid, when: new Date(f.m).toISOString().slice(5, 16).replace('T', ' '), mode: `${fact.sandbox}+${fact.approval}`, preset: fact.preset, msg: msgs.length || (j && j.count) || 0, cmds: cmd.length, shots: shot.length, hits, samples, api: !!j });
  }

  const by = {};
  for (const r of rows) (by[r.mode] ||= []).push(r);
  console.log(`扫描最近 ${rows.length} 个会话（日志 → 头帧档位 + /transcript 对话）\n`);
  console.log('档位(sandbox+approval)      会话数  有对话  跑过命令  跑过截图  候选借口句(会话数)');
  for (const [mode, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
    const withApi = list.filter((r) => r.api && r.msg > 0).length;
    const anyCmd = list.filter((r) => r.cmds > 0).length;
    const anyShot = list.filter((r) => r.shots > 0).length;
    const anyHit = list.filter((r) => Object.keys(r.hits).length > 0).length;
    console.log(`${mode.padEnd(28)} ${String(list.length).padStart(5)}  ${String(withApi).padStart(6)}  ${String(anyCmd).padStart(8)}  ${String(anyShot).padStart(8)}  ${String(anyHit).padStart(6)}`);
  }
  const tally = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.hits)) tally[k] = (tally[k] || 0) + v;
  console.log('\n候选借口句分类（消息条数）:', tally);
  const noShot = rows.filter((r) => r.api && r.cmds > 0 && r.shots === 0).length;
  console.log(`跑过命令、却一次截图/浏览器都没碰过的会话: ${noShot}`);
  if (SHOW) {
    console.log('\n—— 例子（会话 / 档位 / 命中）——');
    for (const r of rows.filter((x) => Object.keys(x.hits).length).slice(0, 12)) {
      console.log(`\n[${r.sid}] ${r.when} ${r.mode} preset=${r.preset} msgs=${r.msg} cmds=${r.cmds} shots=${r.shots}`);
      for (const s of r.samples) console.log('   · ' + s);
    }
  }
})();
