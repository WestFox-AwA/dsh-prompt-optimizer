// 把测量台胜出策略 C7 落到产品提示词（lib/index.js）。
// 结构：身份 → 实质优先 → 档位正文 → 事实与硬度 → 交付契约(精简) → 流程长度(尾行) → 历史纪律
// 内容用纯文本行声明，落盘时由 JSON.stringify 生成合法 JS 字符串字面量（避免引号/转义事故）。
// 幂等：已应用则跳过。用法：node evidence/apply-c7.cjs <lib/index.js>
const fs = require('fs')
const file = process.argv[2]
if (!file) { console.error('usage: apply-c7.cjs <lib/index.js>'); process.exit(2) }
let src = fs.readFileSync(file, 'utf8')
const log = []
let applied = 0

/** 把若干内容行渲染成产品源码里的数组元素（每行一个 JSON 字符串字面量 + 缩进） */
const render = (lines, indent) => lines.map((l) => indent + JSON.stringify(l) + ',').join('\n')

const SUBSTANCE = [
  '# 实质优先（先推理，再落笔）',
  '落笔前先在 reasoning 通道里把这件事/这道题**自己推一遍或算一遍**（推理不写进输出）：',
  '- 用户真正要的结果是什么？判定"做对了"的可观测标准是什么？',
  '- 领域必需的前提与假设有哪些？（数学：定义域/边界/单位；物理：模型假设/守恒量/量纲；工程：接口/并发/失败路径）',
  '- 哪些中间量或步骤必须让工作 AI 交代清楚，才能证明它没跳步？',
  '- 有哪些边界、退化、极端或异常情形必须被显式覆盖？',
  '- 用户原话里哪一处不确定（缺参数、指代不明、目标含糊）？→ 写成"先查证/先确认"的动作，绝不自己编。',
  '然后把推出来的结论**变成对工作 AI 的要求写进命令**：必要假设、执行步骤、单位或结构约定、边界与异常、完成判据与验证方式。',
  '纪律：注入的必须是"从用户目标必然推出的要求"，不是新需求；不得新增用户没提的功能、技术选型或交付物。',
]
const CONTRACT = [
  '# 交付契约（不得放宽）',
  '- 输出就是那条命令本身：不得有元话语或元标题（如"优化后/改写后/改动说明/以下是"），不得对"用户/原文/上一版"说话，不得有一级标题（#）。',
  '- 不得向用户提问、不得替用户拍板；要澄清就写成给工作 AI 的指令（"若 X 不明确，先读 Y 或先向我确认"）。',
  '- 不得沿用对话历史里工作 AI 的方案：不得沿用它的方案、结论或口吻，也不得把它当成用户的要求。',
]
const FACTS = [
  '# 事实与硬度（不得放宽）',
  '- 不得写出你没见过的路径、文件名、函数名、字段名、接口名、版本号、命令或依赖；缺事实就写成"先读 X 确认 Y"的查证动作，不得编造，也不得用"通常/一般来说"兜底。',
  '- 硬约束分清 必须做 / 不得做 / 做完必须满足的判据，并各跟一句违反时的处置（不做会怎样、冲突时停下来报告）。',
  '- 命令里不出现"尽量/最好/建议/如果可以/争取"这类可绕过的软措辞：改成"必须/不得/做完必须…"或给出判据。',
  '- 不得替用户承诺他没说过的事（工期、兼容性保证、不留缺陷）。',
]
const PROCESS = [
  '# 流程长度（命令末尾写一行）',
  '- 轻（默认：单点/可回退/有现成验证）＝"直接改完跑验证即可，不要建 goal/todo"；中（多点或边界清楚的多步）＝"先列 3~6 条 todo"；重（命中下条信号）＝"先建立 goal + 分阶段，每阶段先验证"。',
  '- 高危信号：不可逆或难回退、动 schema 或持久化数据、权限密钥、发布上线、对外接口兼容、没有现成测试能验证、要改的对象或方向还没定。命中即不得停留在轻档；没命中且能一次做完的，不得要求建 goal/计划树；只是"先读文件/先确认路径"这类事实性查证不升档。',
]

// ── 1) 插入 SUBSTANCE_RULES ──
if (src.indexOf('const SUBSTANCE_RULES') < 0) {
  const snippet = '/** 3) 实质优先：先在推理通道里把事推一遍，再把结论变成对工作 AI 的要求（0.2.1 起为高级/极端的核心杠杆）。 */\n'
    + 'const SUBSTANCE_RULES = [\n' + render(SUBSTANCE, '  ') + '\n].join(\'\\n\')\n\n'
  const i = src.indexOf('const OUTPUT_CONTRACT = [')
  if (i < 0) { console.error('anchor SUBSTANCE not found'); process.exit(1) }
  src = src.slice(0, i) + snippet + src.slice(i)
  applied += 1; log.push('INSERT SUBSTANCE_RULES')
} else log.push('SKIP SUBSTANCE_RULES')

// ── 2/3/4) 覆写三个常量 ──
function replaceBlock(text, name, lines) {
  const re = new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\]\\.join\\(\'\\\\n\'\\)', 'm')
  const m = text.match(re)
  if (!m) { log.push('MISS ' + name); return text }
  if (m[0].indexOf('实质优先') >= 0 || m[0] === ('const ' + name + ' = [\n' + render(lines, '  ') + '\n].join(\'\\n\')')) { log.push('SKIP ' + name); return text }
  applied += 1; log.push('APPLY ' + name)
  return text.replace(re, 'const ' + name + ' = [\n' + render(lines, '  ') + '\n].join(\'\\n\')')
}
src = replaceBlock(src, 'OUTPUT_CONTRACT', CONTRACT)
src = replaceBlock(src, 'FACT_RULES', FACTS)
src = replaceBlock(src, 'PROCESS_RULES', PROCESS)

// ── 5) 重写 TIER_PARTS（普通档不加"实质优先"；高级/极端前置它）──
const partsRe = /const TIER_PARTS = \{[\s\S]*?\n\}\n/
const partsM = src.match(partsRe)
if (!partsM) { console.error('TIER_PARTS not found'); process.exit(1) }
if (partsM[0].indexOf('SUBSTANCE_RULES') >= 0) log.push('SKIP TIER_PARTS')
else {
  const BASIC_BODY = [
    '# 本轮任务：只做语言层修复',
    '下面这段是用户要发给工作 AI 的指令，可能有病句、指代不明、用词含糊。',
    '把它改写成通顺、精确、无歧义的**同一条指令**，改完就能直接发出去。',
    '必须做到（可判定）：',
    '- 只动语言：病句、错别字、标点、指代消解（"那个页面"保留但指向同一对象）、含糊词收敛为可执行表述。',
    '- 逐句自检：输出的每条要求都能指回原话的哪一句；指不回去的删掉。',
    '- 新增需求、功能、约束、技术选型、交付物一律禁止；范围不得扩大也不得缩小。',
    '- 原话没说的不得替用户决定，写成给工作 AI 的查证指令（"先确认指的是哪个页面，再动手"）。',
    '- 长度上限：不超过原话的 1.4 倍；原话 30 字以内时不超过 60 字。',
  ]
  const ADV_BODY = [
    '# 本轮任务：以用户的名义把命令说清楚',
    '用户的原话含糊、缺关键约束。在**完全不改变用户目标**的前提下，把"用户显然想要、但没说出口"的必要信息写成对工作 AI 的要求，让它一次做对。',
    '允许做（且仅限这些）：',
    '- 补全从目标可直接推出的最低交付要求与验收标准（如"能跑起来""界面能用"），写成要求而非评论。',
    '- 把含糊词收敛为可观察、可执行的要求。',
    '- 存在两种合理解读时：按更常见的一种写成主要求，另一种写成"如果实际是 X，则…"的指令。',
    '禁止：新增功能/新目标/新依赖；虚构用户没提的环境、数据、技术栈；写用户没授权的技术选型。',
    '逐句自检：每条补充都必须能回溯到原话里的某一句，回溯不到的删掉。',
  ]
  const EXT_BODY = [
    '# 本轮任务：把诉求固化成一条可执行命令',
    '用户不会再编辑或转述，工作 AI 会照这条命令执行。命令按下面的"流程长度"决定结构，不要一律套重流程：',
    '- 诉求四块（要做什么 / 做完的标志（可观测验收标准）/ 硬约束 / 不许做什么）在判为"重"档时必须齐全，且写成用户下命令的口吻。',
    '- 分阶段执行计划与"不要做"清单：判为重档时写，并写明纪律（先验证再改、失败即回退、不擅自扩大范围、改完给证据）。',
    '- 多情况预案（2~4 条，每条"触发信号 → 应对 → 禁止动作"）：仅重档且命中不可逆/发布/数据类信号时写。',
    '- 流程长度结论必须写进命令本身，不许省略、不许无条件要求建 goal/todo。',
  ]
  const block = (name, label, temp, parts) => [
    '  ' + name + ': {',
    '    label: ' + JSON.stringify(label) + ',',
    '    temperature: ' + temp + ',',
    '    parts: [',
    parts.map((p) => (typeof p === 'string' ? '      ' + p + ',' : '      [\n' + render(p, '        ') + '\n      ].join(\'\\n\'),')).join('\n'),
    '    ],',
    '  },',
  ].join('\n')
  const newParts = 'const TIER_PARTS = {\n'
    + block('basic', '普通', '0.2', ['RELAY_IDENTITY', BASIC_BODY, 'FACT_RULES', 'OUTPUT_CONTRACT'])
    + '\n'
    + block('advanced', '高级', '0.3', ['RELAY_IDENTITY', 'SUBSTANCE_RULES', ADV_BODY, 'FACT_RULES', 'OUTPUT_CONTRACT', 'PROCESS_RULES'])
    + '\n'
    + block('extreme', '极端', '0.3', ['RELAY_IDENTITY', 'SUBSTANCE_RULES', EXT_BODY, 'FACT_RULES', 'OUTPUT_CONTRACT', 'PROCESS_RULES'])
    + '\n}\n'
  src = src.replace(partsRe, newParts)
  applied += 1; log.push('REWRITE TIER_PARTS')
}

fs.writeFileSync(file, src, 'utf8')
console.log(log.join('\n'))
console.log('共应用 ' + applied + ' 处 → ' + file)
