// P4 · **澄清（回问）机制的对照仪器**：把三样东西并排放——
//   ① 留出集**事先写好的**理想行为（判据行里那句"问前者、自定后者"）
//   ② 意图包**声明**了哪些未决项，以及每一项的处置（别问 / 自己定 / 该问）
//   ③ 答案**实际**问了几句（复用 EV-0106 之后修好的问句抽取器）
//
//   node po06/scripts/audit-clarify.mjs --packets <dir> --units <dir> [--holdout <path>] [--json <out>]
//
// 为什么需要它（EV-0136）：S1 只数了"两臂各问了几句"（A 25 / C 36），**没有**问
// "问得有没有道理"——而 0.6 的立身主张恰恰是**分流**：查得到的自己查、真偏好问用户、
// 可逆细节自己定。"问得多少"不是判据，"问对了没有"才是。本仪器把这套分流放到台面上。
//
// ⚠ **明确不做**：不做"某一问对应哪一条未决项"的自动匹配。关键词匹配这一族
// （EV-0106 的 `implQuestions` 单词命中指标）已经被撤回过一次：它把任务名词当实现标记，
// 结论不可靠。所以本仪器只给**可数的东西**（条目分类数、问句数）与两条**值得看一眼**的提示，
// 判读留给人。分类依据是包里的**措辞标记**（模型写的），不是结构化字段——
// 措辞变了这一栏就会变，所以每一项都把命中的原话一起打出来，便于核对。
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { questionSentences, questionBreakdown } from '../lib/answer-audit.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const PACKETS = opt('packets', null)
const UNITS = opt('units', null)
const HOLDOUT = opt('holdout', join(ROOT, 'eval', 'HOLDOUT-v2.md'))
const JSON_OUT = opt('json', null)

/**
 * 未决项条目的**处置分类**——按包里出现的措辞标记判，判据与顺序都写死在这里：
 *   ① `no-ask`（查得到的，别问用户）——"不要回问用户" / "通过读取…来确定" / "自行查证"
 *   ② `decide-yourself`（可逆细节，自己定）——"由工作 AI 自行决定" / "可逆实现细节" / "自行决定"
 *   ③ `ask`（会影响结果、要用户拍板）——以上都没有 ⇒ **默认**归到这一类
 * 顺序不能反：查得到的那条里常常同时写着"自行确定"，先判 ① 才不会误判成 ②。
 */
export const DISPOSITIONS = Object.freeze([
  { key: 'no-ask', re: /不要回问用户|不回问用户|通过读取[^。；]*来确定|自行查证|先自行查/ },
  { key: 'decide-yourself', re: /由工作 AI 自行决定|工作 AI 自行决定|可逆(的)?实现细节|自行决定/ },
])

/** 给一行未决项判处置；返回 {key, marker}。 */
export function classifyItem(line) {
  const text = String(line || '')
  for (const d of DISPOSITIONS) {
    const m = text.match(d.re)
    if (m) return { key: d.key, marker: m[0] }
  }
  return { key: 'ask', marker: null }
}

/** 解析一个意图包：抽出【未决项…】小节里的条目（含处置分类）。 */
export function parsePacket(text) {
  const lines = String(text || '').split('\n')
  const items = []
  let inSection = false
  const sectionRe = /^【未决项[^】]*】/
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^【/.test(line)) { inSection = sectionRe.test(line); continue }
    if (!inSection) continue
    if (!line.startsWith('-')) continue
    const body = line.replace(/^-\s*/, '')
    const c = classifyItem(body)
    items.push({ text: body, disposition: c.key, marker: c.marker })
  }
  return items
}

/** 从单元文件名里读题号/臂/轮次：`H-12-C-r3.md`。 */
export function parseUnitName(name) {
  const m = String(name).match(/^(.+?)-(A|B|C|D)-r(\d+)\.md$/)
  if (!m) return null
  return { taskId: m[1], arm: m[2], run: Number(m[3]) }
}

/** 从留出集里摘出某题的判据行（事先写好的理想行为）。
 *  ⚠ **判据常跨两行**：`（判据：…会影响结果；` 换行后才是 `…理想行为：问前者、自定后者。）`
 *  ——"理想行为"这句恰好在**续行**上，只收首行就等于把最要紧的那句丢了（本轮实测踩到）。
 *  所以判据块要一路收到空行或下一题为止。 */
export function rubricFor(holdoutText, taskId) {
  const lines = String(holdoutText || '').split('\n')
  const head = new RegExp('^\\*\\*' + taskId + '(\\b|\\s|·|\\*)')
  const i = lines.findIndex((l) => head.test(l.trim()))
  if (i < 0) return null
  const out = []
  let inRubric = false
  for (let j = i; j < Math.min(lines.length, i + 14); j++) {
    const l = lines[j].trim()
    if (j > i && /^\*\*H-\d+/.test(l)) break          // 下一题开始
    if (/^（判据：|^\(判据：/.test(l)) { inRubric = true; out.push(l); continue }
    if (inRubric) {
      if (!l || /^\*\*/.test(l)) break                // 判据块结束
      out.push(l); continue
    }
    if (/^> |^\*\*H-\d+/.test(l)) out.push(l)
  }
  return out.length > 0 ? out.join(' ') : null
}

function listFiles(dir, filter) {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir).filter(filter).sort()
}

// ⚠ 下面这段**只在被当作脚本运行时执行**（`isMain` 守卫）。
// 为什么需要（EV-0136）：本文件的纯函数（分类/解析/判据摘取）要被单测直接 import；
// 而脚本式顶层代码一被 import 就会**立刻按 test 的 argv 跑一遍并 process.exit**——
// 实测表现是"套件一行 JSON 都不输出"（看起来像测试工具坏了，其实是被测文件自己跑了）。
function isMain() {
  try { return import.meta.url === pathToFileURL(process.argv[1]).href } catch { return false }
}

function main() {
const packets = {}
for (const f of listFiles(PACKETS, (x) => x.endsWith('.md'))) {
  packets[basename(f, '.md')] = parsePacket(readFileSync(join(PACKETS, f), 'utf8'))
}
const units = []
for (const f of listFiles(UNITS, (x) => x.endsWith('.md'))) {
  const meta = parseUnitName(f)
  const text = readFileSync(join(UNITS, f), 'utf8')
  const b = questionBreakdown(text)
  units.push({ file: f, meta, questions: b.total, explicit: b.explicit, markerOnly: b.markerOnly, chars: text.length })
}

// ── 汇总：逐题 ────────────────────────────────────────────────────────
const holdoutText = existsSync(HOLDOUT) ? readFileSync(HOLDOUT, 'utf8') : ''
const taskIds = [...new Set([...Object.keys(packets), ...units.map((u) => u.meta && u.meta.taskId).filter(Boolean)])].sort()
const rows = []
const flags = []
for (const taskId of taskIds) {
  const items = packets[taskId] || null
  const byClass = { 'no-ask': 0, 'decide-yourself': 0, ask: 0 }
  for (const it of items || []) byClass[it.disposition] += 1
  const us = units.filter((u) => u.meta && u.meta.taskId === taskId)
  const arms = {}
  for (const u of us) {
    arms[u.meta.arm] = arms[u.meta.arm] || []
    arms[u.meta.arm].push({ run: u.meta.run, questions: u.questions, explicit: u.explicit, markerOnly: u.markerOnly, chars: u.chars })
  }
  rows.push({ taskId, rubric: rubricFor(holdoutText, taskId), packet: items ? { items: items.length, byClass } : null, arms })

  if (!items) {
    if (us.length > 0) flags.push({ taskId, kind: 'packet-missing', note: '有答案但没有对应的意图包 ⇒ 这一题的处置无从判断（仅记事实）' })
    continue
  }
  // ① 什么都没有声明，却在问 ⇒ 摩擦（值得看一眼）
  if (items.length === 0) {
    const asked = us.filter((u) => u.questions > 0)
    if (asked.length > 0) {
      flags.push({ taskId, kind: 'asked-when-nothing-undecided', note: '包里没有未决项，却有 ' + asked.length + ' 个单元在提问（可能是在问可查/可逆的事）', units: asked.map((u) => u.file) })
    }
  } else if (byClass.ask > 0) {
    // ② 声明了"要用户拍板"的事，某臂**一次都没问** ⇒ 可能漏问（值得看一眼）
    for (const [arm, list] of Object.entries(arms)) {
      if (list.length > 0 && list.every((x) => x.questions === 0)) {
        flags.push({ taskId, kind: 'silent-when-undecided', note: `包里有 ${byClass.ask} 条"要用户拍板"的未决项，但 ${arm} 臂 ${list.length} 轮一次都没问`, arm })
      }
    }
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────
const report = {
  probe: 'po06-audit-clarify', phase: 'P4', at: new Date().toISOString(),
  packetsDir: PACKETS, unitsDir: UNITS, holdout: HOLDOUT,
  tasks: rows, flags,
  note: '把"留出集事先写好的理想行为 / 包声明的未决项处置 / 答案实际问了几句"并排；'
    + '**不做**条目与问句的自动匹配（关键词匹配已因不可靠被撤回，见 EV-0106）。'
    + 'flags 是"值得看一眼"，不是判据结论。不调模型、不花钱。',
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n', 'utf8')

const say = (s = '') => process.stdout.write(s + '\n')
say('# 澄清（回问）机制对照 · ' + rows.length + ' 题 / ' + units.length + ' 个单元')
say('')
say('- 意图包：`' + (PACKETS || '(未给)') + '` ｜ 单元：`' + (UNITS || '(未给)') + '`')
say('- 留出集：`' + HOLDOUT + '`')
say('')
for (const r of rows) {
  say('## ' + r.taskId)
  if (r.rubric) say('- **事先写好的理想行为**：' + r.rubric.replace(/\s+/g, ' ').slice(0, 220))
  if (!r.packet) {
    say('- 意图包：**缺**（无从判断处置）')
  } else {
    const c = r.packet.byClass
    say(`- 包声明的未决项：**${r.packet.items}** 条 = 该问用户 ${c.ask} ｜ 自己查 ${c['no-ask']} ｜ 自己定 ${c['decide-yourself']}`)
  }
  for (const [arm, list] of Object.entries(r.arms)) {
    const total = list.reduce((s, x) => s + x.questions, 0)
    const ex = list.reduce((s, x) => s + x.explicit, 0)
    const mk = list.reduce((s, x) => s + x.markerOnly, 0)
    // 报数一律带置信拆分（EV-0136）：光给一个总数会再次把两桶混起来比较。
    say(`- ${arm} 臂提问：合计 **${total}** = 高置信（有问号）${ex} ＋ 低置信（仅措辞）${mk}`
      + ` ｜ 逐轮：${list.map((x) => x.run + ':' + x.questions).join('  ')}`)
  }
  say('')
}
if (flags.length > 0) {
  say('## ⚠ 值得看一眼（不是结论）')
  say('')
  for (const f of flags) say('- `' + f.taskId + '` · ' + f.kind + '：' + f.note)
  say('')
} else {
  say('## ✅ 没有触发任何提示（两条提示的判据见脚本顶部注释）')
  say('')
}
say('> 读法：**"该问的问了没有"看的是留出集事先写好的判据行**，不是我的事后判断；')
say('> 本页只整理事实，不下"效果更好"的结论。复现：`node po06/scripts/audit-clarify.mjs --packets <dir> --units <dir>`（不调模型）。')

// 什么都没读到 ⇒ 明确报"无从审计"（退出码 2：与"审计通过"区分开）
if (rows.length === 0) {
  console.error('没有读到任何意图包或单元 ⇒ 无从审计（检查 --packets / --units 路径）')
  process.exit(2)
}
process.exit(0)
}

if (isMain()) main()
