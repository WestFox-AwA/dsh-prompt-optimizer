// 产物级（单文件 HTML）测量台规格：题目要求产出**一个可直接打开的 HTML 文件**，
// 并强制一套可验证接口（buildGeometry / __selftest），使"法线朝向 / 可见面 / 操控映射"能在 Node 里客观验证。
// 用法：node evidence/lab-html.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const T = (zh, l1, l2, l3) => ({ zh, tiers: [l1, l2, l3] })
const IFACE = [
  '',
  '交付物（必须满足，否则视为未完成）：',
  '1) **单个 HTML 文件**（无构建、无本地依赖；可用 CDN 引入 three.js）；',
  '2) 文件内必须定义纯函数 `buildGeometry()`，返回 `{positions:[[x,y,z],...], indices:[...]}`（几何构造不得依赖 WebGL，以便自动化验证）；',
  '3) 必须定义 `window.__selftest()`，返回 JSON：`{facesOutwardRatio, inwardFaces, faces, side, cullBackFaces, controls:{move,turn,turret,exitCapture,sensitivity,invertY}}`；',
  '4) 外观面必须朝外（该看见的面看得见、不该看见的看不见）；',
  '5) 操控：W/S 前后、A/D 转向、鼠标转炮塔、Esc 退出鼠标捕获，并可在界面上调灵敏度与反转 Y 轴，附操作提示。',
].join('\n')

const TASKS = [
  {
    id: 'H1-tank-box-normals',
    kind: '单文件 3D 产物·法线与可见面',
    prompt: '给我一个单文件 HTML：打开就能看到一个坦克车体盒子，能从外面正常看见它的各个面。',
    criteria: [
      T('要求单文件 HTML 且给出打开方式', ['html'], ['单文件', '直接打开', '无构建'], ['验收', '可运行', '截图']),
      T('要求几何与渲染解耦（buildGeometry 纯函数）', ['函数'], ['buildGeometry', '几何构造', '纯函数', '不依赖 WebGL'], ['可自动化验证', '自检']),
      T('要求自检接口（__selftest 返回法线与可见性数据）', ['自检'], ['__selftest', '返回 JSON', 'facesOutwardRatio'], ['逐项', '断言']),
      T('法线朝向正确（外观面朝外、无内向面）', ['法线'], ['朝外', '统一朝向', '无内向面', '绕序', 'winding'], ['验证', '比例', '审计']),
      T('可见性策略明确（正面渲染/背面剔除，或双面并说明代价）', ['可见'], ['FrontSide', '背面剔除', 'DoubleSide', 'cull'], ['对照', '开关对比']),
      T('判定标准与证据（什么算做对了）', ['测试'], ['判定标准', '比例阈值', '截图'], ['逐条', '报告']),
    ],
  },
  {
    id: 'H2-tank-controls',
    kind: '单文件 3D 产物·操控人性化',
    prompt: '给我一个单文件 HTML：能开这个坦克盒子，操作要顺手，别让人不知道怎么玩。',
    criteria: [
      T('输入映射成表（移动/转向/炮塔/退出）', ['按键'], ['W/S', 'A/D', '鼠标', '映射', '键位'], ['逐项列出', '可重绑定']),
      T('可发现性（首次使用有操作提示）', ['提示'], ['操作提示', '界面提示', 'help'], ['实测', '验收']),
      T('可恢复（暂停/退出鼠标捕获）', ['退出'], ['Esc', '暂停', '退出捕获', '光标'], ['验证', '边界']),
      T('可配置（灵敏度/反转 Y 轴）', ['设置'], ['灵敏度', '反转', '设置面板'], ['保存', '生效验证', '默认值']),
      T('操控手感（加速/转向可调、不失控）', ['手感'], ['加速度', '转向速率', '阻尼', '不失控'], ['实测', '数值', '对照']),
      T('判定标准与证据', ['测试'], ['判定标准', '验收'], ['逐条', '报告']),
    ],
  },
]

const spec = {
  builtAt: new Date().toISOString(),
  kind: 'html-artifact',
  artifact: { interface: IFACE, verifier: 'html-verify.cjs', outDir: 'artifacts' },
  scoring: { levels: ['0 缺失', '1 模糊提及', '2 可判定要求', '3 可判定要求 + 验证/回归/边界'], perCriterionMax: 3, perTaskMax: TASKS[0].criteria.length * 3, suiteMax: TASKS.length * TASKS[0].criteria.length * 3, lines: { pass: 0.6, target: 0.83, full: 1.0 } },
  solverSystem: [
    '你是执行型 AI。下面是一条来自用户的指令：直接照它执行并给出结果。',
    '本题的交付物是一个**完整的单文件 HTML**。请只输出该 HTML 文件的内容本身（从 <!doctype html> 开始到 </html> 结束），',
    '不要任何解释、不要 Markdown 代码围栏、不要省略号。必须实现指令里要求的 buildGeometry() 与 window.__selftest()。',
  ].join('\n'),
  judgeSystem: [
    '你是严格的评分员。给你一道题、交给执行 AI 的指令、以及执行 AI 的回答。',
    '对每条要点打 0 / 1 / 2 / 3：0＝完全没提；1＝提到了但不可判定；2＝给出明确、可判定的要求；3＝在 2 的基础上还要求了验证证据、回归或边界处理。',
    '只输出 JSON：{"points":[...],"total":N,"max":M,"note":"..."}。不要因为指令写得长而加分。',
  ].join('\n'),
  tasks: TASKS,
}
const out = path.join(ev, 'lab-html.json')
fs.writeFileSync(out, JSON.stringify(spec, null, 1), 'utf8')
console.log('WROTE ' + out + '  tasks=' + TASKS.length + ' (' + TASKS.map((t) => t.id).join(', ') + ')  suiteMax=' + spec.scoring.suiteMax)
