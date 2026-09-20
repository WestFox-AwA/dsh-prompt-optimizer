// P7 · 读 DSH 会话日志（**持久化日志是证据来源**，ADR-0007）
//
//   node po06/scripts/read-session.mjs <session.v3.jsonl.zstd> [--tail N] [--usage]
//
// 为什么需要它：headless / 真实会话跑完之后，**精确用量与最终回答只有日志里有**，
// 而 stdout 很容易被截断（实测一次 185KB 输出就被截掉了大半）。
// 日志是 zstd 压缩的，而且是**多帧追加**的（一个文件里 135 个 zstd 帧），
// Node 的 zstdDecompressSync 只解第一帧 —— 所以这里按帧魔数切开逐帧解。
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 逐帧解压（多帧追加的文件必须这样读，否则只会得到第一帧）。 */
export function decodeAllFrames(buf) {
  const offs = []
  let i = 0
  while (true) {
    const k = buf.indexOf(MAGIC, i)
    if (k < 0) break
    offs.push(k)
    i = k + 4
  }
  let text = ''
  let frames = 0
  let bad = 0
  for (let n = 0; n < offs.length; n++) {
    const seg = buf.slice(offs[n], n + 1 < offs.length ? offs[n + 1] : buf.length)
    try { text += zstdDecompressSync(seg).toString('utf8'); frames += 1 } catch { bad += 1 }
  }
  return { text, frames, bad }
}

export function parseEvents(text) {
  return text.split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

/** 递归找任何看起来像 token 用量的字段（不同层的事件结构不一样，不能只认一种）。 */
export function collectUsage(events) {
  const found = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, path + '[' + i + ']')); return }
    for (const [k, v] of Object.entries(node)) {
      if (/^(inputTokens|outputTokens|cacheReadTokens|cacheWriteTokens|totalTokens|tokens)$/.test(k)
        && typeof v === 'number') {
        found.push({ path: path + '.' + k, key: k, value: v })
      }
      walk(v, path + '.' + k)
    }
  }
  walk(events, '')
  return found
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('read-session.mjs')
if (isMain) {
  const argv = process.argv.slice(2)
  const file = argv.find((a) => !a.startsWith('--'))
  const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const tail = Number(opt('tail', 0))
  if (!file) { console.error('usage: node read-session.mjs <session.v3.jsonl.zstd> [--tail N] [--usage]'); process.exit(2) }

  const { text, frames, bad } = decodeAllFrames(readFileSync(file))
  const events = parseEvents(text)
  const types = {}
  for (const e of events) types[e.type] = (types[e.type] || 0) + 1

  const toolCalls = events.filter((e) => e.type === 'tool/call')
  const steps = events.filter((e) => e.type === 'step/start').length
  const assistant = events.filter((e) => e.type === 'assistant/message')

  const summary = {
    file, frames, badFrames: bad, chars: text.length, events: events.length,
    steps, toolCalls: toolCalls.length, assistantMessages: assistant.length,
    eventTypes: types,
  }

  if (argv.includes('--usage')) {
    const u = collectUsage(events)
    const byKey = {}
    for (const x of u) byKey[x.key] = (byKey[x.key] || 0) + x.value
    summary.usageFieldsFound = u.length
    summary.usageTotals = byKey
  }

  if (tail > 0) {
    const last = assistant[assistant.length - 1]
    const txt = last
      ? (last.data.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      : ''
    summary.lastAssistantText = txt.slice(0, tail)
  }

  console.log(JSON.stringify(summary, null, 2))
}
