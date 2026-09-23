// P8 · **线缆检查**：真实会话日志里，0.6 的意图包到底有没有送到 agent 那一轮？
//
// 为什么必须有这个脚本：单元测试能证明"给定状态会编译出这样的包"，
// 但**证明不了**这个包真的出现在一次真实 agent 调用的消息里。
// 两者之间隔着：配置闸门 → 解释层调用 → 编译器 → systemPrompt.context
// → 宿主聚合 → snapshot 消息 → agent 请求。任何一环断了，测试全绿而线上一个包都没有。
//
// 用法：node po06/scripts/dump-wire.mjs <session.v3.jsonl.zstd> [--json]
import { readFileSync } from 'node:fs'
import { decodeAllFrames, parseEvents, collectUsage } from './read-session.mjs'

/** 本插件自己的包名（用于把"我们的投递"与宿主/别的插件的消息分开）。 */
export const OWN_PLUGIN = '@dsh-external/dsh-po06'
/** 意图包注册的动态上下文名——**结构指纹**，比文案可靠（文案会改，注册名不会）。 */
export const CONTEXT_NAME = 'prompt-optimizer:intent'

/**
 * 意图包的判定依据。**优先看结构**：宿主的快照消息会把每个贡献者的名字放进
 * `source.sections[].name`，所以"我们的上下文在不在快照里"是可判定的。
 *
 * 为什么不能只认文案（实测教训，EV-0080）：第一版只找 'intent-packet'/'意图包' 之类的字串，
 * 而真实包渲染出来的是 `[插件辅助上下文 · 不是用户新增的命令]` + 【明确要求】/【未决项】，
 * 一个字都不匹配 ⇒ **包明明在历史里，仪器却报"包=false"**。
 * 仪器报错的后果不是"少一条好消息"，而是会让人得出与事实相反的结论。
 */
export const PACKET_MARKERS = [
  'prompt-optimizer:intent', '[插件辅助上下文', '【明确要求】', '【未决项',
]

/**
 * **生产者归属**：把消息来源归一成"谁送的"，**兼容两代宿主形态**（ADR-0087）。
 *
 * 为什么必须兼容而不是换掉：
 *   · 0.1.6 及更早：`{kind:'plugin', plugin:'<包名>'}` —— 身份在同级的 `plugin` 字段里；
 *   · 0.1.7 起：**没有**共享的 `plugin` 兜底 kind，生产者自报（`'system-prompt'` /
 *     `'runtime-context'` / 第三方插件的 `'plugin:<包名>'`）；
 *   · 而本仪器读的是**历史日志**——两种形态都会出现在同一个人的台账里，
 *     只认一种就等于"换了宿主之后，旧台账全部读不出来"。
 *   · 真人消息（`kind:'user'`）永远不算插件贡献。
 * `'plugin:<包名>'` 归一成裸包名，这样"我们自己的消息"在两代里都叫同一个名字。
 */
export function producerOf(src) {
  if (!src || typeof src.kind !== 'string' || !src.kind) return null
  if (src.kind === 'user') return null
  if (src.kind === 'plugin') return src.plugin || null
  if (src.kind.startsWith('plugin:')) return src.kind.slice('plugin:'.length) || null
  return src.kind
}

/**
 * 从会话事件里挑出"插件来源的用户消息"。
 * 0.6 的投递形态是宿主贡献的**全值** snapshot（ADR-0006：取代而非追加），
 * 所以这里同时回报**顺序与份数**——份数 > 1 就说明出现了累积，那是被明令禁止的形态。
 */
export function extractPluginMessages(events) {
  const out = []
  for (const e of events) {
    if (!e || e.type !== 'user/message') continue
    const m = e.data && (e.data.message || e.data)
    const src = m && m.source
    const producer = producerOf(src)
    if (!producer) continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('')
        : ''
    const sectionNames = Array.isArray(src.sections) ? src.sections.map((s) => s && s.name) : []
    out.push({
      plugin: producer,
      form: src.form || null,
      summary: src.summary || null,
      sectionNames,
      chars: text.length,
      // 结构优先（注册名出现在快照的贡献者清单里），文案兜底
      looksLikePacket: sectionNames.includes(CONTEXT_NAME)
        || PACKET_MARKERS.filter((k) => !k.includes(':')).some((k) => text.includes(k)),
      head: text.slice(0, 120),
      text,
    })
  }
  return out
}

/** 一次会话里所有"非宿主默认"的提示词贡献者，用来判断包是**谁**送来的。 */
export function summarizeWire(events) {
  const pluginMsgs = extractPluginMessages(events)
  const own = pluginMsgs.filter((m) => m.plugin === OWN_PLUGIN)
  const usage = collectUsage(events)
  return {
    pluginMessages: pluginMsgs.length,
    packets: pluginMsgs.filter((m) => m.looksLikePacket).length,
    packetForms: [...new Set(pluginMsgs.map((m) => m.form))],
    plugins: [...new Set(pluginMsgs.map((m) => m.plugin).filter(Boolean))],
    /**
     * 全值语义要求：**本插件**同一形态只能有一份。
     * ⚠ 只统计**我们自己的**消息：宿主的运行时快照本来就会**每步重发一份**
     * （它自己写着 "This snapshot supersedes earlier runtime-context snapshots"），
     * 把宿主的行为算成我们"累积"是**假警报**（第一版就是这么误报的，EV-0080）。
     */
    accumulation: own.length > 1,
    ownMessages: own.length,
    usage,
    details: pluginMsgs.map(({ text, ...rest }) => rest),
  }
}

if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/')) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node dump-wire.mjs <session.v3.jsonl.zstd> [--json]')
    process.exit(2)
  }
  const { text, frames, bad } = decodeAllFrames(readFileSync(file))
  const events = parseEvents(text)
  const s = summarizeWire(events)
  s.frames = frames
  s.badFrames = bad
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(s, null, 2))
  } else {
    console.log('# 线缆检查 · ' + file)
    console.log('- 插件来源消息：**' + s.pluginMessages + '** 份（其中像意图包：' + s.packets + '）')
    console.log('- 形态：' + (s.packetForms.join(', ') || '（无）'))
    console.log('- 来源插件：' + (s.plugins.join(', ') || '（无）'))
    if (s.accumulation) console.log('- ⚠ **疑似累积**：同一插件的多份消息（全值语义要求只有最新一份）')
    for (const d of s.details) {
      console.log('  - [' + d.plugin + '/' + d.form + '] ' + d.chars + ' 字符  包=' + d.looksLikePacket)
      console.log('    ' + d.head.replace(/\n/g, ' ⏎ '))
    }
  }
}
