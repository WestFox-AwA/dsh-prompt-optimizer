import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/**
 * 顾问这条流要按"会话里那种"高频刷新。这里钉住三件事：
 *   ① 轮询节拍不再是 800ms（用户看到的一秒一跳就是它）；
 *   ② 增量能正确拼进本地缓冲、并跟服务端保留窗口对齐；
 *   ③ 内容没变不重渲染（25ms 一次若每次都 setState，就是每秒 40 次空渲染）。
 */
function load() {
  const regs = []
  const win = {
    __ModuleLoader__: { load: (r) => regs.push(r) }, innerWidth: 1200, innerHeight: 900,
    getComputedStyle: () => ({ position: 'static' }), setTimeout: () => 0, setInterval: () => 0,
    addEventListener: () => {}, removeEventListener: () => {}, clearTimeout: () => {}, clearInterval: () => {},
  }
  const React = { createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }), Fragment: 'F', useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f() }
  const req = (n) => (n === 'react' ? React : {})
  new Function('window', 'require', 'document', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame', source)(win, req, {}, class {}, class {}, (fn) => fn())
  const mod = regs[0].factory(req)
  mod.apply({ slots: { register: () => () => {}, inject: (s, cb) => cb() }, locale: 'en' })
  return mod.__debug
}

test('轮询节拍按会话级的量级走，且旧的 800ms 硬编码已消失', () => {
  const d = load()
  assert.equal(typeof d.ADVISOR_POLL_MS, 'number')
  assert.ok(d.ADVISOR_POLL_MS <= 50, '节拍要够快才像连续打字，实际 ' + d.ADVISOR_POLL_MS + 'ms')
  assert.ok(d.ADVISOR_POLL_MS >= 8, '也别快到把主线程占满：' + d.ADVISOR_POLL_MS + 'ms')
  assert.ok(d.ADVISOR_POLL_ERROR_MS >= 200, '出错要退避，不能按快节拍一直打')
  assert.ok(!source.includes('setTimeout(tick, 800)'), '旧的 800ms 链式轮询不该还在')
  assert.ok(source.includes('&since='), '取数要带增量偏移，否则 25ms 轮询会变成每秒上兆')
})

test('增量拼进缓冲：偏移按累计字数走，缓冲按服务端窗口裁', () => {
  const d = load()
  let buf = { reasoning: '', draft: '', since: 0, draftSince: 0 }
  buf = d.advisorMergeProgress(buf, { delta: true, reasoningDelta: '第一段', draftDelta: '结论', reasoningLen: 100, draftLen: 100 })
  assert.equal(buf.reasoning, '第一段')
  assert.equal(buf.draft, '结论')
  assert.equal(buf.since, 3, '偏移 = 累计收到的字数')
  assert.equal(buf.draftSince, 2)
  buf = d.advisorMergeProgress(buf, { delta: true, reasoningDelta: '又一段', draftDelta: '', reasoningLen: 100, draftLen: 100 })
  assert.equal(buf.reasoning, '第一段又一段')
  assert.equal(buf.since, 6)
  // 服务端窗口只有 4 字 ⇒ 客户端也裁到 4 字（保证"直播看到的"与"刷新后看到的"一致）
  buf = d.advisorMergeProgress(buf, { delta: true, reasoningDelta: 'xxx', draftDelta: '', reasoningLen: 4, draftLen: 100 })
  assert.equal(buf.reasoning, '第一段又一段xxx'.slice(-4), '要按 reasoningLen 裁尾')
  assert.equal(buf.since, 9, '裁剪不影响偏移：偏移是累计量，不是缓冲长度')
})


test('响应里没有字数统计 ⇒ 也关掉增量参数（次要保险）', () => {
  const d = load()
  let buf = { reasoning: '', draft: '', since: 0, draftSince: 0, round: 0, deltaCapable: true }
  buf = d.advisorMergeProgress(buf, { reasoning: '全量正文', draft: '', stage: 'thinking' })
  assert.equal(buf.deltaCapable, false, '认不出字数统计就不能再带 since')
  // 取数 URL 只在 deltaCapable 时才拼增量参数（拼了也没用，旧宿主忽略后照旧全量）
  assert.ok(source.includes("buffer.deltaCapable !== false"), '增量参数必须受 deltaCapable 门控')
  assert.equal(buf.reasoning, '全量正文')
  // 正常宿主里字数统计一直在 ⇒ 不能被误关
  let ok = { reasoning: '', draft: '', since: 0, draftSince: 0, round: 0, deltaCapable: true }
  ok = d.advisorMergeProgress(ok, { delta: true, reasoningDelta: 'x', draftDelta: '', reasoningChars: 1, draftChars: 0, round: 0 })
  assert.equal(ok.deltaCapable, true)
  assert.equal(ok.round, 0)
})

test('活动封顶后新活动仍要触发重绘（认最后一条，不认条数）', () => {
  const d = load()
  const acts = Array.from({ length: 24 }, (_, i) => ({ tool: 'read', at: 1000 + i }))
  const base = { stage: 'evidence', reasoningChars: 5, draftChars: 1, toolCalls: 24, round: 1, activities: acts, startedAt: 0 }
  const k1 = d.advisorProgressKey(base, 5000)
  // ⚠ 用例必须**只**动活动本身：若同时改 toolCalls（key 里也有它），退回"只看条数"的旧实现照样会绿 ——
  //   那就成了不具区分性的用例（复核指出过这一点）。所以这里保持 toolCalls / stage / 字数全部不变。
  const k2 = d.advisorProgressKey({ ...base, activities: [...acts.slice(1), { tool: 'glob', at: 2000 }] }, 5000)
  assert.notEqual(k2, k1, '同样 24 条、同样 toolCalls，只是换了最后一条活动 ⇒ 也必须让 key 变化')
  // 反向：活动与其它字段都没变 ⇒ 不该重绘
  assert.equal(d.advisorProgressKey({ ...base }, 5000), k1, '什么都没变就不该重绘')
})

test('轮询链有超时与空转退避（挂起一次不能把流停死）', () => {
  const d = load()
  assert.ok(d.ADVISOR_REQUEST_TIMEOUT_MS >= 2000 && d.ADVISOR_REQUEST_TIMEOUT_MS <= 30000, '单次请求必须有超时')
  assert.ok(d.ADVISOR_POLL_IDLE_MS >= 100, '记录还没建出来时不该按 25ms 空转')
  assert.ok(source.includes('timedOut'), '超时取消要与卸载取消区分：前者要继续排下一次')
  assert.ok(source.includes('draftRound='), '要带上回合号，否则跨回合会把新片段拼到旧正文后面')
})

test('下一次排多久：正常 25ms、没读到记录退到 250ms、出错退到 500ms 但不停止', () => {
  const d = load()
  assert.equal(d.advisorNextDelayMs(true, d.ADVISOR_POLL_MS), d.ADVISOR_POLL_MS, '正常按 25ms 继续')
  assert.equal(d.advisorNextDelayMs(false, d.ADVISOR_POLL_MS), d.ADVISOR_POLL_IDLE_MS, '没记录就空转退避')
  assert.equal(d.advisorNextDelayMs(true, d.ADVISOR_POLL_MS, false), d.ADVISOR_POLL_FULL_MS, '拿不到增量就慢一档')
  assert.equal(d.advisorNextDelayMs(true, d.ADVISOR_POLL_ERROR_MS), d.ADVISOR_POLL_ERROR_MS, '出错后仍按退避间隔继续（不能停链）')
  assert.equal(d.advisorNextDelayMs(false, d.ADVISOR_POLL_ERROR_MS), d.ADVISOR_POLL_ERROR_MS, '两个退避取大的那个')
  assert.equal(d.advisorNextDelayMs(true, 0), d.ADVISOR_POLL_MS, '间隔非法时回落到基础节拍')
})

test('旧宿主降级：要了增量却没拿到 ⇒ 连续 3 次就关掉增量并放慢取数', () => {
  const d = load()
  let misses = 0
  // 旧宿主：每次回整段（既无 delta 也无 resync）
  misses = d.advisorDeltaMiss(misses, { reasoning: '整段', reasoningChars: 2 }, true)
  assert.equal(misses, 1)
  misses = d.advisorDeltaMiss(misses, { reasoning: '整段2', reasoningChars: 3 }, true)
  assert.equal(misses, 2)
  misses = d.advisorDeltaMiss(misses, { reasoning: '整段3', reasoningChars: 4 }, true)
  assert.equal(misses, 3, '第三次就该判为不认识增量')
  // 拿到增量 ⇒ 计数清零（新宿主下永远不会误降级）
  assert.equal(d.advisorDeltaMiss(3, { delta: true, reasoningDelta: 'x' }, true), 0)
  // 合法重同步不算漏
  assert.equal(d.advisorDeltaMiss(2, { resync: true, reasoning: '全文' }, true), 2)
  // 还没开始要增量（首次 since=0）也不算漏
  assert.equal(d.advisorDeltaMiss(0, { reasoning: '首位' }, false), 0)
  // 降级后取数放慢：不再是 25ms 传整段
  assert.equal(d.advisorNextDelayMs(true, d.ADVISOR_POLL_MS, false), d.ADVISOR_POLL_FULL_MS)
  assert.ok(d.ADVISOR_POLL_FULL_MS >= 100, '整段取数必须明显放慢')
  assert.equal(d.advisorNextDelayMs(true, d.ADVISOR_POLL_MS, true), d.ADVISOR_POLL_MS, '正常宿主仍是 25ms')
})
test('全量/重同步直接替换缓冲，而不是接着拼', () => {
  const d = load()
  let buf = { reasoning: 'old-buffer', draft: 'old-draft', since: 99, draftSince: 99 }
  buf = d.advisorMergeProgress(buf, { delta: false, resync: true, reasoning: 'fresh', draft: 'new-draft', reasoningChars: 5, draftChars: 9 })
  assert.equal(buf.reasoning, 'fresh')
  assert.equal(buf.draft, 'new-draft')
  assert.equal(buf.since, 5, '重同步后用服务端报告的总字数当新偏移')
  assert.equal(buf.draftSince, 9)
})

test('内容没变就不重渲染；变了或过了一秒才重渲染', () => {
  const d = load()
  const base = { stage: 'thinking', reasoningChars: 10, draftChars: 2, toolCalls: 0, round: 1, activities: [], startedAt: 1000 }
  const k1 = d.advisorProgressKey(base, 5000)
  assert.equal(d.advisorProgressKey({ ...base }, 5000), k1, '同样内容、同一秒内 ⇒ 同一个 key（不 setState）')
  assert.notEqual(d.advisorProgressKey({ ...base, reasoningChars: 11 }, 5000), k1, '来了新字 ⇒ 要重渲染')
  assert.notEqual(d.advisorProgressKey({ ...base, stage: 'evidence' }, 5000), k1, '换阶段 ⇒ 要重渲染')
  assert.notEqual(d.advisorProgressKey({ ...base, activities: [{ tool: 'read' }] }, 5000), k1, '多一条活动 ⇒ 要重渲染')
  assert.notEqual(d.advisorProgressKey(base, 6100), k1, '过了一秒 ⇒ 秒数要动（耗时显示不能停）')
  assert.equal(d.advisorProgressKey(null, 5000), 'none')
})
