// 把 lib/prompt-v011.js 内联进 lib/index.js（自包含，便于快照工具 eval 与日后回退），并删除该模块。
// 用法：node evidence/inline-v011.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)
const mod = fs.readFileSync(P('lib/prompt-v011.js'), 'utf8')
const start = mod.indexOf('{')
const end = mod.lastIndexOf('}')
const objText = mod.slice(start, end + 1)          // { basic: "...", advanced: "...", extreme: "..." }
let idx = fs.readFileSync(P('lib/index.js'), 'utf8')
// 去掉 import
idx = idx.split("import { LEGACY_V011 } from './prompt-v011.js'\n").join('')
if (idx.indexOf('const LEGACY_V011 = {') < 0) {
  const anchor = 'const SUBSTANCE_RULES = ['
  const block = [
    '// ⚠️ 优化策略回退：本常量逐字节取自 0.1.1 的 system 提示词（evidence/prompt-snapshot-v011.json）。',
    '// 依据：PTC 口径同口径实测（20 格/条件）——0.1.1 每条命令硬约束 3.2 个、流程开销 2.85 个；',
    '// 0.3.8 分别为 30.6 与 9.9（约 10× / 3.5×），长度 +48%，与"过度约束导致随机应变下降、开发时间变长、UI/操作退步"的实测反馈一致。',
    'const LEGACY_V011 = ' + objText,
    '',
  ].join('\n')
  if (idx.indexOf(anchor) < 0) { console.error('未找到插入锚点'); process.exit(1) }
  idx = idx.replace(anchor, block + anchor)
  console.log('INLINE ✓（' + objText.length + ' 字符）')
} else console.log('INLINE 已存在')
fs.writeFileSync(P('lib/index.js'), idx, 'utf8')
fs.unlinkSync(P('lib/prompt-v011.js'))
console.log('REMOVED lib/prompt-v011.js')
