// 探针（广播版）：同一个 token 的 cmd.json 写进所有插件实例的 evidence 目录，
// 再扫描所有 beacon 文件收集回执 —— 避免"多个旧实例同时存活"时写错目录导致假超时。
// 用法：node evidence/probe.cjs <run> [timeoutMs] [--no-sync]
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const base = path.join(root, '..')
const run = process.argv[2]
const timeout = Number(process.argv[3] || 60000)
const noSync = process.argv.indexOf('--no-sync') >= 0
if (!run) { console.error('usage: probe.cjs <run> [timeoutMs] [--no-sync]'); process.exit(2) }

// 1) 收集所有实例：源目录 + 各安装目录（凡有 package/lib/ 的都算）
const insts = []
const addInst = (name, pkgDir) => {
  const lib = path.join(pkgDir, 'lib', 'client.js')
  if (!fs.existsSync(lib)) return
  insts.push({ name, pkgDir, lib, ev: path.join(pkgDir, 'evidence') })
}
addInst('source', root)
for (const d of fs.readdirSync(base).filter((x) => x.indexOf('dsh-prompt-optimizer') === 0)) addInst(d, path.join(base, d, 'package'))
console.log('instances: ' + insts.map((i) => i.name).join(', '))

// 2) 把源 lib 同步进各实例（否则实例跑的是旧代码）；evidence 目录按需创建
if (!noSync) {
  const srcLib = path.join(root, 'lib')
  for (const inst of insts) {
    for (const f of fs.readdirSync(srcLib)) {
      const from = path.join(srcLib, f)
      if (!fs.statSync(from).isFile()) continue
      fs.copyFileSync(from, path.join(inst.pkgDir, 'lib', f))
    }
  }
  console.log('synced lib -> ' + insts.length + ' instances')
}

// 3) 广播命令
const token = 'probe-' + Date.now()
const sentAt = Date.now()
const payload = JSON.stringify({ run, token }, null, 2)
const targets = []
for (const inst of insts) {
  try { fs.mkdirSync(inst.ev, { recursive: true }) } catch (e) {}
  try { fs.writeFileSync(path.join(inst.ev, 'cmd.json'), payload, 'utf8'); targets.push(inst) } catch (e) {}
}
console.log('broadcast run=' + run + ' token=' + token + ' -> ' + targets.map((t) => t.name).join(', '))

const reset = () => {
  for (const inst of targets) {
    try { fs.writeFileSync(path.join(inst.ev, 'cmd.json'), JSON.stringify({ run: null, clearedAt: Date.now() }, null, 2), 'utf8') } catch (e) {}
  }
}
const scan = () => {
  const hits = []
  // 诊断类 beacon 也带 token，但它们不是"演示跑完"的回执：只有该 run 没有专属 stage 时才作为兜底（实测踩过一次提前返回）
  const DIAG = { 'cmd-seen': 1, 'probe-skip': 1, 'probe-stale-reset': 1 }
  for (const inst of insts) {
    const f = path.join(inst.ev, 'client-beacon.jsonl')
    if (!fs.existsSync(f)) continue
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
    let diag = null
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
      if (lines[i].indexOf(token) < 0 && lines[i].indexOf('"stage":"' + run + '"') < 0) continue
      let o = null
      try { o = JSON.parse(lines[i]) } catch (e) { continue }
      if (typeof o.t === 'number' && o.t < sentAt - 2000) continue
      if (o.stage === run) { hits.push({ inst: inst.name, beacon: o }); diag = null; break }
      if (DIAG[o.stage]) { if (!diag) diag = o; continue }
      if (o.token === token) { hits.push({ inst: inst.name, beacon: o }); diag = null; break }
    }
    if (diag) hits.push({ inst: inst.name, beacon: diag, diag: true })
  }
  return hits
}
const deadline = Date.now() + timeout
const tick = () => {
  const hits = scan()
  const real = hits.filter((h) => h.diag !== true)
  if (real.length > 0) {
    for (const h of real) console.log('[' + h.inst + '] ' + JSON.stringify(h.beacon))
    reset(); console.log('channel reset on ' + targets.length + ' instances')
    process.exit(0)
  }
  if (Date.now() > deadline) {
    for (const h of hits) console.error('  diag [' + h.inst + '] ' + JSON.stringify(h.beacon))
    console.error('TIMEOUT waiting for ' + token); reset(); process.exit(1)
  }
  setTimeout(tick, 1000)
}
tick()
