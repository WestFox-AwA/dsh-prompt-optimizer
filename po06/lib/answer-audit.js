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
