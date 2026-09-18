import { assert } from 'node:assert'
import { normalizeCode } from './normalize.mjs'

export function normalizeCodeB(v) {
  return normalizeCode(v)
}

export function runB() {
  assert.strictEqual(normalizeCodeB('  Qq '), 'qq')
  assert.strictEqual(normalizeCodeB(''), null)
  return 'B ok'
}
