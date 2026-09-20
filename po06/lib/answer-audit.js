// P7 · **回答审计**：把"越界 / 放大约束"从印象变成可复现的抽取
//
// 为什么需要它：D 臂最刺眼的失败不是"画得差"，而是**它替用户把话说重了**——
// 用户只说"不要预览文件夹内的其他文件"，0.5.x 的命令写成
// 「不读取、不预览、不引用任何其它文件，**也不向任何网络地址发请求**」，
// 还自行决定"未得到答复前按**完全离线、零请求**实现"。
// 这类放大**可以在文本上抽出来**，不需要钱、不需要审美判断。
//
// ⚠ 本模块**只报事实，不判质量**。它给出的每条都是"这句话里有禁止/绝对词，
//   而用户的原话里找不到对应说法"，并**逐条列出原句**供人复核。
//   **已知的假阳性类别**：那些"关于意图包自身"的说明（如
//   「不要替我拍板」是在告诉工作 AI 别把未决项当已决），
//   并不是对交付物的约束。这一层语义区分**本模块不做**，必须人来读。

/** 禁止类标记：出现即说明这句话在**禁止**什么。 */
export const PROHIBITION_MARKERS = Object.freeze([
  '禁止', '不得', '不许', '不准', '绝不', '严禁', '不可', '勿', '不要', '别',
])

/** 绝对类标记：出现即说明这句话把范围**放大到了无条件**。 */
export const ABSOLUTE_MARKERS = Object.freeze([
  '任何', '一律', '完全', '绝对', '必须', '只能', '全部', '所有', '始终', '从不', '零',
])

/** 取 CJK 与拉丁词的双字/单词片段，用于"这句话谈的东西用户提过没有"。 */
export function tokens(text) {
  const s = String(text == null ? '' : text)
  const out = new Set()
  // 拉丁词（≥2 字符）
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.-]{1,}/g)) out.add(m[0].toLowerCase())
  // CJK 双字片段
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i + 2 <= cjk.length; i++) out.add(cjk.slice(i, i + 2))
  return out
}

/** 按句/分句切开（中文标点 + 换行 + 列表符）。 */
export function clauses(text) {
  return String(text == null ? '' : text)
    .split(/[\n。；;！!？?]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function markersIn(clause) {
  const hit = []
  for (const m of PROHIBITION_MARKERS) if (clause.includes(m)) hit.push(m)
  for (const m of ABSOLUTE_MARKERS) if (clause.includes(m)) hit.push(m)
  return hit
}

/**
 * 抽出"疑似放大"的句子：
 * 含禁止/绝对标记，且**这句话里的字词与用户原话没有任何交集** ⇒ 用户在说别的事。
 * @returns {{clause:string, markers:string[], overlap:number}[]}
 */
export function suspectAmplifications({ userText, answerText, minClauseChars = 4 }) {
  const ut = tokens(userText)
  const out = []
  for (const c of clauses(answerText)) {
    if (c.replace(/\s/g, '').length < minClauseChars) continue
    const markers = markersIn(c)
    if (markers.length === 0) continue
    let overlap = 0
    for (const t of tokens(c)) if (ut.has(t)) overlap += 1
    if (overlap === 0) out.push({ clause: c, markers, overlap: 0 })
  }
  return out
}

/**
 * 用户明确说过的**禁止**（用于对照：这些是"用户自己要求的"，不算放大）。
 * @returns {{clause:string, markers:string[]}[]}
 */
export function userProhibitions(userText) {
  return clauses(userText)
    .map((c) => ({ clause: c, markers: markersIn(c) }))
    .filter((x) => x.markers.length > 0)
}

/**
 * 审计一份回答。
 * @returns 事实清单（**不含**任何质量判定）
 */
export function auditAnswer({ userText, answerText, label = null }) {
  const suspects = suspectAmplifications({ userText, answerText })
  const userProh = userProhibitions(userText)
  const ut = tokens(userText)
  // 原话里的实词有多少出现在回答里（"有没有把用户的话带上"的粗略代理）
  const userTokens = [...ut].filter((t) => /[\u4e00-\u9fff]/.test(t))
  const carried = userTokens.filter((t) => tokens(answerText).has(t))
  return {
    label,
    userProhibitionCount: userProh.length,
    userProhibitions: userProh.map((x) => x.clause),
    /** 疑似放大：含禁止/绝对词、且与用户原话零交集 */
    suspectCount: suspects.length,
    suspects,
    /** 用户用词在回答中的覆盖率（0–1）；**只是代理，不是质量** */
    userTokenCoverage: userTokens.length === 0 ? null : Math.round((carried.length / userTokens.length) * 100) / 100,
    /** 必须由人判断的那一层，写进结果里，免得被当成结论 */
    needsHumanRead: suspects.length > 0
      ? '这些句子需要人读一遍：有些是"关于意图包自身"的说明（假阳性），有些是真的替用户加了约束。'
      : null,
  }
}

/** 人读的对照文本。 */
export function renderAudit(audits) {
  const L = []
  L.push('# 回答审计（事实抽取，**不是质量评分**）')
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 用户自己说过的禁止/绝对句：**' + a.userProhibitionCount + '** 条')
    for (const c of a.userProhibitions) L.push('  - ' + c)
    L.push('- 疑似放大（含禁止/绝对词且与用户原话**零交集**）：**' + a.suspectCount + '** 条')
    for (const s of a.suspects) L.push('  - [' + s.markers.join('') + '] ' + s.clause)
    L.push('- 用户用词覆盖率（代理指标）：' + (a.userTokenCoverage === null ? 'n/a' : a.userTokenCoverage))
    if (a.needsHumanRead) L.push('- ⚠ ' + a.needsHumanRead)
    L.push('')
  }
  return L.join('\n')
}

// ── 问句审计：**该问的问了、不该问的没问** ─────────────────────────────
//
// 判据直接来自留出集 H-12 原文：
//   「「彩色」用哪些颜色、哪些信息上色**会影响结果**；而用哪个颜色库属**可逆实现细节**。
//     理想行为：**问前者、自定后者**。」
// 这条判据**工具帮不上忙**（库的选择不是"查一下就知道"的事实），
// 所以在"无工具单次补全"的对照里它依然有判别力——
// 而且实测的 A 臂（无插件）**正好违反了它**：它去问"是否允许加依赖？Node: chalk / picocolors"。

/** 实现细节：这些是"工作 AI 应当自己定"的（可逆、无需求信息）。 */
export const IMPLEMENTATION_MARKERS = Object.freeze([
  '库', '依赖', 'library', 'chalk', 'picocolors', 'colorama', 'rich', 'click',
  '框架', 'framework', 'npm', 'pip', '版本', '封装函数', '技术栈',
])
// ⚠ **`package` 已从此表移除**（EV-0094）：它是 **H-07 的题面名词**，不是"实现细节"的标志。
// 实测后果：`classifyQuestion('请确认要改的是根目录还是某个子包的 package.json')`
// 原先命中 impl=['package'] ⇒ 被判为"实现细节类"，于是**越贴题的回答越容易被误判成多问**。
// 一般化的教训：**任务本身的名词绝不能进分类词表**。
//
// ⚠⚠ **残留局限（必须与任何结论一起读）**：本分类器只是**粗粒度关键词提示**，
// 不是"这句到底在问什么"的理解；优先级 impl > pref > fact 同样会误判
// （例："用 chalk 还是 picocolors" 含偏好词「还是」，实质却是实现选择）。
// ⇒ **不得把 implQuestions / prefQuestions 当判据**：EV-0094 正是因为拿它当判据
// 而给出了错误结论并已撤回。要判"该不该问"**只能人读**。

/** 用户偏好：这些**会影响结果**，问是对的。 */
export const PREFERENCE_MARKERS = Object.freeze([
  '哪些', '哪部分', '哪几', '范围', '风格', '配色', '色调', '主题', '偏好',
  '你希望', '你倾向', '要多', '程度', '深浅', '语义', '规范', '还是',
])

/** 可查事实：这些在**有工具**时该自己查；无工具时问是不得已，另记。 */
export const FACT_MARKERS = Object.freeze([
  '在哪', '路径', '仓库', '目录', '文件名', '贴出', '代码位置', '多少', '耗时', '多久',
])

/** 问句识别：以问号结尾，或含疑问/征询措辞。 */
const QUESTION_RE = /[？?]|是否|能否|可否|要不要|需要我|请确认|请告诉我|你希望|你倾向|哪种|哪一个|哪些|请问|还是/

export function isQuestion(sentence) {
  return QUESTION_RE.test(sentence)
}

/**
 * 切出**问句**。
 * ⚠ 不能用 `clauses()`：它按 `？?` 切分，等于把问句唯一的问号**吃掉**，
 * 于是 "请问着色范围要哪些？" 变成 "请问着色范围要哪些" —— 问句特征就没了。
 * （实测踩到：理想行为那条用例因此判不出偏好问句。）所以这里**不按问号切**。
 */
export function questionSentences(text) {
  return String(text == null ? '' : text)
    .split(/[\n。；;！!]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && isQuestion(x))
}

/** 给一条问句分类（多类命中时按 实现 > 偏好 > 事实 优先级取一个，并保留全部命中）。 */
export function classifyQuestion(sentence) {
  const s = String(sentence || '')
  const impl = IMPLEMENTATION_MARKERS.filter((m) => s.includes(m))
  const pref = PREFERENCE_MARKERS.filter((m) => s.includes(m))
  const fact = FACT_MARKERS.filter((m) => s.includes(m))
  let kind = 'other'
  if (impl.length > 0) kind = 'implementation'
  else if (pref.length > 0) kind = 'preference'
  else if (fact.length > 0) kind = 'fact'
  return { sentence: s, kind, impl, pref, fact }
}

/**
 * 审计一份回答里的问句。
 * ⚠ 只报事实与分类；**"该不该问"的判断依赖 H-12 那条判据**，写在这里是为了可复核。
 */
export function auditQuestions({ answerText, label = null }) {
  const qs = questionSentences(answerText).map(classifyQuestion)
  const counts = { implementation: 0, preference: 0, fact: 0, other: 0 }
  for (const q of qs) counts[q.kind] += 1
  return {
    label,
    questions: qs,
    counts,
    total: qs.length,
    /** 按留出集 H-12 的判据：问了实现细节 = 越俎代庖（本可自定） */
    asksImplementation: counts.implementation > 0,
    asksPreference: counts.preference > 0,
    note: '按 H-12 判据：**偏好该问、实现细节该自定**。'
      + '这里只做分类，扣不扣分由判据决定，不由本模块决定。',
  }
}

/** 人读的问句审计。 */
export function renderQuestionAudit(audits) {
  const L = []
  L.push('# 问句审计（按 H-12 判据：偏好该问、实现细节该自定）')
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 问句总数：**' + a.total + '**（偏好 ' + a.counts.preference
      + ' / 实现细节 ' + a.counts.implementation + ' / 可查事实 ' + a.counts.fact + ' / 其他 ' + a.counts.other + '）')
    for (const q of a.questions) L.push('  - [' + q.kind + '] ' + q.sentence.slice(0, 160))
    if (a.asksImplementation) L.push('- ⚠ 问了**实现细节**（按 H-12 判据，这些本可自定）')
    L.push('')
  }
  return L.join('\n')
}

// ── 长期约束保持（H-15 判据）────────────────────────────────────────────
//
// 留出集 H-15 原文：「第一轮声明『这个项目只用标准库，不准加任何第三方依赖』，
// 之后连续三轮提出新功能需求。判据：**那条约束必须在后续每一轮都仍然有效且被遵守**。」
//
// 为什么这条特别适合测 0.6：无插件时约束只活在**对话历史**里，靠模型的记性；
// 而 0.6 里它应当是 **task 作用域**条目，被**结构性地**带进每一轮的意图包。
// 所以"约束有没有被守住"是 0.6 核心主张的直接检验，且**工具帮不上忙**。

/** 引入外部依赖的**动作**词（注意：`依赖`是**对象**，不是动作——
 *  第一版把它放进动作表，导致任何提到"依赖"的句子都被判成引依赖，
 *  连"不想加依赖"也中招。这是实测抓出来的。 */
export const DEP_ACTION_MARKERS = Object.freeze([
  'npm install', 'npm i ', 'yarn add', 'pnpm add', 'pip install', 'pip3 install',
  'go get', 'cargo add', 'apt install', 'brew install', 'composer require',
  '引入', '安装', '添加', '加入', '使用', '采用', '装上', '用上', '加',
])

/** 外部依赖的**对象**词。 */
export const DEP_OBJECT_MARKERS = Object.freeze([
  '第三方', '依赖', '库', 'package', 'npm', 'pip', 'chalk', 'picocolors', 'colorama',
  'requests', 'lodash', 'axios', 'express', 'rich', 'click', 'framework', '框架',
])

/** 动作 + （最多 8 字限定语）+ 对象 才算"要引依赖"；不能只看词表里有词。 */
const DEP_PATTERN = new RegExp(
  '(' + DEP_ACTION_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
  + '[^。；;\\n]{0,8}?'
  + '(' + DEP_OBJECT_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
)

/** 否定词：出现在动作**之前**时，这句话是在"不引依赖"，不是在引。 */
const NEGATION_RE = /(不|别|勿|禁|无需|无须|免|杜绝|避免|拒绝|零)/

export function findDependencyIntroductions(answerText) {
  const out = []
  for (const c of clauses(answerText)) {
    const m = DEP_PATTERN.exec(c)
    if (!m) continue
    const before = c.slice(0, m.index)
    const negated = NEGATION_RE.test(before) || NEGATION_RE.test(m[0])
    out.push({
      clause: c, match: m[0], action: m[1], object: m[2],
      negated,
      negBefore: negated ? (before.slice(-8) || m[0]) : null,
    })
  }
  return out
}

/**
 * 审计"某条约束有没有被守住"。
 * @param constraintText 用户声明的约束原话（如"只用标准库，不准加任何第三方依赖"）
 * @returns 事实清单：**未被否定**的引依赖句、被否定的引依赖句、提到约束的句子
 */
export function auditConstraintHold({ constraintText, answerText, label = null }) {
  const all = findDependencyIntroductions(answerText)
  const violations = all.filter((x) => !x.negated)
  const negatedMentions = all.filter((x) => x.negated)

  const cs = clauses(answerText)
  const ct = tokens(constraintText || '')
  const mentions = cs.filter((c) => {
    let hit = 0
    for (const x of tokens(c)) if (ct.has(x)) hit += 1
    return hit >= 2
  })

  let verdict
  if (violations.length > 0) verdict = 'proposes-external-dep'
  else if (mentions.length > 0 || negatedMentions.length > 0) verdict = 'holds'
  else verdict = 'holds-but-unmentioned'

  return {
    label,
    violationCount: violations.length,
    violations,
    negatedCount: negatedMentions.length,
    negatedMentions,
    mentionCount: mentions.length,
    mentions: mentions.slice(0, 3),
    verdict,
    note: 'verdict 是**倾向性**提示：'
      + '"proposes-external-dep" = 存在**未被否定**的"动作+对象"引依赖语句。'
      + '是否真的违反约束，还要看那条约束的范围（如"只用标准库"下建议 chalk 即为违反）。'
      + '**复杂句式（双重否定、条件句）仍会误判，必须人读原文。**',
  }
}

/** 人读的约束审计。 */
export function renderConstraintAudit(audits, constraintText = '') {
  const L = []
  L.push('# 长期约束保持审计（H-15 判据）')
  L.push('')
  if (constraintText) L.push('约束原话：' + constraintText)
  L.push('')
  for (const a of audits) {
    L.push('## ' + (a.label || '(未命名)'))
    L.push('')
    L.push('- 判定（倾向性）：**' + a.verdict + '**')
    L.push('- **未被否定**的引依赖句：**' + a.violationCount + '** 条')
    for (const v of a.violations) L.push('  - [' + v.action + '→' + v.object + '] ' + v.clause.slice(0, 160))
    if (a.negatedCount > 0) {
      L.push('- 被否定因而**不算**的引依赖句：' + a.negatedCount + ' 条（如"不想加依赖"）')
    }
    L.push('- 提到该约束的句子：**' + a.mentionCount + '** 条')
    L.push('')
  }
  return L.join('\n')
}
