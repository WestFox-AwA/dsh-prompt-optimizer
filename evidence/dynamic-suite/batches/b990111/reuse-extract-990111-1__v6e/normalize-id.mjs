export function normalizeId(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase()
  if (t.length < 4 || t.length > 43) return null
  return t
}
