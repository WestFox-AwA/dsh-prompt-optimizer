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

/** 意图包的**结构指纹**（不是文案匹配——文案会改，结构不会）。 */
export const PACKET_MARKERS = [
  'intent-packet', 'intentPacket', '意图包',
]

/**
 * 从会话事件里挑出"插件来源的用户消息"。
 * 0.6 的投递形态是 `source.kind === 'plugin'` 的**全值** snapshot
 * （ADR-0006：取代而非追加），所以这里同时回报**顺序与份数**——
 * 份数 > 1 就说明出现了累积，那是被明令禁止的形态。
 */
export function extractPluginMessages(events) {
  const out = []
  for (const e of events) {
    if (!e || e.type !== 'user/message') continue
    const m = e.data && (e.data.message || e.data)
    const src = m && m.source
    if (!src || src.kind !== 'plugin') continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('')
        : ''
    out.push({
      plugin: src.plugin || null,
      form: src.form || null,
      summary: src.summary || null,
      chars: text.length,
      looksLikePacket: PACKET_MARKERS.some((k) => text.includes(k)),
      head: text.slice(0, 120),
      text,
    })
  }
  return out
}

/** 一次会话里所有"非宿主默认"的提示词贡献者，用来判断包是**谁**送来的。 */
export function summarizeWire(events) {
  const pluginMsgs = extractPluginMessages(events)
  const usage = collectUsage(events)
  return {
    pluginMessages: pluginMsgs.length,
    packets: pluginMsgs.filter((m) => m.looksLikePacket).length,
    packetForms: [...new Set(pluginMsgs.map((m) => m.form))],
    plugins: [...new Set(pluginMsgs.map((m) => m.plugin).filter(Boolean))],
    // 全值语义要求：同一插件同一形态**只能有一份**
    accumulation: pluginMsgs.length > 1 && new Set(pluginMsgs.map((m) => m.plugin)).size < pluginMsgs.length,
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
