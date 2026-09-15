// 单文件 HTML 产物验证器 v2（不依赖浏览器）：
//   · 独立审计：从产物里提取 buildGeometry()，**由验证器自己**计算面法线朝向（不依赖产物自报，防"自报通过"）
//   · 容错沙箱：DOM/THREE 桩足够厚，初始化报错也继续做几何审计
//   · 兼容多种自检字段形状（inwardFaces 数字或数组、side 缺失时按 cullBackFaces/代码推断）
// 用法：node evidence/html-verify.cjs <artifact.html> [--json]
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const file = process.argv[2]
if (!file) { console.error('usage: html-verify.cjs <artifact.html>'); process.exit(2) }
const html = fs.readFileSync(file, 'utf8')
const checks = []
const has = (name, cond, detail) => checks.push({ name, ok: Boolean(cond), detail: detail === undefined ? null : detail })

// ── 1) 结构/接口（静态）
// 允许 CDN（http/https）引入 three.js；只把"依赖本地外部文件"视为非单文件
const externalSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
const localSrcs = externalSrcs.filter((s) => !/^https?:\/\//i.test(s))
has('单文件（不依赖本地外部脚本；允许 CDN）', localSrcs.length === 0, localSrcs.length ? localSrcs : externalSrcs.length + ' 个 CDN 引用（允许）')
has('声明 three.js 或 WebGL 渲染路径', /three(\.min)?\.js|WebGLRenderer|getContext\(['"]webgl/i.test(html))
has('实现 buildGeometry()（几何与渲染解耦）', /function\s+buildGeometry|buildGeometry\s*=\s*function|const\s+buildGeometry/.test(html))
has('实现 __selftest() 出口', /__selftest\s*=/.test(html))
has('法线处理（重算/统一朝向/翻转）', /computeVertexNormals|computeFaceNormals|flipNormal|recalc|normal/i.test(html))
has('可见性策略（正面/双面/剔除声明）', /DoubleSide|BackSide|FrontSide|cull|side\s*:/i.test(html))
has('操控映射（移动/转向）', /(KeyW|ArrowUp|forward|throttle)[\s\S]{0,600}(KeyA|ArrowLeft|yaw|turn)/i.test(html))
has('可退出鼠标捕获/暂停', /Escape|Esc|exitPointerLock|pointerlockchange|pause/i.test(html))
has('可配置（灵敏度/反转）', /sensitivity|invert|灵敏度|反转/i.test(html))
has('操作提示（可发现性）', /提示|hint|help|操作说明|按\s*W/i.test(html))

// ── 2) 沙箱执行（厚桩，容错）
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
const code = scripts.join('\n;\n')
const noop = () => {}
const listeners = {}
const addL = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) }
const fire = (type) => { for (const fn of (listeners[type] || [])) { try { fn({ type }) } catch (e) { /* ignore */ } } }
const mkEl = () => {
  const el = {
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    childNodes: [], children: [], textContent: '', innerHTML: '', value: '', width: 800, height: 600,
    appendChild: (x) => x, removeChild: (x) => x, remove: noop, setAttribute: noop, getAttribute: () => null,
    addEventListener: addL, removeEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => glStub, querySelector: () => mkEl(), querySelectorAll: () => [], focus: noop, blur: noop,
    requestPointerLock: noop, exitPointerLock: noop, contains: () => false, insertBefore: (x) => x, cloneNode: () => mkEl(),
  }
  return el
}
const glStub = new Proxy({}, { get: (t, k) => (k === 'getParameter' ? () => 'stub' : k === 'getExtension' ? () => null : k === 'getShaderPrecisionFormat' ? () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }) : noop) })
const threeObj = () => new Proxy({}, { get: (t, k) => (k === 'attributes' ? {} : k === 'position' ? { count: 0, array: [] } : k === 'domElement' ? mkEl() : typeof k === 'string' && /^is/.test(k) ? false : noop) })
const THREEStub = new Proxy({}, { get: (t, k) => (k === 'REVISION' ? '0-stub' : k === 'MathUtils' ? { degToRad: (d) => (d * Math.PI) / 180, clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } : function () { return threeObj() }) })
const sandbox = {
  console: { log: noop, warn: noop, error: noop }, Math, JSON, Date, Array, Object, Number, String, Boolean, Set, Map, Symbol, Error, Promise,
  Float32Array, Float64Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, isNaN, isFinite, parseFloat, parseInt,
  navigator: { userAgent: 'node-verify', maxTouchPoints: 0 }, performance: { now: () => Date.now() },
  requestAnimationFrame: noop, cancelAnimationFrame: noop, setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
  addEventListener: addL, removeEventListener: noop, alert: noop, fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  location: { search: '?selftest=1', href: 'file:///artifact.html?selftest=1', protocol: 'file:' },
  THREE: THREEStub, dat: { GUI: function () { return { add: function () { return this }, onChange: function () { return this } } } },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.document = { getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [], createElement: () => mkEl(), addEventListener: noop, removeEventListener: noop, body: mkEl(), documentElement: mkEl(), exitPointerLock: noop, pointerLockElement: null, hidden: false }
let initError = null
const PROBE = '\n;try{window.__probeBG=(typeof buildGeometry==="function")?buildGeometry:(window.__probeBG||null)}catch(e){}\n'
// 产物常把一切都包在 IIFE 里：除了脚本末尾，还要在最后一个 IIFE 收尾之前注入一次探针（同一作用域才看得见辅助函数）
const lastIife = Math.max(code.lastIndexOf('})();'), code.lastIndexOf('}());'), code.lastIndexOf('})()'))
const codeWithProbe = lastIife > code.length * 0.5
  ? code.slice(0, lastIife) + PROBE + code.slice(lastIife) + PROBE
  : code + PROBE
try {
  vm.createContext(sandbox)
  vm.runInContext(codeWithProbe, sandbox, { timeout: 10000 })
} catch (e) { initError = String((e && e.message) ? e.message : e) }
// 很多产物把接口挂在 load / DOMContentLoaded 上：沙箱里必须补一次派发，否则"接口不可达"是验证器的错
try { fire('DOMContentLoaded'); fire('load'); fire('resize'); } catch (e) { /* ignore */ }

// ── 3) 独立审计（关键）：自己算面法线朝向，不信产物自报
// 取几何的三条路：① 沙箱里的 buildGeometry ② 从脚本文本按花括号配对抽出函数体单独求值 ③ 产物自报（最后手段）
const extractFn = (name) => {
  const re = new RegExp('(?:function\\s+' + name + '|(?:const|let|var)\\s+' + name + '\\s*=\\s*function|' + name + '\\s*=\\s*function)\\s*\\(')
  const m = re.exec(code)
  if (!m) return null
  const start = code.indexOf('{', code.indexOf('(', m.index))
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') { depth -= 1; if (depth === 0) return code.slice(m.index, i + 1) }
  }
  return null
}
let audit = null, auditError = null, auditSource = null
try {
  let bg = sandbox.buildGeometry || (sandbox.window && sandbox.window.buildGeometry) || (sandbox.window && sandbox.window.__probeBG)
  if (typeof bg !== 'function') {
    const body = extractFn('buildGeometry')
    if (body) {
      const f = vm.runInNewContext('(' + body + ')', { Math, JSON, Array, Object, Number, Float32Array, console: { log: noop, warn: noop } }, { timeout: 4000 })
      if (typeof f === 'function') { bg = f; auditSource = 'extracted' }
    }
  } else auditSource = 'sandbox'
  if (typeof bg !== 'function') throw new Error('buildGeometry 不可调用（沙箱与文本提取都失败）')
  const g = bg()
  const pos = (g && g.positions) || []
  const idx = (g && g.indices) || []
  if (!pos.length || !idx.length) throw new Error('几何为空（positions/indices 缺失）')
  let inward = 0, total = 0
  let cx = 0, cy = 0, cz = 0
  for (const p of pos) { cx += p[0]; cy += p[1]; cz += p[2] }
  cx /= pos.length; cy /= pos.length; cz /= pos.length
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = pos[idx[i]], b = pos[idx[i + 1]], c = pos[idx[i + 2]]
    if (!a || !b || !c) continue
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const fc = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
    const outward = (fc[0] - cx) * fn[0] + (fc[1] - cy) * fn[1] + (fc[2] - cz) * fn[2]
    total += 1
    if (outward <= 0) inward += 1
  }
  audit = { faces: total, inwardFaces: inward, facesOutwardRatio: total ? (total - inward) / total : 0, vertices: pos.length }
} catch (e) {
  const msg = String((e && e.message) ? e.message : e)
  // 区分"产物没按要求把接口挂到全局"与"验证器自身问题"——前者是真实的产物缺陷（用户原话明确要求 window 级接口）
  const notExposed = /is not defined|Maximum call stack/.test(msg) && auditSource === null
  auditError = notExposed ? ('接口未暴露到全局（用户原话要求 window 级接口；沙箱探针与文本提取都取不到可用实现）：' + msg) : msg
}

has('几何可在纯计算环境构造（buildGeometry 可调用）', audit !== null, auditError)
if (audit) {
  has('独立审计：外观面朝外比例 ≥ 0.98', audit.facesOutwardRatio >= 0.98, audit.facesOutwardRatio)
  has('独立审计：不存在内向面（该看见的面都能看见）', audit.inwardFaces === 0, audit.inwardFaces)
}

// ── 4.5) 统一自检入口（0.3.2 新增的可判定项）：第三方必须能一次拿到全部检查结果
let selfcheck = null, selfcheckError = null
try {
  const fn = sandbox.__selfcheck || (sandbox.window && sandbox.window.__selfcheck)
  if (typeof fn === 'function') selfcheck = fn()
  else selfcheckError = '未导出 __selfcheck'
} catch (e) { selfcheckError = String((e && e.message) ? e.message : e) }
const scChecks = selfcheck && Array.isArray(selfcheck.checks) ? selfcheck.checks : null
const unifiedOk = Boolean(scChecks && scChecks.length > 0 && scChecks.every((c) => c && typeof c.name === 'string' && ('pass' in c) && ('evidence' in c)) && typeof selfcheck.pass === 'boolean')
has('统一自检入口（__selfcheck 返回 {checks:[{name,pass,evidence}],pass}）', unifiedOk,
  selfcheck ? { checks: scChecks ? scChecks.length : 0, pass: selfcheck.pass, sample: scChecks && scChecks[0] ? scChecks[0].name : null } : selfcheckError)

// ── 4) 产物自报（次要证据，形状容错）
let selftest = null, selfError = null
try {
  const fn = sandbox.__selftest || (sandbox.window && sandbox.window.__selftest)
  if (typeof fn === 'function') selftest = fn()
  else selfError = '未导出 __selftest'
} catch (e) { selfError = String((e && e.message) ? e.message : e) }
let selfInward = null
if (selftest) {
  const v = selftest.inwardFaces
  selfInward = Array.isArray(v) ? v.length : (typeof v === 'number' ? v : null)
  const side = selftest.side || (selftest.cullBackFaces ? 'FrontSide(cullBackFaces)' : (/DoubleSide/.test(html) ? 'DoubleSide' : (/FrontSide/.test(html) ? 'FrontSide' : null)))
  // side 允许三种形态：three.js 常量（数组/数字）、语义化命名（outside/outward/front/双面）、字符串枚举
  const sideOk = Array.isArray(side) || typeof side === 'number' || (typeof side === 'string' && /front|double|back|outside|outward|solid|双面|正面/i.test(side))
  has('可见性策略已声明（正面/双面/剔除）', sideOk, side)
  const c = selftest.controls || selftest.input || {}
  const keys = Object.keys(c).join(',')
  has('操控映射齐全（移动/转向/炮塔/退出/灵敏度/反转）',
    /(move|forward|throttle)/i.test(keys) && /(turn|steer|yaw)/i.test(keys) && /(turret|aim)/i.test(keys) && /(exit|capture|esc|pause)/i.test(keys) && /(sensitivity|sens)/i.test(keys) && /(invert|invertY)/i.test(keys) && /(move|forward|throttle)/i.test(keys),
    keys || null)
  // 取值可用性（不只是键名存在）：键位非空、灵敏度是合理正数、反转是布尔、退出捕获有值
  const pick = (re) => { for (const k of Object.keys(c)) if (re.test(k)) return c[k]; return undefined }
  const nonEmpty = (v) => (typeof v === 'string' && v.trim().length > 0) || (Array.isArray(v) && v.length > 0) || (v !== null && typeof v === 'object' && Object.keys(v).length > 0)
  const sens = pick(/sensitivity|sens/i)
  const sensOk = typeof sens === 'number' ? (sens > 0 && sens <= 1) : (typeof sens === 'string' && (parseFloat(sens) > 0))
  const inv = pick(/invert/i)
  const valuesOk = nonEmpty(pick(/move|forward|throttle/i)) && nonEmpty(pick(/turn|steer|yaw/i)) && nonEmpty(pick(/turret|aim/i)) && nonEmpty(pick(/exit|capture|esc|pause/i)) && sensOk && typeof inv === 'boolean'
  has('操控取值可用（键位非空 / 0<灵敏度≤1 / 反转是布尔）', valuesOk, JSON.stringify({ move: pick(/move|forward|throttle/i), turn: pick(/turn|steer|yaw/i), turret: pick(/turret|aim/i), exit: pick(/exit|capture|esc|pause/i), sensitivity: sens, invertY: inv }))
} else {
  has('可见性策略已声明（正面/双面/剔除）', /FrontSide|cull|DoubleSide/i.test(html))
  has('操控映射齐全（源内可验证）', /(KeyW|forward|throttle)/i.test(html) && /(KeyA|yaw|turn)/i.test(html) && /(turret|aim)/i.test(html) && /(exitPointerLock|Escape)/i.test(html) && /(sensitivity|灵敏度)/i.test(html) && /(invert|反转)/i.test(html))
}

const CONTROL_CHECKS = /操控映射|操控取值|操作提示|可退出鼠标捕获|可配置/
// 题型感知：法线/修复类题目不要求操控相关项（H2 操控题才要求）——避免"按操控题的标准去判法线题"
const taskArg = (process.argv.find((a) => a.indexOf('--task=') === 0) || '').split('=')[1] || ''
const controlsRequired = /H2|controls/i.test(taskArg)

const failed = checks.filter((x) => !x.ok && !(CONTROL_CHECKS.test(x.name) && !controlsRequired))
const infoOnly = checks.filter((x) => !x.ok && CONTROL_CHECKS.test(x.name) && !controlsRequired)
const out = {
  file: path.basename(file), pass: failed.length === 0, failed: failed.map((x) => x.name),
  infoNotRequired: infoOnly.map((x) => x.name),
  independentAudit: audit, auditError, selftestReported: selftest ? { inwardFaces: selfInward, facesOutwardRatio: selftest.facesOutwardRatio } : null,
  selfError, initError: initError ? String(initError).slice(0, 120) : null, checks,
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1))
else {
  for (const c of checks) {
    const optional = CONTROL_CHECKS.test(c.name) && !controlsRequired
    console.log((c.ok ? 'PASS  ' : (optional ? 'INFO  ' : 'FAIL  ')) + c.name + (optional && !c.ok ? '（本题型不要求）' : '') + (c.detail !== null && c.detail !== undefined ? '   [' + JSON.stringify(c.detail) + ']' : ''))
  }
  if (audit) console.log('  独立审计: ' + JSON.stringify(audit))
  if (auditError) console.log('  审计失败: ' + auditError)
  if (initError) console.log('  初始化告警(不致命): ' + String(initError).slice(0, 100))
  console.log('')
  const total = checks.length - infoOnly.length
  console.log((out.pass ? 'VERDICT: PASS' : 'VERDICT: FAIL') + '  (' + (total - failed.length) + '/' + total + ' 项通过)' + (infoOnly.length ? '  [另有 ' + infoOnly.length + ' 项本题型不要求]' : '') + '  ' + path.basename(file))
}
process.exit(out.pass ? 0 : 1)
