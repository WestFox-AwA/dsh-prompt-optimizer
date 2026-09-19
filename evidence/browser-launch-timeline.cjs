// 「浏览器为什么起不来」时间线取证：把档位变更事件 vs 每次 msedge/screenshot 尝试按时间对齐
//   node evidence/browser-launch-timeline.cjs [最近N个会话=8] [--sid=xxxx]
// 关键点：sandbox/mode 是**会话中途可切**的，取最后一次档位会把早期受限档的失败误记到全权档头上。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');
const N = Number(process.argv[2] || 8);
const SID = (process.argv.find((a) => a.startsWith('--sid=')) || '').split('=')[1];
const SKIP = /ae0b2c09|94fd09c7/;

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
const targets = (SID ? files.filter((f) => f.sid.includes(SID)) : files.filter((f) => !SKIP.test(f.sid)).slice(0, N));

const BROWSERISH = /msedge|chrome\.exe|--screenshot|--headless|--dump-dom|playwright|puppeteer/i;
const DENY = /Access is denied|拒绝访问|EPERM|not permitted|被拒绝/i;
const t = (ms) => new Date(ms).toISOString().slice(11, 19);

for (const f of targets) {
  const evts = decodeAll(f.p).text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  const marks = evts.filter((e) => e.type === 'sandbox/mode' || e.type === 'approval/policy' || e.type === 'permission/preset');
  const calls = new Map();
  const order = [];
  for (const e of evts) {
    if (e.type === 'tool/call') {
      const a = e.data && e.data.arguments ? String(e.data.arguments) : '';
      calls.set(e.data.callId, { time: e.time, name: e.data.name, args: a, res: null });
    } else if (e.type === 'tool/result') {
      const id = e.data && e.data.message && e.data.message.source && e.data.message.source.callId;
      const rec = calls.get(id);
      if (rec) rec.res = JSON.stringify(e.data.message.content);
    }
  }
  for (const rec of calls.values()) if (BROWSERISH.test(rec.args) || (rec.res && BROWSERISH.test(rec.res))) order.push(rec);
  order.sort((a, b) => a.time - b.time);
  console.log(`\n════════ ${f.sid}  ${new Date(f.m).toISOString().slice(0, 16).replace('T', ' ')}  档位事件=${marks.length}  浏览器相关调用=${order.length}`);
  console.log('   档位时间线: ' + (marks.length ? marks.map((e) => `${t(e.time)} ${e.type}=${JSON.stringify(e.data)}`).join('  →  ') : '(无)'));
  let denied = 0;
  for (const rec of order.slice(0, 12)) {
    const res = (rec.res || '').replace(/\\[rn]/g, ' ').replace(/\s+/g, ' ');
    const isDeny = DENY.test(res);
    if (isDeny) denied++;
    const brief = (rec.args.match(/--[a-z-]+/g) || []).slice(0, 6).join(' ');
    console.log(`   ${t(rec.time)} [${rec.name}] ${brief}`);
    console.log(`        → ${res.slice(0, 260)}${isDeny ? '   ⚠️DENIED' : ''}`);
  }
  console.log(`   小结：浏览器相关调用 ${order.length} 次，其中结果里出现"拒绝/Access is denied" ${denied} 次`);
}
