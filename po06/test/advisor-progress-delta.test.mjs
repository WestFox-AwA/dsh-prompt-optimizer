import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdvisorProgress, ADVISOR_THINK_LIMIT } from '../lib/advisor-progress.js'

// 高频轮询的前提：服务端只回增量。这里钉住增量的三条语义 ——
//   ① 给了 since 就只回新增的那一截，且全量字段置空（否则"省下的传输"又回来了）；
//   ② 偏移落不进保留窗口 ⇒ 回全量 + resync，让客户端重同步；
//   ③ 换了回合 draft 归零 ⇒ 同样 resync。
const mk = () => createAdvisorProgress({ home: mkdtempSync(join(tmpdir(), 'po06-prog-')) })
const start = (p, over = {}) => p.start(Object.assign({ sessionId: 's1', callId: 'c1', mode: 'review_result', question: 'q', timeoutMs: 1000 }, over))

test('不给 since 就是全量（老客户端行为不变）', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { reasoning: 'abc' })
  const run = p.get('s1', { callId: 'c1' })
  assert.equal(run.reasoning, 'abc')
  assert.equal(run.delta, undefined, '全量模式不该带增量标记')
  assert.equal(run.reasoningChars, 3)
})

test('给了 since 只回增量，且全量字段置空', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { reasoning: '第一段' })
  const first = p.get('s1', { callId: 'c1', since: 0, draftSince: 0 })
  assert.equal(first.delta, true)
  assert.equal(first.reasoning, '', '增量模式必须清空全量字段')
  assert.equal(first.reasoningDelta, '第一段')
  assert.equal(first.reasoningLen, 3, '要报告服务端保留窗口长度，客户端据此对齐裁剪')
  // 客户端已收到 3 字，再来 2 字
  p.delta(id, { reasoning: '第二' })
  const second = p.get('s1', { callId: 'c1', since: 3, draftSince: 0 })
  assert.equal(second.reasoningDelta, '第二', '只该回新增部分')
  assert.equal(second.reasoningChars, 5)
  assert.ok(second.reasoningDelta.length < second.reasoningChars, '增量必须小于全量')
})

test('偏移被截断窗口甩掉 ⇒ 回全量并标 resync', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { reasoning: 'x'.repeat(ADVISOR_THINK_LIMIT + 500) })
  const stale = p.get('s1', { callId: 'c1', since: 10, draftSince: 0 })
  assert.equal(stale.resync, true)
  assert.equal(stale.delta, false)
  assert.equal(stale.reasoning.length, ADVISOR_THINK_LIMIT, 'resync 要带全量（即当前保留窗口）')
  // 偏移仍在窗口内 ⇒ 照常增量
  const fresh = p.get('s1', { callId: 'c1', since: ADVISOR_THINK_LIMIT + 400, draftSince: 0 })
  assert.equal(fresh.delta, true)
  assert.equal(fresh.reasoningDelta.length, 100)
})

test('新回合把 draft 归零 ⇒ draft 侧 resync，reasoning 侧照常', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { reasoning: 'r1', text: 'draft-one' })
  const d1 = p.get('s1', { callId: 'c1', since: 0, draftSince: 0 })
  assert.equal(d1.draftDelta, 'draft-one')
  p.event(id, { kind: 'round', round: 2, final: false })
  p.delta(id, { text: 'new' })
  // 客户端手里还是上一回合的 9 字偏移，而新一轮的 draftChars 只有 3 ⇒ 旧偏移超出总数，必须重同步
  const d2 = p.get('s1', { callId: 'c1', since: 2, draftSince: 9 })
  assert.equal(d2.resync, true, 'draftChars 归零后旧偏移不再成立，必须重同步')
  assert.equal(d2.draft, 'new', '重同步要带回新一轮的全量正文')
  assert.equal(d2.reasoning, 'r1', 'reasoning 没被截断，重同步时也要带回全量')
})


test('跨回合偏移碰撞：新回合已攒够字数时也必须 resync（否则画面混排）', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { text: 'aaaa' })
  const r1 = p.get('s1', { callId: 'c1', draftSince: 0 })
  assert.equal(r1.draftDelta, 'aaaa')
  p.event(id, { kind: 'round', round: 2, final: false })
  // 新回合又产出 6 字：客户端手里是上一回合的 4 字偏移，6-4=2 落在合法区间 ——
  // 光比字数会认为是"新增 2 字"，于是把新回合的尾巴拼到旧回合正文后面。
  p.delta(id, { text: 'bbbbbb' })
  const noRound = p.get('s1', { callId: 'c1', draftSince: 4 })
  assert.equal(noRound.draftDelta, 'bb', '（没有回合信息时确实会误判 —— 这就是要防的形态）')
  const withRound = p.get('s1', { callId: 'c1', draftSince: 4, draftRound: 1 })
  assert.equal(withRound.resync, true, '带回合号且不一致 ⇒ 必须重同步')
  assert.equal(withRound.draft, 'bbbbbb', '重同步给的是新回合的全量正文')
})

test('同一回合内带回合号照常增量（回合号不能把正常增量也打死）', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { text: 'aa' })
  p.delta(id, { text: 'bb' })
  const inc = p.get('s1', { callId: 'c1', draftSince: 2, draftRound: 0 })
  assert.equal(inc.delta, true)
  assert.equal(inc.draftDelta, 'bb')
})
test('非法偏移当没给（不把空串/NaN 当成 0）', () => {
  const p = mk()
  const id = start(p)
  p.delta(id, { reasoning: 'abc' })
  for (const bad of ['', 'abc', -5, undefined, null]) {
    const run = p.get('s1', { callId: 'c1', since: bad, draftSince: bad })
    assert.equal(run.delta, undefined, '非法偏移(' + String(bad) + ')应退回全量')
    assert.equal(run.reasoning, 'abc')
  }
})
