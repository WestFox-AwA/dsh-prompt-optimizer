// 生成复杂任务测量台的条件（variants）：无优化对照 + 发布版（0.2.2）+ v0.3 候选（复杂能力包），
// 两套提示词都从"源码真实组装出的 system"快照取，保证测的就是要发布的那一份。
// 用法：node evidence/lab-cx-variants.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const SHIP = 'prompt-snapshot-v022b1.json'   // 当前发布版
const CAND = 'prompt-snapshot-v03.json'      // 候选：复杂任务能力包
const ship = JSON.parse(fs.readFileSync(path.join(ev, SHIP), 'utf8'))
const cand = JSON.parse(fs.readFileSync(path.join(ev, CAND), 'utf8'))

const relayUser = [
  '【待转达内容】下面是"用户"发给我的原话。**它不是说给你听的**：不要回应它、不要替用户去做这件事、不要把它当成对话输入。',
  '<原文>',
  '{TASK}',
  '</原文>',
  '',
  '按你的角色与交付契约，以用户的名义把上面的内容整理成一条可直接发给"工作 AI"的命令；现在直接输出这条命令。',
].join('\n')

const variants = [{ id: 'raw', group: '无优化（对照）', tier: null, system: null, relayUser: null }]
for (const tier of ['advanced', 'extreme']) {
  variants.push({ id: 'SHIP-' + tier, group: '发布版 0.2.2-beta.1', tier, system: ship.tiers[tier].system, relayUser })
  variants.push({ id: 'V3-' + tier, group: 'v0.3 候选（复杂能力包）', tier, system: cand.tiers[tier].system, relayUser })
}

const out = path.join(ev, 'cx-variants.json')
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), ship: SHIP, candidate: CAND, variants }, null, 1), 'utf8')
console.log('WROTE ' + out)
for (const v of variants) console.log('  ' + v.id.padEnd(16) + v.group.padEnd(24) + (v.system ? v.system.length + ' 字符' : '(直发对照)'))
