// 删除 EN_TEXT 里的死条目（代码里无 L()/Lf() 字面量引用的条目）：node evidence/prune-i18n-dead.cjs [--write]
// 安全保证：删除前**重新扫描**代码区，任何一条若被引用则拒绝删除并整体不写。
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'lib', 'client.js');
const src = fs.readFileSync(file, 'utf8');
const write = process.argv.includes('--write');

const start = src.indexOf('const EN_TEXT = {');
const end = src.indexOf('\n};', start);
if (start < 0 || end < 0) { console.error('未找到 EN_TEXT 区'); process.exit(1); }
const head = src.slice(0, start);
const dict = src.slice(start, end + 3);
const tail = src.slice(end + 3);

// 代码区（去掉词典）里所有按字面量使用的键
const CJK = /[\u4e00-\u9fff]/;
const used = new Set();
const re = /\bLf?\(\s*"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(head + tail)) !== null) { const k = m[1].replace(/\\"/g, '"'); if (CJK.test(k)) used.add(k); }

const DEAD = [
  '优化失败', '优化未产出内容', '关闭窗口', '拖拽可移动窗口', '按 Enter 发送',
  '未收到产出', '模型目录不可用', '轨迹', '（只读）', '（当前模型默认：',
];

const lines = dict.split('\n');
const keep = [];
const removed = [];
const refused = [];
for (const line of lines) {
  const mm = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"/);
  const key = mm ? mm[1].replace(/\\"/g, '"') : null;
  if (key && DEAD.indexOf(key) >= 0) {
    if (used.has(key)) { refused.push(key); keep.push(line); continue; }
    removed.push(key);
    continue;
  }
  keep.push(line);
}
console.log('待删条目：' + removed.length + '/' + DEAD.length + (refused.length ? '；被引用而拒绝删除：' + JSON.stringify(refused) : ''));
for (const k of removed) console.log('  − "' + k + '"');
if (refused.length) { console.log('拒绝写入（有条目仍被代码引用）'); process.exit(2); }
if (!write) { console.log('\n干跑；加 --write 实际删除'); process.exit(0); }
fs.writeFileSync(file, head + keep.join('\n') + tail, 'utf8');
console.log('\n已写入 ✓');
