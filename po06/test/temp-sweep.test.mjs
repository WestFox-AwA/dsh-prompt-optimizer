// P8 · 陈旧临时目录清扫（`lib/temp-sweep.js`）的单测。
//
// 运行：node po06/test/temp-sweep.test.mjs
//
// 为什么给它配单测（EV-0129）：它的**唯一危险**是"清错东西"——
// 正在跑的测试刚建的目录要是被清掉，就会得到**随机失败**（最难查的那种）。
// 所以"够旧才清"这条必须是可断言的事实，而不是"我小心一点"。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepStaleTemp, TEMP_PREFIXES, DEFAULT_MIN_AGE_MS } from '../lib/temp-sweep.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const DIRS = []
process.on('exit', () => { for (const d of DIRS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/** 造一个假 tmpdir，里面放我们的陈旧的/新鲜的目录，以及**别人的**目录。 */
function fakeTmp() {
  const base = mkdtempSync(join(tmpdir(), 'po06-sweeptest-'))
  DIRS.push(base)
  const mk = (name, ageMs) => {
    const p = join(base, name)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'x.txt'), 'x', 'utf8')
    const when = (Date.now() - ageMs) / 1000
    utimesSync(p, when, when)
    return p
  }
  return { base, mk }
}

t('只清"够旧"的：新目录一定留下（绝不碰正在跑的测试）', () => {
  const { base, mk } = fakeTmp()
  const oldDir = mk('po06-docs-old', DEFAULT_MIN_AGE_MS + 60_000)
  const freshDir = mk('po06-docs-fresh', 1000)
  const r = sweepStaleTemp({ tmpDir: base })
  eq(r.removed, ['po06-docs-old'], '只应清掉旧的：' + JSON.stringify(r))
  eq(existsSync(oldDir), false, '旧目录应被清掉')
  eq(existsSync(freshDir), true, '**新目录必须留着**（那是正在跑的测试的）')
  eq(r.kept, 1, 'kept 计数')
  eq(r.scanned, 2, 'scanned 计数')
})

t('前缀白名单：**别人的临时目录一个都不许碰**', () => {
  const { base, mk } = fakeTmp()
  const foreign = mk('other-tool-xyz', DEFAULT_MIN_AGE_MS + 60_000)
  const ours = mk('po06-inst-old', DEFAULT_MIN_AGE_MS + 60_000)
  const r = sweepStaleTemp({ tmpDir: base, prefixes: TEMP_PREFIXES })
  eq(r.removed, ['po06-inst-old'], '只清我们前缀的：' + JSON.stringify(r))
  eq(existsSync(foreign), true, '别人的目录必须原样留着')
  eq(existsSync(ours), false, '我们的旧目录清掉')
})

t('删除失败要**如实报出来**，不许当成清干净了', () => {
  const { base, mk } = fakeTmp()
  mk('po06-docs-locked', DEFAULT_MIN_AGE_MS + 60_000)
  const r = sweepStaleTemp({
    tmpDir: base,
    rm: () => { throw new Error('EPERM: 被占用') },
  })
  eq(r.removed, [], '没删掉就不能报删了')
  eq(r.errors.length, 1, '必须记一条错误：' + JSON.stringify(r))
  ok(/EPERM/.test(r.errors[0]), '错误内容要带上原因：' + r.errors[0])
})

t('目录不存在/读不了 ⇒ 报错返回，不抛', () => {
  const r = sweepStaleTemp({ tmpDir: join(tmpdir(), 'po06-definitely-missing-' + Date.now()) })
  eq(r.removed, [], '没东西可清')
  ok(r.errors.length === 1, '应报一条 readdir 错误：' + JSON.stringify(r))
})

t('阈值可注入（便于测试与调参），默认 10 分钟', () => {
  eq(DEFAULT_MIN_AGE_MS, 600000, '默认 10 分钟')
  const { base, mk } = fakeTmp()
  mk('po06-docs-30s', 30_000)
  eq(sweepStaleTemp({ tmpDir: base }).removed, [], '默认阈值下 30 秒的目录留着')
  eq(sweepStaleTemp({ tmpDir: base, minAgeMs: 10_000 }).removed, ['po06-docs-30s'], '阈值调到 10 秒就该清')
})

const total = pass + failures.length
console.log(JSON.stringify({
  suite: 'po06-temp-sweep', phase: 'P8', total, pass, fail: failures.length, failures,
  note: '只清我们前缀且够旧的临时目录；别人的与新的一律不碰；删不掉要如实报。不调模型。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
