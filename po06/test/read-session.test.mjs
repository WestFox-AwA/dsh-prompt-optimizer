// P7 · 会话日志读取器的测试（守的是"**多帧 zstd 只解第一帧**"这个静默陷阱）
//
// 运行：node po06/test/read-session.test.mjs
//
// 为什么必须有：第一次读这份日志时，`zstdDecompressSync(整份文件)` **成功返回了 179 字符**
// ——不报错、不抛异常，但 234KB 的日志里 99.9% 的内容被静默丢掉了。
// 如果我没发现，"这一轮花了多少"就会用一个残缺的数字回答。仪器不能这样。
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { decodeAllFrames, parseEvents, collectUsage } from '../scripts/read-session.mjs'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const frame = (s) => zstdCompressSync(Buffer.from(s, 'utf8'))

t('**多帧拼接**必须全部解出来（只解第一帧是静默残缺）', () => {
  const one = frame('{"type":"a"}\n')
  const two = Buffer.concat([one, frame('{"type":"b"}\n'), frame('{"type":"c"}\n')])
  const r = decodeAllFrames(two)
  eq(r.frames, 3, '三个帧都要解出来')
  eq(r.bad, 0, '无坏帧')
  const evs = parseEvents(r.text)
  eq(evs.map((e) => e.type), ['a', 'b', 'c'], '三行事件都在')
  // 对照：只解一次会得到什么（说明这个测试挡的是什么）
  const partial = parseEvents(zstdDecompressSync(two).toString('utf8'))
  eq(partial.length, 1, '对照：整份丢给 zstdDecompressSync 只得到 1 行')
})

t('单帧也要正常工作', () => {
  const r = decodeAllFrames(frame('{"type":"only"}\n'))
  eq(r.frames, 1, '一个帧')
  eq(parseEvents(r.text).length, 1, '一行')
})

t('坏帧被计数而不是让整次读取失败', () => {
  const good = frame('{"type":"ok"}\n')
  const junk = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from('not-a-frame')])
  const r = decodeAllFrames(Buffer.concat([good, junk]))
  ok(r.bad >= 1, '坏帧要计数：' + r.bad)
  ok(r.text.includes('ok'), '好帧的内容仍要保留')
})

t('parseEvents 跳过坏行而不是整体失败', () => {
  eq(parseEvents('{"type":"a"}\nnot json\n{"type":"b"}\n').map((e) => e.type), ['a', 'b'], '坏行被跳过')
  eq(parseEvents('').length, 0, '空文本')
})

t('collectUsage 能挖出**嵌套**的用量字段（不同层结构不一样）', () => {
  const evs = [
    { type: 'x', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    { type: 'y', data: { message: { usage: { inputTokens: 1, cacheReadTokens: 99, totalTokens: 100 } } } },
    { type: 'z', note: 'no usage here' },
  ]
  const found = collectUsage(evs)
  const byKey = {}
  for (const f of found) byKey[f.key] = (byKey[f.key] || 0) + f.value
  eq(byKey.inputTokens, 11, '两层的 inputTokens 都要算上')
  eq(byKey.outputTokens, 5, 'outputTokens')
  eq(byKey.cacheReadTokens, 99, '嵌套的 cacheReadTokens 也要算上')
  eq(byKey.totalTokens, 115, 'totalTokens')
  // 关键：不能只认顶层 —— 真实日志里用量就藏在 assistant/message.data.message 里
  ok(found.some((f) => f.path.includes('data.message')), '必须能进到嵌套路径：' + JSON.stringify(found.map((f) => f.path)))
})

t('collectUsage 遇到非数字/同名字段不误计', () => {
  const evs = [{ a: { tokens: 'many' }, b: { tokens: 7 } }]
  const byKey = {}
  for (const f of collectUsage(evs)) byKey[f.key] = (byKey[f.key] || 0) + f.value
  eq(byKey.tokens, 7, '只认 number')
})

const total = pass + failures.length
console.log(JSON.stringify({ suite: 'po06-read-session', phase: 'P7', total, pass, fail: failures.length, failures }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
