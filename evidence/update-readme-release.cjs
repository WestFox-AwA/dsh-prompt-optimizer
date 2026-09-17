// README 版本同步：node evidence/update-readme-release.cjs <version> [--write]
// 做四件事（中英两份 README 同时）：
//   ① 标题版本号 ② 安装示例里的 tgz 文件名 ③ 历史段插入本版条目 ④ 作者行的版本/日期
// 说明：条目正文按版本内置（这里是 0.4.4-beta.1）；换版本时改 NOTE 即可。
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')

const ver = process.argv[2] || '0.4.4-beta.1'
const write = process.argv.includes('--write')
const date = '2026/09/17'

const NOTE = {
  zh: [
    '### v0.4.4-beta.1 —— 本版：修两个已上报缺陷（issue #9 / #8），策略未变',
    '',
    '- **#9 控件自愈每 1.2 秒抛 pageerror**：slot 注册按 **id** 去重，自愈却用同一个 `id` 再注册 → 抛 `already has an entry with id "prompt-optimizer"`（改 `order` 绕不开）。',
    '  修复：**重挂前先释放上一次的重挂**（保存并调用 `ctx.slots.inject(...)` 的 disposer，定时器清理时一并释放）；`shell.overlay` 自愈同构、一并修；重挂失败改为记 beacon。',
    '- **#8 本会话拦截次数显示为真值两倍**：同一次发送走两条路径（`keydown-enter` + 随之触发的 `click-send`），每次记两行。',
    '  修复：互补路径标 `coalesced`（遥测行保留），新增 `interceptCount()` 供显示使用；自检与遥测仍用原始行数。',
    '- 发布流程：新增 `gh-api publish` 一键发布（版本化资产 + **版本无关别名资产** + 标记 latest + 回读校验）；新增 `fix-tags.cjs` 保证 tag 内的 `package.json` 版本与 tag 名一致（此前 v0.4.1~v0.4.3 均不一致，已全部纠偏并复核）。',
    '',
  ],
  en: [
    '### v0.4.4-beta.1 — this release: two reported bugs fixed (issues #9 / #8); strategy unchanged',
    '',
    '- **#9 the composer self-heal threw a pageerror every 1.2s**: slot registrations are de-duplicated by **id**, yet the heal loop re-registered the same `id` -> `already has an entry with id "prompt-optimizer"` (changing `order` does not help).',
    '  Fix: **dispose the previous re-registration before retrying** (keep and call the disposer returned by `ctx.slots.inject(...)`, and release it when the timer is cleared); same structure fixed for `shell.overlay`; failed re-registrations now emit a beacon.',
    '- **#8 the session interception counter showed twice the real value**: one send travels two paths (`keydown-enter` plus the resulting `click-send`), recording two rows each time.',
    '  Fix: the complementary row is marked `coalesced` (telemetry kept), and a new `interceptCount()` feeds the three display sites; self-tests and telemetry still use the raw row count.',
    '- Release tooling: new `gh-api publish` (versioned asset + **version-less alias asset** + mark latest + read-back check) and `fix-tags.cjs` so a tag\'s `package.json` version matches its tag name (v0.4.1-v0.4.3 were all mismatched; now corrected and re-verified).',
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
