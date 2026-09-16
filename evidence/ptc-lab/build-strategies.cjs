// 生成策略清单：evidence/ptc-lab/strategies.json
// 每个候选策略 = 一段 system 提示词（取快照的 extreme 档，与插件真实调用档位一致）。
// 之后新增候选只需往清单里加一条，不必改宿主工具。
const fs = require('fs')
const path = require('path')
const EV = path.join(__dirname, '..')

const pick = (id, note) => {
  const p = path.join(EV, 'prompt-snapshot-' + id + '.json')
  if (!fs.existsSync(p)) return null
  const s = JSON.parse(fs.readFileSync(p, 'utf8'))
  const tiers = s.tiers || {}
  const pickTier = (t) => (tiers[t] && typeof tiers[t] === 'object' ? tiers[t].system : tiers[t])
  const sys = pickTier('extreme') || pickTier('advanced') || pickTier('basic')
  if (!sys) return null
  return { id, label: (s.label || id) + '（extreme ' + String(sys).length + ' 字符）', note: note || null, chars: String(sys).length, system: sys }
}

const wanted = [
  ['v5', '策略 v5 · 只补全要求（当前线上）'],
  ['v41', '策略 v4.1 · 覆盖优先+终局单次验证'],
  ['v4', '策略 v4 · 探针优先适应式计划'],
  ['v011', '0.1.1 原样（回退基线）'],
  ['v0310', '0.1.1 + PTC_RULES（0.3.10 线上）'],
  ['v038', '0.3.8 旧策略（过度约束，作对照）'],
]

const out = { at: new Date().toISOString(), strategies: {} }
for (const [id, note] of wanted) {
  const s = pick(id, note)
  if (s) out.strategies[id] = s
  else console.log('MISSING snapshot: ' + id)
}
// 无精炼对照：不做精炼，原话直送执行端（用于证明"精炼"本身有没有贡献）
out.strategies.norefine = { id: 'norefine', label: '无精炼对照（原话直送）', note: '对照组，system=null', chars: 0, system: null }

fs.writeFileSync(path.join(__dirname, 'strategies.json'), JSON.stringify(out, null, 1), 'utf8')
for (const k of Object.keys(out.strategies)) console.log('  ' + k.padEnd(10) + String(out.strategies[k].chars).padStart(5) + ' 字符   ' + out.strategies[k].label)
console.log('WROTE evidence/ptc-lab/strategies.json')
