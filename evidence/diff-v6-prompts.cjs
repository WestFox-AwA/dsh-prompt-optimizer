// 提示词差异审计：node evidence/diff-v6-prompts.cjs [基线文件]
// 用途：契约层（V6_CORE）每轮变更后，**逐行**看清"这一轮到底改了什么"——
// 这是"确保不会有新问题"的审计入口（读得到才敢说没夹带）。
// 默认拿 v6-prompt-baseline.json 作对照；给了参数就用指定的存档基线。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;
const baseFile = process.argv[2] || 'v6-prompt-baseline.json';

(async () => {
  const V = (await import(MOD)).__poVerify;
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, baseFile), 'utf8')).tiers;
  console.log('对照基线：' + baseFile + '（冻结于 ' + JSON.parse(fs.readFileSync(path.join(__dirname, baseFile), 'utf8')).at + '）');
  console.log('');
  let changed = 0;
  for (const tier of ['basic', 'advanced', 'extreme']) {
    for (const kind of ['plain', 'withObserver']) {
      const oldText = (base[tier] || {})[kind];
      if (typeof oldText !== 'string') continue;
      const nowText = V.buildSystem(tier, kind === 'plain' ? { historyMode: 'turns' } : { historyMode: 'turns', observerBlock: '【观察者上下文·样例块】\n【用户】示例一行' });
      if (oldText === nowText) { console.log('  = ' + tier + '/' + kind + ' 未变（' + nowText.length + ' 字）'); continue; }
      changed++;
      const a = oldText.split('\n'); const b = nowText.split('\n');
      console.log('  ✎ ' + tier + '/' + kind + '  ' + oldText.length + ' → ' + nowText.length + ' 字  行 ' + a.length + ' → ' + b.length);
      for (const line of b) {
        if (a.indexOf(line) < 0) console.log('      + ' + line.slice(0, 130));
      }
      for (const line of a) {
        if (b.indexOf(line) < 0) console.log('      − ' + line.slice(0, 130));
      }
    }
  }
  console.log('');
  console.log(changed === 0 ? '本轮提示词与基线完全一致。' : '共 ' + changed + ' 组发生变化（上面逐行列出）。');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
