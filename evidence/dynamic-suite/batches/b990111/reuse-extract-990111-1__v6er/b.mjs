import { strictEqual } from 'node:assert'
import { normalizeId as normalizeIdB } from './normalize-id.mjs'

export { normalizeIdB }

export function runB() {
  strictEqual(normalizeIdB("  Qqee "), "qqee")
  strictEqual(normalizeIdB("xxx"), null)
  return 'B ok'
}
