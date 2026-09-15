// 公平化：把"可自动化验收接口"写进**用户原话**（否则评分卡要求优化器写出用户没提的接口，属于不公平）。
// 保留评分卡不变——这样"命令有没有把接口带下去"才是优化器真实的得分点。
// 用法：node evidence/lab-html-fair.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const spec = JSON.parse(fs.readFileSync(path.join(ev, 'lab-html.json'), 'utf8'))

const IFACE_USER = [
  '另外我要能自动化验收（我没法每次都手点）：文件里请暴露一个纯函数 buildGeometry()（返回 {positions, indices}），',
  '并把 window.__selftest() 挂到全局，返回 JSON：{facesOutwardRatio, inwardFaces, faces, side, cullBackFaces, controls:{move,turn,turret,exitCapture,sensitivity,invertY}}。',
  '如果是"修反向面"这类任务，__selftest() 还要给出修复前的反向面数 brokenFacesBefore 与修复后的 inwardFaces。',
].join('')

const PROMPTS = {
  'H1-tank-box-normals': '给我一个单文件 HTML：打开就能看到一个坦克车体盒子，能从外面正常看见它的各个面。' + IFACE_USER,
  'H2-tank-controls': '给我一个单文件 HTML：能开这个坦克盒子，操作要顺手，别让人不知道怎么玩。' + IFACE_USER,
  'H3-fix-inverted-mesh': '我有个坦克车体的网格，导入后发现有些面从外面看不见、从里面反而能看见。给我一个单文件 HTML：把它修好，并且能自己检测出修了几个面。' + IFACE_USER,
}
let n = 0
for (const t of spec.tasks) {
  if (PROMPTS[t.id]) {
    t.prompt = PROMPTS[t.id]
    t.promptHasInterface = true
    n += 1
  }
}
spec.fairness = { at: new Date().toISOString(), note: '验收接口已写进用户原话（先前的规格不公平：接口只写在执行 AI 提示里）' }
fs.writeFileSync(path.join(ev, 'lab-html.json'), JSON.stringify(spec, null, 1), 'utf8')
console.log('公平化完成：' + n + ' 道题的原话已包含验收接口')
for (const t of spec.tasks) console.log('  ' + t.id.padEnd(24) + t.prompt.length + ' 字')
