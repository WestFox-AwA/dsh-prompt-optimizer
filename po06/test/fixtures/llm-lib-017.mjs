// 测试夹具：**假的宿主 llm 模块**（形状与 `@deepseek-ai/dsh-llm` 0.1.7 的导出对齐）。
//
// 为什么需要它（2026-09-24 实测）：工具结果的**消息形状**要由宿主模块决定
// （`createToolResultMessage` ⇒ `role:'tool'` 一等消息）。测试环境里解析不到真实的宿主安装树，
// 于是 `loadLlmLib()` 失败 ⇒ 循环不造结果消息、自然收敛 ⇒ 用例分不清
// "形状检测坏了" 和 "模块没装"。给一个**形状正确的最小夹具**，被测的就是真实的检测逻辑。
//
// 用法：用例里 `process.env.DSH_PO06_LLM_LIB = <本文件路径>`（在调用之前设）。
let n = 0
const nextId = () => 'fixture-' + (++n)
const freeze = (m) => Object.freeze(m)

export function createUserMessage(input) {
  return freeze({ id: nextId(), role: 'user', content: input.content || [], ...(input.source ? { source: input.source } : {}) })
}

export function createSystemMessage(text) {
  return freeze({ id: nextId(), role: 'system', content: text ? [{ type: 'text', text }] : [], source: { kind: 'system-prompt' } })
}

export function createAssistantMessage(input) {
  return freeze({ id: nextId(), role: 'assistant', content: input.content || [], source: { kind: 'model', ...(input.source || {}) } })
}

/** 0.1.7 的形状：工具结果是一等 `role:'tool'` 消息（内容块**直接**是 content，不再包一层）。 */
export function createToolResultMessage(input) {
  return freeze({
    id: nextId(),
    role: 'tool',
    toolCallId: input.callId,
    content: input.content || [],
    source: { kind: 'tool', callId: input.callId },
    isError: input.isError === true,
  })
}
