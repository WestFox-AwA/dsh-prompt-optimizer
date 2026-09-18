import { strictEqual } from 'node:assert'
import { normalizeId } from './normalize-id.mjs'

export function normalizeIdB(v) {
  return normalizeId(v)
}

export function runB() {
  strictEqual(normalizeIdB("  Qqee "), "qqee")
  strictEqual(normalizeIdB("xxx"), null)
  return 'B ok'
}
