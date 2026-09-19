// 「沙箱限制/无法测试」取证：node evidence/investigate-sandbox-claims.cjs [maxHits]
// 三个来源一起扫，看这句话到底是谁说的：
//   ① 真实会话投影（~/.dsh/storages/session_projcache/sessions/*.json，明文 JSON）—— 下游 AI 自己写的原话
//   ② DSH 安装内的提示词/preset（它自己灌输给模型的约束）
//   ③ 我们插件的提示词（我们是否无意中把"只读/不写盘/不执行"灌给了下游）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const MAX = Number(process.argv[2] || 24);
const PAT = /(沙箱|sandbox|无法(测试|调试|截图|验证|实机)|权限(不足|受限|不允许)|不允许执行|不能执行(命令|脚本)|no permission|permission denied|blocked by|restricted)/i;

function walk(dir, out, depth, exts) {
  if (!dir || depth > 6) return out;
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' || depth === 0) walk(p, out, depth + 1, exts) }
    else if (!exts || exts.test(e.name)) out.push(p);
  }
  return out;
}

function scan(files, source, hits) {
  for (const f of files) {
    let t = '';
    try { t = fs.readFileSync(f, 'utf8') } catch { continue }
    if (!PAT.test(t)) continue;
    const re = new RegExp(PAT.source, 'gi');
    let m; let n = 0;
    while ((m = re.exec(t)) && n < 4) {
      n += 1;
      const a = Math.max(0, m.index - 170);
      const ctx = t.slice(a, m.index + 170).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
      hits.push({ source, file: path.relative(HOME, f), ctx });
      if (hits.length >= MAX * 3) return;
    }
  }
}

const hits = [];
// ① 真实会话投影
const projDir = path.join(HOME, 'storages', 'session_projcache', 'sessions');
scan(walk(projDir, [], 0, /\.json$/), '会话投影', hits);
// ② DSH 安装（preset 提示词、内置包文案）
const dsh = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh');
const presetFiles = walk(path.join(dsh, 'node_modules', '@deepseek-ai', 'dsh-agent-presets'), [], 0, /\.(yml|yaml|md|js)$/);
scan(presetFiles, 'DSH preset', hits);
// ③ 我们插件的提示词
const ours = walk(path.join(__dirname, '..', 'lib'), [], 0, /\.js$/);
scan(ours, '本插件', hits);

const bySource = {};
for (const h of hits) bySource[h.source] = (bySource[h.source] || 0) + 1;
console.log('命中统计：' + JSON.stringify(bySource));
console.log('');
let shown = 0;
for (const src of ['会话投影', 'DSH preset', '本插件']) {
  const list = hits.filter((h) => h.source === src);
  if (!list.length) continue;
  console.log('════ ' + src + '（' + list.length + ' 条）════');
  for (const h of list.slice(0, MAX)) {
    console.log('  · [' + h.file + ']');
    console.log('    ' + h.ctx.slice(0, 330));
    shown += 1;
  }
  console.log('');
}
console.log('共展示 ' + shown + ' 条（上限 ' + (MAX * 3) + '）');
