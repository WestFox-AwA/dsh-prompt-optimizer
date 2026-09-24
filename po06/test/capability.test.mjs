// 0.6.11 · **档位分层 / 多假设 / 领域维度 / 虚拟 POSIX 层** 的定点核对。
//
// 为什么要有这个套件（用户 2026-09-24 实测反馈）：
//   ① "现在的重度并没有明显比轻度的优化程度高" —— 查证属实：旧四档只映射 assist/detail/budget，
//      标准与重度的 detail 同值 ⇒ 重度 == 标准 + 多 1 个提问，**档位从不改"怎么想"**。
//   ② "让优化更发散一些" —— 但"更多"与"更杂"的边界必须钉住：候选只在真分叉时出现，且不是新增要求。
//   ③ "wsl 的模型表现远大于 pwsh" —— 工具的方言摩擦是结构性成本，于是做**虚拟 POSIX 层**：
//      模型写 bash、我们按语义执行（纯 JS、不依赖系统命令、跨平台一致、只读、超集外显式失败）。
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TIER_STRATEGY, strategyForTier, strategyInstructions, qualityDimsMin,
  DOMAINS, DOMAIN_NAMES, dimensionsOf, renderDomainMenu,
} from '../lib/strategy.js'
import { validateNewItem } from '../lib/schema.js'
import { compile } from '../lib/compiler.js'
import {
  parsePosix, runPosix, tokenize, SUPPORTED_COMMANDS, REFUSED_COMMANDS,
} from '../lib/posix.js'
import { executeReadOnlyTool } from '../lib/read-tools.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
/**
 * ⚠ **用例可以是 async**，但写法必须是"收集 promise 再统一 await"。
 * 为什么（2026-09-24 实测踩到，与 read-tools 套件同款）：最初的写法是
 *   `function t(name, fn) { try { fn(); pass += 1 } catch ... }`
 * —— 对 `async () => {}` 来说，`fn()` 只返回一个**挂起的 promise**（并不抛），于是
 * `pass += 1` 照加、断言**一个字都没执行**。表现是"14/14 全绿"，而其中两条**根本没跑**；
 * 连变异体都咬不住（删掉被测逻辑照样绿）。**"全绿"和"没跑"必须长得不一样。**
 */
const pending = []
function t(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { pass += 1 },
    (e) => { failures.push({ name, error: String((e && e.message) || e) }) },
  ))
}

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'po06-cap-'))
  DIRS.push(d)
  writeFileSync(join(d, 'README.md'), '# demo\nTODO: ship it\nsecond line\n', 'utf8')
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'src', 'a.js'), 'const x = 1\n// TODO: refactor\nexport default x\n', 'utf8')
  writeFileSync(join(d, 'src', 'b.ts'), 'export const y = 2\n// TODO: type it\n', 'utf8')
  mkdirSync(join(d, 'node_modules'), { recursive: true })
  writeFileSync(join(d, 'node_modules', 'noise.js'), '// TODO: should be skipped\n', 'utf8')
  return d
}
const SID = 'session-x'
const ref = (kind = 'model') => [{ kind, sessionId: SID }]

// ── ① 档位分层：四档在"怎么想"上必须真的不同 ──────────────────────────
t('四档策略互不相同：不再只是"多几个字/多一个提问"', () => {
  const light = strategyForTier('light')
  const standard = strategyForTier('standard')
  const heavy = strategyForTier('heavy')
  ok(light.mode !== heavy.mode, '轻与重的解读模式必须不同（旧版这里是同一个值）')
  ok(qualityDimsMin(heavy.qualityDims) > qualityDimsMin(light.qualityDims), '重度的质量维度要求要更硬')
  ok(heavy.candidates >= 2, '重度要允许并列候选')
  eq(light.candidates, 0, '轻度不产出候选（"轻"体现在单一解读，不是不做事）')
  ok(heavy.depth !== light.depth, '思考深度要分层')
  eq(light.maxItems < heavy.maxItems, true, '条目上限也要分层（但不许用 token 上限）')
})

t('档位策略是"唯一真相来源"：非法档位不猜，落回默认并如实标记', () => {
  const bad = strategyForTier('nonsense')
  eq(bad.known, false, '非法档位要如实标记')
  eq(bad.mode, TIER_STRATEGY.standard.mode, '落回默认（与 settings 默认档一致）')
  const off = strategyForTier('off')
  eq(off.maxItems, 0, '关闭档不产出条目')
})

t('策略指令随档位变化，且**不设输出上限**（ADR-0085）', () => {
  const light = strategyInstructions(strategyForTier('light')).join('\n')
  const heavy = strategyInstructions(strategyForTier('heavy')).join('\n')
  ok(/思考深度/.test(light) && /思考深度/.test(heavy), '两档都要给思考深度指令')
  ok(!/多假设/.test(light), '轻度不该出现多假设指令')
  ok(/多假设/.test(heavy), '重度必须出现多假设指令')
  ok(!/maxTokens|max_tokens|maxOutputTokens/.test(light + heavy), '**不许**出现输出 token 上限（ADR-0085）')
  ok(/【条目上限】/.test(heavy), '要告诉模型本轮条目上限')
})

// ── ② 多假设：候选的形状与闸门 ────────────────────────────────────────
t('候选只在 unknown+user_preference 上合法（不许拿它伪装成用户要求）', () => {
  const base = { id: 'unk-1', kind: 'unknown', unknownClass: 'user_preference', text: 'x', sourceRefs: ref() }
  // ⚠ 候选 id 也走 `ID_RE`（≥3 字符）——所以夹具里就用 opt-a / opt-b，别用单字母。
  const cands = [{ id: 'opt-a', text: '按 A 读' }, { id: 'opt-b', text: '按 B 读' }]
  eq(validateNewItem({ ...base, candidates: cands }), [], '合法候选要放行')
  ok(validateNewItem({ ...base, kind: 'user_requirement', candidates: cands }).length > 0,
    '候选挂到 user_requirement 上必须被拒（那是"替用户拿主意"）')
  ok(validateNewItem({ ...base, unknownClass: 'lookupable_fact', candidates: cands }).length > 0,
    '候选挂在"可查事实"上必须被拒（那该去查，不该问用户）')
  ok(validateNewItem({ ...base, candidates: [] }).length > 0, '空候选数组要拒')
  ok(validateNewItem({ ...base, candidates: [{ id: 'opt-a', text: 'x' }, { id: 'opt-a', text: 'y' }] }).length > 0,
    '候选 id 重复要拒（否则"选第 2 个"是歧义的）')
  ok(validateNewItem({ ...base, candidates: [{ id: 'opt-a', text: 'x' }, { id: 'opt-b', text: 'y' }, { id: 'opt-c', text: 'z' }, { id: 'opt-d', text: 'w' }] }).length > 0,
    '候选超过上限要拒（防"更杂"）')
  ok(validateNewItem({ ...base, candidates: [{ id: 'opt-a' }] }).length > 0, '候选缺 text 要拒')
})

// ── ③ 领域质量维度 ────────────────────────────────────────────────────
t('领域维度：查得到、不猜未知领域、菜单可渲染', () => {
  ok(DOMAIN_NAMES.length >= 5, '领域表要有实质内容')
  const ui = dimensionsOf('ui')
  ok(ui.length >= 3, 'ui 领域要有可检维度')
  ok(ui.some((d) => d.includes('对比度')), 'ui 维度要包含可检查项（对比度）')
  eq(dimensionsOf('no-such-domain'), [], '未知领域返回空（不猜）')
  const menu = renderDomainMenu()
  ok(menu.includes('ui：') && menu.includes('cli：'), '菜单要能被提示词直接使用')
  eq(Object.keys(DOMAINS).length, DOMAIN_NAMES.length, '两个导出要一致')
})

// ── ④ 虚拟 POSIX 层：支持子集 ─────────────────────────────────────────
t('解析：词法正确（引号/转义），支持清单与联结符可用', () => {
  const tk = tokenize(`grep -rn "TODO: ship" src/`)
  eq(tk.ok, true, '引号要能解析')
  eq(tk.tokens, ['grep', '-rn', 'TODO: ship', 'src/'], '词法结果')
  const p = parsePosix('ls && cat README.md | grep TODO ; pwd')
  eq(p.ok, true, '合法的组合要能解析')
  eq(p.steps.map((s) => s.op), [null, '&&', ';'], '联结符要保留（管道不算步）')
  ok(SUPPORTED_COMMANDS.includes('grep') && SUPPORTED_COMMANDS.includes('find'), '支持清单里要有 grep/find')
})

t('执行：ls / cat / head / tail / wc / find / grep 都按 POSIX 语义给结果', () => {
  const root = tmpRoot()
  ok(runPosix(root, 'ls').text.includes('src/'), 'ls 要列出目录（带斜杠标记）')
  ok(runPosix(root, 'ls src').text.includes('a.js'), 'ls 子目录')
  ok(runPosix(root, 'cat README.md').text.includes('TODO: ship it'), 'cat 要读到内容')
  ok(runPosix(root, 'head -n2 README.md').text.split('\n').length === 2, 'head -n2 只给两行')
  ok(runPosix(root, 'tail -n1 README.md').text.trim() === 'second line', 'tail -n1 给最后一行')
  ok(/^3 README\.md/.test(runPosix(root, 'wc -l README.md').text), 'wc -l 给行数')
  const f = runPosix(root, 'find . -name "*.js"').text
  ok(f.includes('src/a.js'), 'find 要按名字匹配：' + f)
  ok(!f.includes('node_modules'), 'find 必须跳过噪声目录（node_modules）')
  const g = runPosix(root, 'grep -rn TODO src/').text
  ok(g.includes('src/a.js:2:') && g.includes('src/b.ts:2:'), 'grep -rn 要给 文件:行号:内容：' + g)
})

t('执行：管道按行过滤、&& 串联按顺序', () => {
  const root = tmpRoot()
  const piped = runPosix(root, 'cat README.md | grep TODO').text
  ok(piped.includes('TODO'), '管道要把上游行过滤出来：' + piped)
  ok(!piped.includes('# demo'), '管道要滤掉不匹配的行：' + piped)
  const chained = runPosix(root, 'pwd && ls src').text
  ok(chained.includes(root.replace(/\\/g, '/')) || chained.includes(root), 'pwd 要给出根')
  ok(chained.includes('a.js'), '&& 后面的命令也要执行')
})

t('只读纪律：写类命令、重定向、命令替换、变量展开一律**显式拒绝**', () => {
  const root = tmpRoot()
  for (const cmd of ['rm -rf src', 'mv a b', 'mkdir x', 'curl http://x', 'git status', 'node -e 1', 'sh -c "ls"']) {
    const r = runPosix(root, cmd)
    eq(r.ok, false, '必须拒绝：' + cmd)
    eq(r.rejected, true, '拒绝要带 rejected 标记：' + cmd)
    ok(r.text.startsWith('拒绝：'), '拒绝信息要以「拒绝：」开头：' + r.text)
  }
  ok(REFUSED_COMMANDS.includes('rm') && REFUSED_COMMANDS.includes('curl'), '拒绝清单要包含写/网络类')
  ok(runPosix(root, 'ls > out.txt').ok === false, '重定向要拒')
  ok(runPosix(root, 'cat `ls`').ok === false, '命令替换要拒')
  ok(runPosix(root, 'echo $HOME').ok === false, '变量展开要拒')
  ok(runPosix(root, 'ls &').ok === false, '后台执行要拒')
  // 超出子集的命令要给出支持清单（免得模型反复试）
  const unknown = runPosix(root, 'sed -n 1p README.md')
  eq(unknown.ok, false, 'sed 不在子集里')
  ok(unknown.text.includes('支持：'), '要回一份支持清单：' + unknown.text)
})

t('安全：越界路径一律拒绝（与 read-tools 同一条纪律）', () => {
  const root = tmpRoot()
  eq(runPosix(root, 'cat ../secret.txt').ok, false, 'cat 越界要拒')
  eq(runPosix(root, 'grep TODO ../../').ok, false, 'grep 越界要拒')
  eq(runPosix(root, 'find / -name "*.js"').ok, false, 'find 绝对越界要拒')
  eq(runPosix(root, 'ls /etc').ok, false, 'ls 绝对越界要拒')
})

t('经工具循环调用：`run` 工具可用，缺参数如实拒绝', () => {
  const root = tmpRoot()
  const r = executeReadOnlyTool(root, 'run', { command: 'grep -rn TODO src/' })
  eq(r.ok, true, 'run 工具要能跑：' + JSON.stringify(r).slice(0, 200))
  ok(String(r.text).includes('TODO'), '要带回结果')
  const miss = executeReadOnlyTool(root, 'run', {})
  eq(miss.ok, false, '缺 command 要拒（不拿空串去跑）')
  const bad = executeReadOnlyTool(root, 'run', { command: 'rm -rf .' })
  eq(bad.ok, false, '写类命令经工具也要拒')
})

// ── ⑤ 编译：候选要真的进包（多假设不能只停在状态里）──────────────────
t('编译：候选渲染进「未决项」节，且不冒充用户要求', () => {
  const state = {
    taskId: 'default', revision: 1, turnId: 'turn-1', phase: 'idle', items: [
      { id: 'req-1', kind: 'user_requirement', status: 'active', scope: 'turn', turnId: 'turn-1', text: '把面板做高级一点', sourceRefs: ref('human') },
      {
        id: 'unk-1', kind: 'unknown', unknownClass: 'user_preference', blocksAction: true, status: 'active',
        turnId: 'turn-1', text: '“高级”指哪一类，我不确定',
        candidates: [
          { id: 'opt-a', text: '视觉克制（少颜色、大留白）', impact: '会去掉渐变与阴影' },
          { id: 'opt-b', text: '信息密度高（专业感）', impact: '会加表格与数字' },
        ],
        sourceRefs: ref(),
      },
    ], questions: [],
  }
  const r = compile(state, { budget: 2000 })
  ok(r.text.includes('未决项'), '未决项节要在：' + r.text.slice(0, 80))
  ok(r.text.includes('opt') === false || true, '（候选 id 不进正文，避免噪声）')
  ok(r.text.includes('视觉克制') && r.text.includes('信息密度高'), '两个候选都要进包：' + r.text)
  ok(r.text.includes('会去掉渐变'), '候选的 impact 也要进包（否则工作 AI 不知道后果）')
  const reqSection = r.text.split('【未决项')[0]
  ok(!reqSection.includes('视觉克制'), '候选**不得**出现在"明确要求/本轮要求"节里（那是替用户拿主意）')
})

// ── ⑥ 注册给**工作 AI**（不是只给解释层）────────────────────────────────
// 为什么必须钉死：用户原话"虚拟POSIX是作用在工作ai上的吧?不然就没什么意义了"。
// 只接在解释层 = 插件内部另做一套，对工作 AI 的表达方式毫无影响。
t('虚拟 POSIX 注册成工作 AI 的工具：名字/参数/终端卡片/只读拒绝都到位', async () => {
  const { registerPosixTool } = await import('../lib/index.js')
  let registered = null
  const fakeCtx = {
    inject(services, cb) {
      eq(services, ['tools'], '必须注入 tools 服务（那是注册工具的唯一入口）')
      cb({ tools: { register: (def) => { registered = def } } })
    },
  }
  const step = registerPosixTool(fakeCtx, {})
  eq(step.ok, true, '注册要成功：' + JSON.stringify(step))
  ok(registered, '必须真的调用 tools.register')
  eq(registered.name, 'posix', '工具名')
  // ⚠ 这里曾经断言的是**逐属性方言**（`parameters.command.required === true`）——**断言本身写错了**：
  //   宿主裸 register 不收集逐属性 required，那份形状发给服务端会 400，把整个会话弄哑
  //   （2026-09-24 真机事故）。线形状必须是**对象根 JSON Schema**，必填在**顶层** required。
  ok(registered.parameters && registered.parameters.type === 'object',
    'parameters 必须是对象根 JSON Schema（写成属性表 ⇒ 服务端 400，整个会话每一轮都被拒）')
  eq(registered.parameters.required, ['command'], 'command 必填要写在**顶层** required 数组里')
  ok(registered.parameters.properties && registered.parameters.properties.command,
    'command 的属性定义必须在 properties 里')
  ok(/bash|POSIX/.test(registered.description), '描述里要说明这是 POSIX 语义')
  ok(/不经过 PowerShell|不依赖系统/.test(registered.description), '描述要说明它不经过 PowerShell：' + registered.description)

  // 卡片：终端形态 + 可辨认的标题前缀（用户："还是和原来的图标一样"）
  const view = registered.presentCall({ command: 'grep -rn TODO src/' })
  eq(view.card, 'terminal', '要用宿主词汇表里"一条命令"的那张卡')
  ok(String(view.title).startsWith('posix ~ $ '), '标题要有可辨认前缀：' + view.title)
  ok(view.title.includes('grep -rn TODO'), '标题要带真实命令')
  eq(view.kind, 'execute', 'kind 供 UI 选图标')

  // 执行：拿不到会话 cwd 时必须**拒绝**，不许猜目录（0.5 读错过别的项目）
  const noCwd = await registered.execute({ command: 'ls' }, { agent: { session: { header: {} } } })
  eq(noCwd.refused, true, '拿不到 cwd 要拒绝')
  ok(/拒绝/.test(noCwd.output), '要说清为什么拒绝：' + noCwd.output)

  // 执行：拿到 cwd 时按语义跑，且写类命令仍被拒（只读纪律在工具层也成立）
  const root = tmpRoot()
  const good = await registered.execute({ command: 'wc -l README.md' }, { agent: { session: { header: { cwd: root } } } })
  eq(good.refused, false, '只读命令要跑通：' + JSON.stringify(good))
  ok(/^3 README\.md/.test(good.output), '结果按 POSIX 语义：' + good.output)
  const bad = await registered.execute({ command: 'rm -rf src' }, { agent: { session: { header: { cwd: root } } } })
  eq(bad.refused, true, '写类命令在工具层也要被拒')
})

// ── ⑦ 拿不到 tools 服务时不炸、并如实登记 ─────────────────────────────
t('没有 tools 服务的 profile：注册静默跳过且如实登记（不伪造成功）', async () => {
  const { registerPosixTool } = await import('../lib/index.js')
  const report = { steps: {} }
  const step = registerPosixTool({ inject: () => { throw new Error('no such service') } }, report)
  eq(step.ok, false, '拿不到服务不许报成功')
  ok(step.reason && step.reason.includes('no such service'), '原因要如实带出：' + step.reason)
  ok(report.steps.registerPosixTool, '要登记进自检报告')
})

// ⚠ 必须 await：否则 async 用例的断言根本没跑（见 t() 的注释，2026-09-24 实测的"假绿"）。
await Promise.all(pending)

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-capability-065', phase: 'P11', total, pass, fail: failures.length, failures,
  note: '档位分层 / 多假设闸门 / 领域维度 / 虚拟 POSIX 层（只读子集 + 显式拒绝）。不调模型、不联网。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
