// 文档漂移检查（EV-0103）：状态类文档里的**数字必须与产物一致**。
//
// 为什么需要：本项目最常见的缺陷类型不是代码错，而是**文档写了过期数字**。
// 实测修过的就有：测试数 340→346→368→376、变异数 96→103→119→125、
// S1 预算 227,775→1,530,366→105,048、以及"0.5.x 仍在装"这类过期断言。
// 每次都是**靠人偶然看到**才修的——那等于没有保障。本脚本把它变成可执行检查。
//
// 口径（重要）：
//   · **检查**：状态/结论类文档——README、RELEASE-CHECKLIST、CHECKPOINT、S1 报告。
//     这些文档描述的是"**现在**是什么状态"，数字过期就是错的。
//   · **不检查**：`EVIDENCE.md`。它是**按时间追加的日志**，里面写着"当时是 340 项"
//     是**正确的历史记录**，不是漂移。把它一起查会把正确的历史判成错误。
//
// 用法：node po06/scripts/check-docs.mjs [--strict]     --strict 时不一致以非零码退出
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const REPO = join(ROOT, '..')
const strict = process.argv.includes('--strict')

const rc = JSON.parse(readFileSync(join(ROOT, 'eval', 'release-check.json'), 'utf8'))
const AUTHORITATIVE = {
  suites: Object.keys(rc.tests || {}).length,
  pass: Object.values(rc.tests || {}).reduce((s, t) => s + (t.pass || 0), 0),
  mutants: rc.mutation ? rc.mutation.total : null,
}

/**
 * 状态类文档（见顶部口径）。
 * ⚠ **CHECKPOINT.md 也排除**：它同样是**逐轮追加的日志**
 * （"第 12 轮…变异 25 个"记录的是**当时**的数量，正确无误）。
 * 把日志类的文档一起查，会把正确的历史判成漂移——第一版就犯了两次这个错
 * （先漏了 EVIDENCE，又把 CHECKPOINT 算进来）。
 * 真正需要"永远是最新"的只有下面这三份：包 README、根 README、发布检查表。
 */
const DOCS = [
  join(REPO, 'README.md'),
  join(ROOT, 'README.md'),
  join(ROOT, 'RELEASE-CHECKLIST.md'),
  join(ROOT, 'eval', 'E001-S1-REPORT.md'),
]

/**
 * 要核对的模式：**只认全局计数**，不认"某条证据里有 N 项"这类局部叙述。
 * 为什么必须收窄：第一版用 `(\d+)\s*项` 去匹配，结果 82 条里绝大多数是假警报
 * （`EV-0023（18 项）` 说的是**那条证据当时的**用例数，不是项目总数）。
 * 满屏假警报的检查等于没有检查——所以宁可只查最明确的几种写法。
 */
const PATTERNS = [
  { re: /\*{0,2}(\d+)\s*项测试/g, key: 'pass', what: '测试项数' },
  { re: /\*{0,2}(\d+)\s*套(?:\s*测试)?/g, key: 'suites', what: '测试套数' },
  { re: /\*{0,2}(\d+)\s*个\s*变异/g, key: 'mutants', what: '变异数' },
]

const findings = []
for (const doc of DOCS) {
  if (!existsSync(doc)) continue
  const lines = readFileSync(doc, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { re, key, what } of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        const n = Number(m[1])
        const expected = AUTHORITATIVE[key]
        if (expected === null) continue
        // 只报**比权威值小**的（本项目计数只增不减 ⇒ 过期就是把旧的、更小的数留在文档里）。
        // 再加一个下限：本项目**全局**计数都 ≥20，而"某个特性有 3 个变异守卫"这类
        // **局部**叙述都是个位数 ⇒ 用 n<20 把它们排除。这是**针对本项目的经验阈值**，
        // 不是通用规则；写在这里是为了让假警报降到可读的程度。
        // 仍会有假警报（如"12 项测试全绿"讲的是当时那个套件），所以本检查默认**只提示**、
        // 不影响退出码；`--strict` 才当门禁。宁可是提示，也不要一个满屏假警报的门禁。
        if (n < 20) continue
        if (n < expected) {
          findings.push({
            doc: doc.replace(REPO, '').replace(/\\/g, '/').replace(/^\//, ''),
            line: i + 1, what, found: n, expected,
            text: line.trim().slice(0, 110),
          })
        }
      }
    }
  })
}

console.log('文档漂移检查（状态类文档；EVIDENCE.md 作为历史日志**不在范围内**）')
console.log('权威值：' + JSON.stringify(AUTHORITATIVE))
console.log('检查文件：' + DOCS.filter((d) => existsSync(d)).length + ' 份')
console.log('')
if (findings.length === 0) {
  console.log('✅ 未发现过期数字')
} else {
  console.log('⚠ 发现 ' + findings.length + " 处与产物不一致（可能是历史叙述，也可能是真漂移——需人看一眼）：")
  for (const f of findings) {
    console.log(`  ${f.doc}:${f.line}  ${f.what}: 文档写 ${f.found}，产物是 ${f.expected}`)
    console.log(`      ${f.text}`)
  }
}
if (strict && findings.length > 0) process.exit(1)
