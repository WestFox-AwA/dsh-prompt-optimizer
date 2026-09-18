// 思考通道排查：node evidence/verify-reasoning.cjs
// 判据（关键）：provider 上报的 reasoningTokens 是"模型确实产出了思考"的**权威证据**；
//   run.reasoningChars 是"思考文本**走通透传链路**到达前端"的证据。
//   若某档 reasoningTokens > 0 而 reasoningChars = 0 ⇒ 思考产出正常，**透传链路断了**（与档位定义无关）。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const REQ = '把这个插件的版本号在所有地方统一一下。';

const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return JSON.parse(t) } catch (e) { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function runTier(tier) {
  const t0 = Date.now();
  const r = await post('/run', { request: REQ, tier });
  const id = r.runId || r.id;
  if (!id) return { tier, error: JSON.stringify(r).slice(0, 140) };
  for (let i = 0; i < 240; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const list = await j(API + '/runs');
    const rec = (list.runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') return Object.assign({ tier, ms: Date.now() - t0 }, rec);
  }
  return { tier, error: 'timeout' };
}

(async () => {
  const rows = [];
  for (const tier of ['basic', 'advanced', 'extreme']) rows.push(await runTier(tier));
  console.log('请求：' + REQ);
  console.log('');
  console.log('档位      | readTools | 工具调用 | 思考文本(reasoningChars) | 思考token(provider 上报) | 正文 | effort');
  console.log('--------- | --------- | -------- | ------------------------ | ------------------------ | ---- | ------');
  for (const r of rows) {
    if (r.error) { console.log(r.tier.padEnd(9) + ' | ❌ ' + r.error); continue; }
    console.log(
      String(r.tier).padEnd(9) + ' | ' +
      String(r.readTools).padEnd(9) + ' | ' +
      String(r.toolCalls).padEnd(8) + ' | ' +
      String(r.reasoningChars).padEnd(24) + ' | ' +
      String(r.reasoningTokens === null || r.reasoningTokens === undefined ? '—' : r.reasoningTokens).padEnd(24) + ' | ' +
      String(r.chars).padEnd(4) + ' | ' + String(r.effort),
    );
  }
  const adv = rows.find((r) => r.tier === 'advanced');
  const ext = rows.find((r) => r.tier === 'extreme');
  const bas = rows.find((r) => r.tier === 'basic');
  const broken = [adv, ext].filter((r) => r && r.reasoningChars === 0 && (r.toolCalls || 0) > 0);
  console.log('');
  console.log('基础档 reasoningChars=' + (bas && bas.reasoningChars) + '（不派工具 → 走流式直通路径）');
  console.log(broken.length ? '⇒ 高级/极端：思考文本为 0 且走了工具循环 ⇒ **思考通道在工具循环处被截断**' : '⇒ 高级/极端思考文本非 0（链路通）');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
