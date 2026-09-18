// 同题对照（SPEC §7 验收 #2）：node evidence/compare-referent.cjs [sessionId] [--rounds=10]
//
// 题目：长迭代里的一句「修复这个bug」——**指代消解**是这件事的全部难点。
//   A（有上下文）：按 UI 设定读最近 N 回合 → 应当落到**具体是哪个 bug**（来自哪一轮、什么症状）
//   B（无上下文）：回合=0 / off → 必须**显式说明找不到指代来源**，不许编一个 bug 出来
// 只读工具一律关闭，隔离出"上下文"这一个变量。
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const REQ = '修复这个bug';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function runOnce(label, body) {
  const r = await post('/run', body);
  const id = r.runId || r.id;
  if (!id) return { label, error: JSON.stringify(r).slice(0, 160) };
  for (let i = 0; i < 300; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return Object.assign({ label }, rec);
  }
  return { label, error: 'timeout' };
}

(async () => {
  const argSid = process.argv[2] && process.argv[2].indexOf('--') !== 0 ? process.argv[2] : null;
  const roundsArg = (process.argv.filter((a) => a.indexOf('--rounds=') === 0)[0] || '--rounds=10').split('=')[1];
  const rounds = Math.max(1, Math.min(10, Number(roundsArg) || 10));
  const del = await j(API + '/delivery');
  const sid = argSid || ((del.sessions || [])[0] || {}).id;
  if (!sid) { console.error('找不到会话'); process.exit(1) }
  const before = (await j(API + '/state')).state;
  const meta = (del.sessions || []).filter((s) => s.id === sid)[0] || {};
  console.log('会话：' + sid + '  目录=' + (meta.cwd || '-') + '  preset=' + (meta.agentPreset || '-'));
  console.log('题目（原话）：' + REQ + '   回合数=' + rounds);
  console.log('');
  const out = { at: new Date().toISOString(), sessionId: sid, cwd: meta.cwd || null, request: REQ, rounds, runs: {} };
  try {
    await post('/state', { strategy: null, tier: 'extreme', delivery: null });
    console.log('--- A) 有上下文（回合=' + rounds + '，只读工具关闭）---');
    const A = await runOnce('A', { request: REQ, tier: 'extreme', sessionId: sid, turns: rounds, historyMode: 'turns', readTools: false });
    out.runs.A = { status: A.status, observer: A.observer, readTools: A.readTools, toolCalls: A.toolCalls, text: String(A.text || ''), chars: A.chars };
    console.log('  observer=' + JSON.stringify(A.observer) + '  readTools=' + A.readTools + ' 工具调用=' + A.toolCalls);
    console.log('  产物 ' + A.chars + ' 字：\n' + String(A.text || '').split('\n').map((L) => '    ' + L).join('\n'));

    console.log('');
    console.log('--- B) 无上下文（回合=0）---');
    const B = await runOnce('B', { request: REQ, tier: 'extreme', sessionId: sid, turns: 0, historyMode: 'turns', readTools: false });
    out.runs.B = { status: B.status, observer: B.observer, readTools: B.readTools, toolCalls: B.toolCalls, text: String(B.text || ''), chars: B.chars };
    console.log('  observer=' + JSON.stringify(B.observer) + '  readTools=' + B.readTools + ' 工具调用=' + B.toolCalls);
    console.log('  产物 ' + B.chars + ' 字：\n' + String(B.text || '').split('\n').map((L) => '    ' + L).join('\n'));
  } finally {
    try { await post('/state', { strategy: before.strategy, tier: before.tier, delivery: before.delivery, readTools: before.readTools }); } catch (e) { /* best effort */ }
  }
  // 机械判据（人看正文做最终判定）：
  const A2 = out.runs.A || {}, B2 = out.runs.B || {};
  const REFUSE_RE = /未找到|找不到|未能确定|无法核对|没有可核对|无可核对|没有可核对对象|不明确|无法确定|缺上下文|不猜|未给出|没有.{0,8}记录|没有指代/;
  const refuse = String(B2.text || '').match(REFUSE_RE);
  const checks = [
    ['隔离变量：两次运行都**没有**派工具（只差上下文）', A2.readTools === false && B2.readTools === false, 'A=' + A2.readTools + ' B=' + B2.readTools],
    ['A 确实读到了上下文（rows > 0）', Boolean(A2.observer && A2.observer.rows > 0), JSON.stringify(A2.observer)],
    ['B 没有上下文（不注入）', Boolean(B2.observer && B2.observer.chars === 0), JSON.stringify(B2.observer)],
    ['B 不编造指代：明确声明找不到指代来源', REFUSE_RE.test(String(B2.text || '')), refuse ? refuse[0] : '(未命中)'],
    ['A ≠ B（上下文真的改变了产出）', String(A2.text || '') !== String(B2.text || ''), 'A ' + A2.chars + ' 字 / B ' + B2.chars + ' 字'],
  ];
  console.log('');
  let bad = 0;
  for (const [n, ok, d] of checks) { if (!ok) bad++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + '   [' + d + ']'); }
  out.checks = checks.map(([n, ok, d]) => ({ n, ok, d })); out.pass = bad === 0;
  fs.writeFileSync(path.join(__dirname, 'referent-ab.json'), JSON.stringify(out, null, 1));
  console.log('');
  console.log(bad === 0 ? '判定：机械判据通过 ✓（**最终判定请看上面两段正文**：A 是否精准打击、B 是否诚实地说找不到）' : '判定：❌ ' + bad + ' 项不达标');
  console.log('WROTE evidence/referent-ab.json');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
