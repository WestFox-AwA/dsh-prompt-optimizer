// P8 · **装好了吗？装的是这一份吗？** —— 跑真实项目**之前**的自检。
//
//   node po06/scripts/check-install.mjs [--profile po06beta] [--home <DSH_HOME>]
//                                       [--expect-version <v>] [--json out.json]
//
// 为什么需要（EV-0119）：这个项目在"装"这件事上**栽过三次**：
//   · EV-0066：装了却没有 bundle 层 ⇒ `dsh plugin add` 打印"installed as a plain dependency,
//     **not a profile layer**"——**装上了，却永远不会被装配**；
//   · EV-0079 / EV-0083：`dsh plugin add <同一个 tgz 路径>` 会因 pnpm 缓存**装回旧代码**
//     （实测 verdict 还是旧串）⇒ 必须"每次用新路径 + 装完先确认装的是哪一份"。
// 这三条的共同点是：**失败时不报错，只是行为像没装**。所以把它做成一条命令，
// 让"准备好了"变成一个**可复核的断言**，而不是"应该没问题吧"。
//
// 本脚本不调模型、不花钱；只读文件 + 跑一次 `--dump-config`（不启动服务）。
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const REPO = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const DSH_HOME = opt('home', process.env.DSH_HOME || join(homedir(), '.dsh'))
const PROFILE = opt('profile', 'po06beta')
const EXPECT_VERSION = opt('expect-version', null)
const JSON_OUT = opt('json', null)
const PKG_NAME = '@dsh-external/dsh-po06'
const OLD_PKG = '@dsh-external/dsh-prompt-optimizer'

const L = []
const problems = []
const warnings = []
const say = (s = '') => L.push(s)
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

const profileDir = join(DSH_HOME, 'profiles', PROFILE)
const installed = join(profileDir, 'node_modules', PKG_NAME)

say('# 装好了吗 · profile `' + PROFILE + '`')
say('')
say('- home：`' + DSH_HOME + '`')
say('- profile：`' + profileDir + '`')
say('')

// ── ① profile 存在、依赖里有没有这个包 ────────────────────────────────
say('## 一、装上了吗')
say('')
if (!existsSync(profileDir)) {
  say('- ❌ profile 目录不存在')
  problems.push('profile 不存在：' + profileDir)
} else {
  say('- ✅ profile 目录存在')
  const pkgJson = join(profileDir, 'package.json')
  let listed = false
  if (existsSync(pkgJson)) {
    try {
      const p = JSON.parse(readFileSync(pkgJson, 'utf8'))
      listed = Boolean((p.dependencies || {})[PKG_NAME])
    } catch { /* 坏 JSON 下面按未列出处理 */ }
  }
  say('- ' + (listed ? '✅' : '⚠') + ' profile 的 dependencies ' + (listed ? '里有' : '里**没有**') + ' `' + PKG_NAME + '`')
  if (!listed) warnings.push('profile 的 package.json 里没列出该包（可能是别的方式挂上的，但值得看一眼）')
}

// ── ② 装出来的那一份**是不是这一份**（逐文件比 hash，不靠标记串）────────
say('')
say('## 二、装的是这一份吗（逐文件比 sha256）')
say('')
const repoLib = join(REPO, 'lib')
const instLib = join(installed, 'lib')
if (!existsSync(installed)) {
  say('- ❌ 找不到装出来的包：`' + installed + '`')
  problems.push('装出来的包不存在（没装成，或装到了别的 profile）')
} else {
  const rv = existsSync(join(installed, 'package.json'))
    ? JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version : null
  say('- 装出来的版本：**' + rv + '**' + (EXPECT_VERSION ? '（期望 ' + EXPECT_VERSION + '）' : ''))
  if (EXPECT_VERSION && rv !== EXPECT_VERSION) problems.push('版本不符：装的 ' + rv + '，期望 ' + EXPECT_VERSION)
  for (const f of ['cordis.patch.yml']) {
    say('- ' + (existsSync(join(installed, f)) ? '✅' : '❌') + ' `' + f + '`（**bundle 层**：没有它装了也不会被装配，EV-0066）')
    if (!existsSync(join(installed, f))) problems.push('缺 ' + f + ' ⇒ 装了也不会被装配')
  }
  if (existsSync(repoLib) && existsSync(instLib)) {
    const same = [], diff = []
    for (const f of readdirSync(repoLib).filter((x) => x.endsWith('.js'))) {
      const a = join(repoLib, f), b = join(instLib, f)
      if (!existsSync(b)) { diff.push(f + '(缺)'); continue }
      if (sha(a) === sha(b)) same.push(f); else diff.push(f)
    }
    say('- lib 模块：**' + same.length + ' 个与仓库逐字节相同**'
      + (diff.length ? '，**' + diff.length + ' 个不同**：' + diff.join(', ') : '，无差异'))
    if (diff.length > 0) {
      warnings.push('有 ' + diff.length + ' 个 lib 文件与仓库当前内容不同（'
        + diff.join(', ') + '）——可能是"装了旧件"（EV-0079/0083 的缓存坑），也可能是仓库在打包之后又改过代码。'
        + '**装旧件时不会有任何报错**，只是行为像没装。')
    }
  } else {
    warnings.push('拿不到仓库的 `lib/`，跳过逐文件比对')
  }
}

// ── ③ 装配层真的挂上了吗（这才是 EV-0066 的正题）───────────────────────
say('')
say('## 三、会被装配吗（`--dump-config`）')
say('')
let dump = null
// 没装就**明说跳过**：空标题下面什么都不写，读起来像"这一节没查"，而它其实查不了（EV-0135）。
const pkgPresent = existsSync(join(installed, 'lib', 'assembly-gate.js'))
if (!pkgPresent) {
  say('- ⏭ 跳过：包还没装上（这一节要读 `dsh --profile ' + PROFILE + ' --dump-config` 的组合结果）')
}
if (existsSync(profileDir)) {
  try {
    // ⚠ Windows 上 `dsh` 是 `dsh.cmd`/`dsh.ps1` 而不是可执行文件：
    // 不加 `shell` 的话 `execFileSync('dsh', …)` 会 ENOENT —— 而**步骤会静默变成"没输出"**，
  // 看起来像"没有装配层"。这一类"命令没跑起来、却被读成结论"的坑本脚本自身也要防。
    dump = execFileSync('dsh', ['--profile', PROFILE, '--dump-config'],
      // `DSH_HOME` 必须跟着 `--home` 走：否则 `--home` 只改了**我们读哪里**，
      // `dsh` 子进程仍然看真实 home——在测试里那等于拿**用户的真环境**当 playground。
      // stderr 一律吞掉：profile 组合不起来是**预期内的失败路径**（下面会把它变成一条警告），
      // 让宿主的堆栈刷满屏幕会把**真正的失败**淹掉——"满屏噪声的检查等于没有检查"。
      { encoding: 'utf8', timeout: 60_000, shell: true, maxBuffer: 2e7,
        stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, DSH_HOME } })
  } catch (e) {
    warnings.push('跑 `dsh --profile ' + PROFILE + ' --dump-config` 失败：' + String(e.message || e).slice(0, 120))
  }
}
if (dump !== null) {
  const hasLayer = dump.includes(PKG_NAME)
  say('- ' + (hasLayer ? '✅' : '❌') + ' 组合出的装配树里' + (hasLayer ? '有' : '**没有**') + ' `' + PKG_NAME + '` 这一层')
  if (!hasLayer) problems.push('装配树里没有该包 ⇒ 装上也不会生效（EV-0066 同款）')
  const oldLayer = dump.includes(OLD_PKG)
  say('- ' + (oldLayer ? '⚠' : '✅') + ' 同一 profile 里' + (oldLayer ? '**也有**旧插件' : '没有旧插件')
    + (oldLayer ? ' ⇒ 0.6 会以 `DOUBLE_INTERCEPT` **拒绝启用**（刻意的）' : '（不会撞双重拦截）'))
  if (oldLayer) warnings.push('旧插件在同一个 profile 里 ⇒ 0.6 会被 DOUBLE_INTERCEPT 拒绝启用；要试 0.6 请用干净 profile')
}

// ── ④ 启用配置：用**装出来的那份**解析器读（不靠我复述规则）────────────
say('')
say('## 四、启用配置会生效吗')
say('')
const primary = join(DSH_HOME, 'po06.json')
const legacy = join(DSH_HOME, 'prompt-optimizer.json')
// 这一节**必须**用装出来的那份解析器（不复述规则）；包不在就跳过并说明，
// **不要**把它变成"用装出来的解析器读配置失败：Cannot find module …"——
// 那只是"没装"的**后果**，上面已经报过一次了；重复报一次会把"没装"读成"装坏了"（EV-0135）。
if (!pkgPresent) {
  say('- ⏭ 跳过：包还没装上（这一节要用**装出来的那份解析器**读配置，不复述规则）')
} else try {
  const gate = await import(pathToFileURL(join(installed, 'lib', 'assembly-gate.js')).href)
  const read = (p) => { try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null } }
  const picked = gate.pickEnableIntent(read(primary), read(legacy))
  say('- 0.6 的配置：`' + primary + '` ' + (existsSync(primary) ? '（存在）' : '（**不存在** ⇒ 不启用）'))
  say('- 解析结果：`ours=' + picked.ours + ', enabled=' + picked.settings.enabled
    + ', rollout=' + picked.rollout.mode + '`' + (picked.reason ? '（' + picked.reason + '）' : ''))
  if (!picked.settings.enabled) {
    warnings.push('0.6 **当前未启用**：' + (picked.reason || '配置说 enabled=false')
      + '。写 `' + primary + '` 为 {"settingsVersion":1,"enabled":true,"rollout":{"mode":"all"}} 即可开启。')
  }
  if (existsSync(legacy)) {
    const oldParsed = gate.parseEnableIntent(read(legacy))
    say('- 旧路径 `prompt-optimizer.json`：' + (oldParsed.ours ? '**被当成 0.6 的配置**' : '不是 0.6 的配置（'
      + oldParsed.reason + '）⇒ 不会误启用，也不该被写'))
  }
} catch (e) {
  warnings.push('用装出来的解析器读配置失败：' + String(e.message || e).slice(0, 140))
}

// ── ⑤ 结论与下一步 ───────────────────────────────────────────────────
say('')
say('## 结论')
say('')
if (problems.length === 0) {
  say('✅ **可以开始试了。**')
  say('')
  say('```powershell')
  say('dsh --profile ' + PROFILE + '            # 启动（会打印带 token 的地址）')
  say('```')
  say('')
  say('跑过一轮之后看它做了什么：')
  say('```powershell')
  say('node ' + join(REPO, 'scripts', 'recap.mjs') + ' --home "' + DSH_HOME + '"')
  say('```')
} else {
  say('❌ **先别试**，上一节有阻断项：')
  for (const p of problems) say('- ' + p)
  // 冷启动时（**还没装**就跑这个命令）最该给的是一条能照抄的装法，
  // 而不是让用户自己去翻文档（EV-0135：这一页存在的意义就是"装好了吗"）。
  if (!pkgPresent) {
    say('')
    say('装法（把 `<tgz>` 换成你下载到的那个 `dsh-external-dsh-po06-<版本>.tgz` 的路径）：')
    say('```powershell')
    say('dsh plugin --profile ' + PROFILE + ' add <tgz>')
    say('node ' + join(REPO, 'scripts', 'check-install.mjs') + ' --profile ' + PROFILE + ' --expect-version <版本>')
    say('```')
    say('细节见 `po06/README.md` 的「30 秒：装上、启用、关掉」。')
  }
}
if (warnings.length > 0) {
  say('')
  say('## ⚠ 值得看一眼（不阻断）')
  say('')
  for (const w of warnings) say('- ' + w)
}

process.stdout.write(L.join('\n') + '\n')
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    home: DSH_HOME, profile: PROFILE, installed, problems, warnings,
    ok: problems.length === 0,
  }, null, 2) + '\n', 'utf8')
}
process.exit(problems.length === 0 ? 0 : 1)
