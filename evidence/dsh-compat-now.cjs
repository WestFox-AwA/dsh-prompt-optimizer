// DSH 接口核对（对**当前安装**，不需要旧版本）：node evidence/dsh-compat-now.cjs [dshRoot]
// 用途：DSH 更新后一条命令回答"我们依赖的接口还在不在"——每条探针给出 命中数 + 样本位置 + 判定。
// 判定：任一探针为 0 命中 → 退出码 2（可以当门禁跑）。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.argv[2] || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh');
if (!fs.existsSync(ROOT)) { console.error('找不到 DSH 安装：' + ROOT); process.exit(1) }

// ① 版本与时间戳（自证"到底是哪一版"）
let version = '?';
try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch { /* ignore */ }
const libDir = path.join(ROOT, 'lib');
const newest = (() => {
  let best = null;
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (!best || fs.statSync(p).mtimeMs > best.mtimeMs) best = { p, mtimeMs: fs.statSync(p).mtimeMs };
    }
  };
  walk(ROOT, 0);
  return best;
})();
console.log('DSH 安装：' + ROOT);
console.log('版本：' + version + '   最新文件：' + (newest ? new Date(newest.mtimeMs).toISOString().slice(0, 16).replace('T', ' ') + '  ' + path.relative(ROOT, newest.p) : '?'));
console.log('');

// ② 我们真实依赖的接口（与 lib/index.js、lib/client.js 一一对应）
const CHECKS = [
  // 宿主侧
  ['宿主', 'webServer.register（HTTP 路由挂载）', /register\s*\(\s*\{|webServer/],
  ['宿主', 'sessions.list / sessions.get', /list\s*\(\s*\)|sessions/],
  ['宿主', 'session.derived（会话投影，观察者上下文的唯一来源）', /derived/],
  ['宿主', 'session.header.cwd / agentPreset（身份层）', /agentPreset|header\s*\.\s*cwd/],
  ['宿主', 'session.ownEvents（历史补种）', /ownEvents/],
  ['宿主', 'llm.stream（优化调用的唯一出口）', /stream\s*\(/],
  ['宿主', 'llm.listProviders（模型目录）', /listProviders/],
  ['宿主', 'llm.resolveModelInfo（思考强度守卫）', /resolveModelInfo/],
  ['宿主', 'agentDefaultModel.currentSelection', /currentSelection/],
  ['宿主', 'settings.register（设置命名空间，schemastery）', /settings|schemastery/],
  ['宿主', 'agents 服务', /agents/],
  ['宿主', 'commands 服务', /commands/],
  // 客户端侧
  ['客户端', 'slots.inject / slots.register（两个挂载点）', /slots\.(inject|register)|register\s*\(\s*\{/],
  ['客户端', 'slot: conversation.input.left', /conversation\.input\.left/],
  ['客户端', 'slot: shell.overlay', /shell\.overlay/],
  ['客户端', 'locale 服务（bind / subscribe）', /bind\s*\(|locale/],
  ['客户端', 'inputActions.setDraft / submit（不改发送链路）', /setDraft/],
  ['客户端', '__DSH_BOOT__（客户端启动载荷）', /__DSH_BOOT__/],
  // 新机制依赖：下游要能"问用户"
  ['ask', '内置 ask 工具（ask_user_question）', /ask_user_question|askUserQuestion/],
];

function walkFiles(dir, out, depth) {
  if (!dir || depth > 6) return out;
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkFiles(p, out, depth + 1) }
    else if (/\.(js|mjs|cjs|ts|json|yml|yaml)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const files = walkFiles(libDir, [], 0);
// DSH 本体是薄壳：真实实现都在它自带的 node_modules/@deepseek-ai/* 里（要**进来扫**，否则一条都命不中）
const nested = path.join(ROOT, 'node_modules', '@deepseek-ai');
if (fs.existsSync(nested)) {
  for (const e of fs.readdirSync(nested, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const pkgRoot = path.join(nested, e.name);
    const out = [];
    walkFiles(pkgRoot, out, 0);
    files.push(...out);
  }
}
const chunks = [];
for (const f of files) { try { chunks.push({ f, t: fs.readFileSync(f, 'utf8') }) } catch { /* skip */ } }
// 客户端 bundle（体积大也要扫：我们依赖 slots / locale / __DSH_BOOT__）
for (const extra of ['apps', 'web', 'public', 'dist']) {
  const d = path.join(ROOT, extra);
  if (fs.existsSync(d)) { const more = walkFiles(d, [], 0); for (const f of more) { try { chunks.push({ f, t: fs.readFileSync(f, 'utf8') }) } catch { /* skip */ } } }
}
console.log('扫描文件数：' + chunks.length + '（含 node_modules/@deepseek-ai/* 的各包实现）');
console.log('');

let risk = 0;
let lastGroup = '';
for (const [group, label, re] of CHECKS) {
  if (group !== lastGroup) { console.log('── ' + group + ' ──'); lastGroup = group }
  let hit = null; let n = 0;
  for (const c of chunks) {
    const m = re.exec(c.t);
    if (m) {
      n += 1;
      if (!hit) {
        const i = c.t.lastIndexOf('\n', m.index) + 1;
        const j = c.t.indexOf('\n', m.index);
        hit = { file: path.relative(ROOT, c.f), line: c.t.slice(i, j < 0 ? m.index + 120 : j).trim().slice(0, 120) };
      }
    }
  }
  const ok = n > 0;
  if (!ok) risk += 1;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(48) + '命中 ' + String(n).padStart(4) + (hit ? '   ' + hit.file + ' | ' + hit.line : '   ⚠ 未命中'));
}
console.log('');
console.log(risk === 0 ? '判定：插件依赖的接口全部在位 ✓（本次 DSH 更新无需改插件）' : '判定：❌ ' + risk + ' 项探针未命中——需要按 DSH-COMPAT.md 的流程核对后再改插件');
process.exit(risk === 0 ? 0 : 2);
