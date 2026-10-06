// P9.3 · 客户端面板（`lib/client.js`）的**静态守卫**测试。
//
// 运行：node po06/test/client-file.test.mjs
//
// 为什么用静态守卫而不是"渲染测试"：客户端文件在浏览器里跑，本仓库没有前端测试运行器；
// 而它最容易犯的三类错**都是静态可查的**，且每一类都是 0.5 用真实事故换来的：
//   ① 语法/格式错（模块加载器那种 IIFE 包装，写错就整块 UI 不出现）；
//   ② 忘了单例闸门或忘了释放注册 ⇒ HMR 后"旧实例替新实例干活"，界面全消失（0.5 的 issue）；
//   ③ 写操作漏带 `x-po06` 头 ⇒ 被控制 API 的信任判据 403，界面上表现为"保存不了"。
// 另外钉住：**声明必须与 package.json 的 dsh.client 一致**（装了却不被服务 = 用户看不到界面）。
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT = join(ROOT, 'lib', 'client.js')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const src = existsSync(CLIENT) ? readFileSync(CLIENT, 'utf8') : ''
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

t('浅色模式：显式浅色规则必须存在、且排在深色之后（同权重靠顺序决胜）', () => {
  const { mod } = loadClientModule()
  const css = mod.__debug.themeTokensCss()
  const lightSelf = css.indexOf("data-po06][data-po06-theme=\"light\"]")
  const darkAncestor = css.indexOf("data-ds-dark-theme] [data-po06]")
  ok(lightSelf > 0, '要有 [data-po06][data-po06-theme="light"] 这条显式浅色规则')
  ok(css.includes('[data-po06-theme="light"] [data-po06]'), '也要覆盖「标记在祖先上」的情形')
  ok(lightSelf > darkAncestor, '浅色规则必须排在深色之后，否则压不过同权重的祖先深色规则')
  // 顾问卡片此前漏了主题订阅 ⇒ 切浅色后不重渲染、标记停在 dark（用户看到的「只有黑色模式」）
  const advisorAt = src.indexOf('function AdvisorToolRow(props)')
  const nextFn = src.indexOf('\n    function ', advisorAt + 1)
  const body = src.slice(advisorAt, nextFn > 0 ? nextFn : advisorAt + 4000)
  ok(/useThemeLive\(\)/.test(body), '顾问卡片必须订阅主题变化（否则切浅色不生效）')
})

// ── ① 文件存在 + 语法可解析 + 模块加载器格式正确 ──────────────────────
t('client.js 存在、语法通过、用宿主的模块加载器格式注册且 id 与包名一致', () => {
  ok(src.length > 0, 'client.js 必须存在且有内容')
  // 语法：node --check 能解析（它引用了 window，但只解析不执行）
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' })
  ok(/window\.__ModuleLoader__\.load\(\{/.test(src), '必须是 __ModuleLoader__.load({...}) 形式')
ok(new RegExp("id:\\s*'" + pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(src), 'load 的 id 必须与 package.json 的 name 一致（改名最容易漏的一处：漂移会让整条 entry 装配失败）')
  ok(/factory:\s*\(require\)\s*=>/.test(src), '必须是 factory(require) 形式')
  ok(/require\('react'\)/.test(src), '宿主页面提供 react，用 require 取')
  ok(/return module\.exports/.test(src), '必须返回 module.exports')
})

t('package.json 声明了 dsh.client，且 exports["./client"] 指向客户端文件', () => {
  const c = pkg.dsh && pkg.dsh.client
  ok(c && typeof c === 'object', '必须声明 dsh.client（否则 dsh-client-modules 不会服务这个文件）')
  eq(c.platform, 'web', '平台必须是 web')
  // ⚠ **这条是 beta.6 在真机上静默失效的根因**（EV-0141）：宿主用 `clientExportOf(exports["./client"])`
  // 解析客户端产物；没有这个子路径 ⇒ 插件被**静默**从注入清单里略过——
  // 页面照常渲染、控制 API 照常工作，只是**界面永远不出现**，且没有任何报错。
  const exp = pkg.exports && pkg.exports['./client']
  ok(exp, 'package.json 必须有 exports["./client"]（否则客户端不被服务）')
  const rel = typeof exp === 'string' ? exp : exp.default
  eq(rel, './lib/client.js', 'exports["./client"] 必须指向 ./lib/client.js')
  ok(pkg.exports['./cordis.patch.yml'], 'bundle 层也要能被解析（与 0.5 的可用样本一致）')
  ok(Array.isArray(c.inject) && c.inject.includes('@deepseek-ai/dsh-client-runtime')
    && c.inject.includes('@deepseek-ai/dsh-client-ui-slots'),
  'inject 必须是宿主提供的客户端包名（照 0.5 的可用样本），不是服务名：' + JSON.stringify(c.inject))
  const declared = /exports\.inject\s*=\s*\[([^\]]*)\]/.exec(src)
  ok(declared, '客户端必须导出 inject')
  ok(/slots/.test(declared[1]), '客户端 inject 里要有 slots：' + declared[1])
  ok(pkg.files.includes('lib'), 'lib 必须在 files 里（否则 client.js 不进包）')
})

// ── ② 三条纪律（各自对应 0.5 的一次真实事故）──────────────────────────
t('单例闸门：抢注 token 且在**每次挂载前复核**（只在 apply 时判一次等于没判）', () => {
  ok(/__PO06_ACTIVE__/.test(src), '必须有 window.__PO06_ACTIVE__ 这个闸门')
  ok(/const isLive = \(\) =>/.test(src), '必须有 isLive() 复核函数')
  ok(/if \(!isLive\(\)\) return null/.test(src), 'attach 里必须在注册前复核（拿不到 token 就不注册）')
  // ⚠ 反面：第一版是"先抢注、再判 isActiveInstance()"——那一刻 token 必然是自己刚写的，
  // 于是这个判断恒真、闸门形同不存在（EV-0142 的教训之一）。
  // 精确化：禁的是**抢注那一行之后紧接着自判**；P11 的拦截处理函数里复核 `isActiveInstance()`
  // 是**正确用法**（事件到达时 token 可能已易主），不能一并禁掉——所以判据只看抢注点附近。
  // 抢注那一行的**空白不参与判据**：它后来被包进 try 里，写法变过、行为没变。
  const claim = /window\.__PO06_ACTIVE__\s*=\s*INSTANCE_TOKEN/.exec(src)
  ok(claim, '找不到抢注那一行')
  const claimAt = claim.index
  const after = src.slice(claimAt, claimAt + 200)
  ok(!/\n\s*if \(!isActiveInstance\(\)\) return/.test(after), '抢注后紧接着自判 = 无效闸门（EV-0142）')
  ok(/if \(!isLive\(\)\) return null/.test(src), 'attach 前的复核仍必须在（isLive）')
})

t('功能：更新实例抢走 token 后，旧实例的**重挂**不再注册（HMR 后不会双份）', () => {
  const win = {}                            // ← 两个实例必须看**同一个** window
  const first = loadClientModule(win)       // 第一个实例（模拟 HMR 前的旧实例）
  // P10：挂载点从 `conversation.input.dock` **搬到** `conversation.input.left`（原来是"新增一个"，
  // 现在是"换过去"，所以总数仍是 3：input.left + shell.overlay + settings.plugins.tab）
  eq(first.calls.filter((c) => c.def).length, 6, '第一个实例先注册了 5 个')
  const second = loadClientModule(win)      // 第二个实例抢注 token
  eq(second.calls.filter((c) => c.def).length, 6, '第二个实例也注册 5 个（最新获胜）')
  // 旧实例的"自愈重挂"再跑一次：因为 token 已被第二个实例抢走，**不得**再注册
  const remount = first.mod.__debug && first.mod.__debug.remount
  eq(typeof remount, 'function', '要有可驱动的重挂钩子（__debug.remount）')
  const after = first.calls.filter((c) => c.def).length
  remount('conversation.input.left')
  eq(first.calls.filter((c) => c.def).length, after, '旧实例不得再注册（否则页面出现双份/劫持）')
})

t('卸载即净：所有注册都进 own(...)，apply 返回一个统一释放函数', () => {
  ok(/const own\s*=/.test(src), '要有 own() 收集释放函数')
  ok(/mount\(/.test(src), '插槽注册要走 mount()（它负责登记释放）')
  ok(/return dispose/.test(src), 'apply 必须返回释放函数')
  ok(/mounts\[slot\]/.test(src), '重挂前要释放上一次的注册（slot 按 id 去重，重复注册会抛）')
})

t('写操作必须带 x-po06 头（否则被控制 API 的信任判据 403）', () => {
  ok(/x-po06/.test(src), '必须出现 x-po06')
  eq(/'x-po06':\s*'1'/.test(src), true, '值必须是 1')
  // 所有 POST 都必须走 apiPost（它统一带头），不得自己裸 fetch POST
  const raw = src.match(/fetch\([^)]*\)/g) || []
  const posts = raw.filter((x) => /method:\s*'POST'/.test(x))
  eq(posts.length, 1, '只允许 apiPost 里那一处 POST：' + JSON.stringify(posts))
  ok(/WRITE_HEADERS/.test(posts[0]), 'POST 必须带 WRITE_HEADERS')
})

t('界面锚点：关键节点带 data-po06 标记（真机验证靠它，不靠"应该会出现"）', () => {
  // P10：`dock`（小胶囊）已被控件栏替换 ⇒ 换成 `bar`，并钉住一排控件的标记
  // 要求②（2026-09-21）：`?` 帮助按钮与弹层也要有锚点（help-btn / help-pop / help-body / help-close）
  // ⚠ `items` 锚点已按用户要求撤掉（详情面板不再有"它在替我做什么"板块）；
  //    "无出处"这条诚实信号挪到拦截审查面板（intercept-unsourced），下面的诚实性断言仍然钉着它。
  for (const anchor of ['bar', 'ctx', 'ctx-mode', 'readtools', 'model', 'help-btn', 'help-pop', 'help-close',
    'panel', 'controls', 'turns', 'prompt', 'settings']) {
    ok(src.includes("'data-po06': '" + anchor + "'") || src.includes('"data-po06": "' + anchor + '"'),
      '缺少界面锚点 data-po06=' + anchor)
  }
  // 用户 2026-09-21 的三条界面要求，逐条钉住
  // （判据钉"有没有这个板块/组件"，不钉字面量——注释里提它的来历是允许的。）
  ok(!/S\.h \}, '它在替我做什么'/.test(src), '详情面板里不得再有"它在替我做什么"板块')
  ok(!/h\(ItemsList/.test(src), 'ItemsList 已删（不留死代码）')
  ok(/h\('span', \{\}, L\('详情', 'Details'\)\)/.test(src), '入口按钮文字必须是「详情」')
  ok(/'data-po06': 'state-dot'/.test(src), '「详情」必须保留灰绿状态灯（state-dot）')
  ok(/mode: historyMode/.test(src), '上下文滑块必须知道自己是"回合"还是"全文"模式')
  ok(/'data-po06-value': on \? 'on' : 'off', 'data-po06-mode': 'full'/.test(src),
    '全文模式的滑块只有关/开两格')
  // 控件栏两层化（要求①）：两行的锚点都在，且外层是 column（不是一条直线）
  ok(/'data-po06': 'bar-row-1'/.test(src), '第一层锚点 bar-row-1')
  ok(/'data-po06': 'bar-row-2'/.test(src), '第二层锚点 bar-row-2')
  ok(/flexDirection: 'column'/.test(src), '控件栏外层必须竖排两层（否则会被发送按钮顶上去）')
  // 分段控件的标记是**拼出来的**：静态源码里是 `name`，运行期 DOM 上是
  // tier / tier-off / tier-light / tier-standard / tier-heavy 与 perm / perm-review / perm-auto。
  ok(/name:\s*'tier'/.test(src), '档位分段控件必须叫 tier（DOM 上是 tier / tier-<值>）')
  ok(/name:\s*'perm'/.test(src), '优化权限分段控件必须叫 perm（DOM 上是 perm / perm-<值>）')
  ok(/'data-po06':\s*name\s*\+\s*'-'\s*\+\s*k/.test(src), '分段项必须是 name + "-" + 值（tier-off 这类）')
})

// 要求②（2026-09-21）：`?` 帮助的正文只有一个真相来源（包里的 HELP-0.6.md），
// 客户端**不内置副本**；同时钉住"这份文件必须进包"——否则真机上弹层只会显示"读不到"。
t('「?」帮助：正文来源是 HELP-0.6.md，文件在 files 白名单里，且带用户可见区间标记', () => {
  ok(/apiGet\('\/help(\?|')/.test(src), '客户端要读宿主的 /help（不要内置副本）')
  ok(!/节 1 · 怎么用/.test(src), '客户端里不得内置帮助正文副本（会和文档分叉）')
  const files = Array.isArray(pkg.files) ? pkg.files : []
  ok(files.includes('HELP-0.6.md'), 'package.json 的 files 必须带上 HELP-0.6.md（否则装完读不到）')
  const help = readFileSync(join(ROOT, 'HELP-0.6.md'), 'utf8')
  ok(help.includes('<!-- po06:help-start'), 'HELP-0.6.md 必须带用户可见区间标记 po06:help-start')
})

// 英文适配（2026-09-22）：界面语言只跟 DSH 的语言设置走，**没有插件自己的语言开关**。
// 帮助正文同样要跟着切：`?lang=en` 必须真的把宿主切到英文文件，且英文文件要进包。
t('英文适配：帮助按 lang 切英文文件、英文文件进包并带同一区间标记', () => {
  ok(/apiGet\('\/help\?lang='/.test(src), '客户端要按 DSH 语言给 /help 传 lang')
  ok(/LOCALE\s*===\s*'en'\s*\?\s*'en'\s*:\s*'zh'/.test(src), '语言取值只能来自 DSH 的 LOCALE（不另设插件语言开关）')
  // ⚠ 真机契约（别再猜形状）：DSH 客户端 `dsh-client-locale/lib/client.js:1374` 是
  //   `ctx.provide("locale", locale)` —— `ctx.locale` 是 **LocaleFace 实例**，语言在
  //   `getSnapshot().active`（'zh' | 'en'）里，另有 `subscribe(fn)` 供切语言时重渲染。
  //   第一版按 `v.locale/v.name/v.id/v.language` 猜属性 ⇒ 真机上永远读不到 ⇒ 恒中文（英文适配等于没做）。
  ok(/getSnapshot\(\)/.test(src) && /\.active/.test(src), '要从 LocaleFace 的 getSnapshot().active 读当前语言')
  ok(!/v\.locale \|\| v\.name \|\| v\.id \|\| v\.language/.test(src), '不许再按猜出来的属性名读语言（真机上恒为空）')
  ok(/subscribe\(/.test(src), '要订阅 locale 变化，DSH 里切语言时界面即时切换')
  const files = Array.isArray(pkg.files) ? pkg.files : []
  ok(files.includes('HELP-0.6.en.md'), 'package.json 的 files 必须带上 HELP-0.6.en.md（否则英文用户读不到）')
  const helpEn = readFileSync(join(ROOT, 'HELP-0.6.en.md'), 'utf8')
  ok(helpEn.includes('<!-- po06:help-start'), 'HELP-0.6.en.md 必须带同一区间标记 po06:help-start')
  // 去注释后仍不该有成段中文：允许极少量（作者署名等专名），但正文/标题不得整段是中文。
  const body = helpEn.replace(/<!--[\s\S]*?-->/g, '')
  const zhCount = (body.match(/[\u4e00-\u9fff]/g) || []).length
  ok(zhCount < 40, `英文帮助正文里不得夹中文正文（当前中文字符 ${zhCount} 个）`)
  ok(!/^#{1,6}\s.*[\u4e00-\u9fff]/m.test(body), '英文帮助的标题不得是中文')
})

// P11：前置拦截（"第一轮发，第一轮就回"）。静态守卫钉住**四条不变量**——
// 它们每一条都对应一种"用户消息被吞掉 / 假装在拦"的失败形态，光靠真机点一次抓不全。
// ── ③1 主题：浅色模式必须看得清（用户 2026-09-22 附浅色截图："根本看不清"）──────────
// 判据不是"有没有加一条浅色覆盖"，而是**颜色由主题驱动**：一份 token 表、两套取值，
// 底色与文字永远成对取自同一套 ⇒ 结构上不可能再出现"深字压黑底"。
// 这里用 WCAG 对比度**机器算一遍**：正文 ≥ 4.5:1，标签/说明 ≥ 3:1（两套主题都算）。
function srgb(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function lum(hex) {
  const h = String(hex).trim()
  const m = /^#([0-9a-f]{6})$/i.exec(h)
  if (!m) throw new Error('contrast helper needs #rrggbb, got ' + h)
  const n = parseInt(m[1], 16)
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255]
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg)
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

t('浅色/深色两套主题：正文与标签的对比度都必须够（机器算 WCAG，不靠肉眼）', () => {
  const { mod } = loadClientModule()
  const tokens = mod.__debug && mod.__debug.themeTokens
  ok(tokens && tokens.light && tokens.dark, '必须有浅色/深色两份 token 表（__debug.themeTokens）')
  for (const name of ['light', 'dark']) {
    const p = tokens[name]
    // 只算能直接比较的纯色（rgba 叠加请见下面的"必须用颜色而不是 opacity"那条守卫）
    const pairs = [
      ['fg/surface（面板正文）', p.fg, p.surface, 4.5],
      ['fg2/surface（次要正文）', p.fg2, p.surface, 4.5],
      ['fg3/surface（标签/说明）', p.fg3, p.surface, 3.0],
      ['cap/surface（最小字号说明）', p.cap, p.surface, 3.0],
      ['fg/surface2（审查框正文）', p.fg, p.surface2, 4.5],
      ['err/surface（错误行）', p.err, p.surface, 3.0],
      ['warn/surface（告警行）', p.warn, p.surface, 3.0],
    ]
    for (const [what, fg, bg, min] of pairs) {
      const r = ratio(fg, bg)
      ok(r >= min, `${name} 主题 ${what} 对比度 ${r.toFixed(2)} < ${min}（浅色模式的"看不清"就是这么来的）`)
    }
  }
})

t('主题：token 落在 [data-po06] 上，深色由 DSH 的 data-ds-dark-theme 覆盖；内联样式只引用 var(--po06-*)', () => {
  const { mod } = loadClientModule()
  const css = mod.__debug.themeTokensCss()
  ok(/\[data-po06\]\{/.test(css), '默认（浅色）一套要挂在 [data-po06] 上')
  ok(/\[data-ds-dark-theme\] \[data-po06\]\{/.test(css), '深色要由 DSH 的主题属性覆盖：' + css.slice(0, 120))
  // 内联样式里不许再出现"写死的深色底"（黑底 + 浅色主题的深字 = 用户截图里那块读不出来的区域）
  // ⚠ 只看**代码**：上面那两处在注释里（它们正是"为什么改成 token"的说明），不是写法。
  const codeOnly = src.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\/\/.*$/, '')).join('\n')
  ok(!/background:\s*'rgba\(20,20,20/.test(codeOnly), '思维层底色不许再写死深色')
  ok(!/var\(--dsw-alias-bg-l1/.test(codeOnly), '下拉/审查框底色不许再依赖取不到的 DSH 变量（本机取不到 ⇒ 深色兜底 ⇒ 深字压深底）')
  ok(/themeAttrs\(\)/.test(src), '根元素要带主题标记 data-po06-theme（DSH 换主题表达式时也能兜住）')
  ok(/data-ds-dark-theme/.test(src), '主题判定要认 DSH 自己的信号')
  ok(/useThemeLive\(\)/.test(src), '要订阅主题变化：在 DSH 里切深浅色时界面即时跟着换')
  // 文字不许靠 opacity 压暗（浅色底上 opacity:.6 直接变成看不清的浅灰）
  for (const bad of [/optLabel: \{[^}]*opacity/, /optSummary: \{[^}]*opacity/, /muted: \{[^}]*opacity/]) {
    ok(!bad.test(src), '标签/说明文字要用 token 颜色，不许用 opacity 压暗：' + String(bad))
  }
})

t('主题信号：深色属性宿主挂在 body 上；变量也从 body 读；都读不到按浅色（不是深色）', () => {
  const { mod } = loadClientModule()
  const f = mod.__debug.themeIsDark
  ok(typeof f === 'function', '要有 __debug.themeIsDark 供单测钉契约')
  const savedDoc = globalThis.document
  const savedGCS = globalThis.getComputedStyle
  const setup = ({ bodyDark = false, htmlDark = false, cs = '', label = '' } = {}) => {
    const el = (dark) => ({
      hasAttribute: (n) => n === 'data-ds-dark-theme' && dark,
      closest: () => null,
    })
    globalThis.document = { documentElement: el(htmlDark), body: el(bodyDark) }
    globalThis.getComputedStyle = () => ({ colorScheme: cs, getPropertyValue: () => label })
  }
  try {
    // ① 宿主把 `data-ds-dark-theme` 挂在 **body** 上（ThemePresenter 的 DARK_ATTRIBUTE）——只看 html 会漏判
    setup({ bodyDark: true, label: '#17171a' })
    eq(f(), true, 'body 上有深色属性 ⇒ 深色（哪怕文字变量读起来像浅色）')
    // ② 根上的 color-scheme 也是权威信号
    setup({ cs: 'dark' }); eq(f(), true, 'color-scheme:dark ⇒ 深色')
    setup({ cs: 'light' }); eq(f(), false, 'color-scheme:light ⇒ 浅色')
    // ③ 文字色亮度兜底
    setup({ label: '#ececf1' }); eq(f(), true, '亮文字 ⇒ 深色主题')
    setup({ label: '#17171a' }); eq(f(), false, '暗文字 ⇒ 浅色主题')
    // ④ **都读不到 ⇒ 浅色**（旧实现是 `return true`：宿主把变量放在 body 上、从 html 读到的就是空
    //    ⇒ 浅色模式被判成深色 ⇒ 整套深色 token ⇒ 用户看到的"浅色跟深色没区别"）
    setup({})
    eq(f(), false, '没有任何信号时按浅色（与 DSH boot 默认一致），绝不能默认深色')
  } finally {
    if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc
    if (savedGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = savedGCS
  }
})

t('主题 token 的 CSS：必须同时覆盖"标记在自身"与"标记在祖先"（否则深面板里会嵌浅块）', () => {
  const { mod } = loadClientModule()
  const css = mod.__debug.themeTokensCss()
  ok(/\[data-po06\]\{[^}]*--po06-surface:#ffffff/.test(css), '默认（浅色）一套必须在最前')
  ok(/\[data-po06\]\[data-po06-theme="dark"\]\{[^}]*--po06-surface:#1b1b1d/.test(css), '深色要覆盖"标记在自身"（面板/弹层这些根元素）')
  ok(/\[data-po06-theme="dark"\] \[data-po06\]\{[^}]*--po06-surface:#1b1b1d/.test(css),
    '深色还要覆盖"标记在祖先"——插件里的思维层/折叠体**各自**带 data-po06，会各自重新声明浅色 token：'
    + '只写自身那条 ⇒ 深色面板里嵌一块浅底（真机实测症状）')
  ok(/\[data-ds-dark-theme\] \[data-po06\]\{/.test(css), '还要认 DSH 自己的深色属性')
  ok(css.indexOf('--po06-surface:#ffffff') < css.indexOf('--po06-surface:#1b1b1d'), '浅色在前、深色在后（同级时后者胜）')
})

t('P11 前置拦截：捕获阶段接管、没有放行通道就不拦、失败必放行、去重、关闭档不拦', () => {
  for (const anchor of ['intercept', 'intercept-skip', 'intercept-confirm', 'intercept-original',
    'intercept-regen', 'intercept-text', 'intercept-elapsed']) {
    ok(src.includes("'data-po06': '" + anchor + "'"), '缺少拦截界面锚点 data-po06=' + anchor)
  }
  // ① 捕获阶段（true 是第三个参数）：必须早于 React 根容器与编辑器自身处理器
  ok(/addEventListener\('keydown', onKey, true\)/.test(src), 'keydown 必须在捕获阶段挂')
  ok(/addEventListener\('click', onClick, true\)/.test(src), 'click 必须在捕获阶段挂')
  ok(/removeEventListener\('keydown', onKey, true\)/.test(src), '卸载时必须摘掉监听（HMR 后旧实例不得再拦）')
  // ② 没有 inputActions ⇒ 绝不武装（拦下却放不出去 = 吞消息）
  ok(/const canArm = !!\(inputActions && typeof inputActions\.submit === 'function' && sessionId\)/.test(src),
    'canArm 必须同时要求 inputActions.submit 与 sessionId')
  // 判据更新（2026-10-06）：关闭档**在英文模式下**仍要能拦（英文模式不依赖提示词辅助档位），
  // 但"没通道 / 状态未知"这两条底线一个字都不放松——那是吞消息的唯一来源。
  ok(/if \(!canArm \|\| [^|]*\|\| !data\) return undefined/.test(src), '没通道/状态未知 ⇒ 不挂监听')
  ok(/tierOff&&!englishOn/.test(src), '关闭档只在英文模式下仍可拦截，其余情况不挂监听')
  ok(/'data-po06-actions': canArm \? '1' : '0'/.test(src), '能不能拦必须做成真机可读的标记（否则"以为在拦"）')
  // ③ fail-open：拿不到包也必须**有个交代**，而且**审查档绝不自动发送**。
  //    ⚠ 两条断言都是"真机反馈"的回锚：
  //      · "拦不住"——原因不能吞（早先写法最终只剩"已发送"，用户看不到为什么）；
  //      · "审查模式几秒后还是把原文发出去了"——fail-open 只能在**自动**档做。
  ok(/const settleFailure = \(text, h, why\) => \{/.test(src), '必须有统一的失败收场函数')
  ok(/if \(permissionRef\.current === 'review'\) \{/.test(src), '审查档：失败必须停在面板里等用户决定（不自动发送）')
  ok(/phase: 'error', reason: why/.test(src), '审查档失败要进 error 态并带上原因')
  ok(/settleFailure\(text, h, reasonText\(\(r && r\.reason\) \|\| 'unknown'\)\)/.test(src), '失败原因要人话化后交给收场函数')
  ok(/按原文发出/.test(src), '审查态必须给"按原文发出"这个出口')
  // ④ 去重：同一次发送可能同时命中 Enter 与 click（0.5 的 coalesced）。
  //    计数必须在 beginHold 的**去重之后**加，否则"本会话已拦截 N 次"会虚高。
  ok(/holdRef\.current\) return/.test(src), '必须用 ref 去重（state 在同一事件循环里还没生效）')
  ok(/setInterceptCount\(\(n\) => n \+ 1\)/.test(src), '计数存在')
  eq((src.match(/setInterceptCount\(\(n\) => n \+ 1\)/g) || []).length, 1,
    '计数只允许在 beginHold 里去重之后加一次（事件处理函数里再加会翻倍）')
  // ⑤ 命令（/xxx）与空草稿交还官方
  // 0.8：斜杠命令**默认仍交还官方**，只有名单内且宿主确认已注册的才放行（判定见纯函数那条用例）。
  ok(/if \(t\.startsWith\('\/'\) && !slashAllowedDraft\(t\)\) return 'slash-command'/.test(src), '斜杠命令默认交还官方，名单内已注册的才拦')
  ok(/slashActive/.test(src) && /data\.slashReview/.test(src), '放行名单必须来自宿主 /status.slashReview（不能自己猜命令表）')
  ok(/if \(!draftNow\(\)\) return 'empty-draft'/.test(src), '空草稿不拦（那时主按钮是"停止生成"）')
  // ⑥ 诊断可见：真机上要能分辨"监听器没挂上"与"判定放行了"（两者修法完全不同）
  ok(/data-po06-seen/.test(src) && /data-po06-lastpass/.test(src), '必须暴露"看见几个事件/最后一次为什么放行"')
})

t('控件栏挂在 conversation.input.left（id=prompt-optimizer, order=20），浮层与设置页不动', () => {
  ok(src.includes("'conversation.input.left'"), '输入区左侧的控件栏（P10：对齐 0.5 的操作形态）')
  ok(src.includes("'shell.overlay'"), '浮层槽')
  ok(src.includes("'settings.plugins.tab'"), '设置页')
  // 旧的小胶囊**不再挂载**（"胶囊 + 一排控件"同时出现只会更乱）
  ok(!/mount\('conversation\.input\.dock'/.test(src), '不再挂载 conversation.input.dock')
  ok(/mount\('conversation\.input\.left',\s*'prompt-optimizer',\s*20,/.test(src),
    "input.left 的 id/order 必须是 'prompt-optimizer' / 20")
})

// ── ③ 安全与边界 ─────────────────────────────────────────────────────
t('不用 dangerouslySetInnerHTML / document.write；接口路径固定为 /po06/api', () => {
  ok(!/dangerouslySetInnerHTML/.test(src), '不得用 dangerouslySetInnerHTML（React 默认转义是我们唯一的 XSS 防线）')
  ok(!/document\.write/.test(src), '不得用 document.write')
  ok(!/innerHTML/.test(src), '不得直接写 innerHTML')
  ok(/const API = '\/po06\/api'/.test(src), '接口前缀必须与宿主注册的一致')
  ok(!/http:\/\/(?!127\.0\.0\.1)/.test(src), '不得请求外部地址')
})

t('对缺服务/坏数据要稳：ctx.slots 缺失时不抛、读状态失败要在界面上说', () => {
  ok(/!ctx\.slots/.test(src), '要判 ctx.slots 是否可用')
  ok(/读状态失败/.test(src), '读失败必须显示出来（不许静默空白）')
})

t('未出处条目在界面上必须被标出来（不许悄悄混进"你说过"）', () => {
  ok(/unsourced/.test(src), '要识别 unsourced')
  ok(/无出处/.test(src), '要显示"无出处"')
  ok(/这是缺陷/.test(src), '无出处是缺陷，界面上要说清')
})

// ── ④ **功能性**验证：在 Node 里真的"加载"一次客户端文件并跑 apply ────────
// 为什么必须有这一条（EV-0142）：静态 grep 全都通过，而真机 DOM 里 **一个元素都没注册**——
// 因为注册函数被塞进了释放列表却**从未被调用**。grep 抓不住"这行代码有没有被执行"。
// 做法：给它一个假的 window.__ModuleLoader__ 与极简 react 桩，捕获 factory，
// 再用假 ctx 跑 apply，断言"三个插槽真的被 register 了、返回的释放函数真的能摘掉"。
// 做成可以**共享同一个 window** 的加载器：单例闸门只有在两个实例看同一个 window 时才谈得上
// （第一版夹具每次新建 window，于是"抢 token"根本没发生，测试假绿——见 EV-0142）。
function makeWindow() {
  return { __ModuleLoader__: { load: (reg) => { if (!Array.isArray(this_patched)) { /* noop */ } } } }
}
function loadClientModule(sharedWindow, reactOverride, ctxExtras, ctxOverride) {
  const calls = []
  const win = sharedWindow || {}
  win.__regs = win.__regs || []
  if (!win.__ModuleLoader__) win.__ModuleLoader__ = { load: (reg) => { win.__regs.push(reg) } }
  const reactStub = reactOverride || {
    createElement: () => null, Fragment: 'Fragment',
    useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(),
  }
  const fakeRequire = (name) => (name === 'react' ? reactStub : {})
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', src)(win, fakeRequire)
  const reg = win.__regs[win.__regs.length - 1]
  ok(reg && typeof reg.factory === 'function', '必须注册一个 factory')
  const mod = reg.factory(fakeRequire)
  const ctx = ctxOverride || {
    slots: {
      register: (def, Comp) => { calls.push({ def, Comp }); return () => { calls.push({ disposed: def.name }) } },
      inject: (slot, cb) => cb(),
    },
    ...(ctxExtras || {}),
  }
  const dispose = mod.apply(ctx)
  return { calls, dispose, ctx, mod, fakeWindow: win }
}

// ── ③0 真机崩溃的回归守卫（2026-09-22：用户看到 "Failed to load plugins" 白屏）──────
// cordis 对**未 inject 的服务 getter 是抛错**：`Error: cannot get property "locale" without inject`。
// 客户端 apply 里读 `ctx.locale`（语言适配）却没在 `exports.inject` 里声明 ⇒ 客户端 entry 进 FAILED
// ⇒ 引导层整页白屏。两条守卫：① 静态——读过的服务必须都声明；② 运行时——在没有 locale 服务的
// ctx（访问即抛）下 apply 仍要成功注册（最坏用中文兜底，绝不整页崩）。
t('崩溃回归①：客户端读过的每个服务都必须在 exports.inject 里声明', () => {
  const declared = /exports\.inject\s*=\s*\[([^\]]*)\]/.exec(src)
  ok(declared, '找不到 exports.inject')
  const list = declared[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  // 只统计"代码里的服务读取"：去掉注释行与行内注释
  const code = src.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\/\/.*$/, '')).join('\n')
  const used = new Set()
  for (const m of code.matchAll(/ctx\.([A-Za-z_]\w*)/g)) used.add(m[1])
  for (const name of used) ok(list.includes(name), `读服务 ctx.${name} 但没在 exports.inject 里声明（真机会抛 cannot get property "${name}" without inject）`)
  ok(list.includes('slots'), 'slots 必须声明')
  ok(list.includes('locale'), 'locale 必须声明（英文适配要读它）')
})

function cordisLikeCtx(services, calls) {
  // 照 cordis 的语义：未声明的服务**读就抛**；声明的照常给。
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (calls && prop === 'slots') {
        return {
          register: (def, Comp) => { calls.push({ def, Comp }); return () => { calls.push({ disposed: def.name }) } },
          inject: (slot, cb) => cb(),
        }
      }
      if (Object.prototype.hasOwnProperty.call(services, prop)) return services[prop]
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    has: () => true,
  })
}

t('崩溃回归②：没有 locale 服务时（访问即抛）apply 仍要成功注册，用户界面不许整页白屏', () => {
  const calls = []
  const ctx = cordisLikeCtx({}, calls)          // 只提供 slots；其它服务读取即抛（真机就是这样）
  const { mod } = loadClientModule(undefined, undefined, undefined, ctx)
  eq(calls.filter((c) => c.def).length, 6, '五个座位仍要注册上')
  eq(mod.__debug.locale(), 'zh', '拿不到语言服务 ⇒ 中文兜底（不是崩、也不是空白）')
})

t('崩溃回归③：有 locale 服务时按它定语言，并订阅切换', () => {
  const calls = []
  const face = {
    active: 'en', fns: [],
    getSnapshot() { return { active: this.active } },
    subscribe(fn) { this.fns.push(fn); return () => {} },
  }
  const ctx = cordisLikeCtx({ locale: face }, calls)
  const { mod } = loadClientModule(undefined, undefined, undefined, ctx)
  eq(calls.filter((c) => c.def).length, 6, '五个座位仍要注册上')
  eq(mod.__debug.locale(), 'en', 'DSH 语言为 en ⇒ 界面语言 en')
})

t('功能：apply 真的注册了五个座位（3 个 list 插槽 + 2 个 keyed 工具视图），且释放函数真的能摘掉它们', () => {
  const { calls, dispose, fakeWindow } = loadClientModule()
  const registered = calls.filter((c) => c.def).map((c) => c.def.name)
  // P10：控件从 `conversation.input.dock` 搬到 `conversation.input.left`（挂载点换了，数量不变）
  // 2026-09-24：**多了一个 keyed 座位** `tool.call.toolview`（key=`posix`）——
  // 用户要求"要能一眼看出用的是虚拟工具"，而宿主把 terminal 卡统一渲染成"运行命令"。
  eq(registered, ['conversation.input.left', 'shell.overlay', 'settings.plugins.tab', 'tool.call.toolview', 'tool.call.toolview', 'tool.call.toolview'],
    '五个座位都必须被真的注册')
  const bar = calls.filter((c) => c.def && c.def.name === 'conversation.input.left')[0]
  eq([bar.def.id, bar.def.order], ['prompt-optimizer', 20], "控件栏必须是 id='prompt-optimizer' / order=20")
  const keyed = calls.filter((c) => c.def && c.def.name === 'tool.call.toolview')[0]
  eq(keyed.def.key, 'posix', 'keyed 座位按 **wire 工具名** 分发，key 必须是 posix')
  // 0.7.3：内置 Bash 的专属卡片占**同一个 slot 的另一个 key**（原插件的组件原样复用）。
  // 少了这一条，bash 的调用卡片就会回落到宿主的通用工具样式——用户看得出来的差别就在这里。
  const keyedBash = calls.filter((c) => c.def && c.def.name === 'tool.call.toolview' && c.def.key === 'bash')[0]
  ok(keyedBash, 'bash 要有自己的 keyed 座位（否则卡片回落成通用样式）')
  ok(keyedBash.Comp, 'bash 座位也要带组件')
  // 两条注册契约不同：list 座位要唯一 id；keyed 座位要 key（**没有 id**）。
  ok(calls.every((c) => c.def && (typeof c.def.id === 'string' && c.def.id.length > 0
    || typeof c.def.key === 'string' && c.def.key.length > 0)), '每个注册都要带唯一 id（list）或 key（keyed）')
  eq(calls.filter((c) => c.Comp !== undefined && c.Comp !== null).length, 6, '每个座位都要带组件（不能是 undefined）')
  eq(typeof dispose, 'function', 'apply 必须返回释放函数')
  const before = calls.length
  dispose()
  eq(calls.length > before, true, '释放时必须真的调用注销函数')
  eq(fakeWindow.__PO06_ACTIVE__, null, '释放后要把单例 token 还回去')
})

// ── 虚拟 POSIX 的**专属卡片**（用户 2026-09-24："调用命令时还是和原来的图标一样"）──
// 为什么必须有守卫：宿主的 `card:'terminal'` 只是**声明呈现意图**，当前 UI 会把终端卡统一渲染成
// "运行命令 · 摘要"，与 pwsh 无从区分。真正让它长得不一样的是**这个 keyed 视图**，
// 所以"它注册了没有、图标/徽标在不在、缺字段会不会崩"都要被钉住。
t('顾问 token 计数：provider 原始字段也要能显示，且不编造合计', () => {
  const {mod}=loadClientModule()
  const {usageText,normalizeUsage}=mod.__debug
  ok(typeof usageText==='function'&&typeof normalizeUsage==='function','用量格式化与归一化必须可测')
  // 真机 bug（2026-10-01）：卡片优先取进度记录里的 **provider 原始字段**
  // （{inputTokens,outputTokens,cacheReadTokens,totalTokens}），而 usageText 只认归一后的键
  // ⇒ 四个键全 undefined ⇒ 页脚恒显 Σ — tok。这条断言是那个回归的哨兵。
  const raw={inputTokens:28068,outputTokens:13799,cacheReadTokens:69760,cacheWriteTokens:0,totalTokens:111627}
  const text=usageText(raw,true)
  ok(!text.includes('—'),'原始字段必须能显示数字，不能再恒显 —：'+text)
  ok(text.includes('111.6k'),'合计要出现：'+text)
  ok(text.includes('28.1k')&&text.includes('13.8k')&&text.includes('69.8k'),'分项要出现：'+text)
  eq(usageText({in:28068,out:13799,cache:69760,total:111627},true),text,'两种来源必须给出同一文案')
  eq(usageText(null,true),'Σ — tok','真的没有才算 —')
  eq(usageText({},true),'Σ — tok','空对象同样算没有')
  const noTotal=usageText({inputTokens:1000,outputTokens:200},true)
  ok(!/Σ [\d.]+k? tok \|/.test(noTotal),'provider 没给合计就不替它算：'+noTotal)
  ok(noTotal.includes('1.0k')&&noTotal.includes('200'),'分项仍然要显示：'+noTotal)
  eq(normalizeUsage({prompt_tokens:5,completion_tokens:7,total_tokens:12}),{in:5,out:7,cache:null,total:12},'蛇形字段名也认')
})

t('顾问卡片页脚：拿到原始 usage 时必须渲染出数字', () => {
  const react={createElement:(type,props,...children)=>({type,props,children}),Fragment:'Fragment',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
  const {mod}=loadClientModule(undefined,react)
  const text=n=>typeof n==='string'?n:!n||typeof n!=='object'?'':(n.children||[]).flat(Infinity).map(text).join(' ')
  const value={ok:true,usage:{inputTokens:28068,outputTokens:13799,cacheReadTokens:69760,totalTokens:111627},
    report:{verdict:'gaps',summary:'有缺口',checks:[],findings:[],nextStep:'补证据',stopCondition:'取得新证据再审'}}
  const tree=mod.__debug.AdvisorToolRow({phase:'result',sessionId:'s',callId:'c',block:{content:[{type:'text',text:JSON.stringify(value)}]}})
  const shown=text(tree)
  ok(shown.includes('111.6k')&&shown.includes('28.1k'),'页脚要显示本次咨询的 token：'+shown.slice(0,240))
  ok(!shown.includes('Σ — tok'),'不能再是空账')
})

t('斜杠放行判定：只认名单内且已注册的命令，且不误配前缀', () => {
  const {mod}=loadClientModule()
  const f=mod.__debug.slashReviewAllowed
  ok(typeof f==='function','判定必须是可测的纯函数')
  eq(f(['vmake'],'/vmake 做个视频'),true,'名单内命令放行')
  eq(f(['vmake'],'/VMAKE x'),true,'大小写不敏感')
  eq(f(['vmake'],'/vmake'),true,'只有命令名本身也放行')
  eq(f(['vmake'],'/vmakefoo x'),false,'前缀相同但不是同一命令 ⇒ 不放行')
  eq(f(['vmake'],'/clear'),false,'官方命令不在名单内 ⇒ 不放行')
  eq(f(['vmake'],'/other x'),false,'不在名单内 ⇒ 不放行（未注册的命令不会进 active）')
  eq(f([],'/vmake x'),false,'空名单 == 旧行为：全部交还宿主')
  eq(f(null,'/vmake x'),false,'拿不到清单时同样不放行（fail-closed）')
  eq(f(['vmake'],'普通消息'),false,'非斜杠消息不适用')
})

t('专项卡片：范围、对象、过期覆盖与未覆盖检查点可见', () => {
  const react={createElement:(type,props,...children)=>({type,props,children}),Fragment:'Fragment',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
  const {mod}=loadClientModule(undefined,react)
  const value={ok:true,reviewScope:'delivery',focus:'发布前覆盖',coverage:{rows:[{id:'C1',scope:'geometry',focus:'轮系共轴',status:'changed',summary:'旧版本局部报告',checks:[{criterion:'轮系方向',status:'unverified'}]}],missingReviews:[{scope:'geometry',focus:'轮系共轴'}],missingScopes:[],limitations:[]},report:{verdict:'unverified',summary:'需重审',checks:[],findings:[],nextStep:'补证据',stopCondition:'取得新证据再审'}}
  const tree=mod.__debug.AdvisorToolRow({phase:'result',sessionId:'s',callId:'c',block:{type:'tool-result',content:[{type:'text',text:JSON.stringify(value)}]}})
  const text=n=>typeof n==='string'?n:!n||typeof n!=='object'?'':(n.children||[]).flat(Infinity).map(text).join(' ')
  const shown=text(tree)
  ok(shown.includes('交付覆盖')&&shown.includes('发布前覆盖'),'范围和对象可见')
  ok(shown.includes('轮系共轴')&&shown.includes('材料已变更'),'过期局部报告可见')
  ok(shown.includes('未覆盖检查点'),'精确缺口可见')
})

t('顾问材料条目：逐项状态、内容展开、复用侧栏预览，不冒充已看图', () => {
  const react = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'Fragment',
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: () => {}, useCallback:f=>f,useMemo:f=>f() }
  const { mod } = loadClientModule(undefined, react)
  let opened
  const tree = mod.__debug.AdvisorMaterials({ materials: [
    {id:'F0',path:'out.html',kind:'file',purpose:'代码验收',status:'truncated',sent:true,sentChars:16000,chars:22000,excerpt:'真实代码片段',previewAvailable:true,previewPath:'D:/project/out.html'},
    {id:'I0',path:'default.png',kind:'image',purpose:'默认曝光',status:'not-inspected',sent:false,reason:'model-text-only',previewAvailable:true,previewPath:'D:/project/default.png'},
    {id:'F1',path:'missing.log',kind:'file',purpose:'验证日志',status:'unavailable',sent:false,reason:'file-not-found'},
  ],openFile:(...args)=>{opened=args} })
  const walk = node => !node || typeof node !== 'object' ? [] : [node].concat((node.children||[]).flat(Infinity).flatMap(walk))
  const text = node => typeof node==='string'?node:!node||typeof node!=='object'?'':(node.children||[]).flat(Infinity).map(text).join(' ')
  const rows = walk(tree).filter(n=>n.props && n.props['data-advisor-material']!==undefined)
  eq(rows.length,3,'三份材料三条路径，状态独立')
  ok(text(tree).includes('部分内容')&&text(tree).includes('未检查图片')&&text(tree).includes('不可用'),'真实状态不可混同')
  ok(text(tree).includes('真实代码片段'),'可展开看到实际附入的内容片段')
  const link=walk(tree).find(n=>n.type==='button'&&text(n)==='out.html')
  link.props.onClick({preventDefault(){},stopPropagation(){}})
  eq(opened,['D:/project/out.html'],'使用宿主openFile，不自建URL也不猜options字段')
  ok(!walk(rows[2]).some(n=>n.type==='button'),'不存在文件不提供虚假预览入口')
})

t('顾问专用卡片：嵌套结果取 content，摘要始终可见，过程与产出分区', () => {
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'Fragment',
    useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(),
  }
  const { calls, mod } = loadClientModule(undefined, react)
  const cell = calls.find(c => c.def && c.def.key === 'consult_task')
  ok(cell, '根调用和 PTC 子调用按同一个 key 分发，必须真的注册 consult_task')
  const value = { ok: true, mode: 'review_result', ms: 1000, model: 'p/m', toolCalls: 3,
    usage: { in: 12450, out: 3676, cache: 25344, total: 41470 },
    report: { verdict: 'gaps', summary: '缺少浏览器验收证据',
    checks: [{ criterion: '能操控', status: 'unverified', evidenceRefs: ['E2'] }],
    findings: [], nextStep: '让用户实测', stopCondition: '不要重复截图' } }
  // 嵌套 result 没有 meta。必须用 content JSON，不允许猜 block.value/block.data。
  const props = { phase: 'result', callId: 'nested-1', sessionId: 's1',
    block: { call: { argsRaw: JSON.stringify({ mode: 'review_result', question: '验收操控' }) },
      content: [{ type: 'text', text: JSON.stringify(value) }] },
    useDisclosure: () => ({ expanded: false, toggle() {} }) }
  eq(mod.__debug.advisorValueOf(props.block).report.summary, value.report.summary, '能读到嵌套结果')
  const walk = (node) => !node || typeof node !== 'object' ? [] : [node].concat((node.children || []).flat(Infinity).flatMap(walk))
  const textOf = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : (node.children || []).flat(Infinity).map(textOf).join(' ')
  const folded = cell.Comp(props)
  ok(textOf(folded).includes('有缺口'), '不展开也能看到结论')
  ok(textOf(folded).includes(value.report.summary), '摘要不藏在展开区域')
  ok(!walk(folded).some(n => n.props && n.props['data-po06-advisor-details']), '折叠时长过程不占屏')
  const expanded = cell.Comp({ ...props, useDisclosure: () => ({ expanded: true, toggle() {} }) })
  ok(textOf(expanded).includes('原 AI 询问内容') && textOf(expanded).includes('顾问思考内容') && textOf(expanded).includes('顾问答复内容') && textOf(expanded).includes('验收结果'), '四个分区必须直接可见')
  const thinking = walk(expanded).find(n => n.props && n.props['data-po06-advisor-thinking'])
  const checks = walk(expanded).find(n => n.props && n.props['data-po06-advisor-checks'])
  eq(thinking.type, 'details', '思考必须独立折叠')
  eq(checks.type, 'details', '验收必须独立折叠')
  eq(thinking.props.open, false, '思考默认收起，减少视觉噪音')
  eq(checks.props.open, false, '验收默认收起')
  ok(textOf(expanded).includes('待验证'), '收起时仍可见验收概况')
  // 直观性：状态色点 + 进度条 + 运行中默认展开思考（收起时也能一眼看出成没成）
  eq(mod.__debug.advisorProgressPct(150, true), 0.5, '兜底上限 300s ⇒ 150s 走一半')
  eq(mod.__debug.advisorProgressPct(50, true, 100000), 0.5, '有本轮限时记录时按它换算（100s 的一半）')
  eq(mod.__debug.advisorProgressPct(999, true), 0.97, '没结束不画满')
  eq(mod.__debug.advisorProgressPct(30, false), null, '跑完了不画进度条')
  ok(walk(folded).some(n => n.props && n.props.role === 'status' && (n.children || []).some(c => c && c.props && c.props['aria-hidden'])), '状态旁要有色点')
  // 强调：标题与四个分区题干用主题色 + 加粗（其余保持灰阶 ⇒ 灰度下仍分得出区块）
  const ACCENT = 'var(--po06-acc)'
  const labelEls = walk(folded).flatMap(n => (n.children || []).flat(Infinity)).filter(x => typeof x === 'string')
  for (const text of ['原 AI 询问内容', '顾问答复内容']) {
    const host = walk(folded).find(n => n.props && n.props.style && n.props.style.color === ACCENT
      && (n.children || []).flat(Infinity).includes(text))
    ok(host, text + ' 的题干要用主题色')
    eq(host.props.style.fontWeight, 600, text + ' 的题干要加粗')
  }
  const sums = walk(folded).filter(n => n.type === 'summary')
  eq(sums.length >= 2, true, '思考与验收各有一个题干')
  ok(sums.every(s => s.props.style.color === ACCENT && s.props.style.fontWeight === 600), '两个折叠题干同样是主题色加粗')
  const titleEl = walk(folded).find(n => n.props && n.props.style && n.props.style.color === ACCENT && n.props.style.fontSize === '13.5px')
  ok(titleEl, '卡片标题要用主题色')
  // 用量（走 A）：页脚显示这次咨询的 token，且注明是插件自己的账
  const usageEl = walk(folded).find(n => n.props && n.props['data-po06-advisor-usage'])
  ok(usageEl, '页脚要有 token 用量')
  ok(textOf(usageEl).includes('41.5k'), '过千用 k 显示，实际=' + textOf(usageEl))
  ok(textOf(usageEl).includes('入') && textOf(usageEl).includes('出') && textOf(usageEl).includes('缓存'), '要区分 输入/输出/缓存命中')
  ok(/不计入 DSH/.test(String(usageEl.props.title || '')), '必须注明这是插件的账、不进 DSH 统计')
  ok(walk(folded).some(n => n.props && n.props['data-po06-advisor-meta']), '页脚元信息行要在')
  const live = cell.Comp({ phase: 'preparing', callId: 'live-1', sessionId: 's1', block: {} })
  const liveThink = walk(live).find(n => n.props && n.props['data-po06-advisor-thinking'])
  eq(liveThink.props.open, true, '运行中默认展开思考，实时思维链不用手动点')
  eq(mod.__debug.advisorDraftReply('{"summary":"正在核对证据'), '正在核对证据', '正在生成的 summary 可实时显示为人话')
  ok(walk(expanded).some(n => n.props && n.props['data-po06-advisor-output']), '有独立产出区')
  const partial = cell.Comp({ ...props, block: { ...props.block, content: [{ type: 'text', text: JSON.stringify({ ...value, partial: true }) }] } })
  ok(textOf(partial).includes('不作为完整验收通过'), '中止不能渲染成普通通过')
  cell.Comp({ phase: 'preparing', callId: 'p', sessionId: 's1', block: {} })
})

t('虚拟 POSIX 卡片：注册了 keyed 视图，带专属图标与徽标，且缺字段不崩', () => {
  const { calls } = loadClientModule()
  const cell = calls.filter((c) => c.def && c.def.name === 'tool.call.toolview')[0]
  ok(cell, '必须注册 tool.call.toolview')
  eq(typeof cell.Comp, 'function', '要带组件')
  // ⚠ 不许写死本机绝对路径：那样只有作者机器上能过（CI 首跑就是这么红的）。用上面已派生的 CLIENT。
  const src = readFileSync(CLIENT, 'utf8')
  ok(/\$_\s*'/.test(src) || src.includes("'$_'"), "专属图标要用 '$_'（一眼可辨的 shell 提示符）")
  ok(/虚拟/.test(src) && /Virtual/.test(src), '要有「虚拟 / Virtual」徽标（中英都要）')
  ok(/posix-tool/.test(src), '要带 data-po06=posix-tool 锚点（真机可核对渲染）')
  ok(/不经过 PowerShell|纯 JS/.test(src), '要说明它是插件内执行、不经过 PowerShell')
  ok(/posixCommandOf/.test(src) && /posixOutputOf/.test(src), '命令与输出要有取数函数（字段缺失要能兜住）')
})

// ── ③ 语言：只来自 DSH 的 locale 服务，且**切了就换**（2026-09-22 用户要求 + 一次真机缺陷）──
// 真机契约：`ctx.locale` 是 LocaleFace 实例（`getSnapshot().active`），不是字符串。
// 第一版按 `v.locale/v.name/v.id/v.language` 猜属性 ⇒ 真机上永远拿不到 ⇒ **恒中文**（英文适配等于没做）。
t('运行时：语言探测认 LocaleFace 的三种形态，拿不到就中文兜底（不误判成英文）', () => {
  const { mod } = loadClientModule()
  const d = mod.__debug.detectLocale
  eq(typeof d, 'function', '要有 __debug.detectLocale 供单测钉契约')
  eq(d({ locale: { getSnapshot: () => ({ active: 'en' }) } }), 'en', 'getSnapshot().active=en ⇒ en')
  eq(d({ locale: { getLocale: () => ({ active: 'en' }) } }), 'en', 'getLocale().active=en ⇒ en')
  eq(d({ locale: { snapshot: { active: 'zh' } } }), 'zh', 'snapshot.active=zh ⇒ zh')
  eq(d({ locale: { active: 'en' } }), 'en', '裸 {active} 也认')
  eq(d({ locale: 'en' }), 'en', '字符串也认（老宿主/测试替身）')
  eq(d({ locale: null }), 'zh', '没有语言服务 ⇒ 中文兜底')
  eq(d({}), 'zh', 'ctx 里没有 locale ⇒ 中文兜底')
  eq(d({ locale: { active: 'en-US' } }), 'en', 'en-US 也算英文')
  // 反面：LocaleFace 的内部字段（没有 active）**不许**被当成英文
  eq(d({ locale: { ctx: {}, host: {}, catalog: new Map(), listeners: new Set(), preference: null, snapshot: {} } }), 'zh',
    'LocaleFace 没有 active 时回中文，不许瞎猜')
})

t('运行时：DSH 里切换语言 ⇒ 订阅回调立刻把界面语言换掉（不用刷新页面）', () => {
  const effects = []
  const reactStub = {
    createElement: (t2, p, ...k) => ({ t2, p, k }), Fragment: 'Fragment',
    useState: (v) => [v, () => {}],
    useEffect: (fn) => { effects.push(fn) },
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f, useMemo: (f) => f(),
  }
  const face = {
    active: 'zh', fns: [],
    getSnapshot() { return { active: this.active } },
    subscribe(fn) { this.fns.push(fn); return () => { this.fns = this.fns.filter((x) => x !== fn) } },
  }
  const { calls, mod } = loadClientModule(undefined, reactStub, { locale: face })
  eq(mod.__debug.locale(), 'zh', '初始按 DSH 当前语言 = zh')
  const bar = calls.filter((c) => c.def && c.def.name === 'conversation.input.left')[0]
  ok(bar && typeof bar.Comp === 'function', '控件栏组件要注册上')
  bar.Comp({ sessionId: 's1' })            // 渲染一次（挂钩子；effect 被夹具捕获，不真跑网络）
  eq(effects.length > 0, true, '渲染时要挂上 effect（订阅在 effect 里）')
  for (const fn of effects) { try { fn() } catch (e) { /* 其它 effect 可能依赖未提供的服务 */ } }
  eq(face.fns.length > 0, true, '要真的订阅了 locale 变化')
  face.active = 'en'                       // 用户在 DSH 设置里切成英文
  for (const fn of face.fns) fn()
  eq(mod.__debug.locale(), 'en', '切到 en 之后，插件界面语言跟着换')
  face.active = 'zh'
  for (const fn of face.fns) fn()
  eq(mod.__debug.locale(), 'zh', '切回 zh 也跟得上')
})

t('功能：缺 slots 服务时不抛、不注册（而不是让整页崩掉）', () => {
  const calls = []
  const fakeWindow = { __ModuleLoader__: { load: (reg) => { fakeWindow.__reg = reg } } }
  const reactStub = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f }
  new Function('window', 'require', src)(fakeWindow, (n) => (n === 'react' ? reactStub : {}))
  const mod = fakeWindow.__reg.factory((n) => (n === 'react' ? reactStub : {}))
  const dispose = mod.apply({})            // 没有任何服务
  eq(typeof dispose, 'function', '仍要返回释放函数')
  eq(calls.length, 0, '不该注册任何东西')
})

t('review outcome card separates invocation success and pending acceptance with evidence provenance',()=>{
 const react={createElement:(type,props,...children)=>({type,props,children}),Fragment:'Fragment',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useCallback:f=>f,useMemo:f=>f()}
 const {mod}=loadClientModule(undefined,react)
 const text=n=>typeof n==='string'?n:!n||typeof n!=='object'?'':(n.children||[]).flat(Infinity).map(text).join(' ')
 const value={ok:true,invocationSucceeded:true,reviewPassed:false,reviewState:{openIssues:[{id:'R1',criterion:'actual runtime',nextStep:'capture evidence'}]},report:{verdict:'gaps',summary:'pending',checks:[],findings:[],nextStep:'next',stopCondition:'stop'},inspectedMaterials:[{path:'app.js',status:'read',offset:20,limit:10}]}
 const tree=mod.__debug.AdvisorToolRow({phase:'result',sessionId:'s',callId:'c',block:{content:[{type:'text',text:JSON.stringify(value)}]}})
 ok(text(tree).includes('咨询调用：成功') && text(tree).includes('验收待补'),'调用成功不冒充通过')
 ok(text(tree).includes('R1') && text(tree).includes('capture evidence'),'缺口与动作可见')
 ok(text(tree).includes('顾问补读') && text(tree).includes('offset=20'),'补读范围单列')
 const mats=mod.__debug.AdvisorMaterials({materials:[{path:'app.js',kind:'file',status:'ready',evidenceType:'source',selectionScope:'line-range',selectedStartLine:2,selectedEndLine:4,wholeFileComplete:false},{path:'preview.png',kind:'image',status:'ready',evidenceType:'software-preview'}]})
 ok(text(mats).includes('2-4') && text(mats).includes('非全文') && text(mats).includes('替代预览'),'片段与替代图可分辨')
})

// ── ③0b 底色整片透明回归（2026-10-04 桌面端真机：所有插件面板背景突然消失）─────────
// 现象：面板底色整片没了，文字直接压在会话内容上；间歇出现（「有的时候」）。
// 根因：承载**整张主题 token 表**的 <style> 按"谁建的谁摘"管理，而宿主重载客户端模块时
//   新实例的 apply 会跑在旧实例卸载之前 —— 新实例看到样式表「已存在」就跳过注入、又没有接管
//   属主，随后旧实例按"卸载即净"把它摘掉 ⇒ 活着的实例手上没有 token 表 ⇒ 所有
//   `var(--po06-*)` 一并取不到值 ⇒ 每块面板的底色一起变透明。
// 这条用例把那个时序**确定性地**摆出来：同一份源码求值两次 = 一次热重载。
/** 极简 document：只够样式注入那一段用（getElementById / createElement / head.appendChild）。 */
function makeFakeDocument() {
  const kids = []
  const makeEl = () => ({ id: '', textContent: '', __po06Owner: undefined,
    remove() { const i = kids.indexOf(this); if (i >= 0) kids.splice(i, 1) } })
  return {
    head: { appendChild(n) { kids.push(n); return n } },
    createElement: () => makeEl(),
    getElementById: (id) => kids.find((n) => n.id === id) || null,
  }
}

t('底色回归：新实例接管属主后，旧实例卸载不得摘掉主题 token 表', () => {
  const doc = makeFakeDocument()
  const prevDoc = globalThis.document
  const prevMO = globalThis.MutationObserver
  const watchers = []
  globalThis.document = doc
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; watchers.push(this) } observe() {} disconnect() {} }
  try {
    const win = {}
    const a = loadClientModule(win)                                   // 旧实例
    const tag = doc.getElementById('dsh-po06-ui')
    ok(tag, 'A 必须注入样式表')
    ok(/--po06-surface/.test(tag.textContent), '样式表必须含主题 token（底色就来自它）')
    const b = loadClientModule(win)                                   // 新实例（同一次热重载）
    ok(doc.getElementById('dsh-po06-ui'), 'B 挂载后样式表仍在')
    a.dispose()                                                       // 旧实例卸载 —— 故障就发生在这里
    ok(doc.getElementById('dsh-po06-ui'), '⚠ 旧实例卸载后样式表必须仍在，否则面板底色集体变透明')
    doc.getElementById('dsh-po06-ui').remove()                        // 前置：被第三方摘掉
    ok(!doc.getElementById('dsh-po06-ui'), '（前置）确实已摘掉')
    for (const w of watchers) { try { w.cb() } catch (e) { /* 退休实例的回调会被 isLive 拦下 */ } }
    ok(doc.getElementById('dsh-po06-ui'), 'head 变化后要自愈补回样式表（兜底）')
    b.dispose()
    ok(!doc.getElementById('dsh-po06-ui'), '最后一个属主卸载后仍要摘干净（卸载即净）')
  } finally {
    globalThis.document = prevDoc
    if (prevMO === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = prevMO
  }
})


// ── ③0c bash 卡片在桌面端消失的回归（2026-10-04 真机）────────────────────────────
// 现象：同一类 bash 调用，web 端显示我们的卡（`$_`），桌面端显示宿主演示卡的 `>-`。
// 根因：宿主自带的 `bash-toolview-sample` 也占 key `bash`，priority 取默认 0；
//   而 `ui-slots` 的裁决是「**同 key + 同 priority 直接抛错**」⇒ 后注册的那个抛、先到的留下。
//   web 上我们的 bundle 先到（我们赢）；桌面端加载顺序反过来（我们抛、宿主的留下）。
// 修法：keyed 注册显式给一个更小的 priority（升序、最小者渲染）。
t('bash 卡片归属：keyed 注册必须带胜出的 priority（不能靠默认值赌加载顺序）', () => {
  const seen = []
  const ctx = {
    slots: {
      register: (def) => { seen.push(def); return () => {} },
      inject: (slot, cb) => cb(),
    },
  }
  loadClientModule(undefined, undefined, undefined, ctx)
  const keyed = seen.filter((d) => d && d.name === 'tool.call.toolview')
  ok(keyed.length >= 3, '至少要注册 posix/bash/consult_task 三张卡，实际 ' + keyed.length)
  const byKey = {}
  for (const d of keyed) byKey[d.key] = d
  for (const key of ['bash', 'posix', 'consult_task']) {
    ok(byKey[key], '缺少 key=' + key + ' 的注册')
    ok(typeof byKey[key].priority === 'number', key + ' 必须显式给 priority')
    ok(byKey[key].priority < 0,
      key + ' 的 priority 必须小于宿主的默认 0（升序最小者渲染）；等于 0 会与宿主演示卡同优先级互抛：' + byKey[key].priority)
  }
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-client-file', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '客户端面板静态守卫：加载器格式/声明一致/单例闸门/卸载即净/写头/界面锚点/XSS 与路径。不联网、不起浏览器。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
