// P8 · **陈旧测试临时目录清扫**。
//
// 为什么需要（EV-0129）：单测的 fixture 都在 `os.tmpdir()` 下建自己的目录，
// 靠 `process.on('exit')` 清掉。**这个机制在进程被强杀时不会执行**——
// 而"被强杀"在本项目里不是意外，而是**我自己反复犯的操作习惯**：
// 把测试输出管道给 `Select-String` / `Select-Object -First N`，
// PowerShell 关闭管道就把还在跑的上游进程杀掉，退出钩子来不及跑。
// 实测两次：一次留下 6 个 `po06-inst-*`，一次留下 14 个 `po06-docs-*`。
//
// 归因清楚了就得用**机制**而不是"下次注意"：发版门（`check-release`）开跑前扫一遍
// `tmpdir()` 里我们自己的前缀，把**够旧**的目录清掉（默认 10 分钟）。
// 时间阈值是为了**绝不碰正在跑的测试**：它们刚建的目录一定是新的。
import { readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 本项目自己的临时目录前缀（只清这些，绝不碰别人的）。 */
export const TEMP_PREFIXES = Object.freeze(['po06-'])
/** 默认只清 10 分钟以上的：正在跑的测试刚建的目录一定是新的。 */
export const DEFAULT_MIN_AGE_MS = 10 * 60 * 1000

/**
 * 清扫陈旧临时目录。
 * @param opts.tmpDir   默认 `os.tmpdir()`
 * @param opts.prefixes 只清这些前缀（白名单，**不做模糊匹配**）
 * @param opts.minAgeMs 只清"最后修改时间早于 now - minAgeMs"的
 * @param opts.now      注入时间（便于测试）
 * @param opts.rm       注入删除实现（便于测试；默认 `rmSync`）
 * @returns {{scanned:number, removed:string[], kept:number, errors:string[]}}
 */
export function sweepStaleTemp(opts = {}) {
  const dir = opts.tmpDir || tmpdir()
  const prefixes = Array.isArray(opts.prefixes) && opts.prefixes.length ? opts.prefixes : TEMP_PREFIXES
  const minAgeMs = Number.isFinite(opts.minAgeMs) ? opts.minAgeMs : DEFAULT_MIN_AGE_MS
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const rm = typeof opts.rm === 'function' ? opts.rm : (p) => rmSync(p, { recursive: true, force: true })

  const out = { scanned: 0, removed: [], kept: 0, errors: [] }
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) {
    out.errors.push('readdir:' + String((e && e.message) || e))
    return out
  }
  for (const e of entries) {
    if (!prefixes.some((p) => e.name.startsWith(p))) continue
    out.scanned += 1
    const full = join(dir, e.name)
    let age = 0
    try { age = now - statSync(full).mtimeMs } catch (err) {
      out.errors.push('stat:' + e.name + ':' + String((err && err.message) || err))
      continue
    }
    // **够旧才清**：正在跑的测试刚建的目录一定是新的，绝不能碰
    if (age < minAgeMs) { out.kept += 1; continue }
    try { rm(full); out.removed.push(e.name) } catch (err) {
      out.errors.push('rm:' + e.name + ':' + String((err && err.message) || err))
    }
  }
  return out
}
