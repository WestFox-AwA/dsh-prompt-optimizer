// dsh-prompt-optimizer 0.6 · 旧插件**运行时**探测
//
// 为什么不用静态探测：静态探测（读 profile 清单 / 看模块目录）会把"装了但被禁用"判成在装。
// 而旧插件在装配时一定会注册一个名为 `prompt-optimizer:capability` 的动态上下文
// （P1 实测：EV-0009/EV-0015 的真实装配清单里就有它）。
// **直接查装配结果**得到的是运行时真相，不需要猜。
//
// 本模块只依赖传入的 `systemPrompt`，因此**可离线测试**。

export const OLD_CONTEXT_NAME = 'prompt-optimizer:capability'

/**
 * 探测旧插件是否仍在运行时装配。
 * @param opts {
 *   systemPrompt,  宿主的 systemPrompt 服务（需有 assemble）
 *   agent,         用于取作用域的 live agent（装配是 per-agent 求值的，见 EV-0016）
 *   oldContextName 可选覆盖（测试用）
 * }
 * @returns {{active:boolean, confidence:'runtime'|'unknown', evidence:string[], reason:string|null}}
 */
export async function detectOldPluginRuntime({ systemPrompt, agent, oldContextName }) {
  const name = oldContextName || OLD_CONTEXT_NAME
  if (!systemPrompt || typeof systemPrompt.assemble !== 'function') {
    return { active: false, confidence: 'unknown', evidence: [], reason: 'no-systemPrompt-service' }
  }
  if (!agent) {
    // 没有 agent 就拿不到 per-agent 作用域；**不猜**，报告未知
    return { active: false, confidence: 'unknown', evidence: [], reason: 'no-agent-scope' }
  }
  let asm
  try {
    asm = await systemPrompt.assemble({ agent, scope: agent })
  } catch (e) {
    return { active: false, confidence: 'unknown', evidence: [], reason: 'assemble-failed:' + String((e && e.message) || e) }
  }
  const contexts = (asm && Array.isArray(asm.contexts)) ? asm.contexts : []
  const hit = contexts.find((c) => c && c.name === name)
  if (hit) {
    return {
      active: true,
      confidence: 'runtime',
      evidence: ['装配结果里存在动态上下文 ' + name + '（' + String(hit.text || '').length + ' 字符）'],
      reason: null,
    }
  }
  return {
    active: false,
    confidence: 'runtime',
    evidence: ['装配结果里没有 ' + name + '（共 ' + contexts.length + ' 个上下文贡献者）'],
    reason: null,
  }
}

/**
 * 把运行时探测与静态探测合并成一个结论。
 * **任一来源命中即判"可能仍在装配"**——保守方向（误报可接受，漏报不可接受）。
 */
export function mergeOldPluginSignals(runtime, staticResult) {
  const evidence = []
  let active = false
  if (runtime && runtime.active) { active = true; evidence.push(...(runtime.evidence || [])) }
  if (staticResult && staticResult.active) { active = true; evidence.push(...(staticResult.evidence || [])) }
  const confidence = runtime && runtime.confidence === 'runtime'
    ? 'runtime'
    : (staticResult ? 'static' : 'unknown')
  if (!active && runtime && runtime.reason) evidence.push('运行时探测未得出结论：' + runtime.reason)
  return {
    active,
    confidence,
    evidence,
    caveat: active
      ? '判定为"可能仍在装配"。方向保守：宁可挡住新版，也不冒双重拦截的风险。'
      : (confidence === 'runtime'
        ? '运行时探测未发现旧插件；静态探测也未命中。'
        : '探测证据不完整（confidence=' + confidence + '），若要开启 0.6 请人工确认旧版已卸载。'),
  }
}
