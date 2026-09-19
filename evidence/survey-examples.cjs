// 把 survey-permission-claims.json 里命中"声称"类的会话重新解码，原样打印句子（判断真假，不靠猜）
//   node evidence/survey-examples.cjs [最多会话=12] [--mode=danger-full-access|workspace-write+ask|all]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const SURVEY = path.join(__dirname, 'survey-permission-claims.json');
const N = Number(process.argv[2] || 12);
const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=danger-full-access').split('=')[1];
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');

const SENT = {
  '无权限': /[^。；\n]{0,80}((没有|无|缺少|不具备)[^。；\n]{0,8}权限|权限(不足|受限|不够|被限))[^。；\n]{0,80}/g,
  '无法验证/测试/截图/调试': /[^。；\n]{0,80}(无法(进行)?(验证|测试|调试|截图|预览|运行|实机|访问|启动)|不能(验证|测试|调试|截图|预览|运行)|没法(验证|测试|调试|截图|运行))[^。；\n]{0,80}/g,
  '把验证推给用户': /[^。；\n]{0,80}((需要|请|得|只能|麻烦)(你|您|用户)(自己)?[^。；\n]{0,10}(检查|确认|看看|验证|运行|测试|试一下|截图))[^。；\n]{0,80}/g,
  '声称缺少能力/工具': /[^。；\n]{0,80}(我(没有|不具备)[^。；\n]{0,10}(工具|能力|手段|权限)|没有(可用的)?(浏览器|截图|可视化)[^。；\n]{0,6}(工具|能力|手段))[^。；\n]{0,80}/g,
};
const SHOT_ARG = /--screenshot|msedge|chrome\.exe|playwright|puppeteer|--headless/i;
const SHOT_TOOL = /^(read_image|mcp__godot-ai__editor_screenshot)$/;

const files = new Map();
(function walk(d, depth) {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) files.set(path.basename(d), p);
  }
})(ROOT, 0);

const survey = JSON.parse(fs.readFileSync(SURVEY, 'utf8'));
let pool = survey.rows.filter((r) => Object.keys(r.hits).length > 0 && !/ae0b2c09|94fd09c7/.test(r.sid));
if (MODE !== 'all') pool = pool.filter((r) => `${r.mode}+${r.approval}` === MODE || r.mode === MODE);
pool = pool.sort((a, b) => b.msgs - a.msgs).slice(0, N);

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

let shotSessions = 0; let total = 0;
for (const r of pool) {
  const p = files.get(r.sid);
  if (!p) continue;
  total++;
  const evts = decodeAll(p).text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  const assistant = [];
  const calls = [];
  for (const e of evts) {
    if (e.type === 'assistant/message') { const t = textOfMessage(e.data && e.data.message); if (t) assistant.push(t) }
    else if (e.type === 'tool/call') calls.push({ name: (e.data && e.data.name) || '?', args: String((e.data && e.data.arguments) || '') });
    else if (e.type === 'tool/ptc-dispatch') calls.push({ name: String((e.data && (e.data.tool || e.data.name)) || 'ptc'), args: JSON.stringify(e.data || {}) });
  }
  const all = assistant.join('\n');
  const realShot = calls.filter((c) => SHOT_TOOL.test(c.name) || SHOT_ARG.test(c.args));
  if (realShot.length) shotSessions++;
  console.log(`\n════ [${r.sid.slice(8, 20)}] ${r.when}  ${r.mode}+${r.approval}  preset=${r.preset}  助手条目=${r.msgs} 工具调用=${calls.length}`);
  console.log(`     真截图/看图动作: ${realShot.length} 次 ${realShot.length ? '(' + [...new Set(realShot.map((c) => c.name))].join(',') + ')' : '—— 一次都没有'}`);
  const seen = new Set();
  for (const [label, re] of Object.entries(SENT)) {
    const g = new RegExp(re.source, 'g');
    let m; let c = 0;
    while ((m = g.exec(all))) {
      const s = m[0].replace(/\s+/g, ' ').trim().slice(0, 260);
      if (seen.has(s)) continue;
      seen.add(s);
      console.log(`   [${label}] ${s}`);
      if (++c >= 3) break;
    }
  }
}
console.log(`\n汇总：抽查 ${total} 个会话，其中真的截图/看图过的 ${shotSessions} 个。`);
