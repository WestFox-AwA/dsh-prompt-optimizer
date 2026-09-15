// 修测量端混淆：产物级题目的执行 AI 没有工具，但优化后的命令常要求"先查证工作目录"，导致执行体卡在第一步产出近空文件。
// 做法：在 lab-html.json 的 solverSystem 里明确"你没有工具、无法查证文件系统，直接产出完整文件"。
// 并把这个诊断写进 CHANGELOG 与提交信息。用法：node evidence/fix-rig-notools.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const P = (f) => path.join(__dirname, '..', f)

// 1) 修 solverSystem
const file = path.join(ev, 'lab-html.json')
const spec = JSON.parse(fs.readFileSync(file, 'utf8'))
const NO_TOOLS = [
  '',
  '重要（测量环境约束）：你**没有**任何工具——不能读文件、不能执行命令、不能访问网络。',
  '因此不要输出"先查证/先侦察/先列 todo 再执行"这类计划或工具调用；**直接产出完整的单文件 HTML**（题目已给出所需的一切）。',
].join('\n')
if (spec.solverSystem.indexOf('没有任何工具') >= 0) console.log('rig: 已有无工具声明')
else { spec.solverSystem += NO_TOOLS; fs.writeFileSync(file, JSON.stringify(spec, null, 1), 'utf8'); console.log('rig: solverSystem 已加入"无工具"声明') }

// 2) CHANGELOG 记录诊断（作为 0.3.5 条目的补充）
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
const anchor = '**复测（同口径，H3 两条件各 3 份）**'
const add = [
  '**H3 近空产物的诊断（本轮，测量端混淆）**',
  '',
  '逐份查原始产出后发现：近空产物并非"做不出来"，而是**执行 AI 开始"干活"就停了**——',
  '- SHIP 的一份（1536 字节）只输出 TODO 清单（遵循了命令里"先列 todo"）；',
  '- 候选版的一份（640 字节）写着 `Step 1 — 侦察：查找工作目录下的几何文件`，并输出 `<tool_calls>` 想执行 `pwd` / `ls` / `find *.obj`。',
  '',
  '**但测量台的执行 AI 没有任何工具**（无文件系统、无 shell），于是它卡在第一步、产出近空文件。',
  '结论：**H3 的测量被"无工具执行体 + 命令要求先查证"这对矛盾污染**，不能据此判断提示词优劣。',
  '处置：在产物级执行体的系统提示里明确"你没有工具、不要输出计划或工具调用，直接产出完整单文件 HTML"，下一轮用**修好的量具**重测 H3。',
  '',
  anchor,
].join('\n')
if (ch.indexOf('H3 近空产物的诊断') >= 0) console.log('CHANGELOG: 已有诊断小节')
else if (ch.indexOf(anchor) >= 0) { ch = ch.replace(anchor, add); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已追加诊断小节') }
else console.log('CHANGELOG: 锚点未找到')

// 3) 提交信息
fs.writeFileSync(path.join(ev, 'commit-msg-038.txt'), [
  'test(rig): 诊断 H3 近空产物 —— 测量端混淆（无工具执行体 vs 命令要求先查证），并修量具',
  '',
  '- 逐份查原始产出：近空产物不是"做不出来"，而是执行 AI 开始"干活"就停了',
  '  · SHIP 一份（1536B）只输出 TODO 清单；候选版一份（640B）写 Step 1 侦察并输出 <tool_calls> 想跑 pwd/ls/find',
  '  · 测量台执行 AI 无任何工具（无文件系统/无 shell）⇒ 卡在第一步、产出近空文件',
  '- 结论：H3 测量被"无工具执行体 + 命令要求先查证"这对矛盾污染，不能据此判断提示词优劣',
  '- 处置：lab-html.json 的 solverSystem 明确"你没有工具、不要输出计划或工具调用、直接产出完整单文件 HTML"',
  '- 文档：CHANGELOG 追加"H3 近空产物的诊断（测量端混淆）"小节；下一轮用修好的量具重测 H3',
  '- 证据：evidence/cx-037-h3.json（原始产出）、artifacts/H3*（含近空样本）',
].join('\n'), 'utf8')
console.log('MSG 已写')
