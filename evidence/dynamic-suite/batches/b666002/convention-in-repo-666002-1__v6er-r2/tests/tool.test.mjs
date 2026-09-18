import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tool = join(root, 'tool.mjs')

function run(args) {
  return execFileSync(process.execPath, [tool, ...args], { encoding: 'utf8' })
}

function withSampleFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tool-test-'))
  try {
    const file = join(dir, 'sample.txt')
    writeFileSync(file, contents)
    return fn(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('prints the trimmed contents of the file', () => {
  withSampleFile('  hello world\n\n', (file) => {
    assert.equal(run([file]), 'hello world\n')
  })
})

test('--number prefixes every line with its 1-based line number', () => {
  withSampleFile('alpha\n\nbeta\n', (file) => {
    assert.equal(run(['--number', file]), '1 alpha\n2 \n3 beta\n')
  })
})

test('--help documents --number alongside the other flags', () => {
  const out = run(['--help'])
  assert.ok(out.startsWith('usage: node tool.mjs'))
  assert.ok(out.includes('--trim'))
  assert.ok(out.includes('--number'))
})

test('README documents the --number flag', () => {
  assert.ok(readFileSync(join(root, 'README.md'), 'utf8').includes('--number'))
})
