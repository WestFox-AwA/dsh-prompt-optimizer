// 把"共享 GLSL 块 + 运行时拼接"这一类文件的三层坑一次修掉（只读原文件，结果写副本）
//   node evidence/fix-shader-assembly.cjs <源 html> <输出 html>
// 三层坑（本次由 evidence/diagnose-shader-bug.cjs + 无头渲染实测确认）：
//   ① 拼接判据 `textContent.indexOf('//@common') === 0` 被**块首换行**打掉 → 公共块（含 #version）从不拼接
//   ② 公共块自己带前导换行 → 拼上去 #version 落到第 2 行 → ANGLE 报 "must occur on the first line"
//   ③ 公共块里混着**只有片元能用**的导数 helper（fwidth/dFdx/dFdy）→ 拼进顶点着色器必编译失败
// 修法：拼接前统一 trim；用 //@fs-only-start/end 包住片元专用段，顶点着色器拼接时剔除该段。
const fs = require('node:fs');

const [, , src, out] = process.argv;
if (!src || !out) { console.log('用法: node fix-shader-assembly.cjs <源 html> <输出 html>'); process.exit(1) }
let text = fs.readFileSync(src, 'utf8');
const before = text;
const steps = [];

// ① + ② 重写 shaderSource（含片元专用段过滤）与 makeProg 调用
const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*bEl\(\2\);\s*if\s*\(!\3\)\s*return\s+null;\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*\3\.textContent;\s*if\s*\(\4\.indexOf\('\/\/@common'\)\s*===\s*0\)\s*\4\s*=\s*([A-Za-z_$][\w$]*)\s*\+\s*'\\n'\s*\+\s*\4\.slice\(9\);\s*return\s+\4;\s*\}/;
let newFn = null;
text = text.replace(fnRe, (all, fn, arg, el, s, common) => {
  newFn = fn;
  steps.push('① 拼接判据容错前导空白 + ② 保证 #version 在第一行 + ③ 顶点着色器剔除片元专用段');
  return `function ${fn}(${arg}, isFrag) {\n`
    + `  var ${el} = bEl(${arg});\n`
    + `  if (!${el}) return null;\n`
    + `  var ${s} = String(${el}.textContent || '').replace(/^\\s+/, '');\n`
    + `  var common = String(${common} || '').replace(/^\\s+/, '');\n`
    + `  if (!isFrag) common = common.replace(/\\/\\/@fs-only-start[\\s\\S]*?\\/\\/@fs-only-end/g, '');\n`
    + `  if (${s}.indexOf('//@common') === 0) ${s} = common + '\\n' + ${s}.slice(9);\n`
    + `  return ${s}.replace(/^\\s+/, '');\n`
    + `}`;
});
if (!newFn) { console.log('✗ 没匹配到 shaderSource 那样的拼接函数'); process.exit(1) }

// 调用点：顶点传 false、片元传 true
text = text.replace(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${newFn}\\(([^,)]+)\\)`, 'g'), (all, lhs, id) => `${lhs} = ${newFn}(${id}, false)`);
text = text.replace(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${newFn}\\(([^,)]+)\\)`, 'g'), (all, lhs, id) => `${lhs} = ${newFn}(${id}, true)`);
// 上面两条会把同一处再改一次，纠正：顶点用 vsId、片元用 fsId（按变量名 heuristics）
text = text.replace(new RegExp(`${newFn}\\(([^,)]+),\\s*false\\)\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*=\\s*${newFn}\\(([^,)]+),\\s*false\\)`, 'g'),
  (all, a, mid, b) => `${newFn}(${a}, false), ${mid} = ${newFn}(${b}, true)`);

// ③ 给片元专用 helper 段加标记（camoColor / cotangentFrame 这类用导数的函数）
const markerStart = '//@fs-only-start 由 fix-shader-assembly.cjs 标注：以下函数只用片元可用的导数（fwidth/dFdx/dFdy）\n';
const markerEnd = '//@fs-only-end\n';
if (!text.includes('//@fs-only-start')) {
  const camo = text.indexOf('vec3 camoColor(');
  if (camo > 0) {
    // 段尾 = cotangentFrame 之后的第一个非导数 helper（perturbNormal）
    const after = text.indexOf('vec3 perturbNormal(', camo);
    if (after > camo) {
      text = text.slice(0, camo) + markerStart + text.slice(camo, after) + markerEnd + '\n' + text.slice(after);
      steps.push('③ 已标注片元专用段（camoColor / cotangentFrame）');
    }
  }
}

const fragOnlyBefore = (text.match(/\bfwidth|dFdx|dFdy/g) || []).length;
fs.writeFileSync(out, text, 'utf8');
console.log('修改步骤：');
for (const s of steps) console.log('  · ' + s);
console.log(`写出: ${out}  (${(text.length / 1024).toFixed(0)} KB，原 ${(before.length / 1024).toFixed(0)} KB，导数出现 ${fragOnlyBefore} 次)`);
