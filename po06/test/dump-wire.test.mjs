// P8/A15 · **线缆检查仪器**的单测。
//
// 为什么一个"读日志的脚本"也要测：EV-0080 里这个仪器**报了与事实相反的结论**——
// 意图包明明已经进了会话历史（宿主快照 485 → 814 字符），它却报 `包=false`，
// 还把一个正常现象（宿主每步重发快照）误报成"累积"。
// 仪器错的方向最危险：它不会让人少高兴一点，而是会让人写下一个错的结论（ADR-0034）。
import {
  extractPluginMessages, summarizeWire, producerOf, OWN_PLUGIN, CONTEXT_NAME,
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

// ── ADR-0087：**两代宿主形态都要认**（0.1.7 起没有共享的 `plugin` 兜底 kind）─────────
// 为什么单独立一组：仪器读的是**历史日志**。只认旧形态 ⇒ 换宿主之后新台账全读不出来；
// 只认新形态 ⇒ 老台账（含着手里那批真机证据）全读不出来。两种都是"仪器报错方向最危险"。
t('producerOf：旧形态（kind:plugin + plugin 字段）与真人消息', () => {
  eq(producerOf({ kind: 'plugin', plugin: OWN_PLUGIN }), OWN_PLUGIN, '旧形态取 plugin 字段')
  eq(producerOf({ kind: 'plugin' }), null, '旧形态但没写 plugin ⇒ 认不出来（不瞎猜）')
  eq(producerOf({ kind: 'user' }), null, '真人消息永远不算插件贡献')
  eq(producerOf(null), null, '没有来源 ⇒ null')
  eq(producerOf({ kind: '' }), null, '空 kind ⇒ null')
})

t('producerOf：新形态（生产者自报 kind；第三方是 plugin:<包名>）', () => {
  eq(producerOf({ kind: 'runtime-context' }), 'runtime-context', '宿主自报的 kind 原样返回')
  eq(producerOf({ kind: 'system-prompt' }), 'system-prompt', '同上')
  // 关键：我们自己在新形态下的名字要**归一到裸包名**，否则"是不是我们投的"就判不出来了
  eq(producerOf({ kind: 'plugin:' + OWN_PLUGIN }), OWN_PLUGIN, 'plugin:<包名> ⇒ 裸包名')
})

/** 0.1.7 形态：宿主运行时快照（不再是 plugin 包装）。 */
const nextHostSnapshot = (chars) => ({
  type: 'user/message',
  data: {
    id: 'm-next-' + chars, role: 'user',
    source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'sandbox:policy', text: 'x' }] },
    content: [{ type: 'text', text: 'Current runtime context. ' + 'x'.repeat(Math.max(0, chars - 24)) }],
  },
})

/** 0.1.7 形态：我们自己的投递（生产者自报 kind，**不再有 plugin 字段**）。 */
const nextOwnNotice = (text) => ({
  type: 'user/message',
  data: {
    id: 'm-next-own', role: 'user',
    source: { kind: 'plugin:' + OWN_PLUGIN, form: 'notice', summary: 'self' },
    content: [{ type: 'text', text }],
  },
})

t('新形态（0.1.7）下：宿主快照被收集、且**不算**我们的累积', () => {
  const s = summarizeWire([nextHostSnapshot(485), userMsg('x')])
  ok(s.pluginMessages === 1, '宿主的运行时快照要算一条贡献')
  eq(s.ownMessages, 0, '不是我们投的')
  eq(s.accumulation, false, '不报累积')
})

t('新形态（0.1.7）下：我们自己的投递仍被认成"我们的"（否则累积/份数全失效）', () => {
  const s = summarizeWire([nextOwnNotice('包 A'), nextOwnNotice('包 B')])
  eq(s.ownMessages, 2, '两份自己的投递')
  eq(s.accumulation, true, '这才是累积，必须报警')
  ok(s.plugins.includes(OWN_PLUGIN), '生产者名字应归一成裸包名：' + JSON.stringify(s.plugins))
})

t('混代台账（同一个人的日志里两代形态并存）也能读', () => {
  const s = summarizeWire([hostSnapshot(485), nextHostSnapshot(485), ownNotice('A'), nextOwnNotice('B')])
  eq(s.pluginMessages, 4, '四条贡献都要认出来')
  eq(s.ownMessages, 2, '两代各一份都是我们投的')
})

console.log(JSON.stringify({
  suite: 'po06-dump-wire', phase: 'P8-A15',
  total: pass + failures.length, pass, fail: failures.length, failures,
}, null, 2))
if (failures.length > 0) process.exit(1)
