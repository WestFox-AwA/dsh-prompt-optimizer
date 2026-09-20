// P7 · 模型调用的**薄适配层**（宿主侧）。
//
// 为什么单独一层：调用形状（provider/model/温度/消息构造/流式收集）与
// 编排逻辑（单元循环、预算、续跑）是两件不同的事，而**只有前者必须依赖宿主**。
// 分开之后，编排逻辑可以用假的补全函数做确定性测试——不必真的花钱就能验"会不会超支"。

/** 把一次 stream 收干：返回 { text, reasoning, usage, finish, ms, chunkTypes } */
export async function drain(stream, t0) {
  const out = { text: '', reasoning: '', usage: null, finish: null, ms: 0, chunkTypes: {} }
  for await (const chunk of stream) {
    const t = chunk && chunk.type
    if (t) out.chunkTypes[t] = (out.chunkTypes[t] || 0) + 1
    if (t === 'text-delta') out.text += String(chunk.text || chunk.delta || '')
    else if (t === 'reasoning-delta') out.reasoning += String(chunk.text || chunk.delta || '')
    else if (t === 'usage') out.usage = chunk.usage || null
    else if (t === 'finish') out.finish = chunk.finish || chunk.reason || null
  }
  out.ms = Date.now() - t0
  return out
}

/**
 * 单次补全：固定系统提示词、固定温度、**不给工具**。
 * @param cfg { provider, model, temperature, maxTokens? }
 */
export async function complete({ llm, cfg, systemPrompt, messages, llmLib }) {
  const mod = await import(llmLib)
  const msgs = [mod.createSystemMessage(systemPrompt, 'po06-eval')]
  for (const m of messages) {
    msgs.push(mod.createUserMessage({
      content: [{ type: 'text', text: String(m) }],
      source: { kind: 'plugin', plugin: '@dsh-external/dsh-po06', form: 'notice', summary: 'po06 eval' },
    }))
  }
  const t0 = Date.now()
  const stream = llm.stream({
    provider: cfg.provider, model: cfg.model,
    ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
    messages: msgs,
  })
  return await drain(stream, t0)
}
