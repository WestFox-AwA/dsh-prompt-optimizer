// 收尾自检 / 环境受限口径 桩单测：node evidence/verify-closing-check.cjs
//
// 起因（2026/09/19 实测）：下游常说"沙箱限制，无法测试/调试/截图"。根因三条：
//   ① 本机 637 个会话里 450 个跑在 workspace-write（受限档：程序不能开命名管道 → Node 子进程+管道捕获输出 EPERM；
//      approval=never 时提权被自动拒绝）；
//   ② profile 里没有任何浏览器/截图 MCP → 它没有截图工具；
//   ③ **我们自己在提示词里替它写好了出口**（旧策略甚至点名"沙箱限制…穷尽后允许上报未验证"）。
// 本测守住三件事：不让"沙箱"这类词再进提示词；旧策略必须把出口换成"贴证据 + 向老板要那一件事"；
// 三档都必须把收尾自检写进命令。
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

(async () => {
  const V = (await import(MOD)).__poVerify;
  const S = (tier, o) => V.buildSystem(tier, Object.assign({ historyMode: 'turns' }, o || {}));
  const legacy = { v2: V.STRATEGY_V2_SYSTEM, v4: V.STRATEGY_V4_SYSTEM, v41: V.STRATEGY_V41_SYSTEM };

  // ① 三档（默认路径）都必须要求把收尾自检写进命令
  check('三档都带收尾自检', { basic: S('basic').indexOf(V.CLOSING_SELFCHECK) >= 0, advanced: S('advanced').indexOf(V.CLOSING_SELFCHECK) >= 0, extreme: S('extreme').indexOf(V.CLOSING_SELFCHECK) >= 0 },
    { basic: true, advanced: true, extreme: true });

  // ② 收尾自检四要素：可用手段 / 贴最小复现命令+报错原文 / 向老板要那一件事 / 不许只说"没办法验证"
  const c = V.CLOSING_SELFCHECK;
  check('收尾自检四要素齐全', {
    可用手段: /本会话实际可用/.test(c),
    报错原文: /最小复现命令与报错原文/.test(c),
    要老板做: /需要老板做什么/.test(c),
    禁止空口: /不许只说"我没办法验证"/.test(c),
  }, { 可用手段: true, 报错原文: true, 要老板做: true, 禁止空口: true });
  check('收尾自检仍然克制（不要求过度工程化）', { 最短: /最短手段/.test(c), 不要长篇: /不要长篇自证/.test(c), 不要反复: /不要反复跑调试/.test(c) }, { 最短: true, 不要长篇: true, 不要反复: true });

  // ③ 所有可运行时切换的策略里，**不许再出现"沙箱"这类会被原样学去的词**
  const scan = { basic: S('basic'), advanced: S('advanced'), extreme: S('extreme'), ...legacy };
  const withSandbox = Object.entries(scan).filter(([, t]) => /沙箱/.test(t)).map(([k]) => k);
  check('任何策略文本里都不出现"沙箱"', withSandbox, []);

  // ④ 旧策略的出口必须已换成新口径（贴证据 + 向老板要那一件事），且不再有"穷尽后允许上报未验证"
  const oldEscape = Object.entries(scan).filter(([, t]) => /穷尽之后才允许上报|穷尽后才能报告/.test(t)).map(([k]) => k);
  check('不再有"穷尽后可以上报未验证"的现成出口', oldEscape, []);
  check('旧策略已换成新口径', Object.fromEntries(Object.entries(legacy).map(([k, t]) => [k, /需要老板做什么/.test(t) && /最小复现命令与报错原文/.test(t)])),
    { v2: true, v4: true, v41: true });

  // ⑤ 旧策略里的"代理手段不算验收"这类正向要求不许丢
  check('旧策略仍要求"真实媒介里验收"', { v2: /代理手段不算验收|真实媒介/.test(legacy.v2), v4: /真实媒介/.test(legacy.v4), v41: /真实媒介/.test(legacy.v41) }, { v2: true, v4: true, v41: true });

  let bad = 0;
  for (const x of cases) {
    const ok = JSON.stringify(x.got) === JSON.stringify(x.want);
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + x.name);
    if (!ok) { console.log('      得到 ' + JSON.stringify(x.got)); console.log('      期望 ' + JSON.stringify(x.want)); }
  }
  console.log('');
  console.log(bad === 0 ? '判定：受限口径已统一 ✓（不提"沙箱"、出口改成"贴证据+向老板要那一件事"、三档都写收尾自检）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
