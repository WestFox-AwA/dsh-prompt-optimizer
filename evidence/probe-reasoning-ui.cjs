// UI 层收尾证据：node evidence/probe-reasoning-ui.cjs [tier] [seconds]
// 走宿主下发的 run-demo 探针：**在浏览器里真跑一次优化**，回报「思考」折叠栏是否存在、是否展开、摘要字数。
const fs = require('node:fs');
const path = require('node:path');
const tier = process.argv[2] || 'extreme';
const waitSec = Number(process.argv[3] || 150);
const pluginsDir = path.join(__dirname, '..', '..');
let live = null;
for (const d of fs.readdirSync(pluginsDir).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) {
  const f = path.join(pluginsDir, d, 'package', 'evidence', 'client-beacon.jsonl');
  if (!fs.existsSync(f)) continue;
  const st = fs.statSync(f);
  if (!live || st.mtimeMs > live.mtimeMs) live = { name: d, file: f, mtimeMs: st.mtimeMs };
}
if (!live) { console.error('no live instance'); process.exit(1); }
const token = 'reasonui-' + Date.now();
fs.writeFileSync(path.join(path.dirname(live.file), 'cmd.json'), JSON.stringify({ run: 'run-demo', token, tier, text: '把这个插件的版本号在所有地方统一一下。' }, null, 2), 'utf8');
console.log('live = ' + live.name + '  已下发 run-demo tier=' + tier + ' token=' + token);

const t0 = Date.now();
const tick = () => {
  const lines = fs.readFileSync(live.file, 'utf8').split('\n').filter(Boolean);
  let ui = null; let start = null; let refused = null;
  for (const l of lines.slice(-500)) {
    let o = null; try { o = JSON.parse(l) } catch (e) { continue; }
    // 注意：beacon 的字段名是 stage（不是 kind）
    const k = o.stage || o.kind || o.name;
    if (k === 'run-demo-ui' && o.token === token) ui = o;
    if (k === 'run-demo-start' && o.token === token) start = o;
    if (k === 'run-demo-refused' || k === 'run-demo-deferred') refused = o;
  }
  if (refused) { console.error('探针拒绝/推迟：' + JSON.stringify(refused)); process.exit(4); }
  if (ui) {
    const folds = ui.folds || [];
    const thinking = folds.find((f) => f.key === 'thinking') || null;
    console.log('');
    console.log('浏览器内实跑结果（真实 DOM）：');
    console.log('  start = ' + JSON.stringify(start));
    console.log('  status=' + ui.status + '  正文=' + ui.chars + ' 字');
    console.log('  思考折叠栏 = ' + JSON.stringify(thinking));
    console.log('  全部折叠栏 = ' + JSON.stringify(folds));
    console.log('  思考 token 芯片 = ' + JSON.stringify(ui.tokReasoning) + '  未上报=' + ui.tokNone + '  总用量=' + JSON.stringify(ui.tokTotal));
    const m = thinking && thinking.summary ? String(thinking.summary).match(/([0-9]+)\s*字/) : null;
    const chars = m ? Number(m[1]) : 0;
    const ok = Boolean(thinking && thinking.exists) && chars > 0;
    console.log('');
    console.log(ok ? '判定：UI 达标 ✓（「思考」栏存在且显示 ' + chars + ' 字推理）' : '判定：❌ 「思考」栏为空或不存在');
    process.exit(ok ? 0 : 2);
  }
  if (Date.now() - t0 > waitSec * 1000) { console.error('超时：未收到 run-demo-ui 回报'); process.exit(3); }
  setTimeout(tick, 3000);
};
tick();
