// 三代对照（不优化 / 0.1.1 / 0.4.x / 现在）：node evidence/compare-generations.cjs [sessionId] [--tier=extreme]
// 用**同一句真实原话**、同一个会话、同一个档位，只换策略，把四份"下游会看到的东西"摆在一起：
//   A 原话（不优化，什么都不做）
//   B v011-ptc = 0.1.1 的原样提示词（传话器/改写器）
//   C v5       = 0.4.x 的「需求补全器」（0.4.3 起、0.4.4 未变）
//   D v6       = 现在（SPEC v0.5 依据驱动）
// 只读工具一律关闭（隔离"提示词本身"这一个变量）。机械统计只做**描述**，好坏由人看正文判。
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const ARGS = process.argv.slice(2);
const POS = ARGS.filter((a) => a.indexOf('--') !== 0);
const DEFAULTS = [
  '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型',
  '让坦克的炮塔能独立转动（现在只能整体转向）',
  '把页面标题改成「主战坦克演示」',
];
// 用法：compare-generations.cjs [sessionId] ["原话1" "原话2" …] [--tier=extreme]
const REQUESTS = POS.slice(1).length ? POS.slice(1) : DEFAULTS;

function stats(text, raw) {
  const t = String(text || '');
  const lines = t.split('\n');
  const cnt = (re) => (t.match(re) || []).length;
  return {
    chars: t.length,
    ratioToRaw: raw ? Math.round((t.length / raw.length) * 100) / 100 : null,
    lines: lines.filter((L) => L.trim()).length,
    numbered: lines.filter((L) => /^\s*(\d+[.、)]|[-*•]|【|#{1,3}\s)/.test(L)).length,
    headers: cnt(/^#{1,3}\s|^\*\*[^*]{2,20}\*\*\s*$/gm),
    prohibitions: cnt(/不得|不许|不要|禁止|严禁/g),
    criteria: cnt(/验收|判据|什么算|看哪里|算过|可机器判定/g),
    uncertainty: cnt(/先确认|先读|待确认|未找到|没读到|未读到|不确定|自由度/g),
    sourceRefs: cnt(/[\w./\\-]+\.\w{1,8}:\d+|文件:位置|出处/g),
  };
}

(async () => {
  const a0 = POS[0] && POS[0].indexOf('--') !== 0 ? POS[0] : null;
  const tier = (process.argv.filter((x) => x.indexOf('--tier=') === 0)[0] || '--tier=extreme').split('=')[1];
  const del = await j(API + '/delivery');
  const sid = a0 || ((del.sessions || [])[0] || {}).id;
  if (!sid) { console.error('找不到会话'); process.exit(1) }
  const before = (await j(API + '/state')).state;
  const out = { at: new Date().toISOString(), sessionId: sid, tier, cases: [] };
  console.log('会话=' + sid + '  档位=' + tier + '  只读工具=关（隔离提示词变量）');
  try {
    for (const req of REQUESTS) {
      const row = { request: req, A_raw: req, B_v011: null, C_v5: null, D_v6: null };
      for (const [key, strategy] of [['B_v011', 'v011-ptc'], ['C_v5', 'v5'], ['D_v6', 'v6']]) {
        await post('/state', { strategy, delivery: null });
        const r = await post('/run', { request: req, tier, sessionId: sid, turns: 10, historyMode: 'turns', readTools: false });
        const id = r.runId || r.id;
        let rec = null;
        for (let i = 0; i < 300; i++) {
          await new Promise((s) => setTimeout(s, 1000));
          rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
          if (rec && rec.status !== 'running') break;
        }
        row[key] = { runId: id, status: rec && rec.status, strategy, text: String((rec && rec.text) || ''), chars: rec && rec.chars, error: rec && rec.error };
      }
      out.cases.push(row);
      console.log('\n════════ 原话：' + req + ' ════════');
      console.log('\n── A) 原话（不优化）──  ' + req.length + ' 字\n    ' + req);
      for (const [key, label] of [['B_v011', 'B) 0.1.1（传话器/改写器）'], ['C_v5', 'C) 0.4.x（需求补全器）'], ['D_v6', 'D) 现在（SPEC v0.5）']]) {
        const r2 = row[key];
        console.log('\n── ' + label + ' ──  ' + (r2.chars || 0) + ' 字' + (r2.status === 'done' ? '' : '  [' + r2.status + ' ' + (r2.error || '') + ']'));
        console.log(String(r2.text || '').split('\n').map((L) => '    ' + L).join('\n'));
      }
    }
  } finally {
    try { await post('/state', { strategy: before.strategy, delivery: before.delivery }); } catch (e) { /* best effort */ }
  }
  console.log('\n════════ 机械统计（只描述，不评好坏）════════');
  console.log('题'.padEnd(4) + '版本'.padEnd(12) + '字数'.padEnd(8) + '/原话'.padEnd(8) + '条目'.padEnd(6) + '小标题'.padEnd(8) + '禁止类'.padEnd(8) + '判据'.padEnd(6) + '不确定'.padEnd(8) + '出处');
  for (const row of out.cases) {
    const items = [['A', '原话', row.A_raw], ['B', '0.1.1', row.B_v011.text], ['C', '0.4.x', row.C_v5.text], ['D', '现在', row.D_v6.text]];
    for (const [k, label, text] of items) {
      const s = stats(text, row.A_raw);
      console.log((k + ' ' + (row.request.length > 14 ? row.request.slice(0, 12) + '…' : row.request)).padEnd(4) +
        label.padEnd(12) + String(s.chars).padEnd(8) + String(s.ratioToRaw).padEnd(8) + String(s.numbered).padEnd(6) +
        String(s.headers).padEnd(8) + String(s.prohibitions).padEnd(8) + String(s.criteria).padEnd(6) + String(s.uncertainty).padEnd(8) + String(s.sourceRefs));
    }
  }
  fs.writeFileSync(path.join(__dirname, 'generations-ab.json'), JSON.stringify(out, null, 1));
  console.log('\nWROTE evidence/generations-ab.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
