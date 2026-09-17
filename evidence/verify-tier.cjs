// 档位收敛 + 采样温度删除 的逻辑验证（离线，不需要运行中的 DSH）：node evidence/verify-tier.cjs
//
// 覆盖两件事：
//   ① 宿主半边（lib/index.js）：三档/启用态 system 逐字节相同、TIER_SPECS 只剩 label+system、
//      档位归一化（basic/advanced/extreme → on）、历史配置读/写两条路径、不产生 revision 漂移、
//      删掉 temperature 后 streamOnce / streamWithTools 的位置参数仍然对齐。
//   ② 浏览器半边（lib/client.js）：TIERS 两态、语义色两态、自检探针断言（4 → 2）、
//      帮助面板/提示条用到的中文串都能查到英文映射（否则英文界面会回落成中文）。
//
// 判定失败以非 0 退出，便于接入发布前检查。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const INDEX = path.join(ROOT, 'lib', 'index.js')
const CLIENT = path.join(ROOT, 'lib', 'client.js')

const fails = []
const ok = (cond, label, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra === undefined ? '' : '  => ' + JSON.stringify(extra)))
  if (!cond) fails.push(label)
}

async function loadHost() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-tier-'))
  const copy = path.join(tmpDir, 'idx.mjs')
  fs.copyFileSync(INDEX, copy)
  fs.appendFileSync(copy, '\nexport const __dump = { STRATEGY, TIER_PARTS, TIER_SPECS, buildSystem, normalizeTier, specForTier, loadPluginState, savePluginState, streamOnce, streamWithTools }\n')
  const mod = await import(pathToFileURL(copy).href)
  return { d: mod.__dump, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) }
}

;(async () => {
  console.log('① 源码卫生')
  const idxSrc = fs.readFileSync(INDEX, 'utf8')
  const cliSrc = fs.readFileSync(CLIENT, 'utf8')
  ok((idxSrc.match(/temperature/g) || []).length === 0, 'lib/index.js 无 temperature 残留')
  ok((cliSrc.match(/temperature/g) || []).length === 0, 'lib/client.js 无 temperature 残留')
  ok(cliSrc.indexOf('"basic"') < 0 && cliSrc.indexOf('"advanced"') < 0 && cliSrc.indexOf('"extreme"') < 0, 'lib/client.js 不再出现历史档位 id')

  console.log('② 宿主半边：档位与 system')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-home-'))
  process.env.DSH_HOME = home
  fs.writeFileSync(path.join(home, 'prompt-optimizer.json'), JSON.stringify({
    tier: 'extreme',
    permission: 'auto',
    perSession: { s1: { tier: 'basic' }, s2: { tier: 'advanced' }, s3: { tier: 'off' } },
    revision: 7,
  }, null, 2))

  const { d, cleanup } = await loadHost()
  try {
    ok(d.STRATEGY === 'v5', 'STRATEGY === v5', d.STRATEGY)
    const s = ['basic', 'advanced', 'extreme', 'on'].map((t) => d.buildSystem(t, { historyMode: 'turns' }))
    ok(s[0] === s[1] && s[1] === s[2] && s[2] === s[3], 'buildSystem(basic|advanced|extreme|on) 逐字节相同')
    ok(s[0].length === 515, 'system 长度 = 515', s[0].length)
    ok(JSON.stringify(Object.keys(d.TIER_SPECS)) === JSON.stringify(['basic', 'advanced', 'extreme']), 'TIER_SPECS 保留历史三档（供对照/自检）')
    ok(Object.keys(d.TIER_SPECS).every((k) => Object.keys(d.TIER_SPECS[k]).sort().join(',') === 'label,system'), 'TIER_SPECS 只剩 label/system')
    ok(Object.values(d.TIER_PARTS).every((p) => !('temperature' in p)), 'TIER_PARTS 无 temperature 字段')

    console.log('③ 档位归一化与历史配置兼容')
    const cases = [['off', 'off'], ['on', 'on'], ['basic', 'on'], ['advanced', 'on'], ['extreme', 'on'], ['BASIC', 'on'], [' garbage ', null], ['', null], [undefined, null], [42, null]]
    ok(cases.every(([i, e]) => d.normalizeTier(i) === e), 'normalizeTier 归一化正确', cases.map(([i]) => String(i) + '->' + d.normalizeTier(i)))
    const st = d.loadPluginState()
    ok(st.tier === 'on', '历史顶层 tier=extreme 读回 on', st.tier)
    ok(st.perSession.s1.tier === 'on' && st.perSession.s2.tier === 'on' && st.perSession.s3.tier === 'off', '历史 perSession 读回归一化', st.perSession)
    ok(st.revision === 7, '读入不产生 revision 漂移', st.revision)
    const next = d.savePluginState({ tier: 'advanced', permission: 'auto', sessionId: 's1' })
    ok(next.tier === 'on' && next.perSession.s1.tier === 'on', '写入顶层 + perSession 都归一化', { tier: next.tier, s1: next.perSession.s1 })
    const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'prompt-optimizer.json'), 'utf8'))
    ok(onDisk.tier === 'on' && onDisk.perSession.s1.tier === 'on', '落盘内容已归一化', { tier: onDisk.tier, s1: onDisk.perSession.s1 })
    ok(d.savePluginState({ tier: 'ultra' }).tier === 'on', '非法值不写坏状态')

    console.log('④ 宿主半边：位置参数对齐')
    ok(d.specForTier('on') === d.TIER_SPECS.advanced && d.specForTier('extreme') === d.TIER_SPECS.extreme, 'specForTier 映射（on → 启用态代表规格）')
    ok(d.streamOnce.length === 4, 'streamOnce.length === 4', d.streamOnce.length)
    ok(d.streamWithTools.length === 8, 'streamWithTools.length === 8', d.streamWithTools.length)
  } finally {
    cleanup()
    fs.rmSync(home, { recursive: true, force: true })
  }

  console.log('⑤ 浏览器半边：控件与探针')
  const tiers = cliSrc.match(/const TIERS = \[([\s\S]*?)\];/)
  const ids = [...(tiers ? tiers[1] : '').matchAll(/id: "([^"]+)"/g)].map((m) => m[1])
  ok(JSON.stringify(ids) === JSON.stringify(['off', 'on']), 'TIERS = off/on', ids)
  const tones = cliSrc.match(/const TIER_TONES = \{([^}]*)\};/)
  ok(Boolean(tones) && !/basic|advanced|extreme/.test(tones[1]) && /off/.test(tones[1]) && /on/.test(tones[1]), 'TIER_TONES = off/on')
  ok(cliSrc.indexOf('tierLabels.length === 2') >= 0 && cliSrc.indexOf('clicks.length === 2') >= 0 && cliSrc.indexOf('geometry.length === 2') >= 0, '三处探针断言已由 4 档改为 2 档')
  ok(cliSrc.indexOf('["Off", "On"]') >= 0 && cliSrc.indexOf('["关闭", "开启"]') >= 0, 'i18n 期望标签 = 两态')
  ok(cliSrc.indexOf('en.tip.indexOf("On") >= 0') >= 0 && cliSrc.indexOf('/On/.test(en.toast)') >= 0, 'EN tip/toast 断言改用 On')

  console.log('⑥ 浏览器半边：英文映射完整')
  const used = [...cliSrc.matchAll(/(?:L|Lf)\("([^"]*[\u4e00-\u9fff][^"]*)"/g)].map((m) => m[1])
  const missing = [...new Set(used)].filter((u) => cliSrc.indexOf('"' + u + '":') < 0)
  ok(missing.length === 0, '所有中文字面量都有 EN_TEXT 映射', missing)

  console.log('')
  if (fails.length) {
    console.log('结果：FAIL（' + fails.length + ' 项）\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('结果：全部通过（档位两态、历史配置兼容、system 同文、无 temperature 残留）')
})().catch((e) => {
  console.error('验证脚本自身出错：', e)
  process.exit(2)
})
