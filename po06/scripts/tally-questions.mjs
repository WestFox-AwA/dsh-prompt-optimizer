// P7 / E-001 · **用户判读的汇总脚本**（EV-0105；不调模型、不花钱）
//
//   node po06/scripts/tally-questions.mjs <units目录>
//
// 为什么固化在仓库里：EV-0088 那次的数字是在**临时脚本**里算出来的，脚本一删就**没人能复核**——
// 本轮差点重犯（EV-0105 的汇总表最初也在一份 %TEMP% 脚本里）。凡是要写进证据的数字，
// 都必须有一条别人能重跑的命令。
//
// ⚠ **按文本对齐，不按序号**：抽取器在本轮修了两次（A 27→24→25、C 41→34→36），序号整体错位；
// 按序号贴标记等于把用户对某条问句的判断安到**另一条**问句上——那是伪造证据。
//
// 规则（用户批准的计分法）：
//   - 用户**只需一个动作**：把"这条不该问"标 `[x]`；
//   - `[!]` 只好问（可查事实但两臂都无工具）、`[?]` 拿不准、`[-]` 非提问、`c-<id>` 语义重复 为可选标注；
//   - 分母 = 有效问句 − 非提问 − 重复 − 无法判断 − 歧义；**未标记 ≠ 合格**（未标记仍计入分母）；
//   - 抽取器判定**不是问句**的条目（代码片段）不进任何分母，但会把用户的标记列出来（那是被浪费的工作量）。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { auditQuestions, questionBreakdown } from '../lib/answer-audit.js'

const REPO = join(import.meta.dirname, '..')
const SHEET = join(REPO, 'eval', 'E001-S1-QUESTIONS.md')
const UNITS = process.argv[2]
if (!UNITS) {
  console.error('usage: node po06/scripts/tally-questions.mjs <unitsDir>')
  console.error('  unitsDir 形如 <隔离 home>/po06-e001-run2/units（36 个 <题>-<臂>-r<次>.md）')
  process.exit(2)
}

/** 用户标记 → 归类。**显式列出**所有形状，便于复核；不认识的原样报出来，不猜。 */
function classify(mark) {
  const m = mark.trim()
  if (m === 'x' || m === 'X') return { kind: '不该问' }
  if (m === '!') return { kind: '只好问' }
  if (m === '?') return { kind: '拿不准' }
  if (m === '-') return { kind: '非提问' }
  if (/^c-/.test(m)) return { kind: '重复', ref: m }
  if (/^似乎c-/.test(m)) return { kind: '重复', ref: m.replace('似乎', ''), uncertain: true }
  if (m.includes('同A25')) return { kind: '无法判断(代码片段)', ref: 'A25' }
  if (m.includes('疑似指令')) return { kind: '非提问', note: '用户倾向归为 -' }
  if (m.includes('似乎是-')) return { kind: '歧义(-还是!)', note: '用户自己也不确定' }
  if (m === '') return { kind: '未标记' }
  return { kind: '未识别', raw: m }
}

// ── 1. 读用户的打分表（格式：`- [<标记>] **A01** · H-07 · <问句原文>`）────────
const rows = []
for (const line of readFileSync(SHEET, 'utf8').split('\n')) {
  const m = line.match(/^- \[([^\]]*)\]\s*\*\*([AC]\d+)\*\*\s*·\s*(.*)$/)
  if (!m) continue
  // ⚠ 题号在第三组里（`**A01** · H-07 · 正文`），必须先剥掉再比对，否则永远匹配不上。
  rows.push({
    id: m[2], arm: m[2][0], task: (m[3].match(/^H-\d+/) || [''])[0],
    mark: m[1], q: m[3].replace(/^H-\d+\s*·\s*/, '').trim(), cls: classify(m[1]),
  })
}

// ── 2. 用**当前**抽取器重抽（按臂收集句子）────────────────────────────
const now = { A: [], C: [] }
// 置信拆分（EV-0136）：高置信 = 有问号；低置信 = 只靠征询措辞命中（混着计划句/约束句/命令）。
const conf = { A: { explicit: 0, 'marker-only': 0 }, C: { explicit: 0, 'marker-only': 0 } }
for (const f of readdirSync(UNITS).sort()) {
  const m = f.match(/^(H-\d+)-(A|C)-r(\d)\.md$/)
  if (!m) continue
  const text = readFileSync(join(UNITS, f), 'utf8')
  const q = auditQuestions({ answerText: text, label: f })
  for (const x of (q.questions || q.items || [])) now[m[2]].push({ task: m[1], unit: f, s: String(x.sentence || x.text || x.s || '') })
  const b = questionBreakdown(text)
  conf[m[2]].explicit += b.explicit
  conf[m[2]]['marker-only'] += b.markerOnly
}

// ── 3. 按文本对齐：归一化后取**最长公共前缀**（≥6 字符），并取最长的那个 ──────
// 为什么不用"前 N 字符相等"：打分表里有 11 个字符的短条目（`1. **顺序是否被语义依赖**`），
// 门槛设 12 会把**真问句**判成"抽取器已剔除"——那会**压低分母**、把结论做漂亮（本轮踩过）。
const norm = (s) => String(s).replace(/[\s`*_]/g, '').replace(/^[-–—]+/, '')
function match(arm, q) {
  const nq = norm(q)
  let best = null, bestScore = 0
  for (const c of now[arm]) {
    const nc = norm(c.s)
    const max = Math.min(nc.length, nq.length)
    let i = 0
    while (i < max && nc[i] === nq[i]) i++
    if (i >= 6 && i > bestScore) { bestScore = i; best = c }
  }
  return best
}

const matched = [], dropped = []
for (const r of rows) {
  const hit = match(r.arm, r.q)
  if (hit) matched.push({ ...r, task: hit.task, unit: hit.unit })
  else dropped.push(r)
}

// ── 4. 报表 ─────────────────────────────────────────────────────────
console.log('打分表条目：' + rows.length + '（A ' + rows.filter((r) => r.arm === 'A').length + ' / C ' + rows.filter((r) => r.arm === 'C').length + '）')
console.log('当前抽取器仍认作问句：' + matched.length + '  |  已判定不是问句（不进分母）：' + dropped.length)
// ⚠ **置信拆分**（EV-0136）：这两个数**不能相加**去比较两臂。低置信桶里混着
// 计划句 / 约束句 / 一行命令（实测：`ls -a # 看根目录有哪些构建入口`）——
// 它们不是"用户在问"，却被旧口径算进了"问句数"。
console.log('')
console.log('问句识别路径（**不可相加**）：')
for (const arm of ['A', 'C']) {
  const c = conf[arm]
  console.log(`  ${arm} 臂：高置信（有问号）${c.explicit} ｜ 低置信（仅措辞命中）${c['marker-only']}`)
}
console.log('  ⚠ 低置信桶混合置信：含真问句，也含计划句/约束句/代码行（逐条见 audit-clarify.mjs 的输出）。')
console.log('  ⚠ 因此"某臂问得更多"**不能**由两桶之和支持——那正是 EV-0136 更正的用法。')
console.log('')

const KINDS = ['不该问', '只好问', '拿不准', '非提问', '重复', '无法判断(代码片段)', '歧义(-还是!)', '未标记', '未识别']
const out = {}
for (const a of ['A', 'C']) {
  const rs = matched.filter((r) => r.arm === a)
  const droppedA = dropped.filter((r) => r.arm === a)
  console.log('=== ' + a + ' 臂：有效问句 ' + rs.length + ' 条' + (droppedA.length ? '（另有 ' + droppedA.length + ' 条判为非问句，剔除）' : '') + ' ===')
  for (const k of KINDS) {
    const n = rs.filter((r) => r.cls.kind === k).length
    if (n) console.log('  ' + k.padEnd(20) + n)
  }
  const ex = (k) => rs.filter((r) => r.cls.kind === k).length
  const denom = rs.length - ex('非提问') - ex('重复') - ex('无法判断(代码片段)') - ex('歧义(-还是!)')
  console.log('  ---')
  console.log('  分母（有效问句 − 非提问 − 重复 − 无法判断 − 歧义）：' + denom)
  console.log('  分子（不该问）：' + ex('不该问'))
  console.log('  （另有 ' + ex('未标记') + ' 条未标记，仍计入分母——未标记不等于合格）')
  console.log('')
  out[a] = { valid: rs.length, denom, bad: ex('不该问'), unmarked: ex('未标记'), dropped: droppedA.length }
}

console.log('被剔除的"伪问句"（抽取器旧版误判；用户的标记对这些条目无效 = 被浪费的工作量）：')
for (const d of dropped) console.log('  ' + d.id + ' [' + d.mark + '] ' + d.q.slice(0, 64))

const dups = matched.filter((r) => r.cls.kind === '重复')
console.log('')
console.log('重复项 ' + dups.length + ' 条：臂内 ' + dups.filter((r) => r.cls.ref && r.cls.ref[2] === r.arm).length
  + ' / 跨臂 ' + dups.filter((r) => r.cls.ref && r.cls.ref[2] !== r.arm).length)
const needConfirm = matched.filter((x) => ['歧义(-还是!)', '未识别'].includes(x.cls.kind))
if (needConfirm.length) {
  console.log('需要人确认的自由文本标记：')
  for (const r of needConfirm) console.log('  ' + r.id + ' [' + r.mark + '] ' + r.q.slice(0, 60))
}
const unmarked = matched.filter((r) => r.cls.kind === '未标记')
if (unmarked.length) { console.log('未标记的条目：'); for (const r of unmarked) console.log('  ' + r.id + ' ' + r.q.slice(0, 60)) }

console.log('')
console.log('JSON: ' + JSON.stringify(out))
