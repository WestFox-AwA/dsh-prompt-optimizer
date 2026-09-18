// 出处审计（SPEC §7 验收 #1）：node evidence/audit-provenance.cjs [runId|--last] [--json]
//
// 判据（机械可查，跨领域通用）：
//   ① 产物里出现的**路径**必须能在"依据索引"里找到（本次真的读到过），否则就是无出处的事实 → 缺陷；
//   ② **事实性断言**（讲项目现状/位置/接口的陈述句）必须带出处（路径、路径:行号、符号名）或「待确认/自由度」标记；
//   ③ 标了「待确认 / 自由度 / 按 X 理解」的条目不算缺陷（那是诚实的不确定，不是假事实）。
// 说明：这是**启发式审计**——它只负责把可疑行挑出来，最终判定由人看这些行做。规则写在输出里，可复算。
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';

// 路径抽取：
//  · Windows 绝对路径：排除 Markdown 标记与标点（反引号/星号/引号会把路径"粘"长，实测导致误判）
//  · 斜杠路径：要求最后一段带扩展名、或任一段含小写字母——否则 `HTML/CSS/JS` 这类**缩写写法**会被当成路径
const PATH_RE = /(?:[A-Za-z]:\\[^\s，。；）)"'`*]+|\/(?:[\w.-]*[a-z][\w.-]*\/)*[\w.-]*[a-z][\w.-]*|\/[\w.-]+\/[\w.-]*\.\w{1,8}|[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|html|css|py|go|rs|java|cs|gd|yml|yaml|toml|sql|sh|ps1)\b)/g;
const LOC_RE = /[\w./\\-]+\.\w{1,8}:\d+/;                       // 路径:行号
const HEDGE_RE = /待确认|自由度|按 .{1,12} 理解|不确定|未读到|没读到|假设/;
// 条件语气：说的是"若已有…则…"，不是对现状的断言（实测误报来源）
const COND_RE = /(若|如果|仅当|如存在|尚无|尚不|不存在|没有|未找到|未读到|不得|无需)/;
// 事实性断言的特征词（讲"现在是什么样"，而不是"要做什么"）
const FACT_RE = /(现状|当前|已有|已存在|位于|所在|入口是|函数是|定义在|写在|实际上是|其实是|依赖|版本是|技术栈)/;

const j = async (u) => { const r = await fetch(u); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };

(async () => {
  const arg = process.argv[2] && process.argv[2].indexOf('--') !== 0 ? process.argv[2] : '--last';
  const list = await j(API + '/runs');
  const runs = (list.runs || []).filter((r) => r.status === 'done' && String(r.text || '').trim());
  if (runs.length === 0) { console.error('没有已完成的运行可审计'); process.exit(1) }
  const run = arg === '--last' ? runs[0] : runs.filter((r) => r.id === arg)[0];
  if (!run) { console.error('找不到 runId=' + arg + '；现有：' + runs.map((r) => r.id).join(', ')); process.exit(1) }

  const text = String(run.text || '');
  const dbg = run.toolLoopDebug || {};
  // 三种依据要分开看：读到内容 / 命中的行 / 只列过目录（只能支撑"存在"，不能支撑"里面写了什么"）
  const readPaths = Array.isArray(dbg.evidencePaths) ? dbg.evidencePaths : [];
  const hitPaths = (Array.isArray(dbg.evidenceHits) ? dbg.evidenceHits : []).map((h) => String(h).replace(/:\d+$/, ''));
  const listedPaths = Array.isArray(dbg.evidenceListed) ? dbg.evidenceListed : [];
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();
  const matcher = (arr) => (p) => {
    const n = norm(p);
    return arr.some((k) => { const kk = norm(k); return kk === n || kk.endsWith('/' + n) || n.endsWith('/' + kk) || kk.indexOf(n) >= 0 });
  };
  const isRead = matcher(readPaths.concat(hitPaths));
  const isListed = matcher(listedPaths);

  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const items = lines.filter((L) => /^([-*•]|\d+[.、)]|#|【)/.test(L) || L.length > 12);
  const mentioned = new Set();
  for (const m of text.match(PATH_RE) || []) mentioned.add(m);

  const noSource = [];      // 无出处的事实性断言
  const unknownPath = [];   // 引用了本次没读到过的路径
  const contentClaim = [];  // 只列过目录、却描述了"里面有什么"（SPEC 明令禁止）
  const CONTENT_WORDS = /(函数|类|方法|变量|导出|实现|代码|样式|逻辑|里面|内部|第\s*\d+\s*行|import|export)/;
  for (const p of mentioned) {
    if (/^https?:/i.test(p) || /^\/\//.test(p)) continue;   // URL / 外部库不算"项目内文件"
    if (!isRead(p) && !isListed(p)) {
      // 否定语境里的提及（"其中没有 tank.html"）不是"凭空出现的事实"，是**由清单得出的缺席结论**
      const negated = items.some((L) => L.indexOf(p) >= 0 && /(没有|不存在|未找到|不含|未见)/.test(L));
      if (!negated) unknownPath.push(p);
    }
  }
  for (const L of items) {
    const hasLoc = LOC_RE.test(L);
    const hasPath = (L.match(PATH_RE) || []).length > 0;
    const hedged = HEDGE_RE.test(L) || COND_RE.test(L);
    if (FACT_RE.test(L) && !hasLoc && !hasPath && !hedged) noSource.push(L);
    // 只列过目录的文件被用来描述内容：判据很保守（同一行里既有该路径、又有"内容词"）
    for (const p of (L.match(PATH_RE) || [])) {
      if (/^https?:/i.test(p)) continue;
      if (isListed(p) && !isRead(p) && CONTENT_WORDS.test(L)) { contentClaim.push({ path: p, line: L.slice(0, 120) }); break }
    }
  }

  console.log('审计对象：' + run.id + '  档位=' + run.tier + '  形态=' + JSON.stringify(run.delivery) + '  策略=' + run.strategy);
  console.log('上下文：' + JSON.stringify(run.observer) + '   历史=' + (run.history ? (run.history.mode + '/' + run.history.userTurns + ' 回合/' + run.history.chars + ' 字') : '无'));
  console.log('依据索引：读到内容 ' + (dbg.evidenceReads || 0) + ' 次  可引用文件 ' + JSON.stringify(readPaths) + '  命中 ' + JSON.stringify((dbg.evidenceHits || []).slice(0, 4)) + '  只列过目录 ' + listedPaths.length + ' 条');
  console.log('产物：' + run.chars + ' 字 / ' + items.length + ' 个条目；提到路径 ' + mentioned.size + ' 个');
  console.log('');
  console.log('① 产物里引用、但本次**既没读过也没列过**的路径（凭空出现的事实）：' + unknownPath.length);
  for (const p of unknownPath.slice(0, 12)) console.log('   ✗ ' + p);
  console.log('② 听起来像"事实"却没有出处、也没标不确定的条目：' + noSource.length);
  for (const L of noSource.slice(0, 12)) console.log('   ✗ ' + L.slice(0, 120));
  console.log('③ 只列过目录、却被用来描述"里面有什么"的行：' + contentClaim.length);
  for (const c of contentClaim.slice(0, 8)) console.log('   ✗ [' + c.path + '] ' + c.line);
  const hedgedCount = items.filter((L) => HEDGE_RE.test(L)).length;
  const located = items.filter((L) => LOC_RE.test(L) || (L.match(PATH_RE) || []).length > 0).length;
  console.log('');
  console.log('统计：带出处条目 ' + located + ' / 标不确定 ' + hedgedCount + ' / 条目总数 ' + items.length);
  const defects = unknownPath.length + noSource.length + contentClaim.length;
  console.log(defects === 0 ? '判定：出处审计通过 ✓（没有无出处的事实）' : '判定：❌ 检出 ' + defects + ' 处疑似无出处（人工看上面的行确认）');
  process.exit(defects === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
