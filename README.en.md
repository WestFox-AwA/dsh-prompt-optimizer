# dsh-prompt-optimizer **v0.6.8-beta.1** · Prompt Optimizer (DSH Web plugin)

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

[中文](README.md) ｜ **English**

> ## ✅ The latest version is **0.6.8-beta.1**, and it is this repository's **mainline** (the default branch `main` carries it)
>
> | Line | Version | Status | Where |
> |---|---|---|---|
> | **0.6 (mainline · latest)** | **`0.6.8-beta.1`** | **Mainline** — this is what you install now. The capability is still experimental (internally self-consistent **with evidence**; **no effect evidence** — the holdout evaluation only finished stage S1).<br>**0.6.8-beta.1 — three things**: ① **goals are generated per round, never inherited** — each round retires the previous round's items (kept for the record, not deleted), so the packet is rebuilt from *your message this round* plus *the context read this round*; ② **the operating surface is aligned with 0.5** — tier `off/light/standard/heavy`, a two-row control bar, a `?` user manual, an intercept overlay split into a **thinking pane** and an **output pane**, a thinking pane with a **fixed height, no scrollbar and no truncation** (scrollable), and token counting from the provider's **real reported usage** split into input/output/cache (k/M; `—` when nothing is reported; never estimated); ③ **the read-only-tools failure class is fixed at its roots** (identifier typo `TOOL_SYSTEM_NOTE is not defined`; a malformed source ref used to kill the whole patch; `provenance:'machine'` never fired).<br>**Known cost**: long-lived constraints no longer carry across rounds — they are re-derived from the context each round, so do not shrink the *context* window too far. | **[Install it → `po06/README.md`](po06/README.md)** (direct download + step-by-step + self-check) · [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md) · [`po06/RELEASE-CHECKLIST.md`](po06/RELEASE-CHECKLIST.md) · **[Release v0.6.8-beta.1](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.6.8-beta.1)** |
> | **0.5 (previous generation · still usable)** | `v0.5.1-beta.1` | **No longer updated, but still works**; design and usage live in [`SPEC.md`](SPEC.md) and in [the appendix below](#appendix-the-05-line-previous-generation-still-usable). | [`SPEC.md`](SPEC.md) |
>
> ### Install 0.6.8-beta.1 in 30 seconds (copy-paste; step-by-step + self-check in [`po06/README.md`](po06/README.md))
>
> ```powershell
> $v = '0.6.8-beta.1'; $d = "$env:USERPROFILE\Downloads"
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

---

## Appendix: the 0.5 line (previous generation, still usable)

**The UI follows DSH's language setting**: set DSH to Chinese and everything is Chinese; set it to English and everything is English (it is no longer Chinese-only). **The mainline 0.6.8-beta.1 targets the same `dsh-0.1.6-alpha.1`** as the 0.5 line (verified on this machine end to end: download → create profile → install → assembly self-check, see the install drill in `po06/RELEASE-CHECKLIST.md`).

---

## ⚠️ Five points to read first (author's statement)

1. **The purpose of this plugin is to optimize prompts** — to save the time you would otherwise spend writing them, and to help you convey your intent more accurately. In essence, it gives the AI **one extra step of self-planning and self-constraint**.
2. It has a **clear effect on capable-but-prompt-sensitive models** such as **DeepSeek-V4.1-Flash** — models that are strong, yet whose performance is heavily influenced by how the prompt is written.
3. The author has **only tested this plugin on some OneShot-type tasks**. Every number in section 7 comes from **specific test items scored by a specific rubric**; it **does not mean your own tasks will improve too**. **Please keep a conservative view of its practical value.**
4. This plugin is **fully open source**: **anyone** may use and modify it **in any form**, and **suggestions and all kinds of testing are welcome**.
5. **Language and compatibility**: the interface **supports both Chinese and English**, following DSH's *Settings → General → Language* (`zh` / `en`, switching takes effect immediately). **The 0.5 line's current version (`v0.5.1-beta.1`) and the mainline `0.6.8-beta.1` both target `dsh-0.1.6-alpha.1`.** Read [DSH-COMPAT.md](DSH-COMPAT.md) before upgrading DSH — it records the interface audit, the upgrade steps, and the post-upgrade acceptance results.

---

## 🆕 What's new

### v0.5.1-beta.1 — this release: **measured capability facts** (measured, never guessed)

- **Root cause (reproducible from session logs)**: the work AI has **no measured statement of what its own session can actually do**. Its only evidence is the one attempt it just made — and three failures look **identical** to it: ① a real denial (confined mode: `Program 'msedge.exe' failed to run: Access is denied`); ② **fake failure · async file landing** (the browser launcher returns in 106 ms while the screenshot lands 0.3–1 s later, so checking immediately says `NOFILE`); ③ **fake failure · swallowed flags** (an already-running browser instance takes over and answers with a Chinese "opening in the existing session" line).
- **Evidence**: in session `04ade894` the browser was really denied at 06:54 under the confined mode, **you switched to danger-full-access at 07:05**, and at 07:24 it still reported "the local sandbox forbids launching a browser" — **18 minutes without a single retest**. In `4cd41964`, already at full access, it still requested an escalation and got `sandbox escalation … is not strictly wider` (reads like "you are not authorized", actually means "you are already at the top mode"). Meanwhile the confined-mode warning paragraph in the tool description (named pipes EPERM, ConstrainedLanguage, `.NET/Add-Type`, escalation approval) is gated on `escalationModes.length > 0` — **unrelated to the current mode** — so in a full-access session it is entirely false while being far longer than the single true sentence.
- **Fix (task-agnostic mechanism)**: inject a small **measured fact block** into every session at every assembly — ① permission mode + approval (`never` = **nothing needs approval**, not "no permission"); ② three **channels** measured for real: `subprocess` / `visual screenshot (headless browser)` / `external tool servers`, with **raw reasons** on every ✗; ③ one general rule: **a failure is not a conclusion** (only an immediate retest counts; a mode or environment change invalidates earlier conclusions; anything auto-verifiable **must not be handed back to the user**).
- **Measured across all three modes (same machine, same minute)**: `danger-full-access` → subprocess ✓ · screenshot **✓ (3797 B in 1 s)**; `workspace-write` → subprocess ✓ · screenshot **✗ (`Access is denied`)**; `read-only` → subprocess ✓ (**constrained language mode**: no .NET/Add-Type/COM) · screenshot ✗. Diagnostic route: `/prompt-optimizer/api/capability?sessionId=…&probe=1[&mode=…]`.
- **Why this is architecture, not a browser patch**: what gets injected is **channel state**, not a recipe for one task — change the environment and only the channels change (Godot MCP disconnected → external tool servers ✗), while the mechanism stays. It removes wrong statements in both directions: full access no longer "thinks it has no permission", confined modes no longer "think they can do anything".
- **Engineering constraints**: probing **never blocks assembly** (first render returns in <20 ms, results land on the next step); the cache key is the **mode** (so **a mode switch always retests** — that stale conclusion was the root cause); TTL 10 minutes; the probe script itself encodes the three traps (private `--user-data-dir`, software rendering, **polling for the file to land**).
- **Baseline note**: tier strategy is back on **0.4.4** (see [SPEC.md](SPEC.md) §0″), the ask mechanism is §0‴ and this mechanism is §0⁗; the 0.4.4 body text is **unchanged by one byte** — capability facts travel on the **runtime fact channel**, not in the strategy text.
- **Falsifiable verification**: `evidence/verify-capability-facts.cjs` (25/25); all existing suites green (tier strategies, context scope, read-only tools, ask, closing self-check, length gate, i18n 201/201, DSH compat 19 probes).

### v0.5.0-beta.1 — this release: architecture baseline v0.5 (evidence carrier + gap filler)

- **Why**: earlier rounds only added rules about how the optimizer *presents itself* (tier axes, shape projection, identity layer, i18n, char-count baselines), and every check was **self-referential** (projection unchanged, clauses present, counts match) — **not one of them answered "can the downstream get it right in one pass?"**. The real failure was "half the time it cannot even hit the stated goal; the tank had rendering problems" — a **capability + single-pass execution** problem, not a wording problem. For this model class the prompt is not advice but an **instruction set**.
- **Contract rewritten (the cut)**: `V6_CORE` is now 【premise / evidence / five gaps only / scope / ambiguity / never write / language】. Removed: the "output structure: goal → current facts → steps" template, "acceptance (≤3 checks, machine-decidable)", and all **pointless** verification boilerplate.
- **Tiers = evidence budget**: Low = your words + context (① ②); High = reads project files as needed (all five gaps); Ultra = deep read + cross-check (**a source on every change** + positive enrichment). `depth` is re-anchored to `precise` / `grounded` / `exhaustive`; model, reasoning effort and the context switch are **decoupled from the tier**.
- **Context (W1b)**: read **only** the session you name; range is decided **only** by Turns (0–10, your turn + the AI's = 1 turn, 0 = read nothing) or Full-text (the same projection the working AI sees); over budget it compresses presentation only, **never the range**, and always says what it compressed; unresolvable session → **no injection at all** (the old "fall back to the first session in the list" path is gone); the block always declares the **observer** stance.
- **Evidence index**: tool results are split by **evidence type** — files whose *content* was read, grep *hits* (`path:line`), and files merely *listed* (existence only, never their contents).
- **First-pass acceptance rate (the only target metric)**: `POST/GET /outcome` plus the mini-window **It worked / Needs rework** buttons — a human verdict, never inferred.
- **Falsifiable checks**: context-scope unit test **13/13**, `audit-provenance.cjs` (any path in the deliverable must exist in the evidence index; a factual claim without a source is a defect), `compare-referent.cjs` (the same "fix this bug" with and without context), and baseline re-freezing now **requires `--reason`**.
- **Measured on this machine**: real-scenario A/B/C **9/9**; same-question comparison **468 chars with context / 578 without** (both open by declaring the referent was not found, then give **one** minimal discovery action) where the previous build produced **2201 / 1009** chars of generic filler; provenance audit of a real task: 2344 chars, 22 items, **0 unsourced facts**.

### v0.4.6-beta.6 — this release: root-curing "false facts" (identity + evidence + contract layers)

- **The defect (measured on a real project)**: the read-only tools read **another session’s directory** (`C:\Users\WestFox\.dsh`, not the session this run belonged to), yet the deliverable wrote what it saw there as **"verified facts"** ("no project files exist in the working directory... only `attachments/v1/objects/**` binaries") — so the downstream AI stopped looking at the real project. The same sentence also produced **mutually contradictory hard constraints** across runs (one allowed CDN three.js, another forbade `https://` outright, i.e. demanded a hand-written WebGL renderer the user never asked for).
- **Identity layer**: session / working directory / downstream shape are resolved **exactly once**, from the sessionId reported by this run; **nothing is ever guessed** — when they cannot be resolved, no tools are dispatched, no observer context is injected, and the shape falls back to chat (a pure requirement restatement, i.e. 0.4.3 behaviour), **never false facts**. The decision is auditable in `/runs` under `context` / `toolRoot`.
- **Evidence layer**: only paths and symbols **actually read during this run** may be written as facts (an evidence ledger is injected alongside the tool results); **listing a directory is not knowing its contents**; if no file content was read, no facts/status section is written at all.
- **Contract layer**: two new structural clauses (facts must have a source; write only what the downstream cannot know by itself) and the ambiguity rule now reads "**a conservative reading must not escalate into new hard constraints**" (the user’s silence is not a prohibition). Prompt changes are auditable line by line (`evidence/diff-v6-prompts.cjs`) — this round only adds those clauses and widens the ambiguity one.
- **Stop-the-bleeding lever**: the strategy can be switched **at runtime** (state key `strategy` or `DSH_PO_STRATEGY`); `strategy=v5` returns to 0.4.3’s pure requirement restatement for side-by-side comparison and fast rollback, with no code change.
- **Measured** (your own sentence, your own session directory): tool root = that session’s directory (no longer `.dsh`) ✓; false facts, "verified" claims and any facts section **all gone** ✓; no more blanket `https` prohibition ✓; without a sessionId, `readTools=false`, chat shape, and the observer states why ✓; the same request under v5 = a 1428-char pure requirement restatement (the control) ✓.

### v0.4.6-beta.5 — this release: reasoning effort **actually takes effect** (with a guard and a falsifiable check)

- **Wiring**: the live optimization path **never sent** `reasoningEffort` (only the internal self-check path `streamOnce` did), so the popover level was decorative and `/runs.effort` recorded the configured value only. It is now really sent, and `/runs` additionally reports **`effortSent`** (what was actually sent) and `effortNote` (why nothing was sent).
- **Guard**: the field is sent **only when the model actually declares that level** — a leftover level from a previous model can no longer make a real optimization fail. Seven branches are pinned by a deterministic unit test (including "declares levels but not `max`", which this machine’s model catalog cannot produce).
- **Measured** (same request, 4 runs each; `evidence/effort-live.json`): the `off` group produced **0 / 0 / 0 / 0 chars** of reasoning, the `max` group **3260 / 1974 / 2193 / 2274 (median 2234)**, with `effortSent` of `"off"` / `"max"` respectively — a **categorical difference**, proving the field reaches the model.
- **A previous conclusion corrected**: v0.4.5 reported "off avg 8745 / max 8300, behavioural difference not yet demonstrated" — those three groups **actually sent exactly the same thing**, so the difference was pure noise; the corresponding README history entry now carries a correction note.
- The popover hint gained "not sent when this model does not declare the selected level". Nothing else moved: with `delivery=chat` all three tiers still render **byte-identically** (15/15), and the projection invariant plus i18n parity regressions all pass.

### v0.4.6-beta.4 — this release: downstream-shape projection (one tier definition, two consumer shapes)

- **The essence**: PTC punishes **procedure**, not **depth**. "Very detailed" and "broken into steps" used to live in one field, which made "fit PTC better" look like "weaken the Ultra tier". Split them and nothing has to be weakened.
- **How**: the tiers are now described by five axes (`grounding` / `depth` / `enrich` + **`sequence`** / **`budget`**); `delivery=ptc` **projects only the last two** — **checklist instead of procedure, as-long-as-needed instead of unlimited** — while `depth` / `enrich` / `grounding` stay untouched.
- **Detection**: it reads the session’s agent preset (the shipped `ptc` preset) and switches automatically; you can also pin it in the Optimizer-model popover (Auto / Chat / PTC). A read-only `/delivery` route reports what it decided and why.
- **Zero regression**: with `delivery=chat` all three tiers render **byte-identically** to before (3 tiers x 5 inputs = 15/15, `evidence/snapshot-v6-prompts.cjs --compare`).
- **Measured** (same 10 tasks, Ultra tier, no tools, **two independent samples**): **robust** — process overhead 0.4 / 0.2 -> **0.1 / 0**, stepwise 0.4 / 0 -> **0 / 0.2**, acceptance criteria 0.5 / 0.7 -> **4.5 / 5.7** (that metric’s noise sd is only 0.75, so the gap is 6-8x), and **8 of 10 tasks improve in a paired within-batch run** (mean +5.8). **Not robust** — the composite score and the length: this yardstick’s cross-batch noise exceeds its effects (item-count sd 9.85, composite score +/-3.2), and ptc’s 9.9 / 6.12 overlaps chat’s 3.6 / 6.93, so those are **not claimed**.
- **Tier ordering survives** (the projection does not flatten the tiers): within the ptc shape, item counts are Ultra **31.6** > High **22.3** > Low **18.3**.
- **A real defect fixed along the way**: the output budget is now a single source plus a **stall watchdog** (abort only after 45s with no delta; 240s hard ceiling). The old fixed 60s wall-clock cut requests that were still streaming healthily into **half commands** — after the fix, **42 runs in a row finished with zero aborts**, one of them at 10929 chars after 127 seconds.
- **Honest boundary**: this yardstick’s **cross-batch noise exceeds its effects** (the same prompt varies by sd 9.85 items between batches), so every conclusion here comes from paired-within-batch or byte-identical structural facts, never from cross-batch comparisons.

### v0.4.6-beta.3 — this release: fixes "no reasoning visible on High/Ultra" + help-panel text aligned + README claims synced

- **Fix (reasoning pass-through)**: the tool loop called the stream helper without `onDelta`, returned only a reasoning *character count*, and the tool branch hard-coded `reasoning` to an empty string — three breakpoints that left the **Thinking pane permanently empty on High/Ultra** (Low never enters the tool loop, so it always worked). Reasoning now flows through **the same channel as the no-tools path**; the **three tier definitions are untouched** (grounding / decompose / enrich and temperature unchanged). Measured: reasoning chars Low 3333, High **0 -> 2817**, Ultra **0 -> 7396**; a real in-browser Ultra run shows the Thinking fold summarised as **`— tok · 6497 字`**.
- **Help panel (question-mark popover) aligned with real behaviour**: that section still described the v0.2.1 / v5 rules ("substance first / process weight / hard constraints / no over-process"), which are the **opposite** of v6’s "no process ritual, no generic teaching". It now describes the three tiers (and notes that **all three show their reasoning in the Thinking pane**), read-only access (on by default), what the optimizer does (addressee / language layer / fidelity / ambiguity / output-is-the-command) and context (turns = last 0–10 turns **with both sides verbatim**; over budget it compresses in six stages and says so). The panel renders **7 sections / 24 rows in both languages**, and the `i18n-demo` self-check passes in both.
- **README claims synced with measurements**: six stale statements fixed in both languages — "writes no steps / no acceptance checklist" (the opposite of what High/Ultra do), "system prompt 515 chars / output 422 chars" (measured: High 2542 / Ultra 2687 chars), "assembled as `RELAY_IDENTITY` -> ... -> `PROCESS_RULES`" (v4/v5 legacy), and "sends only your text plus a directory-tree summary" (that block is never injected on the live path).
- Version numbers: the doc title, the tgz filename in the install example and the in-panel credit are all **0.4.6-beta.3**; the `releases/latest` alias link always points at the newest version.

### v0.4.6-beta.2 — this release: read-only access on by default / label & position / the deliverable’s addressee (root fix)

- **Read-only access is now on by default**: a **missing key means on**; only an **explicit `false`** counts as off (an explicitly saved value is never rewritten). Measured: delete the key and `/state` returns `true`; a run with no explicit arguments made **6 real tool calls**; explicit off = 0 calls with a 4000-char result.
- **Label & position**: the label is now **"只读权限："** (`Read-only access:` in English) with the switch moved to **the right of it on the same line**; the explanation stays on the next line. Measured in the real DOM: `sameLine=true / dy=0 / btnRightOfLabel=true / overflowRight=-25` (no overflow, no clipping).
- **The deliverable’s addressee (root fix)**: the contract only ever demanded that the content read like a sendable command — it **never defined who the deliverable is addressed to**, so the model would write **things meant for the boss** ("forward this whole block to the working AI…"), which misleads the downstream AI when pasted verbatim. Two layers now fix it: the **contract layer** writes the addressee into the system prompt (all strategies), and the **gate layer** strips leading/trailing relay phrases and wrappers at the single output exit (legitimate body text such as "copy to…" is never touched; if fewer than 20 chars would remain, the original is kept — **never an empty result**), with `done.text` as the authoritative final text.
- Measured: re-running the exact sentence that failed produced **`no-hit` (the relay phrase was never generated)**; the gate’s judge self-test passed **13/13** (every bad case intercepted, every gold case untouched); a forced tool-chain failure fell back to the no-tools path and still produced **3816 non-empty chars**.
- Hard constraints: read-only access is **on by default** (superseding the previous release’s off-by-default); every failure **degrades** and **never returns an empty result**. Degradation is recorded in the run record (`/runs`), **not inside the deliverable** — that would be talking to the boss again.

### v0.4.6-beta.1 — this release: read-only reconnaissance / observer context / budget & compression

- **Read-only reconnaissance**: with the popover switch on (advanced/extreme tiers), the optimizer **actually reads the project** before writing requirements. A wiring defect was fixed — a message array was passed where a string was expected, which made the provider reject the request with `messages[0].content: invalid type: sequence`. Measured: ON = 10 real tool calls with real directory facts; when it finds nothing it **says so instead of inventing**.
- **Observer context**: the optimizer can now watch the session like a bystander — sourced from the session **projection** (what the session model actually sees), not event replay. `turns` = last 10 rounds with **both sides in full**; `full` = the whole projection; `off` = disabled. It enters via a **structural parameter into the system prompt**, so your own words stay untouched.
- **Budget & compression**: when context exceeds the budget it is **compressed in stages** and the injected text **states what was compressed** (e.g. "kept the last 4 rounds, assistant replies truncated to 600 chars") — nothing is dropped silently. Measured 24672 -> 2860 and 35232 -> 2855 chars, still referencing real history afterwards.
- Hard constraints: the read-only switch is **off by default**; every failure **degrades** (tool path falls back to normal optimization, observer simply not injected) and **never returns an empty result**.

### v0.4.5-beta.2 — this release: text overflow fix for the effort row

- **UI fix**: the "Optimizer reasoning effort" row reused `.dpo-pop-foot` (no `flex-wrap`) plus `.dpo-btn` (`flex:1`), so five levels pushed the text outside the popover. It now uses dedicated `.dpo-effort-row` / `.dpo-effort-btn` styles: **wrapping + ellipsis + `max-width:100%`**; level labels keep only the level name ("(model default)" moved into the tooltip) and a separate line shows "unset uses the model default: x".
- Structural check: `text-overflow:ellipsis` in 8 places, `max-width:100%` present, `dpo-effort-btn` markup in place, and zero leftovers of the old `dpo-pop-foot` + effort-row combination.
- Feature re-verified: 2 real runs per level; the `effort` recorded in `/runs` matched the setting every time (off/off, max/max, empty when unset) — the fix did not disturb the setting path.
- Behaviour (reasoning chars) is still noise-dominated (off avg 8745 / max 8300 / unset 2788), so **still no conclusion**; this provider does not report reasoning tokens.

### v0.4.5-beta.1 — this release: optimizer reasoning effort is selectable (works for every model)

- **New**: the optimizer-model popover gains an "Optimizer reasoning effort" row. The levels come from what the **model itself declares** (`llm.resolveModelInfo` -> `reasoning.efforts` / `defaultEffort`) — nothing hard-coded; a model that declares none shows "keeping the model default".
- Semantics: `Model default` = do not set explicitly (use the adapter default; measured `high` for deepseek-flash); other entries are explicit levels. Switching to a model that does not support the chosen level falls back to "model default" so the next call is never rejected.
- How it reaches the call: `llm.stream({ provider, model, reasoningEffort, ... })`; when unset the field is not sent (historic behaviour preserved). Each run now records `effort` in `/runs` so the setting can be audited.
- Verification (`evidence/verify-effort.cjs`): across 9 real calls the recorded `effort` matched the setting every time (off/off/off, max/max/max, empty when unset); at the adapter level `resolveCallConfig` preserves off/low/high/max and rejects an invalid value outright -> **the setting does reach the model call**.
- Honest caveat: this provider **does not report reasoning tokens**, and single-run "reasoning chars" are very noisy (1956-10377 within one level), so a behavioural difference in effort is **not yet demonstrated**; measuring it needs more repetitions or a provider that reports reasoning tokens.

> **Correction (2026/09/18, 0.4.6-beta.5)**: the two claims above — "how it reaches the call" and "the setting does reach the model call" — **did not actually hold**: the live optimization path (`streamWithTools`) **never sent** the field; only the internal self-check path `streamOnce` did. And the `effort` recorded in `/runs` was the **configured** value, not what was sent.
> So the observation right below (off avg 8745 / max 8300 / unset 2788) compared **three groups that actually sent exactly the same thing** — the difference was pure noise, and that caveat's premise does not hold.
> 0.4.6-beta.5 wires it up for real (`/runs` now also reports `effortSent` and, when nothing is sent, `effortNote`), and demonstrates it with a paired `off` vs `max` run on the same request: **all four `off` runs produced 0 chars; `max` had a median of 2234**. The "do not send when the model does not declare the level" guard is now enforced **server-side** (unit test 7/7).

### v0.4.4-beta.1 — this release: two reported bugs fixed (issues #9 / #8); strategy unchanged

- **#9 the composer self-heal threw a pageerror every 1.2s**: slot registrations are de-duplicated by **id**, yet the heal loop re-registered the same `id` -> `already has an entry with id "prompt-optimizer"` (changing `order` does not help).
  Fix: **dispose the previous re-registration before retrying** (keep and call the disposer returned by `ctx.slots.inject(...)`, and release it when the timer is cleared); same structure fixed for `shell.overlay`; failed re-registrations now emit a beacon.
- **#8 the session interception counter showed twice the real value**: one send travels two paths (`keydown-enter` plus the resulting `click-send`), recording two rows each time.
  Fix: the complementary row is marked `coalesced` (telemetry kept), and a new `interceptCount()` feeds the three display sites; self-tests and telemetry still use the raw row count.
- Release tooling: new `gh-api publish` (versioned asset + **version-less alias asset** + mark latest + read-back check) and `fix-tags.cjs` so a tag's `package.json` version matches its tag name (v0.4.1-v0.4.3 were all mismatched; now corrected and re-verified).

### v0.4.3-beta.1 — this release: a requirement completer (0.4 line)

- **Strategy replaced**: from a rewriter (0.1) to a requirement completer (0.4) — a single 10–200 character request becomes a complete, concrete statement of what is wanted (object, result, usage situations, edges, scope).
- **No workflow**: no steps, no acceptance checklist, no verification discipline, no prohibitions — those are the downstream AI's own abilities; writing them costs attention budget and narrows the solution space.
- **Size**: the system prompt is assembled per tier; measured (including the 1654-char observer context block) High **2542** / Ultra **2687** chars (the 0.4.3 era: 515); output for the same request Low **306** / High **2008** / Ultra **3954** chars, with zero process-ritual prose.
- Derivation and measurements: `evidence/ARCHITECTURE-v5.md`; per-version details: `CHANGELOG.md`.

Author: **啃轮胎的西狐** · version **0.4.6-beta.6** · date **2026/09/18** (the same credit also sits at the bottom of the in-plugin `?` panel)

📦 **Download**: installable `.tgz` packages are attached to this repository's [Releases](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases) (see the next section for installation).

---

## 1. Installation

### Option A — install it like any other DSH plugin (recommended)

Two steps: install the package into your profile, then register it as a bundle layer.

```bash
# 1) install the package (GitHub repo / tarball / local dir all work)
#    Prefer the releases/latest link: it always points at the current version
#    (older prereleases never take it over)
dsh plugin --profile web add https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/latest/download/dsh-external-dsh-prompt-optimizer.tgz
#    or pin a version (replace <version>, e.g. v0.4.3)
dsh plugin --profile web add github:WestFox-AwA/dsh-prompt-optimizer#<version>
dsh plugin --profile web add ./dsh-external-dsh-prompt-optimizer-0.4.6-beta.6.tgz

# 2) add one line to dsh.profile.bundles in ~/.dsh/profiles/web/package.json:
#      "@dsh-external/dsh-prompt-optimizer"
```

> **Download page**: <https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/latest> — always the current version.
> For older builds, browse the `releases` list by tag.

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
