// 指纹检查：node evidence/fp.cjs <生成命令文件>
const fs = require('fs')
const t = fs.readFileSync(process.argv[2], 'utf8')
const old = ['流程长度', '切片闸门', '不得降级清单', '本轮不做项', '停手条件', '证据形式', '阶段 0']
const neu = ['交付形态', 'PTC', '≤3', '机器判定']
console.log('chars=' + t.length)
console.log('--- head ---')
console.log(t.slice(0, 300).replace(/\n/g, ' ⏎ '))
console.log('--- 0.3.x 特征 ---')
for (const k of old) { const c = t.split(k).length - 1; if (c) console.log('  ' + k + ' = ' + c) }
console.log('--- 0.1.1+PTC 特征 ---')
for (const k of neu) { const c = t.split(k).length - 1; if (c) console.log('  ' + k + ' = ' + c) }
