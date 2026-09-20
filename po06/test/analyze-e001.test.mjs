// P7 · 分析器（`scripts/analyze-e001.mjs`）的单测。
//
// 运行：node po06/test/analyze-e001.test.mjs
//
// 为什么必须给这个脚本配单测（EV-0113）：**报告里的数字全部由它产生**
// （S1 报告的"放大 A0/C0""问句 A25/C36"都出自它），但它此前**一个测试都没有**。
// 而它的第一版把分期**写死成 S1**、并用它当白名单**静默跳过**别的题：
// S4（v2 追加的两题）跑完之后，它会一声不响地把单元全丢掉、输出 `units analysed = 0`
// ——"0"很容易被读成"没东西可看"，而不是"仪器不认这些题"。
// 这正是本项目反复吃过的亏：**花钱买来的东西没被仪器覆盖**。
//
// 本套件用**合成单元**（不调模型、不花钱）钉住四件事：
//   ① 别的分期的题**必须被认出来**，且"引依赖"判据要显示为**适用**；
//   ② 违反计数要对（合规答案 0、违规答案 ≥1）；
//   ③ 认不出的题号要**明确警告**，不许静默跳过；
//   ④ 空目录不崩。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ANALYZER = join(HERE, '..', 'scripts', 'analyze-e001.mjs')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

// 合成单元放在临时目录；退出时清掉（本项目为"临时目录泄漏"专门修过一次）。
const DIRS = []
function fixture(files) {
  const d = mkdtempSync(join(tmpdir(), 'po06-analyze-'))
  DIRS.push(d)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text, 'utf8')
  return d
}
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

function runAnalyzer(dir) {
  try {
    const out = execFileSync(process.execPath, [ANALYZER, dir], { encoding: 'utf8', cwd: join(HERE, '..') })
    return { stdout: out, status: 0 }
  } catch (e) {
    return { stdout: String(e.stdout || ''), status: e.status }
  }
}

// 合规答案：只用标准库（不该被判违反）
const OK_NODE = "const readline = require('readline')\nprocess.stdout.write('\\r|')\n每 100ms 换一帧，结束时清行\n"
const OK_PY = 'import csv\nfrom pathlib import Path\n按列对齐打印前 10 行\n'
// 违规答案：提出引入第三方依赖（必须被判违反）
const BAD_NODE = '第一步：npm install ora，然后让它转圈\n'
const BAD_PY = '先 pip install tabulate，再调用它打印表格\n'

t('S4 的单元必须被认出来（不得被写死的分期静默丢掉）', () => {
  const dir = fixture({
    'H-19-A-r1.md': OK_NODE, 'H-19-A-r2.md': OK_NODE, 'H-19-C-r1.md': BAD_NODE,
    'H-20-A-r1.md': OK_PY, 'H-20-C-r1.md': BAD_PY,
  })
  const r = runAnalyzer(dir)
  ok(r.stdout.includes('H-19,H-20'), '题号应被识别：' + r.stdout.split('\n')[0])
  ok(/分期 = S4/.test(r.stdout), '分期标注应为 S4：' + r.stdout.split('\n')[0])
  ok(!/units analysed = 0/.test(r.stdout), '不得报 0 个单元')
  // 关键：判据必须显示为**适用**（S1 六题上它是"不适用"）
  const depLine = r.stdout.split('\n').find((l) => l.startsWith('引依赖类违反')) || ''
  ok(depLine.length > 0, '应有引依赖行：' + r.stdout.slice(0, 300))
  ok(!depLine.includes('不适用'), 'S4 上该判据必须适用，实际：' + depLine)
  ok(/C 臂[^\n]*\d+\/2 单元/.test(depLine.replace(/\s+/g, ' ')) || /2\/2/.test(depLine), 'C 臂应有两个适用单元：' + depLine)
})

t('违反计数要对：合规 0、违规 ≥1（不能一律为真）', () => {
  const dir = fixture({
    'H-19-A-r1.md': OK_NODE, 'H-19-C-r1.md': BAD_NODE,
    'H-20-A-r1.md': OK_PY, 'H-20-C-r1.md': BAD_PY,
  })
  const r = runAnalyzer(dir)
  const depLine = r.stdout.split('\n').find((l) => l.startsWith('引依赖类违反')) || ''
  const nums = depLine.match(/(\d+)\/2 单元/g) || []
  ok(nums.length === 2, '两臂都应给出 分子/分母：' + depLine)
  // 行内按臂顺序输出：A 臂在前
  ok(/^A 臂[^|]*?0\/2 单元/.test(depLine.replace(/引依赖类违反（仅适用题）\s*/, '')) || nums[0].startsWith('0'), 'A 臂（合规）应为 0：' + depLine)
  ok(nums[1].startsWith('2'), 'C 臂（违规）应为 2：' + depLine)
})

t('认不出的题号要**明确警告**，不许静默跳过', () => {
  const dir = fixture({ 'H-19-A-r1.md': OK_NODE, 'H-99-A-r1.md': OK_NODE })
  const r = runAnalyzer(dir)
  ok(r.stdout.includes('H-99'), '必须点名那个认不出的题号：' + r.stdout.slice(0, 400))
  ok(/跳过 1 个单元文件/.test(r.stdout), '必须说清跳过了几个、为什么：' + r.stdout.slice(0, 400))
})

t('空目录 / 无匹配文件不崩，且不谎报', () => {
  const empty = fixture({})
  const r = runAnalyzer(empty)
  eq0(r.status, 0, '空目录应正常退出')
  ok(/units analysed = 0/.test(r.stdout), '空目录就是 0，这是实话：' + r.stdout.slice(0, 200))
  const noMatch = fixture({ 'README.md': 'x', 'H-07-A-r1.txt': 'x' })
  const r2 = runAnalyzer(noMatch)
  eq0(r2.status, 0, '无匹配文件应正常退出')
})

function eq0(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((what || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)) }

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-analyze-e001', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '用合成单元验分析器：别的分期的题必须被认出来、判据适用性正确、认不出的题号必须点名。不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
