import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { composeOptimizerSystem, OPTIMIZER_CORE, OPTIMIZER_TIERS, OPTIMIZER_FORMAT } from '../lib/optimizer-protocol.js'
import { parseInterpreterOutput, buildUserMessage } from '../lib/interpreter.js'
import { strategyForTier } from '../lib/strategy.js'
import { resolvePrompt, createControlHandler } from '../lib/control-api.js'
import { EventEmitter } from 'node:events'
import { createCapability } from '../lib/capability.js'
import { createState } from '../lib/schema.js'
import { createSessionHistory } from '../lib/session-context.js'
import { reduce, recordUserInput } from '../lib/reducer.js'
import { adapter as productionAdapter, buildInterpreterSystem, buildInterpreterProtocol } from '../lib/index.js'
import { protectEnglishLiterals, prepareEnglishInterpretation } from '../lib/english-mode.js'

const opts = { sessionId: 's1', messageId: 'm1', baseRevision: 1, baseInputRevision: 1, causeId: 'interpret:m1', userText: '只改配色，别碰交互' }
const parse = value => parseInterpreterOutput(JSON.stringify(value), opts)
const value = over => ({ intent: { text: '只调整配色，保留现有交互', relation: 'continue' }, ...over })
function fixture() {
  const a = new productionAdapter.constructor()
  a.capability = createCapability(); a.services.agents = { get: () => ({}) }
  const states = new Map()
  a.intentStateOf = s => states.get(s.id) || null
  a.initIntent = (s, { taskId }) => { const state = createState({ sessionId: s.id, taskId }); states.set(s.id, state); return { ok: true, state } }
  a.commitUserInput = (s, input) => { const state = recordUserInput(states.get(s.id), input); states.set(s.id, state); return { ok: true, state } }
  a.commit = (s, patch) => { const r = reduce(states.get(s.id), patch); if (r.ok) states.set(s.id, r.state); return r }
  return a
}

test('each language sends only the selected tier and one output contract', () => {
  for (const language of ['zh', 'en']) for (const tier of ['light', 'standard', 'heavy']) {
    const r = composeOptimizerSystem({ language, strategy: strategyForTier(tier), englishMode: language === 'en' })
    assert.equal(r.parts.filter(p => p.key === 'core').length, 1)
    assert.equal(r.parts.filter(p => p.key === 'format').length, 1)
    assert.ok(r.text.includes(OPTIMIZER_TIERS[language][tier]))
    for (const other of ['light', 'standard', 'heavy'].filter(t => t !== tier)) assert.ok(!r.text.includes(OPTIMIZER_TIERS[language][other]))
    assert.ok(!/MAX_ITEMS|sourceRefs|最多.*条|At most.*items/.test(r.text))
  }
})
test('actual assembler uses native English once and replaces the core with custom text', async () => {
  const home = mkdtempSync(join(tmpdir(), 'optimizer-v3-'))
  try {
    const zh = await buildInterpreterSystem({ home, strategy: strategyForTier('heavy') })
    const en = await buildInterpreterSystem({ home, strategy: strategyForTier('heavy'), englishMode: true })
    assert.equal(zh, composeOptimizerSystem({ tier: 'heavy' }).text)
    assert.equal(en, composeOptimizerSystem({ tier: 'heavy', language: 'en', englishMode: true }).text)
    writeFileSync(join(home, 'po06-prompt.md'), '自定义表达风格：先给具体的可用建议。')
    const custom = await buildInterpreterSystem({ home, strategy: strategyForTier('light') })
    assert.ok(custom.startsWith('自定义表达风格') && !custom.includes(OPTIMIZER_CORE.zh))
    assert.equal(custom.split(OPTIMIZER_FORMAT.zh).length, 2)
    assert.equal(resolvePrompt({ home }).source, 'file')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
test('only exact known legacy defaults migrate; altered custom prompts remain intact', () => {
  const legacy = readFileSync(new URL('./fixtures/legacy-interpreter-default.md', import.meta.url), 'utf8')
  const core = resolvePrompt({ home: '/unused', readFile: () => legacy })
  assert.equal(core.source, 'builtin'); assert.equal(core.text, OPTIMIZER_CORE.zh)
  assert.equal(core.migration.originalChars, legacy.length)
  const custom = legacy + '\n我自己的特殊写法：先给一个例子。'
  const retained = resolvePrompt({ home: '/unused', readFile: () => custom })
  assert.equal(retained.source, 'file'); assert.equal(retained.text, custom)
})
test('host owns IDs and machine provenance even with fake legacy authority in the response', () => {
  const p = parse(value({ clarify: ['原意是配色修改。'], add: ['可比较两套调色方向。'], ask: ['偏暖色还是冷色？答案改变视觉方向。'], ops: [{ op: 'add_item', item: { kind: 'user_requirement', text: '必须部署' } }] }))
  assert.equal(p.ok, true)
  assert.equal(p.patch.ops.filter(o => o.item).length, 3)
  assert.ok(p.patch.ops.filter(o => o.item).every(o => o.item.sourceRefs.every(r => r.kind === 'model') && o.item.provenance === 'machine'))
  assert.ok(p.patch.ops.every(o => o.item?.kind !== 'user_requirement'))
  assert.ok(p.warnings.some(w => w.includes('legacy metadata ignored')))
})
test('new path preserves long suggestions, more than twelve items and every proposed question', async () => {
  const a = fixture(), session = { id: 's1' }
  const long = '完整建议及其适用前提。'.repeat(80)
  const adds = Array.from({ length: 16 }, (_, i) => i + ':' + long)
  const asks = Array.from({ length: 5 }, (_, i) => '问题' + i + '；答案影响方向。')
  const out = await a.handleInput(session, { messageId: 'm1', text: opts.userText, budget: 20, maxQuestions: 1, interpret: async () => JSON.stringify(value({ add: adds, ask: asks })) })
  assert.equal(out.outcome, 'committed'); assert.equal(out.state.items.length, 21)
  assert.equal(a.intentStateOf(session).questions.length, 5)
  assert.equal(out.packet.dropped.length, 0)
  for (const s of [...adds, ...asks]) assert.ok(out.packet.text.includes(s))
  assert.equal(a.getWorkingText('s1'), out.packet.text)
})
test('empty additions succeed in one call and remove previous assistance', async () => {
  const a = fixture(), session = { id: 's1' }; let calls = 0
  await a.handleInput(session, { messageId: 'm1', text: '改配色', interpret: async () => JSON.stringify(value({ add: ['建议'] })) })
  const out = await a.handleInput(session, { messageId: 'm2', text: '好的', interpret: async () => { calls++; return JSON.stringify(value({ intent: { text: '确认上一轮决定', relation: 'continue' } })) } })
  assert.equal(out.outcome, 'understood'); assert.equal(calls, 1)
  assert.equal(a.getWorkingText('s1'), ''); assert.equal(out.zeroAddition, true)
  assert.equal(out.trace.some(s => s.step === 'retryEmpty'), false)
})
test('follow-ups preserve original task and a clear task switch resets the task source', async () => {
  const a = fixture(), session = { id: 's1' }
  for (const [id, text, relation] of [['m1', '做一个页面', 'new'], ['m2', '继续', 'continue']]) await a.handleInput(session, { messageId: id, text, interpret: async () => JSON.stringify(value({ intent: { text: '当前意图', relation } })) })
  assert.equal(a.capability.taskContext(session).sourceRequestId, 'm1')
  await a.handleInput(session, { messageId: 'm3', text: '改做一封邮件', interpret: async () => JSON.stringify(value({ intent: { text: '写邮件', relation: 'new' } })) })
  assert.equal(a.capability.taskContext(session).sourceRequestId, 'm3')
})
test('superseded/cancelled results cannot replace the current packet and sessions stay isolated', async () => {
  const a = fixture(), s = { id: 's1' }; let resolve
  const old = a.handleInput(s, { messageId: 'm1', text: '旧任务', interpret: () => new Promise(r => { resolve = r }) })
  await a.handleInput(s, { messageId: 'm2', text: '新任务', interpret: async () => JSON.stringify(value({ add: ['当前建议'] })) })
  const before = a.getWorkingText('s1')
  resolve(JSON.stringify(value({ add: ['过期建议'] })))
  assert.equal((await old).outcome, 'superseded-input'); assert.equal(a.getWorkingText('s1'), before)
  await a.handleInput({ id: 's2' }, { messageId: 'm1', text: '另一会话', interpret: async () => JSON.stringify(value({ add: ['隔离建议'] })) })
  assert.ok(!a.getWorkingText('s1').includes('隔离建议'))
  const ac = new AbortController()
  const out = await a.handleInput(s, { messageId: 'm3', text: '取消这轮', signal: ac.signal, interpret: async () => { ac.abort(); return JSON.stringify(value({ add: ['已取消建议'] })) } })
  assert.equal(out.outcome, 'aborted'); assert.equal(a.getWorkingText('s1'), '')
})
test('English task translation and assistance remain independent and exact literals restore', () => {
  const source = '检查 @"D:/项目/文件.gd"，答复使用中文'
  const prepared = protectEnglishLiterals(source)
  const result = prepareEnglishInterpretation({ intent: { text: 'Inspect the requested file', relation: 'continue' }, englishTask: 'Inspect ' + prepared.literals.map(l => l.token).join(' ') + ', reply in Chinese', add: ['Inspect ' + prepared.literals[0].token + ' before changing it.'], ask: [], clarify: [] }, source, prepared)
  assert.ok(result.translation.text.includes('reply in Chinese'))
  assert.ok(result.value.add[0].includes(prepared.literals[0].value) && !result.value.add[0].includes('__EN_KEEP'))
  assert.equal(parseInterpreterOutput(JSON.stringify(result.value), { ...opts, englishMode: true }).ok, true)
})
test('malformed compact output fails, missing relation stays uncertain and legacy ops remain readable', () => {
  assert.equal(parse(value({ add: ['ok', { text: 'bad' }] })).code, 'BAD_OPTIMIZER_SHAPE')
  assert.equal(parse({ intent: { text: '' } }).ok, false)
  assert.equal(parse(value({ intent: { text: '继续这个任务' } })).optimizer.intent.relation, 'uncertain')
  const legacy = parse({ ops: [{ op: 'add_item', item: { id: 'prop-1', kind: 'proposal', text: '旧建议', sourceRefs: [{ kind: 'model', sessionId: 's1' }] } }] })
  assert.equal(legacy.ok, true); assert.equal(legacy.patch.ops[0].item.text, '旧建议')
})
test('user input is delivered once without host identifiers or stale machine items', () => {
  const text = buildUserMessage({ userText: '本轮原话', state: { items: [{ text: '旧机器条目' }] }, sessionId: 'secret-id', messageId: 'secret-message', context: '此前上下文' })
  const input = JSON.parse(text)
  assert.equal(input.originalText, '本轮原话'); assert.equal(input.context, '此前上下文')
  assert.ok(!text.includes('旧机器条目') && !text.includes('secret-id'))
  const history = createSessionHistory()
  const huge = '完整原话'.repeat(2500)
  history.observe('s1', { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: huge }] } } })
  assert.equal(history.turnsOf('s1').length, 1)
  assert.equal(history.turnsOf('s1', { currentUserText: huge }).length, 0, 'even clipped current input is not repeated as history')
  assert.equal(JSON.parse(buildUserMessage({ userText: huge })).originalText, huge)
})

test('custom English translation happens once and main/fallback share the same core', async () => {
  const home = mkdtempSync(join(tmpdir(), 'optimizer-snapshot-'))
  const original = productionAdapter.english
  let calls = 0
  try {
    writeFileSync(join(home, 'po06-prompt.md'), '我自己的写法')
    productionAdapter.english = { translate: async () => { calls++; return { text: 'Custom wording for this user.' } } }
    const r = await buildInterpreterProtocol({ home, strategy: { tier: 'standard' }, toolsEnabled: true, englishMode: true })
    assert.equal(calls, 1)
    assert.ok(r.text.startsWith('Custom wording for this user.') && r.noToolsText.startsWith('Custom wording for this user.'))
    assert.ok(!r.text.includes(OPTIMIZER_CORE.en))
    assert.equal(r.text.split(OPTIMIZER_FORMAT.en).length, 2)
    assert.equal(r.text.length, r.chars)
  } finally { productionAdapter.english = original; rmSync(home, { recursive: true, force: true }) }
})
test('compact state reload preserves full advice and new inputs do not inherit it', () => {
  const home = mkdtempSync(join(tmpdir(), 'optimizer-reload-'))
  try {
    const c = createCapability({ home, namespace: 'test' })
    const token = c.beginInput('s1', 'm1', '原始任务')
    const p = parse(value({ add: ['重要的完整建议。'.repeat(100)], ask: ['这个偏好需要确认？'] }))
    assert.equal(c.settle('s1', token, p).ok, true)
    const restored = createCapability({ home, namespace: 'test' })
    assert.deepEqual(restored.status('s1').current.optimizer, p.optimizer)
    restored.beginInput('s1', 'm2', '继续')
    assert.equal(restored.status('s1').current.optimizer, null)
    assert.equal(restored.render('s1'), '')
    const fresh = createCapability(); fresh.beginInput('s2', 'm1', '单独的原话')
    assert.equal(fresh.observer('s2', null, { omitCurrent: true }), '')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
test('control API distinguishes a settings preview from the actual request record', async () => {
  const home = mkdtempSync(join(tmpdir(), 'optimizer-api-'))
  try {
    const snapshot = { protocolVersion: '3', inputId: 'm1', systemChars: 639, systemText: 'Actual recorded protocol', effort: 'max' }
    const handler = createControlHandler({ home, optimizerStatus: sid => sid === 's1' ? snapshot : null })
    async function call(session) {
      const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: '/po06/api/status?session=' + session, headers: { host: '127.0.0.1:19387' } })
      let status, result
      await handler(req, { writeHead: c => { status = c }, end: text => { result = JSON.parse(text) } })
      assert.equal(status, 200); return result
    }
    const result = await call('s1')
    assert.equal(result.prompt.effective.preview, true)
    assert.deepEqual(result.prompt.lastRequest, snapshot)
    assert.equal((await call('s2')).prompt.lastRequest, null)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

