// P9.4 · **设置 → 行为**的映射（EV-0143）。
//
// 为什么必须有这一层：界面上摆了"辅助 / 补充程度 / 自主预算"三个开关，如果它们**不改变任何行为**，
// 那就是装饰品——本项目最忌的"看起来生效"（用户点开 0.6 却不生效、也没有任何提示）。
// 所以每一个开关都要有一条**可测的**行为对应，并且这条对应要写在代码里、被测试钉住：
//
//   assist=off      ⇒ **不解释、不注入**（只记一条台账 reason:'assist-off'）。省一次模型调用，
//                     也保证"只记录、不补充"这句界面文案是真的。
//   detail=minimal  ⇒ 意图包预算收紧（只保必要的节）      standard=默认   detailed=放宽
//   budget=minimal  ⇒ 一批最多问 1 个问题                standard=2      generous=3
//
// ⚠ 边界说明（不要读成更多）：`budget` 目前**只**映射到"澄清提问配额"，
// 返工门（P6）的生产触发本来就是默认关闭的，不因为档位而打开——档位不该悄悄放大自主权。
import { normalizeSettings } from './settings.js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 意图包字符预算：默认与 `compiler.DEFAULT_BUDGET` 一致（1200），避免"没设置就变行为"。 */
export const DETAIL_BUDGET = Object.freeze({ minimal: 700, standard: 1200, detailed: 2000 })
/** 一批最多问几个问题：默认与 `clarifier` 的默认一致（2）。 */
export const BUDGET_QUESTIONS = Object.freeze({ minimal: 1, standard: 2, generous: 3 })
/** 未指定（字段缺失）时用的档位，与 settings 的默认一致。 */
export const DEFAULT_DETAIL = 'standard'
export const DEFAULT_BUDGET = 'standard'
export const DEFAULT_ASSIST = 'auto'

/**
 * 纯函数：设置 → 政策。
 *
 * ⚠ 这里**故意没有第二层回落**：档位合法性由 `normalizeSettings`（settings.js）统一保证——
 * 它已经把非法值换成默认并如实上报。原先我在本函数里又写了一遍"取不到就回落默认"的三元，
 * 结果那行**永远不可达**：变异体"非法档位不回落"死活抓不住（测试无法区分两种实现）。
 * 不可达的防御代码是一种**谎报**——它看起来在保证什么，其实什么都没保证。
 * 真正要守的不变量交给测试：**settings.js 的每个值域里的每个取值都必须在这里有映射**（见 policy.test.mjs）。
 */
export function policyFor(settings) {
  const s = normalizeSettings(settings).settings
  return {
    assist: s.assist,
    model: s.model,
    detail: s.detail,
    budget: s.budget,
    injectPacket: s.assist !== 'off',
    packetBudgetChars: DETAIL_BUDGET[s.detail],
    maxQuestions: BUDGET_QUESTIONS[s.budget],
    // ⚠ P10 补接（真机台账照出来的洞，别删这几行）：
    // 引擎侧（`renderObserverBlock` / `readToolsFor`）读的是 `pol.historyMode` / `pol.turns` / `pol.readTools`，
    // 而政策里**原本没有这三个字段** ⇒ 全是 `undefined` ⇒ 上下文永远走 `turns-0`、工具永远 `setting-not-true`，
    // 于是界面上的"上下文/回合数/读项目文件"三个开关**全是死开关**——引擎模块单测全过、生产里一动不动。
    // 教训：模块级核对必须**经过 policy**，否则照不出"接线漏了一段"。
    permission: s.permission,
    historyMode: s.historyMode,
    turns: s.turns,
    readTools: s.readTools,
  }
}

/**
 * 读**生效**的政策：`<home>/po06.json` 里的设置 → 归一化 → 政策。
 * 任何读/解析异常都回落到默认政策（保守：默认档位就是今天的行为）。
 */
export function readPolicy({ home, readFile } = {}) {
  const read = readFile || ((p) => { try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null } })
  let raw = null
  try { const t = read(join(String(home), 'po06.json')); raw = t ? JSON.parse(t) : null } catch { raw = null }
  const p = policyFor(raw || {})
  return { ...p, source: raw ? 'config' : 'default' }
}
