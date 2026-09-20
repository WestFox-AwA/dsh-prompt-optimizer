// P8 · 打包产物装配演练（release action D3 + A11）
//
//   node po06/scripts/install-drill.mjs [--keep]
//
// 为什么需要它：此前所有验证都跑在**源码树**上（`po06/lib/...`），
// 而真正会发出去的是 `npm pack` 出来的 tgz。两者不是一回事：
//   · `files` 清单若漏了某个被 require 的模块 ⇒ 源码树全绿，装出来直接崩；
//   · 源码树里 test/ eval/ scripts/ 都在，装了之后**不在**——
//     若 lib 里偷偷依赖了它们，源码树永远查不出来。
// 所以本演练只做一件事：**只拿打包产物**，在仓库之外装配一次。
//
// 步骤：pack → 解包到隔离目录 → 内容集合核对 → **从仓库外动态 import** →
//       源树字节未变核对 → 报告。宿主侧注入/卸载由 dev_* 工具在本脚本之外完成。
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')            // po06/
const REPO = join(ROOT, '..')            // 仓库根
const KEEP = process.argv.includes('--keep')
const DRILL = join(tmpdir(), 'po06-install-drill')

const report = { probe: 'po06-install-drill', phase: 'P8', at: new Date().toISOString(), steps: {}, ok: false }

function walk(dir, base = dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, base))
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out.sort()
}

/** 源树在演练前后的快照（用来证明演练没有偷偷改源码）。 */
function sourceSnapshot() {
  const files = ['lib', 'package.json', 'README.md']
  const snap = {}
  for (const f of files) {
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      for (const rel of walk(p, ROOT)) {
        if (rel.startsWith(f + '/')) snap[rel] = createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex')
      }
    } else {
      snap[f] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  return snap
}

try {
  const before = sourceSnapshot()

  // ── 1. pack ────────────────────────────────────────────────────────
  rmSync(DRILL, { recursive: true, force: true })
  mkdirSync(DRILL, { recursive: true })
  // 在隔离目录里 pack（把 tgz 放在隔离目录，避免污染仓库）
  execFileSync('npm', ['pack', '--pack-destination', DRILL, '--silent'], { cwd: ROOT, stdio: 'pipe', shell: true })
  const tgzName = readdirSync(DRILL).find((n) => n.endsWith('.tgz'))
  if (!tgzName) throw new Error('npm pack 没有产出 tgz')
  const tgzPath = join(DRILL, tgzName)
  const tgzSha = createHash('sha256').update(readFileSync(tgzPath)).digest('hex')
  report.steps.pack = { tgz: tgzName, bytes: statSync(tgzPath).size, sha256: tgzSha }

  // ── 2. 解包到隔离目录 ──────────────────────────────────────────────
  const ext = join(DRILL, 'extracted')
  mkdirSync(ext, { recursive: true })
  execFileSync('tar', ['-xzf', tgzPath, '-C', ext], { stdio: 'pipe' })
  const pkgDir = join(ext, 'package')
  const files = walk(pkgDir)
  report.steps.content = { count: files.length, files }

  // ── 3. 内容集合核对：只应有 lib/*.js + package.json + README.md + cordis.patch.yml ──
  // `cordis.patch.yml` 是 **bundle 层**：没有它，`dsh plugin add` 会打印
  // "declares no dsh.bundle — installed as a plain dependency, **not a profile layer**"
  // ⇒ 装上了却**永远不会被装配**（EV-0066）。所以它必须随包发行，也必须在这里被认下来。
  // （这条期望值曾经是"只有 lib+package.json+README"，加了 bundle 层之后没同步，
  //   重跑演练时如实报红——这正是这个演练存在的意义。）
  const ALLOWED = (f) => f === 'package.json' || f === 'README.md'
    || f === 'cordis.patch.yml' || /^lib\/[^/]+\.js$/.test(f)
  const bad = files.filter((f) => !ALLOWED(f))
  const libCount = files.filter((f) => /^lib\/.*\.js$/.test(f)).length
  report.steps.contentCheck = {
    onlyDeclared: bad.length === 0, unexpected: bad, libCount,
    hasBundleLayer: files.includes('cordis.patch.yml'),
    hasTestDir: files.some((f) => f.startsWith('test/')),
    hasScriptsDir: files.some((f) => f.startsWith('scripts/')),
    hasEvalDir: files.some((f) => f.startsWith('eval/')),
  }

  // ── 4. 从**仓库之外**动态 import：证明包是自足的 ────────────────────
  //     cwd 设在隔离目录，且只给解包出来的这一份代码。
  const entry = 'file:///' + join(pkgDir, 'lib', 'index.js').replace(/\\/g, '/')
  let imported = null
  try {
    const mod = await import(entry)
    imported = { ok: true, exports: Object.keys(mod).sort() }
  } catch (e) {
    imported = { ok: false, error: String((e && e.message) || e) }
  }
  report.steps.standaloneImport = imported

  // ── 5. 源树未变 ────────────────────────────────────────────────────
  const after = sourceSnapshot()
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k])
  report.steps.sourceUnchanged = { ok: changed.length === 0, changed }

  // ── 判定 ───────────────────────────────────────────────────────────
  report.ok = report.steps.contentCheck.onlyDeclared
    && !report.steps.contentCheck.hasTestDir
    && !report.steps.contentCheck.hasScriptsDir
    && !report.steps.contentCheck.hasEvalDir
    && report.steps.contentCheck.hasBundleLayer      // bundle 层必须在包里（EV-0066）
    && libCount > 0
    && imported.ok
    && report.steps.sourceUnchanged.ok
  report.verdict = report.ok
    ? `PASS: 打包产物自足——${libCount} 个 lib 模块 + package.json + README + cordis.patch.yml，`
      + '仓库外可直接 import；未夹带 test/scripts/eval；源树字节未变'
    : 'CHECK: 见各步骤字段'
  report.packageDir = pkgDir
} catch (e) {
  report.error = String((e && e.stack) || e)
  report.verdict = 'ERROR: ' + String((e && e.message) || e)
} finally {
  writeFileSync(join(ROOT, 'eval', 'install-drill.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  if (!KEEP) {
    try { rmSync(DRILL, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

console.log(JSON.stringify({
  ok: report.ok, verdict: report.verdict,
  pack: report.steps.pack, contentCheck: report.steps.contentCheck,
  standaloneImport: report.steps.standaloneImport,
  sourceUnchanged: report.steps.sourceUnchanged,
  kept: KEEP, packageDir: KEEP ? report.packageDir : null,
  written: 'po06/eval/install-drill.json',
}, null, 2))
process.exit(report.ok ? 0 : 1)
