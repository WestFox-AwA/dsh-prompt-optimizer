// 简单任务规格（回归用）：沿用 lab-spec.json 的 4 道原题与要点，但**不带 variants**，
// 以便执行器改用外挂的 cx-variants.json（raw / 发布版 / v0.3 三条件同批对比）。
// 用法：node evidence/lab-simple.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const base = JSON.parse(fs.readFileSync(path.join(ev, 'lab-spec.json'), 'utf8'))
const spec = {
  builtAt: new Date().toISOString(),
  kind: 'simple-regression',
  note: '用于验证"复杂任务能力包"没有泄漏到简单任务、也没有把简单命令撑长',
  solverSystem: base.solverSystem,
  judgeSystem: base.judgeSystem,
  tasks: base.tasks.map((t) => ({ id: t.id, kind: t.kind, prompt: t.prompt, rubric: t.rubric, cmdRubric: t.cmdRubric })),
}
const out = path.join(ev, 'lab-simple.json')
fs.writeFileSync(out, JSON.stringify(spec, null, 1), 'utf8')
console.log('WROTE ' + out + '  tasks=' + spec.tasks.length + ' (' + spec.tasks.map((t) => t.id).join(', ') + ')')
