# dsh-prompt-optimizer **v0.6.8-stable** · Prompt Optimizer (DSH Web plugin)

**English** ｜ [中文](README.md)

> **It never rewrites your words.** You type as usual; before you hit send it works out *what this round actually
> needs* and hands that understanding to the working AI — your original message goes out **byte for byte**,
> the understanding rides along, every item carries a **verbatim citation**, and each round is **reasoned from
> scratch** (nothing is inherited from the previous round).
> Full guide and self-check: [`po06/README.md`](po06/README.md) · manual acceptance: [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md)

> ### Install 0.6.8-stable in 30 seconds
>
> ```powershell
> $v = '0.6.8-stable'; $d = "$env:USERPROFILE\Downloads"
> Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/download/v$v/dsh-external-dsh-po06-$v.tgz" -OutFile "$d\dsh-external-dsh-po06-$v.tgz"
> Get-Content "$d\SHA256SUMS-$v.txt"     # compare the sha256 with the tgz you just downloaded (same file as on the Release page)
> dsh --profile po061 --from-default-profile web --dump-config        # a clean profile
> dsh plugin --profile po061 add "$d\dsh-external-dsh-po06-$v.tgz"    # install
> dsh --profile po061                                                 # start (prints a tokenized URL)
> ```
>
> Afterwards set the **tier** control to `standard` or `heavy` (`off` does not intercept and injects nothing).
> The long version (4-step self-check, common install failures) is in [`po06/README.md`](po06/README.md).
> **Do not install it into the profile that carries your 0.5.x**: having both assembled makes the `DOUBLE_INTERCEPT`
> guard refuse to enable (that is deliberate), and the two **do not share configuration** (0.6's enable intent lives in
> `<home>/po06.json` and never touches 0.5's `prompt-optimizer.json`).

---

## The problem it solves

Models of this class (v4.1-flash and friends) **don't act unprompted, don't guess, and finish in one pass**:
anything you leave out that they cannot infer is **necessarily missing**, and anything you write they **will** do.
So what is missing is never "a prettier prompt" — it is **the bit of context you forgot to say and the model cannot know**.

This plugin does exactly one thing: **before you send, it fills that gap, and every line it adds can be traced back to
evidence**. It never writes the downstream's own craft (generic boilerplate, ordinary API usage, best practices,
teaching) and never writes untargeted verification boilerplate — for this class of model the prompt is not advice
but an **instruction set**.

## How it works (four steps)

1. **Intercept before sending**: your message has not reached the working AI yet (the panel shows "optimizing… N s",
   and you can hit **Skip and send as-is** at any moment).
2. **A separate call does the interpretation** (the explainer layer). Its only inputs are **your verbatim message this
   round** plus **the session context / project files actually read this round**. The output is not a rewrite but a set
   of items: what you said (with a verbatim quote), how your quality words were read, what you did not say and nobody
   could know (open items), and facts observed in the material.
3. **The host validates item by item**: every item must be traceable to a **verbatim source**; anything untraceable is
   **dropped individually and recorded** — it never masquerades as "you said that".
4. **Sidecar injection**: your message goes out **unchanged**, and the interpretation rides along as a packet for this
   round only; when the next round starts, the previous round's items retire wholesale (kept for the record, not deleted).

**Three invariants** (this is also where it differs from other tools):

| Invariant | Meaning | Not |
|---|---|---|
| **No rewriting** | the message dispatched to the working AI is the bytes you wrote | not a prompt rewriter |
| **Everything cited** | each item maps to a verbatim source, or it is dropped | not free-form completion |
| **Per-round zero base** | this round's understanding does not depend on the previous round's items | not memory/profiling, not RAG |

> **The cost, honestly**: long-lived constraints ("ship a single file", "don't touch other folders") no longer carry
> across rounds — they must be re-derived from the context each round ⇒ **do not shrink the context window too far**.
> What you get in return: "something solved two rounds ago is demanded again" cannot happen.

## What the UI gives you

One row in the input area: **Optimization options** (icon + current tier summary), a state dot, and a `?` manual.
Clicking it opens a restrained card:

| Control | Values | What it does |
|---|---|---|
| **Tier** | `off` / `light` / `standard` / `heavy` | tier = **evidence budget**. `off` = no interception, no injection (as if not installed) |
| **Permission** | `review` / `auto` | review = it shows you what it will inject and lets you edit before sending; auto = it sends as soon as it finishes |
| **Model** | follow the session model (default) or pick one | which model the explainer layer uses |
| **Context** | turns `0–10` / `full` | how much history it reads; more is better informed and slower |
| **Read-only tools** | `on` / `off` (default off) | lets it read files **inside your working directory** to check facts (read-only, no writes, no commands) |
| **Details** | — | edit the explainer prompt (undo, or restore the built-in one) |

The intercept overlay has two panes: **thinking** (fixed height, no scrollbar, never truncated, scrollable back) and
**output** (what will be injected; editable in review mode). Token counts come from the provider's **real reported
usage**, split into input / output / cache (k/M; `—` when nothing is reported; **never estimated**).

**UI language follows DSH**: set DSH to Chinese and everything is Chinese, set it to English and everything is English
(the `?` manual switches too) — there is **no separate language switch inside the plugin**. Light/dark **follows the DSH
theme** as well, switching live.

## FAQ

**How long does it take?** Typically 20–60 s (tier, context and model dependent). That wait *is* the thinking time; hit **Skip and send as-is** whenever you don't want to wait.

**Does it change my message?** No. What gets augmented is the understanding handed to the working AI; the words you send are still yours.

**Can it lose my message?** No. If interpretation fails: in `auto` it sends your original text and says why; in `review` it stops in an error state and waits for you (your message stays in the input box).

**What if it extracts nothing this round?** It **retries once**; if it is still empty it adds an honest "nothing was extracted this round" open item — **every round produces a packet** (no more "thinking finished and there was nothing").

**Does it remember the previous round's goals?** No. Each round is re-derived from *your message this round* plus *the context read this round*; see the invariants above for the cost.

**Will it invent requirements?** No. Only what you explicitly said counts as your requirement, and it must carry a **verbatim quote**; mismatches are dropped, and unsourced items are flagged in red in the UI.

**Does reading project files touch anything?** No: read-only, confined to your working directory, anything outside is refused.

**Turning it off / uninstalling?** Temporarily: set the tier to `off` (no interception, no injection). Fully: remove `@dsh-external/dsh-po06` from the profile's `dsh.profile.bundles` and `dependencies`, restart DSH; its config lives in `<home>/po06.json` and you can delete it.

## Privacy and boundaries

- **Nothing leaves your machine**: no telemetry, no callbacks. All state lives under `<home>/po06-*.json*` and `po06-state/`.
- **Read-only tools are the only file access**: off by default; when on they are read-only, confined to the working directory, and run no commands.
- **No unrelated content is injected**: the packet is derived only from this round's message and the context read this round; items whose sources cannot be verified are dropped.
- **Not enabled by default (deliberately conservative)**: the assembly-time enable gate defaults to `off`. To enable it, write
  `{"settingsVersion":1,"enabled":true,"rollout":{"mode":"all"}}` to `<home>/po06.json` (for selected sessions only:
  `{"mode":"allowlist","sessions":["<session id>"]}`). As long as the old plugin is still assembled it refuses to enable with
  `DOUBLE_INTERCEPT` — having one message processed twice is the worse failure.

## Honest status (please set your expectations here)

- ✅ **Internally self-consistent, with evidence**: **45 suites / 609 tests green** (including package self-sufficiency and
  documentation-drift gates; plus 218 mutation guards on the release-gate line).
- 📊 **The author's hands-on observation (not a benchmark)**: testing has mostly been done in a
  **DeepSeek-V4.1-Flash + PTC + PowerShell** environment. **No professional benchmark has been run**; however, across the
  usual one-shot tasks and long-task iterations the **practical results are clearly stronger than DeepSeek-V4.1-Flash
  under the same environment and the same prompt**, and a **small sample** of projects suggests it **may also reduce token
  consumption and save cost**.
- ⚠️ **The capability is still experimental** — treat it as something you can install, try, and switch off at any time,
  **not as an upgrade**.
- 📌 What `0.6.8-stable` fixes (all real-machine reports): ① "thinking finished but no packet" (empty results are
  backfilled ⇒ every round yields a packet); ② light mode now drives colours from the theme; ③ UI language follows DSH;
  ④ the enable decision (`rollout` missing/misspelled no longer silently disables an explicit `enabled:true`);
  ⑤ data loss where one settings write reset the whole config (UTF-8 BOM read fix). Details: [`CHANGELOG.md`](CHANGELOG.md).

## Versions and evidence

- Changelog: [`CHANGELOG.md`](CHANGELOG.md) ｜ manual acceptance: [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md) ｜
  release log (including every install drill actually run): [`po06/RELEASE-CHECKLIST.md`](po06/RELEASE-CHECKLIST.md)
- Install and self-check: [`po06/README.md`](po06/README.md) ｜ current Release: **[v0.6.8-stable](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.6.8-stable)**
- Compatibility: `dsh-0.1.6-alpha.1` (`0.1.5-rc.1` also runs) ｜ author: 啃轮胎的西狐
- **Previous generation (the 0.5 line — still usable, no longer updated)**: a **different package**,
  `@dsh-external/dsh-prompt-optimizer`, last published `v0.5.0-beta.1`; design and usage in [`SPEC.md`](SPEC.md),
  historical documentation (including the 0.5 measurements) in **[`README-0.5.en.md`](README-0.5.en.md)** —
  those numbers belong to **0.5 only** and are not evidence for 0.6.

## License

[BSD-3-Clause](LICENSE) · fully open source; anyone may use and modify it in any way, and suggestions are welcome.
