// 档位=三套策略（2026/09/19 定稿）桩单测：node evidence/verify-tier-strategies.cjs
//   普通 basic    = 只做语言层（原意/范围/篇幅不变，不新增要求）
//   高级 advanced = 0.4.4 需求补全的中间态（只补对象/结果/边界）
//   极端 extreme  = 0.4.4 的极端档策略原样（STRATEGY_V5_SYSTEM，一字不改）
// 关键不变式：**极端档在 chat 形态下与 0.4.4 逐字节相同**；交付形态只投影"组织方式 + 篇幅"两行。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

(async () => {
  const V = (await import(MOD)).__poVerify;
  const S = (tier, o) => V.buildSystem(tier, Object.assign({ historyMode: 'turns' }, o || {}));

  // ① 三档确实是三套策略
  check('普通档 = 语言层（不新增要求）', /【只做语言层】/.test(S('basic')), true);
  check('普通档不含需求补全的措辞', { 补全: /完整、具体的要求说明/.test(S('basic')), 五类: /【只补这五类】/.test(S('basic')) }, { 补全: false, 五类: false });
  check('高级档 = 0.4.4 需求补全 + 收窄条款', { v044: /完整、具体的要求说明/.test(S('advanced')), mid: /【本档只补三样，其余不写】/.test(S('advanced')) }, { v044: true, mid: true });
  check('极端档 = 0.4.4 原样（含其全部原始措辞）', { v044: /完整、具体的要求说明/.test(S('extreme')), 收窄: /【本档只补三样/.test(S('extreme')) }, { v044: true, 收窄: false });

  // ② 极端档：系统 = ask 段 + (0.4.4 正文 + 收窄条款) + 收件人契约，逐字节可核对
  const extremeChat = S('extreme', { delivery: 'chat' });
  const expectedExtreme = [V.renderAskClause('extreme'), V.STRATEGY_V5_SYSTEM + '\n\n' + V.V044_ASK_OVERRIDE, V.CLOSING_SELFCHECK, V.renderAskTail(), V.OUTPUT_ADDRESSEE_CONTRACT].join('\n\n');
  check('极端档 = ask段 + (0.4.4正文+收窄条款) + 收件人契约（逐字节）', extremeChat === expectedExtreme, true);

  // ③ 交付形态只投影两行：把"投影行 + 声明块行"剥掉、并把留下的空行归一化之后，chat 与 ptc 必须**逐字节相同**
  //    （两版错判据的教训：按行号 diff 会因插入行整体错位；只 filter 行会留下不同数量的空行）
  const stripProjection = (s) => String(s).split('\n')
    .filter((L) => !/^- (产出形态|篇幅)：/.test(L))
    .filter((L) => !/下游消费方式/.test(L))
    .filter((L) => !/^- 命令的\*\*组织方式\*\*/.test(L))
    .join('\n').replace(/\n{3,}/g, '\n\n');
  const countProjection = (s) => String(s).split('\n').filter((L) => /^- (产出形态|篇幅)：/.test(L)).length;
  for (const tier of ['basic', 'advanced', 'extreme']) {
    const chat = S(tier, { delivery: 'chat' });
    const ptc = S(tier, { delivery: 'ptc' });
    check('剥掉投影行后 chat/ptc 逐字节相同（' + tier + '）', { same: stripProjection(chat) === stripProjection(ptc), chatProj: countProjection(chat), ptcProj: countProjection(ptc) },
      { same: true, chatProj: tier === 'extreme' ? 0 : 2, ptcProj: tier === 'extreme' ? 1 : 2 });
  }

  // ④ 普通/高级档不注入 PTC 声明块之外的东西；chat 形态不注入声明块
  check('chat 形态不注入下游形态声明块', /下游消费方式/.test(S('basic', { delivery: 'chat' })), false);
  check('ptc 形态注入下游形态声明块', /下游消费方式/.test(S('basic', { delivery: 'ptc' })), true);

  // ⑤ 观察者上下文仍然照旧注入（上下文机制不受档位改动影响）
  const withObs = S('extreme', { observerBlock: '【会话上下文（旁观者视角）】样例' });
  check('观察者上下文仍注入（且 0.4.4 正文仍在）', { hasObs: /【会话上下文（旁观者视角）】样例/.test(withObs), keepsV044: withObs.indexOf(V.STRATEGY_V5_SYSTEM) >= 0 }, { hasObs: true, keepsV044: true });

  // ⑥ 长度闸门仍在（自产受倍率、搬运只计数）
  check('长度闸门仍工作', { ok: V.evaluateLengthGate('basic', 30, '原话').over, over: V.evaluateLengthGate('basic', 30, 'x'.repeat(400)).over }, { ok: false, over: true });

  let bad = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c.got)); console.log('      期望 ' + JSON.stringify(c.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：三档=三套策略（极端=0.4.4 原样）、交付只投影两行、上下文与闸门不受影响 ✓' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
