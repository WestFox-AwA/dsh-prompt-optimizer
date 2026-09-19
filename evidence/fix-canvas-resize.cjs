// 修"UI 正常、画面全黑"：canvas 后备缓冲被写成 0×0（先写后算 + 启动时把算好的值又覆盖回 0）
//   node evidence/fix-canvas-resize.cjs <源 html> <输出 html>
// 病灶（tank.html 实测）：
//   resize(){ ... APP.canvas.width=APP.cw; APP.canvas.height=APP.ch; APP.cw=Math.round(w*dpr); ... }
//   —— APP 里根本没有 cw/ch 初值 → 第一次调用把画布设成 0×0，之后才算尺寸；
//   紧接着启动代码又 `APP.cw=APP.canvas.width` 把刚算好的值覆盖回 0。
//   于是 viewport=[0,0,0,0]、后备缓冲永远 0×0：draw call 照跑（263 calls/531k tris），画面必然全黑。
// 修法：先算后写；并把启动处那句"用画布反推 APP.cw"改成用已算好的值。
const fs = require('node:fs');

const [, , src, out] = process.argv;
if (!src || !out) { console.log('用法: node fix-canvas-resize.cjs <源 html> <输出 html>'); process.exit(1) }
let text = fs.readFileSync(src, 'utf8');
const steps = [];

// ① resize()：先算 APP.cw/ch，再写进画布
const resizeRe = /function\s+resize\(\)\s*\{\s*const\s+w=Math\.max\(320,innerWidth\),h=Math\.max\(240,innerHeight\);\s*const\s+dpr=Math\.min\(2,devicePixelRatio\|\|1\);\s*APP\.dpr=dpr;\s*APP\.canvas\.width=APP\.cw;APP\.canvas\.height=APP\.ch;\s*APP\.canvas\.style\.width=w\+"px";APP\.canvas\.style\.height=h\+"px";\s*APP\.cw=Math\.round\(w\*dpr\);APP\.ch=Math\.round\(h\*dpr\);/;
text = text.replace(resizeRe, () => {
  steps.push('① resize()：改为「先算 APP.cw/ch（含 dpr）→ 再写画布尺寸 → 再写样式」');
  return 'function resize(){\n'
    + '  const w=Math.max(320,innerWidth),h=Math.max(240,innerHeight);\n'
    + '  const dpr=Math.min(2,devicePixelRatio||1);\n'
    + '  APP.dpr=dpr;\n'
    + '  APP.cw=Math.round(w*dpr);APP.ch=Math.round(h*dpr);\n'
    + '  APP.canvas.width=APP.cw;APP.canvas.height=APP.ch;\n'
    + '  APP.canvas.style.width=w+"px";APP.canvas.style.height=h+"px";';
});

// ② 启动处：不要再从画布反推（会把 0 写回 APP）
const bootRe = /resize\(\);\s*APP\.cw=APP\.canvas\.width;APP\.ch=APP\.canvas\.height;/;
text = text.replace(bootRe, () => {
  steps.push('② 启动处：删掉「APP.cw=APP.canvas.width」这次反向覆盖（它把刚算好的尺寸写回 0）');
  return 'resize();\n    if(!(APP.cw>8&&APP.ch>8)) throw new Error("画布尺寸异常：" + APP.cw + "x" + APP.ch);';
});

if (!steps.length) { console.log('✗ 没匹配到目标代码（可能已被改过）'); process.exit(1) }
fs.writeFileSync(out, text, 'utf8');
console.log('修改步骤：');
for (const s of steps) console.log('  · ' + s);
console.log(`写出: ${out} (${(text.length / 1024).toFixed(0)} KB)`);
