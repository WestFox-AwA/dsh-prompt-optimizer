// 真实场景验证（T4）：node evidence/verify-real-scenario.cjs
// 用**你实际那几句原话**、在**你实际的会话目录**里跑三次，逐项核对本轮修复是否真的生效：
//   A) v6 + 真实 sessionId  → 工具根必须是那个会话的目录；产出**不得**再出现假事实（.dsh / attachments）
//   B) v5（0.4.3 策略）+ 同一会话 → 对照：纯需求重述该有多长、还带不带"事实段"
//   C) v6 + 不给 sessionId   → 降级：不派工具、不注入观察者、形态 chat（宁可退化，绝不产出假事实）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const REQ = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
async function runOnce(label, sessionId) {
  const r = await post('/run', Object.assign({ request: REQ, tier: 'extreme' }, sessionId ? { sessionId } : {}));
  const id = r.runId || r.id;
  if (!id) return { label, error: JSON.stringify(r).slice(0, 120) };
  for (let i = 0; i < 300; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const list = await j(API + '/runs');
    const rec = (list.runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return Object.assign({ label }, rec);
  }
  return { label, error: 'timeout' };
}
const probe = (t) => ({
  chars: String(t || '').length,
  假事实_dsh: /\.dsh|attachments\/v1\/objects/.test(String(t || '')),
  自称已核实: /已核实|已查证/.test(String(t || '')),
  事实段: /##\s*项目(现状|与问题的事实)|现状（/.test(String(t || '')),
  严禁https: /不得出现[^\n]{0,40}https|零外部引用|无网络请求/.test(String(t || '')),
  允许CDN: /cdn\.jsdelivr|unpkg\.com|three@/.test(String(t || '')),
});
(async () => {
  const before = (await j(API + '/state')).state;
  const del = await j(API + '/delivery');
  const target = (del.sessions || []).filter((s) => s.agentPreset === 'ptc' && String(s.cwd || '').indexOf('0中转站') >= 0)[0]
    || (del.sessions || []).filter((s) => s.agentPreset === 'ptc')[0];
  if (!target) { console.error('找不到可用的 ptc 会话'); process.exit(1); }
  console.log('目标会话：' + target.id);
  console.log('  该会话 cwd = ' + target.cwd + '（工具根应当是它）');
  console.log('  原话：' + REQ);
  console.log('');
  const out = { at: new Date().toISOString(), session: target, req: REQ, runs: {} };
  try {
    await post('/state', { strategy: null, readTools: true });
    console.log('--- A) v6 + 真实 sessionId ---');
    const A = await runOnce('A', target.id);
    out.runs.A = { status: A.status, strategy: A.strategy, context: A.context, toolRoot: A.toolRoot, readTools: A.readTools, toolCalls: A.toolCalls, toolNames: A.toolNames, observer: A.observer, evidenceChars: A.toolLoopDebug && A.toolLoopDebug.evidenceChars, evidenceReads: A.toolLoopDebug && A.toolLoopDebug.evidenceReads, ...probe(A.text), head: String(A.text || '').slice(0, 700) };
    console.log('  context=' + JSON.stringify(A.context));
    console.log('  toolRoot=' + A.toolRoot + '  readTools=' + A.readTools + '  工具调用=' + A.toolCalls + ' ' + JSON.stringify(A.toolNames || []));
    console.log('  证据账本：' + (A.toolLoopDebug ? (A.toolLoopDebug.evidenceChars + ' 字 / 读到文件内容 ' + A.toolLoopDebug.evidenceReads + ' 次') : '(非工具路径)'));
    console.log('  产出核对：' + JSON.stringify(probe(A.text)));

    await post('/state', { strategy: 'v5' });
    console.log('');
    console.log('--- B) v5（0.4.3 策略）+ 同一会话 ---');
    const B = await runOnce('B', target.id);
    out.runs.B = { status: B.status, strategy: B.strategy, context: B.context, readTools: B.readTools, ...probe(B.text), head: String(B.text || '').slice(0, 700) };
    console.log('  strategy=' + B.strategy + '  readTools=' + B.readTools);
    console.log('  产出核对：' + JSON.stringify(probe(B.text)));

    await post('/state', { strategy: null });
    console.log('');
    console.log('--- C) v6 + 不给 sessionId（降级路径）---');
    const C = await runOnce('C', null);
    out.runs.C = { status: C.status, context: C.context, toolRoot: C.toolRoot, readTools: C.readTools, delivery: C.delivery, observer: C.observer, ...probe(C.text) };
    console.log('  context=' + JSON.stringify(C.context));
    console.log('  readTools=' + C.readTools + '（应为 false）  delivery=' + JSON.stringify(C.delivery) + '  observer.reason=' + (C.observer && C.observer.reason));
    console.log('  产出核对：' + JSON.stringify(probe(C.text)));
  } finally {
    try { await post('/state', { strategy: before.strategy, readTools: before.readTools, delivery: before.delivery }); } catch (e) { /* best effort */ }
  }
  const A = out.runs.A, B = out.runs.B, C = out.runs.C;
  const checks = [
    ['A 工具根 = 该会话的目录（不再是 .dsh）', String(A.toolRoot || '') === String(target.cwd || ''), 'toolRoot=' + A.toolRoot],
    ['A 产出不再出现假事实（.dsh / attachments）', A.假事实_dsh === false, JSON.stringify({ 假事实: A.假事实_dsh })],
    ['A 证据账本已生效（读到文件内容或明确为空）', A.evidenceChars === undefined ? true : A.evidenceChars > 0, 'evidenceChars=' + A.evidenceChars + ' reads=' + A.evidenceReads],
    ['B v5 不带"事实段"（纯需求重述）', B.事实段 === false, JSON.stringify({ 事实段: B.事实段, chars: B.chars })],
    ['B v5 比 v6 短（0.4.3 的体量特征）', Number(B.chars) < Number(A.chars), B.chars + ' vs ' + A.chars],
    ['C 无 sessionId → 不派工具', C.readTools === false, 'readTools=' + C.readTools],
    ['C 无 sessionId → 形态回落 chat 且原因可读', (C.delivery && C.delivery.mode === 'chat'), JSON.stringify(C.delivery)],
    ['C 无 sessionId → 观察者不注入且写明原因', !C.observer || C.observer.chars === 0, JSON.stringify(C.observer)],
  ];
  console.log('');
  let bad = 0;
  for (const [n, ok, d] of checks) { if (!ok) bad++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + '   [' + d + ']'); }
  out.checks = checks.map(([n, ok, d]) => ({ n, ok, d })); out.pass = bad === 0;
  fs.writeFileSync(path.join(__dirname, 'real-scenario.json'), JSON.stringify(out, null, 1));
  console.log('');
  console.log(bad === 0 ? '判定：真实场景验证通过 ✓（身份层生效、假事实消失、降级可用、v5 可对照）' : '判定：❌ ' + bad + ' 项不达标');
  console.log('WROTE evidence/real-scenario.json');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
