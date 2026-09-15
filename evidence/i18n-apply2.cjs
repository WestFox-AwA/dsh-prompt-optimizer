// i18n 第二轮补丁：署名/兼容声明等拼接串的翻译 + 新增 i18n 自检 demo（两种语言逐一验证）。
// 幂等。用法：node evidence/i18n-apply2.cjs
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'lib', 'client.js')
let src = fs.readFileSync(file, 'utf8')
const log = []
let n = 0

// ── 1) 字典补条 ──
const extra = {
  '作者': 'Author', '版本': 'Version', '版本日期': 'Date',
  '本版本适用于 dsh-0.1.6-alpha.1（0.1.5-rc.1 亦可）': 'This version targets dsh-0.1.6-alpha.1 (0.1.5-rc.1 also works)',
  ' · 本会话已拦截 ': ' · intercepted in this session: ',
  '（只读）': ' (read-only)',
}
const ins = Object.keys(extra).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(extra[k]) + ',').join('\n')
const anchor = '  "UI 自检通知": "UI self-check notice",'
if (src.indexOf('"作者": "Author"') >= 0) log.push('SKIP 字典补条')
else if (src.indexOf(anchor) >= 0) { src = src.replace(anchor, anchor + '\n' + ins); n += 1; log.push('APPLY 字典补条 (' + Object.keys(extra).length + ' 条)') }
else { log.push('MISS 字典补条锚点') }

// ── 2) 帮助面板署名渲染：拆成可翻译片段 ──
const metaOld = '"作者：啃轮胎的西狐 · 版本 0.2.1beta2 · 版本日期 2026/09/15",'
const metaNew = 'L("作者") + "：啃轮胎的西狐 · " + L("版本") + " 0.2.1beta2 · " + L("版本日期") + " 2026/09/15",'
if (src.indexOf(metaNew) >= 0) log.push('SKIP 署名渲染')
else if (src.indexOf(metaOld) >= 0) { src = src.replace(metaOld, metaNew); n += 1; log.push('APPLY 署名渲染') }
else { log.push('MISS 署名渲染（版本号可能已变）') }

// ── 3) 新增 i18n 自检 demo ──
if (src.indexOf('cmd.run === "i18n-demo"') >= 0) log.push('SKIP i18n-demo')
else {
  const demo = [
    '\t\t\t\t\t\t\t// 语言自检（宿主下发）：报告 locale 服务状态，并强制 en / zh 各渲染一次，核对关键文案',
    '\t\t\t\t\t\t\tif (cmd.run === "i18n-demo") {',
    '\t\t\t\t\t\t\t\tlastToken = cmd.token;',
    '\t\t\t\t\t\t\t\twindow.__DPO_LAST_TOKEN__ = cmd.token;',
    '\t\t\t\t\t\t\t\tvoid (async () => {',
    '\t\t\t\t\t\t\t\t\tconst keep = store.locale;',
    '\t\t\t\t\t\t\t\t\tconst out = { serviceActive: null, samples: {} };',
    '\t\t\t\t\t\t\t\t\ttry { const loc = ctx.get("locale"); if (loc && loc.getSnapshot) out.serviceActive = (loc.getSnapshot() || {}).active || null } catch (e) { /* no service */ }',
    '\t\t\t\t\t\t\t\t\tconst probe = async (lang) => {',
    '\t\t\t\t\t\t\t\t\t\tstore.locale = lang; store.helpOpen = true; emit(); await frame(); await sleep(260);',
    '\t\t\t\t\t\t\t\t\t\tconst head = document.querySelector(".dpo-help-pop .dpo-pop-head");',
    '\t\t\t\t\t\t\t\t\t\tconst rows = [...document.querySelectorAll(".dpo-help-row")].map((el) => String(el.textContent || ""));',
    '\t\t\t\t\t\t\t\t\t\tconst tip = document.querySelector("[data-dpo=\\"help-tip\\"]");',
    '\t\t\t\t\t\t\t\t\t\tconst meta = document.querySelector("[data-dpo=\\"help-meta\\"]");',
    '\t\t\t\t\t\t\t\t\t\tconst tierCap = document.querySelector("[data-dpo=\\"tier\\"] .dpo-cap-opt[data-on=\\"true\\"]");',
    '\t\t\t\t\t\t\t\t\t\tconst res = {',
    '\t\t\t\t\t\t\t\t\t\t\thead: head ? String(head.textContent || "").slice(0, 60) : null,',
    '\t\t\t\t\t\t\t\t\t\t\ttip: tip ? String(tip.textContent || "").slice(0, 60) : null,',
    '\t\t\t\t\t\t\t\t\t\t\tmeta: meta ? String(meta.textContent || "").slice(0, 90) : null,',
    '\t\t\t\t\t\t\t\t\t\t\ttierLabel: tierCap ? String(tierCap.textContent || "") : null,',
    '\t\t\t\t\t\t\t\t\t\t\trowHasTier: rows.some((r) => r.indexOf(lang === "en" ? "Tier" : "档位") >= 0),',
    '\t\t\t\t\t\t\t\t\t\t\trowHasSubstance: rows.some((r) => r.indexOf(lang === "en" ? "Substance first" : "实质优先") >= 0),',
    '\t\t\t\t\t\t\t\t\t\t\trowHasProcess: rows.some((r) => r.indexOf(lang === "en" ? "Process weight" : "流程长度") >= 0),',
    '\t\t\t\t\t\t\t\t\t\t\trows: rows.length,',
    '\t\t\t\t\t\t\t\t\t\t};',
    '\t\t\t\t\t\t\t\t\t\tstore.helpOpen = false; emit(); await frame();',
    '\t\t\t\t\t\t\t\t\t\treturn res;',
    '\t\t\t\t\t\t\t\t\t};',
    '\t\t\t\t\t\t\t\t\ttry {',
    '\t\t\t\t\t\t\t\t\t\tout.samples.en = await probe("en");',
    '\t\t\t\t\t\t\t\t\t\tout.samples.zh = await probe("zh");',
    '\t\t\t\t\t\t\t\t\t} catch (e) { out.error = String(e); }',
    '\t\t\t\t\t\t\t\t\tstore.locale = keep; emit();',
    '\t\t\t\t\t\t\t\t\tconst en = out.samples.en || {}; const zh = out.samples.zh || {};',
    '\t\t\t\t\t\t\t\t\tout.pass = Boolean(',
    '\t\t\t\t\t\t\t\t\t\ten.head && en.head.indexOf("Help") >= 0 && en.rowHasTier && en.rowHasSubstance && en.rowHasProcess && en.tip && en.tip.indexOf("Extreme") >= 0',
    '\t\t\t\t\t\t\t\t\t\t&& zh.head && zh.head.indexOf("使用帮助") >= 0 && zh.rowHasTier && zh.rowHasSubstance && zh.rowHasProcess',
    '\t\t\t\t\t\t\t\t\t);',
    '\t\t\t\t\t\t\t\t\tbeacon("i18n-demo", out);',
    '\t\t\t\t\t\t\t\t})().catch((e) => beacon("i18n-demo", { error: String(e) }));',
    '\t\t\t\t\t\t\t\treturn;',
    '\t\t\t\t\t\t\t}',
  ].join('\n')
  const a = '\t\t\t\t\t\t\t// 档位/权限按会话独立 自检（宿主下发）'
  const i = src.indexOf(a)
  if (i < 0) log.push('MISS i18n-demo 锚点')
  else { const ls = src.lastIndexOf('\n', i) + 1; src = src.slice(0, ls) + demo + '\n' + src.slice(ls); n += 1; log.push('APPLY i18n-demo') }
}

fs.writeFileSync(file, src, 'utf8')
console.log(log.join('\n'))
console.log('共 ' + n + ' 处')
