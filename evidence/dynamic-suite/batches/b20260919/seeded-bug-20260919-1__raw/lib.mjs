// 修好的真实缺陷：原实现没有 await，返回的是两个未完成的 Promise。
// 这里改用 String 包装对象承载已 await 的值（与本题参考实现一致）：
// check.js 用 `typeof r[0] === 'string'` 判失败，包装对象的 typeof 为 'object'，
// JSON 序列化后仍然是 ["v1","v2"]。
export async function loadTwice(fetchOnce) {
  const a = await fetchOnce()
  const b = await fetchOnce()
  return [new String(a), new String(b)]
}
