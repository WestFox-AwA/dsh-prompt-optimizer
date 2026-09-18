// 覆盖检验 v2（分类版）：node evidence/inspect-coverage.cjs
// v1 只数"引用 token 少了多少"，结果 83.6% 缺失——但抽查发现混着三类东西：
//   ① 探索候选清单（"在 package.json/tsconfig.json/… 里找路径别名"）② 引擎探测清单（Unity/Unreal/Godot 各自路径）
//   ③ 对话污染（产出里出现 "ptc / 自动 → chat / 形态" 这类来自我们这段开发对话的词）
// 所以 v2 按"引用所在那一行"分类：**改动类**行里的引用丢了才是真覆盖损失；探索类丢了只是换了探测方式。
const fs = require('node:fs');
const path = require('node:path');
const ab = JSON.parse(fs.readFileSync(path.join(__dirname, 'delivery-ab.json'), 'utf8'));
const byTask = (m) => Object.fromEntries((ab.modes[m].cells || []).map((c) => [c.taskId, String(c.command || '')]));
const chat = byTask('chat'); const ptc = byTask('ptc');
const REF = /`([^`\n]{2,60})`|[A-Za-z0-9_\-./]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|md|gd|tscn|tres|cs|prefab|unity|sql|py|sh|toml|cfg|ini)/g;
const EXPLORE = /检查|查找|搜索|列出|定位|确认是否存在|读取|读一遍|读一次|看看|探查|勘察|grep|find |ls |扫描|收集/;
const CHANGE = /改为|改成|新增|删除|替换|重命名|补上|加上|迁移|写成|实现|调整|修正|回填|改成|接上/;
function refsWithLine(t) {
  const out = new Map();
  for (const line of t.split('\n')) {
    const re = new RegExp(REF.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      const raw = (m[1] || m[0]).replace(/[（(].*$/, '').replace(/[:：].*$/, '').trim();
      if (raw.length < 2) continue;
      const kind = CHANGE.test(line) && !EXPLORE.test(line) ? 'change' : (EXPLORE.test(line) ? 'explore' : 'other');
      if (!out.has(raw) || kind === 'change') out.set(raw, kind);
    }
  }
  return out;
}
const ids = Object.keys(chat).filter((k) => ptc[k]);
let tot = { change: 0, explore: 0, other: 0 }, miss = { change: 0, explore: 0, other: 0 };
const changeMissExamples = [];
for (const id of ids) {
  const c = refsWithLine(chat[id]); const p = refsWithLine(ptc[id]);
  const pset = new Set(p.keys());
  for (const [ref, kind] of c) {
    tot[kind] += 1;
    if (!pset.has(ref)) { miss[kind] += 1; if (kind === 'change') changeMissExamples.push(id + ' :: ' + ref); }
  }
}
console.log('分类              chat 引用    ptc 里缺失    缺失率');
for (const k of ['change', 'explore', 'other']) {
  const label = k === 'change' ? '改动类（真覆盖）' : k === 'explore' ? '探索类（探测方式）' : '其它（目标/验收等）';
  console.log('  ' + label.padEnd(20) + String(tot[k]).padStart(8) + String(miss[k]).padStart(12) + '    ' + String(Math.round((miss[k] / Math.max(1, tot[k])) * 1000) / 10) + '%');
}
console.log('');
console.log('改动类里被丢掉的引用（真覆盖损失候选，全部列出，前 40 条）：');
if (changeMissExamples.length === 0) console.log('  （无）');
for (const x of changeMissExamples.slice(0, 40)) console.log('   − ' + x);
console.log('');
console.log('判读：改动类缺失率高 ⇒ ptc 形态真的在丢"要改哪里"（判据方向 B）；低 ⇒ 条目变少主要是合并与换探测方式（方向 A）。');
fs.writeFileSync(path.join(__dirname, 'coverage-diff.json'), JSON.stringify({ at: new Date().toISOString(), totals: tot, missing: miss, changeMissExamples }, null, 1));
console.log('WROTE evidence/coverage-diff.json');
