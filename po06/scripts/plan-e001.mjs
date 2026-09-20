// P7 / E-001 留出评估：**计划 + 预算守卫**的入口。
//
//   node po06/scripts/plan-e001.mjs                 # 只出计划（默认，不花任何钱）
//   node po06/scripts/plan-e001.mjs --budget 3000000 # 授权预算；低于上界会被拒绝
//   node po06/scripts/plan-e001.mjs --runs 3 --arms A,C
//
// 本脚本**不生成任何东西**：它做的是"能不能跑、要花多少、授权够不够"。
// 真正的运行器要等预算授权之后再写——先把闸门立起来，避免"先跑起来再说"。
//
// 退出码：0 = 计划已出（dry-run / execute 均可继续）；2 = 预算或 runs 被拒绝；
//         3 = 封存校验不通过（题集被改过）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  HOLDOUT_SEAL, parseHoldout, checkSealHash, verifySeal, estimateCost, decideRun, renderPlan,
} from '../lib/eval-plan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const runs = Number(opt('runs', 3))
const arms = String(opt('arms', 'A,C')).split(',').map((s) => s.trim()).filter(Boolean)
const budgetRaw = opt('budget', null)
const budget = budgetRaw === null ? null : Number(budgetRaw)

// ── ① 封存校验：hash 与题数都要对，否则拒绝 ──────────────────────────
const holdoutPath = join(ROOT, 'eval', HOLDOUT_SEAL.file)
let text = ''
try { text = readFileSync(holdoutPath, 'utf8') } catch (e) {
  console.log(JSON.stringify({ ok: false, code: 'HOLDOUT-MISSING', path: holdoutPath, error: String(e.message || e) }, null, 2))
  process.exit(3)
}
const sha = createHash('sha256').update(readFileSync(holdoutPath)).digest('hex')
const hashCheck = checkSealHash(sha)
const countCheck = verifySeal(text)
const seal = {
  ok: hashCheck.ok && countCheck.okTasks,
  reason: hashCheck.reason || (countCheck.okTasks ? null : `题数不符：实际 ${countCheck.actualTasks}，应为 ${countCheck.expectedTasks}`),
  sha256: sha,
}
if (!seal.ok) {
  console.log(JSON.stringify({
    ok: false, code: 'SEAL-MISMATCH', seal,
    note: '留出集已封存：改动即结论不可比。拒绝运行。',
  }, null, 2))
  process.exit(3)
}

// ── ② 成本与闸门 ────────────────────────────────────────────────────
const tasks = parseHoldout(text)
const estimate = estimateCost({ tasks, arms, runs })
const decision = decideRun({ estimate, budget, runs })

const plan = {
  ok: decision.mode !== 'refuse',
  probe: 'po06-plan-e001',
  phase: 'P7',
  at: new Date().toISOString(),
  seal,
  tasks: tasks.map((t) => ({ id: t.id, title: t.title, chars: t.body.length })),
  estimate,
  decision,
  note: '本脚本只出计划，不生成任何内容。运行器待预算授权后再写。',
}
writeFileSync(join(ROOT, 'eval', 'plan-E001.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8')

console.log(renderPlan({ estimate, decision, seal }))
console.log(JSON.stringify({
  ok: plan.ok, mode: decision.mode, sealOk: seal.ok,
  tasks: tasks.length, runs, arms,
  budget: decision.budget, upper: estimate.upper, expected: estimate.expected,
  written: 'po06/eval/plan-E001.json',
}, null, 2))

process.exit(decision.mode === 'refuse' ? 2 : 0)
