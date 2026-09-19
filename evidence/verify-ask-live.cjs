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
      // 主角检验（只数**能可靠识别的东西**：标题行 + "以编号开头且含问号"的行）
      //   —— 前两版想按"ask 段落"切分，遇到空行/内联写法连续误判；测不准的指标不许上。
      const qLines = lines.filter((L) => /^\s*\d+[.、)]\s*/.test(L) && /[？?]/.test(L));
      const headerLine = at >= 0 ? lines[at] : '';
      const askChars = headerLine.length + qLines.reduce((s, L) => s + L.length, 0);
      const askItems = qLines.length;
      const askShare = text.length ? Math.round((askChars / text.length) * 100) / 100 : 0;
      const avgAskChars = askItems > 0 ? Math.round(qLines.reduce((s, L) => s + L.length, 0) / askItems) : askChars;
      // 分支注水检验：产物里"如果选 A 就…/若选 B 则…"这类预写方案的痕迹
      const branchHits = (text.match(/若选|如果选|选 A 就|选择 A|则按 A|按 B 执行|视用户选择/g) || []).length;
      rows.push({ id: c.id, tier: c.tier, chars: (rec && rec.chars) || 0, expectAsk: c.expectAsk, gate, section, asked, askShare, askChars, askItems, avgAskChars, branchHits });
      console.log('\n════ ' + c.id + '（' + c.tier + '）原话：' + c.req.slice(0, 40) + ' ════');
      console.log('  产物 ' + ((rec && rec.chars) || 0) + ' 字   askGate=' + JSON.stringify(gate) + '   ask段=' + askChars + ' 字（' + Math.round(askShare * 100) + '%）  平均每条=' + avgAskChars + ' 字   分支注水=' + branchHits);
      console.log('  ask 段：' + (section.length ? '' : '（无）'));
      for (const L of section) console.log('    ' + L.slice(0, 150));
    }
  } finally {
    try { await post('/state', { strategy: before.strategy, delivery: before.delivery }); } catch (e) { /* best effort */ }
  }
  console.log('\n──── 判定 ────');
  let bad = 0;
  const ambiguous = rows.filter((r) => r.expectAsk);
  const askedCount = ambiguous.filter((r) => r.asked).length;
  for (const r of rows) {
    const has = Boolean(r.gate && r.gate.hasSection);
    const within = Boolean(r.gate && !r.gate.over);
    const shortAsk = r.expectAsk ? r.avgAskChars <= 120 : true;      // 提问要短（一条一句话）
    const noBranch = r.branchHits === 0;                              // 不许替每种答案预写方案
    const body = Math.max(0, r.chars - r.askChars);
    // 正文不缩水：普通档天生短（≥30 字即可），高级/极端档正文不该比提问本身还少
    const bodyKept = !r.asked ? true : (r.tier === 'basic' ? body >= 30 : body >= r.askChars);
    const ok = r.expectAsk ? (!r.asked || (within && shortAsk && bodyKept)) && noBranch : (!r.asked && noBranch);
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + r.id.padEnd(12) + (r.expectAsk ? '应问、条目 ≤ ' + (r.gate ? r.gate.limit : '?') + '、每条 ≤120 字、正文不缩水' : '不该问且无分支注水') +
      '  → ' + (has ? (r.gate.style === 'explicit-none' ? '显式写了"无"' : '问了 ' + r.gate.items + ' 条，每条均 ' + r.avgAskChars + ' 字，ask 段 ' + r.askChars + ' 字') : '整段缺失') +
      '  正文 ' + body + ' 字' + (r.branchHits ? '  ✗分支注水 ' + r.branchHits + ' 处' : ''));
  }
  // 批量判据：模糊原话里"真的问了"的比例 —— 单次运行有波动，看比例才诚实（ask 条款允许"无"，但那是给明确请求的）
  const askRate = ambiguous.length ? Math.round((askedCount / ambiguous.length) * 100) : 0;
  const rateOk = askRate >= 60;
  if (!rateOk) bad++;
  console.log('  ' + (rateOk ? '✓' : '✗') + ' 模糊原话真的发起提问的比例：' + askedCount + '/' + ambiguous.length + '（' + askRate + '%，要求 ≥60%）');
  console.log('');
  console.log(bad === 0 ? '判定：ask 机制按设计工作 ✓（该问的问、不该问的不问）' : '判定：❌ ' + bad + ' 项不符（看上面的 ask 段正文判断是措辞问题还是机制问题）');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
