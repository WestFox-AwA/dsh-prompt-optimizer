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

t('package.json 声明了 dsh.client，且 inject 与客户端用到的服务一致', () => {
  const c = pkg.dsh && pkg.dsh.client
  ok(c && typeof c === 'object', '必须声明 dsh.client（否则 dsh-client-modules 不会服务这个文件）')
  eq(c.platform, 'web', '平台必须是 web')
  ok(Array.isArray(c.inject) && c.inject.includes('slots'), '要注入 slots（注册界面要用）')
  const declared = /exports\.inject\s*=\s*\[([^\]]*)\]/.exec(src)
  ok(declared, '客户端必须导出 inject')
  ok(/slots/.test(declared[1]), '客户端 inject 里要有 slots：' + declared[1])
  ok(pkg.files.includes('lib'), 'lib 必须在 files 里（否则 client.js 不进包）')
})

// ── ② 三条纪律（各自对应 0.5 的一次真实事故）──────────────────────────
t('单例闸门：HMR 后只有持 token 的实例注册 UI（否则"后台在跑、界面不显示"）', () => {
  ok(/__PO06_ACTIVE__/.test(src), '必须有 window.__PO06_ACTIVE__ 这个闸门')
  ok(/isActiveInstance/.test(src), '必须有 isActiveInstance 判定')
  ok(/if\s*\(!isActiveInstance\(\)\)\s*return/.test(src), '拿不到 token 就必须**不注册**（直接返回）')
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
  for (const anchor of ['dock', 'panel', 'controls', 'items', 'turns', 'prompt', 'settings']) {
    ok(src.includes("'data-po06': '" + anchor + "'") || src.includes('"data-po06": "' + anchor + '"'),
      '缺少界面锚点 data-po06=' + anchor)
  }
})

t('三个插槽都注册了，且覆盖"一眼可见 / 详情 / 设置"三种入口', () => {
  ok(src.includes("'conversation.input.dock'"), '输入框旁的指示器')
  ok(src.includes("'shell.overlay'"), '浮层槽')
  ok(src.includes("'settings.plugins.tab'"), '设置页')
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

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-client-file', phase: 'P9', total, pass, fail: failures.length, failures,
  note: '客户端面板静态守卫：加载器格式/声明一致/单例闸门/卸载即净/写头/界面锚点/XSS 与路径。不联网、不起浏览器。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
