import { test } from 'node:test'
import { strictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'

test('default prints file', () => {
  const out = execFileSync('node', ['tool.mjs', 'input.txt'], { encoding: 'utf8' })
  strictEqual(out.trim(), 'hello world')
})
