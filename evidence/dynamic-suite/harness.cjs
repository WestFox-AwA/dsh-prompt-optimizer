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

async function pluginProduct(text, arm, tier) {
  // 臂 → (策略, 档位)：raw 不走插件；其余走 /run，取 run.text（这就是用户会贴出去的那段）
  const plan = {
    v6e: { strategy: 'v6', tier: tier || 'extreme' },
    v6b: { strategy: 'v6', tier: 'basic' },
    v6a: { strategy: 'v6', tier: 'advanced' },
    v5e: { strategy: 'v5', tier: tier || 'extreme' },
    v011e: { strategy: 'v011-ptc', tier: tier || 'extreme' },
  }[arm];
  if (!plan) return { text, source: 'raw' };
  await post('/state', { strategy: plan.strategy, delivery: null });
  const r = await post('/run', { request: text, tier: plan.tier, readTools: false, turns: 0, historyMode: 'turns' });
  const id = r.runId || r.id;
  if (!id) return { text, source: 'raw(fallback: 启动失败 ' + JSON.stringify(r).slice(0, 80) + ')' };
  for (let i = 0; i < 300; i += 1) {
    await new Promise((s) => setTimeout(s, 1000));
    const rec = ((await j(API + '/runs')).runs || []).find((x) => x.id === id);
    if (rec && rec.status !== 'running') {
      return { text: String(rec.text || ''), source: arm + '(' + plan.strategy + '/' + plan.tier + ')', chars: rec.chars, gate: rec.lengthGate || null, status: rec.status };
    }
  }
  return { text, source: 'raw(fallback: timeout)' };
}

function runIn(dir) {
  return {
    readFile: (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8') } catch { return null } },
    exec: (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 20000, windowsHide: true });
      return { status: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    },
  };
}

(async () => {
  const phase = process.argv[2];
  if (phase === 'phase1') {
    const seed = Number(arg('seed', String(Math.floor(Math.random() * 1e9))));
    const per = Number(arg('per', '1'));
    const arms = String(arg('arms', 'raw,v6e')).split(',').filter(Boolean);
    const tier = arg('tier', 'extreme');
    const families = arg('families', '') ? String(arg('families')).split(',') : null;
    const tasks = buildTasks(seed, per, families);
    const batch = 'b' + seed;
    const dir = path.join(ROOT, batch);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { batch, at: new Date().toISOString(), seed, per, tier, arms, families: families || Object.keys(require('./tasks.cjs').FAMILIES), entries: [] };
    for (const t of tasks) {
      for (const arm of arms) {
        const work = path.join(dir, t.id + '__' + arm);
        fs.mkdirSync(work, { recursive: true });
        for (const [rel, content] of Object.entries(t.seedFiles || {})) fs.writeFileSync(path.join(work, rel), content);
        // ⚠️ 执行体只允许看到下面这一段文字（= 用户会贴出去的东西）
        const prod = arm === 'raw' ? { text: t.prompt, source: 'raw' } : await pluginProduct(t.prompt, arm, tier);
        fs.writeFileSync(path.join(work, 'command.txt'), prod.text);
        manifest.entries.push({ taskId: t.id, family: t.family, arm, dir: work, commandChars: prod.text.length, source: prod.source, productChars: prod.chars || null, gate: prod.gate || null, rawChars: t.prompt.length });
        console.log('  ' + (t.id + '__' + arm).padEnd(34) + ' 原话=' + String(t.prompt.length).padStart(3) + ' 字 → 命令=' + String(prod.text.length).padStart(5) + ' 字  [' + prod.source + ']');
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(dir, 'dispatch.json'), JSON.stringify(manifest.entries.map((e) => ({ dir: e.dir, commandFile: path.join(e.dir, 'command.txt') })), null, 1));
    console.log('\n批次 ' + batch + '：' + manifest.entries.length + ' 个 (题,臂) 目录已就绪 → ' + dir);
    console.log('下一步：把 dispatch.json 交给 agent 编排器执行，然后 node evidence/dynamic-suite/harness.cjs phase2 --batch=' + batch);
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
      e.result = t ? t.check(runIn(e.dir)) : { ok: false, why: '找不到题面定义' };
    }
    const arms = [...new Set(manifest.entries.map((e) => e.arm))];
    const rows = arms.map((a) => {
      const list = manifest.entries.filter((e) => e.arm === a);
      const pass = list.filter((e) => e.result.ok).length;
      const avgCmd = Math.round(list.reduce((s, e) => s + e.commandChars, 0) / Math.max(1, list.length));
      const avgRaw = Math.round(list.reduce((s, e) => s + e.rawChars, 0) / Math.max(1, list.length));
      return { arm: a, n: list.length, pass, rate: Math.round((pass / Math.max(1, list.length)) * 1000) / 10, avgCmdChars: avgCmd, avgRawChars: avgRaw, ratio: Math.round((avgCmd / Math.max(1, avgRaw)) * 100) / 100, over: list.filter((e) => e.gate && e.gate.over).length };
    });
    console.log('批次 ' + batch + '（seed=' + seed + '，tier=' + manifest.tier + '）');
    console.log('  臂'.padEnd(8) + '题数  通过  首次通过率   平均命令字数  平均原话  膨胀  越界');
    for (const r of rows) console.log('  ' + r.arm.padEnd(8) + String(r.n).padStart(3) + String(r.pass).padStart(6) + String(r.rate + '%').padStart(12) + String(r.avgCmdChars).padStart(14) + String(r.avgRawChars).padStart(10) + String(r.ratio + '×').padStart(8) + String(r.over).padStart(6));
    console.log('\n  逐题明细：');
    for (const e of manifest.entries) console.log('   ' + (e.taskId + '__' + e.arm).padEnd(36) + (e.result.ok ? '✓' : '✗ ' + String(e.result.why).slice(0, 90)));
    const raw = rows.find((r) => r.arm === 'raw');
    if (raw) {
      console.log('');
      for (const r of rows.filter((x) => x.arm !== 'raw')) {
        const d = Math.round((r.rate - raw.rate) * 10) / 10;
        console.log('  Δ vs 原话（' + r.arm + '）：' + (d > 0 ? '+' : '') + d + ' 个百分点' + (d > 0 ? '  ← 优于不优化' : (d === 0 ? '  = 与原话持平' : '  ← 不如不优化')));
      }
    }
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), rows, entries: manifest.entries }, null, 1));
    console.log('\nWROTE ' + path.join('evidence', 'dynamic-suite', 'batches', batch, 'results.json'));
    return;
  }
  console.error('用法: harness.cjs phase1|phase2 …');
  process.exit(2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) });
