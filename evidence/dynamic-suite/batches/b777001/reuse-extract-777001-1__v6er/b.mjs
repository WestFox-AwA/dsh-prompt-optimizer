import { strictEqual } from 'node:assert'
import { normalizeCode } from './normalize.mjs'

export function normalizeCodeB(v) {
  return normalizeCode(v)
}

export function runB() {
  strictEqual(normalizeCodeB('  Qq '), 'qq')
  strictEqual(normalizeCodeB(''), null)
  return 'B ok'
}
