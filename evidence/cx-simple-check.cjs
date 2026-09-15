// 简单任务回归检查：验证"复杂任务能力包"没有泄漏到简单任务、没有把简单命令撑长、没有越权索要流程。
// 用法：node evidence/cx-simple-check.cjs [results.json]
const fs = require('fs')
const path = require('path')
const ev = __dirname
const res = JSON.parse(fs.readFileSync(path.join(ev, process.argv[2] || 'cx-simple.json'), 'utf8'))
// 泄漏标记：这些是"复杂任务专有"的模板段。注意——按域命中的**细节检查**不算泄漏
// （例：T4"线程安全缓存"属并发域，要求"同一请求只处理一次/锁顺序"是应当的，不是越权）。
const LEAK = ['不得降级清单', '法线朝向', '全局验收场景', '本轮不做项', '停手条件']
// 无复杂域信号的题（数学/物理推理）出现这些模板段才算泄漏
const PLAIN_TASKS = ['T1-math-rate', 'T2-math-ramsey', 'T3-physics-crash']
// "越权索要流程"只算**正面索取**：必须排除"不要建 goal/todo"这类否定句（否则会把正确的反向纪律误报成违规）
const PROCESS_POSITIVE = [
  /(先列|列出|创建|建立|写)\s*[0-9０-９~\-—]{0,4}\s*条?\s*todo/i,
  /(先?建立|创建)\s*goal/i,
  /分阶段(推进|执行|实施)/,
  /写\s*(一份)?\s*阶段文档/,
]
const mean = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0

const byVariant = {}
for (const c of res.cells || []) {
  if (c.skipped) continue
  const v = c.variantId
  byVariant[v] = byVariant[v] || { lens: [], leak: 0, leakHits: [], proc: 0, procHits: [], cells: 0 }
  const t = String(c.command || '')
  byVariant[v].cells += 1
  byVariant[v].lens.push(t.length)
  const lh = LEAK.filter((k) => t.indexOf(k) >= 0)
  const ph = PROCESS_POSITIVE.map((re) => (t.match(re) || [])[0]).filter(Boolean)
  // 只有"无复杂域信号的题"出现模板段才算泄漏；带域的题按定义允许写该域检查
  const leakHere = PLAIN_TASKS.indexOf(c.taskId) >= 0 ? lh : []
  if (leakHere.length) { byVariant[v].leak += 1; byVariant[v].leakHits.push({ task: c.taskId, hits: leakHere }) }
  if (ph.length) { byVariant[v].proc += 1; byVariant[v].procHits.push({ task: c.taskId, hits: ph }) }
}
console.log('=== 简单任务回归（4 题）===')
for (const v of Object.keys(byVariant)) {
  const b = byVariant[v]
  console.log('  ' + v.padEnd(16) + '平均 ' + mean(b.lens) + ' 字符（最长 ' + Math.max(...b.lens) + '）  复杂包泄漏 ' + b.leak + '/' + b.cells + '  越权索要流程 ' + b.proc + '/' + b.cells)
  for (const h of b.leakHits) console.log('      泄漏: ' + h.task + ' → ' + JSON.stringify(h.hits))
  for (const h of b.procHits) console.log('      流程: ' + h.task + ' → ' + JSON.stringify(h.hits))
}
const ship = byVariant['SHIP-extreme'] || { lens: [] }
const v3 = byVariant['V3-extreme'] || { lens: [] }
const ratio = ship.lens.length && v3.lens.length ? Math.round((mean(v3.lens) / mean(ship.lens)) * 100) / 100 : null
console.log('')
console.log('长度比 V3/SHIP = ' + ratio + '（>1.3 视为把简单任务撑长，需要回退对应改动）')
const leakOk = (v3.leak || 0) === 0
console.log('结论：' + ((leakOk && (ratio === null || ratio <= 1.3)) ? 'PASS —— 复杂能力包未泄漏、简单命令未明显变长' : 'CHECK —— 见上面明细'))
