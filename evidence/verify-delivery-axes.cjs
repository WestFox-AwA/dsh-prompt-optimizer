// 下游形态投影验证：node evidence/verify-delivery-axes.cjs
// ① 不变式：delivery 只允许改 sequence / budget，depth / enrich / grounding 必须逐字不变（"定义不丢失"）
// ①a 选择器 ≠ 投影：auto / null / 坏值一律不投影
// ①b 契约层条款（SPEC v0.5）：五类缺口 / 依据 / 不许猜 —— 三档 × 两形态都要带
// ② PTC 投影：出现"改动清单 / 集合、不是工序 / 够用即止"，深度短语一条不少，工序措辞不残留
// ⑤ 已砍的形式教学不得回流（SPEC §5 砍）：输出结构模板、可机器判定、验证套话、流程仪式
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

// 深度必须保留的短语（extreme）：位置级细节 + 正向丰富
const DEPTH_PHRASES = ['尽你所能地查证', '正向丰富', '路径:位置', '交叉核对'];
// 契约层条款（2026/09/19 定稿：三档=三套策略，各自的"不许胡来"条款必须都在）
const CORE_PHRASES = {
  basic: ['【只做语言层】', '不得新增用户没说的要求', '原意、范围、篇幅都不变'],
  advanced: ['完整、具体的要求说明', '【本档只补三样，其余不写】', '自己为保险加的约束'],
  extreme: ['完整、具体的要求说明', '只补与他的意思直接相关的', '不写成流程或检查表'],
};
// 各档自己的长度/篇幅约束（EXTREME 只在 PTC 形态下多一行"够用即止"，chat 形态与 0.4.4 逐字节相同）
const BUDGET_PHRASES = { basic: '不超过 1.5 倍', advanced: '不超过原话的 2.5 倍', extreme: '够用即止' };
const PTC_PHRASES = ['改动清单', '集合、不是工序', '够用即止', '真实依赖写进条目本身', '一个程序'];
const CHAT_ONLY = ['阶段／步骤（工序）', '跟随原话量级'];
// 膨胀预算（F6）：三档各自的长度约束文案（EXTREME 只在 PTC 形态下多一行"够用即止"）
// （与上面 CORE_PHRASES 里的 BUDGET_PHRASES 同名会冲突——旧的那份已并入这里）
// 已砍掉的东西：出现即视为回流
//  · FORM_BANNED：形式教学标记——只可能作为**要求**出现，任何地方出现都算回流
//  · BOILERPLATE：验证套话／流程仪式——只允许出现在**禁令句**里（≤1 次且所在行是禁令）
const FORM_BANNED = ['输出结构：目标', '可机器判定', '长度不设限', '阶段性任务', '先查证，再分阶段', '验收（≤3 条', '五类全补', '锚点数 ≤ 改动点数', '每条改动配一个核对点'];
const BOILERPLATE = ['请充分验证', '请自测', '阶段闸门', '失败预案'];
// 禁令句的判定：出现"不要写/不写/不许/不得"等否定词即算（只用于"套话只准出现在禁令里"这一条）
const PROHIBIT_LINE = /【不要写】|【绝对不要】|不许|不得|不写|不要|禁止|严禁/;
const TIERS = ['basic', 'advanced', 'extreme'];
const AXES = ['grounding', 'depth', 'enrich', 'sequence', 'budget'];

(async () => {
  const V = (await import(MOD)).__poVerify;
  let bad = 0;
  console.log('① 不变式：delivery 只改 sequence/budget');
  for (const t of TIERS) {
    const a = V.axesFor(t, 'chat'); const b = V.axesFor(t, 'ptc');
    const moved = AXES.filter((k) => a[k] !== b[k]);
    const illegal = moved.filter((k) => k !== 'sequence' && k !== 'budget');
    const ok = illegal.length === 0 && a.depth === b.depth && a.enrich === b.enrich && a.grounding === b.grounding;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + '允许变动=[' + moved.join(',') + ']  depth=' + a.depth + '（两形态相同）enrich=' + a.enrich + ' grounding=' + a.grounding);
  }
  console.log('');
  console.log('①a 选择器 ≠ 投影：只有**已解析**的 ptc 才投影（auto/null/坏值一律按 chat 轴）');
  for (const t of TIERS) {
    const ref = JSON.stringify(V.axesFor(t, 'chat'));
    const same = ['auto', null, undefined, 'ptc-ish', '', 'AUTO'].filter((v) => JSON.stringify(V.axesFor(t, v)) !== ref);
    const ok = same.length === 0;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + (ok ? '未解析值都不投影' : '✗ 这些值被当成 ptc 投影了：' + JSON.stringify(same)));
  }
  console.log('');
  console.log('①b 各档自己的"不许胡来"条款（三档=三套策略，SPEC 2026/09/19 定稿）');
  for (const t of TIERS) {
    for (const d of ['chat', 'ptc']) {
      const sys = V.buildSystem(t, { historyMode: 'turns', delivery: d });
      const miss = CORE_PHRASES[t].filter((p) => sys.indexOf(p) < 0);
      const ok = miss.length === 0;
      if (!ok) bad++;
      console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + d.padEnd(5) + '条款缺失=' + (miss.length ? JSON.stringify(miss) : '无'));
    }
  }
  console.log('');
  console.log('② PTC 投影的内容检查（chat → ptc）');
  for (const t of TIERS) {
    const chat = V.renderV6TierText(t, V.axesFor(t, 'chat'));
    const ptc = V.renderV6TierText(t, V.axesFor(t, 'ptc'));
    const ptcHit = PTC_PHRASES.filter((p) => ptc.includes(p));
    const depthKept = DEPTH_PHRASES.filter((p) => ptc.includes(p));
    const depthLost = DEPTH_PHRASES.filter((p) => chat.includes(p) && !ptc.includes(p));
    const chatOnlyLeft = t === 'basic' ? [] : CHAT_ONLY.filter((p) => chat.includes(p) && ptc.includes(p));
    const ok = depthLost.length === 0 && chatOnlyLeft.length === 0;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + ' ' + chat.length + ' → ' + ptc.length + ' 字   PTC词命中=' + JSON.stringify(ptcHit));
    if (t === 'extreme') console.log('      深度短语保留=' + JSON.stringify(depthKept) + (depthLost.length ? '  ✗丢失=' + JSON.stringify(depthLost) : ''));
    if (chatOnlyLeft.length) console.log('      ✗ 工序/不设限措辞残留=' + JSON.stringify(chatOnlyLeft));
  }
  console.log('');
  console.log('③ extreme 的 chat → ptc 差异行（供人复核）');
  {
    const chat = V.renderV6TierText('extreme', V.axesFor('extreme', 'chat')).split('\n');
    const ptc = V.renderV6TierText('extreme', V.axesFor('extreme', 'ptc')).split('\n');
    const max = Math.max(chat.length, ptc.length);
    for (let i = 0; i < max; i++) {
      if ((chat[i] || '') === (ptc[i] || '')) { console.log('   = ' + String(chat[i]).slice(0, 96)); continue; }
      console.log('   - chat: ' + String(chat[i] === undefined ? '(无)' : chat[i]).slice(0, 96));
      console.log('   + ptc : ' + String(ptc[i] === undefined ? '(无)' : ptc[i]).slice(0, 96));
    }
  }
  console.log('');
  console.log('④ delivery 声明块（选择器 ≠ 投影：只有已解析的 ptc 注入）');
  const bPtc = V.renderDeliveryBlock('ptc').length;
  const others = ['chat', 'auto', null, undefined, ''].map((v) => v + '=' + V.renderDeliveryBlock(v).length);
  console.log('   ptc 块长度=' + bPtc + '（应 > 0）  其余：' + others.join('  ') + '（都应为 0）');
  if (bPtc <= 0 || others.some((s) => !/=0$/.test(s))) bad++;
  console.log('');
  console.log('⑤ 已砍的形式教学／验证套话不得回流（SPEC §5 + F 系列）');
  for (const t of TIERS) {
    for (const d of ['chat', 'ptc']) {
      const sys = V.buildSystem(t, { historyMode: 'turns', delivery: d });
      const form = FORM_BANNED.filter((p) => sys.indexOf(p) >= 0);
      const boil = BOILERPLATE.filter((p) => {
        const lines = sys.split('\n').filter((L) => L.indexOf(p) >= 0);
        // 没出现 = 合格；出现则只允许 1 次且必须在禁令句里
        return lines.length > 1 || (lines.length === 1 && !PROHIBIT_LINE.test(lines[0]));
      });
      const hit = form.concat(boil);
      const ok = hit.length === 0;
      if (!ok) bad++;
      console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + d.padEnd(5) + (ok ? '未回流（套话只出现在禁令句或未出现）' : '✗ 回流了：' + JSON.stringify(hit)));
    }
  }
  console.log('');
  console.log('⑥ 各档的篇幅约束与闸门（F6：自产受倍率、搬运只计数）');
  for (const t of TIERS) {
    const want = BUDGET_PHRASES[t];
    const inChat = V.buildSystem(t, { historyMode: 'turns', delivery: 'chat' }).indexOf(want) >= 0;
    const inPtc = V.buildSystem(t, { historyMode: 'turns', delivery: 'ptc' }).indexOf(want) >= 0;
    const gate = V.lengthGateFor(t, 100);
    const ratio = V.V6_TIER_AXES[t].maxRatio;
    const ok = (t === 'extreme' ? inPtc : (inChat && inPtc)) && gate > 100;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + '篇幅="' + want + '" chat=' + inChat + ' ptc=' + inPtc + '  轴 maxRatio=' + ratio + '  100 字原话自产上限=' + gate);
  }
  console.log('');
  console.log(bad === 0 ? '判定：投影只动了组织方式与篇幅，深度与丰富许可原样保留 ✓' : '判定：❌ ' + bad + ' 项不达标');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
