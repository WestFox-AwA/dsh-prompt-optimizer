// P7 · 运行回顾脚本（`scripts/recap.mjs`）的单测。
//
// 运行：node po06/test/recap.test.mjs
//
// 为什么给它配单测（EV-0116）：它是**用户唯一会读的那一页**——
// 真实项目跑完之后，"它到底有没有参与""它替我说了什么"都从这一页看。
// 而它最关键的两条判读恰好是**安全性质**的：
//   ① 条目必须分清"你说过"与"机器补充"（0.6 的立身主张就是**不冒充用户**）；
//   ② 无出处的条目必须是**缺陷**（退出码非零），不能只在正文里小声提一句。
// 判据写错会让用户看到一页"看起来很干净"的假象——所以用 fixture 钉住。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync as readFileSyncTop } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'recap.mjs')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const rec = (over) => JSON.stringify({
  at: '2026-09-21T10:00:00.000Z', sessionId: 'session-aaaa1111', messageId: 'm1',
  chars: 40, trigger: 'user-message', ok: true, outcome: 'committed',
  provider: 'p', model: 'm', ms: 1000, packetChars: 300, revision: 2, trace: ['a', 'b'], ...over,
})
const state = (items, over = {}) => JSON.stringify({
  schemaVersion: 1, sessionId: 'session-aaaa1111', taskId: 't', revision: 2,
  lastInputRevision: 2, sourceMessageIds: ['m1'], phase: 'idle', items,
  questions: [], artifactRefs: [], verificationRefs: [], ...over,
})
const item = (kind, text, refKind) => ({
  id: 'i' + Math.random().toString(36).slice(2, 6), kind, status: 'active', scope: 'task', text,
  sourceRefs: refKind ? [{ kind: refKind, sessionId: 'session-aaaa1111', messageId: 'm1' }] : [],
  appliesTo: [], supersedes: [], dependsOn: [],
})

/** 建一个假 home 并跑回顾脚本。 */
function run({ wire = [], states = {}, jsonOut = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'po06-recap-'))
  DIRS.push(home)
  if (wire !== null) writeFileSync(join(home, 'po06-wire.jsonl'), wire.join('\n') + '\n', 'utf8')
  if (states !== null) {
    mkdirSync(join(home, 'po06-state'), { recursive: true })
    for (const [name, body] of Object.entries(states)) writeFileSync(join(home, 'po06-state', name), body, 'utf8')
  }
  const args = [SCRIPT, '--home', home]
  const outJson = join(home, 'recap.json')
  if (jsonOut) args.push('--json', outJson)
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8' })
    return { exit: 0, stdout, home, outJson }
  } catch (e) {
    return { exit: e.status, stdout: String(e.stdout || ''), home, outJson }
  }
}

// ── ① 正常一轮：分清"你说过"与"机器补充" ─────────────────────────────
t('条目按出处分流：你说过 / 机器补充 / 无出处', () => {
  const r = run({
    wire: [rec({}), rec({ sessionId: 'session-bbbb2222', outcome: 'skipped', ok: false, reason: '没启用' })],
    states: {
      'session-aaaa1111.json': state([
        item('user_requirement', '输出只有一行', 'human'),
        item('unknown', '未指定的取舍', 'model'),
      ]),
    },
  })
  ok(r.stdout.includes('**合计**：来自你的话 **1** 条 ｜ 机器补充 **1** 条 ｜ 无出处 **0** 条'),
    '合计行不对：\n' + r.stdout)
  ok(r.stdout.includes('你说过') && r.stdout.includes('机器补充'), '明细应标注来源')
  ok(r.stdout.includes('committed×1') && r.stdout.includes('skipped×1'), '判定结果应逐类计数：\n' + r.stdout)
  ok(r.stdout.includes('没有正常提交的轮次'), '未提交的轮次要单列（EV-0078 的解药）')
  eq(r.exit, 0, '正常数据不该退出非零；输出：\n' + r.stdout)
})

// ── ② 无出处条目 ⇒ **必须**非零（安全性质，不是排版问题）────────────────
t('无出处条目 ⇒ 非零退出 + 明确警告（不许只是小声提一句）', () => {
  const r = run({
    wire: [rec({})],
    states: { 'session-aaaa1111.json': state([item('user_requirement', '凭空冒出来的一条', null)]) },
  })
  eq(r.exit, 1, '无出处条目必须是失败；输出：\n' + r.stdout)
  ok(r.stdout.includes('无出处'), '应出现"无出处"字样：\n' + r.stdout)
  ok(r.stdout.includes('没有出处'), '警告里应说清是"没有出处"：\n' + r.stdout)
})

// ── ③ 台账坏行 ⇒ 警告 + 非零（静默吞掉坏数据是不可接受的）───────────────
t('台账里有坏行 ⇒ 警告且非零退出（不静默吞掉）', () => {
  const r = run({ wire: [rec({}), '{这不是 JSON'], states: null })
  eq(r.exit, 1, '坏行应导致非零；输出：\n' + r.stdout)
  ok(/无法解析/.test(r.stdout), '应报"无法解析"：\n' + r.stdout)
})

// ── ⑥ 分叉继承：单独成节，且**不得**污染逐轮统计 ──────────────────────
t('分叉继承记录单独成节，不计入逐轮统计（回归：曾把包字符均值拉低）', () => {
  const r = run({
    wire: [
      rec({ packetChars: 300, ms: 2000 }),
      rec({ trigger: 'fork-inherit', sessionId: 'session-child', inheritedFrom: 'session-aaaa1111', revision: 4, chars: undefined, packetChars: undefined, ms: undefined, outcome: undefined, ok: true }),
    ],
    states: null,
  })
  ok(r.stdout.includes('分叉继承（1 次）'), '应有分叉继承小节：\n' + r.stdout)
  // 表里用的是**短 id**（`session-` 前缀会被去掉）——断言要照实际输出写，不能照我以为的写
  ok(/\| `child` \| `aaaa1111` \| 4 \|/.test(r.stdout), '应写出子会话 / 继承自 / 版本：\n' + r.stdout)
  ok(r.stdout.includes('说明继承**没发生**'), '没有行时要能说清后果（否则"没继承"会被读成"没分叉"）：\n' + r.stdout)
  // 逐轮统计必须只算 1 轮、均值不被 0 拉低
  ok(r.stdout.includes('**1 个会话 / 1 轮输入**'), '逐轮统计只应算 1 轮：\n' + r.stdout)
  ok(r.stdout.includes('平均 300 字符'), '包字符均值应是 300（不被分叉记录拉低）：\n' + r.stdout)
  ok(!/没有正常提交的轮次/.test(r.stdout), '分叉继承**不是**失败轮次，不得出现在失败清单里')
})

// ── ⑦ 什么都没跑过 ⇒ 说明而不是失败（"没跑过"不等于"出错"）──────────────
t('没跑过（两个文件都不存在）⇒ 给说明，退出码 0', () => {
  const r = run({ wire: null, states: null })
  eq(r.exit, 0, '不该把"没跑过"判成失败；输出：\n' + r.stdout)
  ok(r.stdout.includes('一次都没被触发过'), '应说明为什么没有台账：\n' + r.stdout)
})

// ── ⑤ --json 可供机器读 ──────────────────────────────────────────────
t('--json 输出结构化结果（会话/条目/问题计数）', () => {
  const r = run({
    wire: [rec({}), rec({ revision: 3 })],
    states: { 'session-aaaa1111.json': state([item('user_requirement', 'x', 'human')], { revision: 3, questions: [{ text: 'q' }] }) },
    jsonOut: true,
  })
  const j = JSON.parse(readFileSyncTop(r.outJson, 'utf8'))
  eq(j.wire.records, 2, '台账条数')
  eq(j.wire.outcomes.committed, 2, '按结果分类')
  eq(j.sessions[0].items, 1, '条目数')
  eq(j.sessions[0].questions, 1, '问题数')
  eq(j.state.sessions, 1, '会话数')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-recap', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '用假 home 跑回顾脚本：出处分流、无出处必须非零、坏行不静默、没跑过不算失败、--json 可机器读。不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
