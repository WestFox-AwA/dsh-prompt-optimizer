# dsh-prompt-optimizer · Prompt Optimizer (DSH Web plugin)

[中文](README.md) ｜ **English**

> 🌐 **UI language notice**: the plugin's **user interface is currently Chinese-only** — there is no English (or other) UI yet. This English README is documentation only; after installation the interface stays Chinese.
> **界面语言说明**：本插件的操作界面目前有且只有中文。

---

## ⚠️ Four points to read first (author's statement)

1. **The purpose of this plugin is to optimize prompts** — to save the time you would otherwise spend writing them, and to help you convey your intent more accurately. In essence, it gives the AI **one extra step of self-planning and self-constraint**.
2. It has a **clear effect on capable-but-prompt-sensitive models** such as **DeepSeek-V4.1-Flash** — models that are strong, yet whose performance is heavily influenced by how the prompt is written.
3. The author has **only tested this plugin on some OneShot-type tasks**, where it achieved **breakthrough results**. Therefore **no guarantee is made that it will have a large positive effect on every task** — **please keep a conservative view of its practical value**.
4. This plugin is **fully open source**: **anyone** may use and modify it **in any form**, and **suggestions and all kinds of testing are welcome**.

---

## What it does

The moment you press Enter in the composer, your message is **not** sent directly — a **second AI (a "relay")** first turns it into a **command that can be sent to your working AI as-is**, and you decide whether to send it after seeing the result.

- It is a **relay, not a chat partner**: the optimizer AI knows it is "conveying the user's intent to the working AI". It does **not answer you, does not do the work for you, and does not ask you questions**. Its output is the command body itself (no meta sections such as "Optimized prompt / Change log"), ready to be pasted to the downstream AI.
- The optimizer **model, tier and permission are independent of your conversation** — your chat model is never touched.
- **Tier and permission are per-session**: setting session A to "Extreme + Auto" leaves session B untouched.
- The mini window is **session-isolated**: a window triggered in A never pops up in B, and comes back as-is when you return to A (if it is still waiting for your decision).

Author: **啃轮胎的西狐** · Version **0.1.5beta1** · Release date **2026/09/11** (the same credit appears at the bottom of the in-plugin `?` panel)

---

## 1. Installation

### Option A — install it like any other DSH plugin (recommended)

Two steps: install the package into your profile, then register it as a bundle layer.

```bash
# 1) install the package (GitHub repo / tarball / local dir all work)
dsh plugin --profile web add github:WestFox-AwA/dsh-prompt-optimizer#v0.1.5-beta.1
dsh plugin --profile web add ./dsh-external-dsh-prompt-optimizer-0.1.5-beta.1.tgz

# 2) add one line to dsh.profile.bundles in ~/.dsh/profiles/web/package.json:
#      "@dsh-external/dsh-prompt-optimizer"
```

Restart DSH and you are done. **Why the bundles edit is needed**: `dsh plugin` merely forwards its arguments to pnpm (installation only); which packages take part in assembly as bundle layers is decided by `dsh.profile.bundles`. This package ships its own `cordis.patch.yml` and inserts its entry into the root entry list during assembly — **exactly the same pattern** as `@dsh-external/dsh-super-injector` and `@dsh-external/dsh-graded-mode`.

### Option B — keep bundles untouched, insert via the profile patch

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml (a top-level YAML array)
- insert:
    - id: prompt-optimizer
      name: '@dsh-external/dsh-prompt-optimizer'
      config: {}
```

The package still has to be resolvable (`dsh plugin add`, or a manually created `node_modules` symlink/junction).

> ⚠️ **Use either Option A or Option B, never both** — doing both inserts the same entry twice and DSH fails to boot with `duplicate loader entry id`.

### Verify the installation

```bash
dsh --dump-config --profile web | grep -A2 'id: prompt-optimizer'   # present, and exactly once
node -e "console.log(require.resolve('@dsh-external/dsh-prompt-optimizer',{paths:['<profile dir>']}))"
```

### Requirements

- **DSH Web** (`dsh web`; this plugin only provides UI on the web platform).
- At least one working LLM route (by default optimization follows the current session model; you can also pick a dedicated model from the plugin's model pill).
- The plugin has **zero runtime dependencies and needs no build** (`lib/` contains runnable JavaScript).

---

## 2. Quick start (30 seconds)

1. Type as usual in the composer and press **Enter** (or click send).
2. The message is intercepted and a **mini window** appears in the bottom-right corner with two panes: **Thinking** (the optimizer's reasoning, with its token count) and **Output** (the command you are about to send).
3. With permission **Review**: edit the output text directly → click **Confirm & send**; not satisfied? click **Regenerate** (it asks you for a direction first).
4. With permission **Auto**: it is sent automatically as soon as optimization finishes — no action needed.
5. Do not want to optimize? Click **‹ Roll back** (stop + close + **send nothing** + your original text stays in the composer), or **Send as-is** to send your original text.

> The three controls left of the composer, from left to right: **Tier** (slider), **Permission** (slider), **Model** (pill), followed by **Help (`?`)**. The `?` panel contains the same short tutorial plus the author credit.

---

## 3. Choosing the three controls

| Control | Values | Notes |
|---|---|---|
| **Tier** | Off / Basic / Advanced / Extreme | Off = no interception at all; Basic = just say it clearly (~3 s); Advanced = add the obviously-needed constraints and acceptance criteria (~20 s); Extreme = **read the real project structure** (read-only, never writes) and produce a staged action plan + acceptance criteria + contingencies (~20 s) |
| **Permission** | Review / Auto | Review = editable output, sent only when you confirm; Auto = sent as soon as optimization finishes (**and if optimization fails, the original text is sent** — it never silently swallows your message) |
| **Model** | any provider/model | Affects optimization only, never your chat model; the popover marks the current session model; unreachable providers are labelled "unreachable" and never slow the list down |

> **To use every capability automatically, use [Extreme] + [Auto].**

---

## 4. The mini window

- **Draggable** — drag by the title bar.
- **Resizable** — drag the bottom-right grip; the size is **remembered** for the next window.
- **Never lost** — after hiding or switching sessions it is clamped back into view.
- **Session-isolated** — the window belongs to the session that triggered it.
- **Key buttons never disappear** — the bottom is a **persistent action bar** (Confirm / Regenerate / Roll back / Send as-is / Retry) that does not scroll with content; on very short windows the content area shrinks automatically.
- **Thinking token count** — the status row shows the session total (e.g. `Σ 1.1k tok`), the **Thinking** pane title shows the **reasoning tokens** (`— tok` when the provider does not report usage), and the **Output** pane title shows output tokens plus character counts.

---

## 5. FAQ

| Symptom | Cause / fix |
|---|---|
| Enter seems to do nothing and the message is not sent | You are inside the optimization flow — watch the mini window; if it is not visible, switch to that session and it reappears |
| Optimization is slow | Advanced/Extreme take about 20 s (Extreme also reads project structure). Use **Basic** for speed |
| "Optimizer model unavailable → sent the original text" | The selected model is unreachable (e.g. local `ollama` not running). The plugin **falls back to the session default model** automatically |
| Temporarily disable it | Drag the **Tier** slider to the far left ("Off") |
| A provider is labelled "unreachable" | That provider is unavailable right now (not running / no credentials); other models are unaffected |
| Can I switch the UI to English? | **Not yet** — the UI is currently Chinese-only |

---

## 6. Uninstall

```bash
dsh plugin --profile web remove @dsh-external/dsh-prompt-optimizer
```

If you used Option B, also delete the `insert` entry from `cordis.patch.yml`. Plugin settings live in `~/.dsh/prompt-optimizer.json` (tier / permission / model / window geometry / per-session settings); delete it too for a full cleanup.

---

## 7. Implementation notes (for people who want to modify it)

- **Two halves**: `lib/index.js` (host: tier system prompts and the relay framing, read-only tool loop, SSE streaming runs, model catalog, state persistence, HTTP routes) + `lib/client.js` (browser: control row, model/help popovers, mini window, capture-phase interception of Enter and the send button).
- **Interception happens in the capture phase** on `window` (before React and the editor's own handlers): `Shift+Enter`, `/` commands, empty drafts, attachments-only, and Enter outside the composer card all pass through.
- **The official send path is untouched**: confirming uses the official `inputActions.setDraft()` + `submit()`, exactly the same route as a manual send.
- The artifact is plain JavaScript (no build step). `ACCEPTANCE.md` is a cell-by-cell acceptance checklist; `evidence/` holds machine traces (self-test reports, telemetry, comparisons).

---

## 8. Privacy and boundaries

- Optimization requests send only **the text you typed**, plus (Advanced/Extreme) a **directory-tree summary and key file names of the current project**. Extreme-tier read-only checks are confined to the project root: no writes, no command execution.
- The mini window sends nothing by default: only "Confirm", "Auto" and "Send as-is" hand content back to the official send path.
- The plugin is a local client + host plugin and talks to no third-party service.

---

## 9. License and collaboration

**BSD-3-Clause**. Fully open source: **anyone** may use and modify it **in any form**; issues, pull requests and all kinds of testing feedback are welcome. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
