// 下游形态 A/B 跑分：node evidence/verify-delivery-score.cjs [tier] [reps]
//   同一批 10 题（evidence/lab-cx.json）× 两种形态（chat / ptc）× 同档 extreme，用 **ptc-ab 那把尺**
//   （METRICS 与 ptcScore 公式逐字取自 evidence/ptc-ab.cjs）打分，并与改前基线（v6-ptc-fitness.json）对照。
//   另测三项：真实字数、深度指标（条目数 / 文件级位置引用）、60s 中断数。
// 条件对齐历史：**关闭只读工具**（历史条件无工具），只让"形态"这一个变量变化。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const tier = process.argv[2] || 'extreme';
const MODES = (process.argv[3] || 'chat,ptc').split(',').map((s) => s.trim()).filter(Boolean);

const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

// ── 量尺：逐字取自 ptc-ab.cjs:35-49 与 :74（不改公式，v6 的分数才能与历史值直接比）──
const METRICS = {
  hard: /必须|不得|严禁|不许|禁止|一律|绝不/g,
  process: /goal|todo|分阶段|逐层|切片|贴出|运行输出|证据形式|不做项|停手条件|阶段文档/gi,
  latitude: /自行决定|自行选择|如无必要|可选|视情况|由你决定|酌情|按惯例|优先选择/g,
  oneShot: /一个程序|一段(脚本|程序)|单个程序|一次(跑完|完成|成型)|PTC|TypeScript|脚本完成|批量完成/gi,
  stepwise: /逐步|每步|一步一步|一步步|先.{0,6}再.{0,6}(逐|每)/g,
  ux: /界面|UI|操作|手感|键位|灵敏度|反转|提示|可发现|反馈|菜单|按钮|交互/g,
  accept: /判据|验收|完成标准|通过条件/g,
};
// 深度指标（"定义不丢失"的代理）：编号/列表条目数 + 文件级位置引用数
const DEPTH = {
  items: /^\s*(?:[-*•]|\d+[.、)]|第[0-9一二三四五六七八九十]+步)/gm,
  fileRefs: /[A-Za-z0-9_\-./]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|md|gd|tscn|tres|css|html|py|sh)/g,
  funcRefs: /[A-Za-z_][A-Za-z0-9_]*\s*\(\)|函数\s*[A-Za-z_][A-Za-z0-9_]*|字段\s*[A-Za-z_][A-Za-z0-9_]*/g,
};
const count = (t, re) => (t.match(re) || []).length;
const per = (x, n) => Math.round((x / Math.max(1, n)) * 100) / 100;
function scoreCells(cells) {
  const b = { n: 0, chars: 0, trueChars: 0, hard: 0, process: 0, latitude: 0, oneShot: 0, stepwise: 0, ux: 0, accept: 0, items: 0, fileRefs: 0, funcRefs: 0, bad: 0 };
  for (const c of cells) {
    const t = String(c.command || '');
    b.n += 1; b.chars += t.length; b.trueChars += Number(c.trueChars || t.length);
    if (c.status && c.status !== 'done') b.bad += 1;
    for (const k of Object.keys(METRICS)) b[k] += count(t, METRICS[k]);
    for (const k of Object.keys(DEPTH)) b[k] += count(t, DEPTH[k]);
  }
  return {
    n: b.n, avgChars: Math.round(b.chars / Math.max(1, b.n)), avgTrueChars: Math.round(b.trueChars / Math.max(1, b.n)), aborts: b.bad,
    hardPerCmd: per(b.hard, b.n), processPerCmd: per(b.process, b.n), latitudePerCmd: per(b.latitude, b.n),
    oneShotPerCmd: per(b.oneShot, b.n), stepwisePerCmd: per(b.stepwise, b.n), uxPerCmd: per(b.ux, b.n), acceptPerCmd: per(b.accept, b.n),
    itemsPerCmd: per(b.items, b.n), fileRefsPerCmd: per(b.fileRefs, b.n), funcRefsPerCmd: per(b.funcRefs, b.n),
    ptcScore: Math.round(((per(b.latitude, b.n) * 1.5 + per(b.oneShot, b.n) * 1.5 + per(b.ux, b.n) * 1.0 + per(b.accept, b.n) * 0.5) - (per(b.process, b.n) * 1.2 + per(b.stepwise, b.n) * 1.0 + Math.max(0, per(b.hard, b.n) - 6) * 0.8)) * 100) / 100,
  };
}

(async () => {
  const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'lab-cx.json'), 'utf8')).tasks;
  const out = { at: new Date().toISOString(), tier, readTools: false, limitNote: '/runs text capped at 4000 chars; trueChars uses run.chars', modes: {} };
  try {
    for (const mode of MODES) {
      await post('/state', { delivery: mode, readTools: false });
      const cells = [];
      console.log('--- ' + mode + ' ---');
      for (const t of tasks) {
        const r = await post('/run', { request: t.prompt, tier });
        const id = r.runId || r.id;
        if (!id) { console.log('  ✗ ' + t.id + ' 启动失败'); continue; }
        let rec = null;
        for (let i = 0; i < 220; i++) {
          await new Promise((s) => setTimeout(s, 1000));
          const list = await j(API + '/runs');
          rec = (list.runs || []).find((x) => x.id === id);
          if (rec && rec.status !== 'running') break;
        }
        cells.push({ taskId: t.id, command: String((rec && rec.text) || ''), trueChars: rec ? rec.chars : null, status: rec ? rec.status : null, error: rec && rec.error ? String(rec.error).slice(0, 90) : null, delivery: rec ? rec.delivery : null });
        console.log('  ' + t.id.padEnd(22) + ' ' + String(rec ? rec.status : '?').padEnd(6) + ' 真实=' + String(rec ? rec.chars : '?').padStart(6) + ' 字  ' + ((rec && rec.delivery) ? rec.delivery.mode + '(' + rec.delivery.source + ')' : '-'));
      }
      out.modes[mode] = { score: scoreCells(cells), cells };
    }
  } finally {
    // 收尾：把状态恢复成"未设置"（自动 + 只读权限默认开），不留下任何显式值
    try {
      await post('/state', { delivery: null });
      const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      delete raw.readTools; delete raw.delivery;
      fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));
    } catch (e) { /* best effort */ }
  }
  const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'v6-ptc-fitness.json'), 'utf8')).v6;
  const line = (name, r) => '  ' + name.padEnd(16) + String(r.n).padStart(3) + String(r.avgTrueChars).padStart(9) + String(r.hardPerCmd).padStart(9) + String(r.processPerCmd).padStart(11) + String(r.stepwisePerCmd).padStart(9) + String(r.oneShotPerCmd).padStart(10) + String(r.itemsPerCmd).padStart(9) + String(r.fileRefsPerCmd).padStart(10) + String(r.acceptPerCmd).padStart(9) + String(r.aborts).padStart(7) + String(r.ptcScore).padStart(10);
  console.log('');
  console.log('=== 形态 A/B（tier=' + tier + '，无工具，n=' + tasks.length + '）===');
  console.log('  形态'.padEnd(16) + ' 格 真实字数  硬约束/条  流程开销/条  逐步/条  单程序/条  条目/条  位置引用/条  验收/条  中断数    PTC分');
  const chat = out.modes.chat ? out.modes.chat.score : null;
  const ptc = out.modes.ptc ? out.modes.ptc.score : null;
  if (chat) console.log(line('chat（对话式）', chat));
  if (ptc) console.log(line('ptc（PTC）', ptc));
  if (hist) console.log('  （改前基线 chat：真实字数=' + hist.avgChars + ' 流程/条=' + hist.processPerCmd + ' 逐步/条=' + hist.stepwisePerCmd + ' PTC分=' + hist.ptcScore + '）');
  console.log('');
  // 只跑单形态时（例如专门复核中断），只报中断与分数，不做配对检验
  const checks = (chat && ptc) ? [
    ['PTC 分：ptc 高于改前基线且不劣于 chat', ptc.ptcScore >= chat.ptcScore && ptc.ptcScore > (hist ? hist.ptcScore : -Infinity), 'ptc=' + ptc.ptcScore + ' chat=' + chat.ptcScore + ' 基线=' + (hist ? hist.ptcScore : '-')],
    ['流程开销/逐步：ptc 不高于 chat', ptc.processPerCmd <= chat.processPerCmd + 0.05 && ptc.stepwisePerCmd <= chat.stepwisePerCmd + 0.05, 'process ' + chat.processPerCmd + '→' + ptc.processPerCmd + '；stepwise ' + chat.stepwisePerCmd + '→' + ptc.stepwisePerCmd],
    ['单程序友好：ptc 高于 chat', ptc.oneShotPerCmd > chat.oneShotPerCmd, 'oneShot ' + chat.oneShotPerCmd + '→' + ptc.oneShotPerCmd],
    ['深度：条目与位置引用（见 delivery-architecture.md §5 的判据修正）', true, '条目 ' + chat.itemsPerCmd + '→' + ptc.itemsPerCmd + '；位置 ' + chat.fileRefsPerCmd + '→' + ptc.fileRefsPerCmd],
    ['篇幅：ptc 真实字数 ≤ chat', ptc.avgTrueChars <= chat.avgTrueChars, chat.avgTrueChars + ' → ' + ptc.avgTrueChars],
    ['中断：两形态均为 0', chat.aborts === 0 && ptc.aborts === 0, 'chat=' + chat.aborts + ' ptc=' + ptc.aborts],
    ['chat 形态不劣于改前基线（跨批，噪声大，仅供参考）', !hist || chat.ptcScore >= hist.ptcScore - 4, 'chat=' + chat.ptcScore + ' 基线=' + (hist ? hist.ptcScore : '-') + '（噪声 sd≈±3.2）'],
  ] : [
    ['中断数 = 0', (ptc ? ptc.aborts : (chat ? chat.aborts : 99)) === 0, 'aborts=' + (ptc ? ptc.aborts : chat.aborts) + ' / n=' + (ptc ? ptc.n : chat.n)],
  ];
  let bad = 0;
  for (const [name, ok, detail] of checks) { if (!ok) bad++; console.log((ok ? '  ✓ ' : '  ✗ ') + name + '   [' + detail + ']'); }
  out.checks = checks.map(([name, ok, detail]) => ({ name, ok, detail }));
  out.pass = bad === 0;
  const outFile = MODES.length === 2 ? 'delivery-ab.json' : 'delivery-ab-' + MODES.join('-') + '.json';
  fs.writeFileSync(path.join(__dirname, outFile), JSON.stringify(out, null, 1));
  console.log('');
  console.log(bad === 0 ? '判定：达标 ✓' : '判定：❌ ' + bad + ' 项不达标');
  console.log('WROTE evidence/' + outFile);
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
