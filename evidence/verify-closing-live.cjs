// 收尾自检实机验证：node evidence/verify-closing-live.cjs
// 断言（真实下游会读到的东西）：
//   ① 产物里带"收尾自检"要求，且写清"贴最小复现命令与报错原文 + 需要老板做什么"；
//   ② 产物里**不出现"沙箱"**（不许我们替它提供通用借口）；
//   ③ 提问段（ask）仍然照旧存在（回归）。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const SID = process.argv[2] || 'session-fa377fe1-598d-4135-9383-a5b75bb08d86';
const REQ = process.argv[3] || '做个坦克';
const TIER = process.argv[4] || 'extreme';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 150) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

(async () => {
  const before = (await j(API + '/state')).state;
  let rec = null;
  try {
    await post('/state', { strategy: null, delivery: null });
    const r = await post('/run', { request: REQ, tier: TIER, sessionId: SID, readTools: false, turns: 0, historyMode: 'turns' });
    const id = r.runId || r.id;
    for (let i = 0; i < 240; i += 1) {
      await new Promise((s) => setTimeout(s, 1000));
      rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
      if (rec && rec.status !== 'running') break;
    }
  } finally {
    try { await post('/state', { strategy: before.strategy, delivery: before.delivery }) } catch { /* best effort */ }
  }
  const t = String((rec && rec.text) || '');
  const lines = t.split('\n');
  const at = lines.findIndex((L) => /收尾自检|收尾|验收/.test(L));
  console.log('档位=' + TIER + '  原话=' + REQ + '  产物=' + t.length + ' 字  askGate=' + JSON.stringify(rec && rec.askGate));
  console.log('—— 收尾相关段落 ——');
  console.log(at < 0 ? '   （没找到收尾段落）' : lines.slice(at, at + 4).map((L) => '   ' + L.slice(0, 220)).join('\n'));
  // 判据按**语义**判（模型会换词：写"和"而不是"与"、不叫"收尾自检"——按字面判会连续误报）
  // "禁止空口"按**行级**判：出现"没办法／无法…验证/测试/截图"的行，必须同时带"不要/不许/不得"，
  //   否则就是把借口当结论（第一版要求逐字匹配那句禁令，措辞一换就误报）。
  const excuseLines = t.split('\n').filter((L) => /(没办法|无法)(验证|测试|调试|截图)/.test(L));
  const bareExcuse = excuseLines.filter((L) => !/(不要|不许|不得|禁止)/.test(L));
  const checks = [
    ['产物要求"自己验一遍"（验证/验收/自检 任一）', /(验证|验收|自检)/.test(t)],
    ['要求给出可复现的证据（复现命令 + 报错原文）', /复现命令(与|和)报错原文|最小复现命令/.test(t)],
    ['要求写明"需要老板做什么"', /需要老板做什么/.test(t)],
    ['没有把"我没办法验证"当结论', bareExcuse.length === 0],
    ['产物里不出现"沙箱"', !/沙箱/.test(t)],
    ['提问段仍在（回归）', Boolean(rec && rec.askGate && rec.askGate.hasSection)],
  ];
  console.log('\n──── 判定 ────');
  let bad = 0;
  for (const [n, ok] of checks) { if (!ok) bad++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + n) }
  console.log('');
  console.log(bad === 0 ? '判定：新口径已进入产物 ✓' : '判定：❌ ' + bad + ' 项不符（看上面的收尾段落判断是措辞还是机制问题）');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
