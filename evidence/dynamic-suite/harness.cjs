// 动态试题运行时（防过拟合的一次交付可用率测评）：node evidence/dynamic-suite/harness.cjs <phase> [选项]
//
// 两阶段（因为"执行体"必须是**独立的 agent**，而校验必须由**机械脚本**做，二者不能是同一个东西）：
//   phase1  node harness.cjs phase1 --seed=1234 [--per=1] [--arms=raw,v6e,v6b,v5e] [--tier=extreme]
//           → 生成实例 + 每个 (题, 臂) 一个独立工作目录（含种子文件），把"执行体该看到的唯一一句话"
//             写进 <dir>/command.txt，并产出 dispatch.json（给 agent 编排器读）
//   phase2  node harness.cjs phase2 --batch=<batchId>
//           → 对每个目录跑**机械校验**（跑命令/逐字节比对），出 pass/fail 矩阵与各臂首次通过率
//
// 臂的定义：
//   raw  = 不优化（原话直接给执行体）——**这是基线**，任何优化都必须证明比它好
//   v6e  = 现在这版，极端档      v6b = 现在这版，普通档
//   v5e  = 0.4.x 行为（策略 v5），极端档
// 反过拟合：实例随 --seed 变化；同一批里所有臂跑**同一组实例**（配对对照）；题面家族可留出（--families）。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTasks } = require('./tasks.cjs');

const ROOT = path.join(__dirname, 'batches');
const API = 'http://127.0.0.1:3080/prompt-optimizer/api';
const j = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } };
const post = (p, b) => j(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const arg = (name, dflt) => { const a = process.argv.filter((x) => x.indexOf('--' + name + '=') === 0)[0]; return a ? a.split('=').slice(1).join('=') : dflt };

async function pluginProduct(text, arm, tier, workDir) {
  // 臂 → (策略, 档位, 是否给读工具)：raw 不走插件；其余走 /run，取 run.text（这就是用户会贴出去的那段）
  const plan = {
    v6e: { strategy: 'v6', tier: tier || 'extreme', reads: false },
    v6er: { strategy: 'v6', tier: tier || 'extreme', reads: true },   // + 读仓库（工具根钩子指向本题目录）
    v6a: { strategy: 'v6', tier: 'advanced', reads: false },
    v6ar: { strategy: 'v6', tier: 'advanced', reads: true },
    v6b: { strategy: 'v6', tier: 'basic', reads: false },
    v5e: { strategy: 'v5', tier: tier || 'extreme', reads: false },
    v011e: { strategy: 'v011-ptc', tier: tier || 'extreme', reads: false },
  }[arm];
  if (!plan) return { text, source: 'raw' };
  await post('/state', { strategy: plan.strategy, delivery: null });
  const body = { request: text, tier: plan.tier, readTools: plan.reads, turns: 0, historyMode: 'turns' };
  // 读仓库的臂：用**显式工具根钩子**把只读工具指向本题目录（不是猜会话——外面明确给的根，/runs 会留痕）
  if (plan.reads && workDir) body.toolRoot = workDir;
  const r = await post('/run', body);
  const id = r.runId || r.id;
  if (!id) return { text, source: 'raw(fallback: 启动失败 ' + JSON.stringify(r).slice(0, 80) + ')' };
  for (let i = 0; i < 300; i += 1) {
    await new Promise((s) => setTimeout(s, 1000));
    const rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') {
      return { text: String(rec.text || ''), source: arm + '(' + plan.strategy + '/' + plan.tier + (plan.reads ? '/reads' : '') + ')', chars: rec.chars, gate: rec.lengthGate || null, status: rec.status, toolCalls: rec.toolCalls || 0, toolRootSource: rec.toolRootSource || null };
    }
  }
  return { text, source: 'raw(fallback: timeout)' };
}

/**
 * 一次性执行体的输入包：**指令 + 仓库快照（按预算截断）**。
 *   · 各臂只差在"指令"那一段，仓库部分逐字节相同；
 *   · `dumpChars` 模拟真实下游的**上下文预算**：超预算就按体积从大到小丢文件、再按剩余额度截断——
 *     这正是"brief 决定下游能看到什么"的地方（brief 里写了的关键事实，即使快照被截断也还在）。
 */
function taskPack(command, seedFiles, dumpChars, essential) {
  const entries = Object.entries(seedFiles || {}).map(([rel, content]) => ({ rel, content }));
  const must = new Set(essential || []);
  const head = ['【你的指令】', command, '', '【当前仓库快照（受上下文预算限制，可能只给出一部分文件）】'];
  let used = head.join('\n').length;
  const body = [];
  const put = (e) => {
    const block = '--- ' + e.rel + ' ---\n' + e.content.replace(/\n$/, '') + '\n';
    if (dumpChars > 0 && used + block.length > dumpChars && !must.has(e.rel)) {
      const room = Math.max(0, dumpChars - used - 32);
      if (room > 60) { body.push('--- ' + e.rel + ' ---（内容被预算截断）\n' + e.content.slice(0, room)); used += room; }
      else body.push('--- ' + e.rel + ' ---（因上下文预算不足，本次未提供内容）');
      return;
    }
    body.push(block); used += block.length;
  };
  // ① 本次任务**必须动到的文件**永远给全（真实情况：目标文件一定看得到）
  for (const e of entries.filter((x) => must.has(x.rel))) put(e);
  // ② 其余文件按体积降序竞争剩余额度（模拟"日志/资源文件挤掉文档"）
  for (const e of entries.filter((x) => !must.has(x.rel)).sort((a, b) => b.content.length - a.content.length)) put(e);
  return head.concat(body).join('\n');
}

const writeDeep = (dir, rel, content) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content) };

function runIn(dir) {
  return {
    readFile: (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8') } catch { return null } },
    list: () => {
      const out = [];
      const walk = (d, prefix) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name === '_done.txt') continue;
          const rel = prefix ? prefix + '/' + e.name : e.name;
          if (e.isDirectory()) walk(path.join(d, e.name), rel); else out.push(rel);
        }
      };
      try { walk(dir, '') } catch { /* best effort */ }
      return out;
    },
    exec: (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 20000, windowsHide: true });
      return { status: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    },
  };
}

/**
 * 试题自校验（**先证明题是可解的**）：给每道题套上"参考解"，跑一遍判据，必须通过。
 * 起因：b777001 批次里有两族是**我的题面/判据有 bug**（`import { assert } from 'node:assert'` 根本不存在；
 * README 判据要求逐字字符串），执行体替我发现了它们——但那样测出来的是我的 bug，不是臂的好坏。
 * 从此**每批开跑前先自校验**：题不可解 → 直接拒绝开跑。
 */
function validateTasks(tasks) {
  const os = require('node:os');
  const bad = [];
  for (const t of tasks) {
    if (typeof t.reference !== 'function') { bad.push({ id: t.id, why: '没有参考解（无法自校验）' }); continue }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-validate-'));
    try {
      for (const [rel, content] of Object.entries(t.seedFiles || {})) writeDeep(dir, rel, content);
      t.reference(dir);
      const r = t.check(runIn(dir));
      if (!r.ok) bad.push({ id: t.id, why: '参考解未通过判据：' + r.why });
    } catch (e) {
      bad.push({ id: t.id, why: '自校验抛错：' + String(e && e.message ? e.message : e) });
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
  return bad;
}

(async () => {
  const phase = process.argv[2];
  if (phase === 'phase1') {
    const seed = Number(arg('seed', String(Math.floor(Math.random() * 1e9))));
    const per = Number(arg('per', '1'));
    const arms = String(arg('arms', 'raw,v6e')).split(',').filter(Boolean);
    const tier = arg('tier', 'extreme');
    const reps = Math.max(1, Number(arg('reps', '1')));
    // 仓库快照的字符预算：0 = 不截断。模拟真实下游的上下文上限（brief 的价值在这里才会显现）
    const dumpChars = Number(arg('dump', '0')) || 0;
    const families = arg('families', '') ? String(arg('families')).split(',') : null;
    const tasks = buildTasks(seed, per, families);
    // 先自校验：题不可解就不许开跑（否则测出来的是题面的 bug）
    const invalid = validateTasks(tasks);
    if (invalid.length) {
      console.error('❌ 试题自校验失败（先修题，再开跑）：');
      for (const x of invalid) console.error('   ' + x.id + '：' + x.why);
      process.exit(2);
    }
    console.log('试题自校验：' + tasks.length + ' 道全部可解 ✓（参考解能通过各自判据）');
    const batch = 'b' + seed;
    const dir = path.join(ROOT, batch);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { batch, at: new Date().toISOString(), seed, per, reps, tier, arms, dumpChars, families: families || Object.keys(require('./tasks.cjs').FAMILIES), entries: [] };
    for (const t of tasks) {
      for (const arm of arms) {
        for (let rep = 1; rep <= reps; rep += 1) {
          const suffix = rep === 1 ? '' : '-r' + rep;
          const work = path.join(dir, t.id + '__' + arm + suffix);
          fs.mkdirSync(work, { recursive: true });
          for (const [rel, content] of Object.entries(t.seedFiles || {})) writeDeep(work, rel, content);
          // ⚠️ 执行体只允许看到下面这一段文字（= 用户会贴出去的东西）；同一实例的多次重复共用同一份命令
          const prod = arm === 'raw' ? { text: t.prompt, source: 'raw' } : await pluginProduct(t.prompt, arm, tier, work);
          fs.writeFileSync(path.join(work, 'command.txt'), prod.text);
          // 一次性执行体只读这一个文件（指令 + 仓库快照；仓库部分各臂完全相同）
          fs.writeFileSync(path.join(work, 'task.txt'), taskPack(prod.text, t.seedFiles, dumpChars, t.essential));
          manifest.entries.push({ taskId: t.id, family: t.family, arm, rep, dir: work, commandChars: prod.text.length, source: prod.source, productChars: prod.chars || null, gate: prod.gate || null, toolCalls: prod.toolCalls || null, toolRootSource: prod.toolRootSource || null, rawChars: t.prompt.length });
          console.log('  ' + (t.id + '__' + arm + suffix).padEnd(38) + ' 原话=' + String(t.prompt.length).padStart(3) + ' 字 → 命令=' + String(prod.text.length).padStart(5) + ' 字  [' + prod.source + ']');
        }
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(dir, 'dispatch.json'), JSON.stringify(manifest.entries.map((e) => ({ dir: e.dir, commandFile: path.join(e.dir, 'command.txt') })), null, 1));
    console.log('\n批次 ' + batch + '：' + manifest.entries.length + ' 个 (题,臂) 目录已就绪 → ' + dir);
    console.log('下一步：把 dispatch.json 交给 agent 编排器执行，然后 node evidence/dynamic-suite/harness.cjs phase2 --batch=' + batch);
    return;
  }
  if (phase === 'repack') {
    // 同一批 brief，只改"下游上下文预算"：node harness.cjs repack --batch=X --dump=N --into=Y
    // 用途：把"插件价值 vs 下游上下文预算"画成一条曲线——brief 决定下游能看到什么，预算越紧越值钱。
    const src = arg('batch', '');
    const into = arg('into', '');
    const dump = Number(arg('dump', '0')) || 0;
    const srcDir = path.join(ROOT, src);
    const m = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
    const tasks = buildTasks(m.seed, m.per, m.families);
    const byId = {};
    for (const t of tasks) byId[t.id] = t;
    const dstDir = path.join(ROOT, into || (src + '-dump' + dump));
    fs.mkdirSync(dstDir, { recursive: true });
    const out = { batch: path.basename(dstDir), at: new Date().toISOString(), seed: m.seed, per: m.per, reps: m.reps, tier: m.tier, arms: m.arms, dumpChars: dump, families: m.families, repackedFrom: src, entries: [] };
    for (const e of m.entries) {
      const t = byId[e.taskId];
      const work = path.join(dstDir, path.basename(e.dir));
      fs.mkdirSync(work, { recursive: true });
      for (const [rel, content] of Object.entries(t.seedFiles || {})) writeDeep(work, rel, content);
      const command = fs.readFileSync(path.join(e.dir, 'command.txt'), 'utf8');
      fs.writeFileSync(path.join(work, 'command.txt'), command);
      fs.writeFileSync(path.join(work, 'task.txt'), taskPack(command, t.seedFiles, dump, t.essential));
      out.entries.push(Object.assign({}, e, { dir: work }));
    }
    fs.writeFileSync(path.join(dstDir, 'manifest.json'), JSON.stringify(out, null, 1));
    console.log('repack 完成：' + out.entries.length + ' 格 → ' + dstDir + '（dump=' + dump + '）');
    console.log('下一步：派执行体 → node evidence/dynamic-suite/harness.cjs phase2 --batch=' + out.batch);
    return;
  }
  if (phase === 'phase2') {
    const batch = arg('batch', '');
    if (!batch) { console.error('用法: phase2 --batch=<batchId>'); process.exit(2) }
    const dir = path.join(ROOT, batch);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const seed = manifest.seed;
    const tasks = buildTasks(seed, manifest.per, manifest.families);
    const byId = {};
    for (const t of tasks) byId[t.id] = t;
    for (const e of manifest.entries) {
      const t = byId[e.taskId];
      // 两种执行体：onepass（默认）= 只看 task.txt、把成品写进 answer.json；agent = 带工具自己动手
      const answerPath = path.join(e.dir, 'answer.json');
      const hasAnswer = fs.existsSync(answerPath);
      const ran = hasAnswer || fs.existsSync(path.join(e.dir, '_done.txt'));
      e.ranByAgent = ran;
      e.mode = hasAnswer ? 'onepass' : 'agent';
      if (!ran) { e.result = { ok: false, why: '无执行体记录（未派发或未完成）' }; continue }
      if (hasAnswer) {
        // 把 answer.json 里声明的文件落到盘上（没提到的文件保持种子原样），再跑判据
        try {
          const ans = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
          const files = Array.isArray(ans.files) ? ans.files : [];
          if (files.length === 0) { e.result = { ok: false, why: 'answer.json 里没有 files' }; continue }
          for (const f of files) {
            if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') continue;
            writeDeep(e.dir, f.path.replace(/^[./\\]+/, ''), f.content);
          }
          e.answeredFiles = files.map((f) => f.path);
        } catch (err) {
          e.result = { ok: false, why: 'answer.json 解析失败：' + String(err && err.message ? err.message : err) };
          continue;
        }
      }
      e.result = t ? t.check(runIn(e.dir)) : { ok: false, why: '找不到题面定义' };
    }
    const arms = [...new Set(manifest.entries.map((e) => e.arm))];
    const rows = arms.map((a) => {
      const all = manifest.entries.filter((e) => e.arm === a);
      const graded = all.filter((e) => e.ranByAgent);
      const pass = graded.filter((e) => e.result.ok).length;
      const avgCmd = Math.round(all.reduce((s, e) => s + e.commandChars, 0) / Math.max(1, all.length));
      const avgRaw = Math.round(all.reduce((s, e) => s + e.rawChars, 0) / Math.max(1, all.length));
      return { arm: a, n: all.length, graded: graded.length, pass, rate: graded.length ? Math.round((pass / graded.length) * 1000) / 10 : null, avgCmdChars: avgCmd, avgRawChars: avgRaw, ratio: Math.round((avgCmd / Math.max(1, avgRaw)) * 100) / 100, over: all.filter((e) => e.gate && e.gate.over).length };
    });
    console.log('批次 ' + batch + '（seed=' + seed + '，tier=' + manifest.tier + '，重复=' + (manifest.reps || 1) + '）');
    console.log('  臂'.padEnd(10) + '格  已判  通过  首次通过率   平均命令字数  平均原话  膨胀  越界');
    for (const r of rows) console.log('  ' + r.arm.padEnd(10) + String(r.n).padStart(3) + String(r.graded).padStart(6) + String(r.pass).padStart(6) + String((r.rate === null ? '—' : r.rate + '%')).padStart(12) + String(r.avgCmdChars).padStart(14) + String(r.avgRawChars).padStart(10) + String(r.ratio + '×').padStart(8) + String(r.over).padStart(6));
    console.log('\n  逐格明细：');
    for (const e of manifest.entries) console.log('   ' + (e.taskId + '__' + e.arm + (e.rep > 1 ? '-r' + e.rep : '')).padEnd(40) + (e.ranByAgent ? (e.result.ok ? '✓' : '✗ ' + String(e.result.why).slice(0, 80)) : '∅ 无执行体记录'));
    const raw = rows.find((r) => r.arm === 'raw');
    if (raw && raw.rate !== null) {
      console.log('');
      for (const r of rows.filter((x) => x.arm !== 'raw' && x.rate !== null)) {
        const d = Math.round((r.rate - raw.rate) * 10) / 10;
        console.log('  Δ vs 原话（' + r.arm + '）：' + (d > 0 ? '+' : '') + d + ' 个百分点' + (d > 0 ? '  ← 优于不优化' : (d === 0 ? '  = 与原话持平' : '  ← 不如不优化')));
      }
      // 分家族看（防"被某一族绑架"）
      const fams = [...new Set(manifest.entries.map((e) => e.family))];
      console.log('\n  分家族（通过/已判）：');
      for (const f of fams) {
        const cells = rows.map((r) => {
          const list = manifest.entries.filter((e) => e.family === f && e.arm === r.arm && e.ranByAgent);
          return r.arm + '=' + list.filter((e) => e.result.ok).length + '/' + list.length;
        });
        console.log('   ' + f.padEnd(18) + cells.join('  '));
      }
    }
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), rows, entries: manifest.entries }, null, 1));
    console.log('\nWROTE ' + path.join('evidence', 'dynamic-suite', 'batches', batch, 'results.json'));
    return;
  }
  console.error('用法: harness.cjs phase1|phase2 …');
  process.exit(2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
