# dsh-prompt-optimizer **v0.2.2-beta.1** · Prompt Optimizer (DSH Web plugin)

> **Latest measurement (v0.3.1-beta.1, same-caliber n=2)**: command side, 10 complex tasks / max 180 → **169 (93.9%)**; shipped build 127 (70.8%); no-optimization 4 (2.2%). Paired **9W / 0L / 1T**; per-cell noise 0.83 points of 18 on average (max 4). Simple-task regression: zero leakage (0/4), command length **0.39x** (shorter than shipped), no extra process demands. Scoring is a 0-3 four-level rubric graded deterministically (no extra LLM calls).
> **Command-side sub-metric (v0.3.4-beta.1)**: does the command demand a unified self-check entry + return shape + real run output — same 60 cells: **v0.3.4 100% complete (20/20) vs shipped 0% (0/20)**; same-batch total 91.9% vs 69.2% (paired 9W-0L-1T, noise 0.87 of 18). The sub-metric measures whether the requirement is written into the command; executor-side landing rate is the artifact metric.
> **H3 credible measurement (v0.3.6-beta.1, after fixing the rig)**: audit-and-fix inverted mesh, 2 artifacts per condition — **v0.3.6 4/6** (one full score, one "claimed fixed but 24 inward faces measured") vs **shipped 0/6**. Combined 0-3 tier metric across three tasks: **v0.3.6 16/42 = 38.1% (8/1/0/5) vs shipped 0/42 = 0%**. Small sample (n=2); supporting evidence only.
> **Second artifact-level metric (0-3 tiers, v0.3.4-beta.1)**: 3 = unified self-check entry + independent normals audit + all criteria pass; 2 = entry + audit pass; 1 = entry present but audit failed; 0 = no entry. Three tasks x 4 artifacts: **v0.3.4 12/36 = 33.3% (distribution 8/0/0/4) vs shipped 0/36 = 0% (12/0/0/0)**; per task H1 6/12, H2 6/12, H3 0/12 (H3 is the unconquered frontier). Small sample; supporting evidence only.

> ### 🌐 [**阅读中文文档 →**](README.md)
>
> Jump to the Chinese README (which has a jump button back to English at its top)

[中文](README.md) ｜ **English**

**The UI follows DSH's language setting**: set DSH to Chinese and everything is Chinese; set it to English and everything is English (it is no longer Chinese-only). **This version targets `dsh-0.1.6-alpha.1`** (`0.1.5-rc.1` also works).

---

## ⚠️ Five points to read first (author's statement)

1. **The purpose of this plugin is to optimize prompts** — to save the time you would otherwise spend writing them, and to help you convey your intent more accurately. In essence, it gives the AI **one extra step of self-planning and self-constraint**.
2. It has a **clear effect on capable-but-prompt-sensitive models** such as **DeepSeek-V4.1-Flash** — models that are strong, yet whose performance is heavily influenced by how the prompt is written.
3. The author has **only tested this plugin on some OneShot-type tasks**. Every number in section 7 comes from **specific test items scored by a specific rubric**; it **does not mean your own tasks will improve too**. **Please keep a conservative view of its practical value.**
4. This plugin is **fully open source**: **anyone** may use and modify it **in any form**, and **suggestions and all kinds of testing are welcome**.
5. **Language and compatibility**: the interface **supports both Chinese and English**, following DSH's *Settings → General → Language* (`zh` / `en`, switching takes effect immediately). **The current plugin version (v0.2.2-beta.1) targets dsh-0.1.6-alpha.1.** Read [DSH-COMPAT.md](DSH-COMPAT.md) before upgrading DSH — it records the interface audit, the upgrade steps, and the post-upgrade acceptance results.

---

## 🆕 What's new

### v0.3.0-beta.1 — this release: complexity capability pack (detail-level correctness)

- For complex work (one-shot large scenes, detailed drivable models, data migrations, concurrency, performance budgets) the command must now enumerate the **failure modes of that domain as checkable requirements**: normal orientation and visible faces, axes/units, collision matching the mesh, input mapping with feedback, recoverability and configurability, idempotency and rollback, request de-duplication and lock ordering, boundary data, performance budget vs. visual quality.
- Plus: quantify the symptom first (numeric audit + visual comparison), a global acceptance scenario, a no-downgrade list, scope boundary and rollback path, and a definition of done with required evidence. **Detail requirements must not become process overhead** (goal/todo demands still follow the process-length rules only).
- Measured (8 complex tasks x 2 samples = 48 cells): **no optimization 2.1% / shipped 69.8% / this build 92.0%** (132 of 144), paired 7 wins / 0 losses / 1 tie, noise +-0.75 points per 18, whole suite in 230 s; simple-task regression: zero leakage, length 1.11x. See section 9 of PROMPT-OPTIMIZATION.md.

### v0.2.2-beta.1 — internationalization + two real defects fixed

> In the English UI the four tiers are named **Off / Low / High / Ultra** (Chinese UI keeps 关闭 / 普通 / 高级 / 极端).

**1. UI internationalization (the main feature of this release)**
- The whole plugin UI is **bilingual (Chinese / English)**: control row, context slider and its *Turns / Full-text* button, model popover, mini window (buttons and status row included), help panel, notifications and the credit line.
- The language **follows DSH's setting** (`zh` / `en`) and switches live — no restart. If the locale service is unavailable it falls back to Chinese, and a string that has no translation is shown in Chinese as-is, so **nothing ever renders blank**.
- **The output language follows you too**: an English request produces an English command throughout (headings and list items included, no Chinese/English mixing); a Chinese request produces Chinese.

**2. Two "push the work back to the user" defects fixed** (prompt layer, from real usage feedback)
- ① Unknown *project facts* (which file, which function) used to be written as "**stop and wait for the user to confirm**" — that is wrong: what can be looked up should be looked up. The prompt now separates **unknown project facts** (go find out; if the lookup fails, carry the findings forward and keep going) from **unknown user intent** (the only case where asking is allowed).
- ② Design choices were over-delegated: the model used to fire off a **7-item confirmation questionnaire**. It now **decides what it can decide** (stating the trade-off), asks **at most 1–2 questions** and only with recommended defaults, and always provides a "keep going even if the lookup fails" fallback path.

**3. Fixed "the prompt got worse than 0.1.1"** (reported by a user, and real in measurement)
- The "substance first" block was moved back to the front and the compliance rules were trimmed and moved later: Low 1319 → 1172 characters, High 1857 → 1815, Ultra 1877 → 1813 — **shorter and stronger in paired comparison** (see section 7).

**4. Fixed a second message being auto-sent after "Send as-is" / "Roll back"** (it appeared in the session as a queued message)
- A run that the user has settled (released / rolled back) is now marked terminal, so both the auto-send and the completion branch skip it; releasing also aborts the backend run.

> v0.1.9 and later also brought: the dual context modes (Turns 0–10 / Full-text toggle), the flattened minimal control row, and the DSH 0.1.6 history-reading adaptation (session-event projection + one-time seeding).
> The complete change list is in [CHANGELOG.md](CHANGELOG.md); every prompt-layer change (location → before → after → intent → evidence) is in [PROMPT-OPTIMIZATION.md](PROMPT-OPTIMIZATION.md).

---

## What it does

The moment you press Enter in the composer, your message is **not** sent directly — a **second AI (a "relay")** first turns it into a **command that can be sent to your working AI as-is**, and you decide whether to send it after seeing the result.

- It is a **relay, not a chat partner**: the optimizer AI knows it is "conveying the user's intent to the working AI". It does **not answer you, does not do the work for you, and does not ask you questions**. Its output is the command body itself (no meta sections such as "Optimized prompt / Change log"), ready to be pasted to the downstream AI.
- The optimizer **model, tier and permission are independent of your conversation** — your chat model is never touched.
- **Tier and permission are per-session**: setting session A to "Ultra + Auto" leaves session B untouched.
- The mini window is **session-isolated**: a window triggered in A never pops up in B, and comes back as-is when you return to A (if it is still waiting for your decision).
- **Process weight is decided by difficulty**: the optimizer judges the weight first and writes both the verdict and its reason into the command — **light** = "just make the change and run the check; do not create a goal or todos, do not write a plan"; **medium** = "list 3–6 todos, work through them in order and tick them off"; **heavy** = "create a goal first (one-line objective + observable acceptance), then advance in stages, verifying before each next stage". When a hazard signal is present (irreversible/hard to undo, schema or persisted-data changes, credentials, release/deploy, external API compatibility, cross-module work, nothing existing can verify it) the verdict must not stay at "light"; **without such a signal it must not escalate, and long wording alone is never a reason to escalate**.
- **Constraints come out as decidable hard requirements**: must-do / must-not-do / must-hold-when-done, each with its own violation handling, and no bypassable soft wording such as "try to" or "it would be better to".

Author: **啃轮胎的西狐** · Version **0.2.2beta1** · Release date **2026/09/15** (the same credit appears at the bottom of the in-plugin `?` panel)

📦 **Download**: installable `.tgz` packages are attached to this repository's [Releases](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases) (see the next section for installation).

---

## 1. Installation

### Option A — install it like any other DSH plugin (recommended)

Two steps: install the package into your profile, then register it as a bundle layer.

```bash
# 1) install the package (GitHub repo / tarball / local dir all work)
dsh plugin --profile web add github:WestFox-AwA/dsh-prompt-optimizer#v0.2.2-beta.1
dsh plugin --profile web add ./dsh-external-dsh-prompt-optimizer-0.2.2-beta.1.tgz

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

> The controls left of the composer, from left to right: **Tier** (slider), **Permission** (slider), **Context** (slider plus a **Turns / Full-text** toggle button attached to its right), **Model** (pill), followed by **Help (`?`)**. The `?` panel contains the same short tutorial plus the author credit.

---

## 3. Choosing the controls

| Control | Values | Notes |
|---|---|---|
| **Tier** | Off / Low / High / Ultra | Off = no interception at all; Low = just say it clearly (~3 s); High = **work the problem through first**, then write the necessary assumptions, steps, boundaries and acceptance criteria into the command (~20 s); Ultra = read the real project structure (read-only, never writes) + decide by difficulty whether a goal/staging is needed, and add contingencies only when an irreversible or release-type signal is present (~20 s) |
| **Permission** | Review / Auto | Review = editable output, sent only when you confirm; Auto = sent as soon as optimization finishes (**and if optimization fails, the original text is sent** — it never silently swallows your message) |
| **Context** | Turns **0–10** / Full-text **off / on** | One click on the button attached to the slider's right switches the mode. **Turns** = include the last 0–10 turns, your own words only (the working AI's replies are reduced to their length and tool-call count, so its plan and tone cannot be mistaken for your intent), 12k-character budget. **Full-text** = hand the optimizer the same context the working AI currently sees (both sides verbatim), two positions only (off/on), 60k-character budget. Both modes drop **whole turns** from the oldest end when over budget and never truncate a single constraint clause. |
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
- **Prompts are assembled from parts**: `RELAY_IDENTITY` → **substance first** → tier body → `FACT_RULES` → `OUTPUT_CONTRACT` → `PROCESS_RULES`, and the history discipline is injected according to the runtime **turns-or-full-text** mode (`buildSystem(tier, { historyMode })`) — every rule exists exactly once, so one edit applies everywhere. Current lengths: Low 1405 / High 2424 / Ultra 2422 characters.
- **How the i18n works**: the client reads DSH's `locale` service (`getSnapshot().active` is `zh` / `en`) and subscribes to changes; the `EN_TEXT` table is keyed by **the Chinese source string** (179 entries), and an unknown key is returned unchanged, so a missing translation shows Chinese rather than a blank; if the locale service is missing it falls back to Chinese.
- **Interception happens in the capture phase** on `window` (before React and the editor's own handlers): `Shift+Enter`, `/` commands, empty drafts, attachments-only, and Enter outside the composer card all pass through.
- **The official send path is untouched**: confirming uses the official `inputActions.setDraft()` + `submit()`, exactly the same route as a manual send.
- **Self-checks**: `evidence/` contains reproducible checks (`range-demo` for the sliders, `help-demo` for the help panel staying inside the viewport, `i18n-demo` for bilingual assertions with `en` and `zh` forced); `ACCEPTANCE.md` is a cell-by-cell acceptance checklist; `evidence/*.jsonl` holds the machine traces (client beacons, telemetry, comparison data).

---

## 9. Privacy and boundaries

- Optimization requests send only **the text you typed**, plus (High/Ultra) a **directory-tree summary and key file names of the current project**. Ultra-tier read-only checks are confined to the project root: no writes, no command execution.
- The context modes read **this session's** history according to your setting: turns mode carries only your own words; full-text mode carries both sides verbatim (capped by the 60k-character budget, dropping whole turns when over it).
- The mini window sends nothing by default: only "Confirm", "Auto" and "Send as-is" hand content back to the official send path.
- The plugin is a local client + host plugin and talks to no third-party service.

---

## 10. License and collaboration

**BSD-3-Clause**. Fully open source: **anyone** may use and modify it **in any form**; issues, pull requests and all kinds of testing feedback are welcome. See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md).
