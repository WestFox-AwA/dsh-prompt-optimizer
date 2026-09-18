import { execFileSync } from 'node:child_process'
import { strictEqual } from 'node:assert'
const out = execFileSync('node', ['app.mjs'], { encoding: 'utf8' })
strictEqual(out.trim().endsWith('7070'), true, '实际输出：' + out.trim())
console.log('ok')
