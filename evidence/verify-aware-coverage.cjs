// 「不可自知信息覆盖」检查 —— 替代"数条目 / 数 token"的粗糙判据
//   node evidence/verify-aware-coverage.cjs          # 用 delivery-ab.json 里 10 题 chat/ptc 配对
//   node evidence/verify-aware-coverage.cjs --run     # 用 /runs 里最近一次运行的产出（真实项目跑完可直接用）
//
// 原则：**省掉"下游自己就能生成"的（SQL 模板、通用命令、命名），保住"下游无法自知"的。**
// 后者恰好三类，缺任何一类都会引发往返或猜错：
//   A 项目位置   ：要动的地方（路径 / 文件 / 函数 / 节点 / 配置键）
//   B 老板未定的决定：显式的「按 X 理解」式声明（不让下游自行拍板）
//   C 可机器判定的判据：验收 / 算对的标准（下游能在自己的程序里自检）
// 判定口径：**按类contains**（ptc 里这三类都在即算覆盖达标），不要求与另一形态逐 token 相同。
const fs = require('node:fs');
const path = require('node:path');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';

const A_POS = /`[^`\n]{2,60}`|[A-Za-z0-9_\-./]+\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|md|gd|tscn|tres|cs|prefab|unity|sql|py|sh|toml|cfg|ini)|(?:函数|节点|字段|列|表|模块|路由|组件|场景|入口)\s*[：:，,、]?\s*[`「]?[A-Za-z_\u4e00-\u9fff]{2,24}/g;
const B_DECIDE = /按[「『"'][^，。；\n]{2,40}[」』"']?理解|按最保守|注明「按|按\s*[Xx]\s*理解|如无把握|拿不准就/g;
const C_CRIT = /判据|验收|算对的标准|通过条件|完成标准|可机器判定|逐字节|退出码|可解析/g;
const C_NUM = /[0-9]+\s*(?:秒|度|米|厘米|%|字|条|个|次|px|ms|帧|行|列|KB|MB)/g;
const count = (t, re) => (t.match(re) || []).length;

function score(text, label) {
  const t = String(text || '');
  const a = count(t, A_POS), b = count(t, B_DECIDE), c = count(t, C_CRIT), cn = count(t, C_NUM);
  // C 类：判据词 **或** 至少两个数值断言（"45° 坡上静止 2 秒不漂" 本身就是可机器判定的判据，只是不带"判据"二字）
  const cls = { A: a > 0, B: b > 0, C: c > 0 || cn >= 2 };
  // B 类（歧义声明）是**条件性**的：没有歧义就不该有声明 → 不参与通过/失败判定，只逐行显示并在末尾提示人工确认
  const ok = cls.A && cls.C;
  console.log('  ' + label.padEnd(26) + ' 长度=' + String(t.length).padStart(5) + '  A位置=' + String(a).padStart(3) + '  B歧义声明=' + String(b).padStart(2) + '  C判据=' + String(c).padStart(2) + '+数值' + String(cn).padStart(2) + '  ' + (ok ? '✓ A/C 齐备' : '✗ 缺 ' + ['A', 'C'].filter((k) => !cls[k]).join('/')));
  return { label, chars: t.length, A: a, B: b, C: c, Cnum: cn, cls, ok };
}

(async () => {
  const rows = [];
  if (process.argv.includes('--run')) {
    const j = await (await fetch(API + '/runs')).json();
    const r = (j.runs || [])[0];
    if (!r) { console.log('（/runs 为空：先在真实会话里跑一次优化）'); process.exit(0); }
    console.log('=== 最近一次运行（真实项目跑完直接看这段）===');
    console.log('  run=' + r.id + '  tier=' + r.tier + '  status=' + r.status + '  delivery=' + JSON.stringify(r.delivery) + '  readTools=' + r.readTools + '  effortSent=' + JSON.stringify(r.effortSent));
    rows.push(score(r.text, 'run ' + r.id + '（正文前 4000 字）'));
    console.log('');
    console.log('注意：/runs 的 text 截断在 4000 字符，仅供快速判读；要全文请看浮层或产出原件。');
  } else {
    const ab = JSON.parse(fs.readFileSync(path.join(__dirname, 'delivery-ab.json'), 'utf8'));
    const byTask = (m) => Object.fromEntries((ab.modes[m].cells || []).map((c) => [c.taskId, String(c.command || '')]));
    const chat = byTask('chat'); const ptc = byTask('ptc');
    console.log('=== 10 题配对：三类不可自知信息是否都在 ===');
    let lost = 0;
    for (const id of Object.keys(chat)) {
      if (!ptc[id]) continue;
      const c = score(chat[id], id + ' / chat');
      const p = score(ptc[id], id + ' / ptc');
      rows.push(c, p);
      const dropped = ['A', 'C'].filter((k) => c.cls[k] && !p.cls[k]);
      if (dropped.length) { lost++; console.log('      ⚠ chat 有而 ptc 缺的类：' + dropped.join('/')); }
    }
    console.log('');
    console.log('合计：ptc 缺类的题 = ' + lost + '/' + Object.keys(chat).length);
  }
  const bad = rows.filter((r) => !r.ok);
  const bMissing = rows.filter((r) => /ptc/.test(r.label) && !r.cls.B);
  console.log('判定：' + (bad.length === 0 ? 'A（位置）与 C（判据）覆盖齐备 ✓ —— 条目多寡不参与判定' : '❌ ' + bad.length + ' 条缺 A/C（见上）'));
  console.log('提示：B（歧义声明）是条件性的（没有歧义就不该有），' + bMissing.length + ' 条 ptc 产出不含该声明 —— 是否属于"该声明而没声明"，需人工看那几题是否真有歧义。');
  fs.writeFileSync(path.join(__dirname, 'aware-coverage.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  console.log('WROTE evidence/aware-coverage.json');
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
