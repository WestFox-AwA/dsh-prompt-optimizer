// 四代同尺（项目自己的 ptc-ab 量尺）：node evidence/verify-generations-ptc.cjs [tier]
// 量尺逐字取自 evidence/ptc-ab.cjs（METRICS + ptcScore 公式），不改公式 —— 这样能直接与
// evidence/ptc-fitness.json 里的历史行 V011-extreme(+1.93) / V038-extreme(-17.52) 对比。
//
// ⚠️ 诚实声明：这把尺子量的是**命令的形态**（硬约束密度 / 流程开销 / 交互提及…），
//    它**不是**"下游结果好不好"。历史上 v6 在这把尺子上是 +6.93（优于 0.1.1 的 +1.93），
//    但真实体感是"不如不优化"——**指标与结果背离**（Goodhart）。所以本脚本只用来回答
//    "现在的产物形态漂到哪儿了"，不许拿它当质量结论。
//
// 条件：同题（evidence/lab-cx.json 的 10 题）、同档、只读工具关闭（与历史条件一致）。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const tier = process.argv[2] || 'extreme';
const STRATS = (process.argv[3] || 'v011-ptc,v5,v6').split(',');

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
    ptcScore: Math.round(((per(b.latitude, b.n) * 1.5 + per(b.oneShot, b.n) * 1.5 + per(b.ux, b.n) * 1.0 + per(b.accept, b.n) * 0.5) - (per(b.process, b.n) * 1.2 + per(b.stepwise, b.n) * 1.0 + Math.max(0, per(b.hard, b.n) - 6) * 0.8)) * 100) / 100,
  };
}

(async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'lab-cx.json'), 'utf8'));
  const tasks = spec.tasks;
  const before = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  await post('/state', { readTools: false });
  const out = { at: new Date().toISOString(), tier, readTools: false, note: '形态量尺，不是质量结论（见脚本头声明）', rows: {} };
  try {
    for (const strat of STRATS) {
      await post('/state', { strategy: strat });
      const cells = [];
      console.log('── 策略 ' + strat + ' ──');
      for (const t of tasks) {
        const r = await post('/run', { request: t.prompt, tier });
        const id = r.runId || r.id;
        if (!id) { console.log('  ✗ ' + t.id + ' 启动失败'); continue; }
        let rec = null;
        for (let i = 0; i < 240; i++) {
          await new Promise((s) => setTimeout(s, 1000));
          rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
          if (rec && rec.status !== 'running') break;
        }
        cells.push({ taskId: t.id, command: String((rec && rec.text) || ''), trueChars: rec ? rec.chars : null, status: rec ? rec.status : null });
        console.log('  ' + t.id.padEnd(20) + ' ' + (rec ? rec.status : '?') + '  真实=' + (rec ? rec.chars : '?') + ' 字');
      }
      out.rows[strat] = { score: scoreRows(cells), cells };
    }
  } finally {
    try { fs.writeFileSync(STATE, JSON.stringify(before, null, 2)) } catch (e) { /* best effort */ }
  }
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'ptc-fitness.json'), 'utf8')).rows;
  const v011 = hist.find((r) => /V011-extreme/.test(r.variant));
  const v038 = hist.find((r) => /V038-extreme/.test(r.variant));
  const fmt = (name, r) => '  ' + name.padEnd(24) + String(r.n).padStart(3) + String(r.avgChars).padStart(9) + String(r.hardPerCmd).padStart(10) + String(r.processPerCmd).padStart(11) + String(r.stepwisePerCmd).padStart(9) + String(r.latitudePerCmd).padStart(9) + String(r.oneShotPerCmd).padStart(10) + String(r.uxPerCmd).padStart(8) + String(r.acceptPerCmd).padStart(8) + String(r.ptcScore).padStart(9);
  console.log('\n=== 四代同尺（ptc-ab 量尺，tier=' + tier + '，无工具）===');
  console.log('  条件'.padEnd(24) + ' 格  平均字数  硬约束/条  流程开销/条  逐步/条  自由度/条  单程序/条  交互/条  验收/条   PTC分');
  for (const s of STRATS) console.log(fmt(s + '（本次实测）', out.rows[s].score));
  if (v011) console.log(fmt('V011-extreme（0.1.1 历史）', v011));
  if (v038) console.log(fmt('V038-extreme（0.3.8 历史）', v038));
  if (out.rows.v5) console.log('  （0.4.x 用 v5 代表：0.4.3 起、0.4.4 未变）');
  console.log('\n⚠️ 这把尺子量的是命令形态，**不是**下游结果好坏；历史 v6=+6.93 却体感更差，说明指标与结果背离。');
  fs.writeFileSync(path.join(__dirname, 'generations-ptc-fitness.json'), JSON.stringify(out, null, 1));
  console.log('WROTE evidence/generations-ptc-fitness.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
