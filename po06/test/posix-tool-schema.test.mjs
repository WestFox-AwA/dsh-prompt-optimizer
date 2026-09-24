// posix 工具的**线上 schema 形状**守卫（2026-09-24 真机会话事故的回锚）。
//
// 运行：node po06/test/posix-tool-schema.test.mjs
//
// 事故经过（受害会话 session-771e28cc，日志可查）：
//   第 8 轮第 99 步热重载插件 → 注册 posix（parameters 写成**逐属性方言**的属性表
//   `{ command: { type:'string', required:true } }`）→ 第 100 步起服务端直接 400：
//     `Invalid schema for function 'posix': schema must be a JSON Schema of 'type: "object"', got 'type: null'`
//   → 之后**每一轮**请求都被拒（用户两次"继续"都在第 1 步就死），会话彻底哑掉且不会自愈。
//
// 为什么静态/单元可查：裸 `ctx.tools.register()` **不做编译、原样透传** parameters，
// 而服务端只认对象根 JSON Schema。逐属性 `required: true` 的方言只有 `defineTool()` 的编译路径认。
// 这个错误在插件侧"注册成功"（ok:true），症状却出现在"会话起不了新轮"这种离插件很远的地方
// ⇒ 只能靠这里钉死：形状、守卫函数、以及注册时**真的**交出去的那份对象。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((what || 'value') + ': expected ' + y + ', got ' + x) }
// 用例可为 async，**必须**收集 promise 再统一 await（否则断言根本没跑，见 capability.test.mjs 的注释）
const pending = []
function t(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { pass += 1 },
    (e) => { failures.push({ name, error: String((e && e.message) || e) }) },
  ))
}

const read = (f) => readFileSync(join(LIB, f), 'utf8')

/** 历史上的坏写法：逐属性 `required: true` 的属性表（宿主裸 register 不收集它）。 */
const OLD_BAD_DIALECT = {
  command: { type: 'string', required: true, description: 'x' },
}

/** 一个"什么都没检查"的假宿主：register 收下对象，schemas() 原样回吐。 */
function fakeHost({ wireView } = {}) {
  const seen = []
  const tools = {
    register(def) { seen.push(def) },
    schemas() {
      if (wireView) return wireView
      const last = seen[seen.length - 1]
      return last ? [{ name: last.name, description: last.description, parameters: last.parameters }] : []
    },
  }
  return { seen, ctx: { get: (k) => (k === 'tools' ? tools : undefined) } }
}

t('POSIX_TOOL_PARAMETERS 必须是对象根 JSON Schema（type:"object" + properties + 顶层 required）', async () => {
  const { POSIX_TOOL_PARAMETERS } = await import('../lib/index.js')
  ok(POSIX_TOOL_PARAMETERS && typeof POSIX_TOOL_PARAMETERS === 'object', '常量必须导出')
  eq(POSIX_TOOL_PARAMETERS.type, 'object', '服务端只认 type:"object"（写漏 = 每轮 400）')
  ok(POSIX_TOOL_PARAMETERS.properties && typeof POSIX_TOOL_PARAMETERS.properties === 'object', '必须有 properties')
  ok(POSIX_TOOL_PARAMETERS.properties.command, 'command 属性必须在 properties 里')
  eq(POSIX_TOOL_PARAMETERS.required, ['command'], 'required 必须在**顶层**，不在属性上')
})

t('守卫函数：逐属性方言必须被判违规，且点名 required（有牙）', async () => {
  const { parameterSchemaViolations } = await import('../lib/index.js')
  const bad = parameterSchemaViolations(OLD_BAD_DIALECT)
  ok(bad.length > 0, '逐属性方言必须报违规，实际放行 = 守卫没牙')
  ok(bad.join(' ').includes('required'), '理由要点名 required（写的人才知道怎么改）：' + JSON.stringify(bad))
  ok(bad.join(' ').includes('type'), '理由要点名缺 type:"object"：' + JSON.stringify(bad))
})

t('守卫函数：合法对象根 schema 不得误报', async () => {
  const { parameterSchemaViolations, POSIX_TOOL_PARAMETERS } = await import('../lib/index.js')
  eq(parameterSchemaViolations(POSIX_TOOL_PARAMETERS), [], '自家 schema 必须过')
})

t('守卫函数：非对象/数组/坏 required 一律拒绝', async () => {
  const { parameterSchemaViolations } = await import('../lib/index.js')
  ok(parameterSchemaViolations(null).length > 0, 'null 必须拒')
  ok(parameterSchemaViolations([]).length > 0, '数组必须拒')
  ok(parameterSchemaViolations({ type: 'object', properties: {}, required: 'command' }).length > 0, 'required 不是数组必须拒')
})

t('注册时交出去的 parameters 就是对象根（宿主原样透传给服务端，所以这一份就是线上那一份）', async () => {
  const { registerPosixTool, posixToolState } = await import('../lib/index.js')
  const host = fakeHost()
  const report = { steps: {} }
  const step = registerPosixTool(host.ctx, report)
  eq(step.ok, true, '应当注册成功：' + String(step.reason))
  eq(host.seen.length, 1, '必须恰好注册一次')
  eq(host.seen[0].name, 'posix', '注册的名字')
  eq(host.seen[0].parameters.type, 'object', '线上 parameters.type 必须是 "object"')
  eq(step.schemaViolations, [], '自检报告里违规清单必须为空')
  ok(report.steps.registerPosixTool === step, '要登记进自检报告')
  eq(posixToolState.last.schemaReadBack.objectRooted, true, '从宿主读回必须是对象根')
})

t('读回的是**宿主**的形状，不是我们的意图：宿主拿着坏形状时必须报 objectRooted:false', async () => {
  const { registerPosixTool } = await import('../lib/index.js')
  const host = fakeHost({ wireView: [{ name: 'posix', parameters: OLD_BAD_DIALECT }] })
  const step = registerPosixTool(host.ctx, { steps: {} })
  eq(step.ok, true, '注册这一步确实是成功的（坏的是 schema，不是注册）')
  eq(step.schemaReadBack.objectRooted, false, '坏形状必须被读回检出——它是事故的检出器')
  ok(step.schemaReadBack.type === null || step.schemaReadBack.type === undefined, '坏形状读回的 type 应当是空')
})

t('fail-closed：注入坏 schema 时**绝不注册**，并如实登记原因', async () => {
  const { registerPosixTool } = await import('../lib/index.js')
  const host = fakeHost()
  const step = registerPosixTool(host.ctx, { steps: {} }, OLD_BAD_DIALECT)
  eq(step.ok, false, '坏 schema 不许报成功')
  ok(String(step.reason).startsWith('parameters-schema-invalid:'), '原因必须点名 parameters-schema-invalid，实际：' + step.reason)
  ok(String(step.reason).includes('required'), '原因要点名逐属性 required 方言：' + step.reason)
  eq(host.seen.length, 0, '一件都不许注册出去（宁可没有这个工具，也不让整个会话哑掉）')
  ok(Array.isArray(step.schemaViolations) && step.schemaViolations.length > 0, '违规清单要留在自检报告里')
})

t('静态钉子：注册处不得再内联属性表，必须用对象根 schema 常量交给 register', () => {
  const src = read('index.js')
  ok(/export const POSIX_TOOL_PARAMETERS = \{\n  type: 'object',/.test(src), '常量必须自带 type:"object"')
  ok(/parameters:\s*parametersSpec,/.test(src), 'register 的 parameters 必须走 parametersSpec（默认 = 上面那份常量）')
  ok(/const violations = parameterSchemaViolations\(parametersSpec\)/.test(src), '注册前必须跑 fail-closed 校验')
  ok(/if \(violations\.length > 0\) \{/.test(src), '违规必须真的拦住注册（不能只登记不拦）')
})

await Promise.all(pending)

console.log(JSON.stringify({
  suite: 'po06-posix-tool-schema', phase: 'P11', total: pass + failures.length, pass, fail: failures.length, failures,
  note: '虚拟 POSIX 注册给工作 AI 的那一份 parameters 必须是对象根 JSON Schema——写错会让**整个会话**每轮请求都被 400 拒掉（2026-09-24 真机事故）。不调模型、不联网。',
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
