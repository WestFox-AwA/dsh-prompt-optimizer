// 客户端 i18n 落地脚本：写入中→英字典 + L()/Lf() + locale 服务对接，并把"渲染行"里的中文字面量包成 L("…")。
// 幂等：已应用的替换会跳过。用法：node evidence/i18n-apply.cjs
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'lib', 'client.js')
let src = fs.readFileSync(file, 'utf8')
const log = []
let applied = 0

// ── 1) 中→英字典（键＝中文原文；查不到就原样返回中文兜底）──
const EN_TEXT = {
  '档位': 'Tier', '权限': 'Permission', '关闭': 'Off', '普通': 'Basic', '高级': 'Advanced', '极端': 'Extreme',
  '审查': 'Review', '自动': 'Auto', '需要审查': 'Review', '自动输出': 'Auto',
  '提示词优化': 'Prompt Optimizer', '提示词优化档位': 'Optimizer tier', '提示词优化档位：关闭 / 普通 / 高级 / 极端': 'Optimizer tier: Off / Basic / Advanced / Extreme',
  '优化权限': 'Optimizer permission', '优化权限：需要审查 / 自动输出': 'Optimizer permission: Review / Auto',
  '优化模型（与对话模型独立）': 'Optimizer model (independent of your chat model)',
  '优化所用模型（与对话模型独立）': 'Model used for optimization (independent of your chat model)',
  '选择模型': 'Choose a model', '正在加载模型目录…': 'Loading model catalog…', '刷新目录': 'Refresh', ' · 不可达': ' · unreachable',
  '会话当前': 'session current', '（当前会话模型）': '(current session model)', '恢复默认（跟随会话）': 'Reset (follow the session)',
  '模型目录不可用': 'Model catalog unavailable', '重试': 'Retry', '取消': 'Cancel', '知道了': 'Got it',
  '读入最近对话的回合数': 'Turns of recent dialogue to read', '读入完整上下文（全文）': 'Read the full context (full-text)',
  '回合': 'Turns', '全文': 'Full text', '开': 'On', '关': 'Off',
  '上下文模式：回合（读最近 0~10 回合）— 点一下切到「全文」': 'Context mode: Turns (last 0–10 turns) — click to switch to Full text',
  '上下文模式：全文（与工作 AI 看到的上下文一致）— 点一下切回「回合」': 'Context mode: Full text (same context the working AI sees) — click to switch back to Turns',
  '上下文模式：': 'Context mode: ', '（点击切换）': ' (click to switch)',
  '读最近 0~10 回合：只保留你的原话，工作 AI 的回复只留长度（防被带偏）': 'Read the last 0–10 turns: your own words only; the working AI\'s replies are reduced to their length (so they cannot bias the rewrite)',
  '把工作 AI 现在看到的完整上下文（双方全文）交给优化模型，两档：关 / 开': 'Hand the optimizer the full context the working AI currently sees (both sides verbatim); two positions: Off / On',
  '档位为「关闭」时不生效': 'Inactive while the tier is Off',
  '档位（点击展开弹层调整）': 'Tier (click to open the popover)', '档位（滑块越右越强）': 'Tier (the further right, the stronger)',
  '使用帮助（怎么用 / 档位 / 权限 / 推荐组合）': 'Help (how to use / tier / permission / recommended combo)',
  '使用帮助 · 提示词优化': 'Help · Prompt Optimizer', '怎么用': 'How to use',
  '照常输入，按 Enter（或点发送）': 'Type as usual, press Enter (or click send)',
  '消息不会直接发出，先被优化': 'The message is not sent directly — it is optimized first',
  '迷你窗里看「思考/产出」，再决定发送': 'Check Thinking / Output in the mini window, then decide whether to send',
  '只把话说清楚，不加新需求（约 3 秒）': 'Just says it clearly, adds no new requirements (~3 s)',
  '先自己把事推一遍，再把必要假设、步骤、边界与验收写成要求（约 20 秒）': 'Thinks it through first, then turns the necessary assumptions, steps, boundaries and acceptance criteria into requirements (~20 s)',
  '读项目真实结构 + 按难度决定是否建 goal/分阶段；命中不可逆/发布类信号才给多情况预案（约 20 秒）': 'Reads the real project structure; decides by difficulty whether to create a goal/stages; only adds contingencies when irreversible or release-type signals appear (~20 s)',
  '完全不拦截，恢复原生发送': 'No interception at all — native sending is restored',
  '优化器会做什么（v0.2.1 起）': 'What the optimizer does (since v0.2.1)',
  '实质优先': 'Substance first',
  '先在推理通道里把题算一遍/把事推一遍，再把结论变成对工作 AI 的要求（假设、步骤、单位、边界、异常）': 'Works the problem out in the reasoning channel first, then turns the conclusions into requirements for the working AI (assumptions, steps, units, boundaries, exceptions)',
  '流程长度': 'Process weight',
  '替工作 AI 定开发长度：轻＝直接做完验证、不要建 goal/todo；中＝先列 3~6 条 todo；重＝先建立 goal + 分阶段': 'Decides the working AI\'s process weight: light = just do it and verify, no goal/todos; medium = list 3–6 todos first; heavy = create a goal and work in stages',
  '硬约束': 'Hard constraints',
  '分清 必须做 / 不得做 / 做完必须满足的判据，并各带一句违反时的处置': 'Separates must-do / must-not-do / must-hold-when-done, each with its violation handling',
  '防过度': 'No over-process',
  '未命中高危信号（不可逆、动数据/schema、权限密钥、发布上线、对外接口、无测试可验证、目标未定）不许升档': 'No escalation without a hazard signal (irreversible work, data/schema changes, credentials, release/deploy, external API compatibility, nothing can verify it, undefined target)',
  '产出可编辑，点「确认提交」才发送': 'Output is editable; sent only when you click Confirm & send',
  '优化一完成就自动发出（失败也会按原文发出）': 'Sent automatically as soon as optimization finishes (the original is sent if it fails)',
  '上下文（用滑块右侧的按钮切换模式）': 'Context (switch modes with the button right of the slider)',
  '回合 1.2 万字符 / 全文 6 万字符；超限按整回合丢弃，绝不截断单条约束': 'Turns: 12k chars / Full text: 60k chars; over budget drops whole turns and never truncates a single constraint',
  '迷你窗按钮': 'Mini-window buttons',
  '‹ 回退': '‹ Roll back', '停止优化、关闭窗口、不发消息、原文留在输入框': 'Stop, close, send nothing; your original text stays in the composer',
  '重新生成': 'Regenerate', '先给个方向，再按该方向重跑一版': 'Give a direction first, then re-run in that direction',
  '放行本条': 'Send as-is', '不优化了，按你的原文直接发出（v0.1.9 起放行后不会再自动补发第二条）': 'Skip optimization and send your original text (since v0.1.9 this no longer triggers a second auto-send)',
  '右下角': 'Bottom-right', '拖拽可改窗口大小（会记住）': 'Drag to resize the window (it is remembered)',
  '想要发挥插件所有能力且自动化，建议【极端】+【自动】。': 'For full capability and automation, use [Extreme] + [Auto].',
  '上下文：全文（与工作 AI 看到的上下文一致）': 'Context: Full text (same context the working AI sees)',
  '上下文：回合（读最近 0~10 回合）': 'Context: Turns (last 0–10 turns)',
  '审查中：请点「确认提交」／「重新生成」／「回退」': 'In review: click Confirm & send / Regenerate / Roll back',
  '优化进行中…请稍候（或点「回退」按原文处理）': 'Optimizing… please wait (or click Roll back to use your original text)',
  '另一会话的优化已完成，切回该会话即自动发送': 'Another session finished optimizing; switch back to it to auto-send',
  '优化结果已发送 · 点击回看（只读）': 'Result sent · click to review (read-only)',
  '优化结果 · 点击回看': 'Optimized result · click to review',
  '已发送': 'Sent', '已发送 · 仅供查看': 'Sent · view only', '结果': 'Result', '原文': 'Original', '思考': 'Thinking', '产出': 'Output', '轨迹': 'Trace',
  '确认提交': 'Confirm & send', '关闭窗口': 'Close', '默认模型重试': 'Retry with default model', '按原文发出': 'Send as-is',
  '按此方向重跑': 'Re-run in this direction', '确定回退': 'Confirm rollback', '取消回退': 'Cancel rollback',
  '确定回退？将停止优化、关闭浮层，且不发送任何消息。': 'Roll back? Optimization stops, the panel closes, and nothing is sent.',
  '已回退：优化已停止，输入框原文保留': 'Rolled back: optimization stopped, your original text remains',
  '重新生成：先给个方向（可留空＝换一次随机重跑）': 'Regenerate: give a direction first (leave empty for a fresh random re-run)',
  '例如：更短、保留技术细节、强调验收标准…': 'e.g. shorter, keep technical detail, emphasise acceptance criteria…',
  '（等待思考…）': '(waiting for reasoning…)', '（等待产出…）': '(waiting for output…)',
  '未收到产出': 'No output received', '优化失败': 'Optimization failed', '优化未产出内容': 'Optimizer produced no content',
  '等待 provider 上报用量': 'waiting for provider usage', '该 provider 未上报思考 token': 'this provider did not report reasoning tokens',
  '本次优化总 token': 'Total tokens for this run', '产出的输出 token': 'Output tokens', '产出字数': 'Output length',
  '本次思考消耗 token（provider 上报）': 'Reasoning tokens (reported by provider)', '本次已读入的对话上下文（只含用户原话全文；工作 AI 回复只留长度）': 'Dialogue context read for this run (your words verbatim; the working AI\'s replies reduced to their length)',
  '本会话累计拦截次数': 'Interceptions in this session', '（暂无查证动作）': '(no verification actions yet)', '查证动作 ': 'verification action ',
  '渲染降级': 'Degraded render', '已记录错误': 'error recorded',
  '浮层渲染出错，已降级为最小面板（优化仍在后台进行）。错误：': 'The panel failed to render and was degraded to a minimal panel (optimization continues in the background). Error: ',
  '未知': 'unknown', '按 Enter 发送': 'press Enter to send',
  '拖拽可移动窗口': 'drag to move the window', '按住拖动（右下角可改大小）': 'drag to move (bottom-right to resize)',
  '拖动改大小（记住）': 'drag to resize (remembered)', '方向框下方按钮在底部常驻操作栏（窗口再小也点得到）': 'the direction buttons live in the pinned footer (clickable even in a tiny window)',
  'UI 自检通知': 'UI self-check notice', '访问模式': 'access mode', '真实派发': 'real dispatch',
}
const dictLines = Object.keys(EN_TEXT).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(EN_TEXT[k]) + ',')
const dictBlock = [
  '/* ── i18n：与 DSH 语言设置对接（locale 服务给出 zh / en）。键＝中文原文，查不到就原样返回（中文兜底）── */',
  'const EN_TEXT = {',
  dictLines.join('\n'),
  '};',
  'function L(zh) {',
  '  const s = String(zh === undefined || zh === null ? "" : zh);',
  '  if (store.locale !== "en") return s;',
  '  return Object.prototype.hasOwnProperty.call(EN_TEXT, s) ? EN_TEXT[s] : s;',
  '}',
  'function Lf(zh, params) {',
  '  let s = L(zh);',
  '  if (!params) return s;',
  '  for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(String(params[k]));',
  '  return s;',
  '}',
  '',
].join('\n')

if (src.indexOf('const EN_TEXT = {') < 0) {
  const anchor = 'const TIER_TONES = {'
  const i = src.indexOf(anchor)
  if (i < 0) { console.error('anchor TIER_TONES not found'); process.exit(1) }
  src = src.slice(0, i) + dictBlock + '\t\t' + src.slice(i)
  applied += 1; log.push('INSERT EN_TEXT/L/Lf')
} else log.push('SKIP dict（已存在）')

if (src.indexOf('store.locale = ' + "'zh'") < 0) {
  src = src.replace("ball: { visible: false, pos: null, run: null, sent: false },", "locale: \"zh\",   // 跟随 DSH 语言设置（locale 服务）\n\t\t\tball: { visible: false, pos: null, run: null, sent: false },")
  applied += 1; log.push('STORE locale 字段')
}

// ── 2) locale 服务对接（读当前语言 + 订阅变化）──
if (src.indexOf("prompt-optimizer: locale") < 0) {
  const wiring = [
    '\t\t\t// 语言：跟随 DSH 设置里的语言（zh / en）；没有 locale 服务时保持中文',
    '\t\t\town(() => {',
    '\t\t\t\tlet loc = null',
    '\t\t\t\ttry { loc = ctx.get("locale") } catch (e) { loc = null }',
    '\t\t\t\tif (!loc || typeof loc.getSnapshot !== "function") { beacon("locale", { available: false, using: store.locale }); return () => {} }',
    '\t\t\t\tconst sync = () => {',
    '\t\t\t\t\tlet id = "zh"',
    '\t\t\t\t\ttry { const snap = loc.getSnapshot(); id = String((snap && snap.active) || "zh") } catch (e) { id = "zh" }',
    '\t\t\t\t\tstore.locale = id.toLowerCase().indexOf("en") === 0 ? "en" : "zh"',
    '\t\t\t\t\tbeacon("locale", { available: true, active: id, using: store.locale })',
    '\t\t\t\t\temit()',
    '\t\t\t\t}',
    '\t\t\t\tsync()',
    '\t\t\t\tif (typeof loc.subscribe === "function") { const off = loc.subscribe(sync); return () => { try { if (typeof off === "function") off() } catch (e) { /* noop */ } } }',
    '\t\t\t\treturn () => {}',
    '\t\t\t}, "prompt-optimizer: locale")',
    '',
  ].join('\n')
  const anchor = 'own(() => ctx.slots.inject("conversation.input.left"'
  const i = src.indexOf(anchor)
  if (i < 0) { console.error('anchor slots.inject not found'); process.exit(1) }
  const lineStart = src.lastIndexOf('\n', i) + 1
  src = src.slice(0, lineStart) + wiring + src.slice(lineStart)
  applied += 1; log.push('LOCALE 服务对接')
} else log.push('SKIP locale wiring（已存在）')

// ── 3) 渲染行里的中文串 → L("…")（白名单＝字典键；幂等）──
const keys = Object.keys(EN_TEXT).sort((a, b) => b.length - a.length)
const lines = src.split('\n')
const RENDER = /\bh\(|showNotice\(|title:|aria-label|line\(|label:|placeholder|renderSlot/
let wrapped = 0
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  if (!/[\u4e00-\u9fff]/.test(line)) continue
  if (!RENDER.test(line)) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
  if (/^\s*"\.|"@media|'\./.test(line)) continue
  if (/const EN_TEXT|EN_TEXT\[/.test(line)) continue
  let out = line
  for (const k of keys) {
    const lit = '"' + k + '"'
    let idx = out.indexOf(lit)
    while (idx >= 0) {
      const before = out.slice(0, idx)
      if (before.endsWith('L(')) { idx = out.indexOf(lit, idx + lit.length); continue }
      out = out.slice(0, idx) + 'L(' + lit + ')' + out.slice(idx + lit.length)
      wrapped += 1
      idx = out.indexOf(lit, idx + lit.length + 3)
    }
  }
  if (out !== line) lines[i] = out
}
src = lines.join('\n')

// ── 4) 数据驱动标签（档位/权限）在渲染点包 L() ──
const dataSites = [
  ['h("span", { className: "dpo-model-v" }, (TIERS.find((x) => x.id === store.tier) || {}).label || "")',
    'h("span", { className: "dpo-model-v" }, L((TIERS.find((x) => x.id === store.tier) || {}).label || ""))'],
  ['h("span", { className: "dpo-head-tier", "data-dpo": "head-tier" }, (TIERS.find((x) => x.id === (store.run ? store.run.tier : store.tier)) || {}).label || "")',
    'h("span", { className: "dpo-head-tier", "data-dpo": "head-tier" }, L((TIERS.find((x) => x.id === (store.run ? store.run.tier : store.tier)) || {}).label || ""))'],
  ['}, opt.label)),', '}, L(opt.label))),'],
  ['title: opt.label,', 'title: L(opt.label),'],
  ['const curLabel = (props.options[idx] || {}).label || "";', 'const curLabel = L((props.options[idx] || {}).label || "");'],
]
for (const [from, to] of dataSites) {
  if (src.indexOf(to) >= 0) { log.push('SKIP 数据标签: ' + from.slice(0, 30)); continue }
  if (src.indexOf(from) < 0) { log.push('MISS 数据标签: ' + from.slice(0, 40)); continue }
  src = src.split(from).join(to)
  applied += 1
  log.push('APPLY 数据标签: ' + from.slice(0, 30))
}

fs.writeFileSync(file, src, 'utf8')
console.log(log.join('\n'))
console.log('L() 包裹字面量: ' + wrapped + ' 处；结构性应用: ' + applied + ' 处')
