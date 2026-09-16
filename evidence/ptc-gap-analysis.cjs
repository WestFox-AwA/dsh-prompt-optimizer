// 0.1.1 vs 0.3.8 结构差距分析（面向 PTC 消费者：无 workflow 工具、用一个程序组合多步、轮次昂贵）。
// 全部为可复核的文本统计，不调用模型。用法：node evidence/ptc-gap-analysis.cjs
const fs = require('fs')
const path = require('path')
const ev = __dirname
const A = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-v011.json'), 'utf8'))
const B = JSON.parse(fs.readFileSync(path.join(ev, 'prompt-snapshot-v038.json'), 'utf8'))

// 指令分类（面向 PTC 的"有帮助 / 有伤害"两类）
const CATS = {
  '身份与角色（有益）': /你是|身份|传话|转达|不要回应|不替用户/,
  '交付形态（有益）': /命令|输出|正文|直接发|写给工作 AI|可执行/,
  '事实纪律（有益）': /不得编造|先读|查证|没见过|通常|假设/,
  '语言与风格（中性）': /语言|中文|英文|口吻|元话语|标题|语气/,
  '补全必要信息（有益）': /补全|补上|最低交付|验收标准|含糊|收敛/,
  '硬约束·三分类（轻度有益）': /必须做|不得做|判据|可判定/,
  '流程编排·分阶段/todo/goal（PTC 有害）': /阶段|分阶段|todo|goal|逐步|每步|每阶段/,
  '流程闸门·切片/停手/不做项（PTC 有害）': /切片|闸门|停手|不做项|先交|逐层/,
  '自检证据·清单/证据形式（PTC 有争议）': /自检|证据|贴出|输出原样|对账|明细|反向面|不许声称/,
  '失效模式清单·逐域（PTC 有害）': /失效模式|法线|碰撞|幂等|死锁|可见面|键位|预算/,
}
const IMPACT = {
  '身份与角色（有益）': '让下游知道"这是命令不是说给你听"，减少跑偏 —— PTC 下同样需要',
  '交付形态（有益）': '决定下游是"读一段命令就写程序"还是"读一堆要求再猜结构" —— PTC 最看重这一条',
  '事实纪律（有益）': '禁止编造路径/接口；PTC 程序一旦引用不存在的 API 会整轮报废，纪律价值更高',
  '语言与风格（中性）': '与能力无关，保持即可',
  '补全必要信息（有益）': '把用户没说的必要约束一次写清，减少 PTC 的往返轮次',
  '硬约束·三分类（轻度有益）': '少量可判定硬约束可减少程序改错；但数量一多会挤占程序设计空间',
  '流程编排·分阶段/todo/goal（PTC 有害）': 'PTC 只有一个程序、没有逐步工具；要求分阶段/todo 会诱导"计划式输出"而非"程序式完成"，且迫使多轮',
  '流程闸门·切片/停手/不做项（PTC 有害）': '切片/逐层验收在 PTC 下等于强制多轮往返（每轮都要重新起程序），直接拉长耗时',
  '自检证据·清单/证据形式（PTC 有争议）': '有"可自动验收"的好处；但要求贴输出/逐项明细在 PTC 里常变成散文清单，占满上下文',
  '失效模式清单·逐域（PTC 有害）': '十几条领域检查会挤掉模型自己的判断（PTC 本就靠一次把事想全），降低随机应变',
}
function stat(t) {
  const lines = t.split('\n')
  const heads = lines.filter((l) => /^#{1,6}\s|^\*\*|^[一二三四五六七八九十]+、|^第[0-9一二三四五六七八九十]+[阶段步]/.test(l.trim()))
  const out = { chars: t.length, lines: lines.length, headings: heads.length, sentences: (t.match(/[。；！？]/g) || []).length, cats: {} }
  for (const k of Object.keys(CATS)) out.cats[k] = (t.match(new RegExp(CATS[k].source, 'g')) || []).length
  const hard = (t.match(/必须|不得|严禁|不许|禁止|一律|绝不/g) || []).length
  out.hard = hard
  out.hardPer1k = Math.round((hard / t.length) * 10000) / 10
  out.headingList = heads.slice(0, 14).map((s) => s.trim().slice(0, 34))
  return out
}
const rows = []
for (const tier of ['advanced', 'extreme']) {
  const a = stat(A.tiers[tier].system), b = stat(B.tiers[tier].system)
  rows.push({ tier, v011: a, v038: b })
}
console.log('=== 规模与形态（advanced / extreme）===')
for (const r of rows) {
  console.log('  ' + r.tier.padEnd(9) + '0.1.1: ' + String(r.v011.chars).padStart(5) + ' 字 / ' + String(r.v011.headings).padStart(2) + ' 小标题 / 硬约束 ' + String(r.v011.hard).padStart(3) + '（' + r.v011.hardPer1k + '/千字）')
  console.log('  ' + ''.padEnd(9) + '0.3.8: ' + String(r.v038.chars).padStart(5) + ' 字 / ' + String(r.v038.headings).padStart(2) + ' 小标题 / 硬约束 ' + String(r.v038.hard).padStart(3) + '（' + r.v038.hardPer1k + '/千字）')
}
const e = rows.find((r) => r.tier === 'extreme')
console.log('')
console.log('=== 逐类指令计数（extreme）===')
console.log('  类别'.padEnd(40) + '0.1.1   0.3.8   面向 PTC 的影响')
for (const k of Object.keys(CATS)) {
  console.log('  ' + k.padEnd(38) + String(e.v011.cats[k]).padStart(5) + String(e.v038.cats[k]).padStart(8) + '   ' + IMPACT[k])
}
console.log('')
console.log('=== 0.3.8 extreme 的小标题（前 14）===')
e.v038.headingList.forEach((h) => console.log('   · ' + h))
console.log('=== 0.1.1 extreme 的小标题（前 14）===')
e.v011.headingList.forEach((h) => console.log('   · ' + h))
fs.writeFileSync(path.join(ev, 'ptc-gap-analysis.json'), JSON.stringify({ at: new Date().toISOString(), impact: IMPACT, rows }, null, 1), 'utf8')
console.log('')
console.log('WROTE evidence/ptc-gap-analysis.json')
