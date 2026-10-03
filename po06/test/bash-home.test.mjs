// 内置 Bash 的 `HOME`：自带 MSYS2 运行时在 win32 上必须显式指向**真实用户目录**。
//
// 为什么值得一套专属测试：这条 bug 的表现是**假阴性**——`git config --global --get …`
// 只是静默返回空（rc=1），不报错、不崩、日志里什么都没有，所以只能靠"注入 provision
// 后断言真正传进 governor 的 `req.env.HOME`"来钉住，不能靠肉眼看输出。
//
// 断言口径（合成值，不含任何本机路径）：
//   1. win32 + 自带 bundle ⇒ 接管，取 USERPROFILE（覆盖 MSYS 兜底出来的 /home/<账户>）；
//   2. win32 + 自带 bundle + DSH_BASH_HOME ⇒ 逃生口优先（隔离语义用这个显式声明）；
//   3. win32 + 自带 bundle + 只有 HOMEDRIVE/HOMEPATH ⇒ 用二者拼接；
//   4. win32 + 自带 bundle + 三者都没有 ⇒ 回落 os.homedir()；
//   5. 非 win32 ⇒ **不接管**（本 bug 的载体是 MSYS2）；
//   6. 来源不是自家 bundle（git-for-windows / 系统 MSYS2 / PATH）⇒ 不接管；
//   7. 显式 config.bashPath ⇒ 不接管，且根本不去解析运行时。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/bash/index.js'
import * as ws from '../lib/bash/workspace-semantics.mjs'

const WIN = process.platform === 'win32'
const ONLY_WIN = WIN ? false : '仅 win32：本问题是 MSYS2 载体（README「内置 Bash」按 win32 生效）'

const root = mkdtempSync(join(tmpdir(), 'po06-bash-home-'))
const session = { id: 'bash-home-session', header: { cwd: root } }
process.env.DSH_HOME = root

// 合成路径：**不许**写死作者机器上的 C:\Users\<某人>，否则换台机器就变成环境依赖。
const BUNDLED = 'C:\\plugin\\runtime\\usr\\bin\\bash.exe'
const REAL_HOME = 'C:\\Users\\example'
const SPLIT_HOME = 'C:\\Users\\example-split'
const ISOLATED_HOME = '/tmp/isolated-home'
const KEEP_HOME = 'C:\\keep\\me-untouched'

let definition
const ctx = { effect: (f) => f(), tools: { register: (d) => { definition = d; return () => {} } } }

/**
 * 临时改写环境变量；无论断言是否失败都还原，避免污染同进程内的其它用例。
 * ⚠ 必须 `await fn()` 再还原：被测代码要跨过一次 `await resolveBashRuntime(...)` 才读 `process.env`，
 * 同步还原会在它读到之前就把值改回去（第一版就这么错过了，用例会假绿）。
 */
async function withEnv(vars, fn) {
  const saved = {}
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try { return await fn() } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/**
 * 跑一次 `bash` 工具调用，返回 governor 实际收到的 `req`。
 * provision 是注入的：`source` 决定"这次解析出的运行时是谁"，也是本 bug 的生效开关。
 */
function runner({ source = 'bundled', bashPath = '' } = {}) {
  let seen = null
  let resolveCalls = 0
  const gov = {
    runGoverned: async (req) => {
      seen = req
      return { ok: true, reason: 'exit', outcome: { exitCode: 0, signal: null }, streams: { stdout: { text: 'OK' }, stderr: { text: '' } } }
    },
  }
  const provision = {
    resolveBashRuntime: async () => { resolveCalls += 1; return { ok: true, path: BUNDLED, source, version: 'GNU bash 5', why: 'fixture' } },
    clearBashRuntimeCache: () => {},
  }
  apply(ctx, { bashPath }, { modules: [gov, { createJobPort: (o) => o }, ws, provision] })
  return {
    resolveCalls: () => resolveCalls,
    run: async () => { await definition.execute({ command: 'echo hi' }, { agent: { session } }); return seen },
  }
}

// 1 —— 主修：win32 下自带 bundle 必须拿到真实用户目录（当前行为的直接反驳）。
test('win32 + 自带 bundle：HOME 取 USERPROFILE，不再落到运行时内的不存在目录', { skip: ONLY_WIN }, async () => {
  const req = await withEnv({ HOME: '/home/example', USERPROFILE: REAL_HOME, DSH_BASH_HOME: undefined }, () => runner().run())
  assert.equal(req.env.HOME, REAL_HOME, 'HOME 必须是真实用户目录（Windows 形式即可，MSYS 自行转 POSIX）')
})

// 2 —— 逃生口：有意隔离的人显式声明，优先级高于 USERPROFILE。
test('win32 + 自带 bundle：DSH_BASH_HOME 覆盖 USERPROFILE（隔离场景的逃生口）', { skip: ONLY_WIN }, async () => {
  const req = await withEnv({ HOME: '/home/example', USERPROFILE: REAL_HOME, DSH_BASH_HOME: ISOLATED_HOME }, () => runner().run())
  assert.equal(req.env.HOME, ISOLATED_HOME)
})

// 3 —— 取值优先级第二档：没有 USERPROFILE 时用 HOMEDRIVE+HOMEPATH。
test('win32 + 自带 bundle：USERPROFILE 缺席时回落 HOMEDRIVE + HOMEPATH', { skip: ONLY_WIN }, async () => {
  const req = await withEnv({ HOME: '/home/example', USERPROFILE: undefined, HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\example-split', DSH_BASH_HOME: undefined },
    () => runner().run())
  assert.equal(req.env.HOME, SPLIT_HOME)
})

// 4 —— 最后一档：os.homedir()。三者都没有时也必须给一个真实路径，不能退回 MSYS 兜底。
// 断言必须留在 withEnv 内部：`homedir()` 读的就是刚被删掉的 USERPROFILE，还原之后再比对是另一个值。
test('win32 + 自带 bundle：三档都缺席时回落 os.homedir()', { skip: ONLY_WIN }, async () => {
  await withEnv({ HOME: '/home/example', USERPROFILE: undefined, HOMEDRIVE: undefined, HOMEPATH: undefined, DSH_BASH_HOME: undefined }, async () => {
    const req = await runner().run()
    assert.equal(req.env.HOME, homedir())
    assert.ok(req.env.HOME, 'HOME 不许是空值——那就是把"假阴性"换成另一种坏值')
  })
})

// 5 —— 平台收紧：非 win32 不动（MSYS2 才是本问题载体）。
test('非 win32 + 自带 bundle：不接管 HOME', { skip: WIN ? '仅非 win32：本断言验证平台收紧' : false }, async () => {
  const req = await withEnv({ HOME: KEEP_HOME, USERPROFILE: REAL_HOME, DSH_BASH_HOME: undefined }, () => runner().run())
  assert.equal(req.env.HOME, KEEP_HOME)
})

// 6 —— 来源收紧：Git for Windows / 系统 MSYS2 / PATH 各自已把 HOME 映射到用户目录，不许越界改。
test('来源不是自带 bundle（git-for-windows 等）：不接管 HOME', async () => {
  for (const source of ['git-for-windows', 'msys2', 'path', 'env', 'git-on-path']) {
    const req = await withEnv({ HOME: KEEP_HOME, USERPROFILE: REAL_HOME }, () => runner({ source }).run())
    assert.equal(req.env.HOME, KEEP_HOME, `${source} 来源不该被接管`)
  }
})

// 7 —— 显式 config.bashPath：那是用户自己指定的运行时，不解析、也不接管。
test('显式 config.bashPath：不接管 HOME，且不解析运行时', async () => {
  const r = runner({ bashPath: 'fake-bash' })
  const req = await withEnv({ HOME: KEEP_HOME, USERPROFILE: REAL_HOME }, () => r.run())
  assert.equal(req.env.HOME, KEEP_HOME)
  assert.equal(r.resolveCalls(), 0, '显式 bashPath 时不应调用 resolveBashRuntime')
})

test('清理夹具目录', () => { rmSync(root, { recursive: true, force: true }) })
