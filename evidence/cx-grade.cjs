// 复杂任务确定性判分器：对"优化器产出的命令"按 0~3 级要点打分（不需要额外 LLM 调用，快且可复现）。
// 分档：0 完全没提；1 模糊提及；2 可判定要求；3 可判定要求 + 验证/回归/边界。
// 用法：
//   node evidence/cx-grade.cjs <lab-cx.json> <results.json>     对测量结果批量判分并汇总
//   node evidence/cx-grade.cjs --text <lab-cx.json> <taskId> <file>   对单个命令文本判分（调试用）
const fs = require('fs')
const path = require('path')

function levelOf(text, tiers) {
  const t = String(text || '')
  let lvl = 0
  for (let i = 0; i < tiers.length; i++) {
    const hit = (tiers[i] || []).some((k) => t.toLowerCase().indexOf(String(k).toLowerCase()) >= 0)
    if (hit) lvl = i + 1
  }
  // 3 档要求：必须同时具备"可判定要求"档的命中，否则降为 2（避免只写了"验证"就算满分）
  if (lvl === 3 && !(tiers[1] || []).some((k) => t.toLowerCase().indexOf(String(k).toLowerCase()) >= 0)) lvl = 1
  return lvl
}

function gradeCommand(spec, task, text) {
  const points = task.criteria.map((c) => levelOf(text, c.tiers))
  const total = points.reduce((a, b) => a + b, 0)
  return { id: task.id, points, total, max: task.criteria.length * 3 , detail: task.criteria.map((c, i) => c.zh + ' → ' + points[i]) }
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--text') {
    const [, specPath, taskId, file] = args
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
    const task = spec.tasks.find((t) => t.id === taskId)
    if (!task) { console.error('no such task: ' + taskId); process.exit(2) }
    const r = gradeCommand(spec, task, fs.readFileSync(file, 'utf8'))
    console.log(taskId + '  total=' + r.total + '/' + r.max)
    for (const d of r.detail) console.log('  ' + d)
    return
  }
  const [specPath, resPath] = args
  if (!specPath || !resPath) { console.error('usage: cx-grade.cjs <lab-cx.json> <results.json>   |   --text <spec> <taskId> <file>'); process.exit(2) }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  const res = JSON.parse(fs.readFileSync(resPath, 'utf8'))
  const byVariant = {}
  const rows = []
  for (const cell of res.cells || []) {
    const task = spec.tasks.find((t) => t.id === cell.taskId)
    if (!task) continue
    const cmd = cell.command || cell.relayText || ''
    const g = gradeCommand(spec, task, cmd)
    const v = cell.variantId
    byVariant[v] = byVariant[v] || { sum: 0, max: 0, cells: 0, perTask: {} }
    byVariant[v].sum += g.total; byVariant[v].max += g.max; byVariant[v].cells += 1
    byVariant[v].perTask[cell.taskId] = (byVariant[v].perTask[cell.taskId] || []).concat([g.total])
    rows.push({ variant: v, task: cell.taskId, rep: cell.rep, total: g.total, max: g.max, points: g.points, ms: cell.ms || null })
  }
  const summary = Object.keys(byVariant).map((v) => {
    const b = byVariant[v]
    const pct = b.max ? b.sum / b.max : 0
    return { variant: v, sum: b.sum, max: b.max, cells: b.cells, pct: Math.round(pct * 1000) / 10 }
  }).sort((a, b) => b.pct - a.pct)
  console.log('=== 命令侧（确定性判分，0~3 级）===')
  for (const s of summary) console.log('  ' + s.variant.padEnd(22) + s.sum + '/' + s.max + '  ' + s.pct + '%  (' + s.cells + ' 格)')
  const outPath = path.join(__dirname, 'cx-grade.json')
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), scoring: spec.scoring, summary, rows }, null, 1), 'utf8')
  console.log('WROTE ' + outPath)
  const total = spec.scoring.suiteMax
  for (const s of summary) {
    const scaled = Math.round((s.pct / 100) * total)
    const line = s.pct >= 100 * spec.scoring.lines.full ? '满分' : s.pct >= 100 * spec.scoring.lines.target ? '目标线' : s.pct >= 100 * spec.scoring.lines.pass ? '及格线' : '未达标'
    console.log('  ' + s.variant.padEnd(22) + '换算到满分 ' + total + ' → ' + scaled + '  [' + line + ']')
  }
}

main()
