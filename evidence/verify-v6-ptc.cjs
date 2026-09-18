// v6 的 PTC 适配度：用项目**自己的量尺**量（与 0.1.1 / 0.3.8 同题同档，可复核）
//   node evidence/verify-v6-ptc.cjs [tier]
// 量尺逐字取自 evidence/ptc-ab.cjs:35-49（METRICS）与 :74（ptcScore 公式）——不改公式，
// 这样 v6 的分数才能与 ptc-fitness.json 里 V011-extreme(+1.93) / V038-extreme(-17.52) 直接比。
// 条件对齐：同一批 10 道题（evidence/lab-cx.json）、同档 extreme、**关闭只读工具**（历史条件无工具）。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const tier = process.argv[2] || 'extreme';

const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

// ── 量尺（逐字取自 ptc-ab.cjs，勿改）──
const METRICS = {
  hard: /必须|不得|严禁|不许|禁止|一律|绝不/g,
  process: /goal|todo|分阶段|逐层|切片|贴出|运行输出|证据形式|不做项|停手条件|阶段文档/gi,
  latitude: /自行决定|自行选择|如无必要|可选|视情况|由你决定|酌情|按惯例|优先选择/g,
  oneShot: /一个程序|一段(脚本|程序)|单个程序|一次(跑完|完成|成型)|PTC|TypeScript|脚本完成|批量完成/gi,
  stepwise: /逐步|每步|一步一步|一步步|先.{0,6}再.{0,6}(逐|每)/g,
  ux: /界面|UI|操作|手感|键位|灵敏度|反转|提示|可发现|反馈|菜单|按钮|交互/g,
  accept: /判据|验收|完成标准|通过条件/g,
};
const count = (t, re) => (t.match(re) || []).length;
const per = (x, n) => Math.round((x / Math.max(1, n)) * 100) / 100;
function scoreRows(cells) {
  const b = { n: 0, chars: 0, hard: 0, process: 0, latitude: 0, oneShot: 0, stepwise: 0, ux: 0, accept: 0 };
  for (const c of cells) {
    const t = String(c.command || '');
    b.n += 1; b.chars += t.length;
    for (const k of Object.keys(METRICS)) b[k] += count(t, METRICS[k]);
  }
  return {
    n: b.n, avgChars: Math.round(b.chars / Math.max(1, b.n)),
    hardPerCmd: per(b.hard, b.n), processPerCmd: per(b.process, b.n), latitudePerCmd: per(b.latitude, b.n),
    oneShotPerCmd: per(b.oneShot, b.n), stepwisePerCmd: per(b.stepwise, b.n), uxPerCmd: per(b.ux, b.n), acceptPerCmd: per(b.accept, b.n),
    // ptcScore 公式逐字取自 ptc-ab.cjs:74
    ptcScore: Math.round(((per(b.latitude, b.n) * 1.5 + per(b.oneShot, b.n) * 1.5 + per(b.ux, b.n) * 1.0 + per(b.accept, b.n) * 0.5) - (per(b.process, b.n) * 1.2 + per(b.stepwise, b.n) * 1.0 + Math.max(0, per(b.hard, b.n) - 6) * 0.8)) * 100) / 100,
  };
}

(async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'lab-cx.json'), 'utf8'));
  const tasks = spec.tasks;
  await post('/state', { readTools: false });   // 对齐历史条件：无工具
  const cells = [];
  try {
    for (const t of tasks) {
      const t0 = Date.now();
      const r = await post('/run', { request: t.prompt, tier });
      const id = r.runId || r.id;
      if (!id) { console.log('  ✗ ' + t.id + ' 启动失败 ' + JSON.stringify(r).slice(0, 100)); continue; }
      let rec = null;
      for (let i = 0; i < 200; i++) {
        await new Promise((s) => setTimeout(s, 1000));
        const list = await j(API + '/runs');
        rec = (list.runs || []).find((x) => x.id === id);
        if (rec && rec.status !== 'running') break;
      }
      const cmd = String((rec && rec.text) || '');
      // 记真实长度与终态：/runs 的 text 截断在 4000，但 chars 用的是未截断的 run.text；
      // 撞上 60s 硬超时（lib/index.js:2077/:2083 的 60000）时 status=error + llm-aborted，产出是半截。
      cells.push({ taskId: t.id, command: cmd, trueChars: rec ? rec.chars : null, status: rec ? rec.status : null, error: rec && rec.error ? String(rec.error).slice(0, 100) : null });
      console.log('  ' + t.id.padEnd(22) + ' status=' + (rec ? rec.status : '?') + '  真实=' + (rec ? rec.chars : '?') + ' 字  采到=' + cmd.length + ' 字' + (rec && rec.error ? '  ⚠ ' + String(rec.error).slice(0, 42) : '') + '  ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
  } finally {
    // 收尾：删回"未设置"（默认开）
    try { const raw = JSON.parse(fs.readFileSync(STATE, 'utf8')); delete raw.readTools; fs.writeFileSync(STATE, JSON.stringify(raw, null, 2)); } catch (e) { /* best effort */ }
  }
  const v6 = scoreRows(cells);
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'ptc-fitness.json'), 'utf8')).rows;
  const v011 = hist.find((r) => /V011-extreme/.test(r.variant));
  const v038 = hist.find((r) => /V038-extreme/.test(r.variant));
  const line = (name, r) => '  ' + name.padEnd(22) + String(r.n).padStart(3) + String(r.avgChars).padStart(9) + String(r.hardPerCmd).padStart(10) + String(r.processPerCmd).padStart(11) + String(r.stepwisePerCmd).padStart(9) + String(r.latitudePerCmd).padStart(9) + String(r.oneShotPerCmd).padStart(10) + String(r.uxPerCmd).padStart(8) + String(r.acceptPerCmd).padStart(8) + String(r.ptcScore).padStart(9);
  console.log('');
  console.log('=== PTC 适配度（ptc-ab 量尺，tier=' + tier + '，无工具）===');
  console.log('  条件'.padEnd(22) + ' 格  平均字数  硬约束/条  流程开销/条  逐步/条  自由度/条  单程序/条  交互/条  验收/条   PTC分');
  console.log(line('v6（本版活实例）', v6));
  if (v011) console.log(line('V011-extreme（0.1.1）', v011));
  if (v038) console.log(line('V038-extreme（0.3.8）', v038));
  console.log('');
  console.log('参考：0.3.x 的 PTC 回退依据是 V038 明显低于 V011；v6 与两者的差 = ' + JSON.stringify({ v6: v6.ptcScore, v011: v011 && v011.ptcScore, v038: v038 && v038.ptcScore }));
  console.log('注意：/runs 的 text 截断在 4000 字符；历史 V011/V038 为同题 2 次重复（n=20），本次 v6 为 1 次（n=' + v6.n + '）。');
  fs.writeFileSync(path.join(__dirname, 'v6-ptc-fitness.json'), JSON.stringify({ at: new Date().toISOString(), tier, readTools: false, limitNote: '/runs text capped at 4000 chars', v6, v011, v038, cells }, null, 1));
  console.log('WROTE evidence/v6-ptc-fitness.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
