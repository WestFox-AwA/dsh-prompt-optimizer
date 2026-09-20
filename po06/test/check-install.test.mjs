// P8 · "装好了吗 / 装的是这一份吗" 自检脚本（`scripts/check-install.mjs`）的单测。
//
// 运行：node po06/test/check-install.test.mjs
//
// 为什么必须配单测（EV-0119）：这个脚本守的正是**这个项目栽过三次的那件事**——
// "装上了"与"会被装配"是两回事（EV-0066），"装的是新件"与"pnpm 装回了旧件"也是两回事
// （EV-0079/0083）。这两种失败**都不报错**，只是行为像没装。
// 所以它自己必须准：错了就会给出一句"可以开始试了"，而用户据此去跑。
//
// ⚠ 测试**不会碰真实 home**：脚本把 `DSH_HOME` 传给 `dsh` 子进程，
// 所以 fixture 里那个不存在的 profile 只会在临时 home 里找。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'check-install.mjs')
const REPO = join(HERE, '..')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const PKG = '@dsh-external/dsh-po06'
/**
 * 造一个假 home + 假 profile + 假"装出来的包"。
 * @param {{noPkg?:boolean, noBundle?:boolean, version?:string, tamperLib?:boolean, enable?:boolean, noEnableFile?:boolean, oldPlugin?:boolean}} o
 */
function fixture(o = {}) {
  const home = mkdtempSync(join(tmpdir(), 'po06-inst-'))
  DIRS.push(home)
  const profile = join(home, 'profiles', 'p1')
  mkdirSync(profile, { recursive: true })
  const deps = { [PKG]: 'file:x.tgz' }
  if (o.oldPlugin) deps['@dsh-external/dsh-prompt-optimizer'] = 'file:old.tgz'
  // 真实的装配接线在 `dsh.profile.bundles`（`dsh plugin add` 会往里加包名）——
  // **只有列在这里的包才会被装配**（EV-0066：装了但不在 bundles 里 = 永远不会生效）。
  const bundles = o.notInBundles ? [] : [PKG]
  writeFileSync(join(profile, 'package.json'),
    JSON.stringify({ name: 'p1', dependencies: deps, dsh: { profile: { bundles, patchReload: 'live' } } }), 'utf8')
  if (!o.noPkg) {
    const inst = join(profile, 'node_modules', PKG)
    mkdirSync(join(inst, 'lib'), { recursive: true })
    writeFileSync(join(inst, 'package.json'), JSON.stringify({ name: PKG, version: o.version || '0.6.0-beta.1' }), 'utf8')
    if (!o.noBundle) writeFileSync(join(inst, 'cordis.patch.yml'), copyOfRepoFile('cordis.patch.yml'), 'utf8')
    for (const f of readdirSync(join(REPO, 'lib')).filter((x) => x.endsWith('.js'))) {
      const body = copyOfRepoFile(join('lib', f))
      writeFileSync(join(inst, 'lib', f), o.tamperLib && f === 'store.js' ? body + '\n// tampered\n' : body, 'utf8')
    }
  }
  if (!o.noEnableFile) {
    writeFileSync(join(home, 'po06.json'),
      JSON.stringify({ settingsVersion: 1, enabled: o.enable !== false, rollout: { mode: 'all' } }), 'utf8')
  }
  return home
}
const copyOfRepoFile = (rel) => readFileSync(join(REPO, rel), 'utf8')

function run(o = {}, extra = []) {
  const home = fixture(o)
  const jsonPath = join(home, 'out.json')
  const args = [SCRIPT, '--home', home, '--profile', 'p1', '--expect-version', o.expectVersion || '0.6.0-beta.1',
    '--json', jsonPath, ...extra]
  try {
    return { exit: 0, stdout: execFileSync(process.execPath, args, { encoding: 'utf8', cwd: REPO }), home, jsonPath }
  } catch (e) {
    return { exit: e.status, stdout: String(e.stdout || ''), home, jsonPath }
  }
}

// ── ① 全绿：逐文件相同 + 有 bundle 层 + 启用配置可解析 ──────────────────
t('全绿：报"可以开始试了"、退出码 0、逐文件比对无差异', () => {
  const r = run()
  eq(r.exit, 0, '全绿应放行；输出：\n' + r.stdout)
  ok(r.stdout.includes('可以开始试了'), '应给出结论：\n' + r.stdout)
  ok(/无差异/.test(r.stdout), '逐文件比对应报无差异：\n' + r.stdout)
  ok(r.stdout.includes('bundle 层'), '应检查 bundle 层：\n' + r.stdout)
})

// ── ② 装了但没 bundle 层 ⇒ **必须拦**（EV-0066：装了也永远不会被装配）───
t('缺 cordis.patch.yml ⇒ 阻断（装了也不会被装配）', () => {
  const r = run({ noBundle: true })
  eq(r.exit, 1, '缺 bundle 层必须阻断；输出：\n' + r.stdout)
  ok(r.stdout.includes('装了也不会被装配'), '应说清后果：\n' + r.stdout)
  ok(r.stdout.includes('先别试'), '结论必须是"先别试"：\n' + r.stdout)
})

// ── ③ 根本没装出来 ⇒ 阻断 ────────────────────────────────────────────
t('装出来的包不存在 ⇒ 阻断', () => {
  const r = run({ noPkg: true })
  eq(r.exit, 1, '没装成必须阻断')
  ok(/找不到装出来的包|不存在/.test(r.stdout), '应指出问题：\n' + r.stdout)
})

// ── ③b 冷启动（**还没装**就跑这个命令）必须是**一页能照抄的指引**（EV-0135）──
// 原先这里有两个毛病，都在"用户第一次装之前"这个时刻暴露：
//   ① 三、四两节的标题下面**什么都不印**（读起来像"没查"，而其实是查不了）；
//   ② 第四节把"没装"的**后果**再报一次：「用装出来的解析器读配置失败：Cannot find module …」
//      ——用户会把"没装"读成"装坏了"。
t('冷启动：没装时三、四节明说"跳过"，且不得出现 Cannot find module 噪声', () => {
  const r = run({ noPkg: true })
  eq(r.exit, 1, '仍然要阻断')
  const skips = (r.stdout.match(/⏭ 跳过/g) || []).length
  eq(skips, 2, '三、四两节都要明说跳过（实得 ' + skips + ' 处）:\n' + r.stdout)
  ok(!/Cannot find module/.test(r.stdout), '不得把"没装"的后果报成模块缺失：\n' + r.stdout)
  ok(!/用装出来的解析器读配置失败/.test(r.stdout), '不得报"解析器读配置失败"（包都没装）:\n' + r.stdout)
})

t('冷启动：结论里给出**能照抄的装法**（不必让用户去翻文档）', () => {
  const r = run({ noPkg: true })
  ok(r.stdout.includes('dsh plugin --profile p1 add <tgz>'), '应给出装包命令：\n' + r.stdout)
  ok(r.stdout.includes('po06/README.md'), '应指向细节文档：\n' + r.stdout)
  // 装了之后不该再出现这段冷启动指引（否则页面上永远挂着一段无关的话）
  const okRun = run()
  ok(!okRun.stdout.includes('dsh plugin --profile p1 add <tgz>'), '装好了就不该再印装法：\n' + okRun.stdout)
})

// ── ③b 装了、patch 也在，但**不在 bundles 里** ⇒ 阻断（EV-0066 的正题）────
t('装了但不在 `dsh.profile.bundles` 里 ⇒ 阻断（装了却永远不会被装配）', () => {
  const r = run({ notInBundles: true })
  eq(r.exit, 1, '不在 bundles 里必须阻断；输出：\n' + r.stdout)
  ok(r.stdout.includes('先别试'), '结论必须是"先别试"：\n' + r.stdout)
})

// ── ④ 版本不符 ⇒ 阻断 ────────────────────────────────────────────────
t('装的版本与期望不符 ⇒ 阻断', () => {
  const r = run({ version: '0.5.0-old', expectVersion: '0.6.0-beta.1' })
  eq(r.exit, 1, '版本不符必须阻断')
  ok(r.stdout.includes('0.5.0-old'), '应写出实际版本：\n' + r.stdout)
})

// ── ⑤ 有文件不同 ⇒ 只是警告（可能是仓库在打包后又改过），但必须点名 ──────
t('有 lib 文件与仓库不同 ⇒ 警告并点名（不阻断）', () => {
  const r = run({ tamperLib: true })
  eq(r.exit, 0, '仅"有差异"不该阻断（仓库可能确实改过）；输出：\n' + r.stdout)
  ok(r.stdout.includes('store.js'), '必须点名是哪个文件：\n' + r.stdout)
  ok(r.stdout.includes('缓存坑') || r.stdout.includes('装旧件'), '要提示这与 pnpm 缓存坑同形：\n' + r.stdout)
})

// ── ⑥ 没启用 ⇒ 警告里给出**可直接用的**开启命令 ────────────────────────
t('未启用 ⇒ 警告里给出开启办法（含 settingsVersion 标记）', () => {
  const r = run({ noEnableFile: true })
  eq(r.exit, 0, '未启用不是错误（保守默认）；输出：\n' + r.stdout)
  ok(r.stdout.includes('当前未启用'), '应报未启用：\n' + r.stdout)
  ok(r.stdout.includes('settingsVersion'), '应给出带标记的配置示例（否则 0.6 不认这份配置）：\n' + r.stdout)
})

// ── ⑦ --json 可机器读 ────────────────────────────────────────────────
t('--json 输出结构化结论', () => {
  const r = run({}, [])
  const j = JSON.parse(readFileSync(r.jsonPath, 'utf8'))
  eq(j.ok, true, 'ok')
  eq(j.profile, 'p1', 'profile')
  eq(j.problems, [], '无阻断项')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-check-install', phase: 'P8', total, pass, fail: failures.length, failures,
  note: '"装好了吗/装的是这一份吗"：逐文件 sha256 比对、bundle 层、装配层、启用配置解析。不调模型、不碰真实 home。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
