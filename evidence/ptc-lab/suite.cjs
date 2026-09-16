// 校准套件：node evidence/ptc-lab/suite.cjs [runFile]
// 目的：把"基线 ≈50%"从口号变成**可复算的定义**——按逐题基线分层，选出判别题 + 少量易题，
// 使套件在无优化（norefine）条件下实测≈50%。所有策略面对同一套件，公平性不受影响。
// 产出：suite.json（机器可读）+ 控制台核验表。任何后续配对测量都应使用本套件。
const fs = require('fs')
const path = require('path')

// 判别题（逐题基线 ≤50%，见 README 校准表）+ 两道覆盖核心域的易题（用于把总基线抬到 ~50%）
const SUITE = [
  { id: 'perf-topk', why: '基线 0/2：严格预算 + 第 k 大' },
  { id: 'perf-huge-scan', why: '基线 0/2：600ms 墙钟预算' },
  { id: 'perf-sort', why: '基线 1/2：性能预算' },
  { id: 'memcap-stream-sum', why: '基线 1/2：128MB 堆上限 + 流式' },
  { id: 'cli-stats', why: '基线 1/2：CLI + 编码/输出契约' },
  { id: 'html-selfcheck', why: '基线 1/2：单文件产物 + 自检结构' },
  { id: 'mesh-volume', why: '基线 1/2：几何数值' },
  { id: 'two-process-counter', why: '基线 1/2：跨进程并发正确性' },
  { id: 'fix-stats-bug', why: '易题（覆盖"定位并修复缺陷"域，基线 2/2）' },
  { id: 'json-upgrade', why: '易题（覆盖"数据/文件改造"域，基线 2/2）' },
]

const runFile = process.argv[2] || path.join(__dirname, 'latest.json')
const run = JSON.parse(fs.readFileSync(runFile, 'utf8'))
const ids = SUITE.map((s) => s.id)
const per = {}
for (const c of run.cells) {
  if (!ids.includes(c.task)) continue
  const p = per[c.task] || (per[c.task] = { p: 0, n: 0 })
  p.n += 1
  if (c.score && c.score.pass) p.p += 1
}
let cells = 0, pass = 0
console.log('校准套件核验（数据源 ' + run.tag + '，策略=' + [...new Set(run.cells.map((c) => c.strategy))].join(',') + '，上限 maxTokens=' + run.config.maxTokens + '，R=' + run.config.rounds + '，rep=' + run.config.rep + '）')
console.log('')
console.log('题目                 逐题   说明')
for (const s of SUITE) {
  const x = per[s.id] || { p: 0, n: 0 }
  cells += x.n; pass += x.p
  console.log('  ' + s.id.padEnd(20) + (x.p + '/' + x.n).padEnd(7) + s.why)
}
const rate = cells ? Math.round(1000 * pass / cells) / 10 : null
console.log('')
console.log('套件基线：' + pass + '/' + cells + ' = ' + rate + '%' + (rate !== null && Math.abs(rate - 50) <= 5 ? '  ✓ 落在 45–55% 目标带内' : '  ✗ 超出目标带'))
const missing = ids.filter((id) => !per[id])
if (missing.length) console.log('⚠️ 该运行里缺少题目：' + missing.join(', '))
console.log('  1 格 = ' + (cells ? (100 / cells).toFixed(1) : '?') + ' 个百分点')

fs.writeFileSync(path.join(__dirname, 'suite.json'), JSON.stringify({
  at: new Date().toISOString(),
  definition: '无优化基线≈50% 的校准套件：8 道判别题（逐题基线≤50%）+ 2 道易题（覆盖核心域）',
  condition: { maxTokens: run.config.maxTokens, rounds: run.config.rounds, rep: run.config.rep, strategy: 'norefine' },
  source: run.tag,
  measured: { cells, pass, rate },
  tasks: SUITE,
}, null, 1), 'utf8')
console.log('WROTE evidence/ptc-lab/suite.json')
