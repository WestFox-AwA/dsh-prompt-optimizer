// 中英条目一一对应审计：node evidence/verify-i18n-parity.cjs
// 做两件事：
//   ① 漏译：渲染代码里 L("…") / Lf("…") 用到的中文字面量，EN_TEXT 里**没有**对应条目（英文界面会漏出中文）
//   ② 孤儿：EN_TEXT 里有条目、但渲染代码里**从未**按字面量使用（改文案后的残留）
// 退出码：① 非空 = 2（漏译必须修）；仅 ② 非空 = 0（孤儿只提示，动态拼接会有误报）
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
const unesc = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const CJK = /[\u4e00-\u9fff]/;

// EN_TEXT 区
const start = src.indexOf('const EN_TEXT = {');
const end = src.indexOf('\n};', start);
if (start < 0 || end < 0) { console.error('未找到 EN_TEXT 区'); process.exit(1); }
const dict = new Map();
for (const line of src.slice(start, end).split('\n')) {
  const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/);
  if (m) dict.set(unesc(m[1]), unesc(m[2]));
}

// 渲染代码里按字面量使用的 L()/Lf() 键（排除 EN_TEXT 区本身）
const code = src.slice(0, start) + src.slice(end);
const used = new Set();
const re = /\bLf?\(\s*"((?:[^"\\]|\\.)*)"/g;
let m2;
while ((m2 = re.exec(code)) !== null) { const k = unesc(m2[1]); if (CJK.test(k)) used.add(k); }

const missing = [...used].filter((k) => !dict.has(k)).sort();
const orphan = [...dict.keys()].filter((k) => !used.has(k)).sort();

console.log('EN_TEXT 条目数 = ' + dict.size + '；渲染代码里按字面量使用的键 = ' + used.size);
console.log('');
console.log('① 漏译（用了但没有英文条目）：' + missing.length);
for (const k of missing) console.log('   ✗ "' + k + '"');
console.log('');
console.log('② 孤儿条目（有条目但代码里未按字面量使用）：' + orphan.length);
for (const k of orphan) console.log('   · "' + k + '"  →  ' + JSON.stringify(dict.get(k)).slice(0, 70));
console.log('');
console.log(missing.length === 0 ? '判定：无漏译 ✓' : '判定：❌ ' + missing.length + ' 条漏译（英文界面会漏出中文）');
process.exit(missing.length === 0 ? 0 : 2);
