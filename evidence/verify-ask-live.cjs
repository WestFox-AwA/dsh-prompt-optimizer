// ask 机制实机验证：node evidence/verify-ask-live.cjs
//   A) 模糊短句（信息严重不足）→ 必须产出 ask 段，条目数在档位预算内
//   B) 完全明确的句子（信息已足够）→ **不得**产出 ask 段（防止 ask 变成问卷）
// 只跑 4 次优化，不做执行体对照（快速验证用）。
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const SID = process.argv[2] || 'session-fa377fe1-598d-4135-9383-a5b75bb08d86';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const CASES = [
  { id: 'A-basic', tier: 'basic', expectAsk: true, req: '做个坦克' },
  { id: 'A-basic-2', tier: 'basic', expectAsk: true, req: '帮我搞个登录页' },
  { id: 'A-advanced', tier: 'advanced', expectAsk: true, req: '做个坦克' },
  { id: 'A-advanced-2', tier: 'advanced', expectAsk: true, req: '把首页改好看点' },
  { id: 'A-extreme', tier: 'extreme', expectAsk: true, req: '做个坦克' },
  { id: 'B-clear', tier: 'extreme', expectAsk: false, req: '把 tank.html 里 <title> 的文本改成「主战坦克演示」，其它任何地方都不许动，只改这一个文件。' },
];

(async () => {
  const before = (await j(API + '/state')).state;
  const rows = [];
  try {
    await post('/state', { strategy: null, delivery: null });
    for (const c of CASES) {
      const r = await post('/run', { request: c.req, tier: c.tier, sessionId: SID, turns: 0, historyMode: 'turns', readTools: false });
      const id = r.runId || r.id;
      let rec = null;
      for (let i = 0; i < 240; i += 1) {
        await new Promise((s) => setTimeout(s, 1000));
        rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
        if (rec && rec.status !== 'running') break;
      }
      const text = String((rec && rec.text) || '');
      const gate = (rec && rec.askGate) || null;
      // 抽 ask 段正文（供人看：问的是不是"会影响结果"的那些点）
      const lines = text.split('\n');
      const at = lines.findIndex((L) => L.indexOf('先问用户') >= 0 || /向用户(确认|问)|用\s*ask/.test(L));
      const section = at < 0 ? [] : lines.slice(at, at + 14).filter((L) => L.trim()).slice(0, 9);
      const asked = Boolean(gate && gate.hasSection && gate.style !== 'explicit-none' && gate.items > 0);
      rows.push({ id: c.id, tier: c.tier, chars: (rec && rec.chars) || 0, expectAsk: c.expectAsk, gate, section, asked });
      console.log('\n════ ' + c.id + '（' + c.tier + '）原话：' + c.req.slice(0, 40) + ' ════');
      console.log('  产物 ' + ((rec && rec.chars) || 0) + ' 字   askGate=' + JSON.stringify(gate));
      console.log('  ask 段：' + (section.length ? '' : '（无）'));
      for (const L of section) console.log('    ' + L.slice(0, 150));
    }
  } finally {
    try { await post('/state', { strategy: before.strategy, delivery: before.delivery }); } catch (e) { /* best effort */ }
  }
  console.log('\n──── 判定 ────');
  let bad = 0;
  for (const r of rows) {
    const has = Boolean(r.gate && r.gate.hasSection);
    const within = Boolean(r.gate && !r.gate.over);
    const ok = r.expectAsk ? (r.asked && within) : !r.asked;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + r.id.padEnd(12) + (r.expectAsk ? '应问且条目 ≤ ' + (r.gate ? r.gate.limit : '?') : '不该问') +
      '  → ' + (has ? (r.gate.style === 'explicit-none' ? '显式写了"无"' : '问了 ' + r.gate.items + ' 条（' + r.gate.style + '）' + (within ? '' : '（超预算！）')) : '整段缺失'));
  }
  console.log('');
  console.log(bad === 0 ? '判定：ask 机制按设计工作 ✓（该问的问、不该问的不问）' : '判定：❌ ' + bad + ' 项不符（看上面的 ask 段正文判断是措辞问题还是机制问题）');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
