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

// ── ① 文件存在 + 语法可解析 + 模块加载器格式正确 ──────────────────────
t('client.js 存在、语法通过、用宿主的模块加载器格式注册且 id 与包名一致', () => {
  ok(src.length > 0, 'client.js 必须存在且有内容')
  // 语法：node --check 能解析（它引用了 window，但只解析不执行）
  execFileSync(process.execPath, ['--check', CLIENT], { stdio: 'pipe' })
  ok(/window\.__ModuleLoader__\.load\(\{/.test(src), '必须是 __ModuleLoader__.load({...}) 形式')
  ok(/id:\s*'@dsh-external\/dsh-po06'/.test(src), 'load 的 id 必须与包名一致')
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
  const claimAt = src.indexOf('window.__PO06_ACTIVE__ = INSTANCE_TOKEN')
  ok(claimAt > 0, '找不到抢注那一行')
  const after = src.slice(claimAt, claimAt + 200)
  ok(!/\n\s*if \(!isActiveInstance\(\)\) return/.test(after), '抢注后紧接着自判 = 无效闸门（EV-0142）')
  ok(/if \(!isLive\(\)\) return null/.test(src), 'attach 前的复核仍必须在（isLive）')
})

t('功能：更新实例抢走 token 后，旧实例的**重挂**不再注册（HMR 后不会双份）', () => {
  const win = {}                            // ← 两个实例必须看**同一个** window
  const first = loadClientModule(win)       // 第一个实例（模拟 HMR 前的旧实例）
  // P10：挂载点从 `conversation.input.dock` **搬到** `conversation.input.left`（原来是"新增一个"，
  // 现在是"换过去"，所以总数仍是 3：input.left + shell.overlay + settings.plugins.tab）
  eq(first.calls.filter((c) => c.def).length, 4, '第一个实例先注册了 4 个')
  const second = loadClientModule(win)      // 第二个实例抢注 token
  eq(second.calls.filter((c) => c.def).length, 4, '第二个实例也注册 4 个（最新获胜）')
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
  ok(/if \(!canArm \|\| tierOff \|\| !data\) return undefined/.test(src), '没通道/关闭档/状态未知 ⇒ 不挂监听')
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
  ok(/if \(t\.startsWith\('\/'\)\) return 'slash-command'/.test(src), '斜杠命令不拦')
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
  eq(calls.filter((c) => c.def).length, 4, '四个座位仍要注册上')
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
  eq(calls.filter((c) => c.def).length, 4, '四个座位仍要注册上')
  eq(mod.__debug.locale(), 'en', 'DSH 语言为 en ⇒ 界面语言 en')
})

t('功能：apply 真的注册了四个座位（3 个 list 插槽 + 1 个 keyed 工具视图），且释放函数真的能摘掉它们', () => {
  const { calls, dispose, fakeWindow } = loadClientModule()
  const registered = calls.filter((c) => c.def).map((c) => c.def.name)
  // P10：控件从 `conversation.input.dock` 搬到 `conversation.input.left`（挂载点换了，数量不变）
  // 2026-09-24：**多了一个 keyed 座位** `tool.call.toolview`（key=`posix`）——
  // 用户要求"要能一眼看出用的是虚拟工具"，而宿主把 terminal 卡统一渲染成"运行命令"。
  eq(registered, ['conversation.input.left', 'shell.overlay', 'settings.plugins.tab', 'tool.call.toolview'],
    '四个座位都必须被真的注册')
  const bar = calls.filter((c) => c.def && c.def.name === 'conversation.input.left')[0]
  eq([bar.def.id, bar.def.order], ['prompt-optimizer', 20], "控件栏必须是 id='prompt-optimizer' / order=20")
  const keyed = calls.filter((c) => c.def && c.def.name === 'tool.call.toolview')[0]
  eq(keyed.def.key, 'posix', 'keyed 座位按 **wire 工具名** 分发，key 必须是 posix')
  // 两条注册契约不同：list 座位要唯一 id；keyed 座位要 key（**没有 id**）。
  ok(calls.every((c) => c.def && (typeof c.def.id === 'string' && c.def.id.length > 0
    || typeof c.def.key === 'string' && c.def.key.length > 0)), '每个注册都要带唯一 id（list）或 key（keyed）')
  eq(calls.filter((c) => c.Comp !== undefined && c.Comp !== null).length, 4, '每个座位都要带组件（不能是 undefined）')
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
t('虚拟 POSIX 卡片：注册了 keyed 视图，带专属图标与徽标，且缺字段不崩', () => {
  const { calls } = loadClientModule()
  const cell = calls.filter((c) => c.def && c.def.name === 'tool.call.toolview')[0]
  ok(cell, '必须注册 tool.call.toolview')
  eq(typeof cell.Comp, 'function', '要带组件')
  const src = readFileSync('C:/Users/WestFox/.dsh/plugins/dsh-prompt-optimizer/po06/lib/client.js', 'utf8')
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

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-client-file', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '客户端面板静态守卫：加载器格式/声明一致/单例闸门/卸载即净/写头/界面锚点/XSS 与路径。不联网、不起浏览器。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
