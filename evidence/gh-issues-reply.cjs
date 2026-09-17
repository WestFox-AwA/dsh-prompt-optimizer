// 一次性：回复并关闭已解决的 issue（#9 #8 #3 #6），并复核状态。
// 用法：node evidence/gh-issues-reply.cjs
const https = require('https')
const { execFileSync } = require('child_process')
const REPO = 'WestFox-AwA/dsh-prompt-optimizer'
const token = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).toString().split('\n').find((l) => l.startsWith('password=')).slice(9)

const api = (p, method, body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null
  const req = https.request({ host: 'api.github.com', path: p, method: method || 'GET', headers: Object.assign({ 'user-agent': 'dsh', authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, (r) => { let b = ''; r.on('data', (d) => { b += d }); r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { res({ _raw: b.slice(0, 200) }) } }) })
  req.on('error', rej)
  if (data) req.write(data)
  req.end()
})

const REPLIES = {
  9: `已在 **0.4.4-beta.1** 修复。你的根因判断完全正确：冲突键是 **id**，不是 \`order\`（\`order\` 只是渲染顺序，绕不开同名条目冲突）。

**修法**：重挂前**先释放上一次的重挂**——保存 \`ctx.slots.inject(...)\` 返回的 disposer，下一次重挂前先调用它；定时器清理时也一并释放。\`shell.overlay\` 的自愈结构与 \`conversation.input.left\` 相同，一并修掉（它此前只是因为"浮层没开就提前 return"而未暴露，正如你指出的）。另外重挂失败现在会记 beacon（\`remount-controls-failed\` / \`remount-overlay-failed\`），不再无声。

**验证**：热重载后不再出现 \`already has an entry with id "prompt-optimizer"\`；\`lib/client.js\` 278798 bytes。
获取方式：<https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/latest>（现在是 v0.4.4-beta.1）。`,
  8: `已在 **0.4.4-beta.1** 修复。

**根因**：\`record()\` 只有一处 push，但**同一次发送会走两条路径**——Enter 键路径（\`keydown-enter\`）与随之触发的按钮点击路径（\`click-send\`）。两条都记一行，所以"本会话累计拦截次数"的显示值恰好是真实拦截次数的两倍（每次拦截 +2），与你的观察完全吻合。

**修法**：把紧随其后的互补路径标记为 \`coalesced\`（遥测行照旧保留，便于排查），并新增 \`interceptCount()\` 供显示使用——帮助面板标题、输入区徽标、控件内计数三处都改用它；自检与遥测里的原始行数保持不变。

如果你在 0.4.4 上用某种发送方式仍看到 +2，请告诉我具体方式（回车 / 点击 / 快捷键 / 语音输入），我按那条路径再查。`,
  3: `这个问题在 **0.3.11-beta.1** 就已修掉（早于当前版本），并在 **0.3.13-beta.1** 加固。你的根因分析与修复方向与我们完全一致：\`settings.register\` 要的是 **schemastery** schema（可调用对象），传 zod 对象会在 \`dsh-settings\` 的 \`resolve()\` 里 \`schema(...)\` 直呼时报 \`TypeError: schema is not a function\`。

**我们的修法**：按候选名解析 \`@deepseek-ai/schemastery\`（回退 \`schemastery\`）→ \`S.object({...})\` 构造 schema → **显式自检 \`typeof schema === 'function'\`** → 再注册；解析不到或形态不符时给出准确状态串（\`schema-unavailable\` / \`schema-not-callable\`），不再抛含混的 TypeError。

**另外**（你没提到、但同源）：settings 服务可能**晚于插件挂载**，一次性查询会永久错过——0.3.13 起改为看门狗自愈重试。

**活实例验证**（0.4.4-beta.1）：\`GET /prompt-optimizer/api/state\` → \`"settings": "registered+mirrored"\`。

感谢你抽检 7 个版本并附上 \`dsh-settings\` 的源码行号——"这不是 DSH 版本漂移"这一点因此被钉死，省了我们大量排查。`,
  6: `确认是发布流程的缺陷，而且**不只影响 v0.3.12-beta.1**：发布脚本用 GitHub API 建 release 时，tag 会落在**当时的远端 HEAD** 上，而版本号 bump 的那个提交往往还没推送 → tag 内容里的 \`version\` 与 tag 名不一致（我们复核发现 v0.4.1/0.4.2/0.4.3 也都如此）。

**已修**：
1. \`evidence/release-local.cjs\`：发版时统一 bump \`package.json\`，并顺带同步 \`lib/client.js\` 里 beacon 的 build 标签（那个也漂过，停在 v0.3.10-beta.2）。
2. 新增 \`evidence/fix-tags.cjs\`：按"**逐提交读取 package.json 的 version 字段**"把 tag 指到版本号匹配的提交（不用字符串搜索——那会误匹配 CHANGELOG 里的版本号）。
3. 复核结果（GitHub API 读取 tag 内容）：v0.4.4-beta.1 / v0.4.3-beta.1 / v0.4.2-beta.1 / v0.4.1-beta.1 的 \`package.json\` 版本**均与 tag 名一致 ✓**。
4. 新增 \`gh-api.cjs publish\`：一条命令完成 建/更新 release → 版本化资产 → **版本无关别名资产**（\`dsh-external-dsh-prompt-optimizer.tgz\`）→ 标记 latest → 回读校验，避免再出现"latest 指针 404 / 指向旧版"。

至于**已发布的 0.3.x 旧 tag**：修正它们需要重写历史，弊大于利，故保持原样（它们已不是 main 上的推荐版本）。今后新版本不会再出现该问题。关闭本 issue。`,
}

;(async () => {
  for (const n of [9, 8, 3, 6]) {
    const c = await api('/repos/' + REPO + '/issues/' + n + '/comments', 'POST', { body: REPLIES[n] })
    console.log('#' + n + ' 评论已发: ' + (c.html_url || JSON.stringify(c).slice(0, 80)))
    const closed = await api('/repos/' + REPO + '/issues/' + n, 'PATCH', { state: 'closed', state_reason: 'completed' })
    console.log('#' + n + ' 状态: ' + closed.state + ' (' + (closed.state_reason || '-') + ')')
  }
  const list = await api('/repos/' + REPO + '/issues?state=open&per_page=50')
  console.log('剩余 open issue: ' + list.filter((i) => !i.pull_request).length)
})().catch((e) => { console.error('FATAL ' + (e && e.message ? e.message : e)); process.exit(1) })
