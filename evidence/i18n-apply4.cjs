// i18n 第四轮：把"用户可见但未被 L() 包裹"的文案补上（浮层状态行/按钮、滑块提示、通知、错误信息、trace 行）。
// 行号索引 + 行内精确子串替换（不改行数）；同时向 EN_TEXT 注入英文条目。
// 用法：node evidence/i18n-apply4.cjs
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'lib', 'client.js')
const lines = fs.readFileSync(file, 'utf8').split('\n')

const EDITS = [
  [337, '"已按 " + run.tier + " 档优化结果发送"', 'Lf("已按 {tier} 档优化结果发送", { tier: run.tier })'],
  [526, '"（点击/拖动/方向键；当前：" + curLabel + "）"', 'Lf("（点击/拖动/方向键；当前：{v}）", { v: curLabel })'],
  [601, '"（两档：关 / 开）"', 'L("（两档：关 / 开）")'],
  [602, '"（拖动 / 点击 / ←→；当前 " + val + " 回合）"', 'Lf("（拖动 / 点击 / ←→；当前 {v} 回合）", { v: val })'],
  [618, 'twoState ? "全文 " + text : text + " 回合"', 'twoState ? Lf("全文 {t}", { t: text }) : Lf("{t} 回合", { t: text })'],
  [656, '"目录为空"', 'L("目录为空")'],
  [692, 'store.intercepts.length + " 次"', 'store.intercepts.length + L(" 次")'],
  [714, 'line("上限", ', 'line(L("上限"), '],
  [757, '"加载失败：" + store.modelCatalogError : "（暂无可用模型）"', 'L("加载失败：") + store.modelCatalogError : L("（暂无可用模型）")'],
  [843, '? "全文：把工作 AI 现在看到的完整上下文（双方全文）交给优化模型；受 6 万字符总量上限约束，超限整回合省略"', '? L("全文：把工作 AI 现在看到的完整上下文（双方全文）交给优化模型；受 6 万字符总量上限约束，超限整回合省略")'],
  [844, ': "读入最近 0~10 回合对话作为意图上下文（0 = 不读；只读用户侧信息，工作 AI 回复只留长度）"', ': L("读入最近 0~10 回合对话作为意图上下文（0 = 不读；只读用户侧信息，工作 AI 回复只留长度）")'],
  [845, ': "读入最近对话的回合数（0~10）"', ': L("读入最近对话的回合数（0~10）")'],
  [895, 'return "无";', 'return L("无");'],
  [896, 'return rows.length + " 步" + (t && t.converged ? " · 已达上限并收敛" : "");', 'return Lf("{n} 步", { n: rows.length }) + (t && t.converged ? L(" · 已达上限并收敛") : "");'],
  [901, 'phase: "查证" }', 'phase: L("查证") }'],
  [901, 'phase: "收尾" }', 'phase: L("收尾") }'],
  [906, 'L("查证动作 ") + rows.length + " 步" + (t && t.converged ? " · 已达轮次上限并收敛" : "")', 'L("查证动作 ") + Lf("{n} 步", { n: rows.length }) + (t && t.converged ? L(" · 已达轮次上限并收敛") : "")'],
  [910, 'String(r.resultLines) + "行"', 'String(r.resultLines) + L("行")'],
  [1073, '"启动失败：" + JSON.stringify(d)', 'L("启动失败：") + JSON.stringify(d)'],
  [1112, 'msg.message || "未知错误"', 'msg.message || L("未知错误")'],
  [1123, 'deadRoute ? "优化模型不可用 → 已按原文发出，并回退到默认模型" : "优化失败 → 已按原文发出"', 'deadRoute ? L("优化模型不可用 → 已按原文发出，并回退到默认模型") : L("优化失败 → 已按原文发出")'],
  [1132, '"已按 " + cur.tier + " 档优化结果发送"', 'Lf("已按 {tier} 档优化结果发送", { tier: cur.tier })'],
  [1136, '"优化未产出内容 → 已按原文发出"', 'L("优化未产出内容 → 已按原文发出")'],
  [1163, 'return "该模型供应商未注册（没有可用适配器）——请在优化模型里换一个可用的 provider";', 'return L("该模型供应商未注册（没有可用适配器）——请在优化模型里换一个可用的 provider");'],
  [1164, 'return "请求已被取消（回退或超时）";', 'return L("请求已被取消（回退或超时）");'],
  [1165, 'return "找不到可用的模型路由（请先选一个优化模型）";', 'return L("找不到可用的模型路由（请先选一个优化模型）");'],
  [1166, 'return "凭据无效或未授权（请检查该 provider 的 API Key）";', 'return L("凭据无效或未授权（请检查该 provider 的 API Key）");'],
  [1167, 'return "请求过于频繁，请稍后重试";', 'return L("请求过于频繁，请稍后重试");'],
  [1168, 'return "请求超时，可重试";', 'return L("请求超时，可重试");'],
  [1266, 'live ? "优化中…" : run.status === "done" ? "已完成" : run.status === "error" ? "失败" : run.status', 'live ? L("优化中…") : run.status === "done" ? L("已完成") : run.status === "error" ? L("失败") : run.status'],
  [1271, 'run.reasoning.length + " 字"', 'run.reasoning.length + L(" 字")'],
  [1275, '? " · 首字 " + run.firstPaintMs + "ms"', '? L(" · 首字 ") + run.firstPaintMs + "ms"'],
  [1276, '"上下文 " + (run.history.userTurns || 0) + " 回合 · " + (run.history.chars || 0) + " 字"', 'L("上下文 ") + (run.history.userTurns || 0) + L(" 回合 · ") + (run.history.chars || 0) + L(" 字")'],
  [1307, 'run.text.length + " 字"', 'run.text.length + L(" 字")'],
  [1313, '"失败：" + humanizeError(run.error)', 'L("失败：") + humanizeError(run.error)'],
  [1325, '"以下内容将原样发给工作 AI（可直接编辑） · " + String(text || "").length + " 字"', 'L("以下内容将原样发给工作 AI（可直接编辑） · ") + String(text || "").length + L(" 字")'],
  [1422, '"放行本条（按原文发出）"', 'L("放行本条（按原文发出）")'],
  [1471, '"放行本条（按原文发出）"', 'L("放行本条（按原文发出）")'],
  [1695, 'String(o.fullText).length + " 字"', 'String(o.fullText).length + L(" 字")'],
  [1697, 'disclosure("trace", "查证动作", ', 'disclosure("trace", L("查证动作"), '],
]

const EN = {
  '已按 {tier} 档优化结果发送': 'Sent the result optimized at tier {tier}',
  '（点击/拖动/方向键；当前：{v}）': ' (click / drag / arrow keys; current: {v})',
  '（两档：关 / 开）': ' (two positions: off / on)',
  '（拖动 / 点击 / ←→；当前 {v} 回合）': ' (drag / click / ←→; currently {v} turns)',
  '全文 {t}': 'Full text {t}',
  '{t} 回合': '{t} turns',
  '目录为空': 'The catalog is empty',
  ' 次': ' times',
  '上限': 'Cap',
  '加载失败：': 'Load failed: ',
  '（暂无可用模型）': '(no model available)',
  '全文：把工作 AI 现在看到的完整上下文（双方全文）交给优化模型；受 6 万字符总量上限约束，超限整回合省略': 'Full text: hand the optimizer the complete context the working AI sees right now (both sides verbatim); capped at 60k characters, dropping whole turns when over',
  '读入最近 0~10 回合对话作为意图上下文（0 = 不读；只读用户侧信息，工作 AI 回复只留长度）': 'Read the last 0–10 turns as intent context (0 = none; user side only, the working AI\'s replies are reduced to their length)',
  '读入最近对话的回合数（0~10）': 'How many recent turns to read (0–10)',
  '无': 'none',
  '{n} 步': '{n} steps',
  ' · 已达上限并收敛': ' · converged at the cap',
  '查证': 'Check',
  '收尾': 'Wrap-up',
  ' · 已达轮次上限并收敛': ' · converged at the round cap',
  '行': ' lines',
  '启动失败：': 'Failed to start: ',
  '未知错误': 'unknown error',
  '优化模型不可用 → 已按原文发出，并回退到默认模型': 'Optimizer model unavailable → sent your original text and fell back to the default model',
  '优化失败 → 已按原文发出': 'Optimization failed → sent your original text',
  '优化未产出内容 → 已按原文发出': 'Optimization produced nothing → sent your original text',
  '该模型供应商未注册（没有可用适配器）——请在优化模型里换一个可用的 provider': 'That provider is not registered (no adapter available) — pick a working provider under the optimizer model',
  '请求已被取消（回退或超时）': 'The request was cancelled (rollback or timeout)',
  '找不到可用的模型路由（请先选一个优化模型）': 'No usable model route (pick an optimizer model first)',
  '凭据无效或未授权（请检查该 provider 的 API Key）': 'Invalid or unauthorized credentials (check that provider\'s API key)',
  '请求过于频繁，请稍后重试': 'Too many requests — please retry shortly',
  '请求超时，可重试': 'The request timed out; you can retry',
  '优化中…': 'Optimizing…',
  '已完成': 'Done',
  '失败': 'Failed',
  ' 字': ' chars',
  ' · 首字 ': ' · first token ',
  '上下文 ': 'Context ',
  ' 回合 · ': ' turns · ',
  '失败：': 'Failed: ',
  '以下内容将原样发给工作 AI（可直接编辑） · ': 'The following is sent to the working AI as-is (editable) · ',
  '放行本条（按原文发出）': 'Send as-is (original text)',
  '查证动作': 'Verification actions',
}

let ok = 0
const miss = []
for (const [no, oldS, newS] of EDITS) {
  const i = no - 1
  if (lines[i] === undefined) { miss.push(no + ' (no line)'); continue }
  if (lines[i].indexOf(newS) >= 0) { ok += 1; continue }     // 幂等
  const count = lines[i].split(oldS).length - 1
  if (count !== 1) { miss.push(no + ' (matches=' + count + ')  ' + oldS.slice(0, 40)); continue }
  lines[i] = lines[i].split(oldS).join(newS)
  ok += 1
}

// 注入字典条目（插到 EN_TEXT 的收尾 "};" 之前）
let dictStart = -1, dictEnd = -1
for (let i = 0; i < lines.length; i++) {
  if (dictStart < 0 && /const EN_TEXT = \{/.test(lines[i])) dictStart = i
  else if (dictStart >= 0 && dictEnd < 0 && /^\};/.test(lines[i])) { dictEnd = i; break }
}
if (dictStart < 0 || dictEnd < 0) { console.error('EN_TEXT region not found'); process.exit(1) }
const body = lines.slice(dictStart, dictEnd).join('\n')
const add = []
for (const k of Object.keys(EN)) {
  if (body.indexOf('"' + k + '":') >= 0) continue
  add.push('  "' + k + '": "' + EN[k].replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",')
}
lines.splice(dictEnd, 0, ...add)

fs.writeFileSync(file, lines.join('\n'), 'utf8')
console.log('rewrites applied: ' + ok + '/' + EDITS.length)
if (miss.length) { console.log('MISSED:'); for (const m of miss) console.log('  ' + m) }
console.log('dict entries added: ' + add.length + ' (existing skipped)')
console.log('total dict lines now: ' + (lines.slice(dictStart, dictEnd + add.length).length - 2))
