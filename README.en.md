# dsh-prompt-optimizer **v0.6.8-stable** · Prompt Optimizer (DSH Web plugin)

> ## ✅ The latest version is **0.6.8-stable**, and it is this repository's **mainline** (the default branch `main` carries it)
>
> | Line | Version | Status | Where |
> |---|---|---|---|
> | **0.6 (mainline · latest)** | **`0.6.8-stable`** | **Mainline · stable release** — this is what you install now. The capability is still experimental (internally self-consistent **with evidence**; **no effect evidence** — the holdout evaluation only finished stage S1).<br>**What 0.6.8-stable fixes**: ① **"thinking finished but no packet" (no-packet)** — an empty model result (empty `ops` / no JSON at all) is now **retried once**; if it is still empty, the host adds one clearly-marked "nothing was extracted this round" item ⇒ **a packet always exists for the round**; oversized batches are **truncated and recorded**, retirements pointing at a non-existent item are **dropped one by one**, and a user cancel is no longer mis-recorded as a parse failure; ② **light mode** — colours are now **driven by the theme** (light = dark text on light surfaces; the two root causes behind "light mode looked unchanged" were a theme signal read from the wrong element and token selectors that missed descendant elements); ③ **UI language follows DSH's language setting** (`zh`/`en`, including the `?` manual, switching live); ④ **the enable decision is fixed** — a missing/misspelled `rollout` no longer silently disables a plugin whose config says `enabled:true` (only an explicit `off` disables it), and `/status` now reports the gate's decision distribution.<br>**Carried over from 0.6**: goals are generated per round (**never inherited**; the previous round's items retire, kept for the record) · the operating surface aligned with 0.5 (tier `off/light/standard/heavy`, two-row control bar + `?` manual, intercept overlay split into **thinking/output** panes, fixed-height scrollable thinking pane with no truncation, token counts from the provider's **real reported usage**, never estimated) · every item carries a verbatim citation.<br>**Known cost**: long-lived constraints no longer carry across rounds — they are re-derived from the context each round, so do not shrink the *context* window too far. | **[Install it → `po06/README.md`](po06/README.md)** (direct download + step-by-step + self-check) · [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md) · [`po06/RELEASE-CHECKLIST.md`](po06/RELEASE-CHECKLIST.md) · **[Release v0.6.8-stable](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.6.8-stable)** |
> | **0.5 (previous generation · still usable)** | last published `v0.5.0-beta.1` | **No longer updated, but still works** (0.5 is a **different package**, `@dsh-external/dsh-prompt-optimizer`); design and usage live in [`SPEC.md`](SPEC.md) and in [the appendix below](#appendix-the-05-line-previous-generation-still-usable). | [`SPEC.md`](SPEC.md) |
>
> ### Install 0.6.8-stable in 30 seconds (copy-paste; step-by-step + self-check in [`po06/README.md`](po06/README.md))
>
> ```powershell
> $v = '0.6.8-stable'; $d = "$env:USERPROFILE\Downloads"
> Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/download/v$v/dsh-external-dsh-po06-$v.tgz" -OutFile "$d\dsh-external-dsh-po06-$v.tgz"
> dsh --profile po061 --from-default-profile web --dump-config        # a clean profile
> dsh plugin --profile po061 add "$d\dsh-external-dsh-po06-$v.tgz"    # install
> dsh --profile po061                                                 # start (prints a tokenized URL)
> ```
>
> Afterwards set the **tier** control to `standard` or `heavy` (`off` does not intercept and injects nothing).
> Do **not** install it into the profile that carries your 0.5.x (having both assembled makes the `DOUBLE_INTERCEPT`
> guard refuse to enable — that is deliberate), and it **does not share configuration**: 0.6's enable intent lives in
> `<home>/po06.json` and it **never touches** your 0.5.x `prompt-optimizer.json`.

**The UI follows DSH's language setting**: set DSH to Chinese and everything is Chinese; set it to English and everything is English — including the `?` user manual (it is no longer Chinese-only). **The 0.6 line targets `dsh-0.1.6-alpha.1`** (`0.1.5-rc.1` also runs); the last 0.5 publication (`v0.5.0-beta.1`) targets the same.

**English** ｜ [中文](README.md)

---

## Appendix: the 0.5 line (previous generation, still usable)

> **Everything from *Installation* downwards is the 0.5 line's historical documentation**: that is the previous generation — it installs a **different package**, `@dsh-external/dsh-prompt-optimizer`, last published as `v0.5.0-beta.1` (the 0.5 source in this repo is versioned `0.5.2-beta.1` and never got a Release of its own).
> **For 0.6 installation and usage see the 30-second block above and [`po06/README.md`](po06/README.md)**. This section stays because 0.5 still works, and because its design notes ([`SPEC.md`](SPEC.md)) are the architecture baseline that 0.6 builds on.

> **This release is defined by [SPEC.md](SPEC.md) (architecture baseline v0.5)**: the optimizer is not a "prompt writer" but an **evidence carrier + gap filler** — it takes the evidence relevant to *this* request from {your own words} {session context} {project files} and turns it into one command the downstream can get right **in a single pass**.

> ## ⚠️ Important: the default downstream executor is **PTC**
>
> The downstream executor (in the Optimizer-model popover) **defaults to PTC** — this plugin is optimized for PTC: the command is projected for "**one program does it all**" (**checklist first, as long as needed and no longer**, no process order or stop points). You can also pin **Chat** (stages/steps, no length limit) or **Auto** (read the session's agent preset). Either way, **not one piece of evidence or depth is removed**.

> ### What 0.5 is, in one page
>
> Downstream models of this class (v4.1-flash) **don't act unprompted, don't guess, and finish in one pass**: anything you leave out that they cannot infer is **necessarily missing**, and anything you write they **will** do. So this plugin does exactly one thing — **fill the gaps they cannot know about**, and write nothing more.
> **Five gaps only**: ① reference & location (which bug is "this bug": file / screen / symptom) ② acceptance criterion (what counts as done) ③ constraints & boundaries (what must not change; the conventions that **actually exist** in the project) ④ implicit decisions (options you left open: follow the convention when there is evidence, otherwise mark them as a **degree of freedom**) ⑤ entry point & anchors (where to start, and afterwards **where to look and what counts as passing**).
> **Every line carries its evidence**: facts may only come from the context or files **actually read this run** (listing a directory ≠ knowing its contents); a reference like "this bug" is resolved through the **session context** — how much is read is decided **only** by the Turns/Full-text control, and when the budget is short only the *presentation* is compressed, **never the range**, with the compression always declared.
> **What it never writes**: the downstream's own craft (generic boilerplate, ordinary API usage, best practices, teaching) and **pointless verification boilerplate** ("please verify thoroughly") — for this class of model the prompt is not advice but an **instruction set**, so every extra line is an extra hard constraint.
> Four tiers = **evidence budget**: Low = your words + context only (fills ① and ②); High = reads project files as needed (all five gaps); Ultra = reads deeply and cross-checks (all five, plus **a source on every change**, plus positive enrichment). None of them writes process ritual (stage gates / checkmarks / pasted evidence).

> ### 🌐 [**阅读中文文档 →**](README.md)
>
> Jump to the Chinese README (which has a jump button back to English at its top)

---

## ⚠️ Five points to read first (author's statement)

1. **The purpose of this plugin is to optimize prompts** — to save the time you would otherwise spend writing them, and to help you convey your intent more accurately. In essence, it gives the AI **one extra step of self-planning and self-constraint**.
2. It has a **clear effect on capable-but-prompt-sensitive models** such as **DeepSeek-V4.1-Flash** — models that are strong, yet whose performance is heavily influenced by how the prompt is written.
3. The author has **only tested this plugin on some OneShot-type tasks**. Every number in section 7 comes from **specific test items scored by a specific rubric**; it **does not mean your own tasks will improve too**. **Please keep a conservative view of its practical value.**
4. This plugin is **fully open source**: **anyone** may use and modify it **in any form**, and **suggestions and all kinds of testing are welcome**.
5. **Language and compatibility**: the interface **supports both Chinese and English**, following DSH's *Settings → General → Language* (`zh` / `en`, switching takes effect immediately). **The mainline `0.6.8-stable` and the last 0.5 publication (`v0.5.0-beta.1`) both target `dsh-0.1.6-alpha.1`.** Read [DSH-COMPAT.md](DSH-COMPAT.md) before upgrading DSH — it records the interface audit, the upgrade steps, and the post-upgrade acceptance results.

---

## 🆕 What's new

> **The per-release changelog for anything before 0.6 has moved out of this page**: the full history lives in [`CHANGELOG.md`](CHANGELOG.md).
> For the 0.6 mainline (current), see the top of [`CHANGELOG.md`](CHANGELOG.md) and [`po06/README.md`](po06/README.md).

## 1. Installation

### Option A — install it like any other DSH plugin (recommended)

Two steps: install the package into your profile, then register it as a bundle layer.

```bash
# 1) install the package (GitHub repo / tarball / local dir all work)
#    ⚠️ the 0.5 package is named dsh-external-dsh-prompt-optimizer; do NOT copy the
#       releases/latest page (it now points at the 0.6 line, whose asset name differs → 404).
#       For 0.5, pin this tag:
dsh plugin --profile web add https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/download/v0.5.0-beta.1/dsh-external-dsh-prompt-optimizer-0.5.0-beta.1.tgz
#    or pin a version (replace <version>, e.g. v0.5.0-beta.1)
dsh plugin --profile web add github:WestFox-AwA/dsh-prompt-optimizer#<version>
dsh plugin --profile web add ./dsh-external-dsh-prompt-optimizer-0.5.0-beta.1.tgz

# 2) add one line to dsh.profile.bundles in ~/.dsh/profiles/web/package.json:
#      "@dsh-external/dsh-prompt-optimizer"
```

> **0.5 download page**: <https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.5.0-beta.1> — the last 0.5 publication.
> **0.6's download page** is at the top of this file and in [`po06/README.md`](po06/README.md).

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

> The controls left of the composer, from left to right: **Tier** (slider), **Permission** (slider), **Context** (slider plus a **Turns / Full-text** toggle button attached to its right), **Model** (pill), followed by **Help (`?`)**. The `?` panel contains the same short tutorial plus the author credit.

---

## 3. Choosing the controls

| Control | Values | Notes |
|---|---|---|
| **Tier** | Off / Low / High / Ultra | **A tier is an evidence budget.** Off = no interception at all; Low = your own words + the given context only (fills ① reference/location and ② acceptance criterion; reads no project); High = **reads project files as needed** to verify (all five gaps; every change is checkable) plus anchors; Ultra = **reads deeply and cross-checks** (**a source on every change**) and may enrich positively as long as it never contradicts your intent |
| **Permission** | Review / Auto | Review = editable output, sent only when you confirm; Auto = sent as soon as optimization finishes (**and if optimization fails, the original text is sent** — it never silently swallows your message) |
| **Context** | Turns **0–10** / Full-text **off / on** | One click on the button attached to the slider's right switches the mode. **Turns** = the last 0–10 turns (**your turn + the AI's turn = 1 turn**; **0 = read nothing**). **Full-text** = the very context the working AI currently sees (the session projection, both sides verbatim). **How much is read is decided only here**: when over budget it compresses the *presentation* (truncate the AI's replies → omit them → truncate each row), **never the range**; only if even the leanest form does not fit does it drop turns from the oldest end and says how many. The block is always framed as an **observer view** ("you are an observer and commander, not the one doing the work") — otherwise the optimizer would think it is the one doing the job |
| **Model** | any provider/model | Affects optimization only, never your chat model; the popover marks the current session model; unreachable providers are labelled "unreachable" and never slow the list down |
| **UI language** | 中文 / English | **Follows DSH's language setting**; there is no separate switch inside the plugin |

> **To use every capability automatically, use [Ultra] + [Auto].**
>
> Which context mode? **Normally use "Turns 0–3"** (cheap and usually enough); **switch to "Full-text → on" when it must understand where the conversation currently stands** (it mirrors the working AI's context, at the cost of tens of thousands of characters per call).

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
| Optimization is slow | High/Ultra take about 20 s (Ultra also reads project structure). Use **Low** for speed |
| "Optimizer model unavailable → sent the original text" | The selected model is unreachable (e.g. local `ollama` not running). The plugin **falls back to the session default model** automatically |
| Temporarily disable it | Drag the **Tier** slider to the far left ("Off") |
| A provider is labelled "unreachable" | That provider is unavailable right now (not running / no credentials); other models are unaffected |
| Can I switch the UI to English? | **Yes.** Follow DSH's *Settings → General → Language*: Chinese makes the whole UI Chinese, English makes it English, and the switch is live (since v0.2.2-beta.1) |
| I clicked "Send as-is" / "Roll back", yet another message went out (shown as a queued message) | This was a defect **fixed in 0.1.9**: after you released or rolled back, a late "optimization finished" event still triggered auto-send and posted a second message. A settled run is now marked as such, both `autoSend` and the `done` branch skip it, and releasing also aborts the backend run. Upgrade to **0.1.9beta1** or later |
| The command keeps telling the AI to create a goal or a todo list | That is the **difficulty verdict** at work: goals/stages are only demanded for multi-point changes or hazard signals; a single-point fix should come back as one command plus one completion marker. If a trivial task gets over-orchestrated, send me that output — the rules and test cases are documented in `PROMPT-OPTIMIZATION.md` |
| The command asks me "please confirm which file to use" when it could look it up itself | This is a defect **fixed in v0.2.1-beta.2** (unknown *project facts* were mis-written as "stop and wait for the user"). Upgrade; if it still happens, send me that output |

---

## 6. Uninstall

```bash
dsh plugin --profile web remove @dsh-external/dsh-prompt-optimizer
```

If you used Option B, also delete the `insert` entry from `cordis.patch.yml`. Plugin settings live in `~/.dsh/prompt-optimizer.json` (tier / permission / model / context mode / window geometry / per-session settings); delete it too for a full cleanup.

---

## 7. Measured data and proof (no hype)

**How it was measured** (all of it ran in throwaway in-host measurement rigs, never in the product code; the scripts live in `evidence/` and are reproducible):

```
task (the user's own words) --relay optimize--> command --solve--> the executor AI's answer --judge--> score
```

- A fixed executor AI and a fixed rubric; every task runs through the same set of conditions, and **the judge does not see which condition produced an answer** (blind scoring).
- **Command side**: how much substance the optimizer's command itself injects — 5 points per task.
- **Answer side**: the quality of the executor's answer — 10 points per task (strict 0/1/2 scoring per point).
- **Single-cell noise** measured at ±1 point (command side) / ±2 points (answer side), so the key conclusions use **repeated sampling** (n=2–4) and any difference inside the noise band is labelled as such.

### Command side (4 tasks, max 20)

| Condition | High | Ultra |
|---|---|---|
| No optimization (control) | 4 | ≈4 |
| 0.1.1 old prompt | **19** | **18.7** (n=2–3) |
| 0.1.9 regressed | **16** | **15.3** (n=2–4) |
| **0.2.1 after the fix (current baseline)** | **18** | **18** |

- The regression was **real** (Ultra 18.7 → 15.3), not an impression; after the fix it is back to the 0.1.1 level or better: **Ultra scored ≥ the regressed version in 10/10 paired comparisons** (sign test p≈0.001).
- All four tiers were measured: **Off** = the no-optimization control (4/20, which shows optimization does change something); **Low** = by design it only repairs the wording and adds no new requirements, so it is not part of the "substance injection" comparison.

### Answer side (3 hard tasks, max 10)

| Condition | T5 conditional-probability trap | T6 order-of-magnitude estimate | T4 engineering task |
|---|---|---|---|
| No optimization | 8 | 4–5 | 9 |
| 0.1.1 old | 10 | 9 / 7 | 9 |
| 0.1.9 regressed | 8 / 10 | 9 / 9 | **4** |
| 0.2.1-beta.1 | 10 / 10 | 10 / 9 | **4** |
| **0.2.1-beta.2 (after the two "push-back" fixes)** | **10** | **10** | **10** (High) |

**Four limitations you must read together with those numbers** (otherwise you will over-read them):

1. **The low Ultra-tier T4 scores (1–6/10) are a rig limitation, not a prompt defect**: the executor AI in that rig had no filesystem or command tools, while the command told it to "scan the working directory first", so it could only stop. That command was, on a verbatim read, the best of the whole run — so this cell is excluded from the conclusion.
2. **The answer side saturates on a strong model**: several cells score high even with no optimization (e.g. T4 at 9/10), so the answer side discriminates **less** than the command side.
3. **The sample is small**: most cells are n=1–3, and a 1–2 point difference in a single cell is noise; only differences that are consistent in direction **and** visible in the live path are treated as conclusions here.
4. All of it comes from **4–7 specific tasks** (conditional-probability trap, order-of-magnitude estimate, an engineering refactor, …) and **must not be extrapolated to your own tasks**.

**Where to reproduce it**: `evidence/prompt-snapshot.cjs` (dump any version's three tier prompts), `evidence/prompt-invariants.cjs` (the constraint gate: 30 positive + 4 negative assertions, including the v0.2.2 "output language follows the user's message" rule), `evidence/lab-build.cjs` / `lab-ans.cjs` (the rigs), `evidence/lab-ship.cjs` (result roll-up). Run the gate before touching a prompt; a failure means rolling that change back.

**Artifact-level verification (single-file HTML, independent audit, no browser)**: H1 normals box / H2 controls / H3 audit-and-fix inverted faces, **7 artifacts per condition** — **shipped 5/7 = 71.4% vs v0.3 5/7 = 71.4% (tie)**; H1 and H2 pass in both conditions (independent audit: zero inward faces), H3 is 2/4 each and all four failures are "interface not exposed globally" (executor side; the command demanded it 4/4 times). **The artifact level currently does not discriminate between conditions** — the command side does. The verifier is self-validated: the correct fixture passes 15/15 while the inverted-winding fixture fails with `inwardFaces=12`. One-command rerun: `node evidence/artifact-check.cjs`.

**The output language follows you (really ran, not simulated)**: one run each through the host's production path — the English input `Add a rate limiter to the login endpoint.` produced **3511 characters with 0 CJK characters** (first line `First locate the login endpoint: …`); the Chinese input `给登录接口加一个限流。` produced 1353 characters with **1037 CJK** (0.766 share, first line `任务：给登录接口加限流。`) — see `evidence/lang-probe.cjs` + `lang-probe.json`; the counts come from the full-text snapshot, not the 4000-character truncated `/runs` field.

---

## 8. Implementation notes (for people who want to modify it)

- **Two halves**: `lib/index.js` (host: prompt-part assembly and the relay framing, read-only tool loop, SSE streaming runs, model catalog, state persistence, HTTP routes) + `lib/client.js` (browser: control row, model/help popovers, mini window, capture-phase interception of Enter and the send button).
- **Prompts are assembled from parts**: `V6_CORE` -> **the tier body (rendered from the axes: `depth` / `sequence` / `budget`)** -> the observer context block -> **the downstream-shape declaration block (when `delivery=ptc`)** -> the deliverable-addressee contract (`OUTPUT_ADDRESSEE_CONTRACT`), composed by `buildSystem(tier, { historyMode, observerBlock, delivery })` (on the tool path an **evidence ledger**, `renderEvidenceLedger`, is injected alongside the tool results) — every rule exists exactly once, so one edit applies everywhere.
  **Invariant**: `delivery` only projects `sequence` (procedure vs checklist) and `budget` (unlimited vs as-long-as-needed), and **never touches `depth` / `enrich` / `grounding`**; with `delivery=chat` all three tiers render **byte-identically** to before (`evidence/snapshot-v6-prompts.cjs --compare`). Measured lengths (observer block included): High **2542** / Ultra **2687** chars. (`RELAY_IDENTITY` / `FACT_RULES` / `PROCESS_RULES` are v4/v5 legacy constants, used only by rollback strategies.)
- **How the i18n works**: the client reads DSH's `locale` service (`getSnapshot().active` is `zh` / `en`) and subscribes to changes; the `EN_TEXT` table is keyed by **the Chinese source string** (179 entries), and an unknown key is returned unchanged, so a missing translation shows Chinese rather than a blank; if the locale service is missing it falls back to Chinese.
- **Interception happens in the capture phase** on `window` (before React and the editor's own handlers): `Shift+Enter`, `/` commands, empty drafts, attachments-only, and Enter outside the composer card all pass through.
- **The official send path is untouched**: confirming uses the official `inputActions.setDraft()` + `submit()`, exactly the same route as a manual send.
- **Self-checks**: `evidence/` contains reproducible checks (`range-demo` for the sliders, `help-demo` for the help panel staying inside the viewport, `i18n-demo` for bilingual assertions with `en` and `zh` forced); `ACCEPTANCE.md` is a cell-by-cell acceptance checklist; `evidence/*.jsonl` holds the machine traces (client beacons, telemetry, comparison data).

---

## 9. Privacy and boundaries

- Optimization requests send **the text you typed** plus the **session context** read according to your settings (turns / full text, see the next bullet). While **read-only access** is on (the default), the High and Ultra tiers also use `read/glob/grep` to **read project files** — confined to the working directory of **the session this run belongs to**, **no writes, no command execution**; the Low tier never reads the project.
  **Identity layer**: the session, its working directory and the downstream shape are resolved exactly once, and **nothing is ever guessed**: when they cannot be resolved, no tools are dispatched, no observer context is injected, and the shape falls back to chat (a pure requirement restatement — the plugin will never pass another session’s directory contents off as facts about your project). The decision is visible in `/runs` under `context` / `toolRoot`.
  **Evidence layer**: only paths and symbols **actually read during this run** may be written as facts (an evidence ledger is injected alongside the tool results); listing a directory is not knowing its contents; if nothing was read, no facts/status section is written at all.
- The context modes read **this session's** history according to your setting: turns mode carries only your own words; full-text mode carries both sides verbatim (capped by the 60k-character budget, dropping whole turns when over it).
- The mini window sends nothing by default: only "Confirm", "Auto" and "Send as-is" hand content back to the official send path.
- The plugin is a local client + host plugin and talks to no third-party service.

---

## 10. License and collaboration

**BSD-3-Clause**. Fully open source: **anyone** may use and modify it **in any form**; issues, pull requests and all kinds of testing feedback are welcome. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
