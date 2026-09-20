// P8 · **真实 npm 安装/卸载**演练（补齐 A11 的最后一格）
//
//   node po06/scripts/npm-drill.mjs [--keep]
//
// 与 install-drill.mjs 的分工：
//   · install-drill：**包内容**是否正确（只应含 lib/README/package.json）、能否在仓库外 import。
//   · 本脚本：**真实 npm 安装链路**——把 tgz 当一个依赖装进一个隔离工程，再卸掉。
// 后者测的东西前者测不到：
//   · npm 会不会真的接受这个包（`private:true`、`exports` 映射、`main` 指向是否存在）；
//   · `peerDependencies.cordis` 是否**确实**被声明为 optional——这是"没装 cordis 也能装上"的前提；
//   · 卸载后是否**真的一点不剩**（node_modules 条目 + package.json 依赖项）。
// 本机日常走的是 junction 注入路径，所以这条链路此前**从未被测过**。
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const KEEP = process.argv.includes('--keep')
const DRILL = join(tmpdir(), 'po06-npm-drill')
const PKG = '@dsh-external/dsh-po06'

const report = { probe: 'po06-npm-drill', phase: 'P8', at: new Date().toISOString(), steps: {}, ok: false }

const npm = (args, cwd) => execFileSync('npm', args, { cwd, stdio: 'pipe', shell: true, encoding: 'utf8' })

try {
  // ── 1. pack ────────────────────────────────────────────────────────
  rmSync(DRILL, { recursive: true, force: true })
  mkdirSync(DRILL, { recursive: true })
  npm(['pack', '--pack-destination', DRILL, '--silent'], ROOT)
  const tgzName = readdirSync(DRILL).find((n) => n.endsWith('.tgz'))
  if (!tgzName) throw new Error('npm pack 没有产出 tgz')
  const tgzPath = join(DRILL, tgzName)
  const tgzSha = createHash('sha256').update(readFileSync(tgzPath)).digest('hex')
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  report.steps.pack = { tgz: tgzName, sha256: tgzSha, name: declared.name, version: declared.version }

  // ── 2. 隔离工程 + 真实安装 ─────────────────────────────────────────
  const proj = join(DRILL, 'project')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'package.json'),
    JSON.stringify({ name: 'po06-npm-drill-project', version: '0.0.0', private: true }, null, 2) + '\n', 'utf8')
  // 刻意**不安装 cordis**：若 peer 不是 optional，这里就会失败
  let installOut = ''
  let installError = null
  try { installOut = npm(['install', tgzPath, '--no-audit', '--no-fund', '--silent'], proj) } catch (e) {
    installError = String((e && (e.stderr || e.message)) || e).slice(0, 500)
  }
  const installedDir = join(proj, 'node_modules', ...PKG.split('/'))
  const installedPkgJson = join(installedDir, 'package.json')
  const installed = existsSync(installedPkgJson)
  report.steps.install = {
    ok: installed && !installError,
    error: installError,
    installedPath: installed ? installedDir : null,
    versionOnDisk: installed ? JSON.parse(readFileSync(installedPkgJson, 'utf8')).version : null,
    versionMatches: installed ? JSON.parse(readFileSync(installedPkgJson, 'utf8')).version === declared.version : false,
    cordisInstalled: existsSync(join(proj, 'node_modules', 'cordis')),
  }

  // ── 3. 装上去的这份能否被**另一个进程** import（真实消费方视角）──────
  // ⚠ 必须另起进程：同进程内 `import()` 会命中 ESM 模块缓存，
  //   即使文件已经被删掉也照样"成功"——那样这条断言就永远为真。
  //   （这不是推测：反向对照第一次就是因此失败的。）
  const entryUrl = 'file:///' + join(installedDir, 'lib', 'index.js').replace(/\\/g, '/')
  const tryImport = () => {
    try {
      const out = execFileSync(process.execPath, ['-e',
        `import(${JSON.stringify(entryUrl)}).then(m=>console.log(JSON.stringify(Object.keys(m).sort()))).catch(e=>{console.error(String(e&&e.message||e));process.exit(1)})`,
      ], { cwd: proj, encoding: 'utf8' })
      return { ok: true, exports: JSON.parse(out.trim()) }
    } catch (e) {
      return { ok: false, error: String((e && (e.stderr || e.message)) || e).split('\n')[0].slice(0, 200) }
    }
  }
  const importCheck = installed ? tryImport() : { ok: false, error: 'not-installed' }
  report.steps.importInstalled = importCheck

  // ── 3b. 反向对照：**故意弄坏装上去的那份，import 必须失败** ────────
  // 一条从没红过的断言不算证据（本项目已因"永远为真的测试"吃过两次亏）。
  if (installed && importCheck.ok) {
    const entryFile = join(installedDir, 'lib', 'index.js')
    const stash = join(installedDir, 'lib', 'index.js.__moved')
    let failedAsExpected = null
    try {
      renameSync(entryFile, stash)
      failedAsExpected = tryImport().ok === false
    } catch (e) {
      failedAsExpected = null
      report.steps.negativeControlError = String((e && e.message) || e)
    } finally {
      try { if (existsSync(stash)) renameSync(stash, entryFile) } catch { /* best effort */ }
    }
    report.steps.negativeControl = {
      ok: failedAsExpected === true,
      note: '入口文件移走后、另起进程 import 必须失败；失败=这条断言真的在检测',
      importFailedWhenBroken: failedAsExpected,
    }
  }

  // ── 4. peer 必须声明为 optional（"没装 cordis 也能装上"的前提）────
  report.steps.peerOptional = {
    declared: declared.peerDependencies || null,
    optional: Boolean(declared.peerDependenciesMeta && declared.peerDependenciesMeta.cordis
      && declared.peerDependenciesMeta.cordis.optional === true),
  }

  // ── 5. 真实卸载 + 残留核查 ─────────────────────────────────────────
  let uninstallError = null
  try { npm(['uninstall', PKG, '--no-audit', '--no-fund', '--silent'], proj) } catch (e) {
    uninstallError = String((e && (e.stderr || e.message)) || e).slice(0, 300)
  }
  const scopeDir = join(proj, 'node_modules', '@dsh-external')
  const projPkgAfter = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'))
  report.steps.uninstall = {
    ok: !uninstallError && !existsSync(installedDir),
    error: uninstallError,
    packageDirGone: !existsSync(installedDir),
    scopeDirLeft: existsSync(scopeDir) ? readdirSync(scopeDir) : [],
    depsAfter: projPkgAfter.dependencies || {},
    stillInDeps: Boolean(projPkgAfter.dependencies && projPkgAfter.dependencies[PKG]),
  }

  // ── 判定 ───────────────────────────────────────────────────────────
  report.ok = report.steps.install.ok
    && report.steps.install.versionMatches
    && !report.steps.install.cordisInstalled          // 没装 cordis 也装上了 = peer 确实可选
    && importCheck.ok
    && report.steps.negativeControl && report.steps.negativeControl.ok   // 反向对照必须成立
    && report.steps.peerOptional.optional
    && report.steps.uninstall.ok
    && !report.steps.uninstall.stillInDeps
    && report.steps.uninstall.scopeDirLeft.length === 0
  const neg = report.steps.negativeControl
  report.verdict = report.ok
    ? 'PASS: 真实 npm 安装/卸载链路通过——装得上（无 cordis 也可）、能 import（且坏件确实 import 失败）、卸得净'
    : (neg && neg.ok === false
      ? 'FAIL: 反向对照不成立——把入口文件移走后 import 竟然还成功，说明"能 import"这条断言不可信'
      : 'CHECK: 见各步骤字段')
} catch (e) {
  report.error = String((e && e.stack) || e)
  report.verdict = 'ERROR: ' + String((e && e.message) || e)
} finally {
  writeFileSync(join(ROOT, 'eval', 'npm-drill.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  if (!KEEP) { try { rmSync(DRILL, { recursive: true, force: true }) } catch { /* best effort */ } }
}

console.log(JSON.stringify({
  ok: report.ok, verdict: report.verdict,
  install: report.steps.install, peerOptional: report.steps.peerOptional,
  importInstalled: report.steps.importInstalled, uninstall: report.steps.uninstall,
  written: 'po06/eval/npm-drill.json',
}, null, 2))
process.exit(report.ok ? 0 : 1)
