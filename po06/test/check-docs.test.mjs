// P7 · 文档漂移检查器（`scripts/check-docs.mjs`）自己的单测。
//
// 运行：node po06/test/check-docs.test.mjs
//
// 为什么必须给它配单测（EV-0115）：它是**发版门的一部分**（`check-release` 用 `--strict` 调它，
// 它红了就拦住打包），却**一直没有回归保护**。而这一轮我已经亲手让它错了两次：
//   ① 指向检查第一版一次报 16 处、其中大多数不是问题（满屏假警报的检查等于没有检查）；
//   ② 忘了 import readdirSync ⇒ 同名文件索引是空的 ⇒ 满仓都"不存在"。
// 两次都是靠**当场跑一遍**发现的。这个套件把"当场跑一遍"变成**别人也能重跑**的东西。
//
// 做法：把脚本**复制进一个临时 fixture 树**再跑它。它的路径全部由自身位置推导
// （`ROOT = <script>/..`、`REPO = ROOT/..`），所以不需要给它开后门参数。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'check-docs.mjs')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/** 权威值：1 套 / 100 项 / 50 变异；S1 上界 9000 / 期望 4000，S4 上界 7000 / 期望 3000。
 *  预算用**四位数**：检查器的数字模式要求 ≥4 位（已知局限，注释里写明了），
 *  fixture 必须走真实路径，不能因为图省事用三位数而测了个空。 */
const RC = { tests: { 'x.test.mjs': { pass: 100 } }, mutation: { total: 50 } }
/** 真实台账（fixture 默认用它：被复制的检查器脚本自己就引用了十几个真实编号）。 */
const REAL_EVIDENCE = readFileSync(join(HERE, '..', '..', 'EVIDENCE.md'), 'utf8')
/**
 * 用来测"悬空引用会被抓"的假编号——**必须拼接出来，不能写字面量**（EV-0128）：
 * 引文检查会扫全仓（含测试源码），写死的假编号会**被它自己抓到**（实测抓到过）。
 */
const FAKE_EV = 'EV-' + '4242'
const PLAN = { stages: { S1: { upper: 9000, expected: 4000 }, S4: { upper: 7000, expected: 3000 } } }
const VERSION = '9.9.9-test'

/**
 * 建一棵 fixture 树并跑检查器。
 * @param {{po06Readme?:string, rootReadme?:string, checklist?:string, report?:string,
 *          evidence?:string|null, extraFile?:{name:string, text:string}}} over
 */
function run(over = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'po06-docs-'))
  DIRS.push(repo)
  const po06 = join(repo, 'po06')
  mkdirSync(join(po06, 'scripts'), { recursive: true })
  mkdirSync(join(po06, 'eval'), { recursive: true })
  copyFileSync(SCRIPT, join(po06, 'scripts', 'check-docs.mjs'))

  writeFileSync(join(po06, 'package.json'), JSON.stringify({ name: 'x', version: VERSION }), 'utf8')
  writeFileSync(join(po06, 'eval', 'release-check.json'), JSON.stringify(RC), 'utf8')
  writeFileSync(join(po06, 'eval', 'plan-E001.json'), JSON.stringify(PLAN), 'utf8')
  // 根 README：门面检查要求出现当前版本号
  writeFileSync(join(repo, 'README.md'), over.rootReadme ?? `# repo\n\n本仓有 ${VERSION}\n`, 'utf8')
  writeFileSync(join(po06, 'README.md'), over.po06Readme ?? '# po06\n\n**100 项测试和 50 个变异守卫**\n', 'utf8')
  writeFileSync(join(po06, 'RELEASE-CHECKLIST.md'), over.checklist ?? '# checklist\n\n| A1 | **1 套 / 100 项** |\n', 'utf8')
  writeFileSync(join(po06, 'eval', 'E001-S1-REPORT.md'), over.report ?? '# report\n', 'utf8')
  // 引文检查要读 EVIDENCE.md。**默认用真的那份**：被复制进来的 `check-docs.mjs` 自己的
  // 注释里就引用了十几个真实编号，用一份"只有一条"的假台账会把它们全报成悬空
  // （第一版 fixture 就是这么错的——**错在 fixture，不在检查器**）。
  if (over.evidence !== null) {
    writeFileSync(join(repo, 'EVIDENCE.md'), over.evidence ?? REAL_EVIDENCE, 'utf8')
  }
  if (over.extraFile) writeFileSync(join(repo, over.extraFile.name), over.extraFile.text, 'utf8')

  const args = [join(po06, 'scripts', 'check-docs.mjs'), '--strict',
    '--suites', '1', '--pass', '100', '--mutants', '50', '--source-files', '30', '--lib-modules', '30']
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8', cwd: repo })
    return { exit: 0, stdout }
  } catch (e) {
    return { exit: e.status, stdout: String(e.stdout || '') }
  }
}

// ── ① 全绿 ───────────────────────────────────────────────────────────
t('全绿 fixture：四条检查都 ✅ 且退出码 0', () => {
  const r = run()
  eq(r.exit, 0, 'exit 应为 0；输出：\n' + r.stdout)
  for (const k of ['计数类数字', '预算类数字', '指向', '门面']) {
    ok(r.stdout.includes('✅ ' + k), k + ' 应为 ✅；输出：\n' + r.stdout)
  }
})

// ── ② 计数低于权威值 ⇒ 报红（这是最常发生的漂移）──────────────────────
t('计数过期（文档写 99、产物 100）⇒ 报红并点名文件', () => {
  const r = run({ po06Readme: '# po06\n\n**99 项测试**\n' })
  eq(r.exit, 1, 'exit 应为 1')
  ok(r.stdout.includes('po06/README.md'), '应点名文件：\n' + r.stdout)
  ok(/文档写 99/.test(r.stdout), '应写出"文档写 99"：\n' + r.stdout)
})

// ── ③ 括注型局部叙述**不得**误报（`EV-0001（23 项）` 讲的是那条证据当时）──
t('括注型局部叙述不误报（EV-0001（23 项））', () => {
  const r = run({ po06Readme: '# po06\n\n**100 项测试**\n\n| x | EV-0001（23 项） |\n' })
  eq(r.exit, 0, '不应报红；输出：\n' + r.stdout)
  ok(r.stdout.includes('✅ 计数类数字'), '计数类应 ✅')
})

// ── ③b 但括注里的**带单位词**计数是真漂移，必须报（EV-0132 实测的盲区）──
// 真实形态：根 README 首屏写着 `（393 项测试 / 160 个变异 / …）`——
// 393 紧跟 `（` ⇒ 旧规则整条跳过，而同一括注里的 160 因为前面是 `/` 被查了出来。
t('括注里的带单位计数**必须**查（回归：同一括注一半被查一半不查）', () => {
  // fixture 的权威值是 100 项 / 50 变异；括注里放一个**过期偏小**的 39（真实形态是
  // README 首屏的 `（393 项测试 / …）`，真值 464 —— 计数只增不减，过期就是偏小）。
  // 根 README 要带上当前版本号，否则失败原因会混进"门面"那条检查（测了个别的东西）。
  const r = run({
    rootReadme: `# repo\n\n本仓有 ${VERSION}\n\n| **0.6** | x（39 项测试 / 160 个变异） |\n`,
    po06Readme: '**100 项测试**\n',
  })
  eq(r.exit, 1, '应报红；输出：\n' + r.stdout)
  ok(r.stdout.includes('文档写 39'), '要点名 39 这个过期数字；输出：\n' + r.stdout)
})

t('括注里的裸计数仍然不报（假警报守卫）', () => {
  const r = run({ po06Readme: '**100 项测试**\n\n| x | 见 EV-0001（23 项）与 EV-0002（18 项） |\n' })
  eq(r.exit, 0, '不应报红；输出：\n' + r.stdout)
})

// ── ③c `lib/ N 个模块` 也要查（EV-0132：同一份 README 里它漂到 27 而没人查）──
t('lib 模块数过期 ⇒ 报红（锚在 lib/ 上，不受 n≥20 下限保护）', () => {
  const r = run({ po06Readme: '**100 项测试**\n\nlib/         7 个模块（x）\n' })
  eq(r.exit, 1, '应报红；输出：\n' + r.stdout)
  ok(r.stdout.includes('文档写 7'), '要点名 7（低于下限 20 也必须查）；输出：\n' + r.stdout)
})

t('lib 模块数正确 ⇒ 绿；不传 --lib-modules 时跳过（不猜）', () => {
  const green = run({ po06Readme: '**100 项测试**\n\nlib/         30 个模块（x）\n' })
  eq(green.exit, 0, '与权威值一致应绿；输出：\n' + green.stdout)
})

// ── ④ 预算：错 ⇒ 红；对 ⇒ 绿；"全量/合计"语境跳过 ─────────────────────
t('预算数字与 plan-E001.json 不符 ⇒ 报红', () => {
  const r = run({ report: '# report\n\n> S1 上界 9999 / 期望 4000\n' })
  eq(r.exit, 1, 'exit 应为 1；输出：\n' + r.stdout)
  ok(r.stdout.includes('S1'), '应点出分期：\n' + r.stdout)
})

// ⚠ 这条是**回归守卫**：检查器原先把分期清单写死成 ['S1','S2','S3']，
// 于是 v2 追加的 **S4 从来没被检查过**（只提 S4 的行被静默 return 掉）。
// 与"分析器写死 S1 白名单"（EV-0113）同一个毛病的第二例。
t('**新追加的分期也要被检查**（回归：分期清单曾写死 S1–S3，S4 静默漏检）', () => {
  const bad = run({ report: '# report\n\n> S4 上界 7777 / 期望 3000\n' })
  eq(bad.exit, 1, 'S4 的数字写错必须报红（写死清单时会漏掉）；输出：\n' + bad.stdout)
  const good = run({ report: '# report\n\n> S4 上界 7000 / 期望 3000\n' })
  eq(good.exit, 0, 'S4 的数字正确时不该报；输出：\n' + good.stdout)
})

t('预算数字正确 ⇒ 绿；「全量」语境的数字跳过', () => {
  const r = run({ report: '# report\n\n> S1 上界 9000 / 期望 4000\n\n> 全量 18 题为期望 9999\n' })
  eq(r.exit, 0, '不应报红；输出：\n' + r.stdout)
  ok(r.stdout.includes('✅ 预算类数字'), '预算类应 ✅')
})

// ── ④b 源文件数也要查（它漂了很久没人发现：文档写 20、实际 24）────────────
t('「N 个源文件」过期 ⇒ 报红（这个数字此前完全没人查）', () => {
  const bad = run({ po06Readme: '# po06\n\n**100 项测试**\n\n**50 个变异跨 25 个源文件**\n' })
  eq(bad.exit, 1, '源文件数写成 25（权威 30）应报红；输出：\n' + bad.stdout)
  ok(/源文件数/.test(bad.stdout) || /个源文件/.test(bad.stdout), '应指出是哪一类：\n' + bad.stdout)
  const good = run({ po06Readme: '# po06\n\n**100 项测试**\n\n**50 个变异跨 30 个源文件**\n' })
  eq(good.exit, 0, '正确时不该报；输出：\n' + good.stdout)
})

// ── ⑤ 指向：不存在的路径 ⇒ 红；三类**不该报**的形态 ⇒ 绿 ────────────────
t('指向不存在的文件 ⇒ 报红并写出路径', () => {
  const r = run({ po06Readme: '# po06\n\n见 `no-such-file.md`。\n\n**100 项测试**\n' })
  eq(r.exit, 1, 'exit 应为 1；输出：\n' + r.stdout)
  ok(r.stdout.includes('no-such-file.md'), '应写出那个路径：\n' + r.stdout)
})

t('指向三类**不该报**的形态：存在的裸文件名 / 运行时配置名 / .tgz 构建产物', () => {
  const r = run({
    po06Readme: '# po06\n\n**100 项测试**\n\n'
      + '看 `release-check.json`（仓里有）、`po06.json` 与 `prompt-optimizer.json`（用户 home 里的配置）、'
      + '以及 `dsh-external-dsh-po06-0.6.0-beta.1.tgz`（构建产物）。\n',
  })
  eq(r.exit, 0, '三类都不该报；输出：\n' + r.stdout)
  ok(r.stdout.includes('✅ 指向'), '指向应 ✅')
})

// ── ⑥ 门面：根 README 缺当前版本号 ⇒ 红 ───────────────────────────────
t('根 README 没有当前 0.6 版本号 ⇒ 报门面问题', () => {
  const r = run({ rootReadme: '# repo\n\n这一页整页在讲另一条产品线。\n' })
  eq(r.exit, 1, 'exit 应为 1；输出：\n' + r.stdout)
  ok(r.stdout.includes('门面'), '应报门面问题：\n' + r.stdout)
  ok(r.stdout.includes(VERSION), '应写出期望的版本号：\n' + r.stdout)
})

// ── ⑦ 非 --strict 只提示、不影响退出码 ────────────────────────────────
t('不带 --strict 时只提示，退出码 0', () => {
  const repo = mkdtempSync(join(tmpdir(), 'po06-docs-'))
  DIRS.push(repo)
  const po06 = join(repo, 'po06')
  mkdirSync(join(po06, 'scripts'), { recursive: true })
  mkdirSync(join(po06, 'eval'), { recursive: true })
  copyFileSync(SCRIPT, join(po06, 'scripts', 'check-docs.mjs'))
  writeFileSync(join(po06, 'package.json'), JSON.stringify({ version: VERSION }), 'utf8')
  writeFileSync(join(po06, 'eval', 'release-check.json'), JSON.stringify(RC), 'utf8')
  writeFileSync(join(po06, 'eval', 'plan-E001.json'), JSON.stringify(PLAN), 'utf8')
  writeFileSync(join(repo, 'README.md'), VERSION, 'utf8')
  writeFileSync(join(po06, 'README.md'), '**99 项测试**', 'utf8')
  const stdout = execFileSync(process.execPath,
    [join(po06, 'scripts', 'check-docs.mjs'), '--suites', '1', '--pass', '100', '--mutants', '50'],
    { encoding: 'utf8', cwd: repo })
  ok(stdout.includes('文档写 99'), '应提示但退出 0：\n' + stdout)
})

// ── ⑩ 引文检查：引用了不存在的 EV 编号必须报红（EV-0128）──────────────────
// 为什么单独立一条：**这个检查的第一版是空的**——`statSync` 忘了 import，
// 每个文件都在那一行抛错、被 `catch { continue }` 吞掉 ⇒ 扫了 0 个文件却报 ✅。
// 也就是说：为了防"假证据"写的检查，自己先变成了一次假证据。
// 所以这里既测"能抓到假编号"，也测"不许在什么都没扫的情况下报通过"。
t('引文检查：引用不存在的 EV 编号 ⇒ 报红；引用存在的 ⇒ 绿', () => {
  const bad = run({ extraFile: { name: 'SOMEDOC.md', text: '# 文档\n\n见 ' + FAKE_EV + '。\n' } })
  eq(bad.exit, 1, '假编号必须报红；输出：\n' + bad.stdout)
  ok(bad.stdout.includes(FAKE_EV), '要点名那个编号：\n' + bad.stdout)
  ok(bad.stdout.includes('引文'), '要说明是引文问题：\n' + bad.stdout)

  const good = run({ extraFile: { name: 'SOMEDOC.md', text: '# 文档\n\n见 EV-0001。\n' } })
  eq(good.exit, 0, '存在的编号不该报；输出：\n' + good.stdout)
  ok(good.stdout.includes('✅ 引文'), '引文应 ✅：\n' + good.stdout)
})

t('引文检查：`### EV-0001 补充` 是延伸，**不算重复定义**', () => {
  const r = run({
    evidence: REAL_EVIDENCE + '\n\n### EV-0001 补充：更多细节\n\n- y\n',
    extraFile: { name: 'SOMEDOC.md', text: '见 EV-0001。\n' },
  })
  eq(r.exit, 0, '"补充"不该被当成重复定义；输出：\n' + r.stdout)
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-check-docs', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '把检查器复制进临时 fixture 树再跑：四条检查各自的红/绿，以及三类不该报的指向形态。不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
