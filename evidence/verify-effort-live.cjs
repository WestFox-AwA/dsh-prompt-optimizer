// 可证伪实验：思考强度是否**真的落到了调用**（node evidence/verify-effort-live.cjs）
//
// 预测（接上之后）：effort=off 的思考文本应**显著少于** effort=max（off 档模型几乎不产生思考）；
// 反证（接上之前）：该字段在正式路径从不发送，两组只会有噪声级差异
//   —— v0.4.5 的实测正是如此："off 均值 8745 / max 8300 / 未设置 2788"，三组其实一模一样。
//
// 另验守卫：换成**未声明 max** 的模型时，应不发该字段（effortSent=null），而不是让调用 400。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const REQ = '把这个插件的版本号在所有地方统一一下。';
const TIER = 'basic';           // 纯流式、无工具循环：信号最干净
const REPS = Number(process.argv[2] || 4);
const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null; };
async function runOnce() {
  const r = await post('/run', { request: REQ, tier: TIER });
  const id = r.runId || r.id;
  if (!id) return { error: JSON.stringify(r).slice(0, 120) };
  for (let i = 0; i < 240; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const list = await j(API + '/runs');
    const rec = (list.runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return rec;
  }
  return { status: 'timeout' };
}
(async () => {
  const before = (await j(API + '/state')).state;
  const out = { at: new Date().toISOString(), tier: TIER, reps: REPS, groups: {}, guard: null, restored: null };
  try {
    for (const level of ['off', 'max']) {
      await post('/state', { reasoningEffort: level });
      const rows = [];
      for (let i = 0; i < REPS; i++) {
        const rec = await runOnce();
        rows.push({ status: rec.status, reasoningChars: rec.reasoningChars, chars: rec.chars, effort: rec.effort, effortSent: rec.effortSent, effortNote: rec.effortNote });
        console.log('  ' + level.padEnd(4) + ' #' + (i + 1) + '  status=' + String(rec.status).padEnd(6) + ' 思考=' + String(rec.reasoningChars).padStart(6) + ' 字  正文=' + String(rec.chars).padStart(5) + ' 字  effortSent=' + JSON.stringify(rec.effortSent) + '  note=' + rec.effortNote);
      }
      out.groups[level] = { rows, reasoning: rows.map((x) => x.reasoningChars), medianReasoning: med(rows.map((x) => x.reasoningChars)), sentValues: [...new Set(rows.map((x) => x.effortSent))], notes: [...new Set(rows.map((x) => x.effortNote))] };
    }
    // 守卫：找一个**未声明 max** 的模型
    console.log('');
    console.log('--- 守卫：未声明 max 的模型应不发该字段 ---');
    await post('/state', { reasoningEffort: 'max' });
    const cat = await j(API + '/models?force=1');
    const models = [];
    for (const g of (cat.groups || [])) for (const m of (g.models || [])) models.push({ provider: g.id, model: m.id, name: m.name });
    let picked = null;
    for (const m of models) {
      const e = await j(API + '/efforts?provider=' + encodeURIComponent(m.provider) + '&model=' + encodeURIComponent(m.model));
      const ids = (e.efforts || []).map((x) => x.id);
      console.log('   ' + m.provider + '/' + m.model + '  声明档位=' + JSON.stringify(ids));
      if (ids.length > 0 && ids.indexOf('max') < 0 && !picked) picked = m;
    }
    if (picked) {
      await post('/state', { model: { provider: picked.provider, model: picked.model, name: picked.name || picked.model } });
      const rec = await runOnce();
      out.guard = { model: picked.provider + '/' + picked.model, status: rec.status, effort: rec.effort, effortSent: rec.effortSent, effortNote: rec.effortNote };
      console.log('   用 ' + out.guard.model + ' 跑一次 → status=' + rec.status + '  effortSent=' + JSON.stringify(rec.effortSent) + '  note=' + rec.effortNote);
    } else {
      out.guard = { skipped: '本机模型目录里没有"声明了档位但缺 max"的模型' };
      console.log('   （跳过：没有合适的模型）');
    }
  } finally {
    try { await post('/state', { reasoningEffort: before.reasoningEffort, model: before.model }); } catch (e) { /* best effort */ }
    out.restored = { reasoningEffort: before.reasoningEffort, model: before.model };
  }
  const off = out.groups.off, max = out.groups.max;
  console.log('');
  console.log('=== 结论 ===');
  console.log('  off 组：思考中位数=' + off.medianReasoning + ' 字  实发=' + JSON.stringify(off.sentValues) + '  note=' + JSON.stringify(off.notes));
  console.log('  max 组：思考中位数=' + max.medianReasoning + ' 字  实发=' + JSON.stringify(max.sentValues) + '  note=' + JSON.stringify(max.notes));
  const checks = [
    ['两组都真的把值发出去了（effortSent 等于配置值）', off.sentValues.length === 1 && off.sentValues[0] === 'off' && max.sentValues.length === 1 && max.sentValues[0] === 'max', 'off→' + JSON.stringify(off.sentValues) + ' max→' + JSON.stringify(max.sentValues)],
    ['off 组思考显著少于 max 组（类别级差异）', off.medianReasoning < max.medianReasoning / 2, 'off 中位 ' + off.medianReasoning + ' vs max 中位 ' + max.medianReasoning],
    ['守卫：未声明 max 的模型不发该字段（若有合适模型）', !out.guard || out.guard.skipped || (out.guard.effortSent === null && String(out.guard.effortNote).indexOf('not-declared') >= 0), out.guard ? JSON.stringify(out.guard) : '-'],
  ];
  let bad = 0;
  for (const [n, ok, d] of checks) { if (!ok) bad++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + '   [' + d + ']'); }
  out.checks = checks.map(([n, ok, d]) => ({ n, ok, d })); out.pass = bad === 0;
  fs.writeFileSync(path.join(__dirname, 'effort-live.json'), JSON.stringify(out, null, 1));
  console.log('');
  console.log(bad === 0 ? '判定：思考强度已真实生效 ✓' : '判定：❌ ' + bad + ' 项不达标');
  console.log('WROTE evidence/effort-live.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
