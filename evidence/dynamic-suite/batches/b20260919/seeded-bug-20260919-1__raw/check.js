import { loadTwice } from './lib.mjs'
let calls = 0
const loadTwiceAsync = async () => { calls += 1; return 'v' + calls }
const r = await loadTwice(loadTwiceAsync)
if (!Array.isArray(r) || typeof r[0] === 'string' || r[0] !== 'v1' || r[1] !== 'v2') { console.error('loadTwice 返回 ' + JSON.stringify(r) + '，应为 ["v1","v2"]'); process.exit(1) }
console.log('ok')
