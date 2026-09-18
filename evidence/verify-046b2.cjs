// 0.4.6-beta.2 验收：node evidence/verify-046b2.cjs
// 覆盖：①"缺失 = 默认开"（删掉状态文件里的 readTools 再读）②默认开时真的派出只读工具
//       ③显式 false 仍然算关（不派工具）④工具链失败必须降级为无工具运行且**结果非空**
//       ⑤产出收件人：极端档产出里不得有面向老板的转交语（复现用例＝老板本轮原话）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const STATE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'prompt-optimizer.json');
// 复现用例：老板这一轮的原话（0.4.6-beta.1 用它在极端档产出了"把下面这段整条发给工作 AI…"）
const REQ = '让读取工具默认开启,只读查证（让优化 AI 真的读项目）改成"只读权限:"按钮放在"只读权限"右边.';

const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 300) } } };
const post = (p, body) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getState = async () => (await j(API + '/state')).state;
function withoutKey() {
  const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  delete raw.readTools;
  fs.writeFileSync(STATE, JSON.stringify(raw, null, 2));
}
async function runOnce(extra) {
  const t0 = Date.now();
  const r = await post('/run', Object.assign({ request: REQ, tier: 'extreme' }, extra || {}));
  const id = r.runId || r.id;
  if (!id) return { error: JSON.stringify(r).slice(0, 160) };
  for (let i = 0; i < 240; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const list = await j(API + '/runs');
    const rec = (list.runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return Object.assign({ id, ms: Date.now() - t0 }, rec);
  }
  return { id, error: 'timeout' };
}
const HEAD_META = /(发给|转给|转发|复制粘贴|以下是.{0,6}(优化|改写)|优化后的提示词|你可以直接|请查收)/;

(async () => {
  const out = [];
  const say = (s) => { out.push(s); console.log(s); };

  // ① 缺失 = 开
  withoutKey();
  const st1 = await getState();
  say('① 状态文件删掉 readTools 键后 GET /state → readTools = ' + st1.readTools + '（期望 true：缺失即默认开）');

  // ② 默认（不传任何参数）跑一次：应当真的派出只读工具
  const rDefault = await runOnce();
  if (rDefault.error) say('② ❌ 运行失败 ' + rDefault.error);
  else {
    const t = String(rDefault.text || '');
    const facts = ['lib/client.js', 'lib/index.js', 'package.json', '只读权限', '0.4.6-beta.2'].filter((k) => t.includes(k));
    say('② 默认跑（不传 readTools）：readTools=' + rDefault.readTools + ' 工具调用=' + rDefault.toolCalls + ' ' + JSON.stringify(rDefault.toolNames || []) + ' 产出=' + t.length + ' 字');
    say('   真实项目事实：' + (facts.length ? JSON.stringify(facts) : '（无）'));
    say('   收件人闸门：' + JSON.stringify(rDefault.addressee || null));
    say('   产出开头（首 140 字）：' + t.replace(/\s+/g, ' ').slice(0, 140));
    const head = t.replace(/\s+/g, ' ').slice(0, 100);
    say('   开头是否含面向老板的转交语：' + (HEAD_META.test(head) ? '⚠️ 是' : '否 ✓'));
  }

  // ③ 显式关：不派工具，结果仍非空
  await post('/state', { readTools: false });
  const st2 = await getState();
  const rOff = await runOnce();
  say('③ 显式 readTools=false → /state=' + st2.readTools + '；运行：工具调用=' + (rOff.toolCalls === undefined ? '?' : rOff.toolCalls) + ' 产出=' + String(rOff.text || '').length + ' 字 status=' + rOff.status);

  // ④ 降级：工具链失败 → 无工具运行且结果非空
  await post('/state', { readTools: true });
  const rDeg = await runOnce({ forceToolError: true });
  const dtext = String(rDeg.text || '');
  say('④ 强制工具链失败：toolLoopError=' + JSON.stringify(rDeg.toolLoopError || null) + ' 工具调用=' + rDeg.toolCalls + ' 产出=' + dtext.length + ' 字 status=' + rDeg.status);
  say('   降级后产出开头：' + dtext.replace(/\s+/g, ' ').slice(0, 100));

  // 收尾：恢复"未设置"状态（缺失 = 默认开），不让验证脚本给老板留下显式值
  withoutKey();
  const st3 = await getState();
  say('⑤ 收尾：删回未设置 → /state readTools = ' + st3.readTools + '（期望 true）');

  const pass = st1.readTools === true
    && rDefault.readTools === true && rDefault.toolCalls > 0 && !HEAD_META.test(String(rDefault.text || '').replace(/\s+/g, ' ').slice(0, 100))
    && st2.readTools === false && rOff.toolCalls === 0 && String(rOff.text || '').length > 0
    && Boolean(rDeg.toolLoopError) && dtext.length > 0
    && st3.readTools === true;
  console.log('');
  console.log(pass ? '判定：全部达标 ✓' : '判定：❌ 有项目未达标（见上）');
  fs.writeFileSync(path.join(__dirname, 'verify-046b2.json'), JSON.stringify({ pass, at: new Date().toISOString(), stateDefault: st1.readTools, default: { toolCalls: rDefault.toolCalls, toolNames: rDefault.toolNames, chars: String(rDefault.text || '').length, addressee: rDefault.addressee, head: String(rDefault.text || '').slice(0, 300) }, off: { toolCalls: rOff.toolCalls, chars: String(rOff.text || '').length }, degrade: { toolLoopError: rDeg.toolLoopError, chars: dtext.length, head: dtext.slice(0, 200) } }, null, 2));
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
