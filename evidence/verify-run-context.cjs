// 身份层单测（T1 的可证伪验证）：node evidence/verify-run-context.cjs
// 病根：`resolveSessionCwd()` 取"会话列表里第一个有 cwd 的"，与本次运行无关 →
//   实测把只读工具根落到 C:\Users\WestFox\.dsh，并把"这里没有工程文件"写成"已核实的事实"发给下游。
// 本测用**桩会话列表**把五种情形钉死：目标会话不在首位 / 不给 sessionId / 会话不存在 / 无 cwd / 形态判定。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
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
  // 单测必须**与活实例状态无关**：手动覆盖（delivery）优先级最高，会把形态判定的期望值改掉。
  // 这里临时把它清成"自动"并在结束时原样恢复（与 verify-effort-guard.cjs 同一套做法）。
  const originalState = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const setDelivery = (v) => {
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (v === null) delete raw.delivery; else raw.delivery = v;
    fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));
  };
  const V = (await import(MOD)).__poVerify;
  const { resolveRunContext, deliveryForRun, resolveSessionCwd, normalizeDelivery } = V;
  const cases = [];
  const check = (name, got, want) => cases.push({ name, got, want });
  try {
    // ① 默认（没设置 / 旧数据的 null / 坏值）＝ **PTC**，且**不看会话**（形态与身份层解耦）
    setDelivery(null);   // 没设置
    const a = resolveRunContext(ctx, 'session-B-target');
    check('目标会话不在首位 → 取**目标**的 cwd（回归本测）', { matched: a.matched, cwd: a.cwd, preset: a.preset, reason: a.reason },
      { matched: true, cwd: 'D:\\proj\\tank-game', preset: 'ptc', reason: 'ok' });
    check('没设置 → 默认 PTC（不看会话 preset）', deliveryForRun(a), { mode: 'ptc', source: 'default-ptc' });

    const b = resolveRunContext(ctx, null);
    check('不给 sessionId → 不猜（matched=false / cwd=null）', { matched: b.matched, cwd: b.cwd, reason: b.reason }, { matched: false, cwd: null, reason: 'no-session-id' });
    check('不给 sessionId → 形态仍是默认 PTC（形态不依赖身份层）', deliveryForRun(b), { mode: 'ptc', source: 'default-ptc' });

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

    check('坏值 ≠ 猜：无法识别的 delivery 值按"没设置"处理', normalizeDelivery('ptc-ish'), null);

    // ② 用户显式选择（source 必须与默认可区分——否则线上分不清"默认生效"还是"用户选的"）
    setDelivery('ptc');
    check('显式 PTC → manual-ptc（即使不给 sessionId）', deliveryForRun(resolveRunContext(ctx, null)), { mode: 'ptc', source: 'manual-ptc' });
    setDelivery('chat');
    check('显式对话式 → manual-chat（压过 ptc 会话的 preset）', deliveryForRun(a), { mode: 'chat', source: 'manual-chat' });

    // ③ 只有显式 'auto' 才回到"看会话 agent preset"
    setDelivery('auto');
    check('auto + ptc 会话 → agentPreset:ptc', deliveryForRun(a), { mode: 'ptc', source: 'agentPreset:ptc' });
    check('auto + 普通会话 → 对话式', deliveryForRun(e2), { mode: 'chat', source: 'agentPreset:standard' });
    check('auto + 不给 sessionId → 回落默认 PTC 且原因可读', deliveryForRun(b), { mode: 'ptc', source: 'auto-no-session->ptc' });
  } finally {
    fs.writeFileSync(STATE, JSON.stringify(originalState, null, 2));
  }

  let bad = 0;
  for (const c2 of cases) {
    const ok = JSON.stringify(c2.got) === JSON.stringify(c2.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c2.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c2.got)); console.log('      期望 ' + JSON.stringify(c2.want)); }
  }
  console.log('');
  console.log('状态文件已恢复：delivery=' + JSON.stringify(originalState.delivery));
  console.log(bad === 0 ? '判定：身份层各情形全部按设计工作 ✓（不猜、可留痕、失败降级、覆盖优先）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
