// 远端文档一致性核对：node evidence/verify-remote-docs.cjs
// 逐份把本地文件与 GitHub main 上的原文按行比对（CRLF 归一），不一致则打印**具体差异行**。
const fs = require('node:fs');
const path = require('node:path');
const REPO = 'WestFox-AwA/dsh-prompt-optimizer';
const ROOT = path.join(__dirname, '..');
const FILES = ['README.md', 'README.en.md', 'CHANGELOG.md', 'package.json', 'PROMPT-OPTIMIZATION.md', 'ACCEPTANCE.md', 'DSH-COMPAT.md', 'DELIVERY.md', 'ROADMAP.md', 'cordis.patch.yml'];
const norm = (s) => String(s).replace(/\r\n/g, '\n');

(async () => {
  let diffCount = 0;
  let fetchFail = 0;
  for (const f of FILES) {
    const localPath = path.join(ROOT, f);
    if (!fs.existsSync(localPath)) { console.log(f.padEnd(24) + '（本地不存在，跳过）'); continue; }
    const local = norm(fs.readFileSync(localPath, 'utf8'));
    let remote = null;
    try {
      const r = await fetch('https://raw.githubusercontent.com/' + REPO + '/main/' + f + '?cb=' + Date.now());
      if (r.status !== 200) { console.log(f.padEnd(24) + '远端 HTTP ' + r.status); fetchFail++; continue; }
      remote = norm(await r.text());
    } catch (e) { console.log(f.padEnd(24) + '拉取失败: ' + e.message); fetchFail++; continue; }
    if (local === remote) { console.log(f.padEnd(24) + '✓ 与远端逐行一致（CRLF 归一后）  ' + local.split('\n').length + ' 行'); continue; }
    diffCount++;
    const L = local.split('\n'), R = remote.split('\n');
    const onlyLocal = L.filter((x) => x.trim() && !R.includes(x)).length;
    const onlyRemote = R.filter((x) => x.trim() && !L.includes(x)).length;
    console.log(f.padEnd(24) + '✗ 不一致  本地 ' + L.length + ' 行 / 远端 ' + R.length + ' 行；本地独有 ' + onlyLocal + ' 行，远端独有 ' + onlyRemote + ' 行');
    let shown = 0;
    for (let i = 0; i < Math.max(L.length, R.length) && shown < 6; i++) {
      if ((L[i] || '') === (R[i] || '')) continue;
      shown++;
      console.log('    L' + (i + 1) + ' 本地: ' + String(L[i] === undefined ? '（无此行）' : L[i]).slice(0, 110));
      console.log('    L' + (i + 1) + ' 远端: ' + String(R[i] === undefined ? '（无此行）' : R[i]).slice(0, 110));
    }
  }
  console.log('');
  if (fetchFail > 0) {
    console.log('结论：❌ ' + fetchFail + ' 份**拉取失败**，无法判定一致性（判据不成立，不得当作"一致"）' + (diffCount ? '；另有 ' + diffCount + ' 份内容不一致' : ''));
    process.exit(2);
  }
  console.log(diffCount === 0 ? '结论：本地工作区与 GitHub main 完全一致。' : '结论：' + diffCount + ' 份文件与远端不一致（见上）。');
  process.exit(diffCount === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
