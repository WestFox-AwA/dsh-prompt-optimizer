// 空闲守卫（stall detection）。真机现象：provider 建连成功后一个字节都不发，而唯一的守卫是
// 300s 总熔断 ⇒ 一次咨询干等满 300s。本套件的判据分两层：
//   ① 无产出时**必须在 stallMs 判死**，且原因要说清是挂起而不是取消；
//   ② 有产出时**绝不许判死**（心跳必须被重置）—— 这条才是防误报的防线，别只测 ①。
// 用例一律用毫秒级 stallMs，不真等 90s（同文件 :170 的 timeoutMs:20 就是这个写法）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advisorSnapshot, createAdvisor, ADVISOR_STALL_MS, resolveAdvisorStallMs } from '../lib/advisor.js'
import { createAdvisorProgress } from '../lib/advisor-progress.js'

const human = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const session = { id: 's-stall', snapshotEvents: () => [human('目标：空闲守卫')] }
const exec = { agent: { session } }
const runtime = { ok: true, cfg: { provider: 'p', model: 'optimizer', reasoningEffort: 'high' }, readTools: false }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

test('resolveAdvisorStallMs：默认 90s、可调、0 关闭、上限钳到总限时之内', () => {
  assert.equal(ADVISOR_STALL_MS, 90000)
  assert.equal(resolveAdvisorStallMs({}), ADVISOR_STALL_MS)
  assert.equal(resolveAdvisorStallMs({ DSH_PO06_ADVISOR_STALL_MS: '30000' }), 30000)
  assert.equal(resolveAdvisorStallMs({ DSH_PO06_ADVISOR_STALL_MS: '0' }), 0, '0 = 显式关闭')
  assert.equal(resolveAdvisorStallMs({ DSH_PO06_ADVISOR_STALL_MS: '-1' }), 0, '非正数同样视为关闭')
  assert.equal(resolveAdvisorStallMs({ DSH_PO06_ADVISOR_STALL_MS: 'abc' }), ADVISOR_STALL_MS, '无法解析回落默认')
  // 钳制：空闲守卫晚于总熔断就永远不会触发，等于白配 ⇒ 钳到总限时内（注释里写明是决定）
  assert.equal(resolveAdvisorStallMs({ DSH_PO06_ADVISOR_STALL_MS: '600000' }, 120000), 120000)
  assert.equal(resolveAdvisorStallMs({}, 45000), 45000, '默认值也要受总限时钳制')
})

test('建连后不发字节 ⇒ 在 stallMs 判死，原因区分于"被取消"', async () => {
  let entered, settled = false
  const started = new Promise(r => { entered = r })
  // timeoutMs 故意**远大于** stallMs：守卫在位时 ~20ms 判死；万一守卫整条被摘掉，本用例只会在
  // 5s 处拿到 advisor-timeout 而变红 —— 不必等默认 300s，CI 里取证是秒级的。
  const invoke = createAdvisor({ stallMs: 20, timeoutMs: 5000, resolveRuntime: async () => ({ ...runtime,
    llm: { stream: o => (async function* () {
      entered(); await new Promise(r => o.signal.addEventListener('abort', r, { once: true })); settled = true
    })() } }) })
  const t0 = Date.now()
  const pending = invoke({ mode: 'review_result', question: '复核' }, exec)
  await started
  const out = await pending
  assert.equal(out.reason, 'advisor-stall-timeout')
  assert.equal(settled, true, '必须真的把模型流 abort 掉，不能只回原因不管在途调用')
  // 判死要**早于**总熔断，否则这条守卫等于不存在。
  assert.ok(Date.now() - t0 < 5000, `应在 stallMs 附近结束，实测 ${Date.now() - t0}ms`)
})

test('持续有产出时绝不判死（心跳必须被重置 —— 防误报的核心防线）', async () => {
  const report = JSON.stringify({ verdict: 'unverified', summary: 's', findings: [], checks: [], nextStep: 'n', stopCondition: 'x' })
  let chunks = 0
  const invoke = createAdvisor({ stallMs: 40, timeoutMs: 5000, resolveRuntime: async () => ({ ...runtime,
    llm: { stream: o => (async function* () {
      // 每 20ms 一个 reasoning-delta，共 10 个 = 200ms，远超 stallMs=40。
      // 心跳没接上的话这里会在 40ms 就被判挂起 —— 那正是本用例要抓的错。
      for (let i = 0; i < 10; i += 1) {
        await sleep(20)
        if (o.signal?.aborted) break       // 真实 provider 被 abort 后会终止流；不模拟这一步就测不出提前中止
        chunks += 1
        yield { type: 'reasoning-delta', text: '想'.repeat(8) }
      }
      yield { type: 'text-delta', text: report }
    })() } }) })
  const out = await invoke({ mode: 'review_result', question: '复核持续产出' }, exec)
  assert.equal(chunks, 10, '流不该被提前 abort')
  // ⚠ 挂起标记落在 **out.cut / out.partial** 上（截断路径保留已产出内容），不在 out.reason 上。
  //   第一版断言写的是 out.reason ⇒ 心跳整条摘掉也照样全绿（突变检查 S1 抓到的是**测试自己的缺陷**）。
  assert.notEqual(out.cut, 'advisor-stall-timeout', '有产出时不许出现挂起标记')
  assert.ok(!out.partial, '有产出时不该被标成截断')
  assert.equal(out.ok, true, '正常产出应当成功返回')
})

test('已产出内容时挂起只标 partial，不抹掉东西（与总熔断同口径）', async () => {
  let entered
  const started = new Promise(r => { entered = r })
  const invoke = createAdvisor({ stallMs: 20, timeoutMs: 5000, resolveRuntime: async () => ({ ...runtime,
    llm: { stream: o => (async function* () {
      entered(); yield { type: 'text-delta', text: '{"verdict":"pass"' }   // 半截 JSON：有产出但解析不出来
      await new Promise(r => o.signal.addEventListener('abort', r, { once: true }))
    })() } }) })
  const pending = invoke({ mode: 'review_result', question: '复核' }, exec)
  await started
  const out = await pending
  assert.equal(out.cut, 'advisor-stall-timeout')
  assert.equal(out.partial, true)
  assert.ok(out.raw && out.raw.includes('verdict'), '已产出的半截内容必须交回，不能只回一个原因')
})

test('stallMs=0 关闭守卫：无产出时仍由总熔断兜住', async () => {
  let entered, abortedBy = null
  const started = new Promise(r => { entered = r })
  const invoke = createAdvisor({ stallMs: 0, timeoutMs: 30, resolveRuntime: async () => ({ ...runtime,
    llm: { stream: o => (async function* () {
      entered(); await new Promise(r => { o.signal.addEventListener('abort', () => { abortedBy = 'aborted'; r() }, { once: true }) })
    })() } }) })
  const pending = invoke({ mode: 'review_result', question: '复核' }, exec)
  await started
  const out = await pending
  assert.equal(out.reason, 'advisor-timeout', '关闭空闲守卫后应当回到总熔断的行为，不是挂起也不是取消')
  assert.equal(abortedBy, 'aborted')
})

test('挂起计数走 advisorSnapshot 之外的路径不影响既有判定', async () => {
  // 回归哨兵：本改动只动 abort 的三态与心跳，不碰材料/阶段/引用逻辑。
  const snap = advisorSnapshot([human('目标')], 'review_result')
  assert.equal(snap.ok, true)
})

// ── 消费方静态守卫 ──────────────────────────────────────────────────────────
// advisor.js 新增的 reason 有**两个仓外消费方**按字符串匹配它：progress 的 stage 归位、client 的
// 文案映射。这类"同一事实写两份"的地方必然漂移（本项目别处已经栽过），所以在这里把它们钉住：
// 改了 reason 名却没同步消费方时，本套件的运行结果仍是绿的 ⇒ 必须有一条静态断言变红。
// 取静态而非动态：advisorReason 在 client 的注册闭包内，没有既有 debug 入口，不为一条字符串
// 新开测试专用 API（同 po06/test/client-file.test.mjs 的口径）。
const PROGRESS_SRC = readFileSync(new URL('../lib/advisor-progress.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('advisor-progress 把挂起归入 timeout 终态（否则卡片停在非终态一直轮询）', () => {
  // 行为判据，不用静态匹配：静态按行匹配会被"同行后半段仍有 stall 字样"骗过去（突变 S5 抓到的正是这个）。
  const store = createAdvisorProgress({})
  const cutId = store.start({ sessionId: 's1', callId: 'c1', mode: 'review_result', question: 'q' })
  store.finish(cutId, { ok: false, reason: 'advisor-stall-timeout' })
  assert.equal(store.get('s1', { callId: 'c1' }).stage, 'timeout', 'reason 通道要归 timeout 终态')
  const cutId2 = store.start({ sessionId: 's1', callId: 'c2', mode: 'review_result', question: 'q' })
  store.finish(cutId2, { ok: false, partial: true, cut: 'advisor-stall-timeout' })
  assert.equal(store.get('s1', { callId: 'c2' }).stage, 'timeout', 'cut 通道同样要归 timeout 终态')
  // 对照：真取消仍应是 cancelled，别把三态又压回两态。
  const cutId3 = store.start({ sessionId: 's1', callId: 'c3', mode: 'review_result', question: 'q' })
  store.finish(cutId3, { ok: false, reason: 'advisor-cancelled' })
  assert.equal(store.get('s1', { callId: 'c3' }).stage, 'cancelled')
})

test('progress 的 stage 复用既有终态名，不新造枚举', () => {
  // 客户端 advisorTerminal 集合只认 done/failed/cancelled/timeout/interrupted；
  // 若为挂起新造一个 stage 名，卡片会永不收尾、一直轮询。这条钉住"不许新增"。
  const lines = PROGRESS_SRC.split('\n')
  const at = lines.findIndex(l => /row\.stage\s*=/.test(l) && l.includes("'advisor-timeout'"))
  assert.ok(at >= 0, '找不到 finish() 的 stage 归位语句，可能文件结构变了')
  const stageBlock = lines.slice(at, at + 3).join('\n')
  const stageValues = [...new Set([...stageBlock.matchAll(/'([^']*)'/g)].map(m => m[1]).filter(s => !s.startsWith('advisor-')))]
  assert.deepEqual(stageValues.sort(), ['cancelled', 'done', 'failed', 'timeout'], 'stage 值必须复用既有终态集合')
})

test('client 的 reason 文案含挂起一条（缺了会把内部字符串直接甩给用户）', () => {
  assert.match(CLIENT_SRC, /'advisor-stall-timeout':\s*L\(/, 'advisorReason 里要有挂起的中英双语文案')
  // advisor-timeout 的既有文案不许被改掉：它是总熔断的用户可见承诺。
  assert.match(CLIENT_SRC, /'advisor-timeout':\s*L\('咨询已到时限'/)
})

test('index.js 真的把 stallMs 接进 createAdvisor（只加常量不接线 = 守卫不存在）', () => {
  const idx = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(idx, /resolveAdvisorStallMs/, 'index.js 必须导入解析函数')
  assert.match(idx, /stallMs:\s*resolveAdvisorStallMs\(/, 'createAdvisor 调用点必须注入 stallMs')
})

test('invoke 的 finally 同时清总熔断与空闲计时器（漏一个就是计时器泄漏）', () => {
  // 行为用例抓不到这条：空闲计时器远短于测试时长，即使不清理也会在结束前自己触发，
  // 进程照常退出 ⇒ 只能静态钉住 finally 里两个 clearTimeout 都在。
  const adv = readFileSync(new URL('../lib/advisor.js', import.meta.url), 'utf8')
  const fin = adv.match(/finally\s*\{[^}]*\}/)
  assert.ok(fin, '找不到 invoke 的 finally')
  assert.match(fin[0], /clearTimeout\(timer\)/, '总熔断计时器要清')
  assert.match(fin[0], /stopStall\(\)/, '空闲计时器要清（stopStall）')
})
