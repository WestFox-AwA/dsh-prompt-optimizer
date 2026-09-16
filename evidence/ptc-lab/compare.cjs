// 跨条件对比：node evidence/ptc-lab/compare.cjs <runA.json> <runB.json> [taskFilter=a,b,c]
// 用途：同一批题目在两种"单轮输出上限"下的并排对比——用来区分"策略代价"与"测试台上限"。
// 只对两次运行都出现过的题目做统计（交集），避免题集不同造成的假差异。
const fs = require('fs')
const path = require('path')

const [, , fileA, fileB, filterArg] = process.argv
if (!fileA || !fileB) { console.log('用法: node evidence/ptc-lab/compare.cjs <runA.json> <runB.json> [taskFilter=a,b,c]'); process.exit(1) }
const A = JSON.parse(fs.readFileSync(path.isAbsolute(fileA) ? fileA : path.join(__dirname, fileA), 'utf8'))
const B = JSON.parse(fs.readFileSync(path.isAbsolute(fileB) ? fileB : path.join(__dirname, fileB), 'utf8'))
const filter = filterArg ? filterArg.split(',') : null

const tasksOf = (r) => [...new Set(r.cells.map((c) => c.task))]
const common = tasksOf(A).filter((t) => tasksOf(B).includes(t) && (!filter || filter.includes(t)))

const stat = (r) => {
  const out = {}
  for (const c of r.cells) {
    if (!common.includes(c.task)) continue
    const s = out[c.strategy] || (out[c.strategy] = { cells: 0, pass: 0, capFail: 0, trunc: 0, env: 0, truncRounds: 0, rounds: 0, refineChars: 0 })
    s.cells++
    if (c.score && c.score.env) { s.env++; continue }
    if (c.rigLimited) { s.trunc++; s.truncRounds += c.rounds.filter((x) => x.truncated).length }
    else if (c.score && c.score.pass) s.pass++
    else s.capFail++
    s.rounds += c.rounds.length
    if (c.refine) s.refineChars += c.refine.chars
  }
  return out
}
const pct = (a, b) => (b ? (Math.round(1000 * a / b) / 10).toFixed(1) + '%' : '—')
const fmt = (label, r) => {
  const s = stat(r)
  console.log('── ' + label + '  (maxTokens=' + r.config.maxTokens + ', R=' + r.config.rounds + ', rep=' + r.config.rep + ', 题集=' + common.join(',') + ')')
  console.log('   策略          格  通过  能力失败  截断  宽口径   严口径(截断算失败)  截断轮/总轮  精炼均字')
  for (const k of Object.keys(s)) {
    const x = s[k]
    const den = x.cells - x.env
    console.log('   ' + k.padEnd(13) + String(x.cells).padStart(3) + String(x.pass).padStart(6) + String(x.capFail).padStart(9) + String(x.trunc).padStart(6) +
      '  ' + pct(x.pass, den - x.trunc).padStart(6) + '   ' + pct(x.pass, den).padStart(8) + '         ' + (x.truncRounds + '/' + x.rounds).padStart(6) + '     ' + (x.cells ? Math.round(x.refineChars / x.cells) : 0))
  }
  return s
}
console.log('跨条件对比（只统计两次运行共有的题目）')
console.log('')
const sa = fmt('条件 A：' + A.tag, A)
console.log('')
const sb = fmt('条件 B：' + B.tag, B)
console.log('')
const one = (s) => { const k = Object.keys(s)[0]; return s[k] && (s[k].cells - s[k].env) ? (100 / (s[k].cells - s[k].env)) : null }
console.log('判读：1 格 = ' + (one(sa) ? one(sa).toFixed(1) : '?') + ' 个百分点（条件 A）/ ' + (one(sb) ? one(sb).toFixed(1) : '?') + ' 个百分点（条件 B）')
console.log('若两条件下名次不一致 → 名次由单轮输出上限造成，不能当作策略优劣。')
