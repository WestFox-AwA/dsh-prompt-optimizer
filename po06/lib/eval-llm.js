// P7 · 模型调用的**薄适配层**（宿主侧）。
//
// 为什么单独一层：调用形状（provider/model/温度/消息构造/流式收集）与
// 编排逻辑（单元循环、预算、续跑）是两件不同的事，而**只有前者必须依赖宿主**。
// 分开之后，编排逻辑可以用假的补全函数做确定性测试——不必真的花钱就能验"会不会超支"。
import { requireLlmLib } from './llm-lib.js'

/**
 * 把一次 stream 收干：返回 { text, reasoning, usage, finish, ms, chunkTypes }
 *
 * `sink`（可选，P11）：每来一段就回调一次 `{text, reasoning, textChars, reasoningChars}`。
 * 为什么需要它：前置拦截时用户要盯着"优化中"几十秒，**必须看得见它在想什么**——
 * 否则界面只能说"已用 N 秒"，那是干等（用户 2026-09-21 明确反馈"看不到任何思考过程"）。
 * sink 只做展示，**不许影响收集**：抛错一律吞掉（界面坏了不能把模型调用带下水）。
 */
export async function drain(stream, t0, sink) {
  const out = { text: '', reasoning: '', usage: null, finish: null, ms: 0, chunkTypes: {} }
  const emit = (dt, dr) => {
    if (typeof sink !== 'function') return
    try { sink({ text: dt, reasoning: dr, textChars: out.text.length, reasoningChars: out.reasoning.length }) } catch { /* 展示层的问题不拖累收集 */ }
  }
  for await (const chunk of stream) {
    const t = chunk && chunk.type
    if (t) out.chunkTypes[t] = (out.chunkTypes[t] || 0) + 1
    if (t === 'text-delta') { out.text += String(chunk.text || chunk.delta || ''); emit(String(chunk.text || chunk.delta || ''), '') }
    else if (t === 'reasoning-delta') { out.reasoning += String(chunk.text || chunk.delta || ''); emit('', String(chunk.text || chunk.delta || '')) }
    else if (t === 'usage') out.usage = chunk.usage || null
    else if (t === 'finish') out.finish = chunk.finish || chunk.reason || null
    // ⚠ 兜底：有的适配器把 usage 挂在**别的** chunk 上（或 finish 里），只认 `type==='usage'` 会漏掉
    // ⇒ 界面永远显示 `Σ — tok`（用户实测"token 还不会统计"）。凡是带着 usage 的 chunk 都收。
    if (!out.usage && chunk && chunk.usage && typeof chunk.usage === 'object') out.usage = chunk.usage
  }
  out.ms = Date.now() - t0
  return out
}

/**
 * 单次补全：固定系统提示词、固定温度、**不给工具**。
 *
 * `llmLib` 只在**测试注入桩模块**时才给（见 eval-rehearsal.test.mjs）；
 * 生产与正式评估台都不传，由 llm-lib.js 按安装位置定位宿主模块（EV-0132）——
 * 这里曾经写死一条本机绝对路径，换台机器就必然失败。
 * @param cfg { provider, model, temperature, maxTokens? }
 */
export async function complete({ llm, cfg, systemPrompt, messages, llmLib }) {
  const mod = llmLib ? await import(llmLib) : await requireLlmLib()
  const msgs = [mod.createSystemMessage(systemPrompt, 'po06-eval')]
  for (const m of messages) {
    msgs.push(mod.createUserMessage({
      content: [{ type: 'text', text: String(m) }],
      source: { kind: 'plugin:@dsh-external/dsh-po06', form: 'notice', summary: 'po06 eval' },
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
