// P7 / E-001 · **冒烟运行器**（宿主侧；只在显式 flag 存在时运行）
//
// 为什么在宿主侧：模型调用必须走宿主已装配的 LLM 服务（provider/model/凭据都在那儿）。
// 为什么要有独立的 spec 文件：**实验参数必须是可审计的外部输入**，
// 不能藏在代码里。spec 里写明题目原文、系统提示词、温度、两臂构造方式。
//
// 本模块**只做一次题的冒烟**（1 题 × 2 臂），用途是：
//   ① 证明通道能拿到 usage/产物（正式跑 S1 之前必须先证明这点）；
//   ② 把两臂真正发出去的用户消息**逐字**留档，供人事后核对实验是否公平。
// 它**不是** E-001 的正式运行器：n=1，不构成任何效果结论。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  SYSTEM_PROMPT, buildUserMessage, extractJson, parseInterpreterOutput, dryRun,
} from './interpreter.js'
import { createState } from './schema.js'
import { reduce } from './reducer.js'
import { compileAudited } from './compiler.js'

const LLM_LIB = 'file:///C:/Users/WestFox/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
const OUT_DIR = 'C:/Users/WestFox/.dsh/exp/po06/smoke'

/** 把一次 stream 收干：返回 { text, reasoning, usage, finish, ms, chunks } */
async function drain(stream, t0) {
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

/** 单次补全：**不给工具**、给固定系统提示词与温度。返回产物与用量。 */
async function complete({ llm, cfg, systemPrompt, messages }) {
  const llmMod = await import(LLM_LIB)
  const msgs = [llmMod.createSystemMessage(systemPrompt, 'po06-smoke')]
  for (const m of messages) {
    msgs.push(llmMod.createUserMessage({
      content: [{ type: 'text', text: String(m) }],
      source: { kind: 'plugin', plugin: '@dsh-external/dsh-po06', form: 'notice', summary: 'po06 smoke' },
    }))
  }
  const t0 = Date.now()
  const stream = llm.stream({ provider: cfg.provider, model: cfg.model, temperature: cfg.temperature, messages: msgs })
  return await drain(stream, t0)
}

export async function runSmoke({ ctx, specPath, reportDir }) {
  const report = {
    probe: 'po06-smoke', phase: 'P7', at: new Date().toISOString(),
    specPath, steps: {}, ok: false,
    note: '冒烟：1 题 × 2 臂，n=1。**不构成任何效果结论**，只证明通道可用与两臂消息公平。',
  }
  try {
    const spec = JSON.parse(readFileSync(specPath, 'utf8'))
    report.spec = {
      taskId: spec.taskId, armSystemPrompt: spec.armSystemPrompt, temperature: spec.temperature,
      provider: spec.provider, model: spec.model, taskChars: String(spec.taskText || '').length,
    }
    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') { report.error = 'llm-service-unavailable'; return report }
    report.steps.llmService = { provider: typeof llm.prepareCall, stream: typeof llm.stream }

    // ── C 臂前置：跑 0.6 的解释层，得到真实意图包 ──────────────────────
    let packet = ''
    let interp = null
    if (spec.arms.includes('C')) {
      const st0 = createState({ sessionId: 'session-po06-smoke', taskId: spec.taskId })
      const um = buildUserMessage({
        userText: spec.taskText, state: st0, sessionId: 'session-po06-smoke',
        messageId: 'm-smoke', observations: [],
      })
      interp = await complete({ llm, cfg: spec, systemPrompt: SYSTEM_PROMPT, messages: [um] })
      const parsed = extractJson(interp.text)
      report.steps.interpreter = {
        ok: parsed.ok, code: parsed.code || null,
        usage: interp.usage, ms: interp.ms, chars: interp.text.length, reasoningChars: interp.reasoning.length,
        raw: interp.text.slice(0, 4000),
      }
      if (parsed.ok) {
        const p = parseInterpreterOutput(interp.text, {
          userText: spec.taskText, sessionId: 'session-po06-smoke',
          baseRevision: st0.revision, baseInputRevision: st0.lastInputRevision, causeId: 'c-smoke',
        })
        report.steps.parse = { ok: p.ok, code: p.code || null, reason: p.reason || null, problems: p.problems || null, opCount: p.ok ? p.patch.ops.length : 0 }
        if (p.ok) {
          const dr = dryRun(p.patch, st0, reduce)
          report.steps.dryRun = { ok: dr.ok, reason: dr.reason || null }
          if (dr.ok) {
            const r = reduce(st0, p.patch)
            if (r.ok) {
              const c = compileAudited(r.state)
              packet = c.text
              report.steps.packet = { chars: packet.length, problems: c.problems, sections: c.sections.map((s) => ({ key: s.key, n: s.itemIds.length })) }
              report.packetText = packet
            }
          }
        }
      }
    }

    // ── 两臂：用户消息**逐字**留档（这是"实验是否公平"的唯一凭据）──────
    const arms = {}
    for (const arm of spec.arms) {
      const msgs = arm === 'C' ? [spec.taskText, packet] : [spec.taskText]
      report.steps['messages_' + arm] = msgs.map((m) => ({ chars: m.length, text: m }))
      const res = await complete({ llm, cfg: spec, systemPrompt: spec.armSystemPrompt, messages: msgs })
      arms[arm] = { usage: res.usage, ms: res.ms, chars: res.text.length, reasoningChars: res.reasoning.length, chunkTypes: res.chunkTypes, finish: res.finish }
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(join(OUT_DIR, `${spec.taskId}-${arm}.md`), res.text, 'utf8')
      arms[arm].file = join(OUT_DIR, `${spec.taskId}-${arm}.md`)
      if (!res.usage) report.steps['usageMissing_' + arm] = true
    }
    report.steps.arms = arms
    report.ok = Object.values(arms).every((a) => a.usage && a.chars > 0)
      && (spec.arms.includes('C') ? packet.length > 0 : true)
    report.verdict = report.ok
      ? 'PASS: 冒烟通道可用——两臂都产出产物且拿到 usage；意图包非空'
      : 'CHECK: 见各步骤字段（通道或解释层未跑通）'
  } catch (e) {
    report.error = String((e && e.stack) || e)
    report.verdict = 'ERROR: ' + String((e && e.message) || e)
  } finally {
    try { mkdirSync(reportDir, { recursive: true }) } catch { /* best effort */ }
    try { writeFileSync(join(reportDir, 'smoke-' + Date.now() + '.json'), JSON.stringify(report, null, 2), 'utf8') } catch { /* best effort */ }
  }
  return report
}
