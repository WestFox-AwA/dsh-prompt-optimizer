import { strictEqual } from 'node:assert'
import { normalizeCode } from './normalize.mjs'

export function normalizeCodeA(v) {
  return normalizeCode(v)
}

export function runA() {
  strictEqual(normalizeCodeA('  AbC '), 'abc')
  strictEqual(normalizeCodeA('x'), null)
  return 'A ok'
}
