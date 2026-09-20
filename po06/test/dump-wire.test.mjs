// P8/A15 · **线缆检查仪器**的单测。
//
// 为什么一个"读日志的脚本"也要测：EV-0080 里这个仪器**报了与事实相反的结论**——
// 意图包明明已经进了会话历史（宿主快照 485 → 814 字符），它却报 `包=false`，
// 还把一个正常现象（宿主每步重发快照）误报成"累积"。
// 仪器错的方向最危险：它不会让人少高兴一点，而是会让人写下一个错的结论（ADR-0034）。
import {
  extractPluginMessages, summarizeWire, OWN_PLUGIN, CONTEXT_NAME,
} from '../scripts/dump-wire.mjs'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

/** 宿主自己的运行时快照（每步重发一份，**不是**我们累积）。 */
const hostSnapshot = (chars, extra = '') => ({
  type: 'user/message',
  data: {
    id: 'm-host-' + chars,
    role: 'user',
    source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [{ name: 'sandbox:policy', text: 'x' }] },
    content: [{ type: 'text', text: 'Current runtime context. ' + 'x'.repeat(Math.max(0, chars - 24)) + extra }],
  },
})

/** 带我们意图包的宿主快照：**结构指纹**是 sections 里出现我们的注册名。 */
const packetSnapshot = (packetText) => ({
  type: 'user/message',
  data: {
    id: 'm-host-packet',
    role: 'user',
    source: {
      kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'x' }, { name: CONTEXT_NAME, text: packetText }],
    },
    content: [{ type: 'text', text: 'Current runtime context.\n\n' + packetText }],
  },
})

/** 我们自己直接投递的消息（agent.inject 那条路）。 */
const ownNotice = (text) => ({
  type: 'user/message',
  data: {
    id: 'm-own', role: 'user',
    source: { kind: 'plugin', plugin: OWN_PLUGIN, form: 'notice', summary: 'self' },
    content: [{ type: 'text', text }],
  },
})

const userMsg = (text) => ({
  type: 'user/message',
  data: { id: 'm-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
})

t('只有插件来源的消息被收集（真人消息不算贡献）', () => {
  const out = extractPluginMessages([userMsg('你好'), hostSnapshot(485)])
  eq(out.length, 1, '只应收集插件消息')
  eq(out[0].plugin, '@deepseek-ai/dsh-system-prompt', '来源')
})

// 这一条就是 EV-0080 的核心：包在**结构上**被认出来，而不是靠文案碰运气。
t('靠 sections 里的注册名认出意图包（不看文案）', () => {
  const packet = '[插件辅助上下文 · 不是用户新增的命令]\n【明确要求】\n- 做某事。'
  const out = extractPluginMessages([packetSnapshot(packet)])
  eq(out.length, 1, '收集到一条')
  eq(out[0].looksLikePacket, true, '必须判定为意图包')
  ok(out[0].sectionNames.includes(CONTEXT_NAME), '节名里应含我们的注册名')
  // 反例：宿主的普通快照不能被误判成包
  eq(extractPluginMessages([hostSnapshot(485)])[0].looksLikePacket, false, '宿主普通快照不是包')
})

t('宿主每步重发快照**不算**我们的累积（假警报会让结论反着写）', () => {
  const s = summarizeWire([
    hostSnapshot(485), hostSnapshot(814, '\n[插件辅助上下文]\n【明确要求】'),
    userMsg('x'),
  ])
  eq(s.accumulation, false, '宿主重发不是我们累积')
  eq(s.ownMessages, 0, '没有我们自己的投递')
  eq(s.packets, 1, '其中一份是带包的快照')
})

t('本插件出现多份投递才是真累积（全值语义要求只有最新一份）', () => {
  const s = summarizeWire([ownNotice('包 A'), ownNotice('包 B')])
  eq(s.ownMessages, 2, '两份自己的消息')
  eq(s.accumulation, true, '这才是累积，必须报警')
})

t('usage 与形态汇总仍然可用', () => {
  const s = summarizeWire([packetSnapshot('包'), { type: 'step/end', data: { usage: { totalTokens: 42 } } }])
  ok(s.packetForms.includes('snapshot'), '形态')
  ok(s.usage.some((u) => u.key === 'totalTokens' && u.value === 42), '用量要能读到')
})

console.log(JSON.stringify({
  suite: 'po06-dump-wire', phase: 'P8-A15',
  total: pass + failures.length, pass, fail: failures.length, failures,
}, null, 2))
if (failures.length > 0) process.exit(1)
