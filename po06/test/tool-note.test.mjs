// 只读工具那条路"一开就 ReferenceError"的回锚（真机台账：`interpret:fail(TOOL_SYSTEM_NOTE is not defined)`）。
//
// 运行：node po06/test/tool-note.test.mjs
//
// 事故经过（用户 2026-09-21 连续三轮实测）：开着「只读工具」时解释步骤 **5–12 毫秒就抛**，
// 连模型都没调到 ⇒ 整轮 no-packet；关掉工具一切正常（默认路径不碰那一行）。
// 根因是**标识符写错一个字母**：`read-tools.js` 导出 `TOOLS_SYSTEM_NOTE`，而 index.js 里写的是 `TOOL_SYSTEM_NOTE`。
// 这种错误静态可查、运行时只在"打开那个开关"时才炸——所以这里用静态守卫钉死。
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const read = (f) => readFileSync(join(LIB, f), 'utf8')
const files = readdirSync(LIB).filter((f) => f.endsWith('.js'))

t('read-tools.js 导出的名字就是 TOOLS_SYSTEM_NOTE（带 S）', () => {
  ok(/export const TOOLS_SYSTEM_NOTE\s*=/.test(read('read-tools.js')), '导出名必须与使用处一致')
})

t('index.js 的 toolsEnabled 分支用的是**带 S** 的那个标识符，并且真的从 read-tools.js 导入', () => {
  const src = read('index.js')
  ok(/import\s*\{[^}]*TOOLS_SYSTEM_NOTE[^}]*\}\s*from\s*'\.\/read-tools\.js'/.test(src),
    '必须从 read-tools.js 导入 TOOLS_SYSTEM_NOTE')
  ok(/if \(toolsEnabled\) parts\.push\(TOOLS_SYSTEM_NOTE\)/.test(src),
    'toolsEnabled 分支必须 push TOOLS_SYSTEM_NOTE')
})

t('整个 lib/ 里不得再出现**未定义的** TOOL_SYSTEM_NOTE（少一个 S 的那个）', () => {
  const bad = []
  for (const f of files) {
    const src = read(f)
    // 词边界匹配：TOOLS_SYSTEM_NOTE 不算命中（前面是 S，\b 不成立）
    if (/\bTOOL_SYSTEM_NOTE\b/.test(src)) bad.push(f)
  }
  ok(bad.length === 0, '这些文件里还有写错的标识符：' + bad.join(', '))
})

console.log(JSON.stringify({
  suite: 'po06-tool-note', phase: 'P11', total: pass + failures.length, pass, fail: failures.length, failures,
  note: '只读工具说明的标识符一致性（少一个 S 会让"开工具"在 5ms 内抛错并让整轮 no-packet）。静态检查，不联网。',
}, null, 2))
process.exit(failures.length ? 1 : 0)
