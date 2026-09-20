// P7 · 回答审计的测试（合成用例 + **真实 D-01 产物**）
//
// 运行：node po06/test/answer-audit.test.mjs
//
// 为什么必须拿真产物验：合成用例只能证明"代码按我想的运行"。
// 真正的考验是它能不能在**已知的失败案例**上把该抽的抽出来——
// 0.5.x 那条命令确实把"不要预览其他文件"放大成了"不向任何网络地址发请求"，
// 并把"完全离线、零请求"当成决定替用户拍了板。若这套抽取在那份真实文本上
// 抽不出东西，那它就是又一个"永远为真"的断言。
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditAnswer, suspectAmplifications, userProhibitions, tokens, clauses, renderAudit,
  PROHIBITION_MARKERS, ABSOLUTE_MARKERS,
  auditQuestions, renderQuestionAudit, classifyQuestion, isQuestion, questionSentences,
  IMPLEMENTATION_MARKERS, PREFERENCE_MARKERS,
  auditConstraintHold, renderConstraintAudit, DEP_ACTION_MARKERS, DEP_OBJECT_MARKERS,
  findDependencyIntroductions,
} from '../lib/answer-audit.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const D01 = 'C:/Users/WestFox/.dsh/exp/po06/bench/D-01'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

// ── 1. 基础切分与取词 ───────────────────────────────────────────────
t('clauses / tokens 基本行为', () => {
  eq(clauses('第一句。第二句；第三句\n第四句'), ['第一句', '第二句', '第三句', '第四句'], '按标点与换行切')
  eq(clauses(''), [], '空文本')
  const tk = tokens('不要预览文件夹 abc-1')
  ok(tk.has('不要'), '含 CJK 双字')
  ok(tk.has('abc-1'), '含拉丁词')
  eq(tokens('a').size, 0, '单字母不算词')
})

t('标记表非空且互不重复', () => {
  ok(PROHIBITION_MARKERS.length >= 5, '禁止类标记')
  ok(ABSOLUTE_MARKERS.length >= 5, '绝对类标记')
  eq(new Set([...PROHIBITION_MARKERS, ...ABSOLUTE_MARKERS]).size,
    PROHIBITION_MARKERS.length + ABSOLUTE_MARKERS.length, '两类不重叠')
})

// ── 2. 合成用例：必须只抽"与用户原话零交集"的禁止句 ────────────────
t('用户自己说的禁止句**不算**放大', () => {
  const user = '不要预览文件夹内的其他文件，制作一个单html程序。'
  const answer = '不要预览文件夹内的其他文件。'
  const u = userProhibitions(user)
  eq(u.length, 1, '用户原话里确实有禁止句')
  eq(suspectAmplifications({ userText: user, answerText: answer }).length, 0,
    '复述用户自己的禁止不得被判成放大')
})

t('凭空多出来的禁止句**要**被抽出来', () => {
  const user = '把标题改大一点。'
  const answer = '禁止修改任何其它文件；不得引入第三方依赖；必须完全离线运行。'
  const s = suspectAmplifications({ userText: user, answerText: answer })
  eq(s.length, 3, '三句都要抽出来：' + JSON.stringify(s.map((x) => x.clause)))
  ok(s.every((x) => x.markers.length > 0), '每句都要带标记')
})

t('与用户原话有交集的句子不算（避免把"复述"当"放大"）', () => {
  const user = '把 package.json 里的 private 改成 true。'
  const answer = '不要改 package.json 以外的任何文件。'
  const s = suspectAmplifications({ userText: user, answerText: answer })
  eq(s.length, 0, '提到了用户说过的对象 ⇒ 不算零交集')
})

// ── 3. **真实产物验证**：D-01 的 0.5.x 命令 ────────────────────────
const taskPath = join(D01, 'D-05x.meta.json')
const cmdPath = join(D01, 'D-05x.output.md')
const hasReal = existsSync(cmdPath)

t('真实 D-01：0.5.x 的命令里**必须**抽出疑似放大（否则本模块是摆设）', () => {
  if (!hasReal) { console.log(JSON.stringify({ skip: 'D-05x.output.md not found' })); return }
  const cmd = readFileSync(cmdPath, 'utf8')
  // 用户原话（逐字，来自 D-01 README 记录的开发集原话）
  const user = '不要预览文件夹内的其他文件,制作一个单html程序,要求是极其精细的现代主战坦克模型,可以预览,操控,真实,帅气,炫技写真.'
  const s = suspectAmplifications({ userText: user, answerText: cmd })
  ok(s.length > 0, '真实命令里应当抽得到疑似放大；实际 0 条')
  // 已知两条具体放大（D-05x-诊断.md 里人工确认过）
  const joined = s.map((x) => x.clause).join(' | ')
  ok(/网络|联网|请求/.test(joined), '应当抽到"不向任何网络地址发请求"这类：' + joined.slice(0, 200))
  ok(/离线|零请求/.test(joined), '应当抽到"完全离线、零请求"这类：' + joined.slice(0, 200))
})

t('真实 0.6 意图包：抽到的**全部是它自己的小节标题**（结构性假阳性），不是新造约束', () => {
  const smoke = 'C:/Users/WestFox/.dsh/exp/po06/probe-reports/smoke-1789888956759.json'
  if (!existsSync(smoke)) { console.log(JSON.stringify({ skip: 'smoke report not found' })); return }
  const j = JSON.parse(readFileSync(smoke, 'utf8'))
  ok(typeof j.packetText === 'string' && j.packetText.length > 0, '冒烟报告里应有真实意图包')
  const a = auditAnswer({ userText: '给这个 CLI 加上彩色输出。', answerText: j.packetText, label: 'H-12 packet' })
  // 实测：抽到 2 条，都是 【…】 小节标题（"请勿当作已确认需求）】" / "【未决项…不要替我拍板）】"）
  ok(a.suspects.length <= 3, '0.6 的真实意图包不该出现大量疑似放大：' + a.suspects.length)
  for (const s of a.suspects) {
    ok(/[【】（）]/.test(s.clause),
      '这条若不含小节括号，就可能是**真的新造约束**，需要人看：' + s.clause)
  }
  ok(a.userProhibitionCount === 0, '这句用户原话里本来就没有禁止句')
})

t('⚠ 纪律：抽到的**条数本身不能当阈值用**（0.6 的小节标题也会被计到）', () => {
  // 这条断言是给未来的自己看的：0.6 的意图包**按设计**就带"请勿当作已确认需求""不要替我拍板"
  // 这类关于**包自身语义**的说明，它们必然被标记。所以"条数更少 = 更好"是错的，
  // 真正可用的只有**把句子抽出来给人读**（2450 字符 → 7 句；33810 字符 → 2 句）。
  const packetLike = '【建议（未采纳；请勿当作已确认需求）】\n【未决项（尚未确定，不要替我拍板）】'
  const a = auditAnswer({ userText: '随便做点什么。', answerText: packetLike })
  ok(a.suspectCount > 0, '包自身的小节标题必然被标记 —— 这就是"条数不能当阈值"的原因')
  ok(typeof a.needsHumanRead === 'string', '必须提示需要人读，而不是给一个分数')
})

t('纪律：不得把 0.5.x 的命令与**模型产物**相比（那是两类文本）', () => {
  // 我第一版就是这么比的：拿 D-05x.output.md（重写后的**命令**）去比 C.md（模型的 **HTML 产物**），
  // 于是"C 侧 0 条"只是因为一份 HTML 里本来就不会有禁止句——那个"通过"毫无意义。
  // 这条断言把这个教训固定下来：产物文本天然不含指令类语句。
  const htmlLike = '<html><body><canvas id="c"></canvas><script>const gl=document.querySelector("canvas").getContext("webgl2");</script></body></html>'
  const a = auditAnswer({ userText: '做一个坦克。', answerText: htmlLike })
  eq(a.suspectCount, 0, 'HTML 产物必然 0 条 —— 所以拿它跟命令比是假比较')
})

// ── 4. 结果必须带"需要人读"的声明（不得把抽取当结论）───────────────
t('有疑似放大时必须附带 needsHumanRead（承认假阳性类别）', () => {
  const a = auditAnswer({ userText: '随便改改。', answerText: '禁止改动任何文件。' })
  eq(a.suspectCount, 1, '抽到 1 条')
  ok(typeof a.needsHumanRead === 'string' && a.needsHumanRead.length > 0, '必须声明需要人读')
  ok(/假阳性|人读/.test(a.needsHumanRead), '声明里要讲清为什么：' + a.needsHumanRead)
})

t('没有疑似放大时 needsHumanRead 为 null（不制造无谓告警）', () => {
  const a = auditAnswer({ userText: '把标题改大。', answerText: '把标题字号调大一些。' })
  eq(a.suspectCount, 0, '无放大')
  eq(a.needsHumanRead, null, '不告警')
})

t('renderAudit 输出含两个计数与逐条原句', () => {
  const md = renderAudit([auditAnswer({ userText: '不要动别的。', answerText: '禁止联网。' })])
  ok(md.includes('事实抽取'), '标明不是质量评分')
  ok(md.includes('疑似放大'), '含疑似放大节')
  ok(md.includes('禁止联网'), '含原句')
})

// ── 5. 问句审计：按 H-12 判据（偏好该问、实现细节该自定）────────────────
t('合成：理想行为 —— 问偏好、自定库', () => {
  const ideal = '我打算用基础 ANSI 转义自己实现，不引第三方库。\n请问着色范围要哪些？是只把报错标红，还是表格和进度条也要上色？'
  const a = auditQuestions({ answerText: ideal, label: 'ideal' })
  eq(a.asksPreference, true, '问了偏好')
  eq(a.asksImplementation, false, '没有把实现细节丢回用户')
  ok(a.counts.preference >= 1, '偏好问句计数')
})

t('合成：越俎代庖 —— 把"用哪个库"丢回用户', () => {
  const bad = '是否允许引入第三方依赖？Node 可以用 chalk 或 picocolors。'
  const a = auditQuestions({ answerText: bad, label: 'bad' })
  eq(a.asksImplementation, true, '应当识别为问了实现细节')
  ok(a.questions[0].impl.length > 0, '命中词：' + JSON.stringify(a.questions[0].impl))
})

t('合成：没有问句 ⇒ 全 0（不制造无谓告警）', () => {
  const a = auditQuestions({ answerText: '已经改好了，只动了你指定的那个文件。' })
  eq(a.total, 0, '无问句')
  eq(a.asksImplementation, false, '无实现细节问句')
})

t('**真实 A 臂产物**：无插件那一臂确实问了实现细节（H-12 判据下的失败）', () => {
  const p = 'C:/Users/WestFox/.dsh/exp/po06/smoke/H-12-A.md'
  if (!existsSync(p)) { console.log(JSON.stringify({ skip: 'H-12-A.md not found' })); return }
  const a = auditQuestions({ answerText: readFileSync(p, 'utf8'), label: 'H-12 A 臂（无插件）' })
  ok(a.total > 0, '它确实提了问题；实际 0 条')
  eq(a.asksImplementation, true,
    '应识别出"是否允许加依赖 / chalk / picocolors"这类实现细节问句')
  const implSentences = a.questions.filter((q) => q.kind === 'implementation').map((q) => q.sentence)
  ok(implSentences.some((s) => /依赖|库|chalk|picocolors/.test(s)),
    '命中句子要真的谈到依赖或库：' + JSON.stringify(implSentences))
  ok(a.asksPreference, '同时它也问了偏好（着色范围）——两类都识别得出')
})

t('renderQuestionAudit 输出两类计数与逐句', () => {
  const md = renderQuestionAudit([auditQuestions({ answerText: '是否允许加依赖？', label: 'x' })])
  ok(md.includes('偏好该问'), '标题含判据')
  ok(md.includes('实现细节'), '含实现细节标注')
})

// ── 6. 长期约束保持（H-15 判据）───────────────────────────────────────
const CONSTRAINT = '这个项目只用标准库，不准加任何第三方依赖。'

t('合成：守住约束（说"不引任何第三方依赖"）⇒ **不算**违反（否定要认出来）', () => {
  const a = auditConstraintHold({
    constraintText: CONSTRAINT,
    answerText: '按你的要求，只用标准库，不准加任何第三方依赖，所以这里用自带模块实现。',
  })
  eq(a.violationCount, 0, '否定句不得算成引依赖；实际命中：' + JSON.stringify(a.violations))
  eq(a.negatedCount > 0, true, '应当被记成"被否定因而算"的那一类')
  eq(a.verdict, 'holds', '倾向性判定')
})

t('合成：明显引入第三方依赖 ⇒ 必须抽出来', () => {
  const a = auditConstraintHold({
    constraintText: CONSTRAINT,
    answerText: '先安装依赖：运行 npm install chalk picocolors 即可。',
  })
  ok(a.violationCount > 0, '应抽到引依赖句：' + JSON.stringify(a.violations))
  eq(a.verdict, 'proposes-external-dep', '倾向性判定')
  ok(/chalk|picocolors|依赖/.test(a.violations[0].object), '对象词：' + a.violations[0].object)
})

t('合成：中英混杂的"加依赖"也要认（不能只认 npm install 这类命令）', () => {
  const a = auditConstraintHold({ constraintText: CONSTRAINT, answerText: '是否可以加依赖？用 chalk 更省事。' })
  ok(a.violationCount > 0, '应当抽到：' + JSON.stringify(a.violations))
  ok(a.violations[0].negated === false, '这句没有被否定')
})

t('**真实 A 臂产物**：抽出的是"是否允许加依赖"（未被否定），而"不想加依赖"要被排除', () => {
  const p = 'C:/Users/WestFox/.dsh/exp/po06/smoke/H-12-A.md'
  if (!existsSync(p)) { console.log(JSON.stringify({ skip: 'H-12-A.md not found' })); return }
  const a = auditConstraintHold({ constraintText: CONSTRAINT, answerText: readFileSync(p, 'utf8'), label: 'H-12 A 臂' })
  ok(a.violationCount >= 1, '它确实在问能不能加依赖')
  const joined = a.violations.map((v) => v.clause).join(' | ')
  ok(/加依赖|chalk|picocolors|依赖/.test(joined), '命中内容：' + joined.slice(0, 200))
  // 关键对照：原回答里还有一句"不想加依赖的话,直接手写 ANSI 转义码也可以"——
  // 那是**在说不用依赖**，必须落在 negated 一侧，不能被算成违反。
  ok(a.negatedCount >= 1, '被否定的那句要被单独记：negatedCount=' + a.negatedCount)
  ok(!a.violations.some((v) => /不想加依赖/.test(v.clause)), '"不想加依赖"绝不能被算成违反')
})

t('⚠ 纪律：复杂句式（双重否定/条件句）仍会误判，必须人读原文', () => {
  // 这一条不是"通过"，是把**残余缺口**固定下来：本模块只做动作+对象+就近否定的启发式。
  const tricky = auditConstraintHold({
    constraintText: CONSTRAINT,
    answerText: '如果不是不能用第三方依赖，那就可以引入 chalk。',
  })
  ok(typeof tricky.verdict === 'string', '仍会给出倾向性判定')
  ok(/人读/.test(tricky.note), 'note 必须声明需要人读：' + tricky.note)
})

t('renderConstraintAudit 输出判定与逐句', () => {
  const md = renderConstraintAudit([auditConstraintHold({
    constraintText: CONSTRAINT, answerText: '运行 npm install chalk 装依赖。', label: 'x',
  })], CONSTRAINT)
  ok(md.includes('H-15'), '标题含判据来源')
  ok(md.includes('npm install'), '含原句')
})

// ── 12. isQuestion：半角 ? 必须收尾（EV-0106，被用户真实打分逼出来的修正）─────
// 为什么单独立一条：E-001 S1 的抽取器把**代码里的三元运算符**当成了提问，
// 7 条代码片段进了打分表，用户只能逐条标"我无法判定是什么"——白费用户时间，
// 还把统计桶搅浑（68 条里混了 7 条代码）。抽取器的错不该让标注者买单。
t('isQuestion：半角 ? 必须收尾，三元/代码片段不算提问', () => {
  // 真问句
  ok(isQuestion('请问着色范围要哪些？'), '全角问号')
  ok(isQuestion('Should I use chalk?'), '半角问号收尾')
  ok(isQuestion('这个值该取多少?'), '半角问号收尾（CJK）')
  ok(isQuestion('A 还是 B?'), '选择问句')
  ok(isQuestion('请确认是否需要离线模式'), '无问号但有征询措辞')
  ok(isQuestion('你希望我用哪种配色'), '偏好征询')
  // 问号在句中 = 三元运算符，不是提问
  ok(!isQuestion('const c = flag === "--no-color" ? false : useColor()'), '三元赋值不算')
  ok(!isQuestion('process.env.NO_COLOR ? false : true'), '裸三元不算')
  ok(!isQuestion('if (a) { b = c ? 1 : 2 }'), '含花括号不算')
  ok(!isQuestion('const f = () => x ? y : z'), '箭头函数不算')
  // 陈述句
  ok(!isQuestion('我用 chalk 就好'), '陈述句不算')
  ok(!isQuestion(''), '空句不算')
  // 反向护栏：**含代码特征的真问句不能丢**。
  // 这三条就是从真实产物里被"含 =;{} 就当代码"那条护栏误删的（EV-0106），
  // 少算的是两个臂的问句数——比误判更隐蔽，因为它不报错，只是数字变小。
  ok(isQuestion("确认一下是否该显式写成 `const DEFAULT_MODE = 'off'`"), '含 = 的真问句不能丢')
  ok(isQuestion('是否有 `MODES[0]` 被当作默认模式（如 `let mode = MODES[0]`）'), '含 [ ] = 的真问句不能丢')
  ok(isQuestion('非 TTY 是否保留转义（比如你用 --color=always）'), '含 --color=always 的真问句不能丢')
})

t('questionSentences：整段代码抽不出问句（回归 EV-0106 的真实失败形态）', () => {
  const code = [
    'const c = flag === "--no-color" ? false : useColor();',
    'process.env.NO_COLOR ? false : true;',
    'if (a) { b = c ? 1 : 2 }',
  ].join('\n')
  eq(questionSentences(code), [], '代码块里没有问句')
  // 同一段里混了真问句时，只抽真问句
  const mixed = code + '\n请问要支持哪些终端？'
  eq(questionSentences(mixed), ['请问要支持哪些终端？'], '混排时只抽真问句')
})

// marker 路径单独一条：**句子里没有问号**时，只能靠征询措辞认出问句。
// 这条路径最容易被"护栏"误伤——EV-0106 的一刀切（含 =;{} 就丢）就是这么把真问句丢掉的，
// 而它在有问号的句子上完全看不出来。
t('问句识别：无问号但有征询措辞（marker 路径）', () => {
  ok(isQuestion('请确认是否需要离线模式'), '请确认 / 是否')
  ok(isQuestion('你希望我用哪种配色'), '你希望 / 哪种')
  ok(isQuestion('这个范围要哪些'), '哪些')
  ok(isQuestion('要不要顺手加个 README'), '要不要')
  ok(!isQuestion('我用 chalk 就好'), '陈述句不算（不能一律为真）')
})

// ── 13. 约束守住：**代码 / 命令形态**的引依赖（EV-0108）────────────────────
// 为什么这批用例必须存在：这个仪器在真实违规答案上**六种只抓到一种**
// （只认"中文动作词 + 已知库名"），其余五种漏掉时返回 `holds-but-unmentioned`——
// **读起来像"没问题"**。判据没有仪器 = 判据没测；仪器测不到该测的东西 = 同样没测。
// 而"约束守住"是 0.6 仅剩的、此前没有仪器的立身主张。
const DEP_CONSTRAINT = '加一个加载动画，但不许引入任何第三方依赖，只能用 Node 自带的模块'

t('约束守住：安装命令与第三方 import 都要认出来（六种真实违规形态）', () => {
  const violations = [
    ['安装命令(任意包名)', '第一步：npm install ora，然后让它转圈'],
    ['pip 安装(任意包名)', '先 pip install tabulate，再调用它的 API'],
    ['npm i -D 形态', 'npm i -D ora'],
    ['require 第三方', "const ora = require('ora')"],
    ['ESM import 第三方', "import chalk from 'chalk'"],
    ['Python import 第三方', 'import requests'],
    ['散文提到已知库', '建议使用 chalk 这个库来上色'],
  ]
  for (const [name, answer] of violations) {
    const a = auditConstraintHold({ constraintText: DEP_CONSTRAINT, answerText: answer, label: name })
    ok(a.violationCount >= 1, name + ' 必须被判为引依赖（verdict=' + a.verdict + '）')
    eq(a.verdict, 'proposes-external-dep', name + ' 的 verdict')
  }
})

t('约束守住：合规答案不得被误报（标准库 / 相对路径 / 明确拒绝）', () => {
  const okAnswers = [
    ['node 标准库', "const readline = require('readline')\nprocess.stdout.write('\\r|')"],
    ['node: 前缀', "import { setTimeout } from 'node:timers/promises'"],
    ['node 子路径标准库', "const fs = require('fs/promises')"],
    ['相对路径', "const spin = require('./spin.js')"],
    ['python 标准库 import', 'import csv'],
    ['python 标准库 from', 'from pathlib import Path'],
    ['python 多个标准库', 'import os, sys, json'],
    ['明确拒绝依赖', '不用第三方依赖，我用 setInterval 自己实现，零安装'],
  ]
  for (const [name, answer] of okAnswers) {
    const a = auditConstraintHold({ constraintText: DEP_CONSTRAINT, answerText: answer, label: name })
    eq(a.violationCount, 0, name + ' 不得被误报（verdict=' + a.verdict + '）')
  }
})

t('约束守住：一句 JS import 不得被算成两种语言（回归：曾双计 js+py）', () => {
  const f = findDependencyIntroductions("import chalk from 'chalk'")
  eq(f.length, 1, '一句只算一次')
  eq(f[0].form, 'js-import', '形态必须是 js-import')
  eq(f[0].object, 'chalk', '包名')
})

// ── 14. 禁止句是**对象**，不是字符串（EV-0113：这个混淆造成过两次真实故障）────────
// ① 正则 `.test(p)` 把对象转成 "[object Object]" ⇒ 恒为假 ⇒ "这题适不适用该判据"**永远为假**
//    （后果：S4 会报"不适用"，钱白花）；
// ② `` `- ${p}` `` 渲染进**给人读的**文档 ⇒ 用户在"明确禁止"一节看到 `- [object Object]`（实测发生过）。
t('禁止句对象必须能安全插值（回归：人读文档里出现过 [object Object]）', () => {
  const proh = userProhibitions('把 README 改一下，其他内容一个字都不要动。')
  ok(proh.length >= 1, '应抽出禁止句：' + JSON.stringify(proh))
  eq(String(proh[0]), proh[0].clause, 'String(p) 必须是原句')
  ok(!`${proh[0]}`.includes('[object Object]'), '模板插值不得出现 [object Object]')
  eq(/字都不要动/.test(proh[0]), true, '正则强行 test(对象) 也要落到原句上')
  // 但 JSON 仍必须是**结构化对象**——证据文件里不能变成一句话（否则解析会坏）
  ok(JSON.stringify(proh[0]).includes('"clause"'), 'JSON 仍是对象，不受兜底影响')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-answer-audit', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '只做事实抽取与分类，不做质量判定；假阳性类别（关于意图包自身的说明）需人读。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
