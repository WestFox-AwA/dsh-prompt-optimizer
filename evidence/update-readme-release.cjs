// README 版本同步：node evidence/update-readme-release.cjs <version> [--write]
// 做四件事（中英两份 README 同时）：
//   ① 标题版本号 ② 安装示例里的 tgz 文件名 ③ 历史段插入本版条目 ④ 作者行的版本/日期
// 说明：条目正文按版本内置（这里是 0.4.4-beta.1）；换版本时改 NOTE 即可。
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')

const ver = process.argv[2] || '0.4.4-beta.1'
const write = process.argv.includes('--write')
const date = '2026/09/18'

const NOTE = {
  zh: [
    '### v0.4.6-beta.4 —— 本版：下游形态投影（同一份档位定义，两种消费形态）',
    '',
    '- **本质**：PTC 惩罚的是**工序**，不是**深度**。原先"很细"与"分步骤"被写在同一个字段里，于是"更适配 PTC"看起来像"要削掉极端档"。拆开这两件事，就不必削。',
    '- **改法**：档位拆成五轴（`grounding` / `depth` / `enrich` + **`sequence`** / **`budget`**）；`delivery=ptc` **只投影后两轴**——**清单代替工序、够用即止代替不设限**，`depth` / `enrich` / `grounding` 一字不动。',
    '- **判定**：读会话的 agent preset（自带预设 `ptc`）自动切换，也可在「优化模型」弹层手动指定（自动 / 对话式 / PTC）；只读诊断路由 `/delivery` 会回报"判成了什么、依据是什么"。',
    '- **零回归**：`delivery=chat` 时三档 system 与改前**逐字节相同**（3 档 × 5 组输入 = 15/15，`evidence/snapshot-v6-prompts.cjs --compare`）。',
    '- **实测**（同批 10 题、同档极端、无工具、**两次独立采样**）：**稳健的**——流程开销 0.4 / 0.2 → **0.1 / 0**、逐步 0.4 / 0 → **0 / 0.2**、验收判据 0.5 / 0.7 → **4.5 / 5.7**（该指标噪声 sd 仅 0.75，差距 6–8 倍）、**同批配对 8/10 题变好**（均值 +5.8）。**不稳健的**——综合分与字数：该量尺跨批噪声大于效应（条目数 sd 9.85、综合分 ±3.2），ptc 9.9 / 6.12 与 chat 3.6 / 6.93 区间重叠，**不作为结论**。',
    '- **档位次序仍在**（投影没有把档位抹平）：ptc 形态内 条目数 极端 **31.6** > 高级 **22.3** > 普通 **18.3**。',
    '- **顺带修一个真缺陷**：产出预算改成"单一来源 + **停顿看门狗**"（45s 无增量才收手；硬上限 240s）。原先按总时长 60s 一刀切，把**还在稳定产出**的请求砍成半截命令——改后**累计 42 次运行 0 中断**，其中一题跑到 10929 字 / 127 秒正常完成。',
    '- **诚实边界**：这个量尺的**跨批噪声大于效应**（同一份提示词两批之间条目数 sd = 9.85），所以结论一律取自"同批配对"或"逐字节相同"这类结构事实，不跨批比较。',
    '',
  ],
  en: [
    '### v0.4.6-beta.4 — this release: downstream-shape projection (one tier definition, two consumer shapes)',
    '',
    '- **The essence**: PTC punishes **procedure**, not **depth**. "Very detailed" and "broken into steps" used to live in one field, which made "fit PTC better" look like "weaken the Ultra tier". Split them and nothing has to be weakened.',
    '- **How**: the tiers are now described by five axes (`grounding` / `depth` / `enrich` + **`sequence`** / **`budget`**); `delivery=ptc` **projects only the last two** — **checklist instead of procedure, as-long-as-needed instead of unlimited** — while `depth` / `enrich` / `grounding` stay untouched.',
    '- **Detection**: it reads the session\u2019s agent preset (the shipped `ptc` preset) and switches automatically; you can also pin it in the Optimizer-model popover (Auto / Chat / PTC). A read-only `/delivery` route reports what it decided and why.',
    '- **Zero regression**: with `delivery=chat` all three tiers render **byte-identically** to before (3 tiers x 5 inputs = 15/15, `evidence/snapshot-v6-prompts.cjs --compare`).',
    '- **Measured** (same 10 tasks, Ultra tier, no tools, **two independent samples**): **robust** — process overhead 0.4 / 0.2 -> **0.1 / 0**, stepwise 0.4 / 0 -> **0 / 0.2**, acceptance criteria 0.5 / 0.7 -> **4.5 / 5.7** (that metric\u2019s noise sd is only 0.75, so the gap is 6-8x), and **8 of 10 tasks improve in a paired within-batch run** (mean +5.8). **Not robust** — the composite score and the length: this yardstick\u2019s cross-batch noise exceeds its effects (item-count sd 9.85, composite score +/-3.2), and ptc\u2019s 9.9 / 6.12 overlaps chat\u2019s 3.6 / 6.93, so those are **not claimed**.',
    '- **Tier ordering survives** (the projection does not flatten the tiers): within the ptc shape, item counts are Ultra **31.6** > High **22.3** > Low **18.3**.',
    '- **A real defect fixed along the way**: the output budget is now a single source plus a **stall watchdog** (abort only after 45s with no delta; 240s hard ceiling). The old fixed 60s wall-clock cut requests that were still streaming healthily into **half commands** — after the fix, **42 runs in a row finished with zero aborts**, one of them at 10929 chars after 127 seconds.',
    '- **Honest boundary**: this yardstick\u2019s **cross-batch noise exceeds its effects** (the same prompt varies by sd 9.85 items between batches), so every conclusion here comes from paired-within-batch or byte-identical structural facts, never from cross-batch comparisons.',
    '',
  ],
}

const AUTHOR = {
  zh: '作者：**啃轮胎的西狐** · 版本 **' + ver + '** · 版本日期 **' + date + '**（插件内 `?` 面板最底部也有同样署名）',
  en: 'Author: **啃轮胎的西狐** · version **' + ver + '** · date **' + date + '** (the same credit also sits at the bottom of the in-plugin `?` panel)',
}

for (const [file, lang] of [['README.md', 'zh'], ['README.en.md', 'en']]) {
  const p = path.join(REPO, file)
  let lines = fs.readFileSync(p, 'utf8').split('\n')
  const before = lines.slice()
  // ① 标题版本
  lines[0] = lines[0].replace(/\*\*v[0-9][^*]*\*\*/, '**v' + ver + '**')
  // ② 安装示例 tgz
  let tgzFixed = 0
  for (let i = 0; i < lines.length; i++) {
    if (/dsh-external-dsh-prompt-optimizer-[0-9][^\s`]*\.tgz/.test(lines[i])) {
      const nv = lines[i].replace(/dsh-external-dsh-prompt-optimizer-[0-9][^\s`]*\.tgz/g, 'dsh-external-dsh-prompt-optimizer-' + ver + '.tgz')
      if (nv !== lines[i]) { lines[i] = nv; tgzFixed++ }
    }
  }
  // ③ 历史段插入（插在本版之前；若已存在则跳过）
  const marker = '### v' + ver
  if (!lines.some((l) => l.startsWith(marker))) {
    const at = lines.findIndex((l) => /^### v0\.[0-9]/.test(l))
    if (at >= 0) lines = lines.slice(0, at).concat(NOTE[lang], lines.slice(at))
  }
  // ④ 作者行
  let authorFixed = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('作者：') || lines[i].startsWith('Author:')) {
      lines[i] = AUTHOR[lang]
      authorFixed++
      break
    }
  }
  console.log('--- ' + file + ' ---')
  console.log('  ① 标题 → ' + lines[0].slice(0, 58))
  console.log('  ② 安装示例 tgz 修正 ' + tgzFixed + ' 处')
  console.log('  ③ 本版条目 ' + (lines.some((l) => l.startsWith(marker)) ? '已存在/已插入' : '未插入 ✗') + '；行数 ' + before.length + ' → ' + lines.length)
  console.log('  ④ 作者行修正 ' + authorFixed + ' 处')
  if (write) { fs.writeFileSync(p, lines.join('\n'), 'utf8'); console.log('  已写入 ✓') }
}
if (!write) console.log('\n（干跑；加 --write 实际写入）')
