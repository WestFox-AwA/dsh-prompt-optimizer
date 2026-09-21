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
    async function apiPost(path, body) {
      let r
      try { r = await fetch(API + path, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(body || {}) }) }
      catch (e) { return { ok: false, reason: 'unreachable' } }
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
      const [hold, setHold] = React.useState(null)     // P11 拦截态：{text, via, t0, phase, packet, chars, ms, reason, edited}
      const [tick, setTick] = React.useState(0)        // 只用于"已用 N 秒"重新渲染
      const [interceptCount, setInterceptCount] = React.useState(0)   // 本会话拦截次数（0.5 也有这个计数）
      const rootRef = React.useRef(null)
      const holdRef = React.useRef(null)               // 去重要用 ref（同一个事件循环里 state 还没生效）
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
      const beginHold = (text, via) => {
        if (holdRef.current) return                        // 去重：同一次发送的第二条事件直接忽略
        const h = { text, via, t0: Date.now(), phase: 'optimizing', packet: '', chars: 0, ms: null, reason: null }
        holdRef.current = h; setHold(h)
        apiPost('/interpret', { sessionId, text }).then((r) => {
          if (!r || r.ok !== true) {
            // fail-open：**按原文发出**（0.5 auto 档的语义），并把原因留给人看
            setHold({ ...h, phase: 'failed', reason: reasonText((r && r.reason) || 'unknown') })
            releaseHold(text, { ...h, phase: 'sent' }, 'sent')
            return
          }
          const done = { ...h, phase: 'review', packet: r.packet || '', chars: r.chars || 0, ms: r.ms || null, unsourced: r.unsourced == null ? null : r.unsourced, edited: r.packet || '' }
          holdRef.current = done; setHold(done)
          // 「自动」= 完成即发；「审查」= 等用户确认（0.5 §5 的权限语义）
          if (permissionRef.current !== 'review') releaseHold(text, done, 'sent')
        }, (e) => {
          setHold({ ...h, phase: 'failed', reason: reasonText((e && e.message) || e) })
          releaseHold(text, { ...h, phase: 'sent' }, 'sent')
        })
      }
      const skipHold = () => {
        const h = holdRef.current || hold || {}
        if (!h.text) { holdRef.current = null; setHold(null); return }
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

      // 计时器：只在"优化中"时走（用户要看得见已经等了多久，因为**不设超时**）
      React.useEffect(() => {
        if (!hold || hold.phase !== 'optimizing') return undefined
        const t = window.setInterval(() => setTick((n) => n + 1), 1000)
        return () => window.clearInterval(t)
      }, [hold])

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
          setInterceptCount((n) => n + 1)                            // 0.5 的"本会话已拦截 N 次"（可复核）
          beginHold(draftNow(), 'key')
        }
        const onClick = (e) => {
          const btn = e.target && e.target.closest ? e.target.closest('button') : null
          const why = wantClick(btn)
          if (why) { markSeen('click:' + why); return }
          e.preventDefault(); e.stopPropagation()
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
          markSeen('click:intercepted')
          setInterceptCount((n) => n + 1)
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
            }, L('读项目文件 ', 'Read project files ')
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
        // ── P11 前置拦截的面板（= 用户要求③"复用以前的弹窗"）──────────────
        // 「优化中」只给**已用秒数**与「跳过并直接发送」（**不设超时**，用户 2026-09-21 明确选择）；
        // 「审查」态给可编辑的**本轮包**（改完就是本轮注入的内容）+ 三个出口，绝不吞消息。
        hold ? h('div', { 'data-po06': 'intercept', 'data-po06-phase': hold.phase, style: S.panel },
          h('div', { style: S.row },
            h('strong', {}, hold.phase === 'optimizing' ? L('优化中…', 'Optimizing…')
              : (hold.phase === 'sent' ? L('已发出', 'Sent') : L('本轮优化结果（审查）', 'This round (review)'))),
            h('span', { 'data-po06': 'intercept-elapsed', style: S.muted },
              L('已用 ' + Math.round((Date.now() - hold.t0) / 1000) + ' 秒', Math.round((Date.now() - hold.t0) / 1000) + 's')),
            h('span', { style: S.muted, marginLeft: 'auto' },
              hold.via === 'key' ? L('回车拦截', 'Enter') : (hold.via === 'click' ? L('按钮拦截', 'Click') : L('重新生成', 'Regen'))),
          ),
          h('div', { 'data-po06': 'intercept-text-src', style: S.muted }, L('你这条（原话，不改写）：', 'Your message (verbatim): ') + String(hold.text || '').slice(0, 160)),
          hold.phase === 'optimizing'
            ? h('div', {}, h('div', { style: S.muted }, L('正在解释这一轮（实测 21–57 秒；不设超时，随时可以跳过）', 'Interpreting this round (21–57s measured; no timeout, skip anytime)')),
              h('div', { style: S.row },
                h('button', { type: 'button', 'data-po06': 'intercept-skip', style: S.btn, onClick: skipHold }, L('跳过并直接发送', 'Skip and send as-is'))))
            : null,
          hold.phase === 'review'
            ? h('div', {},
              // 诚实信号（原来在"它在替我做什么"板块里，那块已按用户要求删掉）：
              // **机器自己补出来、且没有你的原话支撑**的条目 = 缺陷，必须在这里仍然看得见。
              hold.unsourced > 0
                ? h('div', { 'data-po06': 'intercept-unsourced', style: { ...S.muted, color: '#e66' } },
                  L('⚠ 这一轮有 ' + hold.unsourced + ' 条**无出处**条目（机器补的、没有你的原话支撑）——这是缺陷，请改掉或删掉',
                    '⚠ ' + hold.unsourced + ' unsourced item(s) this round (machine-added, not backed by your words) — this is a defect; edit or delete them'))
                : null,
              h('div', { style: S.muted }, L('这一轮将注入的内容（可直接改；改完点"确认提交"）', 'What this round will inject (edit freely, then Confirm)')),
              h('textarea', {
                'data-po06': 'intercept-text', style: S.ta, value: hold.edited == null ? hold.packet : hold.edited,
                onChange: (e) => { const v = e.target.value; holdRef.current = { ...(holdRef.current || hold), edited: v }; setHold((x) => ({ ...(x || hold), edited: v })) },
              }),
              h('div', { style: S.row },
                h('button', { type: 'button', 'data-po06': 'intercept-confirm', style: S.btn, onClick: confirmHold }, L('确认提交', 'Confirm & send')),
                h('button', { type: 'button', 'data-po06': 'intercept-original', style: S.btn, onClick: sendOriginal }, L('按原文发出（不要这次结果）', 'Send original (discard)')),
                h('button', { type: 'button', 'data-po06': 'intercept-regen', style: S.btn, onClick: regenHold }, L('重新生成', 'Regenerate')),
              ),
              (hold.chars ? h('div', { style: S.muted }, L('包 ', 'packet ') + hold.chars + L(' 字', ' chars') + (hold.ms != null ? ' ｜ ' + (hold.ms / 1000).toFixed(1) + 's' : '')) : null))
            : null,
          hold.phase !== 'optimizing' && hold.phase !== 'review' && hold.reason
            ? h('div', { 'data-po06': 'intercept-reason', style: { ...S.muted, color: hold.phase === 'failed' ? '#e0a83a' : '#e66' } }, hold.reason)
            : null,
          hold.phase === 'sent' || hold.phase === 'skipped'
            ? h('div', { style: S.muted }, L('消息已经发出（这一轮就此开始）。', 'Message released; this round has started.'))
            : null,
        ) : null,
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
