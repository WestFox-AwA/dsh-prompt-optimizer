// DSH 兼容性核对（针对性版）：逐个"插件依赖的接口"在 0.1.6 新版与本机 0.1.5 之间对比，
// 并打印命中处的上下文，便于判断"是真没了、还是只是加了 deprecated 标记"。
// 用法：node evidence/dsh-compat2.cjs <newRoot> <oldRoot>
const fs = require('fs')
const path = require('path')

const NEW = process.argv[2]
const OLD = process.argv[3]
const PKGS = ['dsh-session', 'dsh-client-ui-conversation', 'dsh-client-ui-layout', 'dsh-client-modules', 'dsh-client-ui-theme', 'dsh-host-webserver', 'dsh-llm', 'dsh-web-app', 'dsh-base']

// 每项：[归属包, 说明, 探针正则, 是否需要上下文]
const CHECKS = [
  ['dsh-session', 'ownEvents（插件历史读取用的就是这个）', /ownEvents\s*\(/, true],
  ['dsh-session', 'snapshotEvents', /snapshotEvents\s*\(/, false],
  ['dsh-session', 'eventAt', /eventAt\s*\(/, false],
  ['dsh-session', '@deprecated 标记', /@deprecated/, true],
  ['dsh-session', '异步历史 API 候选（events/history）', /\b(events|history)\s*\(\s*\)/, true],
  ['dsh-client-ui-conversation', '槽位 conversation.input.left', /conversation\.input\.left/, false],
  ['dsh-client-ui-conversation', 'inputActions', /inputActions/, false],
  ['dsh-client-ui-conversation', 'setDraft', /setDraft/, false],
  ['dsh-client-ui-conversation', 'submit', /\bsubmit\b/, false],
  ['dsh-client-ui-conversation', '发送指令键 input.send', /input\.send(\.queue|\.steer)?/, true],
  ['dsh-client-ui-layout', '槽位 shell.overlay', /shell\.overlay/, false],
  ['dsh-client-modules', '__ModuleLoader__', /__ModuleLoader__/, false],
  ['dsh-client-ui-slots', 'slots.inject/register', /inject|register/, false],
  ['dsh-client-ui-theme', '主题色 --dsw-alias-state-business-primary', /--dsw-alias-state-business-primary/, false],
  ['dsh-client-ui-theme', '主题色 --dsw-specific-tip', /--dsw-specific-tip/, false],
  ['dsh-client-ui-theme', '主题色 --dsw-alias-border-l1', /--dsw-alias-border-l1/, false],
  ['dsh-host-webserver', 'webServer.register（宿主路由）', /register\s*\(/, true],
  ['dsh-llm', 'stream(', /stream\s*\(/, false],
  ['dsh-llm', 'listProviders', /listProviders/, false],
  ['dsh-web-app', '插件客户端清单 dsh.client / platform', /platform\s*:\s*['"]web['"]|dsh\.client/, false],
  ['dsh-base', 'cordis.patch.yml 装配', /cordis\.patch\.yml/, false],
]

function walk(dir, out, depth) {
  if (!dir || depth > 8) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' && depth > 0) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(js|mjs|cjs|ts|json|yml|yaml)$/i.test(e.name)) out.push(p)
  }
  return out
}
function load(root, pkg) {
  const dir = path.join(root, pkg)
  if (!fs.existsSync(dir)) return null
  const files = walk(dir, [], 0)
  const chunks = []
  for (const f of files) { try { chunks.push({ f, t: fs.readFileSync(f, 'utf8') }) } catch { /* skip */ } }
  return chunks
}
function probe(chunks, re, wantCtx) {
  const hits = []
  for (const c of chunks) {
    const m = re.exec(c.t)
    if (m) {
      let line = ''
      const i = c.t.lastIndexOf('\n', m.index) + 1
      const j = c.t.indexOf('\n', m.index)
      line = c.t.slice(i, j < 0 ? m.index + 120 : j).trim()
      hits.push({ file: path.relative('', c.f).split(path.sep).slice(-2).join('/'), line: line.slice(0, 150) })
    }
  }
  return hits
}

const cacheN = {}, cacheO = {}
const get = (root, cache, pkg) => (cache[pkg] === undefined ? (cache[pkg] = load(root, pkg)) : cache[pkg])

let risk = 0
console.log('探针'.padEnd(46) + '0.1.6'.padEnd(10) + '0.1.5'.padEnd(10) + '判定')
console.log('-'.repeat(96))
for (const [pkg, label, re, wantCtx] of CHECKS) {
  const cn = get(NEW, cacheN, pkg)
  const co = get(OLD, cacheO, pkg)
  if (cn === null) { console.log((pkg + ' / ' + label).padEnd(46) + '缺包'.padEnd(10) + (co === null ? '缺包' : String(probe(co, re).length)).padEnd(10) + '（新版未下载该包）'); continue }
  const hn = probe(cn, re)
  const ho = co ? probe(co, re) : []
  let verdict = 'OK'
  if (hn.length === 0 && ho.length > 0) { verdict = '⚠ 新版消失'; risk += 1 }
  else if (hn.length > 0 && ho.length === 0) verdict = '新版新增'
  console.log((pkg + ' / ' + label).padEnd(46) + String(hn.length).padEnd(10) + String(ho.length).padEnd(10) + verdict)
  if (wantCtx && hn.length > 0) {
    console.log('      新版样本: ' + hn[0].file + ' | ' + hn[0].line)
    if (ho.length > 0) console.log('      旧版样本: ' + ho[0].file + ' | ' + ho[0].line)
  }
}
console.log('')
console.log('风险项（旧版有、新版没有）: ' + risk)
