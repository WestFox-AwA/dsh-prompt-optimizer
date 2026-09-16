// 本地发布：node evidence/release-local.cjs <version>   （例如 0.3.11-beta.1）
// 做四件事并回读校验：
//   ① repo package.json 版本改为 <version>
//   ② 生成 ~/.dsh/plugins/dsh-prompt-optimizer-<version>/package（只放运行时文件 + 文档）
//   ③ 重指 profile 的 junction 与 file: 依赖到新目录（换版本两步走里的第 ① 步）
//   ④ 回读：junction 目标 / 新旧 lib 大小与 sha256 / 语法检查提示
// 注意：第 ② 步之后仍需重启（或重建 loader entry）活实例才会切换——见 ROADMAP「版本切换操作规程」。
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const ver = process.argv[2]
if (!ver) { console.log('用法: node evidence/release-local.cjs <version>'); process.exit(1) }
const REPO = path.join(__dirname, '..')
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PKG_ROOT = path.join(HOME, 'plugins', 'dsh-prompt-optimizer-' + ver, 'package')
const NODE_MODULES = path.join(HOME, 'profiles', 'web', 'node_modules', '@dsh-external')
const LINK = path.join(NODE_MODULES, 'dsh-prompt-optimizer')
const PROFILE_PKG = path.join(HOME, 'profiles', 'web', 'package.json')

const RUNTIME = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.en.md', 'CHANGELOG.md', 'ACCEPTANCE.md', 'PROMPT-OPTIMIZATION.md', 'ROADMAP.md', 'DSH-COMPAT.md']
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16)
const say = (s) => console.log(s)

// ① bump 版本（只替换 version 字段那一行，保留文件其余格式）
const pkgPath = path.join(REPO, 'package.json')
const before = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
let src = fs.readFileSync(pkgPath, 'utf8')
src = src.replace(/("version"\s*:\s*")[^"]+(")/, '$1' + ver + '$2')
fs.writeFileSync(pkgPath, src, 'utf8')
const after = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
say('① 版本: ' + before + ' → ' + after + (after === ver ? ' ✓' : ' ✗ 未生效'))

// ①b 同步 client.js 里硬编码的 build 标签（beacon 用）——手工改必然漂移（实测曾停在 v0.3.10-beta.2）
const clientPath = path.join(REPO, 'lib', 'client.js')
if (fs.existsSync(clientPath)) {
  const cs = fs.readFileSync(clientPath, 'utf8')
  const m = cs.match(/build:\s*"v[^"]*"/)
  if (!m) say('①b client.js 未找到 build 标签（跳过）')
  else if (m[0] === 'build: "v' + ver + '"') say('①b client.js build 标签已是 v' + ver + ' ✓')
  else { fs.writeFileSync(clientPath, cs.replace(/build:\s*"v[^"]*"/, 'build: "v' + ver + '"'), 'utf8'); say('①b client.js build 标签: ' + m[0] + ' → build: "v' + ver + '" ✓') }
}

// ② 生成版本目录
fs.mkdirSync(path.join(PKG_ROOT, 'lib'), { recursive: true })
const copied = []
for (const rel of RUNTIME) {
  const from = path.join(REPO, rel)
  if (!fs.existsSync(from)) { say('   ⚠️ 缺少 ' + rel + '（跳过）'); continue }
  const to = path.join(PKG_ROOT, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  copied.push(rel)
}
say('② 已生成 ' + PKG_ROOT + '（' + copied.length + ' 个文件）')
say('   lib/index.js  sha256(前16)=' + sha(path.join(PKG_ROOT, 'lib', 'index.js')) + '  ' + fs.statSync(path.join(PKG_ROOT, 'lib', 'index.js')).size + ' bytes')
say('   lib/client.js sha256(前16)=' + sha(path.join(PKG_ROOT, 'lib', 'client.js')) + '  ' + fs.statSync(path.join(PKG_ROOT, 'lib', 'client.js')).size + ' bytes')

// ③ 重指 junction 与 profile 依赖
fs.mkdirSync(NODE_MODULES, { recursive: true })
try { if (fs.lstatSync(LINK)) fs.rmSync(LINK, { recursive: true, force: true }) } catch (e) { /* 不存在 */ }
fs.symlinkSync(PKG_ROOT, LINK, 'junction')
const pj = JSON.parse(fs.readFileSync(PROFILE_PKG, 'utf8'))
const depKey = '@dsh-external/dsh-prompt-optimizer'
const newDep = 'file:' + PKG_ROOT.replace(/\\/g, '/')
const oldDep = pj.dependencies ? pj.dependencies[depKey] : null
if (pj.dependencies) pj.dependencies[depKey] = newDep
let pjText = fs.readFileSync(PROFILE_PKG, 'utf8')
if (oldDep && pjText.includes(oldDep)) pjText = pjText.split(oldDep).join(newDep)
fs.writeFileSync(PROFILE_PKG, pjText, 'utf8')
say('③ junction: ' + LINK + ' → ' + fs.readlinkSync(LINK))
say('   profile 依赖: ' + oldDep + ' → ' + newDep)

// ④ 回读
const linkPkg = JSON.parse(fs.readFileSync(path.join(LINK, 'package.json'), 'utf8'))
const linkLib = path.join(LINK, 'lib', 'index.js')
say('④ 回读 junction 侧版本: ' + linkPkg.version + (linkPkg.version === ver ? ' ✓' : ' ✗'))
say('   回读 junction 侧 lib/index.js sha256(前16)=' + sha(linkLib) + (sha(linkLib) === sha(path.join(REPO, 'lib', 'index.js')) ? ' ✓ 与 repo 一致' : ' ✗ 与 repo 不一致'))
say('')
say('后续：① 需重启（或重建 loader entry）活实例才切到 ' + ver + '；② 需要发 GitHub Release 时用 evidence/gh-api.cjs。')
