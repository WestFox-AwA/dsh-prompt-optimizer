// DSH 兼容性核对：在"新版本包"与"当前已装版本"里分别搜插件依赖的那些接口标识，逐条比对。
// 用法：node evidence/dsh-compat.cjs <newDir> <installedDir>
const fs = require('fs')
const path = require('path')

const NEW = process.argv[2]
const OLD = process.argv[3]
if (!NEW || !OLD) { console.error('usage: dsh-compat.cjs <newDir> <installedDir>'); process.exit(2) }

const NEEDLES = [
  ['槽位 conversation.input.left', 'conversation.input.left'],
  ['槽位 shell.overlay', 'shell.overlay'],
  ['客户端运行时全局 __ModuleLoader__', '__ModuleLoader__'],
  ['slots.inject', 'inject('],
  ['slots.register', 'register('],
  ['输入动作 inputActions', 'inputActions'],
  ['setDraft', 'setDraft'],
  ['主题色 state-business-primary', '--dsw-alias-state-business-primary'],
  ['主题色 specific-tip', '--dsw-specific-tip'],
  ['主题色 border-l1', '--dsw-alias-border-l1'],
  ['宿主服务 llm', "'llm'"],
  ['宿主服务 sessions', "'sessions'"],
  ['宿主服务 agents', "'agents'"],
  ['宿主服务 agentDefaultModel', 'agentDefaultModel'],
  ['宿主服务 settings', "'settings'"],
  ['llm.listProviders', 'listProviders'],
  ['agentDefaultModel.currentSelection', 'currentSelection'],
  ['session.ownEvents', 'ownEvents'],
  ['webServer（宿主路由）', 'webServer'],
  ['客户端声明 dsh.client', 'client'],
  ['插件表格 cordis.patch.yml / bundles', 'cordis.patch.yml'],
]

function walk(dir, out, depth) {
  if (!dir || depth > 6) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' && depth > 0) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(js|mjs|cjs|ts|json|yml|yaml|md)$/i.test(e.name) && !/\.map$/.test(e.name)) out.push(p)
  }
  return out
}

function scan(root) {
  const files = walk(root, [], 0)
  const res = {}
  for (const [label, needle] of NEEDLES) res[label] = { count: 0, sample: null }
  let bytes = 0
  for (const f of files) {
    let text = ''
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    bytes += text.length
    for (const [label, needle] of NEEDLES) {
      const i = text.indexOf(needle)
      if (i >= 0) {
        res[label].count += text.split(needle).length - 1
        if (!res[label].sample) res[label].sample = path.relative(root, f)
      }
    }
  }
  return { files: files.length, bytes, res }
}

const a = scan(NEW)
const b = scan(OLD)
console.log('新版本目录 : ' + NEW + '  (' + a.files + ' 文件 / ' + Math.round(a.bytes / 1024) + ' KB)')
console.log('已装版本目录: ' + OLD + '  (' + b.files + ' 文件 / ' + Math.round(b.bytes / 1024) + ' KB)')
console.log('')
console.log('标识'.padEnd(40) + '新版本'.padEnd(16) + '已装'.padEnd(16) + '判定')
let risk = 0
for (const [label] of NEEDLES) {
  const n = a.res[label]
  const o = b.res[label]
  const verdict = n.count > 0 ? (o.count > 0 ? 'OK' : '新有旧无(新增)') : (o.count > 0 ? '⚠ 消失' : '两版都无(改判据)')
  if (n.count === 0 && o.count > 0) risk += 1
  console.log(label.padEnd(40) + String(n.count).padEnd(16) + String(o.count).padEnd(16) + verdict)
}
console.log('')
console.log('风险项（旧版有、新版没有）: ' + risk)
