export async function loadTwice(fetchOnce) {
  const a = fetchOnce()
  const b = fetchOnce()
  return await Promise.all([a, b])
}
