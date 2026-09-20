// P7 / E-001 · 运行入口里**纯函数**部分的单测（不调模型）。
import { stripUnknownSection } from '../lib/eval-e001.js'

let pass = 0
const failures = []
function ok(c, what) { if (!c) throw new Error(what || 'expected truthy') }
function eq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what || 'value'}: expected ${y}, got ${x}`) }
function t(name, fn) { try { fn(); pass += 1 } catch (e) { failures.push({ name, error: String(e.message || e) }) } }

const FULL = [
  '[插件辅助上下文 · 不是用户新增的命令]',
  '任务 default · 意图修订 4。',
  '',
  '【明确要求】',
  '- A。（来源：human msg:1）',
  '- B。（来源：human msg:1）',
  '',
  '【未决项（尚未确定，不要替我拍板）】',
  '- X 尚未指定？（来源：model）',
  '- Y 也尚未指定？（来源：model）',
  '',
].join('\n')

// 这一条守的是实验的**有效性**：只有真的把那段去掉，才谈得上"带/不带"的对照。
// 万一 transform 悄悄没生效，两次运行会跑出同样的结果，而结论会被读成"未决项不是原因"。
t('去掉【未决项】整段，其余一字不动', () => {
  const s = stripUnknownSection(FULL)
  ok(!s.includes('未决项'), '未决项段必须消失')
  ok(!s.includes('X 尚未指定'), '段内条目必须一起消失（不能只删标题）')
  ok(!s.includes('Y 也尚未指定'), '段内条目必须一起消失')
  ok(s.includes('【明确要求】') && s.includes('- A。') && s.includes('- B。'), '明确要求段必须原样保留')
  ok(s.includes('[插件辅助上下文'), '头部必须原样保留')
})

t('没有该段时原样返回（不得改动产物）', () => {
  const noSec = '[插件辅助上下文]\n\n【明确要求】\n- A。\n'
  eq(stripUnknownSection(noSec), noSec, '不含未决项 ⇒ 必须完全不变')
  eq(stripUnknownSection(''), '', '空串')
  eq(stripUnknownSection(null), '', 'null 不得抛')
})

t('未决项不在末尾时，只删到下一个段头', () => {
  const mid = '【明确要求】\n- A。\n\n【未决项（…）】\n- X?\n\n【其它段】\n- keep me\n'
  const s = stripUnknownSection(mid)
  ok(!s.includes('未决项') && !s.includes('X?'), '未决项与其条目都删掉')
  ok(s.includes('【其它段】') && s.includes('keep me'), '后面的段必须保留')
  ok(s.includes('【明确要求】'), '前面的段必须保留')
})

console.log(JSON.stringify({
  suite: 'po06-eval-e001', phase: 'P7',
  total: pass + failures.length, pass, fail: failures.length, failures,
}, null, 2))
if (failures.length > 0) process.exit(1)
