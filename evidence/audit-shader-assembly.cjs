// 着色器拼装审计：把"运行时拼 GLSL"这一类 bug 一次性查清（只读）
//   node evidence/audit-shader-assembly.cjs <html> [--common <id>] [--blocks a,b]
// 查三件事（本次实测的三层坑，全都在同一套"共享块 + 运行时拼接"方案里）：
//   ① 拼接判据是否被**前导换行**打掉（`textContent.indexOf('//@common') === 0` 对 <script> 块永远不成立）
//   ② 拼好后 `#version` 是否落在**第一行**（ANGLE 硬性要求；公共块自己带换行就会踩）
//   ③ 顶点着色器里是否混进了**只有片元能用**的内建函数（fwidth / dFdx / dFdy / gl_FragCoord…）
const fs = require('node:fs');

const file = process.argv[2];
if (!file) { console.log('用法: node audit-shader-assembly.cjs <html>'); process.exit(1) }
const text = fs.readFileSync(file, 'utf8');

const blocks = new Map();
const re = /<script\s+id="([^"]+)"[^>]*type="x-shader\/[^"]*"[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(text))) blocks.set(m[1], m[2]);

const COMMON_ID = (() => {
  const i = process.argv.indexOf('--common');
  if (i > 0) return process.argv[i + 1];
  for (const id of blocks.keys()) if (/common/i.test(id)) return id;
  return null;
})();
const common = COMMON_ID ? blocks.get(COMMON_ID) : '';
const FRAG_ONLY = /\b(fwidth|dFdx|dFdy|gl_FragCoord|discard|gl_FragDepth)\b/;

console.log(`文件: ${file}`);
console.log(`着色器块 ${blocks.size} 个；公共块 = ${COMMON_ID || '（无）'}${common ? `（${common.split('\n').length} 行，首字符 ${JSON.stringify(common[0])}）` : ''}\n`);

const spliceRule = /\.indexOf\('\/\/@common'\)\s*===\s*0/.test(text) ? 'indexOf(...) === 0（对 <script> 块永远不成立）' : '（未识别）';
console.log('拼接判据:', spliceRule);
console.log('正文里的自动拼接写法:', /\.replace\(\/\^\\s\*\\\/\\\/@common/.test(text) ? '已容错前导空白 ✓' : '无\n');

console.log('块 id                    角色  块首字符  含//@common@  自带#version  拼装后#version行  片元专用内建');
const rows = [];
for (const [id, body] of blocks) {
  const role = /-fs$|frag/i.test(id) ? 'fs' : (/vs$|vert/i.test(id) ? 'vs' : '??');
  const willSplice = /^\s*\/\/@common/.test(body);
  const assembled = willSplice
    ? (String(common).replace(/^\s+/, '') + '\n' + body.replace(/^\s+/, '').replace(/^\/\/@common[^\n]*\n?/, ''))
    : body.replace(/^\s+/, '');
  const lines = assembled.split('\n');
  const vline = lines.findIndex((l) => /^\s*#version/.test(l));
  const fragOnly = role === 'vs' ? lines.map((l, i) => (FRAG_ONLY.test(l) ? (i + 1) + ':' + l.trim().slice(0, 46) : null)).filter(Boolean) : [];
  rows.push({ id, role, fragOnly });
  console.log(
    id.padEnd(24) + role.padEnd(6) + JSON.stringify(body.slice(0, 1)).padEnd(10) +
    String(body.indexOf('//@common')).padStart(12) + String(/#version\s+300\s+es/.test(body)).padStart(14) +
    String(vline).padStart(16) + '   ' + (fragOnly.length ? '⚠ ' + fragOnly.slice(0, 3).join(' | ') : '—'),
  );
}

const badVersion = rows.filter((r) => r.role !== '??');
console.log('\n判据：');
console.log(`  ① 前导换行是否打掉拼接：${[...blocks.values()].some((b) => b.indexOf('//@common') === 1) ? '是（indexOf 返回 1，=== 0 不成立）' : '否'}`);
console.log(`  ② 拼装后 #version 是否在第一行：需逐块看上面那列（-1 = 没有；>0 = 不在首行，ANGLE 会直接报错）`);
const fragInVs = rows.filter((r) => r.role === 'vs' && r.fragOnly.length);
console.log(`  ③ 顶点块里混入片元专用内建：${fragInVs.length ? fragInVs.map((r) => r.id).join(', ') : '无'}`);
