// 追加/更新产物级题目：H3「审计并修复反向面网格」（有区分度：必须真的发现并修好反向面，并交修复前后计数）。
// 用法：node evidence/lab-html-h3.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const spec = JSON.parse(fs.readFileSync(path.join(ev, 'lab-html.json'), 'utf8'))
const T = (zh, l1, l2, l3) => ({ zh, tiers: [l1, l2, l3] })

// 接口追加：修复类题目必须回报修复前后计数（可客观核对）
spec.artifact.interface += [
  '',
  '6) 若题目要求"修复反向面"，`__selftest()` 还必须额外返回 `brokenFacesBefore`（修复前检测到的反向面数）与 `inwardFaces`（修复后仍存在的反向面数，应为 0）。',
].join('\n')

const H3 = {
  id: 'H3-fix-inverted-mesh',
  kind: '单文件 3D 产物·审计并修复反向面',
  prompt: '我有个坦克车体的网格，导入后发现有些面从外面看不见、从里面反而能看见。给我一个单文件 HTML：把它修好，并且能自己检测出修了几个面。',
  criteria: [
    T('要求先量化：检测出"有多少面朝向反了"而不是凭感觉', ['看看'], ['检测', '统计', '反向面数', '审计'], ['修复前后对照', '报告数值']),
    T('要求给出检测方法（面法线与质心方向点积/绕序判定）', ['检查'], ['法线', '点积', '绕序', 'winding', '质心'], ['可判定', '阈值', '逐面']),
    T('要求修复动作（翻转绕序或重算法线，并说明依据）', ['修一下'], ['翻转', '绕序', '重算', '统一朝向'], ['复核', '复检', '修复后为 0']),
    T('要求修复前后计数（brokenFacesBefore / inwardFaces）', ['数字'], ['修复前', '修复后', '计数', 'brokenFacesBefore'], ['逐项', '断言']),
    T('要求防复发（把检查固化进加载/导入流程）', ['注意'], ['固化', '检查清单', '每次加载'], ['自动', '回归']),
    T('判定标准与证据（什么算修好了）', ['测试'], ['判定标准', '比例', '为 0'], ['逐条', '报告']),
  ],
}
spec.tasks = spec.tasks.filter((t) => t.id !== H3.id).concat([H3])
spec.scoring.suiteMax = spec.tasks.length * spec.tasks[0].criteria.length * 3
spec.builtAt = new Date().toISOString()
fs.writeFileSync(path.join(ev, 'lab-html.json'), JSON.stringify(spec, null, 1), 'utf8')
console.log('lab-html.json  tasks=' + spec.tasks.length + ' (' + spec.tasks.map((t) => t.id).join(', ') + ')')
