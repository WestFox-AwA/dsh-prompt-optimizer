// P7 · **运行回顾**：把一次真实使用留下的东西，整理成"人能读、也能机器读"的一页。
//
//   node po06/scripts/recap.mjs [--home <DSH_HOME>] [--json <out.json>] [--session <id前缀>]
//
// 为什么需要（EV-0116）：0.6 在真实会话里跑过之后，留下的只有三样东西——
//   · `<home>/po06-wire.jsonl`  每轮用户输入的**判定台账**（成没成、包多大、第几版）
//   · `<home>/po06-state/*.json` 每个会话的**意图状态**（条目 + 出处）
//   · `<home>/po06-reports/*.json` 自检报告（只有显式自检才会写）
// 用户拿它跑一个真实项目时，最该被看见的两件事恰好都在这里，但**没人愿意读 JSONL**：
//   ① "它到底有没有参与？"——没参与要有可归因的理由（而不是安静地什么都不做，EV-0078）；
//   ② "它替我说了什么？"——哪些条目来自**我的话**、哪些是**机器补充**，有没有无出处的条目。
// 本脚本不调模型、不花钱，只读文件。
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseEnableIntent } from '../lib/assembly-gate.js'

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const HOME = opt('home', process.env.DSH_HOME || join(homedir(), '.dsh'))
const JSON_OUT = opt('json', null)
const ONLY = opt('session', null)
const WIRE = join(HOME, 'po06-wire.jsonl')
const STATE_DIR = join(HOME, 'po06-state')

/**
 * 台账缺失时，把"为什么一次都没被触发过"分成**三种可区分**的情况（EV-0134）。
 *
 * 为什么要分：用户装好 beta、按 README 跑一遍本脚本时看到的**正是这一页**。
 * 原来的措辞只有两种（"要么没启用，要么装到了别的 home"），**漏了第三种**——
 * 装了、也启用了，只是还没被用过；而这一种恰恰是"刚装好第一次看"的默认情形。
 * 那句话会让用户以为装错了地方：第一印象就是错的，而他没有任何别的线索可对照。
 */
function whyNoWire(home) {
  let profiles = []
  try { profiles = readdirSync(join(home, 'profiles')) } catch { /* 没有 profiles/ 就是没装 */ }
  // 与 check-install 同一条判据：profile 的 node_modules 里有没有这个包
  const installed = profiles.filter((p) => existsSync(join(home, 'profiles', p, 'node_modules', '@dsh-external', 'dsh-po06')))
  let enable = null
  try {
    const cfg = join(home, 'po06.json')
    if (existsSync(cfg)) enable = parseEnableIntent(readFileSync(cfg, 'utf8'))
  } catch { enable = null }
  return { installed, enable }
}

/** 人的来源 vs 机器的来源——这是"有没有冒充用户"的分界线。 */
const HUMAN_REF_KINDS = new Set(['human', 'user'])

const notes = []
const warnings = []
/** 跨会话串味的条目数（在下面第二节里算出来，供 `--json` 用；0 才是对的）。 */
let crossSessionRefs = 0

// ── ① 台账 ───────────────────────────────────────────────────────────
const records = []
let malformed = 0
if (existsSync(WIRE)) {
  for (const line of readFileSync(WIRE, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { records.push(JSON.parse(t)) } catch { malformed += 1 }
  }
} else {
  // 三种情况分开说（EV-0134）：没装 / 装了没启用 / 装了启用了但还没用过。
  const { installed, enable } = whyNoWire(HOME)
  const where = installed.length > 0 ? '（profile：' + installed.join('、') + '）' : ''
  if (installed.length === 0) {
    notes.push('没有找到 `po06-wire.jsonl`，而且**这个 home 里没有装 0.6**'
      + '（`profiles/*/node_modules` 下找不到 `@dsh-external/dsh-po06`）'
      + '——装法见 `po06/README.md`（装进一个**独立 profile**，别装进 0.5.x 那个）')
  } else if (enable && enable.ours && enable.settings && enable.settings.enabled) {
    notes.push('没有找到 `po06-wire.jsonl`：0.6 **装了、配置也是启用的**' + where
      + `（enabled=true / rollout=${enable.rollout.mode}），只是**还没有任何一次真实触发**。`
      + '用那个 profile 跑一轮真实输入，再回来看这一页')
  } else {
    const why = enable ? `ours=${enable.ours} / reason=${enable.reason || 'null'}` : '没有 `po06.json`'
    notes.push('没有找到 `po06-wire.jsonl`：0.6 **装了**' + where + '，但**启用没生效**（' + why + '）'
      + '——0.6 默认**不启用**，必须在 `<home>/po06.json` 里显式开启（装法见 `po06/README.md`）')
  }
}
if (malformed > 0) warnings.push('台账里有 ' + malformed + ' 行无法解析（被跳过）')

// ── ② 意图状态 ───────────────────────────────────────────────────────
const states = []
let badState = 0
if (existsSync(STATE_DIR)) {
  for (const f of readdirSync(STATE_DIR)) {
    if (!f.endsWith('.json')) continue
    try { states.push({ file: f, ...JSON.parse(readFileSync(join(STATE_DIR, f), 'utf8')) }) } catch { badState += 1 }
  }
} else {
  notes.push('没有找到 `po06-state/`（没有任何会话产生过意图状态）')
}
if (badState > 0) warnings.push('状态目录里有 ' + badState + ' 个文件无法解析（被跳过）')

const short = (id) => String(id || '?').replace(/^session-/, '').slice(0, 8)
const keep = (r) => !ONLY || String(r.sessionId || '').includes(ONLY)
const keepState = (s) => !ONLY || String(s.sessionId || '').includes(ONLY)

// ── ③ 输出 ───────────────────────────────────────────────────────────
const L = []
L.push('# 0.6 运行回顾')
L.push('')
L.push('- home：`' + HOME + '`')
L.push('- 台账：`po06-wire.jsonl` ' + (existsSync(WIRE) ? records.length + ' 条' : '（无）')
  + ' ｜ 状态：`po06-state/` ' + (existsSync(STATE_DIR) ? states.length + ' 个会话' : '（无）'))
if (ONLY) L.push('- 过滤：只含 session 前缀 `' + ONLY + '`')
L.push('')

const rs = records.filter(keep)
// ⚠ **分叉继承的台账记录不是"一轮输入"**（EV-0117）：它带 `trigger: 'fork-inherit'`，
// 没有 `chars`/`packetChars`/`ms`。混进逐轮统计会把"意图包非空比例"与耗时均值**拉低**，
// 而它恰恰是"分叉到底继承了没有"的**唯一证据**——所以单独成节，不能当噪声。
const turns = rs.filter((r) => r.trigger !== 'fork-inherit' && r.trigger !== 'state-unreadable')
const forks = rs.filter((r) => r.trigger === 'fork-inherit')
// ⚠ **读不出来的状态文件**（EV-0122）：这不是"没有状态"，而是**状态丢了**。
// 必须让用户看见——否则"从头开始"会被读成"这个会话本来就没约束"。
const unreadable = rs.filter((r) => r.trigger === 'state-unreadable')
if (unreadable.length > 0) {
  L.push('## ⚠ 读不出来的状态文件（' + unreadable.length + ' 次）')
  L.push('')
  L.push('这些会话的状态文件**存在但读不出来**（JSON 坏 / 形状不对）。0.6 的做法是：')
  L.push('把坏文件**改名留证据**（`.corrupt-<时间戳>.json`）、记一条台账，然后按"尚无状态"继续——')
  L.push('**绝不静默覆盖**。你积累的长期约束可能就在那份残骸里，值得看一眼。')
  L.push('')
  L.push('| 时间 | 会话 | 原因 | 残骸 |')
  L.push('|---|---|---|---|')
  for (const r of unreadable) {
    L.push('| ' + (String(r.at || '').slice(11, 19) || '?') + ' | `' + short(r.sessionId) + '` | '
      + String(r.reason || '?') + ' | '
      + (r.quarantined ? '`' + String(r.quarantined).split(/[\\/]/).pop() + '`' : '（改名失败）') + ' |')
  }
  L.push('')
  warnings.push('有 ' + unreadable.length + ' 个会话的状态文件**读不出来**（已隔离留证据）——'
    + '那些会话的长期约束可能丢了；残骸在 `' + STATE_DIR + '`')
}
if (forks.length > 0) {
  L.push('## 〇、分叉继承（' + forks.length + ' 次）')
  L.push('')
  L.push('宿主分叉会给子会话一个**新的 sessionId**；0.6 的状态按 id 存，不处理就是"静默无状态"。')
  L.push('下面每行 = 一次**真实发生**的继承（子会话首次触达时从父会话派生）：')
  L.push('')
  L.push('| 时间 | 子会话 | 继承自 | 继承到的版本 |')
  L.push('|---|---|---|---|')
  for (const r of forks) {
    L.push('| ' + (String(r.at || '').slice(11, 19) || '?') + ' | `' + short(r.sessionId) + '` | `'
      + short(r.inheritedFrom) + '` | ' + (r.revision ?? '?') + ' |')
  }
  L.push('')
  L.push('> 若这里**没有行**，而你又确实分叉过：说明继承**没发生**（子会话从零开始，且不会有任何提示）。')
  L.push('')
}
if (turns.length > 0) {
  const bySession = new Map()
  for (const r of turns) {
    const k = String(r.sessionId || '?')
    if (!bySession.has(k)) bySession.set(k, [])
    bySession.get(k).push(r)
  }
  const outcomes = {}
  for (const r of turns) outcomes[r.outcome || '(未记)'] = (outcomes[r.outcome || '(未记)'] || 0) + 1
  const pkt = turns.map((r) => Number(r.packetChars) || 0)
  const ms = turns.map((r) => Number(r.ms) || 0).filter((x) => x > 0)
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0)

  L.push('## 一、它有没有参与（逐轮判定）')
  L.push('')
  L.push('**' + bySession.size + ' 个会话 / ' + turns.length + ' 轮输入**；'
    + '判定结果：' + Object.entries(outcomes).map(([k, v]) => k + '×' + v).join('、'))
  L.push('')
  L.push('- 意图包：非空 **' + pkt.filter((x) => x > 0).length + '/' + turns.length + '** 轮，平均 ' + avg(pkt) + ' 字符')
  L.push('- 解释耗时：平均 ' + avg(ms) + ' ms（' + ms.length + ' 轮有记录）')
  L.push('')
  for (const [sid, list] of bySession) {
    L.push('### 会话 `' + short(sid) + '`（' + list.length + ' 轮）')
    L.push('')
    L.push('| 时间 | 输入字符 | 结果 | 包字符 | 版本 | 模型 | 轨迹 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const r of list) {
      const t = String(r.at || '').slice(11, 19) || '?'
      const model = [r.provider, r.model].filter(Boolean).join('/') || '?'
      const trace = Array.isArray(r.trace) ? r.trace.length + ' 步' : '?'
      L.push('| ' + t + ' | ' + (r.chars ?? '?') + ' | ' + (r.outcome || '?') + ' | ' + (r.packetChars ?? '?')
        + ' | ' + (r.revision ?? '?') + ' | ' + model + ' | ' + trace + ' |')
    }
    L.push('')
  }
  // 失败/跳过要单独列：这是"安静地什么都不做"的解药（EV-0078）
  const bad = turns.filter((r) => r.ok === false || (r.outcome && r.outcome !== 'committed'))
  if (bad.length > 0) {
    L.push('### ⚠ 没有正常提交的轮次（' + bad.length + '）')
    L.push('')
    for (const r of bad) {
      const why = r.reason || r.error || r.outcome || ''
      L.push('- `' + short(r.sessionId) + '` ' + String(r.at || '').slice(11, 19) + '：' + String(why).slice(0, 160))
    }
    L.push('')
  }
} else if (records.length > 0) {
  L.push('（台账里有记录，但都被 `--session` 过滤掉了）')
  L.push('')
}

const ss = states.filter(keepState)
if (ss.length > 0) {
  L.push('## 二、它替我说了什么（意图条目与出处）')
  L.push('')
  const noSource = []
  let human = 0, model = 0, other = 0
  L.push('| 会话 | 版本 | 阶段 | 条目 | 来自**我的话** | 机器补充 | 无出处 | 问题 |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const s of ss.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)))) {
    const items = Array.isArray(s.items) ? s.items : []
    let h = 0, m = 0, o = 0
    for (const it of items) {
      const refs = Array.isArray(it.sourceRefs) ? it.sourceRefs : []
      if (refs.length === 0) { noSource.push({ s: s.sessionId, it }); o += 1; continue }
      if (refs.some((r) => HUMAN_REF_KINDS.has(String(r && r.kind)))) h += 1
      else m += 1
    }
    human += h; model += m; other += o
    L.push('| `' + short(s.sessionId) + '` | ' + s.revision + ' | ' + (s.phase || '?') + ' | ' + items.length
      + ' | ' + h + ' | ' + m + ' | ' + (o || '') + ' | ' + ((s.questions || []).length || '') + ' |')
  }
  L.push('')
  L.push('**合计**：来自你的话 **' + human + '** 条 ｜ 机器补充 **' + model + '** 条 ｜ 无出处 **' + other + '** 条')
  L.push('')

  // ── **跨会话隔离**（EV-0120）：条目的出处必须落在**它自己所在的会话或它的祖先会话**里 ──
  // 为什么需要：宿主分叉时子会话会**继承父会话的条目**，那些条目的出处指向**父会话**是**正确**的
  // （"这句话是你在父会话里说的"）。所以判据不能写成"出处必须等于自己"——
  // 那会把合法继承全判成泄漏（本项目反复吃过"判据分不清两种情况"的亏：EV-0107/0108/0113）。
  // 正确判据：出处 ∈ {自己} ∪ {沿 inheritedFrom 一路往上的祖先}。
  // 指向链**之外**的会话 = 把别处的话当成你在这里说的 ⇒ 缺陷。
  const byId = new Map(states.map((s) => [String(s.sessionId), s]))
  const ancestry = (sid) => {
    const chain = new Set([String(sid)])
    let cur = byId.get(String(sid))
    let hops = 0
    while (cur && cur.inheritedFrom && hops < 10) {
      chain.add(String(cur.inheritedFrom))
      cur = byId.get(String(cur.inheritedFrom))
      hops += 1
    }
    return chain
  }
  const crossRefs = []
  for (const s of ss) {
    const allowed = ancestry(s.sessionId)
    for (const it of (s.items || [])) {
      for (const r of (Array.isArray(it.sourceRefs) ? it.sourceRefs : [])) {
        const rs = String((r && r.sessionId) || '')
        if (rs && !allowed.has(rs)) crossRefs.push({ s: s.sessionId, it, ref: rs })
      }
    }
  }
  crossSessionRefs = crossRefs.length
  L.push('- **跨会话隔离**：' + (crossRefs.length === 0
    ? '✅ 每条条目的出处都落在**自己的会话或其祖先会话**里（继承来的条目指向父会话是**正确**的）'
    : '❌ **' + crossRefs.length + ' 条条目的出处指向链外的会话**——那是把别处的话当成你在这里说的'))
  L.push('')
  if (crossRefs.length > 0) {
    L.push('### ⚠ 跨会话串味的条目（' + crossRefs.length + '）')
    L.push('')
    for (const x of crossRefs.slice(0, 20)) {
      L.push('- `' + short(x.s) + '` 的条目引用了 `' + short(x.ref) + '` 的话：'
        + String(x.it.text || '').slice(0, 100))
    }
    L.push('')
    warnings.push('有 ' + crossRefs.length + ' 条条目的出处指向**链外会话**（跨会话串味）')
  }

  L.push('> 读法：**"来自我的话"必须是你真说过的原话**（0.6 的契约要求逐字引文，对不上整份输出作废）；')
  L.push('> "机器补充"是它自己的判断，**不得被当成你的命令**。无出处条目**应当是 0**——不是 0 就是缺陷。')
  L.push('')
  if (noSource.length > 0) {
    L.push('### ⚠ 无出处的条目（' + noSource.length + '）——不该出现')
    L.push('')
    for (const x of noSource.slice(0, 20)) {
      L.push('- `' + short(x.s) + '` [' + x.it.kind + '] ' + String(x.it.text || '').slice(0, 120))
    }
    L.push('')
    // **进 warnings（⇒ 退出码非零）**：契约要求每条都带出处，
    // 无出处意味着"这条不知道是谁说的"——那是缺陷，不能只在正文里小声提一句。
    warnings.push('有 ' + noSource.length + ' 条意图条目**没有出处**（契约要求每条都带 sourceRefs）')
  }
  // 条目明细（默认只列有出处的，便于人逐条核对）
  L.push('### 条目明细')
  L.push('')
  for (const s of ss) {
    L.push('#### `' + short(s.sessionId) + '`')
    L.push('')
    for (const it of (s.items || [])) {
      const refs = Array.isArray(it.sourceRefs) ? it.sourceRefs : []
      const src = refs.length === 0 ? '**无出处**'
        : (refs.some((r) => HUMAN_REF_KINDS.has(String(r && r.kind))) ? '你说过' : '机器补充')
      L.push('- [' + (it.kind || '?') + '·' + (it.status || '?') + '·' + (it.scope || '?') + '] **' + src + '**：'
        + String(it.text || '').slice(0, 200))
    }
    const qs = s.questions || []
    if (qs.length > 0) {
      L.push('')
      L.push('- 问你的（' + qs.length + '）：')
      for (const q of qs) L.push('  - ' + String(q.text || q.question || JSON.stringify(q)).slice(0, 160))
    }
    L.push('')
  }
} else if (states.length > 0) {
  L.push('（状态里有会话，但都被 `--session` 过滤掉了）')
}

if (notes.length > 0) { L.push('## 说明'); L.push(''); for (const n of notes) L.push('- ' + n); L.push('') }
if (warnings.length > 0) { L.push('## ⚠ 警告'); L.push(''); for (const w of warnings) L.push('- ' + w); L.push('') }
L.push('---')
L.push('')
L.push('本页**只做事实整理，不做质量判定**：哪一版答案更好只能人读。'
  + '复现：`node po06/scripts/recap.mjs --home <DSH_HOME>`（不调模型、不花钱）。')

const text = L.join('\n') + '\n'
process.stdout.write(text)

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    home: HOME,
    wire: { path: WIRE, records: records.length, malformed, outcomes: records.reduce((a, r) => { a[r.outcome || '(未记)'] = (a[r.outcome || '(未记)'] || 0) + 1; return a }, {}) },
    state: { path: STATE_DIR, sessions: states.length, unparsable: badState },
    crossSessionRefs,
    sessions: ss.map((s) => ({
      sessionId: s.sessionId, revision: s.revision, phase: s.phase,
      items: (s.items || []).length, questions: (s.questions || []).length,
    })),
    warnings, notes,
  }, null, 2) + '\n', 'utf8')
}

// 退出码：**有警告就是非零**，好让它能进脚本链（但"没跑过"不算失败，那种情况只给说明）
process.exit(warnings.length > 0 ? 1 : 0)
