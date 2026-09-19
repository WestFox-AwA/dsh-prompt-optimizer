// 诊断"着色器编译失败: 'layout' : syntax error"的根因（只读原文件，改动只写临时副本）
//   node evidence/diagnose-shader-bug.cjs <html路径> [--patch-out <输出路径>]
const fs = require('node:fs');
const path = require('node:path');

const src = process.argv[2];
if (!src) { console.log('用法: node diagnose-shader-bug.cjs <html> [--patch-out out.html]'); process.exit(1) }
const outIdx = process.argv.indexOf('--patch-out');
const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null;
const text = fs.readFileSync(src, 'utf8');

// ① 取出所有 <script id="..." type="x-shader/..."> 块，看它们的 textContent 实际以什么开头
const blocks = [];
const re = /<script\s+id="([^"]+)"[^>]*type="x-shader\/[^"]*"[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(text))) {
  const body = m[2];
  blocks.push({
    id: m[1],
    firstChar: JSON.stringify(body.slice(0, 1)),
    indexOfCommon: body.indexOf('//@common'),
    startsWithCommonAfterTrim: /^\s*\/\/@common/.test(body),
    hasVersion: /#version\s+300\s+es/.test(body),
    versionLine: body.split('\n').findIndex((l) => /#version\s+300\s+es/.test(l)),
    lines: body.split('\n').length,
  });
}
console.log(`着色器块 ${blocks.length} 个（${path.basename(src)}）`);
console.log('id                       首字符  indexOf("//@common")  去空白后以//@common开头  含#version300  行数');
for (const b of blocks) {
  console.log(
    b.id.padEnd(24) + b.firstChar.padEnd(7) + String(b.indexOfCommon).padStart(18) + String(b.startsWithCommonAfterTrim).padStart(24) + String(b.hasVersion).padStart(15) + String(b.lines).padStart(6),
  );
}

// ② 定位拼接逻辑本身
const splice = /if\s*\(\s*([A-Za-z_$][\w$]*)\.indexOf\('\/\/@common'\)\s*===\s*0\s*\)/.exec(text);
console.log('\n拼接代码:', splice ? splice[0] : '（没找到 indexOf(\'//@common\') === 0 这种写法）');
if (splice) {
  const varName = splice[1];
  const bad = blocks.filter((b) => b.indexOfCommon === 1 && !b.startsWithCommonAfterTrim);
  console.log(`变量 ${varName} 的 textContent 以换行开头 → indexOf 返回 ${bad.length ? bad[0].indexOfCommon : '?'}，=== 0 永远不成立 → 公共块（含 #version 300 es）从不拼接`);
  console.log(`受影响的块: ${blocks.filter((b) => b.indexOfCommon > 0).map((b) => b.id).join(', ') || '（无）'}`);
  console.log(`这些块自己不含 #version 300 es: ${blocks.filter((b) => b.indexOfCommon > 0 && !b.hasVersion).length} / ${blocks.filter((b) => b.indexOfCommon > 0).length}`);
}

// ③ 补丁（两个坑一起修；只写副本，绝不改原文件）：
//    坑 1：块首是换行 → `indexOf('//@common') === 0` 永不成立 → 公共块从不拼接（无 #version）
//    坑 2：公共块自己也以换行开头 → 拼上去后 `#version` 落在第 2 行 → ANGLE 报
//          "#version directive must occur on the first line of the shader"（修好坑 1 后立刻撞上它）
if (outPath) {
  const before = text;
  let patched = text;
  // 该函数整体替换：容忍前导空白 + 拼接后保证 #version 在第一行
  patched = patched.replace(
    /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*bEl\(\2\);\s*if\s*\(!\3\)\s*return\s+null;\s*var\s+([A-Za-z_$][\w$]*)\s*=\s*\3\.textContent;\s*if\s*\(\4\.indexOf\('\/\/@common'\)\s*===\s*0\)\s*\4\s*=\s*([A-Za-z_$][\w$]*)\s*\+\s*'\\n'\s*\+\s*\4\.slice\(9\);\s*return\s+\4;\s*\}/,
    (all, fn, arg, el, s, common) =>
      'function ' + fn + '(' + arg + ') {\n'
      + '  var ' + el + ' = bEl(' + arg + ');\n'
      + '  if (!' + el + ') return null;\n'
      + '  var ' + s + ' = String(' + el + '.textContent || "").replace(/^\\s+/, "");\n'
      + '  if (' + s + '.indexOf("//@common") === 0) ' + s + ' = String(' + common + ' || "").replace(/^\\s+/, "") + "\\n" + ' + s + '.slice(9);\n'
      + '  return ' + s + '.replace(/^\\s+/, "");\n'
      + '}',
  );
  // 公共块赋值处也顺手去空白（双保险）
  patched = patched.replace(
    /([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\?\s*\2\.textContent\s*:\s*''/g,
    (all, lhs, el) => `${lhs} = ${el} ? String(${el}.textContent || '').replace(/^\\s+/, '') : ''`,
  );
  console.log('\n补丁 1（容错拼接 + 保证 #version 首行）:', patched !== before ? '已应用 ✓' : '✗ 没匹配到');
  const trimmed = patched !== before;
  if (trimmed) {
    fs.writeFileSync(outPath, patched, 'utf8');
    console.log('已写出副本:', outPath, `(${(patched.length / 1024).toFixed(0)} KB)`);
  }
}
