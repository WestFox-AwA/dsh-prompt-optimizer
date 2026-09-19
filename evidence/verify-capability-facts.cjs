// 能力事实注入的单元验证：node evidence/verify-capability-facts.cjs
// 判据（可复核、与任务无关）：
//   1) 探测脚本把三个坑写进脚本本身：私有 user-data-dir / 软件渲染 / **轮询等落盘**
//   2) 档位只读服务、读不到就是 unknown（**不猜**——猜档位正是病根）
//   3) 渲染是同步的：探测再慢也不阻塞装配（首次调用 <20ms 返回，结果异步补上）
//   4) full-access 才出现"受限档警告不适用"那句；受限档不出现（不许把话说反）
//   5) 缓存 key = 档位：切档必然重测（病根就是"切档后不重测"）
//   6) 通道 ✗ 必须带原始原因（denied / Access is denied / exit N）
//   7) 无会话 → 空串（宁可不注入，也不注入错的东西）
(async () => {
  const po = (await import('../lib/index.js')).__poVerify
  const fails = []
  const ok = (cond, name, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '   ← ' + (extra || '')))
    if (!cond) fails.push(name)
  }

  console.log('① 探测脚本自带三个坑的解法')
  const script = po.renderProbeScript('C:\\x\\msedge.exe', 'C:\\t\\probe.html', 'C:\\t\\shot.png', 'C:\\t\\profile')
  ok(/--user-data-dir=/.test(script), '含私有 user-data-dir（否则参数被已开实例吞掉）')
  ok(/enable-unsafe-swiftshader/.test(script), '含软件渲染（无 GPU 时 WebGL 全黑）')
  ok(process.platform === 'win32'
    ? /Start-Sleep -Milliseconds 250/.test(script) && /for \(\$i = 0; \$i -lt 24/.test(script)
    : /sleep 0\.25/.test(script), '含**轮询等落盘**（启动器立刻返回，图 0.3–1s 后才出现）', script.slice(0, 200))
  ok(/PO_SHOT_OK/.test(script) && /PO_SHOT_NONE/.test(script), '成功/失败都有机器可读标记')

  console.log('\n② 档位只读服务，读不到 = unknown（不猜）')
  const fakeCtx = (services, extra) => ({
    get: (n) => services[n],
    ...(extra || {}),
  })
  const mkSession = (id) => ({ id: id || 'session-test', seq: 1, header: { cwd: process.cwd() } })
  ok(po.capabilityPolicyOf(fakeCtx({}), mkSession()).mode === 'unknown', '无 sandboxPolicy 服务 → unknown')
  ok(po.capabilityPolicyOf(fakeCtx({ sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'D:\\w' }) } }), mkSession()).mode === 'workspace-write', '有服务 → 取服务值')
  ok(po.capabilityPolicyOf(fakeCtx({ sandboxPolicy: { resolve: () => { throw new Error('boom') } } }), mkSession()).mode === 'unknown', '服务抛错 → unknown（不猜）')
  ok(po.capabilityApprovalOf(fakeCtx({}), mkSession()) === 'unknown', '无 approval 服务 → unknown')
  ok(po.capabilityApprovalOf(fakeCtx({ approval: { effectivePolicy: () => 'never' } }), mkSession()) === 'never', 'never 直读')

  console.log('\n③ 装配同步、不阻塞（探测在后台）')
  let runCount = 0
  const slowCtx = fakeCtx({
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: process.cwd() }) },
    approval: { effectivePolicy: () => 'never' },
    tools: { schemas: () => [{ name: 'pwsh' }, { name: 'mcp__godot-ai__node_create' }] },
    shell: {
      resolve: (req) => req,
      run: () => new Promise((r) => { runCount++; setTimeout(() => r({ exitCode: 0, stdout: { text: 'PO_PROC_OK PO_SHOT_OK 4096' }, stderr: { text: '' }, sandbox: { mode: 'danger-full-access', denied: false } }), 400) }),
    },
  })
  const session = mkSession('session-slow')
  const t0 = Date.now()
  const first = po.renderCapabilityFacts(slowCtx, { agent: { session } })
  const elapsed = Date.now() - t0
  ok(elapsed < 20, '首次渲染 ' + elapsed + 'ms < 20ms（探测未完成也不等）', elapsed + 'ms')
  ok(/首次探测中/.test(first), '首次渲染显示"首次探测中"', first)
  ok(po.capabilityStateFor(slowCtx, { mode: 'danger-full-access', workspaceRoot: process.cwd() }).probing === true, 'probe 处于 pending')
  await new Promise((r) => setTimeout(r, 700))
  const second = po.renderCapabilityFacts(slowCtx, { agent: { session } })
  ok(/子进程 ✓/.test(second), '探测完成后子进程 ✓', second)
  ok(/视觉截图 ✓/.test(second), '探测完成后视觉截图 ✓（带浏览器名与耗时）', second)
  ok(/godot-ai/.test(second), '外部工具服务器枚举到 godot-ai', second)
  ok(/不适用/.test(second), 'full-access 出现"受限档警告不适用"', second)
  ok(/失败不是结论/.test(second), '含通用判断规则（失败不是结论）', second)

  console.log('\n④ 受限档不许把话说反')
  const wsCtx = fakeCtx({
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: process.cwd() }) },
    approval: { effectivePolicy: () => 'ask' },
    shell: {
      resolve: (req) => req,
      run: () => Promise.resolve({ exitCode: 1, stdout: { text: 'PO_SHOT_NONE Program \'msedge.exe\' failed to run: Access is denied' }, stderr: { text: '' }, sandbox: { mode: 'workspace-write', denied: false } }),
    },
  })
  po.renderCapabilityFacts(wsCtx, { agent: { session: mkSession('session-ws') } })
  await new Promise((r) => setTimeout(r, 200))
  const wsText = po.renderCapabilityFacts(wsCtx, { agent: { session: mkSession('session-ws') } })
  ok(!/不适用/.test(wsText), '受限档不出现"警告不适用"', wsText)
  ok(/视觉截图 ✗/.test(wsText), '受限档视觉截图如实 ✗', wsText)
  ok(/Access is denied/.test(wsText), '✗ 带原始原因（Access is denied）', wsText)

  console.log('\n⑤ 缓存 key = 档位：切档必重测')
  const before = runCount
  const modeCtx = fakeCtx({
    sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: process.cwd() }) },
    approval: { effectivePolicy: () => 'ask' },
    shell: { resolve: (r) => r, run: () => { runCount++; return Promise.resolve({ exitCode: 0, stdout: { text: 'PO_PROC_OK PO_SHOT_OK 12' }, stderr: { text: '' }, sandbox: { mode: 'read-only', denied: false } }) } },
  })
  po.renderCapabilityFacts(modeCtx, { agent: { session: mkSession('session-ro') } })
  await new Promise((r) => setTimeout(r, 120))
  ok(runCount > before, '新档位触发了自己的探测（' + before + ' → ' + runCount + '）')
  const keys = [...po.capabilityCache.keys()]
  ok(keys.includes('danger-full-access') && keys.includes('workspace-write') && keys.includes('read-only'), '缓存按档位分键: ' + JSON.stringify(keys))

  console.log('\n⑥ ✗ 原因渲染 + 无会话不注入')
  ok(/被沙箱拒绝/.test(po.reasonSuffix({ denied: true })), 'denied → 被沙箱拒绝')
  ok(/exit 7/.test(po.reasonSuffix({ exitCode: 7 })), 'exitCode → exit 7')
  ok(po.renderCapabilityFacts(slowCtx, {}) === '', '无 agent.session → 空串（不注入）')
  ok(po.renderCapabilityFacts(slowCtx, { agent: {} }) === '', 'agent 无 session → 空串')
  ok(po.CAPABILITY_CONTEXT_ORDER > 115 && po.CAPABILITY_CONTEXT_ORDER < 120, 'order=' + po.CAPABILITY_CONTEXT_ORDER + ' 落在 APPROVAL_POLICY(115) 与 SUBAGENT_DELEGATION(120) 之间')

  console.log('\n⑦ 部分可用要说清楚（read-only 的受限语言模式）')
  const langCtx = fakeCtx({
    sandboxPolicy: { resolve: () => ({ mode: 'read-only-lang', workspaceRoot: process.cwd() }) },
    approval: { effectivePolicy: () => 'ask' },
    shell: {
      resolve: (r) => r,
      run: () => Promise.resolve({
        exitCode: 0,
        stdout: { text: 'PO_PROC_OK' },
        stderr: { text: 'Cannot create type. Only core types are supported in this language mode.' },
        sandbox: { mode: 'read-only', denied: false },
      }),
    },
  })
  po.renderCapabilityFacts(langCtx, { agent: { session: mkSession('session-lang') } })
  await new Promise((r) => setTimeout(r, 200))
  const langText = po.renderCapabilityFacts(langCtx, { agent: { session: mkSession('session-lang') } })
  ok(/受限语言模式/.test(langText), '受限语言模式如实标注（既不夸大也不隐瞒）', langText)

  console.log('\n' + (fails.length ? '✗ 失败 ' + fails.length + ' 项: ' + fails.join(' | ') : '✓ 全部通过'))
  process.exit(fails.length ? 1 : 0)
})().catch((error) => { console.error('✗ 崩溃: ' + (error && error.stack || error)); process.exit(1) })
