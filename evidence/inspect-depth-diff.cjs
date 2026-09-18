// 判据方向裁决用的定性证据：chat vs ptc 的**条目层面**差异
//   node evidence/inspect-depth-diff.cjs [taskId...]
// 看三件事：① 条目数与每条平均长度（少而密=合并同类项；少而空=漏内容）
//          ② chat 独有、ptc 没有的条目（"被丢掉的是什么"）
//          ③ ptc 独有、chat 没有的条目（"换出来了什么"）
const fs = require('node:fs');
const path = require('node:path');
const ab = JSON.parse(fs.readFileSync(path.join(__dirname, 'delivery-ab.json'), 'utf8'));
const byTask = (m) => Object.fromEntries((ab.modes[m].cells || []).map((c) => [c.taskId, String(c.command || '')]));
const chat = byTask('chat'); const ptc = byTask('ptc');
const items = (t) => t.split('\n').map((s) => s.trim()).filter((s) => /^([-*•]|\d+[.、)]|第[0-9一二三四五六七八九十]+步)/.test(s));
const norm = (s) => s.replace(/[*`\s—–-]/g, '').slice(0, 20);
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['C1-3d-scene', 'C6-data-migrate', 'C9-vehicle-physics'];
let chatItems = 0, ptcItems = 0, chatChars = 0, ptcChars = 0;
for (const id of ids) {
  const ci = items(chat[id] || ''), pi = items(ptc[id] || '');
  const cChars = ci.reduce((s, x) => s + x.length, 0), pChars = pi.reduce((s, x) => s + x.length, 0);
  chatItems += ci.length; ptcItems += pi.length; chatChars += cChars; ptcChars += pChars;
  console.log('=== ' + id + ' ===');
  console.log('  chat: ' + ci.length + ' 条 / 每条均 ' + avg(ci.map((s) => s.length)) + ' 字 / 条目总字 ' + cChars);
  console.log('  ptc : ' + pi.length + ' 条 / 每条均 ' + avg(pi.map((s) => s.length)) + ' 字 / 条目总字 ' + pChars);
  const pset = new Set(pi.map(norm)), cset = new Set(ci.map(norm));
  const dropped = ci.filter((s) => !pset.has(norm(s)));
  const added = pi.filter((s) => !cset.has(norm(s)));
  console.log('  —— chat 独有（ptc 里没有的）' + dropped.length + ' 条：');
  for (const d of dropped.slice(0, 7)) console.log('     − ' + d.slice(0, 96));
  console.log('  —— ptc 独有（chat 里没有的）' + added.length + ' 条：');
  for (const a of added.slice(0, 7)) console.log('     + ' + a.slice(0, 96));
  console.log('');
}
console.log('合计：chat ' + chatItems + ' 条 / 条目总字 ' + chatChars + '（每条均 ' + Math.round(chatChars / Math.max(1, chatItems)) + '）');
console.log('      ptc  ' + ptcItems + ' 条 / 条目总字 ' + ptcChars + '（每条均 ' + Math.round(ptcChars / Math.max(1, ptcItems)) + '）');
const perItemRatio = (ptcChars / Math.max(1, ptcItems)) / (chatChars / Math.max(1, chatItems));
console.log('');
console.log('读法：');
console.log('  · 条目数比 = ' + Math.round((ptcItems / Math.max(1, chatItems)) * 100) / 100 + '（ptc/chat）');
console.log('  · 每条平均字数比 = ' + Math.round(perItemRatio * 100) / 100 + '（>1 = ptc 每条更密 ⇒ 合并同类项；≈1 = 等密 ⇒ 条目变少即内容变少）');
console.log('  · 条目总字比 = ' + Math.round((ptcChars / Math.max(1, chatChars)) * 100) / 100 + '（条目承载的总内容量）');
