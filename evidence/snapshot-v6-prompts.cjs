// 冻结/比对 v6 三档 system 基线：node evidence/snapshot-v6-prompts.cjs [--compare]
//   （无参数）= 写基线 evidence/v6-prompt-baseline.json（**改前**跑一次，之后不再覆盖）
//   --compare  = 重新计算并与基线逐字节比对，打印差异（这是"chat 形态零回归"的硬证据）
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;
const BASE = path.join(__dirname, 'v6-prompt-baseline.json');
const compare = process.argv.includes('--compare');
const OBS = '【观察者上下文·样例块】\n【用户】示例一行';
const TIERS = ['basic', 'advanced', 'extreme'];
// delivery 缺省即 chat（改前没有这个参数，函数会忽略未知 opts —— 所以基线就是 chat 形态）
const CASES = {
  plain: { historyMode: 'turns' },
  withObserver: { historyMode: 'turns', observerBlock: OBS },
  fullObserver: { historyMode: 'full', observerBlock: OBS },
  // 显式 chat（改后用它做等价性断言；取值必须与上面完全相同）
  explicitChat: { historyMode: 'turns', delivery: 'chat' },
  explicitChatObserver: { historyMode: 'turns', observerBlock: OBS, delivery: 'chat' },
};

(async () => {
  const mod = await import(MOD);
  const V = mod.__poVerify;
  if (!V || typeof V.buildSystem !== 'function') { console.error('❌ 取不到 __poVerify.buildSystem'); process.exit(1); }
  const now = {};
  for (const t of TIERS) {
    now[t] = {};
    for (const [name, opts] of Object.entries(CASES)) now[t][name] = V.buildSystem(t, opts);
  }
  if (!compare) {
    fs.writeFileSync(BASE, JSON.stringify({ at: new Date().toISOString(), tiers: now }, null, 1));
    console.log('已写基线 ' + BASE);
    for (const t of TIERS) console.log('  ' + t.padEnd(9) + ' plain=' + now[t].plain.length + ' 字  withObserver=' + now[t].withObserver.length + ' 字');
    return;
  }
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8')).tiers;
  let bad = 0;
  for (const t of TIERS) {
    for (const name of Object.keys(CASES)) {
      const a = base[t] && base[t][name];
      const b = now[t][name];
      if (a === undefined) { console.log('  ? ' + t + '/' + name + ' 基线缺失（跳过）'); continue; }
      if (a === b) { console.log('  ✓ ' + t.padEnd(9) + name.padEnd(20) + ' 逐字节相同（' + a.length + ' 字）'); continue; }
      bad++;
      console.log('  ✗ ' + t.padEnd(9) + name.padEnd(20) + ' 不一致！基线 ' + a.length + ' 字 / 现在 ' + b.length + ' 字');
      const L = a.split('\n'), R = b.split('\n');
      for (let i = 0; i < Math.max(L.length, R.length) && i < 400; i++) {
        if ((L[i] || '') === (R[i] || '')) continue;
        console.log('      L' + (i + 1) + ' 基线: ' + String(L[i] === undefined ? '(无)' : L[i]).slice(0, 120));
        console.log('      L' + (i + 1) + ' 现在: ' + String(R[i] === undefined ? '(无)' : R[i]).slice(0, 120));
      }
    }
  }
  console.log('');
  console.log(bad === 0 ? '判定：chat 形态逐字节不变 ✓（零回归）' : '判定：❌ ' + bad + ' 项不一致');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
