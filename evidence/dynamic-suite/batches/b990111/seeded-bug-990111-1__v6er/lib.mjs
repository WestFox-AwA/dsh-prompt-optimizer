export async function loadTwice(fetchOnce) {
  const a = await fetchOnce()
  const b = await fetchOnce()
  return [a, b]
}
