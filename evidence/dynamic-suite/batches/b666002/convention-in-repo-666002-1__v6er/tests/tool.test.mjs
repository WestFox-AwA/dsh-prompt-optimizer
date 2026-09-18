import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const run = (...args) => execFileSync('node', ['tool.mjs', ...args], { encoding: 'utf8' })

test('prints the file contents', () => {
  assert.equal(run('input.txt').trimEnd(), 'hello world')
})

test('--help prints the usage line', () => {
  assert.match(run('--help'), /usage: node tool\.mjs/)
})

test('--number prefixes each line with its line number', () => {
  assert.equal(run('--number', 'input.txt').trimEnd(), '1\thello world')
})
