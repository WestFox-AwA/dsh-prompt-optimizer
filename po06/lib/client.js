// P10 · **控件栏**（客户端）。由 `dsh-client-modules` 自动服务并注入页面。
//
// 三个界面，对应主计划 §14.1「面向用户的最小界面」：
//   ① `conversation.input.left` —— 输入区左侧的**一排控件**（P10 换的挂载点：原来是
//      `conversation.input.dock` 上那颗小胶囊）：档位 / 优化权限 / 上下文 / 读项目文件 / 模型。
//      换的理由是用户实测反馈「不适应 0.6 的操控形态」——胶囊只回答"它在不在"，
//      而人要的是**随手拨**（0.5 的形态）。
//   ② `shell.overlay`           —— 详情浮层槽（本轮**未动**：仍是占位注册；详情面板本体
//      由 ① 末尾那颗「详情」按钮打开——和换挂载点之前是同一个组件里的同一块面板）
//   ③ `settings.plugins.tab`    —— 设置页里的一页（同一套控制表单，便于从设置进入）
//
// 三条从 0.5 的真实事故里学来的纪律（照抄，不重犯）：
//   · **单例闸门**：HMR 会重新求值本文件，旧实例的监听若没回收就会"替新实例干活"
//     ⇒ 后台在跑、界面不显示。所以每个实例在 apply 时抢注 token，只有持有者才注册 UI。
//   · **slot 按 id 去重**：同 id 重复注册会抛 `list slot "…" already has an entry with id "…"`，
//     改 order 绕不开 ⇒ 重挂前必须先释放上一次的注册。
//   · **卸载即净**：所有注册与定时器都进 own()，apply 返回一个统一释放函数。
//
// 与宿主控制 API 的约定（见 lib/control-api.js）：**写操作必须带 `x-po06: 1`**
// —— 自定义头会触发 CORS 预检，而服务端从不回 CORS 头 ⇒ 跨站写在预检阶段就被浏览器拦掉。
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-po06',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-po06'
    const API = '/po06/api'
    const WRITE_HEADERS = { 'content-type': 'application/json', 'x-po06': '1' }
    const INSTANCE_TOKEN = NS + '#' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)

    /** 只有抢到 token 的实例才注册 UI（见文件头"单例闸门"）。 */
    const isActiveInstance = () => {
      try { return window.__PO06_ACTIVE__ === INSTANCE_TOKEN } catch (e) { return true }
    }

    // ── 语言：最小的 L(zh, en) ────────────────────────────────────────
    // 中文是默认（`ctx.locale` 拿不到就用中文）。**英文逐条给，不做字典**：
    // 字典漏一个键，界面上就会中英混排而没人发现；两参写法漏了英文是肉眼可见的。
    // ⚠ `L` 在**渲染时**求值（LOCALE 在 apply 里才被赋值），所以只能在函数体里调用它。
    let LOCALE = 'zh'
    const L = (zh, en) => (LOCALE === 'en' && en ? en : zh)
    // P11：发送按钮的本地化标签要从宿主的字典取（0.5:503 `localeService.bind("conversation")`）；
    // 拿不到就只有结构兜底（卡片内最后一个按钮），**不会因此不拦**。
    let LOCALE_BIND = null
    const detectLocale = (ctx) => {
      let v = null
      try {
        v = ctx && ctx.locale
        if (v && typeof v === 'object') v = v.locale || v.name || v.id || v.language || null
      } catch (e) { v = null }
      if (typeof v !== 'string' || !v) return 'zh'          // 拿不到 ⇒ 中文
      return /^zh/i.test(v) ? 'zh' : 'en'                   // 只要明确说了非中文，就给英文
    }

    // ── 值域的**本地兜底镜像**（唯一真相仍是 lib/settings.js）────────────
    // 正常情况下档位直接用宿主推导好的 `/status.described.tier`；
    // 只有当 `described` 缺失（老宿主 / 接口改过）时才用下面这张表自己推。
    // ⚠ 改 settings.js 的 TIER_PRESETS / TURNS_MIN / TURNS_MAX 必须同步改这里。
    const TIER_KEYS = ['off', 'light', 'standard', 'heavy']
    const TIER_PRESETS_LOCAL = Object.freeze({
      off: { assist: 'off', detail: 'standard', budget: 'standard' },
      light: { assist: 'auto', detail: 'standard', budget: 'standard' },
      standard: { assist: 'auto', detail: 'detailed', budget: 'standard' },
      heavy: { assist: 'auto', detail: 'detailed', budget: 'generous' },
    })
    const TURNS_MIN = 0
    const TURNS_MAX = 10
    const DEFAULT_TURNS = 6
    const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)
    const tierOfSettings = (s) => {
      const x = s || {}
      for (const t of TIER_KEYS) {
        const p = TIER_PRESETS_LOCAL[t]
        if (x.assist === p.assist && x.detail === p.detail && x.budget === p.budget) return t
      }
      return 'custom'
    }
    const tierLabel = (t) => ({
      off: L('关闭', 'Off'), light: L('轻度', 'Low'), standard: L('标准', 'High'),
      heavy: L('重度', 'Ultra'), custom: L('自定义', 'Custom'),
    }[t] || t)

    // P11：**档位色照抄 0.5**（0.5:293 `TIER_TONES` = off/basic/advanced/extreme 四色）。
    // 0.6 的档位是 off/light/standard/heavy（见 settings.js TIER_PRESETS），语义逐档对应
    // （关 / 轻 / 标 / 重）⇒ **色值一字不改**地搬过来，于是悬浮球与档位徽标和 0.5 是同一套颜色。
    // 自定义档（几项值凑不出预设）没有对应色 ⇒ 落回主题主色（下面 OVS.acc）。
    const TIER_TONES = { off: '#8b8f98', light: '#4a9eff', standard: '#a970ff', heavy: '#ff8a3d' }

    // P11 浮层的配色 token：**逐条取自 0.5 的那张 CSS**（0.5:3259-3272 的自定义属性 + 各处的
    // `var(--dsw-…)` 兜底值）。0.5 把变量定义在 `.dpo-overlay` 上、用 `color-mix` 派生透明变体；
    // 0.6 只用内联样式 ⇒ 这里把**用得到的那几个**写成常量，透明变体直接写 rgba（色值同源）。
    const OVS = {
      acc: 'var(--dsw-alias-state-business-primary, #4a9eff)',
      acc12: 'rgba(74,158,255,.12)',
      acc22: 'rgba(74,158,255,.22)',
      surface: 'var(--dsw-specific-tip, #1b1b1b)',
      line: 'var(--dsw-alias-border-l1, #444)',
      lineSoft: 'var(--dsw-alias-border-l1, #3a3a3a)',
      fg: 'var(--dsw-alias-label-primary, #eee)',
      fg2: 'var(--dsw-alias-label-secondary, #ccc)',
      fg3: 'var(--dsw-alias-label-tertiary, #999)',
      cap: 'var(--dsw-alias-label-caption, #8a8a8a)',
      bg1: 'var(--dsw-alias-bg-l1, #141414)',
      danger: '#d9534f',
      dangerFg: '#f2777a',
      dangerBg: 'rgba(242,119,122,.10)',
      dangerLine: 'rgba(242,119,122,.28)',
      ok: '#3ecf8e',
    }

    /** token 数字：过千用 k（用户 2026-09-21："过大的 token 数可以用多少多少 k 来显示"）。 */
    const fmtTok = (n) => {
      if (n == null) return '—'
      const v = Number(n)
      if (!Number.isFinite(v)) return '—'
      if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M'
      if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
      return String(v)
    }

    // ── 与宿主 API 的薄封装 ───────────────────────────────────────────
    // 两条都不许把 raw 异常抛到调用方：网络层失败也要变成**可读原因**
    // （`SyntaxError: Unexpected end of JSON input` 这种原样冒到界面上，用户只会以为插件坏了）。
    async function apiGet(path) {
      let r
      try { r = await fetch(API + path, { headers: { accept: 'application/json' } }) }
      catch (e) { throw new Error('unreachable') }
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || j.ok !== true) throw new Error((j && j.reason) || ('http-' + r.status))
      return j
    }
    async function apiPost(path, body, opts) {
      let r
      try { r = await fetch(API + path, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(body || {}), signal: opts && opts.signal }) }
      catch (e) { return { ok: false, reason: (e && e.name === 'AbortError') ? 'aborted' : 'unreachable' } }
      const j = await r.json().catch(() => null)
      if (!j || typeof j !== 'object') return { ok: false, reason: 'bad-json-response' }
      return (j.ok === true || j.reason) ? j : { ...j, ok: false, reason: 'http-' + r.status }
    }

    // ── 把任何失败都变成"人话" ────────────────────────────────────────
    // 已知原因给固定说法，未知原因截断到一行——**绝不允许 raw 异常冒到界面**。
    const briefly = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120)
    function reasonText(reason) {
      const raw = briefly(reason)
      const http = /^http-(\d+)$/.exec(raw)
      if (http) return L('服务返回 HTTP ' + http[1], 'Server returned HTTP ' + http[1])
      if (raw === 'unreachable') return L('连不上宿主服务（它可能刚重启）', 'Cannot reach the host service (it may have just restarted)')
      if (raw === 'bad-json-response') return L('服务返回的内容读不出来', 'The server response could not be parsed')
      if (raw === 'backup-unusable') return L('旧配置的备份不可用，这次没有写入', 'Backup of the old config was unusable, so nothing was written')
      if (raw === 'readback-unparsable') return L('写进去的设置读不回来，已中止', 'Written settings could not be read back; aborted')
      if (/^readback-mismatch:/.test(raw)) return L('写回校验不一致：' + briefly(raw.slice(17)), 'Read-back mismatch: ' + briefly(raw.slice(17)))
      if (/^write-failed:/.test(raw)) return L('写文件失败：' + briefly(raw.slice(13)), 'Write failed: ' + briefly(raw.slice(13)))
      return raw || L('未知原因', 'unknown reason')
    }
    const errorText = (e) => reasonText((e && e.message) || e)

    // ── 小状态钩子（轮询，不引入任何依赖）────────────────────────────
    function usePoll(fn, ms) {
      const [state, setState] = React.useState({ loading: true, data: null, error: null })
      const tick = React.useCallback(() => {
        let alive = true
        fn().then(
          (data) => { if (alive) setState({ loading: false, data, error: null }) },
          (e) => { if (alive) setState((s) => ({ loading: false, data: s.data, error: String((e && e.message) || e) })) },
        )
        return () => { alive = false }
      }, [fn])
      React.useEffect(() => {
        let cancel = tick()
        const t = window.setInterval(() => { cancel = tick() }, ms)
        return () => { window.clearInterval(t); if (typeof cancel === 'function') cancel() }
      }, [tick, ms])
      return [state, tick]
    }

    const useStatus = () => usePoll(React.useCallback(() => apiGet('/status'), []), 15000)
    const useTurns = (n) => usePoll(React.useCallback(() => apiGet('/turns?limit=' + n), [n]), 15000)
    const useState_ = (sid) => usePoll(
      React.useCallback(() => (sid ? apiGet('/state?session=' + encodeURIComponent(sid)) : Promise.resolve(null)), [sid]),
      10000,
    )

    /**
     * 「拉一次 + 可以重试」的小钩子（`/models` 用它）。
     * 失败时 state.error 是 Error 对象，**由调用方翻译成人话**（见 reasonText）；
     * 卸载后回来的响应一律丢弃（否则会给已卸载的组件 setState）。
     */
    function useOnce(fn) {
      const [state, setState] = React.useState({ loading: true, data: null, error: null })
      const live = React.useRef(true)
      const run = React.useCallback(() => {
        setState((x) => ({ loading: true, data: x.data, error: null }))
        fn().then(
          (data) => { if (live.current) setState({ loading: false, data, error: null }) },
          (e) => { if (live.current) setState({ loading: false, data: null, error: e }) },
        )
      }, [fn])
      React.useEffect(() => { live.current = true; run(); return () => { live.current = false } }, [run])
      return [state, run]
    }

    // ── 共用的样式与小部件 ───────────────────────────────────────────
    const S = {
      chip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 8px', borderRadius: '10px',
        border: '1px solid rgba(127,127,127,.35)', fontSize: '12px', lineHeight: '18px', cursor: 'pointer',
        background: 'transparent', color: 'inherit' },
      dot: (on) => ({ width: '7px', height: '7px', borderRadius: '50%', background: on ? '#39c07a' : '#9aa0a6' }),
      panel: { position: 'fixed', right: '16px', bottom: '84px', width: '420px', maxHeight: '70vh', overflow: 'auto',
        background: 'var(--dsw-alias-bg-elevated, #1f1f22)', color: 'var(--dsw-alias-label-primary, #e8e8ea)',
        border: '1px solid rgba(127,127,127,.35)', borderRadius: '12px', padding: '14px', zIndex: 60,
        boxShadow: '0 10px 30px rgba(0,0,0,.35)', fontSize: '13px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', margin: '6px 0' },
      label: { minWidth: '92px', opacity: .85 },
      select: { flex: 1, padding: '4px 6px', borderRadius: '6px', border: '1px solid rgba(127,127,127,.4)',
        background: 'transparent', color: 'inherit' },
      btn: { padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(127,127,127,.45)',
        background: 'transparent', color: 'inherit', cursor: 'pointer' },
      ta: { width: '100%', minHeight: '120px', borderRadius: '6px', border: '1px solid rgba(127,127,127,.4)',
        background: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: '12px', padding: '6px' },
      muted: { opacity: .7, fontSize: '12px' },
      h: { margin: '10px 0 4px', fontSize: '13px', fontWeight: 600 },
      prov: (p) => ({ fontSize: '11px', padding: '0 5px', borderRadius: '8px', marginLeft: '6px',
        background: p === 'user' ? 'rgba(57,192,122,.18)' : (p === 'machine' ? 'rgba(120,150,255,.18)' : 'rgba(230,90,90,.22)') }),
      // P10 控件栏专用（要能在输入区那一行里挤下，所以比浮层里的控件小一号）
      bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '12px',
        lineHeight: '18px', color: 'inherit' },
      // 控件栏分两层：每层各自横排、可换行（行内间距沿用原来的 6px）
      barRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
      grp: { display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' },
      seg: { display: 'inline-flex', alignItems: 'stretch', border: '1px solid rgba(127,127,127,.45)',
        borderRadius: '10px', overflow: 'hidden', fontSize: '12px', lineHeight: '18px', userSelect: 'none', touchAction: 'none' },
      segItem: { padding: '1px 8px', whiteSpace: 'nowrap', opacity: .8 },
      segOn: { background: 'rgba(120,150,255,.28)', opacity: 1, fontWeight: 600 },
      small: { padding: '1px 8px', borderRadius: '8px', border: '1px solid rgba(127,127,127,.45)',
        background: 'transparent', color: 'inherit', fontSize: '12px', lineHeight: '18px', cursor: 'pointer' },
      dis: { opacity: .45, filter: 'grayscale(1)', cursor: 'not-allowed' },
      // 「?」帮助弹层（要求②）：正文由宿主从包里的 HELP-0.6.md 取，这里只做最轻的排印
      helpPop: { position: 'fixed', right: '16px', bottom: '84px', width: 'min(560px, 92vw)', maxHeight: '72vh',
        overflow: 'auto', background: 'var(--dsw-alias-bg-elevated, #1f1f22)',
        color: 'var(--dsw-alias-label-primary, #e8e8ea)', border: '1px solid rgba(127,127,127,.35)',
        borderRadius: '12px', padding: '14px', zIndex: 70, boxShadow: '0 10px 30px rgba(0,0,0,.35)',
        fontSize: '12.5px', lineHeight: '19px' },
      helpTitle: { fontWeight: 700, fontSize: '14px', margin: '2px 0 6px' },
      helpH: { fontWeight: 600, margin: '10px 0 4px' },
      helpP: { margin: '2px 0' },
      helpQuote: { opacity: .75, borderLeft: '3px solid rgba(127,127,127,.35)', paddingLeft: '8px', margin: '4px 0' },
      helpTr: { display: 'flex', gap: '8px', padding: '1px 0' },
      helpTd: { flex: '1 1 0', minWidth: 0 },
      // ── P11 拦截浮层（**照 0.5 的观感复刻**；0.6 只用内联样式对象，不注入 <style>）─────────
      // 0.5 用一张 CSS 字符串（`.dpo-*`）注入页面；0.6 的纪律是内联样式 ⇒ 这里把 0.5 里
      // **决定观感的那几条**逐条翻过来：尺寸/间距/圆角/配色/层级/滚动归属（底栏在滚动区之外）。
      // ❗**有意不搬**的部分（写在前面免得被当成漏搬）：`:hover` / `:active` / `@keyframes` /
      //   毛玻璃 / 渐变。内联样式表达不了伪类与关键帧——要么得再造一堆 JS 状态去模拟 hover（更脆），
      //   要么得注入 <style>（本项目禁止）。所以留下的是**结构**：布局、层级、配色、常驻底栏、
      //   可拖的头、右下角把手、收成球。
      ov: { position: 'fixed', left: 0, top: 0, zIndex: 80, display: 'flex', flexDirection: 'column',
        width: '460px', minWidth: '360px', minHeight: '240px', maxHeight: 'min(78vh, 660px)',
        background: OVS.surface, border: '1px solid ' + OVS.line, borderRadius: '12px',
        boxShadow: '0 8px 28px rgba(0,0,0,.35)', color: OVS.fg, fontSize: '12px',
        overflow: 'hidden', pointerEvents: 'auto', willChange: 'transform', touchAction: 'none' },
      ovHead: { display: 'flex', alignItems: 'center', gap: '0', flex: '0 0 auto', padding: '9px 12px',
        borderBottom: '1px solid ' + OVS.lineSoft, background: OVS.surface, cursor: 'grab', userSelect: 'none' },
      ovScroll: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column' },
      ovRun: { display: 'flex', flexDirection: 'column', gap: '9px', padding: '10px 12px' },
      ovRunStatus: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0', fontSize: '11px',
        letterSpacing: '.2px', color: OVS.fg3 },
      ovChip: { marginLeft: 'auto', fontSize: '10.5px', fontWeight: 600, letterSpacing: '.2px',
        padding: '1px 7px', borderRadius: '5px', background: OVS.acc12, color: OVS.acc,
        border: '1px solid ' + OVS.acc22, whiteSpace: 'nowrap' },
      ovChipMuted: { marginLeft: 'auto', fontSize: '10.5px', padding: '1px 7px', borderRadius: '5px',
        background: 'rgba(127,127,127,.14)', color: OVS.cap, border: '1px solid transparent', whiteSpace: 'nowrap' },
      ovPane: { border: '1px solid ' + OVS.lineSoft, borderRadius: '8px', padding: '8px 10px',
        maxHeight: '132px', overflow: 'auto', background: 'transparent' },
      ovPaneTitle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px',
        letterSpacing: '.4px', color: OVS.cap, marginBottom: '7px' },
      ovPaneBody: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.68', color: OVS.fg2,
        wordBreak: 'break-word' },
      ovReview: { display: 'flex', flexDirection: 'column', gap: '8px' },
      ovReviewText: { width: '100%', boxSizing: 'border-box', minHeight: '150px', maxHeight: '300px',
        overflowY: 'auto', resize: 'vertical', whiteSpace: 'pre-wrap', background: OVS.bg1,
        color: OVS.fg, border: '1px solid ' + OVS.line, borderRadius: '8px', padding: '9px 11px',
        fontSize: '13px', lineHeight: '1.72', fontFamily: 'inherit' },
      ovHintQuiet: { fontSize: '10.5px', color: OVS.cap, lineHeight: '1.5' },
      ovError: { display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px',
        padding: '7px 9px', background: OVS.dangerBg, border: '1px solid ' + OVS.dangerLine,
        color: OVS.dangerFg, fontSize: '11.5px', lineHeight: '1.6', wordBreak: 'break-all' },
      // 折叠（0.5:1487-1501 disclosure / 3449-3460 的 .dpo-fold*）——原文与产出共用同一形态
      ovFold: { borderTop: '1px solid rgba(127,127,127,.35)' },
      ovFoldHead: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px',
        border: 'none', background: 'transparent', color: OVS.fg3, fontSize: '11.5px', textAlign: 'left',
        cursor: 'pointer', fontFamily: 'inherit' },
      ovFoldCaret: { flex: '0 0 auto', fontSize: '12px', color: OVS.cap, transition: 'transform .24s' },
      ovFoldTitle: { flex: '0 0 auto', letterSpacing: '.4px' },
      ovFoldSum: { flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', color: '#7d7d7d', fontSize: '11px' },
      ovFoldText: { margin: '0 12px 10px', padding: '9px 11px', borderRadius: '12px',
        background: 'rgba(20,20,20,.6)', color: OVS.fg2, fontSize: '12.5px', lineHeight: '1.65',
        // 用户 2026-09-21：思维层要**固定显示范围 + 自己滚动**（不是无限撑高，也不是两根滚动条）。
        // 落点：折叠体是**唯一**的滚动容器（固定高度 220px / 最多 34vh），浮层滚动区不再自己滚
        // （见 `ovScrollY`），于是"一处滚动、固定范围、可回看全文"三件事同时成立。
        // 用户 2026-09-21（看图后）：**去掉右侧那根滚动条**，但思维层范围不得自动扩大。
        // 做法同 0.5 的思维区：固定高度的窗口 + `overflow: hidden`（**不出现滚动条**），
        // 内容靠 ThinkBody 里的**自动跟到底部**来展示最新进展（比拖滚动条更贴合"看它在想什么"）。
        whiteSpace: 'pre-wrap', maxHeight: 'min(220px,34vh)', overflow: 'hidden' },
      /** 浮层滚动区在"思维层展开"时**不滚动**，避免和上面那处叠成两根滚动条。 */
      ovScrollY: { flex: '1 1 auto', minHeight: 0, overflowY: 'hidden', overflowX: 'hidden' },
      // 常驻底栏：**在滚动区之外**（0.5:3542-3545）——面板再小、内容再长，关键按钮都不被滚走
      ovFoot: { flex: '0 0 auto', position: 'relative', zIndex: 3, borderTop: '1px solid rgba(127,127,127,.42)' },
      ovFootInner: { display: 'flex', flexDirection: 'column' },
      ovActions: { display: 'flex', gap: '8px', padding: '10px 12px', alignItems: 'center' },
      ovBtn: { flex: '1 1 0', minWidth: 0, height: '28px', borderRadius: '10px', border: '1px solid ' + OVS.line,
        background: 'transparent', color: OVS.fg2, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit', fontWeight: 500, letterSpacing: '.2px' },
      ovBtnPrimary: { borderColor: 'transparent', background: OVS.acc, color: '#fff' },
      ovBtnDanger: { borderColor: 'transparent', background: OVS.danger, color: '#fff' },
      ovBtnGhost: { flex: '0 0 auto', padding: '0 12px', borderColor: 'transparent', background: 'transparent',
        color: OVS.fg3 },
      ovSentTag: { flex: '1 1 auto', fontSize: '11.5px', color: OVS.cap, letterSpacing: '.3px' },
      // 右下角改尺寸把手（0.5:3225 / 3376-3377：斜纹 + 悬停变主色；悬停色内联表达不了，只搬斜纹）
      ovGrip: { position: 'absolute', right: '3px', bottom: '3px', width: '16px', height: '16px', zIndex: 6,
        cursor: 'nwse-resize', opacity: .7, borderRadius: '5px',
        background: 'linear-gradient(135deg,transparent 42%,#888 42%,#888 52%,transparent 52%,transparent 62%,#888 62%,#888 72%,transparent 72%)' },
      ovX: { flex: '0 0 auto', height: '22px', padding: '0 9px', marginLeft: '6px', borderRadius: '999px',
        border: '1px solid transparent', background: 'transparent', color: OVS.fg2, fontSize: '11px',
        cursor: 'pointer', fontFamily: 'inherit' },
      ovHeadTitle: { flex: '0 0 auto', fontSize: '12px', letterSpacing: '.4px', color: OVS.fg2 },
      ovHeadTier: { flex: '0 0 auto', fontSize: '11px', fontWeight: 600, letterSpacing: '.3px', padding: '1px 8px',
        marginLeft: '8px', borderRadius: '5px', background: OVS.acc12, color: OVS.acc, border: '1px solid ' + OVS.acc22 },
      ovHeadCount: { flex: '0 0 auto', fontSize: '10px', padding: '1px 6px', marginLeft: '6px',
        borderRadius: '5px', background: 'rgba(127,127,127,.14)', color: OVS.cap },
      ovHeadHint: { marginLeft: 'auto', fontSize: '10px', padding: '1px 7px', borderRadius: '5px',
        background: 'rgba(127,127,127,.12)', color: OVS.cap, whiteSpace: 'nowrap' },
      // 头的状态灯：0.5 用 `.dpo-overlay-head::before` + `[data-state]` 换色（0.5:3337-3340）
      // 0.5 的三态：running=主色 / done=绿 / error=红（其余灰）—— 0.6 的阶段按同一语义落色。
      ovDot: (phase) => ({ flex: '0 0 auto', width: '7px', height: '7px', marginRight: '8px', borderRadius: '50%',
        background: phase === 'optimizing' ? OVS.acc
          : ((phase === 'review' || phase === 'sent' || phase === 'skipped') ? OVS.ok
            : ((phase === 'error' || phase === 'failed') ? OVS.dangerFg : OVS.cap)) }),
      // 46px 悬浮球（0.5:3533-3539 / 3636-3637）
      ball: (tone, sent) => ({ position: 'fixed', left: 0, top: 0, zIndex: 88, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px',
        width: '46px', height: '46px', borderRadius: '50%', cursor: 'grab', touchAction: 'none',
        color: '#fff', background: tone, boxShadow: '0 4px 14px rgba(0,0,0,.28)',
        opacity: sent ? .82 : 1, userSelect: 'none' }),
      ballIcon: { fontSize: '15px', lineHeight: 1, opacity: .95 },
      ballLabel: { fontSize: '9px', letterSpacing: '.5px', opacity: .9 },
    }
    const PROV_TEXT = { user: '你说过', machine: '机器补充', unsourced: '无出处' }

    function Options({ value, onChange, options, labels }) {
      return h('select', { style: S.select, value: value || '', onChange: (e) => onChange(e.target.value) },
        options.map((o) => h('option', { key: o, value: o }, labels ? labels[o] : o)))
    }

    /**
     * 分段控件：**可点 / 可拖 / ←→ 方向键 / Home / End**（档位四格与优化权限两格共用）。
     *
     * 两个容易踩的点，都写在这里免得下次重犯：
     *   · 拖动时"跨到另一格才发请求"（`pick` 里比对 value/last）——否则一次拖动会把同一档位
     *     反复写好几遍，而每次写盘都是"备份 + 临时文件 + rename + 读回校验"（宿主 settings.js）。
     *   · 键盘触发的 click（Enter/Space）`detail === 0` 且没有 clientX，照 clientX 算会**一律落到第 0 格**
     *     （对档位就是"关闭"）——那是危险的误操作，所以这种 click 一律不处理，交给 onKeyDown。
     */
    function Segmented({ name, value, options, label, disabled, title, onPick, failTick }) {
      const box = React.useRef(null)
      const last = React.useRef(null)
      const [dragging, setDragging] = React.useState(false)
      React.useEffect(() => { last.current = null }, [value, failTick])
      const pick = (k) => {
        if (!k || disabled || k === value || k === last.current) return
        last.current = k
        onPick(k)
      }
      const indexAt = (clientX) => {
        const el = box.current
        if (!el || typeof el.getBoundingClientRect !== 'function') return -1
        const r = el.getBoundingClientRect()
        if (!r || !r.width) return -1
        const i = Math.floor(((clientX - r.left) / r.width) * options.length)
        return Math.max(0, Math.min(options.length - 1, i))
      }
      const moveTo = (clientX) => { const i = indexAt(clientX); if (i >= 0) pick(options[i]) }
      const onKeyDown = (e) => {
        if (disabled) return
        const cur = Math.max(0, options.indexOf(value))
        let next = null
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = cur - 1
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = cur + 1
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = options.length - 1
        if (next === null) return
        e.preventDefault()
        pick(options[Math.max(0, Math.min(options.length - 1, next))])
      }
      return h('div', {
        ref: box, role: 'slider', tabIndex: disabled ? -1 : 0,
        'aria-label': name, 'aria-disabled': disabled ? 'true' : 'false',
        'data-po06': name, 'data-po06-value': value || 'none',
        'data-po06-disabled': disabled ? '1' : '0',
        title, style: { ...S.seg, ...(disabled ? S.dis : null), cursor: disabled ? 'not-allowed' : 'pointer' },
        onClick: (e) => {
          if (disabled) return
          if (!e || e.detail === 0 || typeof e.clientX !== 'number') return
          moveTo(e.clientX)
        },
        onPointerDown: (e) => {
          if (disabled) return
          setDragging(true)
          try { if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId != null) e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* 环境不支持就算了 */ }
          moveTo(e.clientX)
        },
        onPointerMove: (e) => { if (!disabled && dragging) moveTo(e.clientX) },
        onPointerUp: () => setDragging(false),
        onPointerCancel: () => setDragging(false),
        onPointerLeave: () => setDragging(false),
        onKeyDown,
      }, options.map((k) => h('span', {
        key: k, 'data-po06': name + '-' + k, 'data-po06-on': (k === value ? '1' : '0'),
        style: { ...S.segItem, ...(k === value ? S.segOn : null) },
      }, label ? label(k) : k)))
    }

    /**
     * 上下文回合数（0–10，契约见 settings.js 的 TURNS_MIN/TURNS_MAX）。
     *
     * **不**在每次 onChange 都写盘：原生 range 拖动时会连发几十次 input 事件，而每次写盘都是
     * "备份 + 临时文件 + rename + 读回校验"——那会留下几十个备份文件和一串无谓 IO。
     * 做法：本地先跟手（乐观显示），松手/失焦/停 400ms 才提交；**保存失败就退回真值**
     * （`failTick` 变化 ⇒ 丢掉草稿），不许让界面继续显示一个没写进去的数字。
     */
    function TurnsRange({ value, disabled, disabledTip, title, onCommit, failTick, mode }) {
      const [draft, setDraft] = React.useState(null)
      const shown = draft == null ? value : draft
      // 「全文」模式下只有**关 / 开**两格（用户 2026-09-21 要求；0.5 也是这个形态）：
      // 全文模式读的是"我手上保留的全部回合"，再给 0~10 的量程是**假的精度**——
      // 所以这里只暴露"读不读"，但**底层仍然用 `turns` 保存**（关=0，开=上次的正数值），
      // 切回「回合」模式时用户原来的量程不会被抹掉。
      const full = mode === 'full'
      const lastPos = React.useRef(value > 0 ? value : DEFAULT_TURNS)
      if (value > 0) lastPos.current = value
      const commit = (v) => {
        if (disabled) return                                    // 处理函数里也挡一道（见 ctx-mode 的注释）
        const n = Math.max(TURNS_MIN, Math.min(TURNS_MAX, Math.round(Number(v))))
        if (Number.isFinite(n) && n !== value) onCommit(n)
      }
      React.useEffect(() => { if (draft != null && draft === value) setDraft(null) }, [value, draft])
      React.useEffect(() => { setDraft(null) }, [failTick])
      React.useEffect(() => {
        if (draft == null) return undefined
        const t = window.setTimeout(() => { commit(draft) }, 400)
        return () => { window.clearTimeout(t) }
      }, [draft, value])
      if (full) {
        const on = shown > 0
        return h('input', {
          type: 'range', min: 0, max: 1, step: 1, value: on ? 1 : 0,
          'data-po06': 'ctx', 'data-po06-value': on ? 'on' : 'off', 'data-po06-mode': 'full',
          disabled: !!disabled, title: disabled ? disabledTip : title,
          'aria-label': 'context-full',
          style: { width: '86px', ...(disabled ? S.dis : null) },
          onChange: (e) => { if (disabled) return; setDraft(Number(e.target.value) ? lastPos.current : 0) },
          onPointerUp: () => { if (draft != null) commit(draft) },
          onKeyUp: () => { if (draft != null) commit(draft) },
          onBlur: () => { if (draft != null) commit(draft) },
        })
      }
      return h('input', {
        type: 'range', min: TURNS_MIN, max: TURNS_MAX, step: 1, value: shown,
        'data-po06': 'ctx', 'data-po06-value': String(shown), 'data-po06-mode': 'turns',
        disabled: !!disabled, title: disabled ? disabledTip : title,
        'aria-label': 'context-turns',
        style: { width: '86px', ...(disabled ? S.dis : null) },
        onChange: (e) => { if (disabled) return; setDraft(Math.max(TURNS_MIN, Math.min(TURNS_MAX, Math.round(Number(e.target.value))))) },
        onPointerUp: () => { if (draft != null) commit(draft) },
        onKeyUp: () => { if (draft != null) commit(draft) },
        onBlur: () => { if (draft != null) commit(draft) },
      })
    }

    // ── 控制表单（浮层与设置页共用）──────────────────────────────────
    const DETAIL_LABELS = { minimal: '最少补充', standard: '标准补充', detailed: '尽量补全' }
    const BUDGET_LABELS = { minimal: '只做必要的', standard: '标准', generous: '允许更多自主处理' }
    const ASSIST_LABELS = { off: '只记录、不补充', auto: '自动辅助' }

    function ControlForm({ status, refresh }) {
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const s = (status && status.settings) || {}
      const [catalog, setCatalog] = React.useState({ models: [], problems: [] })
      React.useEffect(() => {
        let live = true
        apiGet('/models').then((r) => { if (live) setCatalog(r) }, (e) => { if (live) setCatalog({ models: [], problems: [errorText(e)] }) })
        return () => { live = false }
      }, [])
      const routes = (catalog.models || []).slice()
      if (s.model && !routes.some((r) => r.provider === s.model.provider && r.model === s.model.model)) routes.push({ ...s.model, label: s.model.provider + ' / ' + s.model.model })
      const modelKey = (r) => JSON.stringify([r.provider, r.model])
      const modelLabels = { inherit: '跟随会话模型' }
      routes.forEach((r) => { modelLabels[modelKey(r)] = r.label })
      const save = async (patch) => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/settings', patch)
        setBusy(false)
        if (!r.ok) { setMsg({ kind: 'err', text: '保存失败：' + reasonText(r.reason || '未知原因') }); return }
        const probs = (r.problems || []).filter((x) => x.kind !== 'unknown-field')
        setMsg({ kind: probs.length ? 'warn' : 'ok',
          text: probs.length
            ? '已保存，但有 ' + probs.length + ' 项不认识的值，已按默认处理：' + probs.map((x) => x.key + '=' + JSON.stringify(x.got)).join('、')
            : '已保存' + (r.backup ? '（旧配置已备份）' : '') })
        if (refresh) refresh()
      }
      return h('div', { 'data-po06': 'controls' },
        h('div', { style: S.row },
          h('span', { style: S.label }, '辅助'),
          h(Options, { value: s.assist, options: ['off', 'auto'], labels: ASSIST_LABELS, onChange: (v) => save({ assist: v }) }),
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, '补充程度'),
          h(Options, { value: s.detail, options: ['minimal', 'standard', 'detailed'], labels: DETAIL_LABELS, onChange: (v) => save({ detail: v }) }),
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, '自主预算'),
          h(Options, { value: s.budget, options: ['minimal', 'standard', 'generous'], labels: BUDGET_LABELS, onChange: (v) => save({ budget: v }) }),
        ),
        h('div', { style: S.row },
          h('span', { style: S.label }, '解释层模型'),
          h(Options, {
            value: s.model ? modelKey(s.model) : 'inherit',
            options: ['inherit', ...routes.map(modelKey)], labels: modelLabels,
            onChange: (v) => { const r = routes.find((x) => modelKey(x) === v); save({ model: r ? { provider: r.provider, model: r.model } : null }) },
          }),
        ),
        (catalog.problems || []).length ? h('div', { style: S.muted }, '部分模型不可用：' + catalog.problems.join('；')) : null,
        busy ? h('div', { style: S.muted }, '保存中…') : null,
        msg ? h('div', { 'data-po06': 'msg', style: { ...S.muted, color: msg.kind === 'err' ? '#e66' : (msg.kind === 'warn' ? '#e0a83a' : '#39c07a') } }, msg.text) : null,
        h('div', { style: S.muted }, '改动下一轮生效；改提示词会让意图包缓存自动失效重算。'),
      )
    }

    function PromptEditor({ prompt, refresh }) {
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      React.useEffect(() => { if (prompt && typeof prompt.text === 'string') setText(prompt.text) }, [prompt && prompt.text])
      const save = async () => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/prompt', { text })
        setBusy(false)
        setMsg(r.ok ? { kind: 'ok', text: '提示词已保存（下一轮生效）' } : { kind: 'err', text: '保存失败：' + reasonText(r.reason) })
        if (r.ok && refresh) refresh()
      }
      const reset = async () => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/prompt', { reset: true })
        setBusy(false)
        setMsg(r.ok ? { kind: 'ok', text: '已恢复内置提示词' } : { kind: 'err', text: '恢复失败：' + reasonText(r.reason) })
        if (r.ok && refresh) refresh()
      }
      const undo = async () => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/prompt', { undo: true })
        setBusy(false)
        setMsg(r.ok ? { kind: 'ok', text: '已撤销上次提示词修改' } : { kind: 'err', text: '撤销失败：' + reasonText(r.reason) })
        if (r.ok && refresh) refresh()
      }
      const source = prompt ? (prompt.source === 'file' ? '自定义（文件覆盖）' : '内置默认') : '（读不到）'
      return h('div', { 'data-po06': 'prompt' },
        h('div', { style: S.muted }, '解释层提示词来源：' + source + '（共 ' + ((prompt && prompt.chars) || 0) + ' 字）'),
        h('textarea', { 'data-po06': 'prompt-text', style: S.ta, value: text, onChange: (e) => setText(e.target.value) }),
        h('div', { style: S.row },
          h('button', { style: S.btn, disabled: busy, onClick: save }, '保存提示词'),
          h('button', { style: S.btn, disabled: busy, onClick: reset }, '恢复内置'),
          h('button', { style: S.btn, disabled: busy, onClick: undo }, '撤销上次修改'),
          msg ? h('span', { style: { ...S.muted, color: msg.kind === 'err' ? '#e66' : '#39c07a' } }, msg.text) : null,
        ),
      )
    }

    // 注：原来这里有一块「它在替我做什么」（ItemsList，逐条列意图与出处）。
    // 用户 2026-09-21 明确要求删掉它（"拦截界面已经让人看见模型替我们做了什么"）——
    // **但"无出处条目"这条诚实信号不能跟着消失**：它挪进了拦截审查面板（见 intercept-unsourced 那一行），
    // 因为"机器自己编出来的要求"是最该被人看见的东西。宿主侧 `GET /state` 仍保留，脚本/测试照旧可用。
    function TurnsList({ turns }) {
      const list = (turns && turns.turns) || []
      if (list.length === 0) return h('div', { style: S.muted }, '还没有处理过任何一轮。')
      // 每一轮补齐"它在替我做什么"的事实（P10）：上下文读了多少、有没有派工具、包超没超预算。
      // ⚠ 缺值显示"未记录"，**不许拿 0 冒充"没发生"**——"这轮没读上下文"与"台账没这个字段"是两件事。
      const none = L('未记录', 'n/a')
      const bits = (t) => {
        const out = []
        if (t.packetBudget != null) {
          out.push(t.packetOverBudget === true
            ? L('超预算 ', 'over budget ') + (t.packetOverBy || 0) + L(' 字', ' chars')
            : L('预算内', 'within budget'))
        } else if (t.packetChars != null) out.push(none)
        if (t.historyChars != null) {
          out.push(L('上下文 ', 'ctx ') + t.historyChars + L(' 字', ' chars')
            + (t.historyTurnsRead != null ? L('/', '/') + t.historyTurnsRead + L(' 回合', ' turns') : ''))
        }
        if (t.toolsEnabled === true) out.push(L('工具 ', 'tools ') + (t.toolCalls || 0) + L(' 次', ' calls'))
        else if (t.toolsEnabled === false && t.toolsReason) out.push(L('未派工具：', 'no tools: ') + t.toolsReason)
        if (t.toolFallback) out.push(L('已回落', 'fell back'))
        return out
      }
      return h('div', { 'data-po06': 'turns' }, list.map((t, i) => h('div', { key: i, style: { margin: '3px 0' } },
        (t.at ? String(t.at).slice(11, 19) + ' ' : ''),
        t.ok ? '✅ ' : '⚠️ ',
        (t.outcome || '-'),
        t.packetChars != null ? ' ｜ 包 ' + t.packetChars + ' 字' : '',
        t.ms != null ? ' ｜ ' + (t.ms / 1000).toFixed(1) + 's' : '',
        t.model ? ' ｜ ' + t.model : '',
        t.reason ? ' ｜ ' + t.reason : '',
        bits(t).length ? h('div', { 'data-po06': 'turn-facts', style: { ...S.muted, paddingLeft: '14px' } }, bits(t).join(' ｜ ')) : null,
      )))
    }

    // ── 「?」帮助弹层（要求②，2026-09-21）────────────────────────────
    // 用户原话："增加'?'按钮,可以参考之前的'?'按钮中的内容,对0.6制作一个类似的文本"。
    // 两条纪律：
    //   · **正文只有一个真相来源**：包里的 `HELP-0.6.md`，由宿主的 `GET /help` 取出来（实现者注记已在宿主侧剥掉）；
    //     客户端**不内置一份**——内置一份就一定会和文档分叉。
    //   · 读不到就说读不到 + 给出路径（`source:"missing"` 或 `warning`），**不糊一段别的文案顶上**。
    function HelpBody({ text }) {
      const out = []
      String(text || '').split('\n').forEach((raw, i) => {
        const s = raw.replace(/\s+$/, '')
        if (!s.trim()) { out.push(h('div', { key: i, style: { height: '6px' } })); return }
        if (/^\|[\s:|-]+\|$/.test(s.trim())) return                    // 表格分隔行（|---|---|）不显示
        const clean = (x) => String(x).replace(/\*\*/g, '').replace(/`/g, '')
        if (/^##\s/.test(s)) { out.push(h('div', { key: i, style: S.helpH }, clean(s.replace(/^##\s+/, '')))); return }
        if (/^#\s/.test(s)) { out.push(h('div', { key: i, style: S.helpTitle }, clean(s.replace(/^#\s+/, '')))); return }
        if (/^>\s?/.test(s)) { out.push(h('div', { key: i, style: S.helpQuote }, clean(s.replace(/^>\s?/, '')))); return }
        if (s.trim().startsWith('|')) {
          const cells = s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => clean(c.trim()))
          out.push(h('div', { key: i, style: S.helpTr }, cells.map((c, j) => h('span', { key: j, style: S.helpTd }, c))))
          return
        }
        out.push(h('div', { key: i, style: S.helpP }, clean(s)))
      })
      return h('div', { 'data-po06': 'help-body' }, out)
    }

    // ── P11 · 拦截浮层：**照 0.5 的界面复刻**（用户 2026-09-21 原话：「当前拦截 UI 依然与 0.5 差距巨大…
    //    你完全可以直接把 0.5 的相关 UI 拿过来用，完全没必要重新自己制作」）──────────────────────────
    // 逐块来源（行号 = `po05-src/lib/client.js`，只列**真的搬了**的）：
    //   · 面板外壳 1930-1970：可拖的头 / 滚动体 / **底栏在滚动区之外（永不滚走）** / 右下角改尺寸把手
    //   · 头      1940-1945：标题 + 档位徽标 + 「本会话已拦截 N 次」+「W×H / ↘」提示
    //   · 状态行  1516-1522：`优化中…` / `已完成` / `失败` + 徽标（徽标内容见下面的"真相差异"）
    //   · 审查块  1562-1590：`以下内容将原样发给工作 AI（可直接编辑） · N 字` + 可编辑 textarea
    //   · 折叠    1487-1501 + 3449-3460 disclosure：`›` 箭头 + 标题 + 摘要，点了才展开（原文用它）
    //   · 底栏    1622-1687：五个变体 → 0.6 的四个阶段（review / sent / error / idle）
    //   · 错误行  1554-1558：`失败：` + 人话，完整原因挂 title（0.5 就是这么做的）
    //   · 悬浮球  1797-1835 + 3533-3539：46px、按档位着色、拖动移动、单击回看（只读）
    //   · 几何    1146-1185：位置/尺寸夹紧（最小 400×320、不出视口、窗口变化重新夹紧）
    // **与 0.5 的真相差异（逐条写在这里，不许糊弄）**：
    //   ① 0.5 状态行上的 `· 首字 {ms}ms`（首字延迟）、`上下文 N 回合 · M 字`（本轮读入的历史）、
    //      `Σ {tok} tok`（provider 上报用量）这三样，0.6 的 `POST /interpret` **一个都拿不到**
    //      （响应只有 packet/chars/ms/unsourced）⇒ **这三个徽标不显示**，换成真实拥有的：
    //      优化中的「已用 N 秒」、完成后的总耗时、包字数。宁可少显示，也不拿 0/估算顶上。
    //   ② 0.5 的 `‹ 回退`（1189 `rollbackYes`）= 停止优化 + **不发送** + 原文留在输入框；它靠
    //      `run.settled` 挡住还在飞的 SSE 回调（0.5:1694-1702 的注释就是这么写的）。0.6 的 `beginHold`
    //      回调**没有**这个标记 ⇒ 在"优化中"清 hold，在飞的响应回来照样会把消息放行（用户以为取消了、
    //      几十秒后消息却发出去 = 吞消息的反面，同样不可接受）。放行逻辑本轮不许动 ⇒
    //      **优化中不给回退**；审查态的 `‹ 回退` 落成"这一轮不注入优化包、按原文发出"——
    //      这在 0.6 里就是"回到原文"的真实含义（0.6 **从不改写用户的原话**，能回退的只有包）。
    //   ③ 0.5 的 `run/outcome/trace`（「成了/要返工」裁决、查证动作列表）在 0.6 没有对应物
    //      （0.6 没有 runId、也没有工具轨迹）⇒ 不搬；头里那颗**硬编码版本串**同样不搬
    //      （0.6 的版本来自 `/status.version`，显示在「详情」面板里，不做第二份真相）。

    const OV_MIN_W = 400
    const OV_MIN_H = 320
    const ovViewport = () => ({
      w: (typeof window !== 'undefined' && window.innerWidth) || 800,
      h: (typeof window !== 'undefined' && window.innerHeight) || 600,
    })
    /** 位置夹紧（0.5:1146-1151）：离视口边缘至少 8px。 */
    const clampOvPos = (x, y, el) => {
      const v = ovViewport()
      const w = (el && el.offsetWidth) || 460
      const h = (el && el.offsetHeight) || 320
      return {
        x: Math.min(Math.max(8, Math.round(x)), Math.max(8, v.w - w - 8)),
        y: Math.min(Math.max(8, Math.round(y)), Math.max(8, v.h - h - 8)),
      }
    }
    /** 尺寸夹紧（0.5:1154-1161）：不小于 400×320，也不超出视口。 */
    const clampOvSize = (w, h) => {
      const v = ovViewport()
      const out = {}
      if (w != null) out.w = Math.min(Math.max(OV_MIN_W, Math.round(w)), Math.max(OV_MIN_W, v.w - 16))
      if (h != null) out.h = Math.min(Math.max(OV_MIN_H, Math.round(h)), Math.max(OV_MIN_H, v.h - 16))
      return out
    }
    /** 面板默认落点（0.5:1922：贴右侧、离顶 96px）。 */
    const defaultOvPos = () => ({ x: Math.max(8, ovViewport().w - 480), y: 96 })
    /** 悬浮球默认落点（0.5:1449：右下角内侧）。 */
    const defaultBallPos = () => { const v = ovViewport(); return { x: Math.max(8, v.w - 76), y: Math.max(8, v.h - 160) } }

    /**
     * 折叠区块：照 0.5:1487-1501 的 `disclosure`（`›` 箭头 + 标题 + 摘要 + 展开体）。
     * 默认收起；但**思维层**要按 0.5 的时序"运行中展开、完成后收起" ⇒ 支持 `defaultOpen`。
     * ⚠ 只在**首次挂载**时用它；之后一律以用户点击为准（`defaultOpen` 变化不得把用户手动收起的面板再弹开）。
     */
    function OvFold(props) {
      const [open, setOpen] = React.useState(props.defaultOpen === true)
      const openedOnce = React.useRef(false)
      React.useEffect(() => {
        if (openedOnce.current) return
        openedOnce.current = true
        if (props.defaultOpen === true) setOpen(true)
      }, [props.defaultOpen])
      const mark = props.mark
      return h('div', { 'data-po06': 'intercept-fold-' + mark, 'data-open': open ? 'true' : 'false', style: S.ovFold },
        h('button', {
          type: 'button', 'data-po06': 'intercept-fold-head-' + mark, 'aria-expanded': open ? 'true' : 'false',
          style: S.ovFoldHead, onClick: () => setOpen((v) => !v),
        },
          h('span', { 'aria-hidden': 'true', style: { ...S.ovFoldCaret, transform: open ? 'rotate(90deg)' : 'none' } }, '›'),
          h('span', { style: S.ovFoldTitle }, props.title),
          props.summary ? h('span', { style: S.ovFoldSum }, props.summary) : null,
        ),
        open ? h('div', { 'data-po06': 'intercept-fold-body-' + mark, style: S.ovFoldText }, props.children) : null,
      )
    }

    /**
     * 46px 悬浮球（0.5:1797-1835）：拖动移动、单击回看（只读）。
     * 位置放**本地状态**而不是每次 move 回调父组件——父组件每秒（优化中的计时器）会重渲染，
     * 若位置只存在父级，拖动中会被弹回去。
     */
    function InterceptBall(props) {
      const ball = props.ball
      const tone = TIER_TONES[props.tier] || OVS.acc
      const ref = React.useRef(null)
      const offRef = React.useRef(null)
      const [pos, setPos] = React.useState(ball.pos || defaultBallPos())
      const posRef = React.useRef(pos)
      posRef.current = pos
      React.useEffect(() => () => { if (offRef.current) offRef.current() }, [])
      const working = ball.phase === 'optimizing'
      const label = working ? L('优化中', 'Working') : (ball.sent ? L('已发送', 'Sent') : L('结果', 'Result'))
      const icon = ball.sent ? '✓' : (working ? '◌' : '◍')
      return h('div', {
        ref, 'data-po06': 'intercept-ball', 'data-po06-sent': ball.sent ? '1' : '0',
        'data-po06-phase': ball.phase || '',
        role: 'button', tabIndex: 0,
        title: ball.sent
          ? L('优化结果已发送 · 点击回看（只读）', 'Result sent · click to review (read-only)')
          : L('优化结果 · 点击回看', 'Result · click to review'),
        style: { ...S.ball(tone, ball.sent), transform: 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)' },
        onPointerDown: (e) => {
          if (e.button !== 0) return
          const start = { x: e.clientX, y: e.clientY, bx: posRef.current.x, by: posRef.current.y }
          let moved = false
          const el = ref.current
          const move = (ev) => {
            const dx = ev.clientX - start.x; const dy = ev.clientY - start.y
            if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true     // 0.5:1813 的 6px 阈值：小于它算"点击"
            if (!moved) return
            const v = ovViewport()
            const next = { x: Math.max(8, Math.min(v.w - 56, start.bx + dx)), y: Math.max(8, Math.min(v.h - 56, start.by + dy)) }
            posRef.current = next
            if (el && el.style) el.style.transform = 'translate3d(' + next.x + 'px,' + next.y + 'px,0)'
          }
          const end = () => {
            window.removeEventListener('pointermove', move, true)
            window.removeEventListener('pointerup', end, true)
            window.removeEventListener('pointercancel', end, true)
            offRef.current = null
            if (!moved) props.onOpen()                                       // 0.5:1823 单击 = 展开回看
            else props.onMove(posRef.current)                                // 拖过 = 只记住位置
          }
          window.addEventListener('pointermove', move, true)
          window.addEventListener('pointerup', end, true)
          window.addEventListener('pointercancel', end, true)
          offRef.current = end
          e.preventDefault(); e.stopPropagation()
        },
      },
        h('span', { 'aria-hidden': 'true', style: S.ballIcon }, icon),
        h('span', { 'data-po06': 'intercept-ball-label', style: S.ballLabel }, label),
      )
    }

    /**
     * 拦截面板（0.5 的浮层本体）。所有**动作**都是外部传进来的既有处理函数
     * （confirmHold / sendOriginal / regenHold / skipHold / beginHold），这里只管画。
     */
    /**
     * 思维层正文：固定窗口 + **无滚动条**，新内容自动跟到底（0.5 思维区的观感）。
     * 为什么不用滚动条：用户明确要求去掉右侧那根滚轮；而这个窗口的用途是"看它此刻在想什么"，
     * 所以让最新几行始终可见才是对的——想回看完整内容，底部还有「原文」与（同一会话内的）台账。
     */
    function ThinkBody({ text }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const el = ref.current
        if (!el) return
        try { el.scrollTop = el.scrollHeight } catch { /* 跟不动也不影响阅读 */ }
      }, [text])
      return h('div', { ref, 'data-po06': 'intercept-think-body', style: S.ovFoldText }, text)
    }

    function InterceptPanel(props) {
      const prog = props.prog || null      // P11：宿主侧的实时进度（阶段 + 正在写的字）
      const hold = props.hold || {}
      const phase = props.phase
      const permission = props.permission
      const rootRef = React.useRef(null)
      const offRef = React.useRef(null)
      const [pos, setPos] = React.useState(() => props.pos || defaultOvPos())
      const [size, setSize] = React.useState(() => props.size || { w: null, h: null })
      const [dragging, setDragging] = React.useState(false)
      const [sizing, setSizing] = React.useState(false)
      const posRef = React.useRef(pos)
      const sizeRef = React.useRef(size)
      posRef.current = pos
      sizeRef.current = size

      // 卸载即净：拖动中卸载也要摘掉 window 上的监听（这是 0.6 的纪律）
      React.useEffect(() => () => { if (offRef.current) offRef.current() }, [])
      // 窗口尺寸变化 ⇒ 重新夹紧位置与尺寸（0.5:1785-1794 的 reflowOverlay）
      React.useEffect(() => {
        const onWinResize = () => {
          setPos((p) => clampOvPos(p.x, p.y, rootRef.current))
          setSize((s) => (s.w ? { ...s, ...clampOvSize(s.w, s.h) } : s))
        }
        window.addEventListener('resize', onWinResize)
        return () => window.removeEventListener('resize', onWinResize)
      }, [])

      /** 一次指针拖动：move 只写本地值（父组件的 1 秒 tick 重渲染不会把面板弹回去）。 */
      const beginPointer = (e, onMove, onDone) => {
        if (e.button !== 0) return
        const move = (ev) => onMove(ev)
        const end = () => {
          window.removeEventListener('pointermove', move, true)
          window.removeEventListener('pointerup', end, true)
          window.removeEventListener('pointercancel', end, true)
          offRef.current = null
          if (typeof onDone === 'function') onDone()
        }
        window.addEventListener('pointermove', move, true)
        window.addEventListener('pointerup', end, true)
        window.addEventListener('pointercancel', end, true)
        offRef.current = end
        try {
          const el = rootRef.current
          if (el && el.setPointerCapture && e.pointerId != null) el.setPointerCapture(e.pointerId)
        } catch (err) { /* 合成指针没有捕获 */ }
        e.preventDefault()
      }
      const onDragStart = (e) => {
        // 起点在按钮上就不启动拖动：preventDefault 会抑制兼容 click，导致「✕ / 底栏按钮」点不动（0.5:1850）
        if (e.target && e.target.closest && e.target.closest('button')) return
        const el = rootRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const d = { dx: e.clientX - r.left, dy: e.clientY - r.top }
        setDragging(true)
        beginPointer(e,
          (ev) => { const n = clampOvPos(ev.clientX - d.dx, ev.clientY - d.dy, el); posRef.current = n; setPos(n) },
          () => { setDragging(false); props.onMove(posRef.current) })
      }
      const onSizeDown = (e) => {
        if (e.button !== 0) return
        const el = rootRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const st = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }
        setSizing(true)
        beginPointer(e,
          (ev) => { const n = clampOvSize(st.w + (ev.clientX - st.x), st.h + (ev.clientY - st.y)); sizeRef.current = n; setSize(n) },
          () => { setSizing(false); props.onResize(sizeRef.current) })
      }

      // ── 内容 ────────────────────────────────────────────────────────
      // 本轮"注入的那份文本"：用户改过就是改后的，没改过就是解释层回的包。
      // ⚠ 这不等于用户的消息——用户的原话永远按原文发出（见审查块的说明）。
      const packet = String(hold.edited == null ? (hold.packet || '') : hold.edited)
      const editable = phase === 'review' && permission === 'review'
      const secs = Math.max(0, Math.round((Date.now() - (hold.t0 || Date.now())) / 1000))
      // 状态行文案（0.5:1509 的 label）：`优化中…` / `已完成` / `失败`
      const statusLabel = phase === 'optimizing' ? L('优化中…', 'Optimizing…')
        : (phase === 'review' || phase === 'sent') ? L('已完成', 'Done')
          : phase === 'skipped' ? L('已跳过', 'Skipped')
            : (phase === 'error' || phase === 'failed') ? L('失败', 'Failed') : L('待命', 'Idle')
      // 时间徽标：优化中给**已用秒数**（真实、每秒更新），完成后给**总耗时**（/interpret 回的 ms）。
      // 0.5 这里给的是"首字 ms"（流式才有），0.6 没有流式 ⇒ 不冒充（见上面的真相差异①）。
      const elapsedText = phase === 'optimizing'
        ? L('已用 ' + secs + ' 秒', secs + 's')
        : (hold.ms != null
          ? (hold.ms >= 1000 ? (hold.ms / 1000).toFixed(1) + 's' : hold.ms + 'ms')
          : '')
      const charsText = (hold.chars || packet) ? L('包 ' + (hold.chars || packet.length) + ' 字', 'packet ' + (hold.chars || packet.length) + ' chars') : ''

      // 底栏按钮的样式分层：primary（主操作）/ danger（重新生成）/ ghost（次要）/ 默认。
      // ⚠ 锚点写成**字面量对象**（而不是 `btn('intercept-x', …)` 那样拼字符串）：真机探针与静态
      //    守卫都按字面量 grep `'data-po06': 'intercept-…'`，拼出来的名字在源码里搜不到。
      const btn = (attrs, text, onClick, kind, tip) => h('button', {
        type: 'button', ...attrs, title: tip || undefined,
        style: { ...S.ovBtn, ...(kind === 'primary' ? S.ovBtnPrimary : (kind === 'danger' ? S.ovBtnDanger : (kind === 'ghost' ? S.ovBtnGhost : null))) },
        onClick,
      }, text)
      // ⚠ 子元素用**展开**而不是把数组当唯一子节点传：数组子节点在 React 里会被当成列表，
      //    开发模式下会报 "Each child in a list should have a unique key"（我们不需要 key，展开即可）。
      const footWrap = (name, kids) => h('div', { 'data-po06': 'intercept-foot', 'data-po06-foot': name, style: S.ovFoot },
        h('div', { 'data-po06': 'intercept-foot-inner', style: S.ovFootInner },
          h('div', { 'data-po06': 'intercept-actions', style: S.ovActions }, ...kids)))

      // 底栏变体（0.5:1622-1687 的五个 → 0.6 的四个阶段）。**关键：底栏在滚动区之外**。
      const footer = phase === 'review'
        // foot-review（0.5:1658-1674）：`‹ 回退` / `确认提交` / `重新生成`。
        // 0.6 的 `‹ 回退` = 不注入这一轮的包、按原文发出（= 既有处理函数 sendOriginal，见真相差异②）。
        ? footWrap('review', [
          btn({ 'data-po06': 'intercept-original' }, L('按原文发出', 'Send as-is'), props.onOriginal, 'ghost',
            L('这一轮不注入优化包，按你的原文发出（0.6 从不改写你的原话，能丢的只有包）',
              'Inject nothing this round and send your original text (0.6 never rewrites your words — only the packet can be dropped)')),
          btn({ 'data-po06': 'intercept-cancel' }, L('取消', 'Cancel'), props.onCancel, 'ghost',
            L('中止这一轮优化、什么都不发；草稿留在输入框里等你接着改（这才是 0.5 那颗「回退」干的事）',
              'Abort this round and send nothing; your draft stays in the box (this is what 0.5\u2019s \u2039Back\u203a really did)')),
          btn({ 'data-po06': 'intercept-confirm' }, L('确认提交', 'Confirm & send'), props.onConfirm, 'primary',
            L('把上面这份包作为本轮注入的内容，连同你的原文一起发出', 'Inject the packet above for this round, together with your original message')),
          btn({ 'data-po06': 'intercept-regen' }, L('重新生成', 'Regenerate'), props.onRegen, 'danger',
            L('用同一条原文重跑一次解释层', 'Run the explainer again on the same original text')),
          // 回退（用户 2026-09-21 明确要求："记得增加回退功能，这个在 0.5 里也有"）：
          // 包级回退是**真的**——宿主为每个会话留最近 10 版非空包，点了就把上一版放回来（正文随即刷新）。
          btn({ 'data-po06': 'intercept-rollback' }, L('回退上一版', 'Roll back'), props.onRollback, null,
            L('把上一版注入的包放回来（本会话最多可退 10 版；没有上一版时会如实告诉你）',
              'Restore the previous packet for this session (up to 10 versions; it will say so if there is none)')),
        ])
        // foot-sent（0.5:1650-1657）：放行之后只读回看 —— 关闭 / 重新生成
        : (phase === 'sent' || phase === 'skipped' || phase === 'failed')
          ? footWrap('sent', [
            h('span', { 'data-po06': 'intercept-sent-tag', style: S.ovSentTag },
              phase === 'sent' ? L('已发送 · 仅供查看', 'Sent · read-only')
                : phase === 'skipped' ? L('已跳过 · 按原文发出（仅供查看）', 'Skipped · sent as-is (read-only)')
                  : L('优化失败，已按原文发出 · 仅供查看', 'Optimizer failed; sent as-is (read-only)')),
            btn({ 'data-po06': 'intercept-close' }, L('关闭', 'Close'), props.onCloseSent, null,
              L('关掉浮层与悬浮球（结果不再回看）', 'Close the panel and the ball (no more review)')),
            btn({ 'data-po06': 'intercept-regen' }, L('重新生成', 'Regenerate'), props.onRegen, 'ghost',
              L('用同一条原文重跑一次解释层', 'Run the explainer again on the same original text')),
          ])
          // foot-error（0.5:1675-1681）：`重试` / `按原文发出`
          : phase === 'error'
            ? footWrap('error', [
              btn({ 'data-po06': 'intercept-retry' }, L('重试', 'Retry'), props.onRegen, null,
                L('重新跑一次解释层再放行（这条消息还没发出去）', 'Run the explainer again before releasing (this message was never sent)')),
              btn({ 'data-po06': 'intercept-original' }, L('按原文发出', 'Send as-is'), props.onOriginal, 'primary',
                L('不要这一轮的结果，直接按原文发出', 'Skip this round and send the original text')),
            ])
            // foot-idle（0.5:1683-1686）：优化中始终留一个出口 —— 0.6 就是既有的「跳过并直接发送」
            : footWrap('idle', [
              btn({ 'data-po06': 'intercept-skip' }, L('跳过并直接发送', 'Skip and send as-is'), props.onSkip, 'primary',
                L('不再等解释层，按原文发出', 'Do not wait for the explainer; send as-is')),
              btn({ 'data-po06': 'intercept-cancel' }, L('取消', 'Cancel'), props.onCancel, 'ghost',
                L('中止这一轮优化、什么都不发；草稿留在输入框里（0.5 的「回退」就是这个）',
                  'Abort this round and send nothing; the draft stays in the box (0.5\u2019s \u2039Back\u203a)')),
            ])

      return h('div', {
        ref: rootRef, 'data-po06': 'intercept', 'data-po06-phase': phase, 'data-po06-view': 'panel',
        'data-po06-drag': dragging ? '1' : '0', 'data-po06-size': sizing ? '1' : '0',
        style: {
          ...S.ov,
          transform: 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)',
          ...(size.w ? { width: size.w + 'px' } : null),
          height: size.h ? size.h + 'px' : 'auto',
          maxHeight: size.h ? 'none' : 'min(78vh,660px)',
          ...(dragging || sizing ? { userSelect: 'none' } : null),
        },
      },
        // 可拖的头（0.5:1940-1945）
        h('div', {
          'data-po06': 'intercept-head', style: S.ovHead, onPointerDown: onDragStart,
          title: L('按住拖动（右下角可改大小）', 'Drag to move (resize from the bottom-right corner)'),
        },
          h('span', { 'data-po06': 'intercept-state-dot', 'data-po06-value': phase, style: S.ovDot(phase) }),
          h('span', { 'data-po06': 'intercept-title', style: S.ovHeadTitle }, L('提示词优化', 'Prompt optimizer')),
          h('span', { 'data-po06': 'intercept-tier', style: S.ovHeadTier }, tierLabel(props.tier)),
          props.count > 0
            ? h('span', { 'data-po06': 'intercept-count', style: S.ovHeadCount, title: L('本会话累计拦截次数', 'Intercepts this session') },
              L('本会话已拦截 ' + props.count + ' 次', props.count + ' intercepted this session'))
            : null,
          h('span', { 'data-po06': 'intercept-head-hint', style: S.ovHeadHint },
            size.w ? (size.w + '×' + (size.h || L('自动', 'auto'))) : '↘'),
          // 收起为球（0.5 定义了 `.dpo-x` 的样式却在最终版里没接上；0.6 明确要求"关闭 → 收成球"）
          h('button', {
            type: 'button', 'data-po06': 'intercept-collapse', style: S.ovX,
            title: L('收起为悬浮球（结果还在，点球可回看）', 'Collapse into the floating ball (the result stays; click the ball to reopen)'),
            onClick: props.onCollapse,
          }, L('收起', 'Collapse')),
        ),
        // 滚动体（0.5:1946-1961）
        h('div', { 'data-po06': 'intercept-scroll', style: S.ovScrollY },
          h('div', { 'data-po06': 'intercept-run', style: S.ovRun },
            h('div', { 'data-po06': 'intercept-status', style: S.ovRunStatus },
              statusLabel,
              elapsedText ? h('span', { 'data-po06': 'intercept-elapsed', style: S.ovChipMuted }, elapsedText) : null,
              charsText ? h('span', { 'data-po06': 'intercept-chars', style: S.ovChip }, charsText) : null,
              // token 计数（0.5 的状态行有 `Σ {tok} tok`）：拿到就显示，拿不到显示"— tok"（不编 0）
              h('span', { 'data-po06': 'intercept-tokens', style: S.ovChipMuted, title: L('解释层这一轮的 token：输入 / 输出 / 缓存命中（provider 不上报的项显示 —，**不做估算**）', 'Explainer tokens this round: input / output / cache hits (items the provider does not report show —, never estimated)') },
                // 用户 2026-09-21：**不要估算**，要按真实上报区分 输入/输出/缓存命中。
                // 于是这里只显示 provider 真给的字段：`in 1234 · out 567 · cache 890 tok`；
                // 拿不到的项显示 `—`（不折算、不猜）。
                (prog && prog.usage && (prog.usage.in != null || prog.usage.out != null || prog.usage.cache != null || prog.usage.total != null))
                  ? 'Σ ' + L('入', 'in') + ' ' + fmtTok(prog.usage.in)
                    + ' · ' + L('出', 'out') + ' ' + fmtTok(prog.usage.out)
                    + ' · ' + L('缓存', 'cache') + ' ' + fmtTok(prog.usage.cache)
                    + ' tok'
                  : 'Σ — tok'),
              // 拦截来路（回车 / 按钮 / 重新生成）：原来那块手写面板上有，真机排障时要看（保留，不新增真相）
              h('span', { 'data-po06': 'intercept-via', style: S.ovChipMuted },
                hold.via === 'key' ? L('回车拦截', 'Enter')
                  : hold.via === 'click' ? L('按钮拦截', 'Click')
                    : L('重新生成', 'Regen')),
            ),
            // P11：如果这一轮走的是**兜底模型**（不是你会话的模型），必须说明——
            // 真机实测：随便挑清单第一条会挑到 flash，1 秒回一个"没有改动"，优化器就成了摆设。
            (hold.route && hold.route !== 'observed')
              ? h('div', { 'data-po06': 'intercept-route-warn', 'data-po06-value': hold.route, style: { ...S.ovHintQuiet, color: OVS.cap } },
                hold.route === 'host-default-first'
                  ? L('⚠ 这一轮用的是**兜底模型**（清单第一条，不是你会话的模型）——结果可能偏薄，建议在控件栏里把解释层模型固定一个',
                    '⚠ This round used a fallback model (first in the list, not your session\u2019s) — expect a thinner packet; consider pinning the explainer model in the bar')
                  : L('这一轮的模型路由来自' + (hold.route === 'session' ? '会话设置' : '宿主默认') + '（还没观测到你会话的模型）',
                    'This round\u2019s route came from ' + (hold.route === 'session' ? 'session settings' : 'host default') + ' (your session model was not observed yet)'))
              : null,
            // 诚实信号：机器自己补出来、且没有用户原话支撑的条目 = 缺陷，必须看得见（这块原来在
            // 已删掉的"它在替我做什么"里，挪到审查面板；测试仍钉着 intercept-unsourced）
            hold.unsourced > 0
              ? h('div', { 'data-po06': 'intercept-unsourced', style: { ...S.ovHintQuiet, color: OVS.dangerFg } },
                L('⚠ 这一轮有 ' + hold.unsourced + ' 条「无出处」条目（机器补的、没有你的原话支撑）——这是缺陷，请改掉或删掉',
                  '⚠ ' + hold.unsourced + ' unsourced item(s) this round (machine-added, not backed by your words) — this is a defect; edit or delete them'))
              : null,
            // ── 「思维层」（0.5 的**思考折叠**：运行中展开、完成后收起）─────────────
            // 0.5 的形状：状态行 → 思考折叠 → 产出 → 原文折叠 → 错误行。
            // ⚠ 用户 2026-09-21："思维层/产出层混乱，直接照搬 0.5"。此前我多塞了一个"等待页"，
            // 于是"阶段信息"和"思考正文"分成两块、外加产出层，三块混在一起。
            // 现在**回到 0.5 的单一思考折叠**：阶段 + 字数 + 流式正文都在这一块里；
            // 默认展开/收起跟随阶段（优化中展开、出结果后收起）——这就是 0.5 的"运行中展开、完成后收起"。
            (prog && (prog.reasoningChars || prog.textChars || prog.stage))
              ? h(OvFold, {
                mark: 'think',
                title: L('思维层', 'Thinking'),
                defaultOpen: phase === 'optimizing',
                summary: (prog.stage
                  ? (prog.stage === 'gate' ? L('判定启用状态', 'checking the enable gate')
                    : prog.stage === 'model' ? L('解析模型路由', 'resolving the model route')
                      : prog.stage === 'interpret' ? L('读上下文、准备解释', 'reading context')
                        : prog.stage === 'streaming' ? L('正在写这一轮的理解', 'writing this round\u2019s reading')
                          : prog.stage === 'done' ? L('已产出（正在编译包）', 'produced (compiling the packet)')
                            : prog.stage === 'noop' ? L('这一轮没有产出', 'nothing produced this round')
                              : prog.stage === 'failed' ? L('解释失败', 'interpretation failed')
                                : String(prog.stage))
                  : '')
                  + (prog.textChars ? ' ｜ ' + L('正文 ', 'text ') + prog.textChars + L(' 字', ' chars')
                    : prog.reasoningChars ? ' ｜ ' + L('思考 ', 'reasoning ') + prog.reasoningChars + L(' 字', ' chars') : ''),
              }, h(ThinkBody, { text: String(prog.reasoning || prog.text || '') || L('（还没有内容）', '(nothing yet)') }))
              : (phase === 'optimizing'
                // 还没开始产出：也要让人看到"它在做什么"（0.5 此时思考区是空的，但状态行在转）
                ? h(OvFold, {
                  mark: 'think', title: L('思维层', 'Thinking'), defaultOpen: true,
                  summary: L('等待解释层开始产出…', 'waiting for the explainer…'),
                }, L('已经拦下你的消息，正在准备这一轮的解释（不设超时，随时可以跳过或取消）',
                  'Your message is held; preparing this round\u2019s interpretation (no timeout — skip or cancel anytime)'))
                : null),
            // ── 「产出层」────────────────────────────────────────────────
            (phase === 'review' || packet)
              ? h('div', { 'data-po06': 'intercept-review', style: S.ovReview },
                // 「产出层」标题（用户 2026-09-21："两层要分明，照 0.5"）：
                // 思维层 = 它在想什么（上面那个折叠）；产出层 = 这一轮给出什么（从这行开始）。
                h('div', { 'data-po06': 'intercept-output-title', style: S.ovPaneTitle }, L('产出层', 'Output')),
                // 标题按阶段说**实话**（0.5 只有"将原样发给"一句，因为它的产出就是草稿本身）：
                //   审查 = 还没发（可编辑）；sent = 已经注入了；error = 放行失败，**根本没注入**。
                h('div', { 'data-po06': 'intercept-caption', style: S.ovPaneTitle },
                  phase === 'sent'
                    ? L('本轮注入给工作 AI 的内容 · ' + packet.length + ' 字',
                      'What this round injected for the working AI · ' + packet.length + ' chars')
                    : phase === 'error'
                      ? L('本轮解释层产出的包（放行失败，还没注入） · ' + packet.length + ' 字',
                        'Packet produced this round (release failed, never injected) · ' + packet.length + ' chars')
                      : L('以下内容将在本轮原样注入给工作 AI（可直接编辑） · ' + packet.length + ' 字',
                        'The following will be injected verbatim for the working AI this round (editable) · ' + packet.length + ' chars')),
                h('div', { style: S.ovHintQuiet },
                  L('你的原话不会被改写——它按原文发出；这里编辑的是「本轮要注入的包」。',
                    'Your own message is never rewritten — it goes out verbatim; what you edit here is the packet injected this round.')),
                editable
                  // 可编辑（0.5:1582-1588 的 textarea）：改完点「确认提交」就是本轮注入的内容
                  ? h('textarea', {
                    'data-po06': 'intercept-text', style: S.ovReviewText, value: packet, spellCheck: false,
                    onChange: props.onEdit,
                  })
                  // 只读视图（自动档 / 放行之后 / 优化失败）：0.5 的 `.dpo-pane-body`（pre-wrap）
                  : h('div', { 'data-po06': 'intercept-packet', style: { ...S.ovPane, maxHeight: '300px' } },
                    h('div', { style: S.ovPaneBody }, packet || L('（这一轮没有包）', '(no packet this round)'))),
              )
              : null,
            // 错误行（0.5:1554-1558）：`失败：` + 人话，完整原因挂 title
            hold.reason
              ? h('div', { 'data-po06': 'intercept-reason', style: S.ovError },
                h('span', { title: String(hold.reason) }, L('失败：', 'Failed: ') + reasonText(hold.reason)))
              : null,
          ),
          // 原文折叠（0.5:1957-1959 的 disclosure("original")）：0.6 **从不改写**原话 ⇒ 原文永远可查
          hold.text
            ? h(OvFold, {
              mark: 'original', title: L('原文', 'Original'),
              summary: String(hold.text).length + L(' 字', ' chars'),
            }, hold.text)
            : null,
        ),
        footer,
        // 右下角改尺寸把手（0.5:1966-1969）
        h('div', { 'data-po06': 'intercept-grip', style: S.ovGrip, onPointerDown: onSizeDown,
          title: L('拖动改大小（本次会话内记住）', 'Drag to resize (remembered for this session)') }),
      )
    }

    // ── P11 · 前置拦截（用户要的"第一轮发，第一轮就回"）──────────────────
    // 机制**逐条照抄 0.5**（行号见 `po06/P11-INTERCEPT-PLAN.md`，源 = 0.5.2 线 `lib/client.js`）：
    //   捕获阶段监听 Enter/click（0.5:3095/3121/3152）· 判据读**此刻编辑器里真实的字**（0.5:458-465）
    //   发送按钮 = 本地化 aria-label 白名单 + "卡片内最后一个按钮"兜底（0.5:483-515）
    //   `preventDefault + stopPropagation` 接管、`inputActions` 放行（0.5:1285）· 草稿被清则显式写回（0.5:1203）
    //   同一次发送可能同时命中 Enter 与 click ⇒ 去重（0.5:443-453）· 档位「关闭」⇒ 完全不拦（0.5:2316）
    //   fail-open：拿不到包就**按原文发出**（0.5 的 auto 档语义）
    // **唯一的新轮子**：0.5 的解释层在客户端、我们的在宿主 ⇒ 拦下后要 POST /interpret 让宿主先算。
    const SEND_KEYS = ['input.send', 'input.send.queue', 'input.send.steer']

    /** 从**我们自己渲染的节点**往上找输入卡片（不用产品类名/选择器）；找不到 = 不在会话页 ⇒ 一律放行。 */
    function composerCard(node) {
      let el = node
      while (el && el !== document.body) {
        if (el.querySelector && el.querySelector('[contenteditable="true"]')) return el
        el = el.parentElement
      }
      return null
    }
    function composerDraft(card) {
      const ed = card ? card.querySelector('[contenteditable="true"]') : null
      if (!ed) return ''
      const raw = (typeof ed.innerText === 'string' && ed.innerText.length > 0) ? ed.innerText : (ed.textContent || '')
      return String(raw).replace(/\u00a0/g, ' ')
    }
    const composerButtons = (card) => (card ? Array.from(card.querySelectorAll('button')) : [])
    const lastComposerButton = (card) => { const l = composerButtons(card); return l.length ? l[l.length - 1] : null }
    /**
     * 这次按键/点击是不是发生在**输入卡片里**。
     * 判据优先看**事件目标**（`target`）——它才是"这一次击键真正发生在哪"；
     * 只有拿不到 target 时才退回 `document.activeElement`（0.5 只用后者）。
     * 为什么改：真机探针实测（headless 窗口未获得焦点时 `document.activeElement` 恒为 body）
     * 会**永远判为"焦点不在输入区"⇒ 一次都拦不住**；而事件目标是客观事实，不受窗口焦点影响。
     * 副作用是更好的：设置页/重命名框里的 Enter 目标不在卡片里 ⇒ 照样交还官方。
     */
    function focusInComposer(card, target) {
      const a = (card && target && card.contains(target)) ? target : document.activeElement
      if (!card || !a || !card.contains(a)) return false
      if (a.closest && a.closest('button')) return false
      if (a.closest && a.closest('[data-po06="panel"], [data-po06="help-pop"], [data-po06="intercept"]')) return false
      return true
    }

    // ── ① 输入区左侧的控件栏（0.5 的操作形态）─────────────────────────
    // 为什么把"小胶囊"换成一排控件（用户实测反馈「不适应 0.6 的操控/检测模式」）：
    // 胶囊只回答"它在不在"，而人要的是**随手拨**——档位、权限、上下文、读不读项目文件、用哪个模型。
    //
    // 四条实现纪律：
    //   · **档位以宿主为准**：`/status.described.tier` 是宿主按 settings.js 的 TIER_PRESETS 推导的，
    //     客户端只在拿不到 described 时才用本地镜像兜底——不制造第二个真相来源。
    //   · **写操作只发改动的那一个字段**，档位发 `{tier}`（档位是糖，由宿主铺 assist/detail/budget）。
    //   · **readTools 三态**：第一次 `/status` 读到它之前**不发这个字段**——
    //     否则会把"文件里没写"变成"显式 false"，那是把"未设置"写成了"用户选过关"。
    //   · **保存后就重新拉 /status**（界面与后端一致），失败就在控件旁给一行短错误，不弹窗、不静默。
    function ControlBar(props) {
      // 宿主按**标准 props** 注入：`sessionId`（会话作用域）与 `inputActions`（放行通道，见 slots.d.ts:201-255）。
      // ⚠ `inputActions` 拿不到 ⇒ **绝不拦截**（拦下却没有放行通道 = 把用户的消息吞掉）。
      const { sessionId, inputActions } = props || {}
      const [status, refreshStatus] = useStatus()
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [failTick, setFailTick] = React.useState(0)
      const [helpOpen, setHelpOpen] = React.useState(false)
      // P11 拦截态：{text, via, t0, phase, packet, chars, ms, reason, edited}
      // ⚠ 用户实测（2026-09-21）：**切到别的会话再回来，拦截面板就没了**。
      // 原因：控件栏是 per-session 挂载的，切会话会重挂 ⇒ 组件内的 hold 归零。
      // 而"消息还被我拦着"这件事**必须跨会话切换活下来** ⇒ hold 同时写一份到 window 上，
      // 重挂时按 sessionId 取回（只认同一会话，绝不把 A 会话的拦截态显示到 B 会话）。
      const [hold, _setHold] = React.useState(() => {
        try { return (window.__PO06_HOLD__ || {})[sessionId] || null } catch { return null }
      })
      const setHold = React.useCallback((v) => {
        _setHold(v)
        try {
          const b = window.__PO06_HOLD__ || (window.__PO06_HOLD__ = {})
          if (v && sessionId) b[sessionId] = v
          else if (sessionId) delete b[sessionId]
        } catch { /* 桥只是保险，失败不影响本轮 */ }
      }, [sessionId])
      const [tick, setTick] = React.useState(0)        // 只用于"已用 N 秒"重新渲染
      const [interceptCount, setInterceptCount] = React.useState(0)   // 本会话拦截次数（0.5 也有这个计数）
      const [prog, setProg] = React.useState(null)                    // P11：解释进度（阶段 + 流式正文尾部）
      // P11 浮层的**呈现状态**（0.5 把这两态放在 store.overlay / store.ball；0.6 不引入全局 store，
      // 用组件状态即可，但语义照抄：面板 = 拦截现场，球 = 放行之后仍可回看的那一份）。
      const [ovOpen, setOvOpen] = React.useState(false)
      const [ovGeom, setOvGeom] = React.useState({ pos: null, size: { w: null, h: null } })
      const [ovBall, setOvBall] = React.useState(null)  // {visible, pos, sent, phase}
      const [ovLast, setOvLast] = React.useState(null)  // 最近一次**已终结**的拦截（0.5 球里存的那份 run）
      const ovLastRef = React.useRef(null)
      const rootRef = React.useRef(null)
      const holdRef = React.useRef(null)               // 去重要用 ref（同一个事件循环里 state 还没生效）
      // P11：**在飞请求的世代号**。跳过 / 取消 / 重新生成都会推进它，
      // 于是"已经作废的那次解释"回来时写不进界面（真机缺陷：跳过之后过一会儿又弹出优化结果）。
      const holdSeq = React.useRef(0)
      const abortRef = React.useRef(null)
      const canArmRef = React.useRef(false)
      const [catalog, reloadCatalog] = useOnce(React.useCallback(() => apiGet('/models'), []))
      // 只在打开时才去读帮助（关着的时候不发请求）
      const [help] = useOnce(React.useCallback(() => (helpOpen ? apiGet('/help') : Promise.resolve(null)), [helpOpen]))

      const data = status.data
      const s = (data && data.settings) || {}
      const d = (data && data.described) || null
      const tier = (d && typeof d.tier === 'string') ? d.tier : tierOfSettings(s)
      const tierOff = tier === 'off'
      const permission = s.permission === 'review' ? 'review' : 'auto'
      const historyMode = s.historyMode === 'full' ? 'full' : 'turns'
      const turns = Number.isInteger(s.turns) ? s.turns : DEFAULT_TURNS
      const rtKnown = !!(data && (hasOwn(s, 'readTools') || hasOwn(d, 'readTools')))
      const readTools = rtKnown ? !!(hasOwn(s, 'readTools') ? s.readTools : d.readTools) : false

      const save = async (patch) => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/settings', patch)      // apiPost 保证不抛：网络失败也是 {ok:false,reason}
        setBusy(false)
        if (!r || r.ok !== true) {
          setMsg({ kind: 'err', text: L('保存失败：', 'Save failed: ') + reasonText(r && r.reason) })
          setFailTick((t) => t + 1)                     // 让乐观显示的控件退回真值
          refreshStatus()
          return
        }
        const probs = (r.problems || []).filter((x) => x.kind !== 'unknown-field')
        setMsg(probs.length
          ? { kind: 'warn', text: L('已保存，但有 ' + probs.length + ' 项被按默认处理', 'Saved, but ' + probs.length + ' value(s) fell back to defaults') }
          : { kind: 'ok', text: L('已保存', 'Saved') })
        refreshStatus()                                 // 成功后重新拉一次，界面与后端一致
      }

      // ── P11 前置拦截的运行时（放行 / 失败兜底 / 去重）──────────────────
      // 三条不变量：
      //   ① **拦下就一定要放行**（成功、失败、被跳过、用户点"按原文发出"都算）——绝不让消息凭空消失；
      //   ② **拿不到 `inputActions` 就绝不拦截**（`canArm` 为 false 时监听器根本不挂）；
      //   ③ 同一次发送可能同时命中 Enter 与 click（0.5 的 `coalesced`）⇒ 用 ref 去重，不能靠 state。
      const permissionRef = React.useRef(permission)
      permissionRef.current = permission
      const canArm = !!(inputActions && typeof inputActions.submit === 'function' && sessionId)
      canArmRef.current = canArm

      const clearHoldSoon = () => { window.setTimeout(() => { holdRef.current = null; setHold(null) }, 1600) }
      /** 放行：**先把拦下的那条原话写回草稿**，再交给宿主的 submit。
       *  为什么"总是写一遍"（而不是仅在 DOM 与状态不一致时）：拦下的字是从 **DOM** 读的，
       *  而 submit 发的是**宿主状态**里的草稿——两者可能不同步（真机探针实测：headless 下
       *  `execCommand` 不生效、DOM 有字而状态没有）。放行的必须是**用户按下发送时的那一条**，
       *  所以这里无条件对齐一次（草稿本来就一样时，写回是幂等的）。 */
      const releaseHold = (text, h, mark) => {
        try {
          if (typeof inputActions.setDraft === 'function') inputActions.setDraft(text)
          inputActions.submit()
          setHold({ ...(h || {}), phase: mark || 'sent' })
          clearHoldSoon()
        } catch (e) {
          // 连放行都失败 ⇒ 必须说出来（用户至少知道消息没发出去，可以手动再按一次）
          setHold({ ...(h || {}), phase: 'error', reason: '放行失败：' + String((e && e.message) || e) })
        }
      }
      /**
       * 失败时的收场（用户 2026-09-21 报的缺陷："即使处在审查模式，拦截后仍会在几秒后自动把原文发送出去"）。
       *
       * 两条路径必须分开：
       *   · **自动**：fail-open —— 按原文发出（0.5 auto 档的语义），并把原因留在面板上；
       *   · **审查**：**绝不自动发送**。把失败原因摆在面板里，由用户自己点「按原文发出」或「重试」。
       *     消息不会丢：草稿仍在输入框里（我们从头到尾没动它），面板就在旁边。
       */
      const settleFailure = (text, h, why) => {
        if (permissionRef.current === 'review') {
          const failed = { ...h, phase: 'error', reason: why }
          holdRef.current = failed; setHold(failed)          // 面板停在 error 态：重试 / 按原文发出
          return
        }
        releaseHold(text, { ...h, reason: why }, 'sent')
      }

      const beginHold = (text, via) => {
        if (holdRef.current) return                        // 去重：同一次发送的第二条事件直接忽略
        // 拦截计数**放在去重之后**：同一次发送可能同时命中 Enter 与 click（0.5 也要处理这件事，
        // 见 0.5:443-453 的 `coalesced`）。放在事件处理函数里会让同一次发送**记两次**，
        // "本会话已拦截 N 次"就变成了一个虚高的数字——界面上的数字不允许这样。
        setInterceptCount((n) => n + 1)
        const my = ++holdSeq.current                        // 这一轮的世代号
        try { if (abortRef.current) abortRef.current.abort() } catch { /* 上一轮先断掉 */ }
        const ac = (typeof AbortController === 'function') ? new AbortController() : null
        abortRef.current = ac
        const h = { text, via, t0: Date.now(), phase: 'optimizing', packet: '', chars: 0, ms: null, reason: null }
        holdRef.current = h; setHold(h)
        apiPost('/interpret', { sessionId, text }, ac ? { signal: ac.signal } : undefined).then((r) => {
          if (my !== holdSeq.current) return                // ⚠ 过期世代：这一轮已被跳过/取消/重跑 ⇒ 结果丢弃
          if (!r || r.ok !== true) {
            settleFailure(text, h, reasonText((r && r.reason) || 'unknown'))
            return
          }
          const done = { ...h, phase: 'review', packet: r.packet || '', chars: r.chars || 0, ms: r.ms || null, unsourced: r.unsourced == null ? null : r.unsourced, route: r.route || null, edited: r.packet || '' }
          holdRef.current = done; setHold(done)
          // 「自动」= 完成即发；「审查」= 等用户确认（0.5 §5 的权限语义）
          if (permissionRef.current !== 'review') releaseHold(text, done, 'sent')
        }, (e) => {
          if (my !== holdSeq.current) return
          settleFailure(text, h, reasonText((e && e.message) || e))
        })
      }

      /**
       * 「取消」（0.5 那颗 `‹ 回退` 真正干的事，用户 2026-09-21 指出我误解了它）：
       * **中止这一轮优化、什么都不发**，草稿留在输入框里等用户接着改。
       * 与「跳过并直接发送」的区别：跳过是"发，但不带包"；取消是"不发"。
       */
      const cancelHold = () => {
        holdSeq.current += 1                                  // 让在飞的那次结果作废
        try { if (abortRef.current) abortRef.current.abort() } catch { /* 断不掉也要作废世代 */ }
        abortRef.current = null
        holdRef.current = null
        setHold(null)
        // 用户 2026-09-21 更正（我第一次改过头了）：取消**不要清空用户输入的原话**——
        // 他说的"不要留草稿"指的是**拦截态与那个隐藏弹窗的残留**，不是把用户打的字擦掉。
        // 所以这里只清拦截残留（hold / 在飞请求 / window 桥），输入框原样保留。
        try { const b = window.__PO06_HOLD__ || {}; if (sessionId) delete b[sessionId] } catch { /* 桥只是保险 */ }
        setMsg({ kind: 'warn', text: L('已取消这一轮优化：消息没有发出，你输入的原话仍在输入框里', 'Cancelled: nothing was sent; your text is still in the box') })
      }
      /** 回退（用户 2026-09-21 要求）：把上一版注入的包放回来，并把新正文读回界面。
       *  没有历史时**如实说没有**（不假装成功）；回退本身由宿主记账（`trigger:'packet-rollback'`）。 */
      const rollbackHold = async () => {
        const h = holdRef.current || hold
        const r = await apiPost('/rollback', { kind: 'packet', sessionId })
        if (!r || r.ok !== true) {
          setHold({ ...(h || {}), reason: L('回退失败：', 'Rollback failed: ') + reasonText(r && r.reason) })
          return
        }
        let text = ''
        try {
          const g = await apiGet('/packet?session=' + encodeURIComponent(sessionId))
          if (g && typeof g.packet === 'string') text = g.packet
        } catch { /* 读不回来就保持原正文，并在下面说明 */ }
        const next = {
          ...(h || {}), packet: text, edited: text, chars: text.length,
          reason: L('已回退到上一版包（还剩 ' + (r.remaining == null ? '?' : r.remaining) + ' 版可退）',
            'Rolled back to the previous packet (' + (r.remaining == null ? '?' : r.remaining) + ' more available)'),
        }
        holdRef.current = next; setHold(next)
      }

      const skipHold = () => {
        const h = holdRef.current || hold || {}
        if (!h.text) { holdRef.current = null; setHold(null); return }
        holdSeq.current += 1                                 // ⚠ 跳过之后，在飞的那次解释结果必须作废
        try { if (abortRef.current) abortRef.current.abort() } catch { /* 同上 */ }
        abortRef.current = null
        releaseHold(h.text, { ...h, phase: 'sent' }, 'skipped')
      }
      /** 审查确认：用户改过正文 ⇒ 先把改动写进"本轮注入的包"，再放行。 */
      const confirmHold = async () => {
        const h = holdRef.current || hold
        if (!h) return
        const edited = String(h.edited == null ? h.packet : h.edited)
        if (edited !== h.packet) {
          const r = await apiPost('/packet', { sessionId, text: edited })
          if (!r || r.ok !== true) {
            setHold({ ...h, phase: 'review', reason: L('改动没写进去：', 'Edit not applied: ') + reasonText(r && r.reason) })
            return
          }
        }
        releaseHold(h.text, { ...h, phase: 'sent' }, 'sent')
      }
      /** 「按原文发出」：清掉本轮包，再原样放行（用户明确不要这次的结果）。 */
      const sendOriginal = async () => {
        const h = holdRef.current || hold
        if (!h) return
        await apiPost('/packet', { sessionId, text: '' })
        releaseHold(h.text, { ...h, phase: 'sent' }, 'sent')
      }
      const regenHold = () => {
        const h = holdRef.current || hold
        if (!h) return
        holdRef.current = null
        beginHold(h.text, 'regen')
      }

      // ── P11 浮层的两条时序（**只读 hold，绝不改拦截状态机**）────────────
      // ① 终结即留档：0.6 的 releaseHold 会在 1.6s 后把 hold 清空（clearHoldSoon），
      //    而 0.5 的结果在放行之后仍能在球里回看（foot-sent 的「已发送 · 仅供查看」）⇒ 自己留一份快照。
      React.useEffect(() => {
        if (!hold) return
        const done = hold.phase === 'sent' || hold.phase === 'skipped' || hold.phase === 'error' || hold.phase === 'failed'
        if (!done) return
        ovLastRef.current = hold
        setOvLast(hold)
      }, [hold])

      // ② 面板可见性 / 收成球，与 0.5 的两条时序一致：
      //    · 拦截开始、或进入需要人决策的阶段（审查 / 放行失败）⇒ 面板必须在
      //      （否则用户的消息被拦着、却没有任何界面可以把它放出去 = 吞消息）
      //    · hold 被清空（= 放行后 1.6s）⇒ 收成 46px 悬浮球（0.5:1287「发送后收成悬浮球」）
      React.useEffect(() => {
        if (hold) {
          setOvOpen(true)
          setOvBall((b) => (b && b.visible ? { ...b, visible: false } : b))
          return
        }
        const h = ovLastRef.current
        if (h && (h.phase === 'sent' || h.phase === 'skipped')) {
          setOvBall((b) => ({ visible: true, pos: (b && b.pos) || defaultBallPos(), sent: h.phase === 'sent', phase: h.phase }))
          setOvOpen(false)
        }
      }, [hold])

      /** 「重新生成」：活的 hold 交给既有 regenHold；已经终结（hold 已被清）的那份用既有 beginHold 重跑。 */
      const doRegen = () => {
        if (hold) { regenHold(); return }
        const h = ovLastRef.current
        if (h && h.text) beginHold(h.text, 'regen')
      }
      /** 收起为球（0.5:1473-1478 collapseToBall）。⚠ 与 0.5 有意不同的一处：0.5 在"没有产出"时
       *  连球都不留；这里只要**还有一次拦截挂着**就留球（优化中收起也有球，标着"优化中"），
       *  否则用户收起后就再也看不见"消息还被拦着"这件事（那是吞消息的隐患）。 */
      const collapseToBall = () => {
        const h = hold || ovLastRef.current
        setOvOpen(false)
        if (!h) { setOvBall(null); return }
        setOvBall((b) => ({
          visible: true, pos: (b && b.pos) || defaultBallPos(),
          sent: h.phase === 'sent' || h.phase === 'skipped', phase: h.phase,
        }))
      }
      /** 点球展开（0.5:1461-1472 reopenFromBall）：把那一份放回浮层，已发送态为只读。 */
      const reopenFromBall = () => {
        setOvOpen(true)
        setOvBall((b) => (b ? { ...b, visible: false } : b))
      }
      /** foot-sent 的「关闭」（0.5:1653 close-sent）：浮层与球一起收掉。 */
      const closeSent = () => { setOvOpen(false); setOvBall(null) }

      // 重挂（切会话来回）后把 holdRef 也接回桥上的那一份——否则界面显示了面板，逻辑却以为"没在拦"
      React.useEffect(() => {
        try {
          const saved = (window.__PO06_HOLD__ || {})[sessionId] || null
          if (saved && !holdRef.current) holdRef.current = saved
        } catch { /* 同上 */ }
      }, [sessionId])

      // 计时器：只在"优化中"时走（用户要看得见已经等了多久，因为**不设超时**）
      React.useEffect(() => {
        if (!hold || hold.phase !== 'optimizing') return undefined
        const t = window.setInterval(() => setTick((n) => n + 1), 1000)
        return () => window.clearInterval(t)
      }, [hold])

      // P11：**思考过程**也看得见（用户 2026-09-21："拦截之后看不到任何思考过程"）。
      // 解释层是宿主的模型调用，它的流式正文落在宿主的进度面里 ⇒ 这里轮询读回来，
      // 显示"阶段 + 正在写的字"。轮询只在优化中跑，结束即停（不打扰、不常驻）。
      React.useEffect(() => {
        // ⚠ 只在"优化中"轮询，但**不因为阶段变了就把快照清空**——否则解释一完成，
        // `Σ N tok` 与最后的思考内容会立刻消失（用户实测"token 还不会统计"的一部分原因就在这里）。
        // ⚠ 轮询要**持续到这一轮真正结束**（而不是"只有优化中"）：token/包字数是在解释**完成时**
        // 才写进进度面的；只在优化中轮询 ⇒ 最后那次写入永远拉不到，界面停在旧值
        // （用户实测"产出后 token 不变"）。现在只要还挂着这一轮就继续拉，面板收起才停。
        if (!hold || !sessionId) { setProg(null); return undefined }
        let alive = true
        const pull = () => {
          apiGet('/interpret-progress?session=' + encodeURIComponent(sessionId)).then((p) => {
            if (alive) setProg(p && p.active ? p : null)
          }, () => { /* 进度读不到不影响拦截本身 */ })
        }
        pull()
        // 25ms：用户 2026-09-21 明确要求（"直接变成25ms吧，消耗不了多少性能"）。
        // 本地回环 + 负载很小（尾部 1200 字），换来的是思维链看起来像在连续打字。
        const t = window.setInterval(pull, 25)
        return () => { alive = false; window.clearInterval(t) }
      }, [hold, sessionId])

      // 拦截监听：**捕获阶段挂在 window 上**（早于 React 根容器与编辑器自身处理器；0.5:3095）
      React.useEffect(() => {
        if (!canArm || tierOff || !data) return undefined       // 关闭档 / 状态未知 / 没有放行通道 ⇒ 完全不拦
        const sendLabels = new Set()
        const stopLabels = new Set()
        // 诊断：**监听器到底挂上没有 / 判定卡在哪一条**，都必须在真机上看得见。
        // 第一版只写了"拦截计数"，于是真机上次秒发现"消息照发、计数还是 0"却无从判断是哪一环——
        // 这里把"看见了几个事件"和"最后一次为什么放行"都暴露成标记（有事件而计数不动 = 判定问题，
        // 连事件都没有 = 监听器没挂上，两者的修法完全不同）。
        let seen = 0
        const markSeen = (why) => {
          seen += 1
          try {
            const el = rootRef.current
            if (el && el.setAttribute) { el.setAttribute('data-po06-seen', String(seen)); el.setAttribute('data-po06-lastpass', why) }
          } catch { /* 诊断不影响主流程 */ }
        }
        const loadLabels = () => {
          try {
            const bind = typeof LOCALE_BIND === 'function' ? LOCALE_BIND('conversation') : null
            if (!bind) return
            for (const k of SEND_KEYS) { const v = bind(k); if (typeof v === 'string' && v && v !== k) sendLabels.add(v) }
            const stop = bind('input.stop'); if (typeof stop === 'string' && stop && stop !== 'input.stop') stopLabels.add(stop)
          } catch { /* 字典不可用 ⇒ 点击路径走结构兜底 */ }
        }
        loadLabels()
        const draftNow = () => composerDraft(composerCard(rootRef.current)).trim()
        const wantKey = (e) => {
          if (!isActiveInstance()) return 'stale-instance'
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return 'not-plain-enter'
          if (e.isComposing === true || e.keyCode === 229) return 'composing'
          const card = composerCard(rootRef.current)
          if (!card) return 'no-card'
          if (!focusInComposer(card, e.target)) return 'focus-outside'
          const t = draftNow()
          if (!t) return 'empty-draft'
          if (t.startsWith('/')) return 'slash-command'          // 命令（/xxx）交还官方
          return null
        }
        const wantClick = (btn) => {
          if (!isActiveInstance()) return 'stale-instance'
          if (!btn) return 'no-button'
          if (btn.closest && btn.closest('[data-po06]')) return 'our-own-button'   // 我们自己的按钮永不吞
          const card = composerCard(rootRef.current)
          if (!card) return 'no-card'
          if (!card.contains(btn)) return 'button-outside-card'
          if (!draftNow()) return 'empty-draft'                                    // 空草稿时主按钮是"停止生成"，绝不能吞
          const label = btn.getAttribute('aria-label')
          if (label && stopLabels.has(label)) return 'stop-button'
          return ((label && sendLabels.has(label)) || lastComposerButton(card) === btn) ? null : 'not-send-button'
        }
        const onKey = (e) => {
          const why = wantKey(e)
          if (why) { markSeen('key:' + why); return }
          e.preventDefault(); e.stopPropagation()
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
          markSeen('key:intercepted')
          // 计数在 beginHold 里、去重之后加（同一次发送可能同时命中 Enter 与 click，见那里的注释）
          beginHold(draftNow(), 'key')
        }
        const onClick = (e) => {
          const btn = e.target && e.target.closest ? e.target.closest('button') : null
          const why = wantClick(btn)
          if (why) { markSeen('click:' + why); return }
          e.preventDefault(); e.stopPropagation()
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
          markSeen('click:intercepted')
          beginHold(draftNow(), 'click')
        }
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('click', onClick, true)
        return () => {
          window.removeEventListener('keydown', onKey, true)
          window.removeEventListener('click', onClick, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [canArm, tierOff, !!data, sessionId])

      // ── ② 模型清单（可能 35+ 项 ⇒ 用 <select>，**不要**平铺成一排按钮）
      const cat = (catalog.data && typeof catalog.data === 'object') ? catalog.data : {}
      const routes = Array.isArray(cat.models) ? cat.models.slice() : []
      const mkey = (r) => JSON.stringify([r.provider, r.model])
      const curKey = (s.model && typeof s.model === 'object') ? mkey(s.model) : 'inherit'
      if (s.model && typeof s.model === 'object' && !routes.some((r) => mkey(r) === curKey)) {
        // 当前值不在清单里也要显示出来，否则 select 会显示成第一项——那是界面在撒谎
        routes.push({ provider: s.model.provider, model: s.model.model, label: s.model.provider + ' / ' + s.model.model })
      }
      const groups = []
      for (const r of routes) {
        let g = groups.find((x) => x.provider === r.provider)
        if (!g) { g = { provider: r.provider, items: [] }; groups.push(g) }
        g.items.push(r)
      }
      const modelProblems = Array.isArray(cat.problems) ? cat.problems : []

      // 单例闸门：不是当前实例就什么都不渲染（HMR 后旧实例必须闭嘴）。
      const active = isActiveInstance()
      if (!active) return null

      const on = !!(data && data.enabled && s.assist !== 'off')
      const last = null
      // P11 浮层要显示的那一份：`ovOpen` 是唯一的开关（0.5 的 `store.overlay.open`）。
      // ⚠ 不能写成 `hold || …`——那样"收起为球"在优化中根本收不起来（hold 还活着，面板又冒出来）。
      // 展开由两条时序负责（见下面的 effect ②）：拦截开始/需要人决策 ⇒ 自动展开；
      // hold 被清掉之后面板还开着 ⇒ 显示最后那份快照（只读回看，0.5 的球展开就是这个语义）。
      const shown = ovOpen ? (hold || ovLast) : null
      const statusLabel = !data ? L('0.6 ?', '0.6 ?')
        : (data.enabled ? (on ? L('0.6 自动', '0.6 auto') : L('0.6 只记录', '0.6 record')) : L('0.6 未启用', '0.6 off'))
      const offTip = L('档位为「关闭」时不生效', 'Has no effect while the tier is Off')

      return h(React.Fragment, null,
        // 控件栏分两层：第一行放"设定类"，第二行放"范围类"。
        // 外层靠上对齐（**不要**用 alignSelf:'flex-end'，那会被输入区的发送按钮顶上去、底部留空）。
        h('div', { 'data-po06': 'bar', ref: rootRef,
          // 拦截能不能武装，取决于宿主有没有给 `inputActions`——把它做成**真机可读的标记**，
          // 免得"以为在拦、其实没拦"（本项目的头号失败形态）。
          'data-po06-actions': canArm ? '1' : '0',
          'data-po06-intercepts': String(interceptCount),
          style: { ...S.bar, flexDirection: 'column', gap: '4px', alignItems: 'flex-start' } },
          // ── 第一行「设定类」：档位 / 优化权限 / 模型 ──────────────────────
          h('div', { 'data-po06': 'bar-row-1', style: S.barRow },
            // ① 档位：四格分段，可点 / 可拖 / ←→ / Home / End
            h(Segmented, {
              name: 'tier', value: tier, options: TIER_KEYS, label: (k) => tierLabel(k), failTick,
              title: L('优化档位：关闭 / 轻度 / 标准 / 重度 —— 点击、按住拖动、或按 ←→ 方向键（Home/End 到两端）',
                'Optimizer tier: Off / Low / High / Ultra — click, drag, or press the ←→ arrow keys (Home/End for the ends)'),
              onPick: (v) => save({ tier: v }),
            }),
            // ② 优化权限：档位 off 时禁用
            h(Segmented, {
              name: 'perm', value: permission, options: ['review', 'auto'],
              label: (k) => (k === 'review' ? L('审查', 'Review') : L('自动', 'Auto')),
              disabled: tierOff, failTick,
              title: tierOff
                ? L('优化权限：审查 / 自动 —— ' + offTip, 'Permission: Review / Auto — ' + offTip)
                : L('优化权限：审查 = 先给出处与依据待你确认；自动 = 直接生效',
                  'Permission: Review = show sources and rationale for confirmation first; Auto = apply directly'),
              onPick: (v) => save({ permission: v }),
            }),
            // ⑤ 模型：下拉（跟随会话模型 = null）
            h('select', {
              'data-po06': 'model', 'data-po06-value': curKey, value: curKey,
              style: { ...S.small, padding: '1px 4px', maxWidth: '190px' },
              title: L('解释层模型：跟随会话模型，或固定某一个', 'Explainer model: follow the session model, or pin one'),
              onChange: (e) => {
                const v = e.target.value
                if (v === 'inherit') { save({ model: null }); return }
                const r = routes.find((x) => mkey(x) === v)
                if (r) save({ model: { provider: r.provider, model: r.model } })
              },
            },
              h('option', { value: 'inherit' }, L('跟随会话模型', 'Follow session model')),
              groups.map((g) => h('optgroup', { key: g.provider, label: g.provider },
                g.items.map((r) => h('option', { key: mkey(r), value: mkey(r) }, r.label || (r.provider + ' / ' + r.model))))),
            ),
            // ② 「?」帮助（0.5 的形态：文字就是一个 ASCII `?`）；正文见 HELP-0.6.md（要求②）
            h('button', {
              type: 'button', 'data-po06': 'help-btn', 'data-po06-open': helpOpen ? '1' : '0',
              style: { ...S.small, ...(helpOpen ? S.segOn : null) },
              title: L('使用帮助（怎么用 / 档位 / 权限 / 推荐组合）', 'Help (how to use / tier / permission / recommended combos)'),
              onClick: () => setHelpOpen((v) => !v),
            }, '?'),
            catalog.error ? h('span', { 'data-po06': 'model-error', style: { ...S.muted, color: '#e0a83a' } },
              L('模型列表读不到：', 'Model list unavailable: ') + errorText(catalog.error)) : null,
            catalog.error ? h('button', {
              type: 'button', 'data-po06': 'model-retry', style: S.small,
              title: L('重新读一次模型列表', 'Read the model list again'),
              onClick: () => reloadCatalog(),
            }, L('重试', 'Retry')) : null,
            !catalog.error && modelProblems.length ? h('span', { 'data-po06': 'model-hint', style: S.muted },
              L(modelProblems.length + ' 个模型不可用', modelProblems.length + ' model(s) unavailable')) : null,
            busy ? h('span', { 'data-po06': 'busy', style: S.muted }, L('保存中…', 'Saving…')) : null,
            msg && msg.kind === 'err' ? h('span', { 'data-po06': 'error', style: { ...S.muted, color: '#e66' } }, msg.text) : null,
            msg && msg.kind !== 'err' ? h('span', { 'data-po06': 'saved', style: { ...S.muted, color: msg.kind === 'warn' ? '#e0a83a' : '#39c07a' } }, msg.text) : null,
          ),
          // ── 第二行「范围类」：上下文 / 读项目文件 / 详情开关 ────────────────
          h('div', { 'data-po06': 'bar-row-2', style: S.barRow },
            // ③ 上下文：回合数量程 0–10 + 回合/全文切换，档位 off 时都禁用
            h('span', { 'data-po06': 'ctx-wrap', style: { ...S.grp, ...(tierOff ? S.dis : null) } },
              h('span', { style: { opacity: .7 } }, L('上下文', 'Context')),
              h(TurnsRange, {
                value: turns, disabled: tierOff, failTick, mode: historyMode,
                disabledTip: L('上下文：' + offTip, 'Context: ' + offTip),
                title: historyMode === 'full'
                  ? L('上下文（全文）：开 = 读入我手上保留的全部回合；关 = 完全不读', 'Context (full): On = read every turn I still hold; Off = read nothing')
                  : L('上下文：只读最近几回合（0–10），拖动滑杆或按方向键调整', 'Context: read only the last N turns (0–10); drag the slider or use arrow keys'),
                onCommit: (n) => save({ turns: n }),
              }),
              // 全文模式显示"关/开"（那里没有 0~10 的量程可言），回合模式显示裸数字
              h('span', { 'data-po06': 'ctx-num', style: { minWidth: '16px', textAlign: 'center', opacity: .85 } },
                historyMode === 'full' ? (turns > 0 ? L('开', 'On') : L('关', 'Off')) : String(turns)),
              h('button', {
                type: 'button', disabled: tierOff, 'data-po06': 'ctx-mode', 'data-po06-value': historyMode,
                style: { ...S.small, ...(tierOff ? S.dis : null) },
                title: tierOff
                  ? L('上下文模式：回合 / 全文 —— ' + offTip, 'Context mode: Turns / Full — ' + offTip)
                  : L('上下文模式：回合 = 只读最近几回合；全文 = 与工作 AI 看到的一致',
                    'Context mode: Turns = only the last few turns; Full = the same as the working AI sees'),
                // ⚠ 处理函数里也要挡一道：`disabled` 属性只管"浏览器不发事件"，
                // 挡不住程序化派发的事件（真机上还有别的插件在派发/合成事件）。禁用就是**不发请求**。
                onClick: () => { if (tierOff) return; save({ historyMode: historyMode === 'full' ? 'turns' : 'full' }) },
              }, historyMode === 'full' ? L('全文', 'Full') : L('回合', 'Turns')),
            ),
            // ④ 读项目文件：**永远可用**（不受档位影响）；三态纪律见上面的注释
            h('button', {
              type: 'button', 'data-po06': 'readtools',
              'data-po06-value': rtKnown ? (readTools ? 'on' : 'off') : 'unknown',
              style: { ...S.small, ...(rtKnown ? null : { opacity: .6 }) },
              title: rtKnown
                ? L('读项目文件：每轮先看几个项目文件再写要求（会多花时间与 token）',
                  'Read project files: read a few project files before writing requirements (costs time and tokens)')
                : L('读项目文件：还没读到当前设置，这次不会发送这个字段',
                  'Read project files: the current setting has not been read yet, so this field will not be sent'),
              onClick: () => {
                if (!rtKnown) {
                  setMsg({ kind: 'warn', text: L('还没读到当前设置，这次没有发送', 'Current setting not read yet; nothing was sent') })
                  return
                }
                save({ readTools: !readTools })
              },
            }, L('只读工具:', 'Read-only tools: ')
              + (rtKnown ? (readTools ? L('开', 'On') : L('关', 'Off')) : L('…', '…'))),
            // 详情入口（用户 2026-09-21 要求：文字直接叫「详情」，**保留灰绿状态灯**；
            // 面板里不再重复"它在替我做什么 / 最近几轮"——拦截界面已经让人看见模型替我们做了什么）
            h('button', {
              type: 'button', 'data-po06': 'detail', 'data-po06-open': open ? '1' : '0',
              // 状态灯的颜色语义不变，只是不再靠按钮文字去承载：title 里说清现在是什么状态
              style: S.chip, title: L('详情：控制 / 解释层提示词（当前状态：' + statusLabel + '）', 'Details: controls / explainer prompt (state: ' + statusLabel + ')'),
              onClick: () => setOpen((v) => !v),
            },
              h('span', { 'data-po06': 'state-dot', 'data-po06-value': statusLabel, style: S.dot(on) }),
              h('span', {}, L('详情', 'Details')),
            ),
          ),
        ),
        !data && status.error ? h('span', { 'data-po06': 'status-error', style: { ...S.muted, color: '#e66' } },
          L('读状态失败：', 'Status unavailable: ') + errorText(status.error)) : null,
        // 「?」帮助弹层（要求②）：正文来自宿主 GET /help；读不到就如实说，并给出文件路径
        helpOpen ? h('div', { 'data-po06': 'help-pop', style: S.helpPop },
          h('div', { style: { ...S.row, margin: '0 0 6px' } },
            h('strong', {}, L('使用帮助（怎么用 / 档位 / 权限 / 推荐组合）', 'Help (how to use / tier / permission / recommended combos)')),
            h('span', { style: S.muted }, (data && data.version) || ''),
            h('button', {
              type: 'button', 'data-po06': 'help-close', style: { ...S.small, marginLeft: 'auto' },
              title: L('关闭帮助', 'Close help'), onClick: () => setHelpOpen(false),
            }, L('关闭', 'Close')),
          ),
          help.loading ? h('div', { style: S.muted }, L('读取中…', 'Loading…')) : null,
          help.error ? h('div', { 'data-po06': 'help-error', style: { ...S.muted, color: '#e66' } },
            L('帮助读不到：', 'Help unavailable: ') + errorText(help.error)) : null,
          !help.loading && !help.error && help.data
            ? (help.data.source === 'file' && help.data.text
              ? h(HelpBody, { text: help.data.text })
              : h('div', { 'data-po06': 'help-missing', style: { ...S.muted, color: '#e0a83a' } },
                help.data.note || L('帮助内容为空', 'Help content is empty')))
            : null,
          !help.loading && !help.error && help.data && help.data.source === 'file' && help.data.text
            ? h('div', { 'data-po06': 'help-source', style: { ...S.muted, marginTop: '10px' } },
              L('正文来自 ', 'Text from ') + help.data.path + L('（' + help.data.chars + ' 字）', ' (' + help.data.chars + ' chars)'))
            : null,
        ) : null,
        // ── P11 前置拦截：**0.5 的浮层与悬浮球**（用户 2026-09-21：别再造轮子，直接搬 0.5 的那一套）──
        // 面板本体是 `InterceptPanel`（结构/视觉/底栏变体逐块对照 0.5，行号写在它的注记里）；
        // 这里只做两件事：把**该显示的那一份**挑出来，把**既有处理函数**接上去。
        //   · `hold` 活着 ⇒ 显示它（拦截现场）
        //   · hold 已被 0.6 的 clearHoldSoon 清掉、而面板还开着 ⇒ 显示最后那一份快照（只读回看）
        shown ? h(InterceptPanel, {
          hold: shown, phase: shown.phase, permission, tier, count: interceptCount,
          prog: prog, pos: ovGeom.pos, size: ovGeom.size,
          onMove: (p) => setOvGeom((g) => ({ ...g, pos: p })),
          onResize: (z) => setOvGeom((g) => ({ ...g, size: z })),
          onEdit: (e) => {
            // 审查态里用户改的那份就是**本轮注入的包**（既有逻辑不变，只是搬到新面板里）
            const v = e.target.value
            holdRef.current = { ...(holdRef.current || shown), edited: v }
            setHold((x) => ({ ...(x || shown), edited: v }))
          },
          onConfirm: confirmHold,      // 确认提交
          onRollback: rollbackHold,    // 回退上一版包（包级历史，宿主侧保留 10 版）
          onOriginal: sendOriginal,    // 按原文发出（审查态里就是 0.5 的「‹ 回退」，见面板注记②）
          onRegen: doRegen,            // 重新生成 / 重试
          onSkip: skipHold,            // 跳过并直接发送
          onCancel: cancelHold,        // 取消（中止、什么都不发）
          onCollapse: collapseToBall,  // 收起为球
          onCloseSent: closeSent,      // foot-sent 的「关闭」
        }) : null,
        ovBall && ovBall.visible ? h(InterceptBall, {
          ball: ovBall, tier,
          onOpen: reopenFromBall,
          onMove: (p) => setOvBall((b) => (b ? { ...b, pos: p } : b)),
        }) : null,
        open ? h('div', { 'data-po06': 'panel', style: S.panel },
          h('div', { style: S.row },
            h('strong', {}, '提示词优化器 0.6'),
            h('span', { style: S.muted }, (data && data.version) || ''),
            h('button', { style: { ...S.btn, marginLeft: 'auto' }, onClick: () => setOpen(false) }, '关闭'),
          ),
          status.error ? h('div', { style: { ...S.muted, color: '#e66' } }, '读状态失败：' + errorText(status.error)) : null,
          h('div', { style: S.h }, '控制'),
          h(ControlForm, { status: data, refresh: refreshStatus }),
          h('div', { style: S.h }, '解释层提示词'),
          h(PromptEditor, { prompt: data && data.prompt, refresh: refreshStatus }),
        ) : null,
      )
    }

    // ── ② 设置页里的一页（同一套控件）─────────────────────────────────
    function SettingsTab() {
      const [status, refresh] = useStatus()
      const [turns] = useTurns(3)
      const data = status.data
      return h('div', { 'data-po06': 'settings', style: { fontSize: '13px' } },
        h('div', { style: S.muted }, 'dsh-prompt-optimizer 0.6 ｜ ' + ((data && data.version) || '') + ' ｜ ' + ((data && data.home) || '')),
        !data ? h('div', { style: S.muted }, status.error ? '读状态失败：' + errorText(status.error) : '读取中…') : null,
        data ? h('div', {}, h('div', { style: S.h }, '控制'), h(ControlForm, { status: data, refresh })) : null,
        data ? h('div', {}, h('div', { style: S.h }, '解释层提示词'), h(PromptEditor, { prompt: data.prompt, refresh })) : null,
        h('div', { style: S.h }, '最近几轮'),
        h(TurnsList, { turns: turns.data }),
        data && data.problems && data.problems.length
          ? h('div', { style: { ...S.muted, color: '#e0a83a' } }, '配置里有 ' + data.problems.length + ' 处不规范（已按默认处理）')
          : null,
      )
    }

    // ── 注册（含单例闸门与自愈重挂）──────────────────────────────────
    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      // 抢注单例 token：**最新实例获胜**（HMR 重新求值后，旧实例必须让位）。
      // ⚠ 抢注之后要**每次挂载前复核**（isLive）——只在 apply 时刻判一次等于没判，
      // 因为那一刻 token 一定是自己刚写进去的（第一版就是这么写的，见 EV-0142）。
      try { window.__PO06_ACTIVE__ = INSTANCE_TOKEN } catch (e) { /* noop */ }
      const isLive = () => {
        try { return window.__PO06_ACTIVE__ === INSTANCE_TOKEN } catch (e) { return true }
      }
      LOCALE = detectLocale(ctx)          // 文案语言：ctx.locale 拿不到 ⇒ 中文
      // P11：发送按钮的本地化标签（0.5 走 `localeService.bind("conversation")`）。
      // 拿不到字典也不影响拦截——点击路径还有"卡片内最后一个按钮"的结构兜底。
      LOCALE_BIND = (ns) => {
        try {
          const svc = ctx && ctx.locale
          if (!svc) return null
          if (typeof svc.bind === 'function') return svc.bind(ns)
          if (typeof svc.t === 'function') return (k) => svc.t(ns ? ns + '.' + k : k)
        } catch { /* 字典不可用 */ }
        return null
      }
      const disposers = []
      const own = (fn) => { if (typeof fn === 'function') disposers.push(fn); return fn }

      if (!ctx || !ctx.slots || typeof ctx.slots.register !== 'function') return () => {}

      /**
       * 注册一个插槽。**必须真的调用 attach()**——
       * 第一版只把 attach 塞进释放列表而没调用它，结果是：客户端模块加载成功、apply 执行、
       * 单例 token 也写了，**但一个界面元素都没注册**（真机 DOM 实测：`allCount: 0`，见 EV-0142）。
       */
      const mounts = {}
      const remounts = {}
      const attach = (slot, id, order, Component) => {
        if (!isLive()) return null
        if (typeof mounts[slot] === 'function') { try { mounts[slot]() } catch (e) { /* noop */ } mounts[slot] = null }
        const register = () => ctx.slots.register({ name: slot, id, order }, Component)
        mounts[slot] = (typeof ctx.slots.inject === 'function') ? ctx.slots.inject(slot, register) : register()
        return mounts[slot]
      }
      const mount = (slot, id, order, Component) => {
        attach(slot, id, order, Component)                       // ← 立刻注册（这一行曾经缺失）
        own(() => { if (typeof mounts[slot] === 'function') { try { mounts[slot]() } catch (e) { /* noop */ } } })
        remounts[slot] = () => attach(slot, id, order, Component)  // 供自愈重挂
        return remounts[slot]
      }

      // ① 控件栏（P10 换的挂载点：从 conversation.input.dock 搬到 conversation.input.left；
      //    旧的小胶囊**不再挂载**——"胶囊 + 一排控件"同时出现只会更乱）
      mount('conversation.input.left', 'prompt-optimizer', 20, ControlBar)
      mount('shell.overlay', NS + '-panel', 40, () => null)   // 面板本体在控件栏里渲染；这一条保证浮层槽可用
      mount('settings.plugins.tab', NS, 40, SettingsTab)

      // 测试钩子：让 Node 侧的单测能真的驱动"重挂"这条路（用来验单例闸门）。
      // 生产路径不读它；带 __ 前缀以免与宿主契约上的字段混淆。
      exports.__debug = { remount: (slot) => (typeof remounts[slot] === 'function' ? remounts[slot]() : null) }

      const dispose = () => {
        for (const d of disposers.reverse()) { try { d() } catch (e) { /* noop */ } }
        try { if (window.__PO06_ACTIVE__ === INSTANCE_TOKEN) window.__PO06_ACTIVE__ = null } catch (e) { /* noop */ }
      }
      return dispose
    }

    void h
    return module.exports
  },
})
