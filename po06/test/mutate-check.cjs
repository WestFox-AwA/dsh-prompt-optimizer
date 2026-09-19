// 变异检验：确认 reducer 的测试**真的会失败**，而不是永远为真。
// 用法：node po06/test/mutate-check.cjs
//
// 动机：不会失败的测试等于没有测试。P2 首次实现时把身份闸门写在形状校验器里，
// 导致 reducer 的分支不可达而测试仍然"全绿"——这类假绿必须用变异检验暴露。
//
// 注意：本脚本**必须用 node 读写文件**。Windows PowerShell 5.1 的
//   · `Set-Content -Encoding utf8` 会写入 BOM，Node 的 ESM 加载器会因此报语法错误；
//   · `Get-Content -Raw` 会把无 BOM 的 UTF-8（含中文）按 ANSI 解读，写回即毁文件。
//   实测中这两点各毁过一次文件，故此处一律走 fs。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const TARGET = path.join(ROOT, 'lib', 'reducer.js')
const TEST = path.join(__dirname, 'reducer.test.mjs')

/** 声明的变异：每项 = {name, from, to, expectFailTests:[名字片段]} */
const MUTANTS = [
  {
    name: 'identity-gate-forced-true',
    from: "const hasHuman = op.item.sourceRefs.some((r) => r.kind === 'human')",
    to: 'const hasHuman = true /*MUTANT*/',
    expectFailIncludes: ['身份闸门'],
  },
  {
    name: 'cas-disabled',
    from: 'if (patch.baseRevision !== state.revision) {',
    to: 'if (false) {',
    expectFailIncludes: ['CAS'],
  },
  {
    name: 'input-gate-disabled',
    from: "if (typeof patch.baseInputRevision === 'number' && patch.baseInputRevision < state.lastInputRevision) {",
    to: 'if (false) {',
    expectFailIncludes: ['用户改口'],
  },
]

function runSuite() {
  const r = spawnSync(process.execPath, [TEST], { encoding: 'utf8' })
  try {
    const j = JSON.parse(r.stdout)
    return { pass: j.pass, fail: j.fail, failures: (j.failures || []).map((f) => f.name) }
  } catch {
    return { parseError: true, stdout: String(r.stdout).slice(0, 200), stderr: String(r.stderr).split('\n').slice(0, 3).join(' | ') }
  }
}

const original = fs.readFileSync(TARGET, 'utf8')
const results = []
let allGood = true

const baseline = runSuite()
if (baseline.fail !== 0) {
  console.log(JSON.stringify({ error: 'baseline suite already failing', baseline }, null, 2))
  process.exit(1)
}

try {
  for (const m of MUTANTS) {
    if (!original.includes(m.from)) {
      results.push({ name: m.name, status: 'ANCHOR-MISSING' })
      allGood = false
      continue
    }
    fs.writeFileSync(TARGET, original.replace(m.from, m.to), 'utf8')
    const r = runSuite()
    fs.writeFileSync(TARGET, original, 'utf8')
    const caught = r.fail > 0 && (m.expectFailIncludes.length === 0
      || r.failures.some((n) => m.expectFailIncludes.some((frag) => n.includes(frag))))
    results.push({ name: m.name, caught, failCount: r.fail, failures: r.failures })
    if (!caught) allGood = false
  }
} finally {
  fs.writeFileSync(TARGET, original, 'utf8')
}

const after = runSuite()
const byteIdentical = fs.readFileSync(TARGET, 'utf8') === original
if (!byteIdentical || after.fail !== 0) allGood = false

console.log(JSON.stringify({
  suite: 'po06-mutation-check',
  baseline: { pass: baseline.pass, fail: baseline.fail },
  mutants: results,
  restoredByteIdentical: byteIdentical,
  afterRestore: { pass: after.pass, fail: after.fail },
  verdict: allGood ? 'PASS: 每个变异都被测试捕获，且源文件已字节还原' : 'FAIL: 见 mutants',
}, null, 2))
process.exit(allGood ? 0 : 1)
