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
const DEPTH_PHRASES = ['改哪个文件的哪个函数', '正向丰富', '尽你所能地查证', '边界与回归约束'];
// 契约层条款（SPEC v0.5：结构性规则，三档都要带）
const CORE_PHRASES = ['【依据】', '【只补这五类】', '【不要写】', '保守不得升级成硬约束', '不许猜'];
const PTC_PHRASES = ['改动清单', '集合、不是工序', '够用即止', '真实依赖写进条目本身', '看哪里、什么算过'];
const CHAT_ONLY = ['阶段／步骤（工序）', '篇幅：**不设限**'];
// 已砍掉的东西：出现即视为回流
//  · FORM_BANNED：形式教学标记——只可能作为**要求**出现，任何地方出现都算回流
//  · BOILERPLATE：验证套话／流程仪式——V6_CORE 的【不要写】条款会**点名禁止**它们，
//    所以判据是"只允许出现在那一行里"（出现次数 = 1 且所在行含【不要写】），其余位置出现即回流
const FORM_BANNED = ['输出结构：目标', '可机器判定', '长度不设限', '阶段性任务', '先查证，再分阶段', '验收（≤3 条'];
const BOILERPLATE = ['请充分验证', '请自测', '阶段闸门', '失败预案'];
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
  console.log('①b 契约层条款（三档 × 两形态都要带——0.4.6-beta.6 起为结构性规则）');
  for (const t of TIERS) {
    for (const d of ['chat', 'ptc']) {
      const sys = V.buildSystem(t, { historyMode: 'turns', delivery: d });
      const miss = CORE_PHRASES.filter((p) => sys.indexOf(p) < 0);
      const ok = miss.length === 0;
      if (!ok) bad++;
      console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + d.padEnd(5) + '契约条款缺失=' + (miss.length ? JSON.stringify(miss) : '无'));
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
  console.log('⑤ 已砍的形式教学／验证套话不得回流（SPEC §5）');
  for (const t of TIERS) {
    for (const d of ['chat', 'ptc']) {
      const sys = V.buildSystem(t, { historyMode: 'turns', delivery: d });
      const form = FORM_BANNED.filter((p) => sys.indexOf(p) >= 0);
      const boil = BOILERPLATE.filter((p) => {
        const lines = sys.split('\n').filter((L) => L.indexOf(p) >= 0);
        return lines.length !== 1 || lines[0].indexOf('【不要写】') < 0;
      });
      const hit = form.concat(boil);
      const ok = hit.length === 0;
      if (!ok) bad++;
      console.log('  ' + (ok ? '✓' : '✗') + ' ' + t.padEnd(9) + d.padEnd(5) + (ok ? '未回流（套话只出现在禁令行）' : '✗ 回流了：' + JSON.stringify(hit)));
    }
  }
  console.log('');
  console.log(bad === 0 ? '判定：投影只动了组织方式与篇幅，深度与丰富许可原样保留 ✓' : '判定：❌ ' + bad + ' 项不达标');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
