export function normalizeCode(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase()
  if (t.length < 2 || t.length > 52) return null
  return t
}
