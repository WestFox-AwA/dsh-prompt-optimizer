// 跑一道真实任务并留痕（供出处审计用）：node evidence/run-task.cjs <sessionId> "<原话>" [--reads=1] [--tier=extreme]
//   --reads=1（默认）= 允许只读工具；--reads=0 = 禁止（隔离"有没有读到文件"这个变量）
// 输出：runId + context/observer/delivery/工具调用/依据索引 + 产物正文（供人看），并把结果写进 evidence/task-run.json
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

(async () => {
  const sid = process.argv[2];
  const req = process.argv[3];
  if (!sid || !req) { console.error('用法：node evidence/run-task.cjs <sessionId> "<原话>" [--reads=1] [--tier=extreme]'); process.exit(1) }
  const readsArg = (process.argv.filter((a) => a.indexOf('--reads=') === 0)[0] || '--reads=1').split('=')[1];
  const tier = (process.argv.filter((a) => a.indexOf('--tier=') === 0)[0] || '--tier=extreme').split('=')[1];
  const before = (await j(API + '/state')).state;
  console.log('会话=' + sid + '  原话=' + req + '  档位=' + tier + '  只读工具=' + readsArg);
  try {
    await post('/state', { strategy: null, delivery: null });
    const r = await post('/run', { request: req, tier, sessionId: sid, turns: 10, historyMode: 'turns', readTools: readsArg === '1' });
    const id = r.runId || r.id;
    if (!id) { console.error('启动失败：' + JSON.stringify(r)); process.exit(1) }
    let rec = null;
    for (let i = 0; i < 300; i++) {
      await new Promise((s) => setTimeout(s, 1000));
      rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
      if (rec && rec.status !== 'running') break;
    }
    const dbg = (rec && rec.toolLoopDebug) || {};
    console.log('runId=' + id + '  status=' + (rec && rec.status) + '  产出=' + (rec && rec.chars) + ' 字');
    console.log('context=' + JSON.stringify(rec && rec.context));
    console.log('observer=' + JSON.stringify(rec && rec.observer));
    console.log('delivery=' + JSON.stringify(rec && rec.delivery) + '  readTools=' + (rec && rec.readTools) + '  工具调用=' + (rec && rec.toolCalls) + ' ' + JSON.stringify((rec && rec.toolNames) || []));
    console.log('依据索引：读到文件 ' + (dbg.evidenceReads || 0) + ' 次  paths=' + JSON.stringify(dbg.evidencePaths || []) + '  hits=' + JSON.stringify((dbg.evidenceHits || []).slice(0, 6)));
    console.log('');
    console.log('产物正文：');
    console.log(String((rec && rec.text) || '').split('\n').map((L) => '  ' + L).join('\n'));
    fs.writeFileSync(path.join(__dirname, 'task-run.json'), JSON.stringify({ at: new Date().toISOString(), runId: id, sessionId: sid, request: req, tier, reads: readsArg === '1', run: rec }, null, 1));
    console.log('');
    console.log('WROTE evidence/task-run.json   （出处审计：node evidence/audit-provenance.cjs ' + id + '）');
  } finally {
    try { await post('/state', { strategy: before.strategy, delivery: before.delivery }); } catch (e) { /* best effort */ }
  }
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
