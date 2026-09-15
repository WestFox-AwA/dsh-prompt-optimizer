// 答案侧规格（严格版）：硬题 + 0/1/2 三档评分要点 + 三个版本在极端/高级档的对照。
// 用法：node evidence/lab-ans.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const base = JSON.parse(fs.readFileSync(path.join(ev, 'lab-spec.json'), 'utf8'))
const snapV011 = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-v011.json'), 'utf8'))
const snapCur = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-cur.json'), 'utf8'))
const snapShip = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-c7.json'), 'utf8'))

// 硬题：T5 反直觉条件概率（naive 答 1/2）；T6 物理估算（缓冲距离主导量级）
const HARD = [
  {
    id: 'T5-math-boygirl',
    kind: '数学推理·陷阱',
    prompt: '一个家庭有两个孩子。（假设生男生女概率各半、彼此独立）现在知道其中至少有一个是女孩，问两个都是女孩的概率是多少？',
    points: [
      '把样本空间完整列出（男男/男女/女男/女女）',
      '正确做条件化：在"至少一个是女孩"条件下只剩 3 种等可能情形',
      '结论 1/3（不是 1/2）',
      '点明"至少有一个"与"指定的某个孩子"的区别（后者才是 1/2）',
      '没有引入题面之外的假设（如"先出生的那个"、出生顺序分布等）',
    ],
  },
  {
    id: 'T6-physics-jump',
    kind: '物理建模·量级',
    prompt: '估算：一个 70 公斤的人从 1 米高处跳到硬地面，落地瞬间受到的冲击力大约是体重的多少倍？请给出建模速算。',
    points: [
      '声明建模假设：着地后以（等效）匀减速停下，缓冲距离 s 是关键参数',
      '用能量或冲量关系把力写成 mg(1 + h/s) 或等价的量级关系',
      '代入合理缓冲距离（约 1~5 cm）得到量级：约 20~100 倍体重（不是"1 倍"或"几倍"）',
      '量纲/极限检查：s→0 时力发散、s=h 时约为 2mg（说明模型边界）',
      '指出主导不确定来源就是缓冲距离 s，不做假精确',
    ],
  },
]

const TASKS = base.tasks.map((t) => ({ id: t.id, kind: t.kind, prompt: t.prompt, points: t.rubric })).concat(HARD)

const relay = base.variants.find((v) => v.id === 'cur-advanced').relayUser
const mk = (id, group, tier, snap) => ({ id, group, tier, system: snap.tiers[tier].system, relayUser: relay })

const spec = {
  builtAt: new Date().toISOString(),
  solverSystem: base.solverSystem,
  // 严格评分：每条要点 0（错/缺）/1（部分）/2（完整且正确），满分 2×要点数
  judgeSystem: [
    '你是严格的评分员。给你一道题、交给执行 AI 的指令、执行 AI 的回答、以及评分要点。',
    '对每条要点打 0 / 1 / 2：0＝错误或缺失；1＝部分正确或表述不严谨；2＝完整且正确。',
    '只输出 JSON：{"points":[2,1,0,2,1],"total":6,"max":10,"note":"一句话说明扣分原因"}',
    '不要因为指令写得长、格式漂亮而加分；只看回答本身的正确性与严谨度。',
  ].join('\n'),
  tasks: TASKS,
  variants: [
    { id: 'raw', group: '无优化（对照）', tier: null, system: null, relayUser: null },
    mk('v011-extreme', '0.1.1 旧', 'extreme', snapV011),
    mk('cur-extreme', '0.1.9 当前', 'extreme', snapCur),
    mk('SHIP-extreme', '0.2.1 发布版', 'extreme', snapShip),
    mk('v011-advanced', '0.1.1 旧', 'advanced', snapV011),
    mk('cur-advanced', '0.1.9 当前', 'advanced', snapCur),
    mk('SHIP-advanced', '0.2.1 发布版', 'advanced', snapShip),
  ],
}
const out = path.join(ev, 'lab-ans.json')
fs.writeFileSync(out, JSON.stringify(spec, null, 1), 'utf8')
console.log('WROTE ' + out)
console.log('  题目: ' + TASKS.map((t) => t.id).join(', '))
console.log('  变体: ' + spec.variants.map((v) => v.id).join(', '))
