import { assert } from 'node:assert'
import { normalizeCode } from './normalize.mjs'

export function normalizeCodeA(v) {
  return normalizeCode(v)
}

export function runA() {
  assert.strictEqual(normalizeCodeA('  AbC '), 'abc')
  assert.strictEqual(normalizeCodeA('x'), null)
  return 'A ok'
}
