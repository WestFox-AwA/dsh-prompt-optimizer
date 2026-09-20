// 生成冒烟用的 spec 文件（**从封存的留出集自动取题**，避免手抄出错）
//
//   node po06/scripts/make-smoke-spec.mjs --task H-12 [--out <path>]
//
// spec 是**实验参数的唯一来源**：题目原文、两臂系统提示词、温度、provider/model。
// 把它做成外部文件而不是埋在代码里，是为了让"这次到底发了什么"可复核。
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHoldout, HOLDOUT_SEAL } from '../lib/eval-plan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const taskId = opt('task', 'H-12')
const out = opt('out', 'C:/Users/WestFox/.dsh/exp/po06/smoke-spec.json')

const tasks = parseHoldout(readFileSync(join(ROOT, 'eval', HOLDOUT_SEAL.file), 'utf8'))
const task = tasks.find((t) => t.id === taskId)
if (!task) { console.error('no such task: ' + taskId); process.exit(2) }

// **系统提示词必须对"该不该发问"保持中立**。
// 若写成"只输出代码/不要解释"，两臂都会被压成"直接做"，而 H-12 的判据恰恰是
// "该问哪些信息上色、不该问用哪个库"——那样冒烟就什么也测不到。
const NEUTRAL_SYSTEM = '你是一名资深工程师，正在协助用户完成他的请求。'

const spec = {
  _note: 'P7 冒烟 spec。参数在此显式化，便于事后核对"这次到底发了什么"。',
  taskId: task.id,
  taskTitle: task.title,
  taskText: task.body,
  holdoutSha256: HOLDOUT_SEAL.sha256,
  armSystemPrompt: NEUTRAL_SYSTEM,
  temperature: 0.3,
  provider: 'deepseek-official',
  model: 'deepseek-v4.1-flash-expires-on-0910',
  arms: ['A', 'C'],
  armDefinition: {
    A: '只发原话（1 条 user 消息）',
    C: '原话 + 0.6 编译出的意图包（第 2 条 user 消息）—— 与 D-01 的 C 臂口径一致',
  },
  scope: '冒烟：n=1，仅证明通道可用与两臂消息公平，**不构成效果结论**',
}
writeFileSync(out, JSON.stringify(spec, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({
  out, taskId: spec.taskId, taskChars: spec.taskText.length,
  systemPrompt: spec.armSystemPrompt, temperature: spec.temperature,
  provider: spec.provider, model: spec.model, arms: spec.arms,
  holdoutSha256: spec.holdoutSha256,
}, null, 2))
