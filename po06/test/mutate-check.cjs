// 变异检验：确认测试**真的会失败**，而不是永远为真。
// 用法：node po06/test/mutate-check.cjs
//
// 动机：不会失败的测试等于没有测试。已抓到的两类假绿——
//   ① P2 首版把身份闸门写在形状校验器里，reducer 分支不可达而测试全绿；
//   ② 投影定义漏了 stateSchema，注册/提交/读取全正常，**只在恢复时才抛错**。
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
