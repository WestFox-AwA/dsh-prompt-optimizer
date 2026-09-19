// 膨胀闸门口径校准（离线，不花 LLM 调用）：node evidence/calibrate-length-gate.cjs
//
// 目的：F6 现在只按"总字数 ≤ 倍率×原话"判越界。b666002 实测发现这个口径**罚错了对象**——
//   读仓库臂 506 字（16.9×）被判越界 6/6，但产物几乎全是"带出处的搬运"（规则原文 + 三处当前位置 + 不许动的行）。
//   真正该管的是"自产文字"（替用户加的话、教学、套话），不是搬运。
//
// 本脚本拿**已经跑出来的真实产物**当样本，检验候选口径是否"该过的过、该罚的罚"：
//   · 应放行：读仓库臂的 brief（密集出处）、raw 直通、0.4.x 里短而准的产物
//   · 应罚：v0.5 那种"规格文档"（小标题 + 判据章节 + 表格化的自产要求）
const fs = require('node:fs');
const path = require('node:path');

// ── 口径**只有一份实现**：直接用宿主导出的 evaluateLengthGate（避免两处逻辑漂移）──
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const samples = [];
const push = (name, text, rawChars, expect, tier) => samples.push({ name, text, rawChars, expect, tier: tier || 'extreme' });

// A. 读仓库臂的真实 brief（b666002 三份 + b555001 一份）——期望：放行
const batchDir = path.join(__dirname, 'dynamic-suite', 'batches');
const v6erFiles = [];
for (const b of fs.readdirSync(batchDir)) {
  const d = path.join(batchDir, b);
  if (!fs.statSync(d).isDirectory()) continue;
  for (const e of fs.readdirSync(d)) {
    if (/__v6er/.test(e) && fs.existsSync(path.join(d, e, 'command.txt'))) v6erFiles.push(path.join(d, e, 'command.txt'));
  }
}
const rawCharsOf = (p) => { try { return Number(JSON.parse(fs.readFileSync(path.join(path.dirname(p), '..', 'manifest.json'), 'utf8')).entries.find((x) => x.dir === path.dirname(p)).rawChars) } catch { return 34 } };
for (const f of v6erFiles.slice(0, 6)) push('read-arm: ' + path.basename(path.dirname(f)), fs.readFileSync(f, 'utf8'), rawCharsOf(f) || 34, 'pass');

// B. raw 直通——期望：放行
push('raw 直通', '给 tool.mjs 加一个 --reverse 参数：把输出反转。', 26, 'pass');

// C. v0.5 时代的"规格文档"（真实存档）——期望：罚
try {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'generations-ab-v05.json'), 'utf8'));
  for (const c of (g.cases || []).slice(0, 3)) {
    if (c.D_v6 && c.D_v6.text) push('规格文档: ' + String(c.request).slice(0, 12), c.D_v6.text, String(c.A_raw || '').length || 40, 'fail');
  }
} catch (e) { console.log('（跳过规格文档样本：' + e.message + '）') }

// ── 判定与统计：口径来自宿主（evaluateLengthGate）──
(async () => {
  const V = (await import(MOD)).__poVerify;
  const classify = V.classifyOutputLengths;
  const gate = V.evaluateLengthGate;
  for (const s of samples) Object.assign(s, classify(s.text));

  console.log('样本  ' + '字数'.padStart(6) + '自产'.padStart(7) + '出处'.padStart(7) + '出处行'.padStart(7) + '  期望  自产倍率');
  for (const s of samples) {
    const ratio = Math.round((s.selfChars / Math.max(1, s.rawChars)) * 100) / 100;
    console.log(s.name.slice(0, 34).padEnd(36) + String(s.chars).padStart(6) + String(s.selfChars).padStart(7) + String(s.citedChars).padStart(7) + String(s.citedLines).padStart(7) + '  ' + s.expect.padEnd(6) + String(ratio).padStart(8));
  }
  let bad = 0;
  console.log('\n宿主口径判定：');
  for (const s of samples) {
    const v = gate(s.tier, s.rawChars, s.text);
    const want = s.expect === 'pass';
    const ok = v.over === !want;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + s.name.slice(0, 34).padEnd(36) + (v.over ? '罚下' : '放行') + '  ' +
      (v.over ? v.overReason : '自产 ' + v.selfChars + ' ≤ ' + v.selfLimit + (v.transferLike ? '（或搬运型豁免）' : '')) + '（期望' + (want ? '放行' : '罚下') + '）');
  }
  console.log('');
  console.log(bad === 0 ? '判定：宿主闸门在真实产物上全部符合期望 ✓' : '判定：❌ ' + bad + ' 个样本不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
