// 通用 UI 探针：node evidence/probe-cmd.cjs <cmdName> [seconds] [jsonExtra]
// 下发一条宿主命令给浏览器，等待同名 beacon 回报并打印（beacon 的字段名是 stage，不是 kind）。
const fs = require('node:fs');
const path = require('node:path');
const cmdName = process.argv[2];
const waitSec = Number(process.argv[3] || 120);
const extra = process.argv[4] ? JSON.parse(process.argv[4]) : {};
if (!cmdName) { console.error('用法: node evidence/probe-cmd.cjs <cmdName> [seconds] [jsonExtra]'); process.exit(1); }
const pluginsDir = path.join(__dirname, '..', '..');
let live = null;
for (const d of fs.readdirSync(pluginsDir).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  const f = path.join(pluginsDir, d, 'package', 'evidence', 'client-beacon.jsonl');
  if (!fs.existsSync(f)) continue;
  const st = fs.statSync(f);
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, file: f, mtimeMs: st.mtimeMs };
}
if (!live) { console.error('no live instance'); process.exit(1); }
const token = cmdName + '-' + Date.now();
fs.writeFileSync(path.join(path.dirname(live.file), 'cmd.json'), JSON.stringify(Object.assign({ run: cmdName, token }, extra), null, 2), 'utf8');
console.log('live = ' + live.name + '  已下发 ' + cmdName + ' token=' + token);
const t0 = Date.now();
const tick = () => {
  const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean);
  let hit = null;
  for (const l of lines.slice(-600)) {
    let o = null; try { o = JSON.parse(l) } catch (e) { continue; }
    const k = o.stage || o.kind || o.name;
    if (k === cmdName) hit = o;
  }
  if (hit && Date.now() - t0 > 2000) {
    const clean = Object.assign({}, hit); delete clean.stage; delete clean.t; delete clean.token;
    console.log('');
    console.log('探针回报 ' + cmdName + '（' + new Date(hit.t).toLocaleTimeString() + '）：');
    console.log(JSON.stringify(clean, null, 1));
    process.exit(hit.pass === false ? 2 : 0);
  }
  if (Date.now() - t0 > waitSec * 1000) { console.error('超时：未收到 ' + cmdName + ' 回报'); process.exit(3); }
  setTimeout(tick, 2500);
};
tick();
