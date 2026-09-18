// 检查 tgz：node evidence/inspect-tgz.cjs <file>... [--vs <baselineFile>]
// 打印每个文件的大小 / sha256 / 包内 package.json 的 version；给了 --vs 就逐个与基线比 sha256。
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const argv = process.argv.slice(2);
const vsAt = argv.indexOf('--vs');
const baseline = vsAt >= 0 ? argv[vsAt + 1] : null;
const files = (vsAt >= 0 ? argv.slice(0, vsAt) : argv).filter(Boolean);
if (files.length === 0) { console.error('用法: node evidence/inspect-tgz.cjs <file>... [--vs <baselineFile>]'); process.exit(2); }
const baseSha = baseline ? sha(fs.readFileSync(baseline)) : null;
let bad = 0;
for (const f of files) {
  const buf = fs.readFileSync(f);
  let inner = '?';
  try {
    const tar = zlib.gunzipSync(buf).toString('latin1');
    const m = tar.match(/"version"\s*:\s*"([^"]+)"/);
    if (m) inner = m[1];
  } catch (e) { inner = 'gunzip failed: ' + e.message; }
  const s = sha(buf);
  const cmp = baseSha === null ? '' : (s === baseSha ? '  [identical to local]' : '  [DIFFERS from local]');
  if (baseSha !== null && s !== baseSha) bad++;
  if (inner === '?') bad++;
  console.log('  ' + f.split(/[\\/]/).pop().padEnd(20) + String(buf.length).padStart(8) + ' bytes  sha256=' + s.slice(0, 16) + '…  version=' + inner + cmp);
}
process.exit(bad === 0 ? 0 : 1);
