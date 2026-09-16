// 重写 PTC_RULES 块：JS 字符串用单引号，内部引号一律用「」，彻底避开转义问题。
// 用法：node evidence/rewrite-ptc-rules.cjs
const fs = require('fs')
const path = require('path')
const p = path.join(__dirname, '..', 'lib', 'index.js')
let t = fs.readFileSync(p, 'utf8')
const start = t.indexOf('const PTC_RULES = [')
if (start < 0) { console.error('未找到 PTC_RULES'); process.exit(1) }
const endMark = t.indexOf('].join(', start)
if (endMark < 0) { console.error('未找到块尾'); process.exit(1) }
const end = t.indexOf('\n', endMark)
const BLOCK = [
  '// 面向 PTC 型执行体的交付形态（A/B/C，见 CHANGELOG v0.3.10）：',
  '// A 一次成程序（禁止分阶段/逐步/逐步贴输出/先建 goal·todo）；B 验收 ≤3 条且可机器判定；C 不写失败预案。',
  'const PTC_RULES = [',
  "  '# 交付形态（下游是 PTC 型执行体）',",
  "  '- 下游用一个程序（一段脚本、一次执行）把多步做完，没有逐步工具、每次往返都要重新起程序；所以命令要写成「一次交给它就能一次做完」的形态。',",
  "  '- 不得要求分阶段、逐步、每阶段贴输出、先建 goal/todo、先规划再动手——这类节奏在 PTC 里等于多轮往返，只会拉长时间、拉低成功率。',",
  "  '- 验收标准最多 3 条，每条必须可机器判定（数值、存在性、逐字符相等、退出码、可解析），不要散文式清单。',",
  "  '- 不要写失败预案；用一句话交代「任何不确定处走最保守路径并在交付里注明」即可。',",
  "  '- 拿不准的细节宁可留白让执行体自己决定，也不要堆「必须/不得」去钉死它；硬约束只保留真正不可协商的那几条。',",
  "].join('\\n')",
].join('\n')
t = t.slice(0, start) + BLOCK + t.slice(end)
fs.writeFileSync(p, t, 'utf8')
console.log('REWRITE ✓  ' + BLOCK.length + ' 字符')
