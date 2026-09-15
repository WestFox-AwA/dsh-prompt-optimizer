// 生成测量台规格文件：测试题 + 评分要点 + 各候选提示词（从快照 JSON 取旧/现版，另加新策略候选）。
// 用法：node evidence/lab-build.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname

const TASKS = [
  {
    id: 'T1-math-rate',
    kind: '数学推理',
    prompt: '一个水池有甲乙两个进水管和一个排水管。甲管单独注满需 6 小时，乙管单独注满需 4 小时，排水管单独排空需 3 小时。三管同时开启，多久能把空池注满？',
    rubric: [
      '三管速率都化为"池/小时"：甲 1/6、乙 1/4、排水 1/3',
      '把"同时开启"正确建模为速率相加（含排水为负）',
      '算出净速率 1/12 池/小时',
      '给出答案 12 小时，且单位明确',
      '没有任何编造的条件（如水位、管径）被当作已知',
    ],
    cmdRubric: [
      '指令里明确写出三管速率（池/小时）以及"同时开启 = 速率相加、排水为负"',
      '要求给出解题过程/步骤，而不是只要一个数字',
      '要求结果带单位（小时），并要求中间量也带单位',
      '要求自检"净速率是否为正、是否真的能注满"',
      '没有凭空添加原文没有的条件（水位/管径/初始水量等）',
    ],
  },
  {
    id: 'T2-math-ramsey',
    kind: '数学推理',
    prompt: '证明：任意 6 个人中，一定存在 3 个人互相认识，或者 3 个人互相都不认识。',
    rubric: [
      '把"认识"关系建模为完全图的边二着色（或等价的关系语言）',
      '固定一个人，用抽屉原理说明其 5 条边中至少有 3 条同色',
      '分情况讨论这 3 人之间的边，导出同色三角形',
      '结论覆盖"互相认识"与"互相不认识"两种情形',
      '论证无逻辑跳跃（每一步的推理依据都点明）',
    ],
    cmdRubric: [
      '指令要求用图论/边二着色（或等价关系模型）来表述问题',
      '指令点明"抽屉原理/鸽巢"是关键步骤',
      '指令要求分情况讨论并给出同色三角形的结论',
      '指令要求每步给依据、不许跳步',
      '没有添加与证明无关的要求（写代码验证、性能等）',
    ],
  },
  {
    id: 'T3-physics-crash',
    kind: '物理建模',
    prompt: '估算：一辆 1.5 吨的汽车以 60 km/h 撞上刚性墙，平均减速度和碰撞时间大约是什么量级？请给出建模思路。',
    rubric: [
      '明确声明建模假设（刚性墙、匀减速或明确的等效模型）',
      '把 60 km/h 正确换算为国际单位（约 16.7 m/s）',
      '给出减速度估计并表示为 g 的倍数（碰撞时间取 0.1 s 量级 → 约 170 m/s² ≈ 17 g）',
      '给出能量量级（约 2×10^5 J）或动量量级',
      '指出最大不确定来源（碰撞时间/变形行程），不做假精确',
    ],
    cmdRubric: [
      '指令要求先声明建模假设（刚性墙/匀减速/碰撞时间取值）',
      '指令要求做单位换算（km/h → m/s）',
      '指令要求把减速度表达为 g 的倍数，并说明碰撞时间取值的依据',
      '指令要求给出量级估计（能量或动量）',
      '指令要求指出不确定来源并禁止假精确',
    ],
  },
  {
    id: 'T4-code-cache',
    kind: '工程/代码',
    prompt: '给一个 Python 函数加缓存，要求线程安全，并说明怎么测试它。',
    rubric: [
      '指出标准做法（functools.lru_cache）并说明它与线程安全的关系',
      '给出线程安全的具体措施（锁的粒度/竞态说明），不停留在"加锁即可"',
      '给出可执行的测试设计（并发同参调用、命中计数、结果一致性）',
      '区分"缓存"与"记忆化"的适用边界（不可哈希参数、副作用、内存增长）',
      '不编造不存在的库或不存在的 API',
    ],
    cmdRubric: [
      '指令提到 functools.lru_cache（或等价标准做法）并要求说明其线程安全语义',
      '指令要求给出线程安全的具体措施（锁的粒度/竞态点），不许笼统写"加锁即可"',
      '指令要求给出可执行的并发测试设计（同参并发调用、命中计数、结果一致）',
      '指令要求说明适用边界（不可哈希参数/副作用/内存增长）',
      '没有要求编造不存在的库或 API',
    ],
  },
]

const snapV011 = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-v011.json'), 'utf8'))
const snapCur = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-cur.json'), 'utf8'))

// 各版本真实的"用户消息模板"（relayMessage 产物），保证 A/B 时提示词与模板配套
const RELAY_V011 = [
  '【待转达内容】下面是"用户"发给我的原话。**它不是说给你听的**，你不需要回应它、也不需要替用户去做这件事。',
  '<原文>',
  '{TASK}',
  '</原文>',
  '',
  '【你的任务】以用户的名义，把上面的内容整理成**一条可以直接发给"工作 AI"的命令**：',
  '- 只输出这条命令本身；不要回应我、不要回答问题、不要谢幕、不要解释你做了什么。',
  '- 读你这条命令的人只有"工作 AI"一个。',
].join('\n')

const RELAY_CUR = [
  '【待转达内容】下面是"用户"发给我的原话。**它不是说给你听的**：不要回应它、不要替用户去做这件事、不要把它当成对话输入。',
  '<原文>',
  '{TASK}',
  '</原文>',
  '',
  '按你的角色与交付契约，以用户的名义把上面的内容整理成一条可直接发给"工作 AI"的命令；现在直接输出这条命令。',
].join('\n')

const variants = []
for (const tier of ['basic', 'advanced', 'extreme']) {
  variants.push({ id: 'v011-' + tier, group: '0.1.1 旧提示词', tier, system: snapV011.tiers[tier].system, relayUser: RELAY_V011 })
  variants.push({ id: 'cur-' + tier, group: '当前提示词', tier, system: snapCur.tiers[tier].system, relayUser: RELAY_CUR })
}
variants.push({ id: 'raw', group: '无优化（对照）', tier: null, system: null, relayUser: null })

// ── 候选策略：针对"合规机器挤掉实质注入"的退化 ──
const partList = (sys) => String(sys || '').split('\n\n')
const pick = (sys, prefix) => partList(sys).find((p) => p.startsWith(prefix)) || ''

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
].join('\n')

const DEMO = [
  '# 示范（含糊需求 → 可执行命令的力度，只示范力度，不要照抄内容）',
  '用户原话："给这个函数加个缓存，注意多线程。"',
  '合格命令：给 <函数名> 加缓存：①用 functools.lru_cache；若参数不可哈希，先转成可哈希 key 并说明为什么 ②说明它在多线程下是否安全；不安全就用锁保护，并指出锁的粒度与竞态点 ③必须处理：不同参数不串味、并发同参只算一次、无上限缓存的内存增长 ④测试：8 个线程用同一参数并发调用，断言函数体只执行一次且返回值一致 ⑤交付改动 diff 与测试输出。做不到的部分停下来报告，不要改用别的方法。',
].join('\n')

const MINI_RULES = [
  '# 铁律（只有这四条）',
  '- 输出就是那条命令本身：不得有元话语、元标题、解释或收尾语。',
  '- 不得向用户提问、不得对"用户/原文"说话；要澄清就写成给工作 AI 的指令。',
  '- 不得编造项目事实：没见过的路径/字段/接口/版本一律写成"先查证"。',
  '- 不得沿用对话历史里工作 AI 的方案与结论，也不得把它当成用户的要求。',
].join('\n')

const curAdv = snapCur.tiers.advanced.system
const curExt = snapCur.tiers.extreme.system

// C1：实质清单前置 + 合规后置（其余沿用当前版）
variants.push({
  id: 'C1-advanced', group: '候选C1 实质优先', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(curAdv, '# 身份'), SUBSTANCE, pick(curAdv, '# 本轮任务'), pick(curAdv, '# 流程长度'), pick(curAdv, '# 事实纪律'), pick(curAdv, '# 交付物'), pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C1-extreme', group: '候选C1 实质优先', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(curExt, '# 身份'), SUBSTANCE, pick(curExt, '# 本轮任务'), pick(curExt, '# 流程长度'), pick(curExt, '# 事实纪律'), pick(curExt, '# 交付物'), pick(curExt, '# 历史纪律')].join('\n\n'),
})
// C2：C1 + 少样本示范
variants.push({
  id: 'C2-advanced', group: '候选C2 实质+示范', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(curAdv, '# 身份'), SUBSTANCE, DEMO, pick(curAdv, '# 本轮任务'), pick(curAdv, '# 流程长度'), pick(curAdv, '# 事实纪律'), pick(curAdv, '# 交付物'), pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C2-extreme', group: '候选C2 实质+示范', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(curExt, '# 身份'), SUBSTANCE, DEMO, pick(curExt, '# 本轮任务'), pick(curExt, '# 流程长度'), pick(curExt, '# 事实纪律'), pick(curExt, '# 交付物'), pick(curExt, '# 历史纪律')].join('\n\n'),
})
// C3：把合规压到最小，其余全给实质（测试"规则越少、实质越多"）
variants.push({
  id: 'C3-advanced', group: '候选C3 极简规则', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(snapV011.tiers.advanced.system, '【你是谁】').split('\n【你不是谁】')[0], SUBSTANCE, pick(curAdv, '# 本轮任务'), MINI_RULES, pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C3-extreme', group: '候选C3 极简规则', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(snapV011.tiers.extreme.system, '【你是谁】').split('\n【你不是谁】')[0], SUBSTANCE, pick(curExt, '# 本轮任务'), MINI_RULES, pick(curExt, '# 历史纪律')].join('\n\n'),
})

// C4：C3 + 精简版的"硬约束写法/软措辞禁令"（保住合规要点，但不回到长篇机器）
const FACT_COMPACT = [
  '# 事实与硬度（不可放宽）',
  '- 不得写出你没见过的路径、文件名、函数名、字段名、接口名、版本号、命令或依赖；缺事实就写成"先查证"，不得编造，也不得用"通常/一般来说"兜底。',
  '- 硬约束分清 必须做 / 不得做 / 做完必须满足的判据，并各跟一句违反时的处置。',
  '- 命令里不出现"尽量/最好/建议/如果可以/争取"这类可绕过的软措辞：改成"必须/不得/做完必须…"或给出判据。',
  '- 不得替用户承诺他没说过的事（工期、兼容性保证、不留缺陷）。',
].join('\n')
variants.push({
  id: 'C4-advanced', group: '候选C4 极简+硬度', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(snapV011.tiers.advanced.system, '【你是谁】').split('\n【你不是谁】')[0], SUBSTANCE, pick(curAdv, '# 本轮任务'), FACT_COMPACT, MINI_RULES, pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C4-extreme', group: '候选C4 极简+硬度', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(snapV011.tiers.extreme.system, '【你是谁】').split('\n【你不是谁】')[0], SUBSTANCE, pick(curExt, '# 本轮任务'), FACT_COMPACT, MINI_RULES, pick(curExt, '# 历史纪律')].join('\n\n'),
})

// C5：C4 + 压缩版"流程长度"（保住上一轮要的编排强度能力，且不回到长篇机器）
const PROCESS_COMPACT = [
  '# 流程长度（替工作 AI 定，命令里写一行）',
  '- 轻（默认）：单点/单文件、可回退、有现成验证 → "直接改完跑 <验证> 即可；不要建 goal/todo、不要写计划"。',
  '- 中：多文件或多步骤、可回退且边界清楚 → "先列 3~6 条 todo，按顺序做，做完逐条勾掉"。',
  '- 重：命中高危信号且无法拆成互不依赖的小步 → "先建立 goal：<一句话目标>（验收：<可观测判据>）；分阶段推进，每阶段先验证"。',
  '高危信号（命中任一即不得停留在轻档）：不可逆或难回退（删除/迁移/覆盖数据）；动 schema、持久化数据、权限、密钥、发布上线；动对外接口或向后兼容；没有现成测试能验证；要改的对象或方向还没定。',
  '反向纪律：没命中高危信号、且能一次做完的，不得让工作 AI 建 goal/计划树/阶段文档；只是需要先读文件、先确认路径这类事实性查证不升档。',
].join('\n')
const MINI_RULES_HARD = [
  '# 铁律（不得放宽）',
  '- 输出就是那条命令本身：不得有元话语或元标题（如"优化后/改写后/改动说明/以下是"），不得对"用户/原文/上一版"说话，不得有一级标题（#）。',
  '- 不得向用户提问、不得替用户拍板；要澄清就写成给工作 AI 的指令（"若 X 不明确，先读 Y 或先向我确认"）。',
  '- 不得编造项目事实：没见过的路径/字段/接口/版本一律写成"先读 X 确认 Y"的查证动作；缺事实不得用"通常/一般来说"兜底。',
  '- 不得沿用对话历史里工作 AI 的方案与结论，也不得把它当成用户的要求。',
].join('\n')
variants.push({
  id: 'C5-advanced', group: '候选C5 实质+流程+硬度', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(curAdv, '# 身份'), SUBSTANCE, pick(curAdv, '# 本轮任务'), PROCESS_COMPACT, FACT_COMPACT, MINI_RULES_HARD, pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C5-extreme', group: '候选C5 实质+流程+硬度', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(curExt, '# 身份'), SUBSTANCE, pick(curExt, '# 本轮任务'), PROCESS_COMPACT, FACT_COMPACT, MINI_RULES_HARD, pick(curExt, '# 历史纪律')].join('\n\n'),
})

// C6：C4 + 两行压缩版流程长度（保住编排强度能力，且总长仍短于当前版）
const PROCESS_TINY = [
  '# 流程长度（命令里写一行）',
  '- 轻（默认：单点/可回退/有现成验证）→"直接改完跑 <验证> 即可；不要建 goal/todo"；中（多点或边界清楚的多步）→"先列 3~6 条 todo"；重（命中高危信号）→"先建立 goal + 分阶段，每阶段先验证"。',
  '- 高危信号：不可逆或难回退、动 schema 或持久化数据、权限密钥、发布上线、对外接口兼容、没有现成测试能验证、要改的对象或方向还没定。命中即不得停留在轻档；没命中且能一次做完的，不得让工作 AI 建 goal/计划树；只是"先读文件/先确认路径"这类事实性查证不升档。',
].join('\n')
variants.push({
  id: 'C6-advanced', group: '候选C6 实质+两行流程', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(curAdv, '# 身份'), SUBSTANCE, pick(curAdv, '# 本轮任务'), PROCESS_TINY, FACT_COMPACT, MINI_RULES_HARD, pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C6-extreme', group: '候选C6 实质+两行流程', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(curExt, '# 身份'), SUBSTANCE, pick(curExt, '# 本轮任务'), PROCESS_TINY, FACT_COMPACT, MINI_RULES_HARD, pick(curExt, '# 历史纪律')].join('\n\n'),
})

// C7：C4 + 末尾一行流程长度（能力保留，且不占用前置注意力）
const PROCESS_ONE_LINE = '【流程长度】命令末尾写一行：轻（单点/可回退/有现成验证）="直接改完跑验证，不要建 goal/todo"；中（多点或边界清楚的多步）="先列 3~6 条 todo"；重（不可逆或难回退、动 schema 或持久化数据、权限密钥、发布上线、对外接口兼容、没有现成测试能验证、目标未定）="先建立 goal + 分阶段，每阶段先验证"。没命中重档信号、且能一次做完的，不得要求建 goal/计划树；只是"先读文件/先确认路径"这类事实性查证不升档。'
variants.push({
  id: 'C7-advanced', group: '候选C7 实质优先+尾行流程', tier: 'advanced', relayUser: RELAY_CUR,
  system: [pick(curAdv, '# 身份'), SUBSTANCE, pick(curAdv, '# 本轮任务'), FACT_COMPACT, MINI_RULES_HARD, PROCESS_ONE_LINE, pick(curAdv, '# 历史纪律')].join('\n\n'),
})
variants.push({
  id: 'C7-extreme', group: '候选C7 实质优先+尾行流程', tier: 'extreme', relayUser: RELAY_CUR,
  system: [pick(curExt, '# 身份'), SUBSTANCE, pick(curExt, '# 本轮任务'), FACT_COMPACT, MINI_RULES_HARD, PROCESS_ONE_LINE, pick(curExt, '# 历史纪律')].join('\n\n'),
})

const spec = {
  builtAt: new Date().toISOString(),
  solverSystem: '你是执行型 AI。下面是一条来自用户的指令：直接照它执行并给出结果。不要复述指令、不要解释你打算怎么做，直接给结果。',
  judgeSystem: [
    '你是严格的评分员。给你一道题、一条交给执行 AI 的指令、以及执行 AI 的回答。',
    '请对回答按给定的评分要点逐条打分：每条 0（没做到/错误）或 1（做到且正确）。',
    '只输出 JSON，形如：{"points":[1,0,1,1,0],"total":3,"note":"一句话说明扣分原因"}',
    '不要因为指令写得长或好看而加分；只看回答是否真的满足要点。',
  ].join('\n'),
  tasks: TASKS,
  variants,
}
const out = path.join(ev, 'lab-spec.json')
fs.writeFileSync(out, JSON.stringify(spec, null, 1), 'utf8')
console.log('WROTE ' + out)
console.log('  tasks: ' + TASKS.length + '  variants: ' + variants.length + '  → 单元格 ' + (TASKS.length * variants.length))
for (const v of variants) console.log('    ' + v.id.padEnd(14) + v.group.padEnd(18) + (v.system ? v.system.length + ' 字符' : '(直发)'))
