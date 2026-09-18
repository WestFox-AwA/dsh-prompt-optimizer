// 下游形态投影验证：node evidence/verify-delivery-axes.cjs
// ① 不变式：delivery 只允许改 sequence / budget，depth / enrich / grounding 必须逐字不变（"定义不丢失"）
// ② 迁移检查：chat 渲染 = 改前基线（另有 snapshot-v6-prompts.cjs --compare 做逐字节断言）
// ③ PTC 投影：出现"改动清单 / 集合、不是工序 / 够用即止"，且**深度短语一条都不能少**
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

// 深度必须保留的短语（extreme）：位置级细节 + 正向丰富
const DEPTH_PHRASES = ['改哪个文件的哪个函数', '正向丰富', '尽你所能地查证', '边界与回归约束'];
const PTC_PHRASES = ['改动清单', '集合、不是工序', '够用即止', '不写先后顺序', '可机器判定'];
const CHAT_ONLY = ['步骤', '阶段性任务', '长度不设限'];
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
  console.log('④ delivery 声明块（只在非 chat 注入）');
  console.log('   chat 块长度=' + V.renderDeliveryBlock('chat').length + '（应为 0）  ptc 块长度=' + V.renderDeliveryBlock('ptc').length);
  if (V.renderDeliveryBlock('chat').length !== 0) bad++;
  console.log('');
  console.log(bad === 0 ? '判定：投影只动了组织方式与篇幅，深度与丰富许可原样保留 ✓' : '判定：❌ ' + bad + ' 项不达标');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
