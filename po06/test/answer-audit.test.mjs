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
  auditQuestions, renderQuestionAudit, classifyQuestion, isQuestion,
  IMPLEMENTATION_MARKERS, PREFERENCE_MARKERS,
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

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-answer-audit', phase: 'P7', total, pass, fail: failures.length, failures,
  note: '只做事实抽取与分类，不做质量判定；假阳性类别（关于意图包自身的说明）需人读。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
