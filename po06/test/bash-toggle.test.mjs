// 内置 Bash 开关的**行为**回归（0.7.3）。
// 为什么单独立一套：0.7.2 的真机缺陷不是"某行写错"，而是**判据本身**错了——
// 它问的是"模块实例记不记得自己注册过"（依赖 effect 返回值类型），而不是"工具表里到底有没有"。
// 结果：开关关掉时走早退分支，那份已经注册的 bash 永远注销不掉（设置与 /status 都 false，
// 工具表里却还有 bash，而且照样能跑）。此后任何人再把这条逻辑改回"靠记忆"，这里就会红。
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name) } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message || e)) } }
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)) }

/** 造一个**真的会注销**的假 tools 服务：register 返回 dispose，dispose 真的从表里删。 */
function fakeTools() {
  const table = new Map()
  return {
    table,
    register: (def) => { table.set(def.name, def); return () => { table.delete(def.name) } },
    schemas: () => [...table.values()],
    has: (n) => table.has(n),
  }
}
/** 真 scope 形状：effect 返回内层 cleanup；ctx.inject 同步回调。 */
function fakeCtx(tools) {
  const ctx = {
    get: (n) => (n === 'tools' ? tools : null),
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
    inject: (_list, cb) => { cb({ tools, effect: ctx.effect }) },
  }
  return ctx
}

const home = mkdtempSync(join(tmpdir(), 'po06-bash-toggle-'))
process.env.DSH_HOME = home
const cfg = join(home, 'po06.json')
const write = (bash) => writeFileSync(cfg, JSON.stringify({ settingsVersion: 1, bash }, null, 2) + '\n', 'utf8')

const mod = await import('../lib/index.js')

t('开：设置 true ⇒ 工具进表，并且**拿到了注销器**', () => {
  const tools = fakeTools(); const ctx = fakeCtx(tools)
  write(true)
  const r = mod.syncBashTool(ctx)
  eq(r.ok, true, 'ok')
  eq(tools.has('bash'), true, 'bash 应在工具表里')
  ok(r.disposers >= 1, '必须收集到内层注销器（0.7.2 就是这里漏了 ⇒ 关不掉）')
})

t('关：设置 false ⇒ 工具**真的从表里消失**（这一条就是 0.7.2 缺的）', () => {
  const tools = fakeTools(); const ctx = fakeCtx(tools)
  write(true); mod.syncBashTool(ctx)
  eq(tools.has('bash'), true, '前置：先开起来')
  write(false)
  const r = mod.syncBashTool(ctx)
  eq(tools.has('bash'), false, 'bash 必须真的从工具表里消失')
  eq(r.on, false, 'on 应为 false')
  eq(r.present, false, '实测结果应为 false')
  eq(r.ok, true, 'ok 应为 true')
})

t('往返：开→关→开→关 每次都如实反映在工具表上', () => {
  const tools = fakeTools(); const ctx = fakeCtx(tools)
  const seq = []
  for (const v of [true, false, true, false]) { write(v); mod.syncBashTool(ctx); seq.push(tools.has('bash')) }
  eq(seq.join(','), 'true,false,true,false', '工具表应跟着设置走')
})

t('幂等：同值重复写盘不改动工具表（changed=false）', () => {
  const tools = fakeTools(); const ctx = fakeCtx(tools)
  write(true); mod.syncBashTool(ctx)
  const r = mod.syncBashTool(ctx)
  eq(r.changed, false, '同值不应再动')
  eq(tools.has('bash'), true, '工具仍在')
})

rmSync(home, { recursive: true, force: true })
console.log(JSON.stringify({ suite: 'po06-bash-toggle', total: pass + fail, pass, fail }, null, 1))
if (fail > 0) process.exit(1)
