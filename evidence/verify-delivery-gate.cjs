// 交付门判定逻辑单测：node evidence/verify-delivery-gate.cjs
// 判据（可复核）：只认"必然坏"的信号；好页面绝不能被误判（这是门能不能用的底线）。
(async () => {
  const po = (await import('../lib/index.js')).__poVerify
  const fails = []
  const ok = (cond, name, extra) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '   ← ' + (extra === undefined ? '' : JSON.stringify(extra))))
    if (!cond) fails.push(name)
  }
  const v = (s) => po.gateVerdict(s)

  console.log('① 必现坏：一个都不能放过')
  ok(v({ opened: false, reason: '调试端口未就绪' }).verdict === 'cannot-open', '打不开 → cannot-open')
  ok(v({ opened: true, pageErrors: ['TypeError: x is not a function'] }).verdict === 'page-error', '页面抛异常 → page-error')
  ok(v({ opened: true, overlay: '着色器编译失败 | 有一个或多个着色器程序未能编译或链接' }).verdict === 'fatal-overlay', '致命覆盖层（着色器编译失败）→ fatal-overlay')
  ok(v({ opened: true, overlay: '初始化超时 | 超过 25 秒仍未出现首帧画面' }).verdict === 'fatal-overlay', '初始化超时 → fatal-overlay')
  const zero = v({ opened: true, canvas: true, canvasW: 0, canvasH: 0 })
  ok(zero.verdict === 'blank-canvas-0', '画布 0×0（tank.html 那种）→ blank-canvas-0', zero)
  const black = v({ opened: true, canvas: true, canvasW: 1250, canvasH: 658, pixels: { mean: 0, max: 0, w: 64, h: 64 } })
  ok(black.verdict === 'blank-canvas', '画布尺寸正常但帧内中心全黑 → blank-canvas', black)
  ok(po.GATE_HARD_FAIL.has('fatal-overlay') && po.GATE_HARD_FAIL.has('blank-canvas') && po.GATE_HARD_FAIL.has('blank-canvas-0') && po.GATE_HARD_FAIL.has('page-error'), '四种都算硬失败（会触发返工回注）')
  ok(!po.GATE_HARD_FAIL.has('ok') && !po.GATE_HARD_FAIL.has('skipped'), 'ok/skipped 不算硬失败')

  console.log('\n② 好页面不许误判（门的底线）')
  ok(v({ opened: true, canvas: true, canvasW: 1250, canvasH: 658, pixels: { mean: 42.5, max: 700, w: 64, h: 64 } }).verdict === 'ok', '正常画面 → ok')
  ok(v({ opened: true, canvas: true, canvasW: 1250, canvasH: 658, pixels: { mean: 1.2, max: 40, w: 64, h: 64 } }).verdict === 'ok', '暗场景（mean 低但有亮像素）→ ok（不误判成全黑）')
  ok(v({ opened: true, canvas: false, text: '一份纯文字报告' }).verdict === 'ok', '没有画布的页面（报告/文档）→ ok')
  ok(v({ opened: true, canvas: true, pixels: { note: 'no-gl' } }).verdict === 'ok' || v({ opened: true, canvas: true, pixels: { note: 'no-gl' } }).verdict === 'blank-canvas-0', 'pixels 缺失不崩（无 gl 时不误判）')
  ok(v({ opened: true, overlay: '加载中… 12%' }).verdict === 'ok', '普通加载文案（不含失败字样）→ ok')
  ok(v({}).verdict === 'ok', '空采样不崩 → ok')
  ok(v(null).verdict === 'ok', 'null 不崩 → ok')

  console.log('\n③ 采样表达式本身（帧内读像素——在 rAF 里读，否则永远读到 0）')
  const expr = po.GATE_SAMPLE_EXPR
  ok(/requestAnimationFrame/.test(expr), '像素采样在 requestAnimationFrame 内')
  ok(/readPixels/.test(expr), '用 readPixels 取中心区域')
  ok(/fatalTitle|fatalMsg/.test(expr), '覆盖层检测覆盖 fatalTitle/fatalMsg 这类约定 id')
  ok(/canvasW/.test(expr) && /canvasH/.test(expr), '带画布后备缓冲尺寸')

  console.log('\n④ 门自身的开关与去重')
  ok(po.gateConfig.enabled === true && po.gateConfig.rework === true, '默认：门开、返工回注开', po.gateConfig)
  ok(po.gateConfig.waitMs >= 5000, '默认等待 ≥5s（真机等待，不用虚拟时间）', po.gateConfig.waitMs)

  console.log('\n⑤ 返工回注：只在该发的时候发（用假 sessionController，不碰真会话）')
  const sent = []
  const fakeCtx = (services) => ({ get: (n) => services[n] })
  const rec = (over) => Object.assign({ t: Date.now(), sessionId: 'session-test', path: 'C:/tmp/x.html', size: 1, mtime: 1, verdict: 'fatal-overlay', reason: '着色器编译失败', screenshot: 'C:/tmp/x.png' }, over || {})
  const withSC = fakeCtx({ sessionController: { prompt: async (req) => { sent.push(req) } } })
  const okRec = rec({ verdict: 'ok' })
  ok((await po.gateInjectRework(withSC, 'session-ok', okRec)) === null, '判定 ok → 不回注', sent.length)
  const r1 = rec({ path: 'C:/tmp/a.html', mtime: 11 })
  ok((await po.gateInjectRework(withSC, 'session-a', r1)) === 'injected', '硬失败 → 回注一次')
  ok(sent.length === 1 && sent[0].sessionId === 'session-a' && sent[0].mode === 'queue', '回注进的是该会话的下一轮（mode=queue）', sent[0])
  ok(/机器裁决/.test(sent[0].content[0].text) && /着色器编译失败/.test(sent[0].content[0].text), '回注内容带**实测证据**（判定+原因）', sent[0].content[0].text.slice(0, 80))
  ok(/静态检查/.test(sent[0].content[0].text), '回注明确写清"静态检查不算验证"')
  ok((await po.gateInjectRework(withSC, 'session-a', r1)) === 'already-injected', '同一交付物不重复回注（防抖）', sent.length)
  ok((await po.gateInjectRework(fakeCtx({}), 'session-b', rec({ path: 'C:/tmp/b.html', mtime: 22 }))) === 'no-session-controller', '没有 sessionController 服务时如实返回，不抛')
  const gateOff = { enabled: true, rework: false, waitMs: 20000, keepShots: 20 }
  const before = sent.length
  const savedRework = po.gateConfig.rework
  po.gateConfig.rework = false
  ok((await po.gateInjectRework(withSC, 'session-c', rec({ path: 'C:/tmp/c.html', mtime: 33 }))) === null, '开关关掉后不回注')
  po.gateConfig.rework = savedRework
  ok(sent.length === before, '关掉期间确实一条都没发', sent.length - before)

  console.log('\n' + (fails.length ? '✗ 失败 ' + fails.length + ' 项: ' + fails.join(' | ') : '✓ 全部通过'))
  process.exit(fails.length ? 1 : 0)
})().catch((e) => { console.error('✗ 崩溃: ' + (e && e.stack || e)); process.exit(1) })
