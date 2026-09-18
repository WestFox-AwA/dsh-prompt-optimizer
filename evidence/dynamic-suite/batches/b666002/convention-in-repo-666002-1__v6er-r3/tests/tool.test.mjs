import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const run = (args) => execFileSync(process.execPath, ['tool.mjs', ...args], { encoding: 'utf8' })

test('prints input trimmed', () => {
  const out = run(['input.txt'])
  assert.equal(out.trim(), 'hello world')
})

test('--number prefixes the first line with 1', () => {
  const out = run(['--number', 'input.txt'])
  assert.equal(out.split('\n')[0], '1\thello world')
})
