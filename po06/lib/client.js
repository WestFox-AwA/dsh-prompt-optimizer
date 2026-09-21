// P9.3 · **控制面板**（客户端）。由 `dsh-client-modules` 自动服务并注入页面。
//
// 三个界面，对应主计划 §14.1「面向用户的最小界面」：
//   ① `conversation.input.dock`  —— 输入框旁的小指示器：开/关 + 最近一轮包字数（一眼可见）
//   ② `shell.overlay`           —— 详情/控制浮层：状态、档位、意图条目与出处、最近轮次、提示词
//   ③ `settings.plugins.tab`    —— 设置页里的一页（同一个控制表单，便于从设置进入）
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

    // ── 与宿主 API 的薄封装 ───────────────────────────────────────────
    async function apiGet(path) {
      const r = await fetch(API + path, { headers: { accept: 'application/json' } })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || j.ok !== true) throw new Error((j && j.reason) || ('http-' + r.status))
      return j
    }
    async function apiPost(path, body) {
      const r = await fetch(API + path, { method: 'POST', headers: WRITE_HEADERS, body: JSON.stringify(body || {}) })
      return await r.json().catch(() => ({ ok: false, reason: 'bad-json-response' }))
    }

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
    }
    const PROV_TEXT = { user: '你说过', machine: '机器补充', unsourced: '无出处' }

    function Options({ value, onChange, options, labels }) {
      return h('select', { style: S.select, value: value || '', onChange: (e) => onChange(e.target.value) },
        options.map((o) => h('option', { key: o, value: o }, labels ? labels[o] : o)))
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
        apiGet('/models').then((r) => { if (live) setCatalog(r) }, (e) => { if (live) setCatalog({ models: [], problems: [String(e.message || e)] }) })
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
        if (!r.ok) { setMsg({ kind: 'err', text: '保存失败：' + (r.reason || '未知原因') }); return }
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
        setMsg(r.ok ? { kind: 'ok', text: '提示词已保存（下一轮生效）' } : { kind: 'err', text: '保存失败：' + (r.reason || '') })
        if (r.ok && refresh) refresh()
      }
      const reset = async () => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/prompt', { reset: true })
        setBusy(false)
        setMsg(r.ok ? { kind: 'ok', text: '已恢复内置提示词' } : { kind: 'err', text: '恢复失败：' + (r.reason || '') })
        if (r.ok && refresh) refresh()
      }
      const undo = async () => {
        setBusy(true); setMsg(null)
        const r = await apiPost('/prompt', { undo: true })
        setBusy(false)
        setMsg(r.ok ? { kind: 'ok', text: '已撤销上次提示词修改' } : { kind: 'err', text: r.reason || '撤销失败' })
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
      return h('div', { 'data-po06': 'turns' }, list.map((t, i) => h('div', { key: i, style: { margin: '3px 0' } },
        (t.at ? String(t.at).slice(11, 19) + ' ' : ''),
        t.ok ? '✅ ' : '⚠️ ',
        (t.outcome || '-'),
        t.packetChars != null ? ' ｜ 包 ' + t.packetChars + ' 字' : '',
        t.ms != null ? ' ｜ ' + (t.ms / 1000).toFixed(1) + 's' : '',
        t.model ? ' ｜ ' + t.model : '',
        t.reason ? ' ｜ ' + t.reason : '',
      )))
    }

    // ── ① 输入框旁的小指示器 ─────────────────────────────────────────
    function DockIndicator({ sessionId }) {
      const [status, refreshStatus] = useStatus()
      const [turns] = useTurns(1)
      const [state] = useState_(sessionId)
      const [open, setOpen] = React.useState(false)
      const data = status.data
      const on = !!(data && data.enabled && (data.settings || {}).assist !== 'off')
      const last = ((turns.data && turns.data.turns) || [])[0] || null
      const items = state.data && state.data.counts ? state.data.counts : null
      const label = !data ? '0.6 ?' : (data.enabled ? (on ? '0.6 自动' : '0.6 只记录') : '0.6 未启用')
      return h(React.Fragment, null,
        h('button', {
          'data-po06': 'dock', style: S.chip, title: '提示词优化器 0.6 —— 点开看它在做什么',
          onClick: () => setOpen((v) => !v),
        },
          h('span', { style: S.dot(on) }),
          h('span', {}, label),
          last && last.packetChars != null ? h('span', { style: S.muted }, '· 包 ' + last.packetChars + ' 字') : null,
          items ? h('span', { style: S.muted }, '· 条目 ' + items.total) : null,
        ),
        open ? h('div', { 'data-po06': 'panel', style: S.panel },
          h('div', { style: S.row },
            h('strong', {}, '提示词优化器 0.6'),
            h('span', { style: S.muted }, (data && data.version) || ''),
            h('button', { style: { ...S.btn, marginLeft: 'auto' }, onClick: () => setOpen(false) }, '关闭'),
          ),
          status.error ? h('div', { style: { ...S.muted, color: '#e66' } }, '读状态失败：' + status.error) : null,
          h('div', { style: S.h }, '控制'),
          h(ControlForm, { status: data, refresh: refreshStatus }),
          h('div', { style: S.h }, '它在替我做什么'),
          h(ItemsList, { state: state.data }),
          h('div', { style: S.h }, '最近几轮'),
          h(TurnsList, { turns: turns.data }),
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
        !data ? h('div', { style: S.muted }, status.error ? '读状态失败：' + status.error : '读取中…') : null,
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

      mount('conversation.input.dock', NS + '-dock', 40, DockIndicator)
      mount('shell.overlay', NS + '-panel', 40, () => null)   // 面板本体在 dock 里渲染；这一条保证浮层槽可用
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
