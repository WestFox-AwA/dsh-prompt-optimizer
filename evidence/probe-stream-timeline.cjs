// SSE 事件流时间线探针：node evidence/probe-stream-timeline.cjs [tier] [readTools:on|off]
// 目的：把"浮层里到底什么在流"变成可看的证据——每种事件的首个时间、数量、以及非增量事件的时序。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const tier = process.argv[2] || 'extreme';
const readTools = (process.argv[3] || 'on') === 'on';
const REQ = '把这个插件的 README 安装那一节核对一遍，并说明 lib/index.js 里 API 路由注册在哪一段。';

(async () => {
  await fetch(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readTools }) });
  const r = await fetch(API + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: REQ, tier }) });
  const j = await r.json();
  const runId = j.runId || j.id;
  console.log('run=' + runId + '  tier=' + tier + '  readTools=' + readTools);
  const t0 = Date.now();
  const res = await fetch(API + '/stream?runId=' + encodeURIComponent(runId), { cache: 'no-store' });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  const first = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (line.indexOf('data: ') !== 0) continue;
      let ev = null; try { ev = JSON.parse(line.slice(6)) } catch (e) { continue }
      const at = Date.now() - t0;
      events.push({ at, type: ev.type, len: (ev.text || '').length });
      if (!first[ev.type]) first[ev.type] = at;
      // 非增量事件全部打印；增量事件只打印第一次，避免刷屏
      const isDelta = ev.type === 'reasoning-delta' || ev.type === 'text-delta' || ev.type === 'usage';
      if (!isDelta || first[ev.type] === at) {
        const brief = ev.text ? JSON.stringify(String(ev.text).slice(0, 30)) : (ev.observer ? JSON.stringify(ev.observer) : (ev.delivery ? JSON.stringify(ev.delivery) : ''));
        console.log('  +' + String(at).padStart(6) + 'ms  ' + String(ev.type).padEnd(15) + ' ' + brief);
      }
    }
  }
  const by = {};
  for (const e of events) by[e.type] = (by[e.type] || 0) + 1;
  console.log('');
  console.log('事件计数：' + JSON.stringify(by));
  const rd = events.filter((e) => e.type === 'reasoning-delta');
  const td = events.filter((e) => e.type === 'text-delta');
  console.log('reasoning-delta：' + rd.length + ' 批，首 ' + (first['reasoning-delta'] === undefined ? '-' : first['reasoning-delta'] + 'ms') + '，末 ' + (rd.length ? rd[rd.length - 1].at + 'ms' : '-'));
  console.log('text-delta     ：' + td.length + ' 批，首 ' + (first['text-delta'] === undefined ? '-' : first['text-delta'] + 'ms') + '，末 ' + (td.length ? td[td.length - 1].at + 'ms' : '-'));
  console.log(td.length > 1 ? '⇒ 产出是**流式**的' : (td.length === 1 ? '⇒ 产出是**一次性**推来的（1 批）——浮层里看着"静止"就是这个原因' : '⇒ 全程没有 text-delta'));
  await fetch(API + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readTools: true }) });
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
