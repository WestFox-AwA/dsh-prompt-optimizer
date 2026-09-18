// 上下文机制（W1b）桩单测：node evidence/verify-context-scope.cjs
// 规格：SPEC.md §2 W1b + 铁律 7/8
//   ① 范围只由 UI 决定：回合 = 用户一次 + AI 一次 = 1 回合；0 = 不读；全文 = 整段投影
//   ② 不猜：不给 sessionId / 会话不存在 / 服务不可用 → 一律不注入（**不得回落到"第一个会话"**）
//   ③ 预算不足只降详细度、不改范围；任何"少读/丢弃"必须在注入文本里写明
//   ④ 必须显式声明旁观者身份（否则优化 AI 会以为自己是干活的）
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const U = (t) => ({ role: 'user', content: t });
const A = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }] });
// 5 个回合：U1A1 … U5A5（每回合 = 用户一次 + AI 一次）
const DERIVED = [];
for (let i = 1; i <= 5; i++) { DERIVED.push(U('用户第' + i + '回合的原话')); DERIVED.push(A('AI第' + i + '回合的回复')) }

const SESSIONS = [
  { id: 'session-A-first', derived: [U('别的会话的原话AAA'), A('别的会话的回复BBB')] },
  { id: 'session-B-target', derived: DERIVED },
];
const ctx = { get: (name) => (name === 'sessions' ? { list: () => SESSIONS } : undefined) };
const ctxEmpty = { get: () => undefined };

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });
const call = (V, opts) => V.renderObserverBlock(ctx, opts);
const userTurnsIn = (text) => (text.match(/^【用户】$/gm) || []).length;
const roundOf = (text) => { const m = text.match(/用户第(\d)回合的原话/); return m ? Number(m[1]) : null };
const detailOf = (text) => { const l = (text.split('\n')[1] || ''); const a = l.indexOf('本段：'); return a < 0 ? null : l.slice(a + 3).replace(/）\s*$/, '') };
const rangeOf = (text) => {
  const l = (text.split('\n')[1] || '');
  const a = l.indexOf('读取范围：');
  if (a < 0) return null;
  const rest = l.slice(a + 5);
  const b = rest.indexOf('；本段：');
  return b >= 0 ? rest.slice(0, b) : rest.replace(/）\s*$/, '');
};

(async () => {
  const V = (await import(MOD)).__poVerify;
  if (typeof V.renderObserverBlock !== 'function') { console.error('❌ __poVerify.renderObserverBlock 未导出'); process.exit(1) }

  // ① 范围 = UI
  const t1 = call(V, { mode: 'turns', turns: 1, sessionId: 'session-B-target' });
  check('回合=1 → 只读最后 1 个回合（用户 1 条 + AI 1 条）', { users: userTurnsIn(t1), round: roundOf(t1), range: rangeOf(t1) },
    { users: 1, round: 5, range: '最近 1 个回合（用户一次 ＋ AI 一次 = 1 回合）' });
  const t3 = call(V, { mode: 'turns', turns: 3, sessionId: 'session-B-target' });
  check('回合=3 → 读最后 3 个回合（第 3 回合起）', { users: userTurnsIn(t3), round: roundOf(t3) }, { users: 3, round: 3 });
  const t0 = call(V, { mode: 'turns', turns: 0, sessionId: 'session-B-target' });
  check('回合=0 → 不读上下文（不再兜底成 1 回合）', t0, '');
  const tf = call(V, { mode: 'full', turns: 0, sessionId: 'session-B-target' });
  check('全文 → 整段投影（5 个回合全在）', { users: userTurnsIn(tf), range: rangeOf(tf) }, { users: 5, range: '完整投影（与工作 AI 现在看到的一致）' });
  const toff = call(V, { mode: 'off', turns: 3, sessionId: 'session-B-target' });
  check('off → 不注入', toff, '');

  // ② 不猜（回归：旧实现会回落到 list[0]，把"别的会话"的历史当成本次上下文）
  check('不给 sessionId → 不注入（绝不回落第一个会话）', call(V, { mode: 'turns', turns: 3, sessionId: null }), '');
  const miss = call(V, { mode: 'turns', turns: 3, sessionId: 'no-such-session' });
  check('会话不存在 → 不注入，且不得读到别的会话', { text: miss, leaked: /AAA|BBB/.test(miss) }, { text: '', leaked: false });
  check('sessions 服务不可用 → 不注入', V.renderObserverBlock(ctxEmpty, { mode: 'turns', turns: 3, sessionId: 'session-B-target' }), '');

  // ③ 预算不足：只降详细度、不改范围
  const long = []
  for (let i = 1; i <= 3; i++) { long.push(U('第' + i + '回合用户原话')); long.push(A('长回复'.repeat(400))) }
  const ctxBig = { get: (name) => (name === 'sessions' ? { list: () => [{ id: 's', derived: long }] } : undefined) };
  const squeezed = V.renderObserverBlock(ctxBig, { mode: 'turns', turns: 3, sessionId: 's', budgetChars: 1500 });
  const droppedDeclared = /省略|未读|放不下/.test(squeezed);
  check('超预算 → 范围不变（仍是 3 个回合），详细度降级', { users: (squeezed.match(/^【用户】$/gm) || []).length, assistantOmitted: /助手回复省略/.test(detailOf(squeezed) || '') },
    { users: 3, assistantOmitted: true });
  check('超预算 → 详细度降级有声明（不许静默压缩）', droppedDeclared, true);
  const huge = []
  for (let i = 1; i <= 8; i++) { huge.push(U('第' + i + '回合' + '很长'.repeat(900))); huge.push(A('回复')) }
  const ctxHuge = { get: (name) => (name === 'sessions' ? { list: () => [{ id: 's', derived: huge }] } : undefined) };
  const lastResort = V.renderObserverBlock(ctxHuge, { mode: 'turns', turns: 8, sessionId: 's', budgetChars: 1500 });
  check('详细度已到底仍放不下 → 丢范围**内**最早条目并写明",丢弃"', /省略|未读|放不下/.test(lastResort), true);

  // ④ 旁观者声明（铁律 8）
  const decl = ['旁观者', '不是执行者', '不是用户对你的要求'];
  const missing = decl.filter((p) => t3.indexOf(p) < 0);
  check('注入块显式声明旁观者身份（否则优化 AI 以为自己是干活的）', missing, []);

  // ⑤ 全文安全上限：超出必须声明"未读"
  const many = []
  for (let i = 1; i <= 300; i++) many.push(U('u' + i))
  const ctxMany = { get: (name) => (name === 'sessions' ? { list: () => [{ id: 's', derived: many }] } : undefined) };
  const capped = V.renderObserverBlock(ctxMany, { mode: 'full', sessionId: 's' });
  check('全文超出安全上限 → 声明"最早的 N 条未读"', /最早的 \d+ 条未读/.test(capped), true);

  let bad = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c.got)); console.log('      期望 ' + JSON.stringify(c.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：上下文范围只由 UI 决定、压缩不动范围、解析不到不注入、旁观者身份已声明 ✓' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
