// 最近 N 个会话的「验证动作 vs 口头断言」体检：node evidence/recent-verify-audit.cjs [N=30]
// 目的：把"AI 到底有没有动手验证/截图"变成可复核的数字，而不是感觉。
//   动作口径（严格）：
//     shot  = 工具名 read_image / mcp__*-screenshot，或参数里出现 --screenshot / msedge / chrome.exe / playwright / puppeteer
//     exec  = pwsh / bash / shell / run_code（真跑命令）
//   断言口径：与 survey-permission-claims.cjs 同一组正则，原样打印句子。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { decodeAll } = require('./zstd-frames.cjs');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ROOT = path.join(HOME, 'sessions');
const N = Number(process.argv[2] || 30);
const SKIP = /ae0b2c09|94fd09c7/; // 本插件自己的元会话不算

const CLAIMS = {
  '无权限': /[^。；\n]{0,70}((没有|无|缺少|不具备)[^。；\n]{0,8}权限|权限(不足|受限|不够|被限))[^。；\n]{0,70}/g,
  '沙箱限制': /[^。；\n]{0,70}((被|受)?沙箱[^。；\n]{0,8}(限制|禁止|拦截|不允许|挡住))[^。；\n]{0,70}/g,
  '无法验证类': /[^。；\n]{0,70}(无法(进行)?(验证|测试|调试|截图|预览|实测|运行|实机)|不能(验证|测试|调试|截图)|没法(验证|测试|调试|截图))[^。；\n]{0,70}/g,
  '推给用户': /[^。；\n]{0,70}((需要|请|得|只能|麻烦)(你|您|用户)(自己)?[^。；\n]{0,10}(检查|确认|看看|验证|运行|测试|试一下|截图))[^。；\n]{0,70}/g,
  '缺能力': /[^。；\n]{0,70}(我(没有|不具备)[^。；\n]{0,10}(工具|能力|手段|权限))[^。；\n]{0,70}/g,
};
const SHOT_ARG = /--screenshot|msedge|chrome\.exe|playwright|puppeteer|--headless/i;
const SHOT_TOOL = /^(read_image|mcp__godot-ai__editor_screenshot|editor_screenshot)$/;
const EXEC_TOOL = /^(pwsh|bash|shell|run_code|workflow)$/;

const files = [];
(function walk(d, depth) {
  if (depth > 3) return;
  let es = [];
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/^session.*\.jsonl\.zst/.test(e.name)) files.push({ p, sid: path.basename(d), m: fs.statSync(p).mtimeMs });
  }
})(ROOT, 0);
files.sort((a, b) => b.m - a.m);
const targets = files.filter((f) => !SKIP.test(f.sid)).slice(0, N);

const textOfMessage = (msg) => {
  const parts = [];
  const push = (c) => {
    if (typeof c === 'string') { parts.push(c); return }
    if (Array.isArray(c)) { for (const b of c) push(b); return }
    if (c && typeof c === 'object') {
      if (typeof c.text === 'string' && c.type !== 'tool-result') parts.push(c.text);
      if (c.content !== undefined && c.content !== c) push(c.content);
    }
  };
  push(msg && msg.content);
  return parts.join('\n').trim();
};
const last = (evts, type) => { for (let i = evts.length - 1; i >= 0; i--) if (evts[i].type === type) return evts[i].data; return null };

console.log(`最近 ${targets.length} 个会话（已排除本插件的元会话）\n`);
console.log('时间            档位                    条目  执行  真截图  看图  断言(条)   首句摘要');
console.log('─'.repeat(140));
const agg = { sessions: 0, withClaim: 0, claimAndNoShot: 0, execNoShot: 0, none: 0 };
const quotes = [];
for (const f of targets) {
  let evts = [];
  try { evts = decodeAll(f.p).text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { continue }
  const mode = last(evts, 'sandbox/mode');
  const pol = last(evts, 'approval/policy');
  const assistant = [];
  const calls = [];
  for (const e of evts) {
    if (e.type === 'assistant/message') { const t = textOfMessage(e.data && e.data.message); if (t) assistant.push(t) }
    else if (e.type === 'tool/call') calls.push({ name: String((e.data && e.data.name) || '?'), args: String((e.data && e.data.arguments) || '') });
  }
  const all = assistant.join('\n');
  const shots = calls.filter((c) => SHOT_TOOL.test(c.name) || SHOT_ARG.test(c.args));
  const views = calls.filter((c) => c.name === 'read_image');
  const execs = calls.filter((c) => EXEC_TOOL.test(c.name));
  const hits = {};
  for (const [label, re] of Object.entries(CLAIMS)) {
    const g = new RegExp(re.source, 'g'); let m; let c = 0;
    while ((m = g.exec(all))) {
      if (c < 4) quotes.push({ sid: f.sid, when: new Date(f.m).toISOString().slice(0, 16), mode: `${badge(mode)}+${pol ? pol.policy : '?'}`, label, text: m[0].replace(/\s+/g, ' ').trim().slice(0, 220), shots: shots.length });
      if (++c >= 3) break;
    }
    if (c) hits[label] = c;
  }
  const nClaims = Object.values(hits).reduce((a, b) => a + b, 0);
  agg.sessions++;
  if (nClaims) agg.withClaim++;
  if (nClaims && shots.length === 0 && execs.length > 0) agg.claimAndNoShot++;
  if (execs.length === 0 && assistant.length > 0) agg.none++;
  if (execs.length > 0 && shots.length === 0 && views.length === 0) agg.execNoShot++;
  const firstLine = (assistant[0] || '').replace(/\s+/g, ' ').slice(0, 40);
  console.log(
    new Date(f.m).toISOString().slice(5, 16).replace('T', ' ').padEnd(15) +
    `${badge(mode)}+${pol ? pol.policy : '?'}`.padEnd(24) +
    String(assistant.length).padStart(4) + String(execs.length).padStart(6) + String(shots.length).padStart(8) + String(views.length).padStart(6) +
    String(nClaims || '').padStart(8) + '   ' + firstLine,
  );
}
function badge(mode) { return mode ? mode.mode : '?' }
console.log('─'.repeat(140));
console.log(`会话 ${agg.sessions}｜有断言 ${agg.withClaim}｜"有断言但一次截图都没有(且真跑过命令)" ${agg.claimAndNoShot}｜"跑过命令但没截图" ${agg.execNoShot}｜"只说不做(零命令)" ${agg.none}`);
if (quotes.length) {
  console.log('\n—— 断言原文（最多 24 条）——');
  for (const q of quotes.slice(0, 24)) console.log(`[${q.when} ${q.mode} 截图${q.shots}次] (${q.label}) ${q.text}`);
}
