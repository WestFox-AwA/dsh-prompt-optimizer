// UI 运行时证据：node evidence/probe-tools-row.cjs [seconds]
// 走宿主下发的 popover-demo 探针：打开"优化模型"弹层 → 读**真实 DOM** → 回传 beacon。
// 判据：label 文本 =「只读权限：」、开关 data-selected=true（默认开）、且两者同一行、不出界。
const fs = require('node:fs');
const path = require('node:path');
const pluginsDir = path.join(__dirname, '..', '..');
let live = null;
for (const d of fs.readdirSync(pluginsDir).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  const f = path.join(pluginsDir, d, 'package', 'evidence', 'client-beacon.jsonl');
  if (!fs.existsSync(f)) continue;
  const st = fs.statSync(f);
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, file: f, size: st.size, mtimeMs: st.mtimeMs };
}
if (!live) { console.error('no live instance'); process.exit(1); }
const token = 'toolsrow-' + Date.now();
fs.writeFileSync(path.join(path.dirname(live.file), 'cmd.json'), JSON.stringify({ run: 'popover-demo', token }, null, 2), 'utf8');
console.log('live = ' + live.name + '  cmd 已下发 token=' + token);

const waitSec = Number(process.argv[2] || 60);
const t0 = Date.now();
const tick = () => {
  const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean);
  const hits = [];
  for (const l of lines.slice(-400)) {
    let o = null;
    try { o = JSON.parse(l) } catch (e) { continue; }
    if (o && (o.kind === 'popover-demo' || o.name === 'popover-demo' || o.toolsLabel !== undefined)) hits.push(o);
  }
  const last = hits[hits.length - 1];
  if (last && Date.now() - t0 > 1500) {
    const pick = (o, k) => (o && o[k] !== undefined ? o[k] : (o && o.payload && o.payload[k] !== undefined ? o.payload[k] : undefined));
    const payload = last.payload || last;
    console.log('');
    console.log('探针回报（真实 DOM）：');
    console.log('  toolsLabel = ' + JSON.stringify(payload.toolsLabel));
    console.log('  toolsBtn   = ' + JSON.stringify(payload.toolsBtn));
    console.log('  toolsOn    = ' + JSON.stringify(payload.toolsOn));
    console.log('  toolsRow   = ' + JSON.stringify(payload.toolsRow));
    console.log('  弹层 open=' + JSON.stringify(payload.open) + ' groups=' + payload.groups + ' items=' + payload.items + ' inView=' + JSON.stringify(payload.inView));
    // 同一批里最近一次 apply（客户端构建标签）——确认页面跑的是新客户端
    let build = null;
    for (const l of lines.slice(-400)) {
      try { const o = JSON.parse(l); const b = (o.payload && o.payload.build) || o.build; if (b && (!build || true)) build = b; } catch (e) { /* skip */ }
    }
    console.log('  页面客户端 build 标签（最近一条）= ' + JSON.stringify(build));
    const ok = payload.toolsLabel === '只读权限：' && payload.toolsOn === 'true' && payload.toolsRow && payload.toolsRow.sameLine === true && payload.toolsRow.btnRightOfLabel === true;
    console.log('');
    console.log(ok ? '判定：UI 达标 ✓（文案=只读权限：、开关=开、同一行、在文案右侧）' : '判定：❌ 未达标');
    process.exit(ok ? 0 : 2);
  }
  if (Date.now() - t0 > waitSec * 1000) { console.error('超时：探针未回报（页面未轮询 / 客户端未更新 / 弹层未打开）'); process.exit(3); }
  setTimeout(tick, 2500);
};
tick();
