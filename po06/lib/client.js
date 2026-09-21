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
    function TurnsRange({ value, disabled, disabledTip, title, onCommit, failTick }) {
      const [draft, setDraft] = React.useState(null)
      const shown = draft == null ? value : draft
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
      return h('input', {
        type: 'range', min: TURNS_MIN, max: TURNS_MAX, step: 1, value: shown,
        'data-po06': 'ctx', 'data-po06-value': String(shown),
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

    function ItemsList({ state }) {
      if (!state) return h('div', { style: S.muted }, '当前会话还没有意图状态（它只在真实用户输入后产生）。')
      const c = state.counts || {}
      return h('div', { 'data-po06': 'items' },
        h('div', { style: S.muted },
          '修订 ' + (state.revision == null ? '?' : state.revision) + ' ｜ 条目 ' + (c.total || 0)
          + '：来自你的话 ' + (c.user || 0) + '、机器补充 ' + (c.machine || 0)
          + (c.unsourced ? '、**无出处 ' + c.unsourced + '（这是缺陷）**' : '')),
        (state.items || []).slice(0, 12).map((it) => h('div', { key: it.id, style: { margin: '4px 0' } },
          h('span', {}, it.text),
          h('span', { style: S.prov(it.provenance) }, PROV_TEXT[it.provenance] || it.provenance),
        )),
      )
    }

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
    function ControlBar({ sessionId }) {
      const [status, refreshStatus] = useStatus()
      const [recent] = useTurns(1)
      const [state] = useState_(sessionId)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [failTick, setFailTick] = React.useState(0)
      const [catalog, reloadCatalog] = useOnce(React.useCallback(() => apiGet('/models'), []))

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

      // 模型清单（可能 35+ 项 ⇒ 用 <select>，**不要**平铺成一排按钮）
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
      const last = ((recent.data && recent.data.turns) || [])[0] || null
      const items = state.data && state.data.counts ? state.data.counts : null
      const statusLabel = !data ? L('0.6 ?', '0.6 ?')
        : (data.enabled ? (on ? L('0.6 自动', '0.6 auto') : L('0.6 只记录', '0.6 record')) : L('0.6 未启用', '0.6 off'))
      const offTip = L('档位为「关闭」时不生效', 'Has no effect while the tier is Off')

      return h(React.Fragment, null,
        h('div', { 'data-po06': 'bar', style: S.bar },
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
          // ③ 上下文：回合数量程 0–10 + 回合/全文切换，档位 off 时都禁用
          h('span', { 'data-po06': 'ctx-wrap', style: { ...S.grp, ...(tierOff ? S.dis : null) } },
            h('span', { style: { opacity: .7 } }, L('上下文', 'Context')),
            h(TurnsRange, {
              value: turns, disabled: tierOff, failTick, disabledTip: L('上下文：' + offTip, 'Context: ' + offTip),
              title: L('上下文：只读最近几回合（0–10），拖动滑杆或按方向键调整', 'Context: read only the last N turns (0–10); drag the slider or use arrow keys'),
              onCommit: (n) => save({ turns: n }),
            }),
            h('span', { 'data-po06': 'ctx-num', style: { minWidth: '16px', textAlign: 'center', opacity: .85 } }, String(turns)),
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
          // 详情入口（换挂载点之前，这颗胶囊本身就是"控件"；现在它只是详情面板的开关）
          h('button', {
            type: 'button', 'data-po06': 'detail', 'data-po06-open': open ? '1' : '0',
            style: S.chip, title: L('展开详情：它在替我做什么 / 最近几轮 / 解释层提示词', 'Open details: what it is doing for me / recent turns / explainer prompt'),
            onClick: () => setOpen((v) => !v),
          },
            h('span', { style: S.dot(on) }),
            h('span', {}, statusLabel),
            last && last.packetChars != null ? h('span', { style: S.muted }, '· ' + L('包 ', 'packet ') + last.packetChars + L(' 字', ' chars')) : null,
            items ? h('span', { style: S.muted }, '· ' + L('条目 ', 'items ') + items.total) : null,
          ),
        ),
        !data && status.error ? h('span', { 'data-po06': 'status-error', style: { ...S.muted, color: '#e66' } },
          L('读状态失败：', 'Status unavailable: ') + errorText(status.error)) : null,
        open ? h('div', { 'data-po06': 'panel', style: S.panel },
          h('div', { style: S.row },
            h('strong', {}, '提示词优化器 0.6'),
            h('span', { style: S.muted }, (data && data.version) || ''),
            h('button', { style: { ...S.btn, marginLeft: 'auto' }, onClick: () => setOpen(false) }, '关闭'),
          ),
          status.error ? h('div', { style: { ...S.muted, color: '#e66' } }, '读状态失败：' + errorText(status.error)) : null,
          h('div', { style: S.h }, '控制'),
          h(ControlForm, { status: data, refresh: refreshStatus }),
          h('div', { style: S.h }, '它在替我做什么'),
          h(ItemsList, { state: state.data }),
          h('div', { style: S.h }, '最近几轮'),
          h(TurnsList, { turns: recent.data }),
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
