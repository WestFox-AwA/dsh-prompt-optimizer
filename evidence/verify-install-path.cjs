// 「按文档安装装到的是哪个版本」验证：node evidence/verify-install-path.cjs
// README 推荐的安装命令用的是 releases/latest 别名链接；这里把它与版本化链接**都下载下来**，
// 解包读 package/package.json 的 version，并与本地 tgz 比 sha256。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const REPO = 'WestFox-AwA/dsh-prompt-optimizer';
const VER = require(path.join(__dirname, '..', 'package.json')).version;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const LOCAL = path.join(__dirname, '..', 'dsh-external-dsh-prompt-optimizer-' + VER + '.tgz');

(async () => {
  if (!fs.existsSync(LOCAL)) { console.error('本地 tgz 不存在：' + LOCAL + '（先 npm pack）'); process.exit(1); }
  const local = fs.readFileSync(LOCAL);
  console.log('本地 tgz  = dsh-external-dsh-prompt-optimizer-' + VER + '.tgz  ' + local.length + ' bytes  sha256=' + sha(local).slice(0, 16) + '…');
  console.log('');
  const targets = [
    ['README 推荐（releases/latest 别名）', 'https://github.com/' + REPO + '/releases/latest/download/dsh-external-dsh-prompt-optimizer.tgz'],
    ['版本化链接（v' + VER + '）', 'https://github.com/' + REPO + '/releases/download/v' + VER + '/dsh-external-dsh-prompt-optimizer-' + VER + '.tgz'],
    ['文档安装示例里的文件名', 'https://github.com/' + REPO + '/releases/download/v' + VER + '/dsh-external-dsh-prompt-optimizer-' + VER + '.tgz'],
  ];
  let bad = 0;
  for (const [name, url] of targets) {
    try {
      const r = await fetch(url + '?cb=' + Date.now());
      if (r.status !== 200) { console.log('✗ ' + name + '：HTTP ' + r.status); bad++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      let inner = '?';
      try {
        const tar = zlib.gunzipSync(buf).toString('latin1');
        const m = tar.match(/"version"\s*:\s*"([^"]+)"/);
        if (m) inner = m[1];
      } catch (e) { inner = '解包失败: ' + e.message; }
      const same = sha(buf) === sha(local);
      const ok = same && inner === VER;
      if (!ok) bad++;
      console.log((ok ? '✓ ' : '✗ ') + name);
      console.log('    ' + buf.length + ' bytes  sha256 与本地' + (same ? '一致' : '**不一致**') + '  包内 version = ' + inner + (inner === VER ? ' ✓' : ' ✗（应为 ' + VER + '）'));
    } catch (e) { console.log('✗ ' + name + '：' + e.message); bad++; }
  }
  console.log('');
  console.log(bad === 0 ? '判定：按文档安装装到的就是 ' + VER + ' ✓' : '判定：❌ ' + bad + ' 条不达标');
  process.exit(bad === 0 ? 0 : 2);
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1); });
