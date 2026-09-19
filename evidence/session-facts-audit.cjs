// 工作 AI 到底有没有被告诉"自己的权限档"？ —— 查会话日志里有没有沙箱策略事实
//   node evidence/prompt-facts-audit.cjs [sessionId子串...]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');
const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const want = targets.length ? targets : ['04ade894', '4cd41964', 'ae0b2c09'];

const files = [];
(function walk(d, depth) {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) files.push({ p, dir: path.basename(d), m: fs.statSync(p).mtimeMs });
  }
})(ROOT, 0);
files.sort((a, b) => b.m - a.m);

const PROBES = [
  'Current DSH file policy',
  'does not restrict file modifications',
  'Approval prompts are disabled',
  'Approval policy: ask',
  'named pipes',
  'ConstrainedLanguage',
];

for (const t of want) {
  const f = files.find((x) => x.dir.includes(t));
  if (!f) { console.log(t + '：找不到日志'); continue }
  const evts = decodeAll(f.p).text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
  const types = {};
  for (const e of evts) types[e.type] = (types[e.type] || 0) + 1;
  console.log(`\n════ ${f.dir}  事件 ${evts.length} 条`);
  for (const probe of PROBES) {
    const where = [];
    for (const e of evts) {
      if ((JSON.stringify(e.data) || '').includes(probe)) where.push(e.type);
    }
    const uniq = [...new Set(where)];
    console.log(`   ${uniq.length ? '✓' : '✗'} ${probe.padEnd(34)} ${uniq.length ? uniq.join(', ') + ' ×' + where.length : '（整段日志里没有）'}`);
  }
  const sm = evts.find((e) => e.type === 'system/message');
  if (sm) {
    const s = JSON.stringify(sm.data);
    console.log(`   system/message 长度=${s.length}`);
    console.log(`     开头: ${s.slice(0, 160)}`);
  }
  const um = evts.filter((e) => e.type === 'user/message');
  if (um.length) console.log(`   user/message ×${um.length}，第一条开头: ${JSON.stringify(um[0].data).slice(0, 200)}`);
  console.log('   事件类型: ' + Object.entries(types).map(([k, v]) => `${k}×${v}`).join(', '));
}
