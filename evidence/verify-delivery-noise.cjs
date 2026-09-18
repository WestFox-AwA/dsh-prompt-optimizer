// 判据复核：把"噪声"与"真实效应"分开（全部用已有数据，不跑模型）
//   node evidence/verify-delivery-noise.cjs
// 数据源：evidence/v6-ptc-fitness.json（改前基线 chat，同一批 10 题）与 evidence/delivery-ab.json（本次 chat / ptc）
// 三个问题：
//   ① 同一个 chat 提示词跑两批，逐题差多少？→ 这是**噪声带**（用于判断"chat 不劣于基线"这条判据是否可测）
//   ② 同一批内 chat→ptc 的**配对**差多少、几题变好？→ 这是**形态效应**（配对可以消掉跨批噪声）
//   ③ 深度到底降在哪：条目变少，但"每条目的具体度"变了吗？
const fs = require('node:fs');
const path = require('node:path');
const M = {
  hard: /必须|不得|严禁|不许|禁止|一律|绝不/g,
  process: /goal|todo|分阶段|逐层|切片|贴出|运行输出|证据形式|不做项|停手条件|阶段文档/gi,
  stepwise: /逐步|每步|一步一步|一步步|先.{0,6}再.{0,6}(逐|每)/g,
  oneShot: /一个程序|一段(脚本|程序)|单个程序|一次(跑完|完成|成型)|PTC|TypeScript|脚本完成|批量完成/gi,
  accept: /判据|验收|完成标准|通过条件/g,
  items: /^\s*(?:[-*•]|\d+[.、)]|第[0-9一二三四五六七八九十]+步)/gm,
  fileRefs: /[A-Za-z0-9_\-./]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|md|gd|tscn|tres|css|html|py|sh)/g,
};
const c = (t, re) => (t.match(re) || []).length;
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const base = load('v6-ptc-fitness.json');
const ab = load('delivery-ab.json');
const byTask = (cells) => { const m = {}; for (const x of cells || []) m[x.taskId] = String(x.command || ''); return m; };
const baseChat = byTask(base.cells);
const nowChat = byTask(ab.modes.chat.cells);
const nowPtc = byTask(ab.modes.ptc.cells);
const keys = Object.keys(nowChat);
const avg = (a) => Math.round((a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)) * 100) / 100;

console.log('① 噪声带：**同一个 chat 提示词**（逐字节相同的 system）两批逐题差');
for (const k of Object.keys(M)) {
  const d = keys.filter((t) => baseChat[t] && nowChat[t]).map((t) => c(nowChat[t], M[k]) - c(baseChat[t], M[k]));
  if (d.length === 0) continue;
  const mean = avg(d);
  const sd = Math.round(Math.sqrt(avg(d.map((x) => (x - mean) * (x - mean)))) * 100) / 100;
  console.log('   ' + k.padEnd(10) + ' 平均差=' + String(mean).padStart(6) + '  标准差=' + String(sd).padStart(5) + '  区间=[' + Math.min(...d) + ',' + Math.max(...d) + ']  n=' + d.length);
}
const scoreOf = (t, mode) => {
  const n = 1;
  const per = (k) => c(t, M[k]) / n;
  return Math.round(((per('oneShot') * 1.5 + per('accept') * 0.5) - (per('process') * 1.2 + per('stepwise') * 1.0 + Math.max(0, per('hard') - 6) * 0.8)) * 100) / 100;
};
const dBase = keys.filter((t) => baseChat[t] && nowChat[t]).map((t) => scoreOf(nowChat[t]) - scoreOf(baseChat[t]));
console.log('   （按 ptcScore 的逐题贡献算）平均差=' + avg(dBase) + '  区间=[' + Math.min(...dBase) + ',' + Math.max(...dBase) + ']');
console.log('   ⇒ 结论：同一提示词两批之间就有这个量级的摆动 ⇒ “chat 分不劣于基线”在 n=10 下**不可测**，');
console.log('      chat 零回归只能靠**逐字节相同**这条结构事实来保证（已由 snapshot-v6-prompts.cjs --compare 证明）。');

console.log('');
console.log('② 形态效应（同一批内配对：chat → ptc，同一题同一时刻）');
for (const k of Object.keys(M)) {
  const d = keys.filter((t) => nowChat[t] && nowPtc[t]).map((t) => c(nowPtc[t], M[k]) - c(nowChat[t], M[k]));
  if (d.length === 0) continue;
  const better = d.filter((x) => x !== 0);
  const win = k === 'process' || k === 'stepwise' || k === 'hard' ? d.filter((x) => x < 0).length : d.filter((x) => x > 0).length;
  console.log('   ' + k.padEnd(10) + ' 平均差=' + String(avg(d)).padStart(6) + '  恶化=' + d.filter((x) => (k === 'process' || k === 'stepwise' || k === 'hard' ? x > 0 : x < 0)).length + '/' + d.length + ' 题');
}
const pairScore = keys.filter((t) => nowChat[t] && nowPtc[t]).map((t) => scoreOf(nowPtc[t]) - scoreOf(nowChat[t]));
console.log('   ptcScore 逐题配对差：改造方向为正的 = ' + pairScore.filter((x) => x > 0).length + '/' + pairScore.length + ' 题，平均 ' + avg(pairScore));

console.log('');
console.log('③ 深度：条目变少，但"每条目的具体度"与"可验收性"变了吗');
const perItem = (t) => { const it = Math.max(1, c(t, M.items)); return Math.round((c(t, M.fileRefs) / it) * 1000) / 1000; };
console.log('   文件级位置引用 / 条目：chat=' + avg(keys.map((t) => perItem(nowChat[t]))) + '  ptc=' + avg(keys.filter((t) => nowPtc[t]).map((t) => perItem(nowPtc[t]))));
console.log('   验收类判据/条：        chat=' + avg(keys.map((t) => c(nowChat[t], M.accept))) + '  ptc=' + avg(keys.filter((t) => nowPtc[t]).map((t) => c(nowPtc[t], M.accept))));
console.log('   条目总数/条：          chat=' + avg(keys.map((t) => c(nowChat[t], M.items))) + '  ptc=' + avg(keys.filter((t) => nowPtc[t]).map((t) => c(nowPtc[t], M.items))));
