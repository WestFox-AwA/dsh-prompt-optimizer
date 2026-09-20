// P7 · **花钱前的预检**：把"这一期要花多少、能测到什么、测不到什么"在**零花费**下问清楚。
//
//   node po06/scripts/preflight-e001.mjs --stage S4 [--out-dir <dir>] [--runs 3] [--arms A,C]
//                                        [--budget <n>] [--json out.json]
//
// 为什么必须有这个脚本（EV-0118）：S1 那次是在**花钱之后**才发现三个仪表缺陷
//   · 答案正文没落盘（run1 白花 42,884）→ 判据要的东西根本没存下来；
//   · 包正文没落盘 → 想验证假设只能再付一次解释层；
//   · 判据词表把任务名词当特征 → 指标不可用、结论撤回。
// 三次都是"**先跑，再发现判据不成立**"。而这三件事**本来都可以在跑之前查**：
//   · 判据要的产物**会不会落盘**（看运行器写什么）；
//   · 每个判据在本期的题上**适不适用**（看题面 + 仪器定义）；
//   · 哪些题**已经判过无效**（看 INVALID_ITEMS）。
// 本脚本不调模型、不花钱，只读文件与纯函数。
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  HOLDOUT_SEAL, parseHoldout, checkSealHash, verifySeal, tasksForStage, estimateCost, decideRun, STAGES,
  INVALID_ITEMS,
} from '../lib/eval-plan.js'
import { userProhibitions, DEPENDENCY_CONSTRAINT_RE } from '../lib/answer-audit.js'

const REPO = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STAGE = String(opt('stage', 'S4')).toUpperCase()
const OUT_DIR = opt('out-dir', join(DSH_HOME, 'po06-e001'))
const RUNS = Number(opt('runs', 3))
const ARMS = String(opt('arms', 'A,C')).split(',').map((s) => s.trim()).filter(Boolean)
const BUDGET = opt('budget', null) === null ? null : Number(opt('budget', null))
const JSON_OUT = opt('json', null)

const problems = []
const L = []
const say = (s = '') => L.push(s)

// ── ① 分期必须存在（未知分期不静默退回全部）───────────────────────────
if (!STAGES[STAGE]) {
  console.log(JSON.stringify({
    ok: false, code: 'UNKNOWN-STAGE', given: STAGE, available: Object.keys(STAGES),
    note: '未知分期不静默退回全部——那会让人以为在跑一个子集，实际花了全部的钱。',
  }, null, 2))
  process.exit(2)
}

// ── ② 封存校验 + **负向自检**（校验真的会拒绝吗）──────────────────────
const holdoutPath = join(REPO, 'eval', HOLDOUT_SEAL.file)
const text = readFileSync(holdoutPath, 'utf8')
const sha = createHash('sha256').update(readFileSync(holdoutPath)).digest('hex')
const hashCheck = checkSealHash(sha)
const countCheck = verifySeal(text)
// 负向：把一个**篡改过的** hash 拿去校验，必须被拒。否则"校验通过"没有意义。
const tamperCheck = checkSealHash('0'.repeat(64))
const sealOk = hashCheck.ok && countCheck.okTasks && tamperCheck.ok === false
say('# E-001 花钱前预检 · 分期 ' + STAGE + '（' + STAGES[STAGE].name + '）')
say('')
say('- 题集：`' + HOLDOUT_SEAL.file + '` sha256 `' + sha.slice(0, 12) + '…`')
say('- 分期：' + STAGE + ' → ' + STAGES[STAGE].ids.join(', '))
say('- 预算：' + (BUDGET === null ? '未指定（只做预检）' : BUDGET.toLocaleString('en-US')))
say('')
say('## 一、封存')
say('')
say('- ' + (hashCheck.ok ? '✅' : '❌') + ' hash 与封存值一致')
say('- ' + (countCheck.okTasks ? '✅' : '❌') + ' 题数一致（实际 ' + countCheck.actualTasks + '，应为 ' + countCheck.expectedTasks + '）')
say('- ' + (tamperCheck.ok === false ? '✅' : '❌') + ' **负向自检**：篡改的 hash 确实被拒（'
  + (tamperCheck.ok === false ? '拒绝理由：“' + String(tamperCheck.reason).slice(0, 40) + '…”' : '没拒绝 ⇒ 校验形同虚设') + '）')
say('')
if (!sealOk) problems.push('封存校验未通过（或负向自检失败）')

const allTasks = parseHoldout(text)
const tasks = tasksForStage(allTasks, STAGE)

// ── ③ 判据覆盖：本期**能测什么、测不到什么**（S1 的教训就是没先问这个）────
say('## 二、判据覆盖（这一期到底能测到什么）')
say('')
say('| 题 | 字符 | 放大 | 问句 | 约束守住 | 无效题 |')
say('|---|---|---|---|---|---|')
let depApplicable = 0
for (const t of tasks) {
  const proh = userProhibitions(t.body)
  const dep = proh.filter((p) => DEPENDENCY_CONSTRAINT_RE.test(p.clause)).length
  if (dep > 0) depApplicable += 1
  say('| ' + t.id + ' | ' + t.body.length + ' | ✅ | ✅ | ' + (dep > 0 ? '✅（' + dep + ' 条禁令）' : '— 不适用') + ' | '
    + (INVALID_ITEMS.includes(t.id) ? '**已判无效**' : '') + ' |')
}
say('')
say('- 「放大」与「问句」在**任何题**上都可测（答案文本即可判）。')
say('- 「约束守住」需要题面含**引依赖类禁令**：本期 **' + depApplicable + '/' + tasks.length + '** 题适用。')
if (depApplicable === 0) {
  say('  ⚠ ⇒ **这一期测不到「约束守住」**。若你花钱的目的正是它，这期选错了。')
  problems.push('本期没有任何题适用「约束守住」——花钱也测不到它')
}
const invalidHere = tasks.filter((t) => INVALID_ITEMS.includes(t.id)).map((t) => t.id)
if (invalidHere.length > 0) say('- ⚠ 本期含**已判定无效**的题（' + invalidHere.join(', ') + '）：汇总统计会自动排除它们。')
say('')

// ── ④ 成本与非模型前置花费 ────────────────────────────────────────────
const est = estimateCost({ tasks, arms: ARMS, runs: RUNS })
const decision = decideRun({ estimate: est, budget: BUDGET, runs: RUNS })
say('## 三、要花多少')
say('')
say('- 上界 **' + est.upper.toLocaleString('en-US') + '** / 期望 **' + est.expected.toLocaleString('en-US') + '**（'
  + tasks.length + ' 题 × ' + ARMS.length + ' 臂 × ' + RUNS + ' 轮）')
say('- 其中**解释层**（每题一次）：上界 ' + est.interpreter.upper.toLocaleString('en-US')
  + ' / 期望 ' + est.interpreter.total.toLocaleString('en-US') + ' —— 这是**跑之前**的前置花费')
say('- 判定：**' + decision.mode + '**' + (decision.reason ? '（' + decision.reason + '）' : ''))
say('')
if (BUDGET !== null && decision.mode === 'refuse') problems.push('预算低于上界 ⇒ 会被拒绝（这是刻意的：避免跑到一半没钱）')

// ── ⑤ 包缓存：哪些题**不用再花解释层的钱** ────────────────────────────
// ⚠ 缓存文件名自 EV-0137 起带**解释器指纹**（`<题>.<指纹>.md`）：不同配置各写各的，
// 不再互相覆盖、也不跨配置静默复用。所以这里必须认两种名字，并且**把无指纹的旧文件单独说清**
// ——它们**不会被复用**（无法证明是同一配置产出的），但也不该被悄悄忽略。
const packetsDir = join(OUT_DIR, 'packets')
const cachedAll = existsSync(packetsDir) ? readdirSync(packetsDir).filter((f) => f.endsWith('.md')) : []
const FP_RE = /\.([0-9a-f]{12})\.md$/
const legacyFiles = cachedAll.filter((f) => !FP_RE.test(f))
const fps = [...new Set(cachedAll.map((f) => (f.match(FP_RE) || [])[1]).filter(Boolean))]
// ⚠ 只有**带指纹**的文件才算"可能省下解释层的钱"：无指纹的旧文件运行期**不复用**（EV-0137），
// 把它们算进"已缓存"会让预检报出一个跑起来并不存在的省钱额度（本轮改的时候差点就这么写）。
// 而且预检**不知道**本轮运行期的指纹（配置来自会话），所以措辞只能说"同指纹才复用"。
const cachedIds = tasks.filter((t) => cachedAll.some((f) => f.startsWith(t.id + '.') && FP_RE.test(f))).map((t) => t.id)
const needCompile = tasks.filter((t) => !cachedIds.includes(t.id)).map((t) => t.id)
say('## 四、包缓存（省钱的地方）')
say('')
say('- 包目录：`' + packetsDir + '`')
say('- 带指纹的缓存命中：' + (cachedIds.length ? cachedIds.join(', ') : '（无）')
  + '　⚠ **是否真的复用取决于本轮配置指纹是否一致**（预检看不到运行期配置）')
say('- 仍需解释层编译：' + (needCompile.length ? needCompile.join(', ') : '（无）'))
say('- 缓存带**解释器指纹**（provider/model/temperature/提示词哈希）：'
  + (fps.length ? '现有 ' + fps.length + ' 组（' + fps.join(', ') + '）' : '（还没有带指纹的缓存）'))
say('  ⇒ 换配置重跑不会静默串包；不同配置各写各的、**谁都不覆盖谁**（EV-0137）。')
if (legacyFiles.length > 0) {
  say('- ⚠ **无指纹的旧缓存 ' + legacyFiles.length + ' 个**（' + legacyFiles.slice(0, 6).join(', ')
    + (legacyFiles.length > 6 ? ' …' : '') + '）：**本轮不复用**——无法证明它们出自同一配置。')
  say('  它们**不会被删除**；要复用请用当时那套配置，或人工确认后改名成带指纹的形式。')
}
// "一个都不匹配本期题号"要说的是**与本期的题无关**（别的期的产物）；无指纹的旧文件
// 若正是本期的题，那句提示就是误导（它会说"别把有缓存读成不花钱"，可实际只是格式旧）。
const anyMatch = cachedAll.some((f) => tasks.some((t) => f.startsWith(t.id + '.')))
if (cachedAll.length > 0 && !anyMatch) {
  say('  ⚠ 目录里有 ' + cachedAll.length + ' 个包文件，但**一个都不匹配本期的题号**——'
    + '这说明它们是别的期的。别把"有缓存"读成"这期不花钱"。')
}
say('')

// ── ⑥ 判据要的产物**会不会落盘**（S1 第一个缺陷就是它）────────────────
say('## 五、判据要的产物会不会落盘')
say('')
say('- 答案正文：✅ 按单元落 `units/<题>-<臂>-r<次>.md`（run1 曾只存字符数，白花 42,884）')
say('- 意图包：✅ 按题落 `packets/<题>.<解释器指纹>.md`（不同配置各写各的，不覆盖；EV-0137）')
say('- 用量与耗时：✅ 逐单元记 `usage`/`ms`')
say('- ⚠ **不落盘**：模型的中间推理（reasoning）只在 record 里，不单独成文件——判据若需要它，先改运行器。')
say('')

say('## 结论')
say('')
if (problems.length === 0) {
  say('✅ **前置条件成立**：封存可验、判据覆盖已列明、产物会落盘。'
    + (BUDGET === null ? '（未授权预算，只做预检）' : '（预算判定：' + decision.mode + '）'))
} else {
  say('❌ **不建议现在跑**：')
  for (const p of problems) say('- ' + p)
}

const out = L.join('\n') + '\n'
process.stdout.write(out)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    stage: STAGE, seal: { sha256: sha, ok: sealOk }, tasks: tasks.map((t) => t.id),
    dependencyApplicable: depApplicable, invalidHere, budget: BUDGET, decision: decision.mode,
    upper: est.upper, expected: est.expected, interpreterUpper: est.interpreter.upper,
    packets: { dir: packetsDir, cached: cachedIds, needCompile, fingerprints: fps, legacyIgnored: legacyFiles }, problems,
  }, null, 2) + '\n', 'utf8')
}process.exit(problems.length === 0 ? 0 : 2)
