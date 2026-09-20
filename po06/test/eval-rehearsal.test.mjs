// P7 · **花钱前的彩排**：用假模型把 S4 的整条链路（解释层 → 单元 → 落盘 → 分析）跑一遍。
//
// 运行：node po06/test/eval-rehearsal.test.mjs
//
// 为什么必须有这一条（EV-0130）：`runE001` **从来没有在零花费下跑通过**——
// 它只被真实花钱的 S1 运行过，而 S1 的教训正是"跑完才发现仪表坏了"：
//   · run1 的 record 只存 `chars` 不存正文 ⇒ 白花 42,884；
//   · 包正文没落盘 ⇒ 想验证假设只能再付一次解释层；
//   · 分析器把分期写死成 S1、判据适用性恒为假（EV-0113）⇒ 花钱也测不到。
// 静态预检（EV-0118）查的是"该测的测得到"；**这一条查"真的跑得通、真的落得下来、分析器真的读得到"**。
// 两者互补：预检是清单，彩排是执行。
//
// 全部用假模型 + 临时目录：**不联网、不花钱、不碰真实 home**。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { HOLDOUT_SEAL } from '../lib/eval-plan.js'
import { packetFingerprint, packetCacheName } from '../lib/eval-e001.js'
import { SYSTEM_PROMPT } from '../lib/interpreter.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const RUNS = 3
const ARMS = 2

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }

/** 用例注册：**收集 promise 到末尾统一 await**——本文件里有 async 用例，
 * 同步的 `t()` 会把它的失败**吞掉**（第一版正是如此：4 条只跑了 3 条）。 */
const PENDING = []
function t(name, fn) {
  PENDING.push((async () => {
    try { await fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) }
  })())
}

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); DIRS.push(d); return d }

/** 假的消息构造模块（`complete()` 会 `import(llmLib)` 拿这两个构造函数）。 */
const STUB_LLM_LIB = `
export function createSystemMessage(text) { return { role: 'system', text: String(text) } }
export function createUserMessage({ content }) {
  return { role: 'user', text: (content || []).map((c) => c && c.text).join('\\n') }
}
`

/**
 * 假模型：按系统提示词判断这是"解释层"还是"作答"，然后吐确定的文本。
 * @param bodies 题面（解释层的引文必须是**用户原话的字面子串**，所以从题面里取——
 *               拼接后的提示词里有状态等别的内容，直接截出来不是子串 ⇒ 机械校验会拒）
 */
function makeStubLlm({ answerWithViolation = true, bodies = [] } = {}) {
  const calls = []
  return {
    calls,
    stream({ messages }) {
      const sys = (messages && messages[0] && messages[0].text) || ''
      const user = (messages && messages[1] && messages[1].text) || ''
      calls.push({ userChars: user.length })
      const isInterpreter = /add_item|逐字引文/.test(sys)
      let text
      if (isInterpreter) {
        // 解释层：产出可被机械校验通过的 op 形状 `{"ops":[{"op":"add_item","item":…}]}`
        const hit = bodies.find((b) => user.includes(b.body))
        const quote = hit ? hit.body.slice(0, Math.min(20, hit.body.length)) : ''
        const tid = hit ? hit.id : 'x'
        text = JSON.stringify({
          ops: [{
            op: 'add_item',
            item: {
              id: 'req-' + tid, kind: 'user_requirement',
              text: '按题面要求完成', quote, scope: 'task',
              // 出处是**必填**（schema：kind=human 必须有 messageId）——
              // 运行器用的就是 `e001-<题号>` / `m-<题号>`，这里照它写。
              sourceRefs: [{ kind: 'human', sessionId: 'e001-' + tid, messageId: 'm-' + tid }],
            },
          }],
        })
      } else {
        // 作答：**故意含一条违规**（提出装包），好让「约束守住」这条判据在分析里真的被算出来
        text = answerWithViolation
          ? '先 npm install ora，然后每 100ms 换一帧；结束时清行。'
          : "const readline = require('readline')\n每 100ms 换一帧，结束时清行。"
      }
      return (async function* gen() {
        yield { type: 'text-delta', text }
        yield { type: 'usage', usage: { totalTokens: 123 } }
        yield { type: 'finish', finish: 'stop' }
      })()
    },
  }
}

/** 跑一次彩排：真留出集 + 假模型 + 临时 outDir。 */
let seededFingerprint = null
async function rehearse({ stage = 'S4', runs = RUNS, answerWithViolation = true, seedPackets = false, reuseHome = null } = {}) {
  const home = reuseHome || tmp('po06-rel-')
  const outDir = join(home, 'po06-e001')
  const stubLib = join(home, 'stub-llm-lib.mjs')
  writeFileSync(stubLib, STUB_LLM_LIB, 'utf8')
  const specPath = join(home, 'spec.json')
  writeFileSync(specPath, JSON.stringify({
    provider: 'stub', model: 'stub', temperature: 0, armSystemPrompt: '你是执行体。',
  }), 'utf8')

  const { runE001 } = await import('../lib/eval-e001.js')
  const { parseHoldout, tasksForStage, estimateCost } = await import('../lib/eval-plan.js')
  const holdoutPath = join(REPO, 'eval', HOLDOUT_SEAL.file)
  const tasks = tasksForStage(parseHoldout(readFileSync(holdoutPath, 'utf8')), stage)
  const upper = estimateCost({ tasks, arms: ['A', 'C'], runs }).upper

  if (seedPackets) {
    // 自 EV-0137 起缓存名带**解释器指纹**：用被测代码自己的指纹函数算名字，
    // 顺便证明"同一配置 ⇒ 同一指纹"是稳定的。
    const fp = packetFingerprint({ provider: 'stub', model: 'stub', temperature: 0 }, SYSTEM_PROMPT)
    mkdirSync(join(outDir, 'packets'), { recursive: true })
    for (const task of tasks) writeFileSync(join(outDir, 'packets', packetCacheName(task.id, fp)), '【明确要求】\n- 缓存里的包\n', 'utf8')
    seededFingerprint = fp
  }

  const llm = makeStubLlm({ answerWithViolation, bodies: tasks.map((x) => ({ id: x.id, body: x.body })) })
  const ctx = { get: (name) => (name === 'llm' ? llm : undefined) }
  const report = await runE001({
    ctx, holdoutPath, specPath, outDir, stage, runs, budget: upper,
    llmLib: pathToFileURL(stubLib).href,
  })
  return { home, outDir, report, llm, tasks, upper }
}

const R = await rehearse()

// ── ① 整条链路跑通，且**落盘的东西齐全** ────────────────────────────────
t('S4 彩排：runE001 在零花费下跑通，产物落盘（包 / 单元 / 报告）', () => {
  eq(R.report.error, undefined, '不得报错：' + JSON.stringify({ error: R.report.error, verdict: R.report.verdict }))
  ok(R.report.ok === true, 'ok 应为 true：' + JSON.stringify(R.report.verdict || ''))
  const pktDir = join(R.outDir, 'packets')
  ok(existsSync(pktDir), '包目录必须在：' + pktDir)
  const fp = R.report.steps.packetFingerprint
  ok(typeof fp === 'string' && /^[0-9a-f]{12}$/.test(fp), '报告里要记解释器指纹（EV-0137）：' + fp)
  for (const task of R.tasks) {
    const p = join(pktDir, packetCacheName(task.id, fp))
    ok(existsSync(p), '包必须落盘且**带指纹**：' + task.id)
    ok(readFileSync(p, 'utf8').length > 0, '包必须有正文（不是只存字符数）：' + task.id)
  }
  const unitDir = join(R.outDir, 'units')
  const units = existsSync(unitDir) ? readdirSync(unitDir).filter((f) => f.endsWith('.md')) : []
  eq(units.length, R.tasks.length * ARMS * RUNS, '单元数应等于 题×臂×轮')
  for (const f of units) ok(readFileSync(join(unitDir, f), 'utf8').length > 0, '单元必须有正文：' + f)
  const reports = readdirSync(R.outDir).filter((f) => /^e001-\d+\.json$/.test(f))
  ok(reports.length >= 1, '报告必须落盘（`e001-<时间戳>.json`，多次运行各留一份）：' + JSON.stringify(readdirSync(R.outDir)))
  ok(existsSync(join(R.outDir, 'records.jsonl')), '逐单元记录（records.jsonl）必须落盘')
})

// ── ② 花费**可算**：调用次数 = 解释层（每题一次）+ 单元（题×臂×轮）────────
t('彩排：调用次数 = 解释层(每题一次) + 单元(题×臂×轮)，用量被记账', () => {
  const unitCount = R.tasks.length * ARMS * RUNS
  eq(R.llm.calls.length, R.tasks.length + unitCount, '调用次数（解释层按题一次，不按臂/轮翻倍）')
  const repFile = readdirSync(R.outDir).filter((f) => /^e001-\d+\.json$/.test(f)).sort().pop()
  const rep = JSON.parse(readFileSync(join(R.outDir, repFile), 'utf8'))
  ok(rep.estimate && rep.estimate.upper > 0, '报告里要有预算口径')
  ok(Array.isArray(rep.steps && rep.steps.packets) && rep.steps.packets.length === R.tasks.length,
    '报告里要逐题记包（含用量/耗时）')
  ok(rep.spend && typeof rep.spend.interpreter === 'number', '报告里要记实际花费（spend.interpreter）')
})

// ── ③ **分析器读得到**：这是"花钱买得到结论"的最后一环 ────────────────────
t('彩排：分析器认得出这批产物，「约束守住」适用并算出违规', () => {
  const out = execFileSync(process.execPath,
    [join(REPO, 'scripts', 'analyze-e001.mjs'), join(R.outDir, 'units')],
    { encoding: 'utf8', cwd: REPO })
  ok(out.includes('H-19,H-20'), '分析器应认出 S4 的两道题：\n' + out.split('\n')[0])
  ok(/分期 = S4/.test(out), '应标注分期 S4：\n' + out.split('\n')[0])
  const depLine = out.split('\n').find((l) => l.startsWith('引依赖类违反')) || ''
  ok(depLine.length > 0, '应有引依赖行：\n' + out.slice(0, 300))
  ok(!depLine.includes('不适用'), 'S4 上该判据必须适用：' + depLine)
  // 假模型**故意**说了 `npm install ora` ⇒ 两臂都该被判出违规
  // （分母是"适用单元数"= 2 题 × 3 轮 = 6，不是题数）
  const nums = [...depLine.matchAll(/(\d+)\/(\d+) 单元/g)].map((m) => [Number(m[1]), Number(m[2])])
  eq(nums.length, 2, '两臂都要给分子/分母：' + depLine)
  ok(nums.every(([n, d]) => d > 0 && n >= 1), '两臂都应算出违规（分子≥1）：' + depLine)
})

// ── ④ 预先放好的包会被**复用**（重跑不再付解释层的钱）───────────────────
t('彩排：已存在的包直接复用（重跑不再付解释层的钱）', async () => {
  const R2 = await rehearse({ seedPackets: true, reuseHome: tmp('po06-rel2-') })
  eq(R2.report.error, undefined, '复用路径不该报错：' + JSON.stringify(R2.report.error || ''))
  eq(R2.report.steps.packets.filter((p) => p.reused === true).length, R2.tasks.length, '每道题的包都应标记为复用')
  eq(R2.llm.calls.length, R2.tasks.length * ARMS * RUNS, '解释层一次都不该再调（只剩单元调用）')
  // 复用**必须**依据同一个指纹：播种用的名字与运行期算出来的不一致，就等于"看起来命中了、其实是巧合"
  eq(R2.report.steps.packetFingerprint, seededFingerprint, '运行期指纹必须与播种时一致')
})

// ── ⑤ 换配置**不得**静默复用旧包，也不得覆盖它（EV-0137）────────────────
// 旧口径的缓存键只有题号 ⇒ 换解释器配置重跑会拿到上一套配置的包，报告里只写 reused:true。
// 实测后果更重：三轮 S1 共用一个 outDir，每轮**覆盖**同名包，如今只剩最后一轮的两份，
// 跑完的答案再也无法与它当时的包对照。
t('彩排：指纹不符的包**不复用**，且原文件不得被覆盖', async () => {
  const home = tmp('po06-rel3-')
  const outDir = join(home, 'po06-e001')
  mkdirSync(join(outDir, 'packets'), { recursive: true })
  const foreign = join(outDir, 'packets', 'H-19.aaaaaaaaaaaa.md')   // 别的配置产出的包
  writeFileSync(foreign, '【明确要求】\n- 别的配置的包（不许被当成我的缓存）\n', 'utf8')
  const legacy = join(outDir, 'packets', 'H-20.md')                 // 旧口径（无指纹）
  writeFileSync(legacy, '【明确要求】\n- 旧口径的包\n', 'utf8')

  const R3 = await rehearse({ reuseHome: home })
  eq(R3.report.error, undefined, '不该报错：' + JSON.stringify(R3.report.error || ''))
  eq(R3.report.steps.packets.filter((p) => p.reused === true).length, 0, '两份缓存都不该被复用')
  eq(R3.llm.calls.length, R3.tasks.length + R3.tasks.length * ARMS * RUNS, '解释层必须重新编译（多花一次，换"不串配置"）')
  eq(readFileSync(foreign, 'utf8').includes('别的配置的包'), true, '别人的包必须**原样留着**（不得覆盖）')
  eq(readFileSync(legacy, 'utf8').includes('旧口径的包'), true, '旧口径的文件也必须留着')
  eq(R3.report.steps.packetLegacyIgnored, ['H-20.md'], '旧口径文件要**如实报出来**（不许悄悄忽略）')
  // 本轮自己的包按自己的指纹落盘，与那两份并存
  const mine = packetCacheName('H-19', R3.report.steps.packetFingerprint)
  ok(existsSync(join(outDir, 'packets', mine)), '本轮自己的包要带自己的指纹落盘：' + mine)
})

// ── ⑥ 指纹**跟着配置变**（同一配置稳定、换一项就变）──────────────────────
t('packetFingerprint：同一配置稳定；provider/model/temperature/提示词 任一变化都要变', () => {
  const base = { provider: 'p', model: 'm', temperature: 0 }
  const fp1 = packetFingerprint(base, 'SYS')
  eq(packetFingerprint({ provider: 'p', model: 'm', temperature: 0 }, 'SYS'), fp1, '同一配置 ⇒ 同一指纹')
  ok(packetFingerprint({ ...base, model: 'm2' }, 'SYS') !== fp1, '换模型 ⇒ 指纹要变')
  ok(packetFingerprint({ ...base, provider: 'p2' }, 'SYS') !== fp1, '换 provider ⇒ 指纹要变')
  ok(packetFingerprint({ ...base, temperature: 0.7 }, 'SYS') !== fp1, '换温度 ⇒ 指纹要变')
  ok(packetFingerprint(base, 'SYS2') !== fp1, '改解释层提示词 ⇒ 指纹要变（否则改了提示词还吃旧包）')
  eq(fp1.length, 12, '指纹长度固定 12 位十六进制')
})

await Promise.all(PENDING)   // 统一等所有用例（含 async 那条）落定
const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-eval-rehearsal', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '假模型把 S4 整条链路跑一遍：解释层→单元→落盘→分析器。不联网、不花钱、不碰真实 home。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
