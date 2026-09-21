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
  ok(!/if \(!isActiveInstance\(\)\) return/.test(src), '不得再出现"抢注后立刻自判"的无效闸门')
})

t('功能：更新实例抢走 token 后，旧实例的**重挂**不再注册（HMR 后不会双份）', () => {
  const win = {}                            // ← 两个实例必须看**同一个** window
  const first = loadClientModule(win)       // 第一个实例（模拟 HMR 前的旧实例）
  // P10：挂载点从 `conversation.input.dock` **搬到** `conversation.input.left`（原来是"新增一个"，
  // 现在是"换过去"，所以总数仍是 3：input.left + shell.overlay + settings.plugins.tab）
  eq(first.calls.filter((c) => c.def).length, 3, '第一个实例先注册了 3 个')
  const second = loadClientModule(win)      // 第二个实例抢注 token
  eq(second.calls.filter((c) => c.def).length, 3, '第二个实例也注册 3 个（最新获胜）')
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
  for (const anchor of ['bar', 'ctx', 'ctx-mode', 'readtools', 'model',
    'panel', 'controls', 'items', 'turns', 'prompt', 'settings']) {
    ok(src.includes("'data-po06': '" + anchor + "'") || src.includes('"data-po06": "' + anchor + '"'),
      '缺少界面锚点 data-po06=' + anchor)
  }
  // 分段控件的标记是**拼出来的**：静态源码里是 `name`，运行期 DOM 上是
  // tier / tier-off / tier-light / tier-standard / tier-heavy 与 perm / perm-review / perm-auto。
  ok(/name:\s*'tier'/.test(src), '档位分段控件必须叫 tier（DOM 上是 tier / tier-<值>）')
  ok(/name:\s*'perm'/.test(src), '优化权限分段控件必须叫 perm（DOM 上是 perm / perm-<值>）')
  ok(/'data-po06':\s*name\s*\+\s*'-'\s*\+\s*k/.test(src), '分段项必须是 name + "-" + 值（tier-off 这类）')
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
function loadClientModule(sharedWindow) {
  const calls = []
  const win = sharedWindow || {}
  win.__regs = win.__regs || []
  if (!win.__ModuleLoader__) win.__ModuleLoader__ = { load: (reg) => { win.__regs.push(reg) } }
  const reactStub = {
    createElement: () => null, Fragment: 'Fragment',
    useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(),
  }
  const fakeRequire = (name) => (name === 'react' ? reactStub : {})
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', src)(win, fakeRequire)
  const reg = win.__regs[win.__regs.length - 1]
  ok(reg && typeof reg.factory === 'function', '必须注册一个 factory')
  const mod = reg.factory(fakeRequire)
  const ctx = {
    slots: {
      register: (def, Comp) => { calls.push({ def, Comp }); return () => { calls.push({ disposed: def.name }) } },
      inject: (slot, cb) => cb(),
    },
  }
  const dispose = mod.apply(ctx)
  return { calls, dispose, ctx, mod, fakeWindow: win }
}

t('功能：apply 真的注册了三个插槽，且返回的释放函数真的能摘掉它们', () => {
  const { calls, dispose, fakeWindow } = loadClientModule()
  const registered = calls.filter((c) => c.def).map((c) => c.def.name)
  // P10：控件从 `conversation.input.dock` 搬到 `conversation.input.left`（挂载点换了，数量不变）
  eq(registered, ['conversation.input.left', 'shell.overlay', 'settings.plugins.tab'], '三个插槽都必须被真的注册')
  const bar = calls.filter((c) => c.def && c.def.name === 'conversation.input.left')[0]
  eq([bar.def.id, bar.def.order], ['prompt-optimizer', 20], "控件栏必须是 id='prompt-optimizer' / order=20")
  ok(calls.every((c) => c.def && typeof c.def.id === 'string' && c.def.id.length > 0), '每个注册都要带唯一 id（slot 按 id 去重）')
  eq(calls.filter((c) => c.Comp !== undefined && c.Comp !== null).length, 3, '每个插槽都要带组件（不能是 undefined）')
  eq(typeof dispose, 'function', 'apply 必须返回释放函数')
  const before = calls.length
  dispose()
  eq(calls.length > before, true, '释放时必须真的调用注销函数')
  eq(fakeWindow.__PO06_ACTIVE__, null, '释放后要把单例 token 还回去')
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
