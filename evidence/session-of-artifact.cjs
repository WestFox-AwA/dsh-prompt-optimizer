// 找出"产出某个交付物"的会话，并回答：交付前它到底跑没跑、说了什么
//   node evidence/session-of-artifact.cjs <文件名子串> [最近会话数=40]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const needle = process.argv[2];
if (!needle) { console.log('用法: node session-of-artifact.cjs <文件名子串> [N]'); process.exit(1) }
const N = Number(process.argv[3] || 40);
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');

const files = [];
(function walk(d, depth) {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) files.push({ p, sid: path.basename(d), m: fs.statSync(p).mtimeMs });
  }
})(ROOT, 0);
files.sort((a, b) => b.m - a.m);

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

let found = 0;
for (const f of files.slice(0, N)) {
  let evts;
  try {
    evts = decodeAll(f.p).text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  } catch { continue }
  const raw = JSON.stringify(evts);
  if (!raw.includes(needle)) continue;
  found++;
  const assistant = [];
  const calls = [];
  for (const e of evts) {
    if (e.type === 'assistant/message') { const t = textOfMessage(e.data && e.data.message); if (t) assistant.push(t) }
    else if (e.type === 'tool/call') calls.push({ t: e.time, name: String((e.data && e.data.name) || '?'), args: String((e.data && e.data.arguments) || '') });
  }
  const render = calls.filter((c) => /msedge|--headless|--screenshot|read_image|--dump-dom/i.test(c.args) || /read_image/.test(c.name));
  const writes = calls.filter((c) => new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(c.args));
  console.log(`\n════ ${f.sid}  ${new Date(f.m).toISOString().slice(0, 16).replace('T', ' ')}  助手条目=${assistant.length} 工具调用=${calls.length}`);
  console.log(`   提到 ${needle} 的调用=${writes.length}  渲染/看图类调用=${render.length}`);
  if (render.length) {
    for (const r of render.slice(-4)) console.log(`     [${new Date(r.t).toISOString().slice(11, 19)}] ${r.name} ${r.args.replace(/\s+/g, ' ').slice(0, 150)}`);
  }
  const tail = assistant.slice(-2);
  for (const t of tail) {
    console.log('   ── 末尾正文 ──');
    console.log('   ' + t.replace(/\n/g, '\n   ').slice(0, 1400));
  }
  if (found >= 3) break;
}
if (!found) console.log(`最近 ${N} 个会话里没有提到 ${needle}`);
