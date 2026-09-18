// 身份层单测（T1 的可证伪验证）：node evidence/verify-run-context.cjs
// 病根：`resolveSessionCwd()` 取"会话列表里第一个有 cwd 的"，与本次运行无关 →
//   实测把只读工具根落到 C:\Users\WestFox\.dsh，并把"这里没有工程文件"写成"已核实的事实"发给下游。
// 本测用**桩会话列表**把五种情形钉死：目标会话不在首位 / 不给 sessionId / 会话不存在 / 无 cwd / 形态判定。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

// 桩：列表里第一个是 **.dsh**（就是实测读到错目录的那个），目标会话排在后面
const SESSIONS = [
  { id: 'session-A-first', header: { cwd: 'C:\\Users\\WestFox\\.dsh', agentPreset: 'standard' } },
  { id: 'session-B-target', header: { cwd: 'D:\\proj\\tank-game', agentPreset: 'ptc' } },
  { id: 'session-C-nocwd', header: { agentPreset: 'router-standard' } },
];
const ctx = { get: (name) => (name === 'sessions' ? { list: () => SESSIONS } : undefined) };
const ctxNoSessions = { get: () => undefined };

(async () => {
  const V = (await import(MOD)).__poVerify;
  const { resolveRunContext, deliveryForRun, resolveSessionCwd } = V;
  const cases = [];
  const check = (name, got, want) => cases.push({ name, got, want });

  const a = resolveRunContext(ctx, 'session-B-target');
  check('目标会话不在首位 → 取**目标**的 cwd（回归本测）', { matched: a.matched, cwd: a.cwd, preset: a.preset, reason: a.reason },
    { matched: true, cwd: 'D:\\proj\\tank-game', preset: 'ptc', reason: 'ok' });
  check('目标会话不在首位 → 形态判 ptc', deliveryForRun(a), { mode: 'ptc', source: 'agentPreset:ptc' });

  const b = resolveRunContext(ctx, null);
  check('不给 sessionId → 不猜（matched=false / cwd=null）', { matched: b.matched, cwd: b.cwd, reason: b.reason }, { matched: false, cwd: null, reason: 'no-session-id' });
  check('不给 sessionId → 形态回落 chat 且来源可读', deliveryForRun(b), { mode: 'chat', source: 'no-session:no-session-id' });

  const c = resolveRunContext(ctx, 'session-ZZ');
  check('会话不存在 → 不回落别的会话', { matched: c.matched, cwd: c.cwd, reason: c.reason }, { matched: false, cwd: null, reason: 'session-not-found' });

  const d = resolveRunContext(ctx, 'session-C-nocwd');
  check('会话存在但没有 cwd → matched 但 cwd=null（于是不派工具）', { matched: d.matched, cwd: d.cwd, reason: d.reason }, { matched: true, cwd: null, reason: 'no-cwd' });
  const e2 = resolveRunContext(ctx, 'session-A-first');
  check('第一个会话（.dsh）仍能按 id 正确解析出来', { cwd: e2.cwd, preset: e2.preset }, { cwd: 'C:\\Users\\WestFox\\.dsh', preset: 'standard' });

  const f = resolveRunContext(ctxNoSessions, 'session-B-target');
  check('sessions 服务不可用 → 不猜', { matched: f.matched, reason: f.reason }, { matched: false, reason: 'session-not-found' });

  const g = resolveSessionCwd(ctx, null);
  check('自检路由：不给 sessionId 时不再回落到"第一个会话"', { cwd: g.cwd, matched: g.matched, reason: g.reason }, { cwd: null, matched: false, reason: 'no-session-id' });

  let bad = 0;
  for (const c2 of cases) {
    const ok = JSON.stringify(c2.got) === JSON.stringify(c2.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c2.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c2.got)); console.log('      期望 ' + JSON.stringify(c2.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：身份层五种情形全部按设计工作 ✓（不猜、可留痕、失败降级）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
