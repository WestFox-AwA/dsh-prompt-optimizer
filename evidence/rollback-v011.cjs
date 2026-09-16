// 优化策略回退到 0.1.1（UI/功能不动）+ PTC 提示写入中英文文档顶部 + 0.3.9-beta.1 发布准备。
// 做法：把 0.1.1 的三档 system 原样生成独立模块 lib/prompt-v011.js，并在 buildSystem 里优先返回它。
// 用法：node evidence/rollback-v011.cjs
const fs = require('fs')
const path = require('path')
const P = (f) => path.join(__dirname, '..', f)

// 1) 生成 lib/prompt-v011.js（逐字节取自 0.1.1 快照）
const snap = JSON.parse(fs.readFileSync(P('evidence/prompt-snapshot-v011.json'), 'utf8'))
const lines = [
  '// 由 evidence/rollback-v011.cjs 生成：0.1.1 的三档 system 原文（逐字节取自 prompt-snapshot-v011.json）。',
  '// 用途：优化策略回退到 0.1.1（PTC 口径实测：0.1.1 的硬约束密度/流程开销显著低于 0.3.x）。',
  'export const LEGACY_V011 = {',
]
for (const tier of ['basic', 'advanced', 'extreme']) {
  lines.push('  ' + tier + ': ' + JSON.stringify(snap.tiers[tier].system) + ',')
}
lines.push('}')
lines.push('export const LEGACY_V011_SOURCE = ' + JSON.stringify(path.basename('prompt-snapshot-v011.json')) + '')
fs.writeFileSync(P('lib/prompt-v011.js'), lines.join('\n') + '\n', 'utf8')
console.log('WROTE lib/prompt-v011.js  (' + ['basic', 'advanced', 'extreme'].map((t) => t + '=' + snap.tiers[t].system.length).join(' ') + ')')

// 2) 打补丁：import + buildSystem 优先返回 0.1.1
let idx = fs.readFileSync(P('lib/index.js'), 'utf8')
if (idx.indexOf("from './prompt-v011.js'") < 0) {
  const firstImport = idx.indexOf('\n', idx.indexOf('import '))
  idx = idx.slice(0, firstImport + 1) + "import { LEGACY_V011 } from './prompt-v011.js'\n" + idx.slice(firstImport + 1)
  console.log('PATCH import ✓')
}
const OLD_FN = 'function buildSystem(tier, opts) {\n  const spec = TIER_PARTS[tier] || TIER_PARTS.basic'
const NEW_FN = [
  'function buildSystem(tier, opts) {',
  '  // 优化策略回退到 0.1.1：PTC 口径实测显示 0.3.x 的硬约束密度与流程开销高一个量级，',
  '  // 导致下游（用一个 TS 程序组合多步的 PTC agent）被过度约束、开发时间变长、随机应变下降。',
  '  // 只回退"优化策略"（system 提示词），不改任何 UI 与功能。',
  '  if (LEGACY_V011[tier]) {',
  '    const o = opts || {}',
  '    return o.projectContext === true ? LEGACY_V011[tier] + "\\n\\n" + ADVANCED_CONTEXT_SUFFIX : LEGACY_V011[tier]',
  '  }',
  '  const spec = TIER_PARTS[tier] || TIER_PARTS.basic',
].join('\n')
if (idx.indexOf('if (LEGACY_V011[tier]) {') >= 0) console.log('PATCH buildSystem 已存在')
else if (idx.indexOf(OLD_FN) >= 0) { idx = idx.replace(OLD_FN, NEW_FN); fs.writeFileSync(P('lib/index.js'), idx, 'utf8'); console.log('PATCH buildSystem ✓') }
else console.log('PATCH buildSystem ✗ 未找到锚点')

// 3) 版本串 → 0.3.9-beta.1
for (const [f, a, b] of [
  ['lib/client.js', '0.3.8beta1', '0.3.9beta1'],
  ['lib/client.js', 'build: "v0.3.8-beta.1"', 'build: "v0.3.9-beta.1"'],
  ['package.json', '"version":  "0.3.8-beta.1"', '"version":  "0.3.9-beta.1"'],
  ['package.json', '（v0.3.8-beta.1 · 复杂任务能力包', '（v0.3.9-beta.1 · 0.1.1 策略回退版'],
]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(a) < 0) { console.log('VER SKIP ' + f); continue }
  fs.writeFileSync(P(f), t.split(a).join(b), 'utf8'); console.log('VER ' + f + ' → ' + b.slice(0, 34))
}

// 4) PTC 提示放在中英文文档最上方（标题行之后）
const NOTICE_ZH = '> ## ⚠️ 请务必注意：本插件针对 **PTC 模式** 进行优化\n>\n> **建议在 PTC 模式下使用本插件**；否则可能**无法实现明显的效果提升**，**不排除在其他模式下出现倒退的可能性**。'
const NOTICE_EN = '> ## ⚠️ Important: this plugin is optimized for **PTC mode**\n>\n> **Use it in PTC mode.** In other modes it may **fail to deliver a noticeable improvement**, and a **regression is not ruled out**.'
for (const [f, notice, marker] of [['README.md', NOTICE_ZH, 'PTC 模式** 进行优化'], ['README.en.md', NOTICE_EN, 'optimized for **PTC mode**']]) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(marker) >= 0) { console.log('NOTICE SKIP ' + f); continue }
  const ls = t.split('\n')
  const i = ls.findIndex((l) => l.trim().startsWith('# '))
  ls.splice(i + 1, 0, '', notice)
  fs.writeFileSync(P(f), ls.join('\n'), 'utf8'); console.log('NOTICE ' + f + ' ✓（第 ' + (i + 3) + ' 行起）')
}
