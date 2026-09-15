// 子指标：命令是否要求"统一自检入口 + 真实运行输出 + 每项证据"（不改评分卡，零额外 LLM 成本）。
// 用法：node evidence/selfcheck-metric.cjs <results.json>
const fs = require('fs')
const path = require('path')
const ev = __dirname
const file = process.argv[2] || 'cx-036.json'
const res = JSON.parse(fs.readFileSync(path.join(ev, file), 'utf8'))
const cells = (res.cells || []).filter((c) => !c.skipped && String(c.command || '').trim())

// 三条可判定子项（概念级匹配，认说法不认某一种措辞）
const ENTRY = [/__selfcheck/i, /统一自检/, /自检入口/, /self-?check\s*entr/i]
const SHAPE = [/checks\s*[:=]/, /\bpass\b\s*[:=]/, /evidence/i, /每项.{0,6}(证据|pass)/, /结构化的?检查结果/]
const REALRUN = [/真实(运行|执行)输出/, /实跑输出/, /运行输出/, /附上.{0,6}输出/, /paste.{0,10}output/i, /actual\s+output/i]
const hitAny = (t, res2) => res2.some((r) => r.test(t))

const byVariant = {}
for (const c of cells) {
  const t = String(c.command || '')
  const v = c.variantId
  byVariant[v] = byVariant[v] || { n: 0, entry: 0, entryShape: 0, realRun: 0, full: 0, chars: [] }
  const b = byVariant[v]
  const e = hitAny(t, ENTRY), sh = hitAny(t, SHAPE), rr = hitAny(t, REALRUN)
  b.n += 1
  if (e) b.entry += 1
  if (e && sh) b.entryShape += 1
  if (rr) b.realRun += 1
  if (e && sh && rr) b.full += 1
  b.chars.push(t.length)
}
const mean = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
const rows = Object.keys(byVariant).map((v) => {
  const b = byVariant[v]
  const pct = (x) => (b.n ? Math.round((x / b.n) * 1000) / 10 : 0)
  return { variant: v, n: b.n, entry: pct(b.entry), entryShape: pct(b.entryShape), realRun: pct(b.realRun), full: pct(b.full), avgChars: mean(b.chars) }
}).sort((a, b) => b.full - a.full)
console.log('=== 子指标：统一自检入口（同一批命令，零额外成本）===')
console.log('  条件'.padEnd(18) + '格数  提到入口  入口+结构  要求真实输出  三项齐备  平均字数')
for (const r of rows) console.log('  ' + r.variant.padEnd(16) + String(r.n).padStart(4) + '   ' + String(r.entry + '%').padStart(7) + '   ' + String(r.entryShape + '%').padStart(8) + '   ' + String(r.realRun + '%').padStart(10) + '   ' + String(r.full + '%').padStart(7) + '   ' + String(r.avgChars).padStart(7))
fs.writeFileSync(path.join(ev, 'selfcheck-metric.json'), JSON.stringify({ at: new Date().toISOString(), file, rows }, null, 1), 'utf8')
console.log('')
console.log('WROTE evidence/selfcheck-metric.json')
const top = rows[0], ship = rows.find((r) => /SHIP/.test(r.variant))
if (top && ship) console.log('结论：三项齐备率 ' + top.variant + ' = ' + top.full + '% vs ' + ship.variant + ' = ' + ship.full + '%')
