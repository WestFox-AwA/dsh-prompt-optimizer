/**
 * dsh-bash-runtime client — 对话流里 bash 工具的专属卡片（keyed toolview）。
 *
 * 设计目标（2026-09-25 用户要求）：外观与行为贴近宿主原版 shell 卡片，
 * 只把前导图标换成 $_、并把工具身份写进 tooltip；不发明新的视觉语言。
 *   · 折叠行：[$_] 运行命令 · <命令>     （单行、等宽、省略号）
 *   · 展开后：复用宿主的 TerminalBlock 原语（提示行 / 输出 / 状态药丸 / 复制 / 折叠）
 * 取不到原语时降级为自绘正文；组件抛错也降级为一行提示，绝不拖垮会话 UI 树。
 */
window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-bash-runtime",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const react = require("react")
    const e = (type, props, ...children) => react.createElement(type, props, ...children)

    let primitivesCache
    const primitives = () => {
      if (primitivesCache !== undefined) return primitivesCache
      try {
        const mod = require("@deepseek-ai/dsh-client-ui-primitives")
        primitivesCache = mod && typeof mod.TerminalBlock === "function" ? mod : null
      } catch (err) { primitivesCache = null }
      return primitivesCache
    }

    const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace"
    const C = {
      fg: "var(--dsw-alias-label-primary, #1f1f1f)",
      dim: "var(--dsw-alias-label-tertiary, #8a8a8a)",
      err: "var(--dsw-alias-state-error-primary, #c0392b)",
      line: "var(--dsw-alias-border-l2, #e5e5e5)",
    }
    const S = {
      row: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", lineHeight: "18px", cursor: "pointer", userSelect: "none", padding: "1px 0" },
      icon: { flex: "0 0 auto", width: "16px", textAlign: "center", fontFamily: MONO, fontWeight: 600, color: C.dim },
      title: { flex: "0 0 auto", color: C.fg },
      sep: { flex: "0 0 auto", color: C.dim },
      cmd: { flex: "1 1 auto", minWidth: 0, fontFamily: MONO, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      caret: { flex: "0 0 auto", color: C.dim, fontSize: "10px" },
      body: { marginTop: "6px" },
      fallback: { margin: 0, padding: "8px 10px", border: "1px solid " + C.line, borderRadius: "6px", fontFamily: MONO, fontSize: "11.5px", lineHeight: 1.5, color: C.fg, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "260px", overflow: "auto" },
    }

    const argsOf = (props) => {
      try {
        const b = props && props.block
        const raw = b && b.call && typeof b.call.argsRaw === "string" ? b.call.argsRaw : ""
        return raw ? JSON.parse(raw) : null
      } catch (err) { return null }
    }
    /** 结果正文：宿主把已结算文本放在 block.content（一个 {type:"text",text} 数组），
     *  与客户端 singleResultText() 同源。此前读 block.value 取不到 → 显示"(无输出)"。 */
    const outputOf = (props) => {
      const b = props && props.block
      if (!b) return ""
      if (Array.isArray(b.content)) {
        const texts = b.content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text)
        if (texts.length > 0) return texts.join("\n")
      }
      if (typeof b.value === "string") return b.value
      if (b.value && typeof b.value.output === "string") return b.value.output
      if (typeof b.text === "string") return b.text
      return ""
    }
    const statusOf = (out) => {
      const sig = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(out || "")
      if (sig && sig[1] !== undefined) return { signal: sig[1], output: out.slice(0, sig.index) }
      const ex = /\n\[exit code: (\d+)\]$/.exec(out || "")
      if (ex && ex[1] !== undefined) return { exitCode: Number(ex[1]), output: out.slice(0, ex.index) }
      // 没有标记 → undefined（不渲染状态药丸）；null 会被原语显示成"无退出码"红药丸，
      // 而解析不到标记通常只是本工具没写标记，不代表命令没有退出码。
      return { exitCode: undefined, output: out || "" }
    }
    const LABELS = {
      signal: (s) => "信号 " + s,
      exitCode: (c) => "退出码 " + c,
      noExitCode: "无退出码",
      running: "运行中",
      failed: "失败",
      done: "完成",
      copy: "复制",
      copied: "已复制",
      noOutput: "（无输出）",
      collapseAria: "收起输出",
      collapse: "收起",
      expandAria: (n) => "展开剩余 " + n + " 行",
      expand: (n) => "展开剩余 " + n + " 行",
    }

    function BashRow(props) {
      const [open, setOpen] = react.useState(false)
      const phase = props && props.phase
      const running = phase === "preparing" || phase === "start"
      const args = argsOf(props) || {}
      const partial = typeof props?.useToolCallArgumentsPartial === "function"
        ? (() => { try { return props.useToolCallArgumentsPartial() } catch (err) { return "" } })()
        : ""
      const cmd = typeof args.command === "string" ? args.command : (running && partial ? String(partial) : "")
      const settled = statusOf(running ? "" : outputOf(props))
      const failed = !!(props && props.block && props.block.isError) || (settled.exitCode !== undefined && settled.exitCode !== 0) || !!settled.signal

      const head = e("div", {
        style: S.row,
        onClick: () => setOpen((v) => !v),
        role: "button",
        tabIndex: 0,
        onKeyDown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpen((v) => !v) } },
        "aria-expanded": open,
      },
        e("span", { style: failed ? { ...S.icon, color: C.err } : S.icon, title: "内置 Bash（插件自带 GNU bash/MSYS2 运行时：无需 WSL、不经过 PowerShell）" }, "$_"),
        e("span", { style: S.title }, "运行命令"),
        e("span", { style: S.sep }, "·"),
        e("span", { style: S.cmd, title: cmd || "" }, cmd || (running ? "（读取参数…）" : "（未读到命令）")),
        e("span", { style: S.caret }, open ? "▾" : "▸"),
      )

      if (!open) return head

      // 2026-09-25：命令参数还没流到时**不渲染可执行卡片**。此前会渲染一个空的 TerminalBlock
      // （"（读取参数…）" + 空框）；若此刻被外层超时/取消，界面上就只剩这张空卡片，
      // 看起来像"命令是空的"故障。参数就绪后会自动进入正常渲染。
      if (!cmd && running) {
        return e("div", null, head, e("div", { style: S.body },
          e("div", { style: { fontSize: "11px", color: C.dim } }, "正在接收命令参数…")))
      }

      const P = primitives()
      const body = P
        ? e(P.TerminalBlock, {
            command: cmd,
            cwd: typeof args.workdir === "string" && args.workdir ? args.workdir : undefined,
            output: running ? undefined : settled.output,
            exitCode: running ? undefined : settled.exitCode,
            signal: running ? undefined : settled.signal,
            running,
            copyText: cmd,
            runStateDot: false,
            labels: LABELS,
          })
        : e("pre", { style: S.fallback },
            "$ " + (cmd || "") + "\n" + (running ? "" : (settled.output || "（无输出）")) +
            (running ? "" : (settled.exitCode !== undefined ? "\n[exit code: " + settled.exitCode + "]" : "")))

      return e("div", null, head, e("div", { style: S.body }, body))
    }

    function Safe(fn) {
      return function (props) {
        try { return fn(props) } catch (err) {
          return e("div", { style: { fontSize: "11px", color: C.dim }, title: String(err) }, "（bash 卡片渲染降级）")
        }
      }
    }

    const inject = ["slots"]
    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.register !== "function") return
      ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
        name: "tool.call.toolview",
        key: "bash",
        locale: "@dsh-external/dsh-bash-runtime",
      }, Safe(BashRow)))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
