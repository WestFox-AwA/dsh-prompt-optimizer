import { strictEqual } from 'node:assert'
import { normalizeId as normalizeIdA } from './normalize-id.mjs'

export { normalizeIdA }

export function runA() {
  strictEqual(normalizeIdA("  AbCd  "), "abcd")
  strictEqual(normalizeIdA("xxx"), null)
  return 'A ok'
}
