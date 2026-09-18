import { strictEqual } from 'node:assert'
import { normalizeId } from './normalize.mjs'

export function normalizeIdA(v) {
  return normalizeId(v)
}

export function runA() {
  strictEqual(normalizeIdA("  AbCd  "), "abcd")
  strictEqual(normalizeIdA("xxx"), null)
  return 'A ok'
}
