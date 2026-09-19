// ask 机制（SPEC v0.8「跨越信息终极鸿沟」）桩单测：node evidence/verify-ask-contract.cjs
//
// 病根：以前遇到定不下来的点，让它归「自由度」由工作 AI 按"最保守"拍板——而信息不会凭空出现，
//   原话越短自由度越多，一连串保守猜测叠起来必然偏离用户预期。
// 解法：把这些问题**交给用户**——工作 AI 开工前用 DSH 内置 ask 一次问完，问完再动手。三档都要有。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

(async () => {
  const V = (await import(MOD)).__poVerify;
  const S = (tier, o) => V.buildSystem(tier, Object.assign({ historyMode: 'turns' }, o || {}));

  // ① 三档都带 ask 段（老板要求：涉及自由度的一律归为 ask）
  for (const tier of ['basic', 'advanced', 'extreme']) {
    for (const d of ['chat', 'ptc']) {
      check('带 ask 段：' + tier + '/' + d, S(tier, { delivery: d }).indexOf(V.ASK_HEADER) >= 0, true);
    }
  }

  // ② ask 只说"要问"：不写怎么问、不写拿到答案怎么做（那是员工自己的事）
  const ask = S('extreme');
  check('ask 段要求：定不下来的先问、别自己猜', /别自己猜——先问用户/.test(ask), true);
  check('ask 段要求一次问完', /一次问完/.test(ask), true);
  check('ask 段禁止替每种答案预写方案', /别替每种答案预写方案/.test(ask), true);
  check('ask 段不再写"怎么问"的协议（格式/候选/推荐）', { 格式: /1\) <问题>/.test(ask), 推荐: /推荐：X/.test(ask), 双保险长文: /整段缺失＝不合格/.test(ask) }, { 格式: false, 推荐: false, 双保险长文: false });

  // ②b 主角必须是档位正文：ask 相关文字占系统提示的比例必须很小（防止再次喧宾夺主）
  const askShare = (tier) => {
    const sys = S(tier);
    const askChars = V.renderAskClause(tier).length + V.renderAskTail().length + (V.V044_ASK_OVERRIDE.length && tier === 'extreme' ? V.V044_ASK_OVERRIDE.length : 0);
    return Math.round((askChars / sys.length) * 1000) / 1000;
  };
  check('ask 相关文字占系统提示 ≤20%（三档）', { basic: askShare('basic') <= 0.2, advanced: askShare('advanced') <= 0.2, extreme: askShare('extreme') <= 0.2 }, { basic: true, advanced: true, extreme: true });

  // ②c 收尾自检必须写进三档（治"工作 AI 不肯自己验收"）
  check('三档都要求把"收尾自检"写进命令', {
    basic: S('basic').indexOf(V.CLOSING_SELFCHECK) >= 0,
    advanced: S('advanced').indexOf(V.CLOSING_SELFCHECK) >= 0,
    extreme: S('extreme').indexOf(V.CLOSING_SELFCHECK) >= 0,
  }, { basic: true, advanced: true, extreme: true });
  check('收尾自检是"短平快"、不是长篇自证', { 短平快: /最短\*\*的方式/.test(V.CLOSING_SELFCHECK), 不要长篇: /不要长篇自证/.test(V.CLOSING_SELFCHECK), 举例: /截图/.test(V.CLOSING_SELFCHECK) && /跑一次/.test(V.CLOSING_SELFCHECK) }, { 短平快: true, 不要长篇: true, 举例: true });

  // ③ 各档条目预算不同，且与闸门一致（普通 1 / 高级 3 / 极端 5）
  check('条目预算写在提示里且与闸门一致', {
    basic: /最多 1 条/.test(S('basic')) && V.ASK_LIMITS.basic === 1,
    advanced: /最多 3 条/.test(S('advanced')) && V.ASK_LIMITS.advanced === 3,
    extreme: /最多 5 条/.test(S('extreme')) && V.ASK_LIMITS.extreme === 5,
  }, { basic: true, advanced: true, extreme: true });

  // ④ 极端档：系统 = 【ask 段】+【0.4.4 正文 + 收窄条款】+【收件人契约】，逐字节可核对（证明无夹带）
  const extremeChat = S('extreme', { delivery: 'chat' });
  check('极端档 0.4.4 正文逐字节保留（含收窄条款）', extremeChat.indexOf(V.STRATEGY_V5_SYSTEM + '\n\n' + V.V044_ASK_OVERRIDE) >= 0, true);
  const expectedExtreme = [V.renderAskClause('extreme'), V.STRATEGY_V5_SYSTEM + '\n\n' + V.V044_ASK_OVERRIDE, V.CLOSING_SELFCHECK, V.renderAskTail(), V.OUTPUT_ADDRESSEE_CONTRACT].join('\n\n');
  check('极端档系统逐字节 = ask段 + (0.4.4正文+收窄) + 收件人契约', extremeChat === expectedExtreme, true);
  check('ask 段在前（优先于正文，避免被正文的"直接写下去"压掉）', extremeChat.indexOf(V.ASK_HEADER) < extremeChat.indexOf(V.STRATEGY_V5_SYSTEM), true);

  // ⑤ 三档各自的"歧义不再自己拍板"条款都在
  check('普通档：歧义不要替用户挑', /歧义不要替用户挑/.test(S('basic')), true);
  check('高级档：定不下来的不要替他定', /定不下来的不要替他定/.test(S('advanced')), true);
  check('极端档：收窄歧义条款优先于 0.4.4 的"按最保守理解"', /优先于上文/.test(S('extreme')), true);

  // ⑥ 闸门：认得出自然写法（编号 / 内联 / 明确不問），超预算只留痕不裁剪
  const g = V.evaluateAskGate;
  check('无任何提问 → hasSection=false', g('extreme', '就是一条普通命令，没有任何提问。'), { hasSection: false, items: 0, limit: 5, over: false, style: null });
  check('编号写法：数得清（2 条 ≤ 5）', g('extreme', '动手前先向用户确认下面两点：\n1. 型号？\n2. 交付形态？\n【下一节】\n3. 不该被数进去'), { hasSection: true, items: 2, limit: 5, over: false, style: 'listed' });
  check('内联写法：句子本身算 1 条（普通档常见）', g('basic', '做一个坦克。动手前先问用户要哪种形态的坦克，给 2–3 个候选让用户点选，不要自行假定。'), { hasSection: true, items: 1, limit: 1, over: false, style: 'inline' });
  check('明确写"无需提问"→ 不计条目', g('advanced', '先向用户确认：无需提问，信息已足够。'), { hasSection: true, items: 0, limit: 3, over: false, style: 'explicit-none' });
  check('认得出自己规定的"「无」"写法（同行 / 下一行都要认）', {
    同行: g('extreme', V.ASK_HEADER + '无\n\n（后面是正文）').style,
    下行: g('extreme', V.ASK_HEADER + '\n无\n\n正文开始').style,
  }, { 同行: 'explicit-none', 下行: 'explicit-none' });
  check('正文不许因为要问就省掉（写进 ask 条款）', /正文照旧写全/.test(V.renderAskClause('extreme')), true);
  check('前置条款 + 后置提醒都在系统里（双保险）', { 前置: S('basic').indexOf(V.ASK_HEADER) === 0, 后置: /【最后】产出最前面先写/.test(S('basic')) }, { 前置: true, 后置: true });
  check('超预算 → over=true（只留痕、不裁剪）', g('basic', '动手前先问用户：\n1. 甲？\n2. 乙？'), { hasSection: true, items: 2, limit: 1, over: true, style: 'listed' });

  let bad = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.got) === JSON.stringify(c.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(c.got)); console.log('      期望 ' + JSON.stringify(c.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：三档都带 ask 段、机制/判据/一次问完/其余自己定齐全、预算与闸门一致 ✓' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
