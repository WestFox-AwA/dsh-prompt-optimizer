// ① 档位次序在两种形态下是否仍然成立（"定义不丢失"的真正判据：极端 > 高级 > 普通）
// ② 中断题在新兜底（45s 停顿看门狗 + 240s 硬上限）下是否还能跑完
//   node evidence/verify-tier-ordering.cjs
// 复用同一套正则（与 ptc-ab.cjs 一致），只加"深度"两个指标。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const M = {
  hard: /必须|不得|严禁|不许|禁止|一律|绝不/g,
  process: /goal|todo|分阶段|逐层|切片|贴出|运行输出|证据形式|不做项|停手条件|阶段文档/gi,
  stepwise: /逐步|每步|一步一步|一步步|先.{0,6}再.{0,6}(逐|每)/g,
  latitude: /自行决定|自行选择|如无必要|可选|视情况|由你决定|酌情|按惯例|优先选择/g,
  oneShot: /一个程序|一段(脚本|程序)|单个程序|一次(跑完|完成|成型)|PTC|TypeScript|脚本完成|批量完成/gi,
  ux: /界面|UI|操作|手感|键位|灵敏度|反转|提示|可发现|反馈|菜单|按钮|交互/g,
  accept: /判据|验收|完成标准|通过条件/g,
  items: /^\s*(?:[-*•]|\d+[.、)]|第[0-9一二三四五六七八九十]+步)/gm,
  fileRefs: /[A-Za-z0-9_\-./]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|md|gd|tscn|tres|css|html|py|sh)/g,
};
const c = (t, re) => (t.match(re) || []).length;
const avg = (a) => Math.round((a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)) * 100) / 100;
const score = (cells) => {
  const n = Math.max(1, cells.length);
  const p = (k) => cells.reduce((s, x) => s + c(x.command, M[k]), 0) / n;
  return {
    n: cells.length, chars: Math.round(cells.reduce((s, x) => s + Number(x.trueChars || 0), 0) / n),
    items: Math.round(p('items') * 10) / 10, fileRefs: Math.round(p('fileRefs') * 100) / 100,
    accept: Math.round(p('accept') * 10) / 10, process: Math.round(p('process') * 100) / 100,
    aborts: cells.filter((x) => x.status !== 'done').length,
    ptcScore: Math.round(((p('latitude') * 1.5 + p('oneShot') * 1.5 + p('ux') * 1.0 + p('accept') * 0.5) - (p('process') * 1.2 + p('stepwise') * 1.0 + Math.max(0, p('hard') - 6) * 0.8)) * 100) / 100,
  };
};
async function runOne(request, tier) {
  const r = await post('/run', { request, tier });
  const id = r.runId || r.id;
  if (!id) return { status: 'start-failed', command: '', trueChars: 0 };
  for (let i = 0; i < 300; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const list = await j(API + '/runs');
    const rec = (list.runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return { status: rec.status, command: String(rec.text || ''), trueChars: rec.chars, error: rec.error || null, ms: rec.ms };
  }
  return { status: 'timeout', command: '', trueChars: 0 };
}

(async () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'lab-cx.json'), 'utf8')).tasks;
  const out = { at: new Date().toISOString(), shape: 'ptc', tiers: {}, abortRecheck: [] };
  try {
    await post('/state', { delivery: 'ptc', readTools: false });
    for (const tier of ['basic', 'advanced']) {
      const cells = [];
      console.log('--- ptc / ' + tier + ' ---');
      for (const t of tasks) {
        const rec = await runOne(t.prompt, tier);
        cells.push(Object.assign({ taskId: t.id }, rec));
        console.log('  ' + t.id.padEnd(22) + ' ' + String(rec.status).padEnd(6) + ' 真实=' + String(rec.trueChars).padStart(6) + ' 字');
      }
      out.tiers[tier] = score(cells);
    }
    // ② 中断复核：之前被"总时长"砍掉的两题，在新兜底下的表现
    console.log('--- 中断复核（新兜底：45s 停顿看门狗 / 240s 硬上限）---');
    const back = [
      { name: 'C1-3d-scene / ptc（此前 90s 被砍在 9555 字）', request: tasks.find((t) => t.id === 'C1-3d-scene').prompt, tier: 'extreme' },
      { name: 'C2-3d-tank-drive / chat（此前被砍在 4148 字）', request: tasks.find((t) => t.id === 'C2-3d-tank-drive').prompt, tier: 'extreme' },
    ];
    await post('/state', { delivery: 'ptc' });
    const r1 = await runOne(back[0].request, back[0].tier);
    out.abortRecheck.push({ name: back[0].name, mode: 'ptc', status: r1.status, trueChars: r1.trueChars, ms: r1.ms, error: r1.error });
    console.log('  ' + back[0].name + ' → ' + r1.status + '  ' + r1.trueChars + ' 字  ' + Math.round((r1.ms || 0) / 1000) + 's');
    await post('/state', { delivery: 'chat' });
    const r2 = await runOne(back[1].request, back[1].tier);
    out.abortRecheck.push({ name: back[1].name, mode: 'chat', status: r2.status, trueChars: r2.trueChars, ms: r2.ms, error: r2.error });
    console.log('  ' + back[1].name + ' → ' + r2.status + '  ' + r2.trueChars + ' 字  ' + Math.round((r2.ms || 0) / 1000) + 's');
  } finally {
    try {
      await post('/state', { delivery: null });
      const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      delete raw.readTools; delete raw.delivery;
      fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));
    } catch (e) { /* best effort */ }
  }
  // 与已有 extreme-ptc 数据合起来看次序
  let extreme = null;
  try {
    const ab = JSON.parse(fs.readFileSync(path.join(__dirname, 'delivery-ab.json'), 'utf8'));
    extreme = score(ab.modes.ptc.cells);
  } catch (e) { /* 未跑 */ }
  console.log('');
  console.log('=== 形态=ptc 下的档位次序（次序成立 ⇒ 档位定义在投影后仍然存在）===');
  console.log('  档位      格  真实字数  条目/条  位置引用/条  验收/条  流程/条  中断  PTC分');
  const rows = [['basic', out.tiers.basic], ['advanced', out.tiers.advanced], ['extreme', extreme]];
  for (const [name, r] of rows) {
    if (!r) { console.log('  ' + name.padEnd(9) + '（无数据）'); continue; }
    console.log('  ' + name.padEnd(9) + String(r.n).padStart(3) + String(r.chars).padStart(9) + String(r.items).padStart(9) + String(r.fileRefs).padStart(12) + String(r.accept).padStart(9) + String(r.process).padStart(8) + String(r.aborts).padStart(5) + String(r.ptcScore).padStart(8));
  }
  const b = out.tiers.basic, a = out.tiers.advanced;
  const checks = [];
  if (b && a && extreme) {
    checks.push(['深度次序：极端 > 高级 > 普通（条目数）', extreme.items > a.items && a.items > b.items, extreme.items + ' > ' + a.items + ' > ' + b.items]);
    checks.push(['验收次序：极端 ≥ 高级 ≥ 普通', extreme.accept >= a.accept && a.accept >= b.accept, extreme.accept + ' / ' + a.accept + ' / ' + b.accept]);
    checks.push(['普通档零工序（process=0）', b.process === 0, 'basic process=' + b.process]);
  }
  const recheckOk = out.abortRecheck.every((r) => r.status === 'done');
  checks.push(['中断复核：新兜底两题都跑完', recheckOk, out.abortRecheck.map((r) => r.name.slice(0, 12) + '=' + r.status + '(' + r.trueChars + '字)').join('；')]);
  let bad = 0;
  for (const [name, ok, detail] of checks) { if (!ok) bad++; console.log((ok ? '  ✓ ' : '  ✗ ') + name + '   [' + detail + ']'); }
  out.checks = checks.map(([name, ok, detail]) => ({ name, ok, detail }));
  out.pass = bad === 0;
  fs.writeFileSync(path.join(__dirname, 'tier-ordering.json'), JSON.stringify(out, null, 1));
  console.log('');
  console.log(bad === 0 ? '判定：投影后档位定义仍然成立 ✓ 且中断题已能跑完 ✓' : '判定：❌ ' + bad + ' 项不达标');
  console.log('WROTE evidence/tier-ordering.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
