// 验证"内存上限"类题目的可行性：--max-old-space-size 能否卡住 readFileSync+split 的偷懒解
const fs = require('fs'), os = require('os'), path = require('path')
const { spawnSync } = require('child_process')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memmeas-'))
const N = 4000000
const M = 2147483648
// 造 data.txt：一行一个数字
{
  const chunks = []
  let x = 42, buf = []
  for (let i = 0; i < N; i++) {
    x = (x * 1103515245 + 12345) % M
    buf.push(String(x))
    if (buf.length === 100000) { chunks.push(buf.join('\n') + '\n'); buf = [] }
  }
  if (buf.length) chunks.push(buf.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'data.txt'), chunks.join(''), 'utf8')
}
const size = fs.statSync(path.join(dir, 'data.txt')).size
console.log('data.txt = ' + (size / 1048576).toFixed(1) + ' MB, ' + N + ' 行')

const readAll = [
  'const fs = require("fs")',
  'const t = fs.readFileSync("data.txt", "utf8")',
  'const rows = t.split(/\\r?\\n/).filter(Boolean)',
  'let sum = 0, max = 0',
  'for (const r of rows) { const v = Number(r); sum = (sum + v) % 1000000007; if (v > max) max = v }',
  'console.log(JSON.stringify({ count: rows.length, sum, max }))',
].join('\n')
const streamed = [
  'const fs = require("fs"), readline = require("readline")',
  'const rl = readline.createInterface({ input: fs.createReadStream("data.txt"), crlfDelay: Infinity })',
  'let sum = 0, max = 0, count = 0',
  'rl.on("line", (l) => { if (!l) return; const v = Number(l); count++; sum = (sum + v) % 1000000007; if (v > max) max = v })',
  'rl.on("close", () => console.log(JSON.stringify({ count, sum, max })))',
].join('\n')

for (const [name, code] of [['readall', readAll], ['stream', streamed]]) {
  const f = path.join(dir, name + '.js')
  fs.writeFileSync(f, code, 'utf8')
  for (const cap of [64, 128]) {
    const t0 = Date.now()
    const r = spawnSync(process.execPath, ['--max-old-space-size=' + cap, f], { cwd: dir, encoding: 'utf8', timeout: 60000 })
    const wall = Date.now() - t0
    const err = String(r.stderr || '').split('\n').filter((l) => /Error|heap|memory/i.test(l)).slice(0, 2).join(' | ')
    console.log(name.padEnd(8) + ' cap=' + String(cap).padStart(3) + 'MB  exit=' + r.status + '  ' + wall + 'ms  ' + (r.status === 0 ? String(r.stdout).trim().slice(0, 60) : err.slice(0, 120)))
  }
}
fs.rmSync(dir, { recursive: true, force: true })
