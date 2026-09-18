// 思考强度"守卫"的确定性单测：node evidence/verify-effort-guard.cjs
// 为什么需要：线上模型目录里 5 个模型**都声明了全部四档**，所以"模型未声明该档位"这条分支
// 在真实环境里跑不到——用 stub 把四条分支逐一定死，避免它成为"写了但永远没验过"的死代码。
// 单测会临时改状态文件里的 reasoningEffort，结束时原样恢复。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
const MOD = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;
const stub = (ret) => ({ resolveModelInfo: async () => { if (ret instanceof Error) throw ret; return ret } });
const SEL = { provider: 'p', model: 'm' };

(async () => {
  const { resolveEffortForCall } = (await import(MOD)).__poVerify;
  if (typeof resolveEffortForCall !== 'function') { console.error('取不到 resolveEffortForCall'); process.exit(1); }
  const original = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const setEffort = (v) => {
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (v === null) delete raw.reasoningEffort; else raw.reasoningEffort = v;
    fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));
  };
  const cases = [];
  try {
    setEffort(null);
    cases.push(['未设置档位 → 不发', await resolveEffortForCall(stub({}), SEL), { sent: null, reason: 'unset' }]);
    setEffort('max');
    cases.push(['没有 llm 路由 → 不发', await resolveEffortForCall(null, SEL), { sent: null, reason: 'no-llm-route' }]);
    cases.push(['模型不声明任何档位 → 不发', await resolveEffortForCall(stub({}), SEL), { sent: null, reason: 'model-declares-no-efforts' }]);
    cases.push(['模型声明了档位但**没有** max → 不发（守卫核心）', await resolveEffortForCall(stub({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }), SEL), { sent: null, reason: 'not-declared-by-model' }]);
    cases.push(['模型声明了 max → **发**', await resolveEffortForCall(stub({ reasoning: { efforts: [{ id: 'off' }, { id: 'max' }] } }), SEL), { sent: 'max', reason: 'declared' }]);
    cases.push(['能力查询抛错 → 不发且不炸', await resolveEffortForCall(stub(new Error('boom')), SEL), { sent: null, reasonPrefix: 'info-error:boom' }]);
    setEffort('off');
    cases.push(['配置 off 且模型声明 off → 发 off', await resolveEffortForCall(stub({ reasoning: { efforts: ['off', 'high'] } }), SEL), { sent: 'off', reason: 'declared' }]);
  } finally {
    fs.writeFileSync(STATE, JSON.stringify(original, null, 2));
  }
  let bad = 0;
  for (const [name, got, want] of cases) {
    const okSent = got.sent === want.sent;
    const okReason = want.reasonPrefix ? String(got.reason).indexOf(want.reasonPrefix) === 0 : got.reason === want.reason;
    const ok = okSent && okReason;
    if (!ok) bad++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + name.padEnd(38) + ' sent=' + JSON.stringify(got.sent) + '  reason=' + JSON.stringify(got.reason));
  }
  console.log('');
  console.log('状态文件已恢复：reasoningEffort=' + JSON.stringify(original.reasoningEffort));
  console.log(bad === 0 ? '判定：守卫四条分支全部按设计工作 ✓（含"模型未声明该档位时不发"）' : '判定：❌ ' + bad + ' 项不符');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
