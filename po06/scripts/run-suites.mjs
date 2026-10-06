// 全量套件运行器（CI 与本地共用一个入口）。
//
// 为什么要有它（EV：本项目"946 项全绿"却仍有红灯的那次事故）：
//   套件只在人手动跑时才生效，而人不会每次都跑 90+ 个文件。
//   有了它，CI 与发版门跑的是**同一件事**，"本地绿、CI 红"这种分歧没有生存空间。
//
// 用法：node po06/scripts/run-suites.mjs [--json]
// 退出码：0 = 全绿；1 = 有套件失败。
import { readdirSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')      // po06/
const TEST = join(ROOT, 'test')
const asJson = process.argv.includes('--json')
const files = readdirSync(TEST).filter((f) => f.endsWith('.test.mjs')).sort()

// 子进程的临时目录：**先探一次能不能写**再决定用哪个。
// 为什么必须探：受限环境里系统 Temp 是不可写的（真机实测 EPERM: mkdtemp），
// 于是一大批用 tmpdir() 的套件全红——那不是代码缺陷，却会把运行器变成"永远红"，
// 而"永远红的检查"等于没有检查。CI 上系统 Temp 通常可写，会走同一条探测逻辑。
function pickTemp() {
  // ⚠ 兜底目录要**先建出来**：mkdtempSync 不会替你建父目录（第一版就栽在这，
  //   于是四个候选全部"不可写"，运行器直接退出 2）。
  const fallback = join(ROOT, '..', '.po06-tmp')
  try { mkdirSync(fallback, { recursive: true }) } catch { /* 下面探测会如实反映 */ }
  const candidates = [process.env.TEMP, process.env.TMP, tmpdir(), fallback]
  for (const c of candidates) {
    if (!c) continue
    try {
      const probe = mkdtempSync(join(c, 'po06-probe-'))
      rmSync(probe, { recursive: true, force: true })
      return c
    } catch { /* 换下一个候选 */ }
  }
  return null
}
const SUITE_TEMP = pickTemp()
if (!SUITE_TEMP) {
  console.error('找不到可写的临时目录：套件依赖 tmpdir()，请设置 TEMP/TMP 后重试')
  process.exit(2)
}
if (!asJson) console.log('临时目录：' + SUITE_TEMP)

const results = []
const failed = []
for (const f of files) {
  // ⚠ 调用方式必须与发版门**逐字相同**（直接执行该文件，不加 --test）：
  //   两种调用方式的汇总计数不一样（实测 362 vs 986），而"同一件事两个数字"就是漂移的来源。
  const r = spawnSync(process.execPath, [join(TEST, f)], { encoding: 'utf8', maxBuffer: 4e7, timeout: 900000, env: { ...process.env, TEMP: SUITE_TEMP, TMP: SUITE_TEMP } })
  // ⚠ 汇总**只从 stdout 解析**：stderr 里常有 git 的换行警告，拼在后面会让
  //   "以 JSON 结尾"这个前提失效，于是明明有汇总的套件被判成"读不出"（实测踩过一次）。
  //   stderr 仍然保留在 tail 里供人看。
  const stdout = String(r.stdout || '')
  const out = stdout + String(r.stderr || '')
  // 读法与发版门**完全一致**（两种套件风格都要认）：
  //   ① 自研 runner：结束时打印一行 JSON（多行美化也要认）——它们会 process.exit()，
  //      node 来不及打 TAP 汇总，只认 ℹ 行的读法会把它们全判成"读不出"（实测 41 套误报）。
  //   ② node:test：ℹ pass / ℹ fail 汇总行。
  const lastJson = () => {
    for (let i = stdout.length - 1, tries = 0; i >= 0 && tries < 40; i--) {
      if (stdout[i] !== '{') continue
      tries += 1
      try {
        const v = JSON.parse(stdout.slice(i))
        if (v && typeof v === 'object' && typeof v.pass === 'number' && typeof v.fail === 'number') return v
      } catch { /* 不是完整 JSON，继续往前找 */ }
    }
    return null
  }
  const j = lastJson()
  const num = (label) => {
    const m = stdout.match(new RegExp('^[\\s#\u2139]*' + label + '\\s+(\\d+)\\s*$', 'm'))
    return m ? Number(m[1]) : null
  }
  const pass = j ? j.pass : num('pass')
  const fail = j ? j.fail : num('fail')
  // 一条计数都读不出来 ⇒ 不能算通过（"自述 fail=0 却崩溃"和"什么都没说"都不是证据）
  const ok = r.status === 0 && fail === 0
  const entry = { file: f, pass, fail, exit: r.status, ok }
  results.push(entry)
  if (!ok) {
    failed.push({ ...entry, unparsable: fail === null, tail: out.split('\n').filter(Boolean).slice(-12) })
    if (!asJson) {
      console.log('FAIL ' + f + '  (pass=' + pass + ' fail=' + fail + ' exit=' + r.status + ')')
      for (const line of (failed.at(-1).tail || []).slice(-8)) console.log('    ' + line)
    }
  }
}

const summary = {
  suites: files.length,
  passed: results.filter((x) => x.ok).length,
  failed: failed.length,
  passTotal: results.reduce((s, x) => s + (x.pass || 0), 0),
  failing: failed.map((x) => x.file),
}
// 产物与发版门放同一处（po06/eval/）：CI 直接上传这个路径，人也能在同一处找到两份报告。
writeFileSync(join(ROOT, 'eval', 'release-suites.json'), JSON.stringify({ at: new Date().toISOString(), summary, results, failed }, null, 2) + '\n', 'utf8')
if (asJson) console.log(JSON.stringify(summary, null, 2))
else console.log('SUITES ' + summary.suites + ' · passed ' + summary.passed + ' · failed ' + summary.failed + ' · assertions ' + summary.passTotal)
process.exit(failed.length === 0 ? 0 : 1)
