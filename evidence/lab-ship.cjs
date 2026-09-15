// 生成"发布版提示词"的测量规格：把产品里实际组装出的 system 拿来跑同一批题（测什么就发布什么）。
// 用法：node evidence/lab-ship.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const base = JSON.parse(fs.readFileSync(path.join(ev, 'lab-spec.json'), 'utf8'))
const cur = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-c7.json'), 'utf8'))
const relay = base.variants.find((v) => v.id === 'cur-advanced').relayUser

const spec = {
  builtAt: new Date().toISOString(),
  solverSystem: base.solverSystem,
  judgeSystem: base.judgeSystem,
  tasks: base.tasks,
  variants: [
    { id: 'SHIP-advanced', group: '发布版（0.2.1 候选）', tier: 'advanced', system: cur.tiers.advanced.system, relayUser: relay },
    { id: 'SHIP-extreme', group: '发布版（0.2.1 候选）', tier: 'extreme', system: cur.tiers.extreme.system, relayUser: relay },
    { id: 'SHIP-basic', group: '发布版（0.2.1 候选）', tier: 'basic', system: cur.tiers.basic.system, relayUser: relay },
    { id: 'v011-advanced', group: '0.1.1 旧提示词（对照）', tier: 'advanced', system: JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-v011.json'), 'utf8')).tiers.advanced.system, relayUser: base.variants.find((v) => v.id === 'v011-advanced').relayUser },
    { id: 'cur-advanced', group: '0.1.9 当前提示词（对照）', tier: 'advanced', system: JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-cur.json'), 'utf8')).tiers.advanced.system, relayUser: relay },
  ],
}
const out = path.join(ev, 'lab-ship.json')
fs.writeFileSync(out, JSON.stringify(spec, null, 1), 'utf8')
console.log('WROTE ' + out)
for (const v of spec.variants) console.log('  ' + v.id.padEnd(15) + v.group.padEnd(24) + v.system.length + ' 字符')
