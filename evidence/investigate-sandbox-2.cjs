// 「沙箱限制」根因取证（第二部分）：node evidence/investigate-sandbox-2.cjs
//   ① 统计各会话的权限档位（read-only / workspace-write / danger-full-access）与审批模式 → 分布
//   ② 我们插件的活跃提示词里有没有"沙箱/无法验证"的措辞与**合法出口**（模型会挑出口走）
//   ③ 用户的 profile 里到底有没有"截图/浏览器"能力（MCP 配置、preset 工具面）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const APPDATA = process.env.APPDATA || '';
const DSH = path.join(APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh');

// ① 会话权限分布
const projDir = path.join(HOME, 'storages', 'session_projcache', 'sessions');
const modes = {};
const approvals = {};
let sessions = 0;
for (const f of (fs.existsSync(projDir) ? fs.readdirSync(projDir) : [])) {
  if (!f.endsWith('.json')) continue;
  let t = '';
  try { t = fs.readFileSync(path.join(projDir, f), 'utf8') } catch { continue }
  sessions += 1;
  const m = /"sandbox"\s*:\s*"([^"]+)"/.exec(t);
  const a = /"approval"\s*:\s*"([^"]+)"/.exec(t);
  const key = m ? m[1] : '(无记录)';
  modes[key] = (modes[key] || 0) + 1;
  const ak = a ? a[1] : '(无记录)';
  approvals[ak] = (approvals[ak] || 0) + 1;
}
console.log('① 会话权限档位分布（共 ' + sessions + ' 个会话投影）');
for (const [k, v] of Object.entries(modes).sort((x, y) => y[1] - x[1])) console.log('   sandbox=' + k.padEnd(20) + v + ' 个');
for (const [k, v] of Object.entries(approvals).sort((x, y) => y[1] - x[1])) console.log('   approval=' + k.padEnd(19) + v + ' 个');

// ② 我们插件的提示词里，哪些字面会传到下游 / 给模型"出口"
console.log('\n② 本插件提示词里的相关措辞');
const ours = path.join(__dirname, '..', 'lib');
const pats = [
  ['沙箱', /沙箱/],
  ['"无法/不能"类出口', /(无法(测试|调试|截图|验证)|不能(测试|验证)|未在真实媒介验证)/],
  ['只读/不写盘/不执行命令（写给优化器的约束，可能被搬进产物）', /(只读[，,、]?\s*不写盘|不写盘|不执行有副作用的命令)/],
  ['验收/截图要求', /(截图|实机|真实浏览器|真的运行)/],
];
for (const [label, re] of pats) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p) } };
  walk(ours);
  let hits = 0; const where = [];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const n = (t.match(new RegExp(re.source, 'g')) || []).length;
    if (n) { hits += n; where.push(path.basename(f) + '×' + n) }
  }
  console.log('   ' + (hits ? '●' : '○') + ' ' + label.padEnd(48) + hits + (where.length ? '   ' + where.join(' ') : ''));
}

// ③ 用户的 profile：有没有浏览器/截图能力（MCP、浏览器后端）
console.log('\n③ profile 里有没有"实机截图"能力');
const profDir = path.join(HOME, 'profiles');
const cfgFiles = [];
for (const p of fs.existsSync(profDir) ? fs.readdirSync(profDir) : []) {
  const d = path.join(profDir, p);
  for (const name of ['cordis.yml', 'cordis.yaml', 'cordis.patch.yml', 'package.json', 'settings.yaml']) {
    const f = path.join(d, name);
    if (fs.existsSync(f)) cfgFiles.push(f);
  }
}
const userSettings = path.join(HOME, 'settings.yaml');
if (fs.existsSync(userSettings)) cfgFiles.push(userSettings);
const want = /(playwright|puppeteer|chrome-devtools|stagehand|computer-use|cua|screenshot|browser|mcp)/i;
let anyAbility = false;
for (const f of cfgFiles) {
  let t = ''; try { t = fs.readFileSync(f, 'utf8') } catch { continue }
  const lines = t.split('\n').filter((L) => want.test(L)).slice(0, 8);
  if (lines.length) { anyAbility = true; console.log('   ● ' + path.relative(HOME, f)); for (const L of lines) console.log('       ' + L.trim().slice(0, 130)) }
}
if (!anyAbility) console.log('   ○ 没有任何浏览器/截图/MCP 配置 —— 下游只能靠"自己起进程"，而那正受沙箱分档限制');

// ④ PTC preset 的工具面与环境（PTC 是最可能的执行体）
console.log('\n④ PTC preset 的工具面');
const presets = path.join(DSH, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets');
if (fs.existsSync(presets)) {
  for (const p of fs.readdirSync(presets)) {
    const d = path.join(presets, p);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      let t = ''; try { t = fs.readFileSync(full, 'utf8') } catch { continue }
      const tools = (t.match(/^\s*-\s*([a-z_]+)\s*$/gm) || []).map((s) => s.trim().replace(/^-\s*/, '')).filter((s) => /^(shell|pty|read|write|edit|glob|grep|run_code|browser|screenshot|subagent|ask_user_question|web_fetch|web_search)/.test(s));
      if (tools.length) console.log('   ' + p + '/' + f + ' 工具：' + [...new Set(tools)].join(', '));
    }
  }
}
