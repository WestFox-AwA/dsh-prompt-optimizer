// 量两种实现的真实耗时（用于设定 perf-huge-scan 的判别阈值）
const { spawnSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfmeas-'))
const M = 2147483648, MOD = 1000000007, N = 5000000
const smart = [
  'const M = 2147483648, MOD = 1000000007, N = 5000000',
  'const t0 = Date.now()',
  'let x = 42, sum = 0',
  'const top = new Float64Array(10); let filled = 0',
  'for (let i = 0; i < N; i++) {',
  '  x = (x * 1103515245 + 12345) % M',
  '  sum = (sum + x) % MOD',
  '  if (filled < 10) { top[filled++] = x; for (let a = filled - 1; a > 0 && top[a-1] > top[a]; a--) { const t = top[a-1]; top[a-1] = top[a]; top[a] = t } }',
  '  else if (x > top[0]) { top[0] = x; for (let a = 1; a < 10 && top[a-1] > top[a]; a++) { const t = top[a-1]; top[a-1] = top[a]; top[a] = t } }',
  '}',
  'console.log(JSON.stringify({ k: top[0], sum, ms: Date.now() - t0 }))',
].join('\n')
const naive = [
  'const M = 2147483648, MOD = 1000000007, N = 5000000',
  'const t0 = Date.now()',
  'const a = new Float64Array(N)',
  'let x = 42, sum = 0',
  'for (let i = 0; i < N; i++) { x = (x * 1103515245 + 12345) % M; a[i] = x; sum = (sum + x) % MOD }',
  'a.sort()',
  'console.log(JSON.stringify({ k: a[N-10], sum, ms: Date.now() - t0 }))',
].join('\n')
for (const [name, code] of [['smart-top10', smart], ['naive-fullsort', naive]]) {
  const f = path.join(dir, name + '.js')
  fs.writeFileSync(f, code, 'utf8')
  const times = []
  for (let i = 0; i < 3; i++) { const t0 = Date.now(); spawnSync(process.execPath, [f], { cwd: dir, encoding: 'utf8' }); times.push(Date.now() - t0) }
  console.log(name.padEnd(16) + ' wall(含启动, 3 次): ' + times.join(' / ') + ' ms')
}
fs.rmSync(dir, { recursive: true, force: true })
