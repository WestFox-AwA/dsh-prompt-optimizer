// 0.6.11 · **档位策略**（tier → strategy）与**领域质量维度**。
//
// 为什么要有这个文件（用户 2026-09-24 实测反馈）：
//   "现在的重度并没有明显比轻度的优化程度高" —— 查证属实：旧的四档只映射三项参数
//   （assist / detail=包字符预算 / budget=提问配额），**标准与重度的 detail 是同一个值**，
//   所以「重度」实际等于「标准 + 多 1 个澄清提问」。**档位只调产出多少字，从不改怎么想。**
//
// 本模块把"怎么想"变成**可测的策略**：
//   · mode        —— 单一解读 / 条目内并列 / 显式多假设分支
//   · candidates  —— 多假设候选项的上限（0 = 不产出候选）
//   · maxItems    —— 一轮最多产出多少条（不是"越多越好"，是"短原话不膨胀"）
//   · qualityDims —— 质量词要不要落到领域可检维度上（'off' | 'refer' | 最小条数）
//   · depth       —— 思考深度（只影响解释层自己怎么想，**不设输出上限**，见 ADR-0085）
//
// ⚠ 纪律：策略只能**收紧或放宽解释层的做法**，**不许**给解释层的单次输出设 token 上限（ADR-0085）。
//   这里没有、也不许出现 maxTokens 一类字段。

/** 三种解读模式。 */
export const INTERPRET_MODES = Object.freeze(['single', 'parallel', 'branching'])
/** 质量维度的三档：不给 / 可参考 / 至少 N 条。 */
export const QUALITY_DIMS_MIN = Object.freeze({ off: 0, refer: 0, one: 1, two: 2 })

/**
 * 档位 → 策略。**这是四档分层的唯一真相来源**（policyFor 只做转发）。
 * 轻度不是"不做事"（那是关闭档）：它就是**只给单一解读**——用户 2026-09-21 明确要求过
 * "短消息也必须真调用模型优化"，所以这里不允许把轻度做成"跳过解释"。
 */
export const TIER_STRATEGY = Object.freeze({
  off: Object.freeze({ mode: 'single', candidates: 0, maxItems: 0, qualityDims: 'off', depth: 'brief' }),
  light: Object.freeze({ mode: 'single', candidates: 0, maxItems: 4, qualityDims: 'refer', depth: 'brief' }),
  standard: Object.freeze({ mode: 'parallel', candidates: 0, maxItems: 8, qualityDims: 'one', depth: 'normal' }),
  heavy: Object.freeze({ mode: 'branching', candidates: 3, maxItems: 12, qualityDims: 'two', depth: 'deep' }),
})

/** 策略默认值（档位取不到时用它；与 settings 的默认档 `standard` 一致）。 */
export const DEFAULT_STRATEGY = TIER_STRATEGY.standard

/** 取某档的策略；非法档位**不猜**，落回默认并如实标记。 */
export function strategyForTier(tier) {
  const t = String(tier == null ? '' : tier)
  if (Object.hasOwn(TIER_STRATEGY, t)) return { ...TIER_STRATEGY[t], tier: t, known: true }
  return { ...DEFAULT_STRATEGY, tier: t || '(empty)', known: false }
}

/** 质量维度最少要几条（`qualityDims` 允许直接写数字，便于以后加档）。 */
export function qualityDimsMin(spec) {
  if (typeof spec === 'number' && Number.isFinite(spec)) return Math.max(0, Math.floor(spec))
  if (Object.hasOwn(QUALITY_DIMS_MIN, spec)) return QUALITY_DIMS_MIN[spec]
  return 0
}

// ── 领域质量维度 ────────────────────────────────────────────────────────
//
// 为什么需要：用户说的"精细/真实/帅气/高级感"是**质量词**，工作 AI 收到"要有高级感"跟
// 没收到差不多。有用的是把它落到**该领域可检的维度**上（"间距层级 / 对比度 / 状态反馈"）。
//
// ⚠ 两条不许越的线：
//   ① 维度是**怎么检查**的建议，不是新增需求——渲染进包时仍在「质量解释」节，不冒充用户要求；
//   ② 领域只能从**上下文里读到的线索**推断（文件后缀、目录名、原话里的名词），**不许凭空认领**；
//      推不出就把领域本身写成 unknown，而不是硬套一个。
export const DOMAINS = Object.freeze({
  ui: Object.freeze(['间距与层级', '配色与对比度（含浅/深两套）', '状态反馈（悬停/按下/禁用/加载）', '动效时长与缓动', '空态与错误态', '可读性（字号/行高/行长）']),
  cli: Object.freeze(['错误信息的可操作性', '参数与输出的一致性', '退出码语义', '帮助文本的完整性', '幂等与重复执行安全']),
  doc: Object.freeze(['结构与检索路径', '术语一致性', '读者定位与前置条件', '可复核的引用与命令']),
  data: Object.freeze(['口径与单位', '缺失值与异常值处理', '可复现的查询步骤', '结果校验方式']),
  code: Object.freeze(['命名与边界', '错误处理与失败路径', '可测试性', '依赖与兼容面', '性能与资源上界']),
  game: Object.freeze(['手感与节奏', '视觉反馈与提示', '难度曲线', '可恢复性（存档/重开）']),
})

/** 全部领域名（给提示词与测试用）。 */
export const DOMAIN_NAMES = Object.freeze(Object.keys(DOMAINS))

/** 取某领域的可检维度；未知领域返回空数组（**不猜**）。 */
export function dimensionsOf(domain) {
  const d = String(domain == null ? '' : domain)
  return Object.hasOwn(DOMAINS, d) ? [...DOMAINS[d]] : []
}

/** 维度清单渲染成一行（供提示词示例与包文本使用）。 */
export function renderDomainMenu() {
  return DOMAIN_NAMES.map((d) => d + '：' + DOMAINS[d].join(' / ')).join('\n')
}

// ── 策略 → 解释层附加指令 ───────────────────────────────────────────────
//
// 这些指令**加在系统提示词后面**，只改变"怎么想"，不改变"必须交 JSON"等硬契约。
export function strategyInstructions(strategy) {
  const s = strategy || DEFAULT_STRATEGY
  const out = []
  const depthLine = {
    brief: '【思考深度】快速判断即可：这一轮要什么，一句话说清。',
    normal: '【思考深度】先想清楚这一轮真正要什么，再写条目；不要把明显同义的东西拆成多条。',
    deep: '【思考深度】**多想一层**：先把这句话可能的用意在脑子里过一遍（谁在什么处境、要达成什么、'
      + '哪一步最容易做歪），再写条目。宁可少写几条、每条都站得住，也不要凑数。',
  }[s.depth]
  if (depthLine) out.push(depthLine)

  if (s.mode === 'parallel') {
    out.push('【并列解读】如果这句话有不止一种说得通的读法，**在同一条条目里并列写出来**'
      + '（例如"X（若你要 A）/ X（若你要 B）"），不要替用户挑一个，也不要拆成互相矛盾的多条条目。')
  } else if (s.mode === 'branching') {
    out.push('【多假设】当原话**真的分叉**（有 2–' + Math.max(2, s.candidates)
      + ' 种说得通、且会导致不同做法的读法）时，把它写成一条 `unknown`（`unknownClass:"user_preference"`、'
      + '`blocksAction:true`），并用 `candidates` 字段**列出各候选**；每个候选写清"如果按这个理解，会做什么"。'
      + '**没有分叉就不要造候选**——候选不是新增要求，只是把"我不知道你指哪个"说明白。')
  }

  const min = qualityDimsMin(s.qualityDims)
  if (min > 0) {
    out.push('【质量落到维度】用户用"精细/高级感/真实/帅气"这类**质量词**时，'
      + '**至少给 ' + min + ' 条** `quality_interpretation`，每条 text 写成**该领域可检查的维度**'
      + '（不是复述那个形容词），rationale 里指明它来自原话的哪几个字。'
      + '领域只能从上下文里读到的线索推断；**推不出领域就不要硬套**，把"这是哪个领域"写成 unknown。')
  } else if (s.qualityDims === 'refer') {
    out.push('【质量】质量词照常写成 `quality_interpretation`，能落到可检查的维度就落，落不了就如实描述原意。')
  }
  out.push('【条目上限】这一轮最多 ' + s.maxItems + ' 条；**少而准**优先，凑数会挤掉真正有用的条目。')
  return out
}
