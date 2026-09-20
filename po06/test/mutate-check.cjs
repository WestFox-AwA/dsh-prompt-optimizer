// 变异检验：确认测试**真的会失败**，而不是永远为真。
// 用法：node po06/test/mutate-check.cjs
//
// 动机：不会失败的测试等于没有测试。已抓到的两类假绿——
//   ① P2 首版把身份闸门写在形状校验器里，reducer 分支不可达而测试全绿；
//   ② 投影定义漏了 stateSchema，注册/提交/读取全正常，**只在恢复时才抛错**。
//
// 覆盖范围的**明确排除**：`lib/verifier-html.js`（真机 CDP 验证器）不纳入本变异检验。
// 理由：每个变异需要真机跑一遍浏览器（数秒级），本脚本会从秒级涨到分钟级，收益不成比例。
// 它的可证伪性由 `test/verifier-html.test.mjs` 的**四个已知期望分类的样本**承担：
// 好件→无 fail、画布 0×0→fail、未捕获异常→fail、纯色画面→unknown（不得 fail）。
//
// 注意：本脚本**必须用 node 读写文件**。Windows PowerShell 5.1 的
//   · `Set-Content -Encoding utf8` 会写入 BOM，Node 的 ESM 加载器会因此报语法错误；
//   · `Get-Content -Raw` 会把无 BOM 的 UTF-8（含中文）按 ANSI 解读，写回即毁文件。
//   实测中这两点各毁过一次文件，故此处一律走 fs。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')

/** 每个变异：目标文件 + 原文片段 + 替换片段 + 必须变红的用例名片段 */
const MUTANTS = [
  {
    name: 'reducer: identity-gate-forced-true',
    file: 'lib/reducer.js',
    testFile: 'test/reducer.test.mjs',
    from: "const hasHuman = op.item.sourceRefs.some((r) => r.kind === 'human')",
    to: 'const hasHuman = true /*MUTANT*/',
    expectFailIncludes: ['身份闸门'],
  },
  {
    name: 'reducer: cas-disabled',
    file: 'lib/reducer.js',
    testFile: 'test/reducer.test.mjs',
    from: 'if (patch.baseRevision !== state.revision) {',
    to: 'if (false) {',
    expectFailIncludes: ['CAS'],
  },
  {
    name: 'reducer: input-gate-disabled',
    file: 'lib/reducer.js',
    testFile: 'test/reducer.test.mjs',
    from: "if (typeof patch.baseInputRevision === 'number' && patch.baseInputRevision < state.lastInputRevision) {",
    to: 'if (false) {',
    expectFailIncludes: ['用户改口'],
  },
  {
    name: 'projection: stateSchema-removed',
    file: 'lib/projection.js',
    testFile: 'test/projection.test.mjs',
    from: '    stateSchema,\n',
    to: '',
    expectFailIncludes: ['stateSchema'],
  },
  {
    name: 'projection: apply-shortcircuit-removed',
    file: 'lib/projection.js',
    testFile: 'test/projection.test.mjs',
    from: "if (!event || typeof event.type !== 'string' || event.type.indexOf(EVENT_PREFIX) !== 0) {",
    to: 'if (false) {',
    expectFailIncludes: ['短路', 'apply'],
  },
  {
    name: 'compiler: required-section-droppable',
    file: 'lib/compiler.js',
    testFile: 'test/compiler.test.mjs',
    from: "export const DROP_ORDER = ['proposals', 'options', 'facts', 'quality']",
    to: "export const DROP_ORDER = ['requirements', 'proposals', 'options', 'facts', 'quality']",
    expectFailIncludes: ['必保节'],
  },
  {
    name: 'compiler: audit-human-source-check-removed',
    file: 'lib/compiler.js',
    testFile: 'test/compiler.test.mjs',
    from: 'if (!hasHuman) problems.push(`item ${id} (${item.kind}) rendered as a requirement without human source`)',
    to: 'if (false) problems.push("noop")',
    expectFailIncludes: ['审计'],
  },
  {
    name: 'compiler: empty-section-emitted',
    file: 'lib/compiler.js',
    testFile: 'test/compiler.test.mjs',
    from: 'if (!items || items.length === 0) continue',
    to: 'if (!items) continue',
    expectFailIncludes: ['没有某类条目时', '无有效条目'],
  },
  {
    name: 'interpreter: provenance-verbatim-check-removed',
    file: 'lib/interpreter.js',
    testFile: 'test/interpreter.test.mjs',
    from: 'if (!text.includes(quote)) {',
    to: 'if (false) {',
    expectFailIncludes: ['改写过的引文', '引文不可验证'],
  },
  {
    name: 'interpreter: kind-allowlist-removed',
    file: 'lib/interpreter.js',
    testFile: 'test/interpreter.test.mjs',
    from: 'if (!INTERPRETER_KINDS.includes(it.kind)) {',
    to: 'if (false) {',
    expectFailIncludes: ['不得创建 user_decision'],
  },
  {
    name: 'interpreter: op-allowlist-removed',
    file: 'lib/interpreter.js',
    testFile: 'test/interpreter.test.mjs',
    from: 'if (!ALLOWED_OPS.includes(rawOp.op)) {',
    to: 'if (false) {',
    expectFailIncludes: ['不得使用未授权 op'],
  },
  {
    name: 'interpreter: max-items-removed',
    file: 'lib/interpreter.js',
    testFile: 'test/interpreter.test.mjs',
    from: 'if (itemCount > MAX_ITEMS) {',
    to: 'if (false) {',
    expectFailIncludes: ['超量条目'],
  },
  {
    // 回归护栏：这正是 P3 流水线测试抓到的真实缺陷——
    // 用解释开始前的旧快照做 dryRun，CAS 变成"旧比旧"，对晚到补丁给出假 OK。
    name: 'pipeline: dryRun-uses-stale-snapshot',
    file: 'lib/pipeline.js',
    testFile: 'test/pipeline.test.mjs',
    from: 'const dry = dryRun(parsed.patch, current, reduce)',
    to: 'const dry = dryRun(parsed.patch, base, reduce)',
    expectFailIncludes: ['并发提交'],
  },
  {
    name: 'pipeline: input-change-recheck-removed',
    file: 'lib/pipeline.js',
    testFile: 'test/pipeline.test.mjs',
    from: 'if (inputChanged) {',
    to: 'if (false) {',
    expectFailIncludes: ['用户改口'],
  },
  {
    name: 'clarifier: hasQuestion-always-false',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: '  return state.questions.some((q) => q.decisionId === decisionId || q.id === decisionId)',
    to: '  return false',
    expectFailIncludes: ['规划幂等', '已答过的'],
  },
  {
    name: 'clarifier: batch-budget-removed',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: '    if (i < maxQuestions) {',
    to: '    if (true) {',
    expectFailIncludes: ['默认最多 2', 'maxQuestions 可收紧'],
  },
  {
    name: 'clarifier: lookupable-fact-routed-to-ask',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: "    if (cls === 'lookupable_fact') { lookup.push(it.id); continue }",
    to: '    if (false) { lookup.push(it.id); continue }',
    expectFailIncludes: ['可查事实不进提问'],
  },
  {
    name: 'clarifier: timeout-treated-as-consent',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: "  return { op: null, reason: 'timeout-is-not-consent' }",
    to: "  return { op: { op: 'answer_question', id: 'x', status: 'delegated' }, reason: 'timeout-is-not-consent' }",
    expectFailIncludes: ['超时不做任何状态转移'],
  },
  {
    name: 'clarifier: answered-source-not-required',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: "    if (typeof extra.answerSource !== 'string' || !extra.answerSource) {",
    to: '    if (false) {',
    expectFailIncludes: ['answered 必须带 answerSource'],
  },
  {
    name: 'clarifier: planning-idempotency-removed',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: '    if (hasQuestion(state, it.id)) continue',
    to: '    if (false) continue',
    expectFailIncludes: ['规划幂等', '已答过的'],
  },
  {
    name: 'clarifier: unclassified-counting-removed',
    file: 'lib/clarifier.js',
    testFile: 'test/clarifier.test.mjs',
    from: '    if (!UNKNOWN_CLASSES.includes(it.unknownClass)) unclassified += 1',
    to: '    if (false) unclassified += 1',
    expectFailIncludes: ['可见性'],
  },
  {
    name: 'longtask: turn-retirement-removed',
    file: 'lib/reducer.js',
    testFile: 'test/longtask.test.mjs',
    from: "          if (it.scope === 'turn' && it.status === 'active' && it.turnId !== next.turnId) {",
    to: '          if (false) {',
    expectFailIncludes: ['推进轮次后', '退役后的本轮指令'],
  },
  {
    name: 'longtask: scope-always-task',
    file: 'lib/reducer.js',
    testFile: 'test/longtask.test.mjs',
    from: "          scope: op.item.scope === 'turn' ? 'turn' : 'task',",
    to: "          scope: 'task',",
    expectFailIncludes: ['turn 条目记录所属轮次', '本轮要求与明确要求分节渲染'],
  },
  {
    name: 'longtask: requirements-filter-removed',
    file: 'lib/compiler.js',
    testFile: 'test/longtask.test.mjs',
    from: "label: '明确要求', required: true, where: (it) => it.scope !== 'turn' },",
    to: "label: '明确要求', required: true },",
    expectFailIncludes: ['本轮要求与明确要求分节渲染'],
  },
  {
    name: 'longtask: turn-scope-kind-guard-removed',
    file: 'lib/schema.js',
    testFile: 'test/longtask.test.mjs',
    from: "  if (item.scope === 'turn' && !HUMAN_ONLY_KINDS.includes(item.kind)) {",
    to: '  if (false) {',
    expectFailIncludes: ['turn 作用域只对用户指令合法'],
  },
  {
    name: 'newround: advance-turn-not-called',
    file: 'lib/pipeline.js',
    testFile: 'test/pipeline.test.mjs',
    from: "    ops: [{ op: 'advance_turn', turnId: 'turn:' + String(input.messageId) }],",
    to: "    ops: [{ op: 'set_phase', phase: 'working' }],",
    expectFailIncludes: ['新一轮'],
  },
  {
    name: 'newround: turn-idempotency-removed',
    file: 'lib/reducer.js',
    testFile: 'test/pipeline.test.mjs',
    from: "          if (it.scope === 'turn' && it.status === 'active' && it.turnId !== next.turnId) {",
    to: "          if (it.scope === 'turn' && it.status === 'active') {",
    expectFailIncludes: ['新一轮幂等', '新一轮'],
  },
  {
    name: 'carryover: drop-statement-not-rendered',
    file: 'lib/compiler.js',
    testFile: 'test/carryover.test.mjs',
    from: '  const tail = (dropped && dropped.length > 0)',
    to: "  const tail = (false && dropped && dropped.length > 0)",
    expectFailIncludes: ['丢弃发生时'],
  },
  {
    name: 'carryover: over-budget-note-removed',
    file: 'lib/compiler.js',
    testFile: 'test/carryover.test.mjs',
    from: "  const overNote = (typeof overBy === 'number' && overBy > 0)",
    to: '  const overNote = (false)',
    expectFailIncludes: ['装不下时显式降级'],
  },
  {
    name: 'carryover: whole-value-adoption-broken',
    file: 'lib/projection.js',
    testFile: 'test/carryover.test.mjs',
    from: '      return data',
    to: '      return state',
    expectFailIncludes: ['压缩安全', 'fork 继承', 'stateSchema 往返'],
  },
  {
    name: 'feedback: infra-error-counted-as-actionable',
    file: 'lib/verifier.js',
    testFile: 'test/feedback.test.mjs',
    from: '  return record.checks.filter((c) => c.result === ACTIONABLE_RESULT)',
    to: '  return record.checks.filter((c) => c.result !== RESULT.PASS)',
    expectFailIncludes: ['只有 fail 进入可返工集合', '基础设施故障'],
  },
  {
    name: 'feedback: evidence-not-required-for-fail',
    file: 'lib/verifier.js',
    testFile: 'test/feedback.test.mjs',
    from: "  if ((check.result === RESULT.PASS || check.result === RESULT.FAIL)",
    to: '  if (false',
    expectFailIncludes: ['pass/fail 必须有 evidenceRefs'],
  },
  {
    name: 'feedback: staleness-check-disabled',
    file: 'lib/verifier.js',
    testFile: 'test/feedback.test.mjs',
    from: '  return record.artifact.sha256 !== currentSha256',
    to: '  return false',
    expectFailIncludes: ['门②', 'isStale'],
  },
  {
    name: 'feedback: dedupe-disabled',
    file: 'lib/feedback.js',
    testFile: 'test/feedback.test.mjs',
    from: '  const fresh = failures.filter((f) => !ledger.dispatchedKeys.includes(dedupeKey(record, f)))',
    to: '  const fresh = failures',
    expectFailIncludes: ['门⑥'],
  },
  {
    name: 'gate: default-level-not-conservative',
    file: 'lib/gate.js',
    testFile: 'test/gate.test.mjs',
    from: '  if (opts.autoReworkEnabled !== true) return LEVEL.RECORD',
    to: '  return LEVEL.QUEUE',
    expectFailIncludes: ['投递等级', '默认设置', '未开启自动返工'],
  },
  {
    name: 'gate: record-level-still-delivers',
    file: 'lib/gate.js',
    testFile: 'test/gate.test.mjs',
    from: '  if (out.level === LEVEL.RECORD) {',
    to: '  if (false) {',
    expectFailIncludes: ['默认设置'],
  },
  {
    name: 'gate: failed-delivery-consumes-budget',
    file: 'lib/gate.js',
    testFile: 'test/gate.test.mjs',
    from: '  if (res && res.ok) {',
    to: '  if (true) {',
    expectFailIncludes: ['投递失败'],
  },
  {
    name: 'gate: pre-check-stop-removed',
    file: 'lib/gate.js',
    testFile: 'test/gate.test.mjs',
    from: '  const preStop = shouldStop(ledger)',
    to: '  const preStop = null',
    expectFailIncludes: ['台账停止后'],
  },
  {
    name: 'migration: legacy-state-treated-as-verified',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: "      disposition: 'legacy-unverified',",
    to: "      disposition: 'imported',",
    expectFailIncludes: ['legacy-unverified'],
  },
  {
    name: 'migration: choices-not-required',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: '  if (missing.length > 0) {',
    to: '  if (false) {',
    expectFailIncludes: ['缺少用户选择时抛错'],
  },
  {
    name: 'migration: rollback-returns-backup-by-reference',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: '  return { ok: true, restored: JSON.parse(JSON.stringify(backup)) }',
    to: '  return { ok: true, restored: backup }',
    expectFailIncludes: ['回滚'],
  },
  {
    name: 'migration: tier-claims-full-equivalence',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: "    reversible: 'partial',\n  },\n  advanced: {",
    to: "    reversible: true,\n  },\n  advanced: {",
    expectFailIncludes: ['每个档位映射'],
  },
  {
    name: 'rollout: invalid-config-defaults-to-all',
    file: 'lib/rollout.js',
    testFile: 'test/rollout.test.mjs',
    from: "  const mode = MODES.includes(r.mode) ? r.mode : 'off'",
    to: "  const mode = MODES.includes(r.mode) ? r.mode : 'all'",
    expectFailIncludes: ['非法/缺失配置'],
  },
  {
    name: 'rollout: allowlist-uses-prefix-match',
    file: 'lib/rollout.js',
    testFile: 'test/rollout.test.mjs',
    from: '  return r.sessions.includes(sid)',
    to: '  return r.sessions.some((s) => sid.startsWith(s))',
    expectFailIncludes: ['精确匹配'],
  },
  {
    name: 'rollout: double-intercept-guard-removed',
    file: 'lib/rollout.js',
    testFile: 'test/rollout.test.mjs',
    from: '  if (oldPluginActive === true && newEnabled === true) {',
    to: '  if (false) {',
    expectFailIncludes: ['双重拦截'],
  },
  {
    name: 'rollout: settings-ignored',
    file: 'lib/rollout.js',
    testFile: 'test/rollout.test.mjs',
    from: "  if (settings && settings.enabled !== true) {",
    to: '  if (false) {',
    expectFailIncludes: ['decideEnabled'],
  },
  {
    name: 'hostmigrate: dry-run-no-longer-default',
    file: 'lib/host-migrate.js',
    testFile: 'test/host-migrate.test.mjs',
    from: '  const dryRun = opts.dryRun !== false',
    to: '  const dryRun = opts.dryRun === true',
    expectFailIncludes: ['默认 dry-run'],
  },
  {
    name: 'hostmigrate: needs-choices-does-not-abort',
    file: 'lib/host-migrate.js',
    testFile: 'test/host-migrate.test.mjs',
    from: "    out.error = 'needs-choices:' + String((e && e.message) || e)\n    return out",
    to: "    out.error = 'needs-choices:' + String((e && e.message) || e)\n    out.ok = true",
    expectFailIncludes: ['缺选择'],
  },
  {
    name: 'hostmigrate: module-dir-detection-removed',
    file: 'lib/host-migrate.js',
    testFile: 'test/host-migrate.test.mjs',
    from: '  if (existsSync(modDir)) { active = true; evidence.push(\'模块目录存在：\' + modDir) }',
    to: '  if (false) { active = true }',
    expectFailIncludes: ['模块目录存在'],
  },
  {
    name: 'hostmigrate: bundle-detection-removed',
    file: 'lib/host-migrate.js',
    testFile: 'test/host-migrate.test.mjs',
    from: '      if (Array.isArray(bundles) && bundles.includes(OLD_PACKAGE)) {',
    to: '      if (false) {',
    expectFailIncludes: ['bundle 列表含旧包'],
  },
  {
    name: 'detectold: unscoped-probe-claims-active',
    file: 'lib/detect-old.js',
    testFile: 'test/detect-old.test.mjs',
    from: "    return { active: false, confidence: 'unknown', evidence: [], reason: 'no-agent-scope' }",
    to: "    return { active: true, confidence: 'runtime', evidence: ['guessed'], reason: null }",
    expectFailIncludes: ['没有 agent 作用域'],
  },
  {
    name: 'detectold: merge-ignores-static-hit',
    file: 'lib/detect-old.js',
    testFile: 'test/detect-old.test.mjs',
    from: '  if (staticResult && staticResult.active) { active = true; evidence.push(...(staticResult.evidence || [])) }',
    to: '  if (false) { active = true }',
    expectFailIncludes: ['静态命中'],
  },
  {
    name: 'detectold: own-context-misdetected',
    file: 'lib/detect-old.js',
    testFile: 'test/detect-old.test.mjs',
    from: "  const hit = contexts.find((c) => c && c.name === name)",
    to: "  const hit = contexts.find((c) => c && typeof c.name === 'string' && c.name.indexOf('prompt-optimizer') === 0)",
    expectFailIncludes: ['不会被误认成旧插件'],
  },
  // ── P8 装配期启用闸门（assembly-gate.js）────────────────────────────
  // 这是**安全关键**的一段：它决定"拦截到底生不生效"。
  // 五个变异各自对应一种"守卫看起来在、其实不在"的失效形态。
  {
    name: 'assemblygate: pending-treated-as-enabled',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: "  status: 'pending', enabled: false, code: 'decision-pending',",
    to: "  status: 'pending', enabled: true, code: 'decision-pending',",
    expectFailIncludes: ['未判定', '空 id'],
  },
  {
    name: 'assemblygate: decision-error-defaults-to-enabled',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: "          status: 'done', enabled: false, code: 'decision-error',",
    to: "          status: 'done', enabled: true, code: 'decision-error',",
    expectFailIncludes: ['判定抛错'],
  },
  {
    name: 'assemblygate: legacy-config-accepted-as-ours',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: "  const ours = typeof marker === 'string' || typeof marker === 'number'",
    to: '  const ours = true /*MUTANT*/',
    expectFailIncludes: ['旧插件写的配置'],
  },
  {
    name: 'assemblygate: unknown-confidence-read-as-not-installed',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: "  return signal.confidence === 'runtime' ? false : null",
    to: '  return false /*MUTANT*/',
    expectFailIncludes: ['三态'],
  },
  {
    name: 'assemblygate: no-agent-scope-guard-removed',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: '  if (oldPluginActive === null || oldPluginActive === undefined) {',
    to: '  if (false) {',
    expectFailIncludes: ['拿不到作用域'],
  },
  // ── P7 留出评估：封存校验与预算闸门（eval-plan.js）──────────────────
  // 这段是**防"未经授权就花钱"**的闸门，失效形态都是"闸门看起来在、其实放行"。
  {
    name: 'evalplan: seal-mismatch-accepted',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: "  const ok = String(actualSha256 || '').toLowerCase() === expected.sha256.toLowerCase()",
    to: '  const ok = true /*MUTANT*/',
    expectFailIncludes: ['hash 不符'],
  },
  {
    name: 'evalplan: budget-absent-still-runs',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (budget === null || budget === undefined) {',
    to: '  if (false) {',
    expectFailIncludes: ['未授权预算'],
  },
  {
    name: 'evalplan: budget-below-upper-accepted',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (b < estimate.upper) {',
    to: '  if (false) {',
    expectFailIncludes: ['预算低于上界'],
  },
  {
    name: 'evalplan: min-runs-guard-removed',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (!(runs >= minRuns)) {',
    to: '  if (false) {',
    expectFailIncludes: ['runs < 3'],
  },
  {
    name: 'evalplan: small-task-discount-ignored',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '    const armExpected = (unit * nLarge + smallUnit * nSmall) * runs',
    to: '    const armExpected = unit * tasks.length * runs /*MUTANT*/',
    expectFailIncludes: ['上界'],
  },
  // 成本模型里"**测量**优先于**假设**"是这一版的实质改动，必须被守住：
  // 失效形态有两种——悄悄退回假设，或者悄悄把假设冒充成测量。
  {
    name: 'evalplan: measured-anchor-ignored',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '    const smallUnit = smallUnitMeasured !== null ? smallUnitMeasured : unit * smallFactor',
    to: '    const smallUnit = unit * smallFactor /*MUTANT*/',
    expectFailIncludes: ['小题单价用实测锚点'],
  },
  {
    name: 'evalplan: assumption-labelled-as-measured',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: "      smallUnitBasis: smallUnitMeasured !== null ? 'measured(EV-0063)' : 'assumed(smallFactor)',",
    to: "      smallUnitBasis: 'measured(EV-0063)', /*MUTANT*/",
    expectFailIncludes: ['无实测锚点 ⇒ 退回假设折扣'],
  },
  // 解释层的"每题一次"是最容易乘错的一维：乘上 runs 会让预算凭空翻 n 倍。
  {
    name: 'evalplan: interpreter-charged-per-run',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  const interpreterTotal = interp === null ? null : interp * tasks.length',
    to: '  const interpreterTotal = interp === null ? null : interp * tasks.length * runs /*MUTANT*/',
    expectFailIncludes: ['不随臂数与轮数翻倍'],
  },
  // 漏计解释层 = "跑一半没钱了"，正是预算闸门要防的那件事。
  {
    name: 'evalplan: interpreter-cost-dropped-from-total',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  const expectedWithInterpreter = interpreterTotal === null ? expected : expected + interpreterTotal',
    to: '  const expectedWithInterpreter = expected /*MUTANT*/',
    expectFailIncludes: ['计划上写的钱'],
  },
  // 计划文本的**成本依据**必须由数字推出来。失效形态 = 文案改回硬写，
  // 于是模型换了、锚点换了，计划还在宣称一个不对的来源。
  {
    name: 'evalplan: cost-basis-note-hardcoded',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: "  if (bases.has('measured(EV-0063)')) {",
    to: '  if (false) { /*MUTANT*/',
    expectFailIncludes: ['成本依据跟着数字走'],
  },
  // 解释层单价未知时必须**明说它没算进去**；否则用户以为表上就是全部开销。
  {
    name: 'evalplan: unknown-interpreter-shown-as-measured',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: "  if (it.basis === 'measured(EV-0063)') {",
    to: '  if (true) { /*MUTANT*/',
    expectFailIncludes: ['成本依据跟着数字走'],
  },
  // 分期表与总额表若各用各的依据，同一份计划里会出现两个对不上的数——
  // 这比算错更糟，因为它看起来是对的。
  {
    name: 'evalplan: smallpair-not-forwarded-to-stages',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '    const e = estimateCost({ tasks: sub, arms, runs, measured, smallFactor, largeIds, smallPair })',
    to: '    const e = estimateCost({ tasks: sub, arms, runs, measured, smallFactor, largeIds }) /*MUTANT*/',
    expectFailIncludes: ['必须透传到 estimateStages'],
  },
  // ── 留出集真题 × 澄清/编译（holdout-clarify.test.mjs）────────────────
  // 这些变异专门打破**留出集自己写下的判据**，确保那个测试文件是"承载结论的"，
  // 而不是一份永远不会红的装饰。
  {
    name: 'holdout: lookupable-fact-gets-asked',
    file: 'lib/clarifier.js',
    testFile: 'test/holdout-clarify.test.mjs',
    from: "    if (cls === 'lookupable_fact') { lookup.push(it.id); continue }",
    to: "    if (cls === 'lookupable_fact') { /*MUTANT: 去掉 continue，让它掉进 askable*/ }",
    expectFailIncludes: ['H-11 可查事实'],
  },
  {
    name: 'holdout: unclassified-count-hidden',
    file: 'lib/clarifier.js',
    testFile: 'test/holdout-clarify.test.mjs',
    from: '    if (!UNKNOWN_CLASSES.includes(it.unknownClass)) unclassified += 1',
    to: '    if (false) unclassified += 1',
    expectFailIncludes: ['H-11 反向'],
  },
  {
    name: 'holdout: quality-allowed-into-requirements',
    file: 'lib/compiler.js',
    testFile: 'test/holdout-clarify.test.mjs',
    from: "  { key: 'requirements', kinds: ['user_requirement', 'user_decision'], label: '明确要求', required: true, where: (it) => it.scope !== 'turn' },",
    to: "  { key: 'requirements', kinds: ['user_requirement', 'user_decision', 'quality_interpretation'], label: '明确要求', required: true, where: (it) => it.scope !== 'turn' },",
    expectFailIncludes: ['质量解释不得出现在'],
  },
  // ── 留出集 S3 真题 × 长任务/环境/取消（holdout-longtask.test.mjs）────
  {
    name: 'holdout3: turn-retirement-disabled',
    file: 'lib/reducer.js',
    testFile: 'test/holdout-longtask.test.mjs',
    from: "          if (it.scope === 'turn' && it.status === 'active' && it.turnId !== next.turnId) {",
    to: '          if (false) { /*MUTANT: 上一轮不再退役*/',
    expectFailIncludes: ['H-13 对照'],
  },
  {
    name: 'holdout3: infra-counted-as-actionable',
    file: 'lib/verifier.js',
    testFile: 'test/holdout-longtask.test.mjs',
    from: '  return record.checks.filter((c) => c.result === ACTIONABLE_RESULT)',
    to: '  return record.checks.filter((c) => c.result === ACTIONABLE_RESULT || c.result === RESULT.INFRA_ERROR) /*MUTANT*/',
    expectFailIncludes: ['H-16'],
  },
  {
    name: 'holdout3: cancel-no-longer-blocks-rework',
    file: 'lib/feedback.js',
    testFile: 'test/holdout-longtask.test.mjs',
    from: "  if (ledger.stoppedReason) reasons.push('ledger-stopped:' + ledger.stoppedReason)",
    to: '  if (false) reasons.push(\'ledger-stopped\')',
    expectFailIncludes: ['H-18'],
  },
  // ── 启用判定的保质期（assembly-gate.js）──────────────────────────────
  // 这三个变异各自恢复一种"判一次就永久信"的失效形态。
  {
    name: 'gatettl: expiry-disabled',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: '  const isStale = (e) => Boolean(e) && e.status === \'done\' && (ttlMs <= 0 || (now() - (e.at || 0)) >= ttlMs)',
    to: '  const isStale = () => false /*MUTANT: 判定永不过期*/',
    expectFailIncludes: ['过期后'],
  },
  {
    name: 'gatettl: stale-not-redispatched',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: '    return resolve(sid)                                       // 没判过 / 已过期 → 重判',
    to: '    return cur || resolve(sid) /*MUTANT: 过期也不重判*/',
    expectFailIncludes: ['过期后'],
  },
  {
    name: 'gatettl: invalidate-noop',
    file: 'lib/assembly-gate.js',
    testFile: 'test/assembly-gate.test.mjs',
    from: '      if (sid) entries.delete(sid)',
    to: '      if (false) entries.delete(sid) /*MUTANT*/',
    expectFailIncludes: ['invalidate() 立刻撤销'],
  },
  // ── ADR-0036：迁移不得删除自己不认识的旧键 ──────────────────────────
  {
    name: 'migration: unknown-old-keys-dropped',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: '  for (const k of Object.keys(oldState || {})) {',
    to: '  for (const k of []) { /*MUTANT: 不再保留计划外的旧键*/',
    expectFailIncludes: ['ADR-0036'],
  },
  {
    name: 'migration: preserved-list-hidden',
    file: 'lib/migration.js',
    testFile: 'test/migration.test.mjs',
    from: '  plan.preservedLegacyKeys = preservedVerbatimKeys(plan, oldState)',
    to: '  plan.preservedLegacyKeys = [] /*MUTANT: 报告里不再显示保留清单*/',
    expectFailIncludes: ['ADR-0036'],
  },
  // ── 共存冲突：两个版本共用配置文件（coexist-config.test.mjs）──────────
  {
    name: 'coexist: legacy-key-list-gains-0.6-marker',
    file: 'lib/migration.js',
    testFile: 'test/coexist-config.test.mjs',
    from: "  'tier', 'permission', 'model', 'reasoningEffort', 'readTools', 'delivery', 'strategy',",
    to: "  'tier', 'permission', 'model', 'reasoningEffort', 'readTools', 'delivery', 'strategy', 'settingsVersion',",
    expectFailIncludes: ['0.6 的启用标记'],
  },
  {
    name: 'coexist: legacy-writer-modelled-as-preserving',
    file: 'lib/migration.js',
    testFile: 'test/coexist-config.test.mjs',
    from: '  for (const k of LEGACY_STATE_KEYS) {',
    to: '  for (const k of Object.keys(state || {})) { /*MUTANT: 假装旧版会保留所有键*/',
    expectFailIncludes: ['走一遍真实序列'],
  },
  // ── 逐单元花费闸门（eval-plan.js）────────────────────────────────────
  // 这是**唯一**能防超支的地方，失效形态都是"闸门看起来在、其实放行"。
  {
    name: 'evalplan: no-budget-allows-run',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (budget === null || budget === undefined) {',
    to: '  if (false) {',
    expectFailIncludes: ['未授权预算'],
  },
  {
    name: 'evalplan: exhausted-not-stopped',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (remaining <= 0) return { stop: true, reason: \'budget-exhausted\', remaining: 0 }',
    to: '  if (false) return { stop: true, reason: \'budget-exhausted\', remaining: 0 }',
    expectFailIncludes: ['余额用尽'],
  },
  {
    name: 'evalplan: next-unit-overshoot-allowed',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '  if (nextUnitEstimate !== null && Number(nextUnitEstimate) > remaining) {',
    to: '  if (false) {',
    expectFailIncludes: ['下一个单元就超预算'],
  },
  {
    name: 'evalplan: failed-units-hidden-from-spend',
    file: 'lib/eval-plan.js',
    testFile: 'test/eval-plan.test.mjs',
    from: '    if (r.ok !== true) { failed += 1; continue }',
    to: '    if (false) { failed += 1; continue }',
    expectFailIncludes: ['summarizeSpend'],
  },
  // ── 运行编排（eval-run.js）──────────────────────────────────────────
  // 编排里最容易错的是**循环/预算/续跑/失败处理**——这些都不需要真调模型就能验。
  {
    name: 'evalrun: no-budget-not-refused',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: '  if (pre.stop) {',
    to: '  if (false) {',
    expectFailIncludes: ['未授权预算'],
  },
  {
    name: 'evalrun: resume-ignores-completed',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: '    if (done.has(unit.unitId)) continue',
    to: '    if (false) continue /*MUTANT: 已完成也重跑（重复花钱）*/',
    expectFailIncludes: ['续跑跳过'],
  },
  {
    name: 'evalrun: failure-recorded-as-success',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: '        ok: false, error: String((e && e.message) || e),',
    to: '        ok: true, usage: { totalTokens: 0 }, error: String((e && e.message) || e),',
    expectFailIncludes: ['失败单元'],
  },
  {
    name: 'evalrun: single-failure-aborts-run',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: '    } catch (e) {',
    to: '    } catch (e) { throw e /*MUTANT: 一个单元失败就终止整轮*/',
    expectFailIncludes: ['单个单元抛错'],
  },
  // ── 会话日志读取器（read-session.mjs）──────────────────────────────
  // 守的是"**多帧只解第一帧**"这个静默陷阱：不报错、却丢掉 99.9% 的内容。
  {
    name: 'readsession: only-first-frame-decoded',
    file: 'scripts/read-session.mjs',
    testFile: 'test/read-session.test.mjs',
    from: '  for (let n = 0; n < offs.length; n++) {',
    to: '  for (let n = 0; n < 1; n++) { /*MUTANT: 只解第一帧*/',
    expectFailIncludes: ['多帧拼接'],
  },
  {
    name: 'readsession: usage-only-top-level',
    file: 'scripts/read-session.mjs',
    testFile: 'test/read-session.test.mjs',
    from: '      walk(v, path + \'.\' + k)',
    to: '      /*MUTANT: 不进嵌套*/',
    expectFailIncludes: ['嵌套'],
  },
  // ── 回答审计（answer-audit.js）──────────────────────────────────────
  // 守的是"**放大约束**"这条可机械抽取的判据（工具帮不上忙的那类判据之一）。
  {
    name: 'audit: overlap-check-disabled',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '    if (overlap === 0) out.push({ clause: c, markers, overlap: 0 })',
    to: '    out.push({ clause: c, markers, overlap }) /*MUTANT: 不再要求零交集*/',
    expectFailIncludes: ['用户自己说的禁止句'],
  },
  {
    name: 'audit: prohibitions-not-detected',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: "  for (const m of PROHIBITION_MARKERS) if (clause.includes(m)) hit.push(m)",
    to: '  /*MUTANT: 不认禁止词*/',
    expectFailIncludes: ['凭空多出来的禁止句'],
  },
  {
    name: 'audit: real-artifact-amplification-missed',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: "  for (const m of ABSOLUTE_MARKERS) if (clause.includes(m)) hit.push(m)",
    to: '  /*MUTANT: 不认绝对词*/',
    expectFailIncludes: ['真实 D-01'],
  },
  // ── 问句审计：按 H-12 判据（偏好该问、实现细节该自定）────────────────
  {
    name: 'audit: preference-markers-incomplete',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: "  '哪些', '哪部分', '哪几', '范围', '风格', '配色', '色调', '主题', '偏好',\n  '你希望', '你倾向', '要多', '程度', '深浅', '语义', '规范', '还是',",
    to: "  '风格', /*MUTANT: 偏好词表被削到只剩一个*/",
    expectFailIncludes: ['理想行为'],
  },
  {
    name: 'audit: impl-markers-incomplete',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: "  '库', '依赖', 'library', 'chalk', 'picocolors', 'colorama', 'rich', 'click',",
    to: "  '库', /*MUTANT: 实现细节词表被削*/",
    expectFailIncludes: ['真实 A 臂'],
  },
  {
    name: 'audit: questions-never-detected',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '  return QUESTION_RE.test(s)',
    to: '  return false /*MUTANT: 不认问句*/',
    expectFailIncludes: ['问句识别：无问号但有征询措辞'],
  },
  // EV-0106：守"半角 ? 必须收尾"。退回旧的"任意位置有 ? 就算问句"，
  // 三元运算符会被整段当成提问（真实发生过：7 行代码进了用户打分表）。
  {
    name: 'audit: question-mark-anywhere',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '  if (QUESTION_TAIL_RE.test(s)) return true',
    to: '  if (/\\?|？/.test(s)) return true /*MUTANT: 任意位置的 ? 都算问句*/',
    expectFailIncludes: ['三元/代码片段不算提问'],
  },
  // EV-0106 反向：一刀切"含 =;{} 就当代码丢掉"会**误删真问句**（实测丢 3 条，
  // 两个臂的问句数被少算）。这条变异体保证没人能再把那条护栏加回去。
  {
    name: 'audit: blanket-code-guard-drops-real-questions',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '  return QUESTION_RE.test(s)',
    to: '  if (/[=;{}]|=>/.test(s)) return false /*MUTANT: 含代码特征就丢*/\n  return QUESTION_RE.test(s)',
    expectFailIncludes: ['三元/代码片段不算提问'],
  },
  // ── "约束守住"的仪器（EV-0108）：此前在真实违规答案上**六种只抓到一种**，
  // 漏掉时 verdict 是 `holds-but-unmentioned`——读起来像"没问题"。这两条守住新补的两种形态。
  {
    name: 'audit: code-dep-forms-ignored',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '  out.push(...findCodeDependencyForms(answerText))',
    to: '  /*MUTANT: 不认安装命令与第三方 import*/',
    expectFailIncludes: ['六种真实违规形态'],
  },
  {
    name: 'audit: stdlib-no-longer-exempt',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: "  if (!n || n.startsWith('.') || n.startsWith('/')) return true",
    to: '  /*MUTANT: 相对路径/本地模块不再豁免 ⇒ 合规答案被误报*/',
    expectFailIncludes: ['合规答案不得被误报'],
  },
  // EV-0111：旧路径上的 0.5.x 设置**绝不能**启用 0.6。
  // 变异体把"必须是我们的配置"这道检查去掉——那正是"想试试 0.6 却先弄坏 0.5.x"的成因。
  {
    name: 'coexist: legacy-config-accepted-as-ours',
    file: 'lib/assembly-gate.js',
    testFile: 'test/coexist-config.test.mjs',
    from: '  if (legacy.ours) return legacy',
    to: '  return legacy /*MUTANT: 旧路径不再校验标记*/',
    expectFailIncludes: ['必须带 0.6 标记'],
  },
  // EV-0113：禁止句对象**必须能安全插值/强制转换**。
  // 去掉这个兜底，"忘了取 .clause"就会退化成 `[object Object]`——
  // 实测两次：判据恒"不适用"（钱白花），以及人读文档里印出 `- [object Object]`。
  {
    name: 'audit: prohibition-object-not-stringifiable',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '      toString() { return c },',
    to: '      /*MUTANT: 去掉兜底 ⇒ 插值又变 [object Object]*/',
    expectFailIncludes: ['禁止句对象必须能安全插值'],
  },
  // ── 文档检查器自己（EV-0115）：它是发版门的一部分，此前**没有回归保护**，
  // 而本轮我已经亲手让它错了两次（16 处假警报；漏 import 导致索引为空）。
  {
    name: 'checkdocs: only-counts-under',
    file: 'scripts/check-docs.mjs',
    testFile: 'test/check-docs.test.mjs',
    from: '        if (n < expected) {',
    to: '        if (false) { /*MUTANT: 不再报"文档里的数比产物小"*/',
    expectFailIncludes: ['计数过期'],
  },
  {
    name: 'checkdocs: parenthetical-narrative-flagged',
    file: 'scripts/check-docs.mjs',
    testFile: 'test/check-docs.test.mjs',
    from: "        if (before === '（' || before === '(') continue",
    to: '        /*MUTANT: 不再排除括注型局部叙述（EV-0001（23 项）会被误报）*/',
    expectFailIncludes: ['括注型局部叙述不误报'],
  },
  {
    name: 'checkdocs: stage-list-hardcoded',
    file: 'scripts/check-docs.mjs',
    testFile: 'test/check-docs.test.mjs',
    from: '  const STAGE_KEYS = Object.keys(PLAN.stages)',
    to: "  const STAGE_KEYS = ['S1', 'S2', 'S3'] /*MUTANT: 写死清单 ⇒ 新分期静默漏检*/",
    expectFailIncludes: ['新追加的分期也要被检查'],
  },
  // ── 运行回顾（EV-0116）：它最关键的判读是**安全性质**——"它替我说了什么"。
  {
    name: 'recap: unsourced-items-not-detected',
    file: 'scripts/recap.mjs',
    testFile: 'test/recap.test.mjs',
    from: '      if (refs.length === 0) { noSource.push({ s: s.sessionId, it }); o += 1; continue }',
    to: '      if (false) { noSource.push({ s: s.sessionId, it }); o += 1; continue } /*MUTANT: 无出处条目被算成"机器补充"*/',
    expectFailIncludes: ['无出处条目'],
  },
  {
    name: 'recap: unsourced-only-a-note',
    file: 'scripts/recap.mjs',
    testFile: 'test/recap.test.mjs',
    from: "    warnings.push('有 ' + noSource.length + ' 条意图条目**没有出处**（契约要求每条都带 sourceRefs）')",
    to: '    /*MUTANT: 无出处只在正文里小声提一句，不影响退出码*/',
    expectFailIncludes: ['无出处条目'],
  },
  {
    name: 'recap: fork-records-counted-as-turns',
    file: 'scripts/recap.mjs',
    testFile: 'test/recap.test.mjs',
    from: "const turns = rs.filter((r) => r.trigger !== 'fork-inherit' && r.trigger !== 'state-unreadable')",
    to: 'const turns = rs /*MUTANT: 分叉/坏状态记录混进逐轮统计 ⇒ 均值被拉低*/',
    expectFailIncludes: ['分叉继承记录单独成节'],
  },
  // ── 花钱前预检（EV-0118）：它自己不准 = "闸门看起来在，其实没拦"。
  {
    name: 'preflight: inapplicable-criterion-not-flagged',
    file: 'scripts/preflight-e001.mjs',
    testFile: 'test/preflight-e001.test.mjs',
    from: "  problems.push('本期没有任何题适用「约束守住」——花钱也测不到它')",
    to: '  /*MUTANT: "这期测不到"不再阻断 ⇒ S1 那种情况会被放行*/',
    expectFailIncludes: ['S1 预检'],
  },
  {
    name: 'preflight: budget-refusal-not-reported',
    file: 'scripts/preflight-e001.mjs',
    testFile: 'test/preflight-e001.test.mjs',
    from: "if (BUDGET !== null && decision.mode === 'refuse') problems.push('预算低于上界 ⇒ 会被拒绝（这是刻意的：避免跑到一半没钱）')",
    to: '/*MUTANT: 预算不足不再阻断*/',
    expectFailIncludes: ['预算低于上界'],
  },
  {
    name: 'preflight: seal-negative-selfcheck-removed',
    file: 'scripts/preflight-e001.mjs',
    testFile: 'test/preflight-e001.test.mjs',
    // 把"拿篡改过的 hash 去校验"换成"拿正确 hash"⇒ 负向自检变成永远通过
    from: "const tamperCheck = checkSealHash('0'.repeat(64))",
    to: 'const tamperCheck = checkSealHash(sha) /*MUTANT: 负向自检消失*/',
    expectFailIncludes: ['S4 预检'],
  },
  // ── "装好了吗"自检（EV-0119）：这项目在"装"上栽过三次，而这三种失败**都不报错**。
  {
    name: 'checkinstall: bundles-layer-not-flagged',
    file: 'scripts/check-install.mjs',
    testFile: 'test/check-install.test.mjs',
    from: "  if (!hasLayer) problems.push('装配树里没有该包 ⇒ 装上也不会生效（EV-0066 同款）')",
    to: '  /*MUTANT: 不在 bundles 里也不拦 ⇒ "装了却永远不会被装配"会被放行*/',
    expectFailIncludes: ['不在 `dsh.profile.bundles` 里'],
  },
  {
    name: 'checkinstall: version-mismatch-not-flagged',
    file: 'scripts/check-install.mjs',
    testFile: 'test/check-install.test.mjs',
    from: "  if (EXPECT_VERSION && rv !== EXPECT_VERSION) problems.push('版本不符：装的 ' + rv + '，期望 ' + EXPECT_VERSION)",
    to: '  /*MUTANT: 版本不符不拦*/',
    expectFailIncludes: ['版本与期望不符'],
  },
  {
    name: 'checkinstall: missing-bundle-layer-not-flagged',
    file: 'scripts/check-install.mjs',
    testFile: 'test/check-install.test.mjs',
    from: "    if (!existsSync(join(installed, f))) problems.push('缺 ' + f + ' ⇒ 装了也不会被装配')",
    to: '    /*MUTANT: 缺 bundle 层不拦*/',
    expectFailIncludes: ['缺 cordis.patch.yml'],
  },
  // ── 跨会话隔离（EV-0120）：判据**两个方向都会错**，所以两个方向都要守。
  {
    name: 'recap: cross-session-refs-not-checked',
    file: 'scripts/recap.mjs',
    testFile: 'test/recap.test.mjs',
    from: '        if (rs && !allowed.has(rs)) crossRefs.push({ s: s.sessionId, it, ref: rs })',
    to: '        if (false) crossRefs.push({ s: s.sessionId, it, ref: rs }) /*MUTANT: 不查跨会话串味*/',
    expectFailIncludes: ['跨会话串味'],
  },
  {
    name: 'recap: ancestry-ignored-in-ref-check',
    file: 'scripts/recap.mjs',
    testFile: 'test/recap.test.mjs',
    // 去掉"祖先会话"这一支 ⇒ **合法继承被误判成泄漏**（这个项目反复吃过的"判据分不清两种情况"）
    from: '    const chain = new Set([String(sid)])',
    to: '    const chain = new Set([String(sid)]); return chain /*MUTANT: 不看继承链*/',
    expectFailIncludes: ['继承的条目指向'],
  },
  // EV-0121：profile 解析**不许靠写死的清单**——宿主发行 5 个模板，
  // 清单里少了 sdk/acp/sdk-minimal ⇒ `dsh sdk …` 会被解析成 web（查错对象、不报错）。
  {
    name: 'wire: profile-list-hardcoded-again',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: '    const hit = canCheck ? positions.find((p) => { try { return profileExists(p) } catch { return false } }) : positions[0]',
    to: "    const hit = ['web', 'headless', 'tui'].find((n) => positions.includes(n)) /*MUTANT: 退回写死清单*/",
    expectFailIncludes: ['宿主发行的 5 个模板'],
  },
  // ── 坏掉的状态文件（EV-0122）：不许静默从头开始、更不许把证据覆盖掉。
  {
    name: 'index: corrupt-state-silently-ignored',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: '      if (diag.present && !diag.ok) {',
    to: '      if (false) { /*MUTANT: 坏文件静默当"没有状态"，随后被覆盖*/',
    expectFailIncludes: ['状态文件读不出来'],
  },
  {
    name: 'store: malformed-reported-as-readable',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: "      return { present: true, ok: false, state: null, reason: 'malformed-json', path: p }",
    to: "      return { present: true, ok: true, state: null, reason: null, path: p } /*MUTANT: 坏 JSON 当成正常*/",
    expectFailIncludes: ['inspect 分得清'],
  },
  // ── 长期约束保持（H-15）：否定必须认出来 ────────────────────────────
  {
    name: 'audit: negation-ignored',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '    const negated = NEGATION_RE.test(before) || NEGATION_RE.test(m[0])',
    to: '    const negated = false /*MUTANT: 不认否定，"不引依赖"会被算成引依赖*/',
    expectFailIncludes: ['守住约束'],
  },
  {
    name: 'audit: dep-adjacency-too-strict',
    file: 'lib/answer-audit.js',
    testFile: 'test/answer-audit.test.mjs',
    from: '  + \'[^。；;\\\\n]{0,8}?\'',
    to: '  + \'[^。；;\\\\n]{0,0}?\' /*MUTANT: 要求动作与对象紧邻*/',
    expectFailIncludes: ['守住约束'],
  },
  // ── 生产接线（P8/A15）：EV-0078 的反向守卫 ──────────────────────────
  // 最要命的一条：投递本身也是一条 user/message。来源过滤一失效，
  // 包会触发解释、解释产出新包 —— **自激循环**，而且烧的是真钱。
  {
    name: 'wire: plugin-delivery-treated-as-user-input',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: "  return d.source.kind === 'user'",
    to: '  return true /*MUTANT: 不再区分来源*/',
    expectFailIncludes: ['只有 source.kind=user 才算用户输入'],
  },
  // 闸门是"要不要花钱"的唯一开关；失效形态是**放行**（fail-open）。
  // ⚠ 变异体必须**语法合法**：把 `if (x) return …` 换成 `if (false) {` 会留下未闭合的括号，
  // 套件直接 import 失败、输出不可解析 —— 于是它被记成"未捕获"，看起来像测试太弱，
  // 其实是变异本身无效（本轮真的踩过一次）。所以只改条件。
  {
    name: 'wire: gate-check-removed',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: '  if (gateEnabled !== true) return',
    to: '  if (false) return /*MUTANT*/',
    expectFailIncludes: ['每个跳过原因都有独立代码'],
  },
  // 空输入也去调模型 = 白花钱，且会产出无依据的包。
  {
    name: 'wire: empty-text-still-interpreted',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: '  if (!text) return',
    to: '  if (false) return /*MUTANT*/',
    expectFailIncludes: ['每个跳过原因都有独立代码'],
  },
  // 拿不到模型路由时**编造**一个 —— 正是"不造成虚假的"要禁止的事。
  {
    name: 'wire: fabricated-model-route',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: "  return { ok: false, reason: 'no-model-route' }",
    to: "  return { ok: true, provider: 'guessed', model: 'guessed', source: 'guessed' } /*MUTANT*/",
    expectFailIncludes: ['模型解析'],
  },
  // 半截配置（只有 provider 没有 model）不得被当成有效配置。
  {
    name: 'wire: half-config-accepted',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: "  if (c && typeof c.provider === 'string' && c.provider && typeof c.model === 'string' && c.model) {",
    to: '  if (c) { /*MUTANT*/',
    expectFailIncludes: ['模型解析'],
  },
  // 缺 messageId 不得用随机值兜底：它是幂等键（advance_turn 靠它天然幂等）。
  {
    name: 'wire: missing-message-id-fabricated',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: "  return typeof id === 'string' && id ? id : null",
    to: "  return typeof id === 'string' && id ? id : 'm-fabricated' /*MUTANT*/",
    expectFailIncludes: ['消息 id 是幂等键'],
  },
  // EV-0081 的核心纪律：生产路径**不得**往会话日志 append。
  // 旁路就藏在 `commitUserInput` 里（它曾自己调了一次 session.append）——
  // 把它改回去，反回归测试必须变红。
  {
    name: 'wire: session-log-append-restored',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: '    return this.land(session, next)',
    to: '    session.append(STATE_EVENT, next); return { ok: true, state: next } /*MUTANT*/',
    expectFailIncludes: ['EV-0081'],
  },
  // 状态不落盘 ⇒ 重启后什么都载不回来（A6 失效）。
  {
    name: 'wire: state-not-persisted',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: '    const r = this.stateStore ? this.stateStore.save(sid, state) : { ok: true }',
    to: '    const r = { ok: true } /*MUTANT*/',
    expectFailIncludes: ['EV-0081'],
  },
  // 首次访问不从存储载入 ⇒ 重启后状态丢失（A6 失效的另一种形态）。
  {
    name: 'wire: state-not-reloaded',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: '    let loaded = this.stateStore ? this.stateStore.load(sid) : null',
    to: '    const loaded = null /*MUTANT*/',
    expectFailIncludes: ['EV-0081'],
  },
  // 文件名不消毒 ⇒ 会话 id 可以带着 ../ 逃出存储目录。
  {
    name: 'store: session-file-not-sanitized',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: "  const cleaned = s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)",
    to: '  const cleaned = s /*MUTANT*/',
    expectFailIncludes: ['会话 id 落成文件名前必须消毒'],
  },
  // 存储读到的坏数据不得当真（形状校验失效 ⇒ 半份 JSON 会被当成状态用）。
  {
    name: 'store: shape-check-removed',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: "    if (typeof v.revision !== 'number' || !Array.isArray(v.items)) {\n      return { present: true, ok: false, state: null, reason: 'shape-mismatch', path: p }\n    }",
    to: '    /*MUTANT: 形状校验失效 ⇒ 半份 JSON 会被当成状态用*/',
    expectFailIncludes: ['存储读到坏数据必须拒绝'],
  },
  // 淘汰策略的三种失效形态：不淘汰（无限增长）、淘汰方向反了（删掉最新的）、
  // 上限校验失效（keep=0 ⇒ 把刚写的也删了，等于状态自毁）。
  {
    name: 'store: eviction-disabled',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '      for (const row of rows.slice(limit)) {',
    to: '      for (const row of []) { /*MUTANT: 从不淘汰*/',
    expectFailIncludes: ['存储有上限'],
  },
  {
    name: 'store: eviction-order-reversed',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '        .sort((a, b) => b.t - a.t)          // 新的在前',
    to: '        .sort((a, b) => a.t - b.t) /*MUTANT: 新的在后*/',
    expectFailIncludes: ['存储有上限'],
  },
  {
    name: 'store: keep-limit-guard-removed',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '  const limit = Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : DEFAULT_KEEP',
    to: '  const limit = keep /*MUTANT*/',
    expectFailIncludes: ['上限取非法值时退回默认'],
  },
  // 报告目录不再由 DSH_HOME 派生 ⇒ 单测会写进真实 home、隔离实例与日常实例混在一起（EV-0084）。
  // 注：变异体**故意不指向那个遗留的真实目录**——第一版就是那么写的，
  // 结果每跑一轮变异检验都会往真实证据目录里丢几份垃圾（变异体自己在制造污染）。
  // 断言查的是"派生形式"，所以换成任意别的写法一样会被抓到，且不产生副作用。
  {
    name: 'wire: evidence-dir-not-derived',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: "const EVIDENCE_DIR = process.env.DSH_PO06_EVIDENCE_DIR || join(DSH_HOME, 'po06-reports')",
    to: "const EVIDENCE_DIR = join(DSH_HOME, 'po06-reports-elsewhere') /*MUTANT*/",
    expectFailIncludes: ['报告目录跟着 DSH_HOME 走'],
  },
  // 投递链路最后一环（EV-0102）：抛错必须留痕，且同一错误要去重。
  // 失效形态 ①：又变回静默吞掉 —— 意图包消失而毫无痕迹（EV-0078 那一类）。
  {
    name: 'wire: context-error-swallowed-again',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: "                    appendWireLog({ sessionId: sid, ok: false, trigger: 'context-provider-threw', reason: msg })",
    to: '                    /*MUTANT: 静默吞掉*/',
    expectFailIncludes: ['EV-0102'],
  },
  // 失效形态 ②：去重失效 ⇒ 每一步一条，把台账淹掉（等于没有台账）。
  {
    name: 'wire: context-error-dedupe-removed',
    file: 'lib/index.js',
    testFile: 'test/wire.test.mjs',
    from: '                  if (this.contextErrors.get(sid) !== msg) {',
    to: '                  if (true) { /*MUTANT: 不去重*/',
    expectFailIncludes: ['EV-0102'],
  },
  // 分叉继承（EV-0091）：三种失效形态——**别名**（浅拷贝，子改父）、
  // 归属不改写（状态自称属于别人）、出处不留（无法区分"继承来的"与"从头开始"）。
  {
    name: 'store: fork-inherit-shallow-copy',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '  const child = JSON.parse(JSON.stringify(parentState))   // 深拷贝（纯结构化数据，JSON 足够）',
    to: '  const child = { ...parentState } /*MUTANT: 浅拷贝 ⇒ 嵌套结构共享*/',
    expectFailIncludes: ['分叉继承'],
  },
  {
    name: 'store: fork-inherit-keeps-parent-id',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '  child.sessionId = String(childSessionId)',
    to: '  /*MUTANT: 不改写归属*/',
    expectFailIncludes: ['分叉继承'],
  },
  {
    name: 'store: fork-inherit-no-provenance',
    file: 'lib/store.js',
    testFile: 'test/wire.test.mjs',
    from: '  child.inheritedFrom = String(parentSessionId)',
    to: '  /*MUTANT: 不留出处*/',
    expectFailIncludes: ['分叉继承'],
  },
  // 机制实验的**有效性**守卫：strip 必须真的删掉那一段（含段内条目）。
  // 若 transform 悄悄变成"什么都不做"，两次实验会给出相同结果，
  // 而结论会被读成"未决项不是原因"——那正是最危险的假阴性。
  {
    name: 'e001: strip-unknowns-is-noop',
    file: 'lib/eval-e001.js',
    testFile: 'test/eval-e001.test.mjs',
    from: '  const start = s.indexOf(\'【未决项\')',
    to: '  const start = -1 /*MUTANT: 永不生效*/',
    expectFailIncludes: ['去掉【未决项】整段'],
  },
  {
    name: 'e001: strip-unknowns-keeps-items',
    file: 'lib/eval-e001.js',
    testFile: 'test/eval-e001.test.mjs',
    from: '  const end = nextRel < 0 ? s.length : start + 1 + nextRel',
    to: '  const end = start + 1 /*MUTANT: 只删标题*/',
    expectFailIncludes: ['去掉【未决项】整段'],
  },
  // 注：这里**曾经**有一个 `wire: no-defer-in-event-handler` 变异（去掉 defer 应触发重入报错）。
  // 它在 EV-0081 之后**失效并被移除**：那条重入错误
  // （`session append cannot reenter while another append is being published`）
  // 只在"在事件派发窗口里往会话日志 append"时才发生，而状态持久化已改到插件自己的存储，
  // 生产路径**不再 append** ⇒ 去掉 defer 不再产生任何可观测差异。
  // 保留 defer 属**卫生**（不在宿主的发布窗口里跑重活与模型调用），由静态检查守着。
  // **变异在这里存活是正确信号，不是测试太弱**；硬要"抓回来"只能削弱测试或写一条与事实不符的断言。
  // profile 解析写死成 web = 在别的 profile 下"查错目录却照样给结论"（EV-0081 前半段）。
  {
    name: 'wire: profile-hardcoded-to-web',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: '  return { name: requested, source, requested }',
    to: "  return { name: 'web', source: 'hardcoded', requested } /*MUTANT*/",
    expectFailIncludes: ['profile 解析'],
  },
  // 退回逻辑失效：指定了不存在的 profile 也照用 ⇒ 探测读一个不存在的目录。
  {
    name: 'wire: profile-fallback-disabled',
    file: 'lib/wire.js',
    testFile: 'test/wire.test.mjs',
    from: '  if (typeof profileExists === \'function\' && !profileExists(requested)) {',
    to: '  if (false) { /*MUTANT*/',
    expectFailIncludes: ['profile 解析'],
  },
  // 注：生产订阅里那句 `if (!isRealUserInput(event)) return` **故意不加变异**——
  // 它与 `decideInterpret` 里的 `isUserInput` 检查是**双重保险**，删掉任一层都不会出事
  // （真正的失效形态是"来源判断本身错了"，那由上面的 `plugin-delivery-treated-as-user-input`
  // 覆盖：它把 `isRealUserInput` 整个换成 `return true`，两层同时失效，被成功捕获）。
  // 给冗余守卫单独立变异只会得到一个永远"存活"的假信号。
  // ── 多轮：意图包必须**取代**而不是累积（忠实于 0.6 的全值快照语义）────
  {
    name: 'evalrun: packets-accumulate',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: "    out.push(p)          // **只放最新的那一份**",
    to: "    for (let i = 0; i <= last; i++) if (packets[i]) out.push(packets[i]) /*MUTANT: 每轮都堆进历史*/",
    expectFailIncludes: ['只保留最新那一份'],
  },
  {
    name: 'evalrun: missing-packet-degrades-to-A',
    file: 'lib/eval-run.js',
    testFile: 'test/eval-run.test.mjs',
    from: "    if (typeof p !== 'string' || p.length === 0) {",
    to: "    if (false) { /*MUTANT: 缺包也照样往下走（静默退化成 A 臂）*/",
    expectFailIncludes: ['不得静默退化'],
  },
]

function runSuite(testRel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, testRel)], { encoding: 'utf8' })
  try {
    const j = JSON.parse(r.stdout)
    return { pass: j.pass, fail: j.fail, failures: (j.failures || []).map((f) => f.name) }
  } catch {
    return { parseError: true, stdout: String(r.stdout).slice(0, 160), stderr: String(r.stderr).split('\n').slice(0, 3).join(' | ') }
  }
}

const results = []
let allGood = true

// ── 可选：只跑名字含某子串的变异体（调一个变异体时省时间）────────────────
// ⚠ **筛选跑不是门槛证据**：只有不带参数的**全量**跑才作数。筛完为空 = 写错了名字，
// 必须报错退出——否则"0 个变异体全捕获"会伪装成绿色通过。
const ONLY = process.argv[2]
if (ONLY) {
  for (let i = MUTANTS.length - 1; i >= 0; i--) if (!MUTANTS[i].name.includes(ONLY)) MUTANTS.splice(i, 1)
  if (MUTANTS.length === 0) {
    console.log(JSON.stringify({ error: 'no-mutant-matched', only: ONLY }, null, 2))
    process.exit(2)
  }
  console.log(`[筛选跑] 只跑 ${MUTANTS.length} 个（名字含 "${ONLY}"）——**不是**门槛证据`)
}

// ── 启动自检：绝不在"上一次残留的变异体"上继续跑 ────────────────────────
// 真实事故（EV-0082）：把本脚本的输出管道给会**提前关闭管道**的消费者
// （PowerShell 的 `Select-Object -First N` 就是），进程会在
// "变异体已写入、`finally` 还没执行"的瞬间被杀掉，源文件就带着 `/*MUTANT*/`
// 留在磁盘上。此后**任何**测试跑的都是变异后的代码，而失败信息会指向无辜的地方
// ——本轮为此白排查了一轮（"存储不落盘"其实是文件里躺着一个变异体）。
// 所以：**开跑前先确认没有残留**，有残留就拒绝运行，并明确指出怎么恢复。
const leftover = []
for (const f of [...new Set(MUTANTS.map((m) => m.file))]) {
  try {
    if (fs.readFileSync(path.join(ROOT, f), 'utf8').includes('/*MUTANT')) leftover.push(f)
  } catch { /* 读不到就跳过，让它在下游报错 */ }
}
if (leftover.length > 0) {
  console.log(JSON.stringify({
    error: 'LEFT-OVER-MUTANT',
    files: leftover,
    hint: '上一次运行被杀掉了，源文件里仍留着变异体。先 `git checkout -- <file>` 恢复（并确认没有未提交的正当改动），再重跑。',
  }, null, 2))
  process.exit(3)
}

// 基线：所有涉及的测试文件都必须先全绿，否则变异无意义
const testFiles = [...new Set(MUTANTS.map((m) => m.testFile))]
const baseline = {}
for (const tf of testFiles) {
  baseline[tf] = runSuite(tf)
  if (baseline[tf].fail !== 0) {
    console.log(JSON.stringify({ error: 'baseline failing', testFile: tf, baseline: baseline[tf] }, null, 2))
    process.exit(1)
  }
}

const restored = new Map()
for (const m of MUTANTS) {
  const abs = path.join(ROOT, m.file)
  if (!restored.has(abs)) restored.set(abs, fs.readFileSync(abs, 'utf8'))
  const original = restored.get(abs)
  if (!original.includes(m.from)) {
    results.push({ name: m.name, status: 'ANCHOR-MISSING' })
    allGood = false
    continue
  }
  try {
    fs.writeFileSync(abs, original.replace(m.from, m.to), 'utf8')
    const r = runSuite(m.testFile)
    // ⚠ 套件输出不可解析 ⇒ **工具故障 / 变异体语法非法**，绝不能记成"变异存活"。
    // 这两种情况的处置完全相反：前者要修工具，后者要改写变异体；
    // 若混进"存活"名单，人会去**削弱测试**——本次就差点这么干（见 wire:* 的注释）。
    if (r.parseError) {
      results.push({ name: m.name, status: 'UNPARSABLE-SUITE-OUTPUT', detail: r })
      allGood = false
      continue
    }
    const caught = r.fail > 0 && (m.expectFailIncludes.length === 0
      || r.failures.some((n) => m.expectFailIncludes.some((frag) => n.includes(frag))))
    results.push({ name: m.name, caught, failCount: r.fail, failures: r.failures })
    if (!caught) allGood = false
  } finally {
    fs.writeFileSync(abs, original, 'utf8')
  }
}

// 还原校验
const byteIdentical = {}
for (const [abs, text] of restored) {
  byteIdentical[path.relative(ROOT, abs).replace(/\\/g, '/')] = fs.readFileSync(abs, 'utf8') === text
  if (!byteIdentical[path.relative(ROOT, abs).replace(/\\/g, '/')]) allGood = false
}
const after = {}
for (const tf of testFiles) {
  after[tf] = runSuite(tf)
  if (after[tf].fail !== 0) allGood = false
}

console.log(JSON.stringify({
  suite: 'po06-mutation-check',
  baseline,
  mutants: results,
  // 覆盖到**几个源文件**：文档里长期写着一个"20 个源文件"，而实际是 24——
  // 因为这个数字**没有任何检查**（计数检查只认"项测试/套/个变异"）。
  // 由变异器自己报出来，再进 release-check.json，检查器才有权威值可比（EV-0115）。
  sourceFiles: [...new Set(MUTANTS.map((m) => m.file))].length,
  sourceFileList: [...new Set(MUTANTS.map((m) => m.file))].sort(),
  restoredByteIdentical: byteIdentical,
  afterRestore: after,
  verdict: allGood ? 'PASS: 每个变异都被测试捕获，且源文件已字节还原' : 'FAIL: 见 mutants',
}, null, 2))
process.exit(allGood ? 0 : 1)
