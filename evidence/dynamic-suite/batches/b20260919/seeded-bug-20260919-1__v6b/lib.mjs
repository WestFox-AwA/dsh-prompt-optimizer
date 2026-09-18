export async function loadTwice(fetchOnce) {
  const a = await fetchOnce()
  const b = await fetchOnce()
  return [new String(a), new String(b)]
}
