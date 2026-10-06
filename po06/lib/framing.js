// 0.7.8 · 协作基调（Interaction Framing）
//
// 起因（用户 2026-09-27 实测）：同样的要求，用口语、带情绪、带关系感的说法讲出来，
// 首轮交付明显好于同等字数、同等信息量的正式说法。关键反证是：**同样字数的正式提示词
// 做不到那个效果** ⇒ 起作用的是**语域**，不是信息量。
//
// 机制：模型对提示词的语域条件化采样——正式语域命中「专业助手接正式请求」那一簇（客套、hedging、
// 求稳），口语+高唤醒语域命中「哥们帮你把活干出来」那一簇（直接开干、把成品拿出来）。
// 所以这一档**必须保留语域本身**；把它消毒成「请更积极主动」等于扔掉效果来源。
//
// 分工（B 方案，用户 2026-09-27 定）：
//   · **骨架归代码**（OPEN / MID / BOUNDARY）：标签、语域、越权反制——三条不变量，模型无权改；
//   · **加码归模型**（hardNote）：由解释层按这一轮的实际情况写，**长度自定**、要求定点爆破。
//     它插在 MID 与 BOUNDARY 之间，所以**边界行永远在最后**，不会被生成内容挤掉或改写。
//
// 三条硬边界：① 不代表用户说话（标签写明插件所加）；② 不放松决策边界（BOUNDARY 行）；
//   ③ 不改用户原话。加码部分另有一道机械防线：**必须引用包内已有条目的 id**，
//   写不出引用就不采用（见 pipeline 的引用校验）——「语气里夹带新要求」是它最大的风险。

/** 协作基调的值域（与 settings.js 的 FRAMINGS 一致）。 */
export const FRAMING_VALUES = Object.freeze(['neutral', 'hard'])

/** 骨架：开场标签 + 语域。**这两行是效果来源，不要交给模型生成。** */
const OPEN = [
  '【协作基调 · 硬邦邦（插件所加，不是用户的新要求）】',
  '兄弟，这单给我往猛了干：别整"可以考虑""建议您"那套客套，上来直接开造。',
].join('\n')

/** 通用目标行（模型加码插在它之后）。 */
const MID = '目标是能拿出去给人看、第一眼就够硬的效果——做完自己先按验收点过一遍，别交个半成品。'

/** 越权反制行：**永远放最后**——强结果导向最大的副作用就是「懒得问、自己定了」。 */
const BOUNDARY = '低风险的小细节你自己拍板，别来回问；但用户没拍板的大事（联网、加功能、改交付形态）不准替他定。'

/**
 * 加码的自保长度。**这不是风格限制**，是跑飞保护：
 * 用户明确要求长度由模型自定（不设句数/字数上限），所以这里只挡病态长度。
 * 超限即整段不采用、退回纯骨架——**绝不截断**（截断会产出半句话，比没有更糟）。
 */
export const HARD_NOTE_MAX = 1200

/** 归一化加码：去首尾空白、折叠连续空行；空或超限返回空串（＝不采用）。 */
export function normalizeHardNote(note) {
  const s = String(note == null ? '' : note).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!s) return ''
  if (s.length > HARD_NOTE_MAX) return ''
  return s
}

/**
 * 取某档基调要注入的文本。`neutral` 返回空串（＝什么都不加）。
 * @param framing 'neutral' | 'hard'
 * @param note    模型生成的加码（可选；空或超限即退回纯骨架）
 */
export function framingBlock(framing, note,language) {
  if(language==='en'){if(String(framing)!=='hard')return '';return ['[Direct energetic tone, plugin-added; not new user requirements]','Get the actual result built. Be direct and task-specific; avoid padding and empty promises.',normalizeHardNote(note),'Decide reversible low-risk details, but do not silently choose unapproved goals, features, network access or delivery formats.'].filter(Boolean).join('\n')}
  if (String(framing) !== 'hard') return ''
  const extra = normalizeHardNote(note)
  const lines = [OPEN, MID]
  if (extra) lines.push(extra)
  lines.push(BOUNDARY)
  return lines.join('\n')
}