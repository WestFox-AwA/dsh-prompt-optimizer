// P4 · 澄清（回问）对照仪器（`scripts/audit-clarify.mjs`）的单测。
//
// 运行：node po06/test/audit-clarify.test.mjs
//
// 为什么给它配单测（EV-0136）：它是"问得有没有道理"这件事的**唯一仪器**，
// 而它自己刚刚暴露过一个测量陷阱——把"高置信（有问号）"与"低置信（仅措辞命中）"两桶
// 相加当问句数去比较两个臂（实测 A 14+11 / C 8+28，方向正好相反）。
// 所以这里既测**分类与解析**，也测**那条"必须分开报"的纪律本身**：
// 报表里必须同时出现两个桶，缺一个就等于又混起来了。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  DISPOSITIONS, classifyItem, parsePacket, parseUnitName, rubricFor,
} from '../scripts/audit-clarify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'audit-clarify.mjs')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/** 造 packets/units/holdout 三件套。 */
function fixture({ packets = {}, units = {}, holdout = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'po06-clarify-'))
  DIRS.push(root)
  const pd = join(root, 'packets'), ud = join(root, 'units')
  mkdirSync(pd, { recursive: true }); mkdirSync(ud, { recursive: true })
  for (const [name, text] of Object.entries(packets)) writeFileSync(join(pd, name), text, 'utf8')
  for (const [name, text] of Object.entries(units)) writeFileSync(join(ud, name), text, 'utf8')
  const hp = join(root, 'HOLDOUT.md')
  writeFileSync(hp, holdout, 'utf8')
  return { root, pd, ud, hp }
}

function run(fx, extra = []) {
  const args = [SCRIPT, '--packets', fx.pd, '--units', fx.ud, '--holdout', fx.hp, ...extra]
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1e7 })
  return { exit: r.status, stdout: String(r.stdout), stderr: String(r.stderr) }
}

// ── ① 纯函数：未决项的处置分类 ────────────────────────────────────────
t('classifyItem：三类处置按**措辞标记**判，且"查得到"优先于"自己定"', () => {
  eq(classifyItem('- “这个 CLI”指哪个项目——需要通过读取当前工作目录的代码与文档来确定，不要回问用户').key, 'no-ask', '查得到的')
  eq(classifyItem('- 非 TTY 下是否自动禁用颜色，属可逆实现细节，由工作 AI 自行决定。').key, 'decide-yourself', '可逆细节')
  eq(classifyItem('- 着色的覆盖范围未定：是全部输出着色，还是只给错误/警告着色。').key, 'ask', '会影响结果的 ⇒ 默认该问')
  // 顺序：一句话里同时出现两种标记时，必须先判"不要回问用户"（真实产物里两者常挨在一起）
  eq(classifyItem('- 先通过读取当前工作目录的代码来确定，不要回问用户；实在没有再由工作 AI 自行决定').key,
    'no-ask', '顺序不能反（否则误判成"自己定"）')
  eq(DISPOSITIONS.length, 2, '分类规则就是这两条（其余归 ask）')
})

t('parsePacket：只取【未决项…】小节里的条目，别的节不算', () => {
  const text = [
    '[插件辅助上下文 · 不是用户新增的命令]',
    '任务 H-12 · 意图修订 1。',
    '',
    '【明确要求】',
    '- 给这个 CLI 增加彩色输出。（来源：human msg:m-1）',
    '',
    '【建议（未采纳；请勿当作已确认需求）】',
    '- 建议配色在低对比终端下仍可读。（来源：model）',
    '',
    '【未决项（尚未确定，不要替我拍板）】',
    '- 这个 CLI 指哪个项目——需要通过读取当前工作目录来确定，不要回问用户。（来源：model）',
    '- 着色的覆盖范围未定：全部还是只给错误/警告。（来源：model）',
    '- 非 TTY 行为属可逆实现细节，由工作 AI 自行决定。（来源：model）',
  ].join('\n')
  const items = parsePacket(text)
  eq(items.length, 3, '只有未决项小节里的 3 条')
  eq(items.map((x) => x.disposition), ['no-ask', 'ask', 'decide-yourself'], '处置分类')
  ok(items[0].marker && items[0].marker.length > 0, '要留下命中的原话，便于人工核对：' + JSON.stringify(items[0]))
  eq(items[1].marker, null, 'ask 类没有标记')
})

t('parsePacket：没有未决项小节 ⇒ 空数组（不是报错）', () => {
  eq(parsePacket('【明确要求】\n- 把 private 改成 true。\n'), [], '完全没有未决项')
  eq(parsePacket(''), [], '空文本')
})

t('parseUnitName：只认 <题>-<臂>-r<次>，其余返回 null', () => {
  eq(parseUnitName('H-12-C-r3.md'), { taskId: 'H-12', arm: 'C', run: 3 }, '正常命名')
  eq(parseUnitName('H-07-A-r1.md'), { taskId: 'H-07', arm: 'A', run: 1 }, 'A 臂')
  eq(parseUnitName('notes.md'), null, '不规范命名 ⇒ null')
  eq(parseUnitName('H-12-C-r3.txt'), null, '非 .md ⇒ null')
})

t('rubricFor：摘出留出集里**事先写好**的判据行（不摘下一题）', () => {
  const holdout = [
    '**H-07**',
    '> 把 `package.json` 里的 `"private"` 从 `false` 改成 `true`。',
    '',
    '**H-12 · 影响结果的取舍**',
    '> 给这个 CLI 加上彩色输出。',
    '',
    '（判据：「彩色」用哪些颜色、哪些信息上色会影响结果；',
    '而用哪个颜色库属可逆实现细节。理想行为：问前者、自定后者。）',
    '',
    '**H-13 · 改口与撤回**',
    '> 三轮对话：…',
  ].join('\n')
  const h12 = rubricFor(holdout, 'H-12')
  ok(h12.includes('理想行为'), 'H-12 的判据必须被摘到：' + h12)
  ok(!h12.includes('三轮对话'), '不得跨到下一题：' + h12)
  const h07 = rubricFor(holdout, 'H-07')
  ok(h07.includes('private'), 'H-07 摘到题目行：' + h07)
  eq(rubricFor(holdout, 'H-99'), null, '没有这道题 ⇒ null')
})

// ── ② 端到端：报表必须**分开报两个桶**（这就是那条纪律）────────────────
const PACKET_H12 = [
  '【未决项（尚未确定，不要替我拍板）】',
  '- 这个 CLI 指哪个项目——需要通过读取当前工作目录来确定，不要回问用户。（来源：model）',
  '- 着色的覆盖范围未定：全部还是只给错误/警告着色。（来源：model）',
  '- 非 TTY 行为属可逆实现细节，由工作 AI 自行决定。（来源：model）',
].join('\n')

t('端到端：报表里高置信与低置信**同时**出现，且给出可复现的 JSON', () => {
  const fx = fixture({
    packets: { 'H-12.md': PACKET_H12, 'H-07.md': '【明确要求】\n- 把 private 改成 true。\n' },
    units: {
      // 高置信 1 条（句尾 ?）+ 低置信 1 条（仅措辞）
      'H-12-C-r1.md': '这个覆盖范围要哪些?\n1. 录一次加载瀑布：有没有重复请求、请求是否串行',
      'H-07-C-r1.md': '改法如下：把 false 改成 true。',
    },
    holdout: '**H-12 · 影响结果的取舍**\n> 加彩色输出。\n\n（判据：哪些信息上色影响结果。理想行为：问前者、自定后者。）\n',
  })
  const jsonPath = join(fx.root, 'out.json')
  const r = run(fx, ['--json', jsonPath])
  eq(r.exit, 0, '应正常退出；输出：\n' + r.stdout + r.stderr)
  ok(/高置信（有问号）1/.test(r.stdout), '高置信桶要单独报：\n' + r.stdout)
  ok(/低置信（仅措辞）1/.test(r.stdout), '低置信桶要单独报：\n' + r.stdout)
  ok(r.stdout.includes('该问用户 1'), '包声明的处置要按类计数：\n' + r.stdout)
  ok(r.stdout.includes('理想行为'), '要把留出集事先写好的判据摆在台面上：\n' + r.stdout)
  const j = JSON.parse(readFileSync(jsonPath, 'utf8'))
  eq(j.tasks.find((x) => x.taskId === 'H-12').packet.byClass, { 'no-ask': 1, 'decide-yourself': 1, ask: 1 }, 'JSON 里的分类计数')
  eq(j.tasks.find((x) => x.taskId === 'H-12').arms.C[0].explicit, 1, 'JSON 里高置信计数')
})

t('端到端：包里没有未决项却在问 ⇒ 出一条"值得看一眼"（不是结论）', () => {
  const fx = fixture({
    packets: { 'H-07.md': '【明确要求】\n- 把 private 改成 true。\n' },
    units: { 'H-07-C-r1.md': '这里要不要加空行？\n请确认这一点。' },
    holdout: '**H-07**\n> 改 private。\n',
  })
  const r = run(fx)
  eq(r.exit, 0, '提示不影响退出码')
  ok(r.stdout.includes('asked-when-nothing-undecided'), '要出这条提示：\n' + r.stdout)
  ok(r.stdout.includes('不是结论'), '必须写明它不是结论：\n' + r.stdout)
})

t('端到端：声明了"要用户拍板"却一次都没问 ⇒ 出一条"值得看一眼"', () => {
  const fx = fixture({
    packets: { 'H-12.md': PACKET_H12 },
    units: { 'H-12-C-r1.md': '我按默认做法改好了：全部输出去着色。', 'H-12-C-r2.md': '同上，已改完。' },
    holdout: '**H-12 · 影响结果的取舍**\n> 加彩色输出。\n',
  })
  const r = run(fx)
  eq(r.exit, 0, '提示不影响退出码')
  ok(r.stdout.includes('silent-when-undecided'), '要出这条提示：\n' + r.stdout)
})

t('端到端：有答案但没有对应意图包 ⇒ 如实记 packet-missing（不假装判断过）', () => {
  const fx = fixture({
    packets: {},
    units: { 'H-12-C-r1.md': '要哪些颜色？' },
    holdout: '**H-12 · 影响结果的取舍**\n> 加彩色输出。\n',
  })
  const r = run(fx)
  ok(r.stdout.includes('packet-missing'), '要如实记：\n' + r.stdout)
  ok(r.stdout.includes('缺'), '报表里该题要写"缺"：\n' + r.stdout)
})

t('什么都没读到 ⇒ 退出码 2（"无从审计" ≠ "审计通过"）', () => {
  const fx = fixture({})
  const r = run(fx)
  eq(r.exit, 2, '应为 2；输出：\n' + r.stdout + r.stderr)
  ok(/无从审计/.test(r.stderr), 'stderr 要说明无从审计：' + r.stderr)
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-audit-clarify', phase: 'P4', total, pass, fail: failures.length, failures,
  note: '澄清机制对照仪器：留出集判据 / 包声明的处置 / 实际问了什么（高置信与低置信分开）。不做条目与问句的自动匹配。不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
