// v0.3.0-beta.3 文档补丁（幂等）：CHANGELOG 新条目 + PROMPT-OPTIMIZATION 9.2 + ACCEPTANCE 产物级小节。
// 用法：node evidence/patch-030b3.cjs
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const P = (f) => path.join(root, f)

// ── 1) CHANGELOG
const CH = `## v0.3.0-beta.3 — 2026/09/15

作者：啃轮胎的西狐

**"可自动化验收"能力 + 简单/复杂平衡的取舍（本轮）**

1. **新增能力：可自动化验收**。用户说"我要能自动化验收 / 能自测 / 我要跑检查"时，命令必须把**验收接口原样带进命令**
   （接口名、返回值、判据），并要求该自检**能在无浏览器/无引擎的纯计算环境独立跑通**（不依赖 DOM 事件、不依赖闭包外部变量、不递归爆栈）、**接口挂到全局**。
   理由是实测出来的：产物级验证台发现"命令里没说清楚接口"时，产出的单文件 HTML 有 2/4 连 window.__selftest 都没暴露，无法自动验收。
2. **复杂度闸门加固（取舍，如实记录）**：未命中复杂信号时，命令里**不得出现**（现象量化 / 失效模式 / 全局验收场景 / 不得降级清单 / 本轮不做项 / 停手条件 / 证据形式 / 可自动化验收），且长度 ≤ 原话 1.5 倍或 800 字。
   - 加固前：复杂题 **93.9%**，但**简单任务回归不合格**（复杂包泄漏 1/4、长度 1.37×）。
   - 加固后：复杂题 **88.9%**（仍在目标线 83% 以上），简单任务回归 **PASS**（泄漏 0/4、长度 **0.95×**，比发布版还短）。
   - 结论：用约 5 分（复杂题）换回了"简单任务不被撑长/不越权"，这是有意的取舍，不是纯提升。
3. **产物级验证台（单文件 HTML，独立审计）**：不依赖浏览器（本会话 Edge 无法无头渲染），把产物脚本放进 Node 沙箱执行，
   **由验证器自己**从 \`buildGeometry()\` 取几何、算每个三角面的法线朝向并与质心比较，得出 \`inwardFaces / facesOutwardRatio\`；产物自报只作次要证据。
   - 验证器自证：\`html-fixtures/gold.html\`（按"从外看逆时针"构造）**15/15 PASS**；\`html-fixtures/bad.html\`（绕序整体反转）**FAIL 且独立审计 inwardFaces=12**。
   - 真实产物（H1 法线盒体 / H3 审计并修复反向面，两条件）：**通过 3/6**；SHIP H1、SHIP H3、V3 H1 三份 PASS 且独立审计 \`inwardFaces=0\`；
     其余三份 FAIL 的原因都是**产物没把接口挂到全局**（验证器取不到几何）。命令侧 4/4 都写了该要求 → **瓶颈在执行 AI 的接口一致性，不在优化器**。
   - 期间抓到的真实缺陷：V3 某次 H3 产物 \`buildGeometry\` 调用即**爆栈**；另一份 60 面中 **22 面朝内**（比例 0.63）——正是"该看见的面看不见"。

**命令侧实测（10 题 × 2 次采样 = 60 格，并发 4，共 265 秒，满分 180）**

| 条件 | 得分 | 换算满分 180 | 达标 |
|---|---|---|---|
| 无优化（对照） | 8/360 = 2.2% | 4 | 未达标 |
| 发布版 0.2.2-beta.1（极端档） | 266/360 = 73.9% | 133 | 及格线 |
| **v0.3.0-beta.3（极端档）** | **320/360 = 88.9%** | **160** | **目标线** |

- 配对：**胜 7 / 负 2 / 平 1**；同格重复采样平均极差 **0.93 分/18**（最大 5）。逐题差距最大的是 C1 3D 场景（+11.5）。
- 提示词规模：高级/极端 **5088 / 5086** 字符（普通档 1405）；约束闸门 **34 项断言全 PASS**（含"普通档不得出现能力包"反向断言）。
- 简单任务回归：复杂包泄漏 **0/4**、长度 **0.95×**、流程索取不比发布版重 → **PASS**。

`
let ch = fs.readFileSync(P('CHANGELOG.md'), 'utf8')
if (ch.indexOf('## v0.3.0-beta.3') >= 0) console.log('CHANGELOG: 已有 beta.3')
else { ch = ch.replace('## v0.3.0-beta.2 — 2026/09/15', CH + '## v0.3.0-beta.2 — 2026/09/15'); fs.writeFileSync(P('CHANGELOG.md'), ch, 'utf8'); console.log('CHANGELOG: 已插入 beta.3') }

// ── 2) PROMPT-OPTIMIZATION 9.2
const P9 = `### 9.2 v0.3.0-beta.3：可自动化验收 + 复杂度闸门加固（取舍）

**新增要求**（COMPLEX_RULES）：用户要求"能验收/能自测/我要跑检查"时，命令必须把验收接口（接口名、返回值、判据）原样带下去，
并要求自检**能在无浏览器/无引擎的纯计算环境独立跑通**、**接口挂全局**。触发原因：产物级验证台实测 2/4 份产物连 \`window.__selftest\` 都没暴露。

**闸门加固（取舍，非纯提升）**

| 版本 | 复杂题 | 简单任务回归 |
|---|---|---|
| 无硬闸门（beta.3 前） | **93.9%**（169/180） | **不合格**：复杂包泄漏 1/4、长度 1.37× |
| 加硬闸门（本版） | **88.9%**（160/180） | **PASS**：泄漏 0/4、长度 **0.95×** |

闸门内容：未命中复杂信号 → 命令里不得出现（现象量化 / 失效模式 / 全局验收场景 / 不得降级清单 / 本轮不做项 / 停手条件 / 证据形式 / 可自动化验收），
长度 ≤ 原话 1.5 倍或 800 字；命中 → 六项全展开。用约 5 分复杂题换回"简单任务不被撑长"，是有意选择。

**产物级（单文件 HTML）验证**：见 \`evidence/html-harness-notes.md\`；验证器自证 gold 15/15、bad FAIL(inwardFaces=12)；
真实产物 3/6 通过，失败全部是"接口未挂全局"；命令侧 4/4 均要求了该接口 → 瓶颈在执行 AI。

`
let po = fs.readFileSync(P('PROMPT-OPTIMIZATION.md'), 'utf8')
if (po.indexOf('### 9.2 v0.3.0-beta.3') >= 0) console.log('PROMPT-OPTIMIZATION: 已有 9.2')
else { po = po.replace(/\s*$/, '') + '\n\n' + P9; fs.writeFileSync(P('PROMPT-OPTIMIZATION.md'), po, 'utf8'); console.log('PROMPT-OPTIMIZATION: 已追加 9.2') }

// ── 3) ACCEPTANCE：产物级小节
const ACC = `## 九、产物级验收（单文件 HTML，v0.3.0-beta.3）

**目标**：把"细节正确性"从命令侧推到**产物侧**——真的生成单文件 HTML，并客观判断"该看见的面是否看得见"。

**方法（不依赖浏览器）**：\`html-verify.cjs\` 把产物脚本放进 Node 沙箱执行，**由验证器自己**从 \`buildGeometry()\` 取几何、
计算每个三角面的法线朝向并与质心方向比较（\`inwardFaces / facesOutwardRatio\`）；产物自报只作次要证据；题型感知（法线/修复题不要求操控项）。

| # | 项 | 命令 | 实测 |
|---|---|---|---|
| Y1 | 验证器自证 | \`html-verify.cjs html-fixtures/gold.html\` | **PASS 15/15**，独立审计 12 面 / 内向面 0 |
| Y2 | 反例必须被判失败 | \`html-verify.cjs html-fixtures/bad.html\` | **FAIL**，独立审计 12 面 / **内向面 12**（绕序反转） |
| Y3 | 真实产物（H1 法线盒体 / H3 审计修复，两条件） | \`cxlab mode=artifact\` + \`html-verify.cjs\` | **通过 3/6**：SHIP H1、SHIP H3、V3 H1 均 PASS 且 \`inwardFaces=0\`；其余 3 份 FAIL 原因均为**产物未把接口挂到全局** |
| Y4 | 命令侧是否尽责 | 检查 4 条命令文本 | **4/4** 都写了"全局暴露 + buildGeometry + 独立跑通" → **瓶颈在执行 AI 的接口一致性，不在优化器** |
| Y5 | 已抓到的真实缺陷 | — | V3 某次 H3 产物 \`buildGeometry\` 调用即**爆栈**；另一份 60 面中 **22 面朝内**（比例 0.63） |

**已知边界**：① 产物级目前只覆盖"法线/可见面/接口一致性"，操控人性化（H2）尚未接入；② 生成一份产物约 1～6 分钟，因此采样数少（n≤2）；
③ 验证器只能审计"把几何构造暴露到全局"的产物——这本身就是用户原话要求的一部分，因此不算误判，但会让"接口没做到"的产物无法进一步审计（只能判 FAIL）。

`
let acc = fs.readFileSync(P('ACCEPTANCE.md'), 'utf8')
if (acc.indexOf('## 九、产物级验收') >= 0) console.log('ACCEPTANCE: 已有第九节')
else {
  const marker = '> 走完后把'
  const i = acc.indexOf(marker)
  acc = i >= 0 ? (acc.slice(0, i) + ACC + '---\n\n' + acc.slice(i)) : (acc.replace(/\s*$/, '') + '\n\n---\n\n' + ACC)
  fs.writeFileSync(P('ACCEPTANCE.md'), acc, 'utf8'); console.log('ACCEPTANCE: 已插入第九节')
}

// ── 4) 版本字符串
const VER = [['lib/client.js', '0.3.0beta2', '0.3.0beta3'], ['lib/client.js', 'build: "v0.3.0-beta.2"', 'build: "v0.3.0-beta.3"']]
for (const [f, from, to] of VER) {
  let t = fs.readFileSync(P(f), 'utf8')
  if (t.indexOf(to) >= 0 && t.indexOf(from) < 0) { console.log('VER SKIP ' + f); continue }
  const c = t.split(from).length - 1
  if (!c) { console.log('VER MISS ' + f + ' ' + from); continue }
  fs.writeFileSync(P(f), t.split(from).join(to), 'utf8'); console.log('VER APPLY ' + f + ' (' + c + ')')
}
