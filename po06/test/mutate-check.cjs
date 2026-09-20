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
    from: '    const armExpected = unit * (nLarge + nSmall * smallFactor) * runs',
    to: '    const armExpected = unit * tasks.length * runs /*MUTANT*/',
    expectFailIncludes: ['上界'],
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
  restoredByteIdentical: byteIdentical,
  afterRestore: after,
  verdict: allGood ? 'PASS: 每个变异都被测试捕获，且源文件已字节还原' : 'FAIL: 见 mutants',
}, null, 2))
process.exit(allGood ? 0 : 1)
