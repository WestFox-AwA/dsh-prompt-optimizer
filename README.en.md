# dsh-arbiter-wf **v0.8.3-stable** · Independent Arbiter Layer (DSH Web plugin)

**English** ｜ [中文](README.md)

Effect demo — all captured on Windows + DSH + PTC, in one shot.
(the plugin tier was set to "Heavy")
With DeepSeek-V4.1-Flash
![](./docs/image/contrast_small.png)
Prompt: Do not preview any other files in the folder. Build a single-HTML program whose subject is an
extremely detailed modern main battle tank model — previewable, controllable, realistic, striking, and
showpiece-quality.

> **It never rewrites your words.** You type as usual; before you hit send it works out *what this round actually
> needs* and hands that understanding to the working AI — your original message goes out **byte for byte**,
> the understanding rides along, the model's clarifications and suggestions are **always labelled as machine output**
> (never passed off as something you said), and each round is **reasoned from scratch** (nothing is inherited).
> Full guide and self-check: [`po06/README.md`](po06/README.md) · manual acceptance: [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md)

> ### ⚠️ There is only one install source: this repo’s Releases
>
> | Channel | What it is | Use it? |
> |---|---|---|
> | **GitHub Release asset** | The current version (`@dsh-external/dsh-arbiter-wf`) | ✅ **The only correct source** — the command below |
> | **npm** | **This plugin is not published to npm** (`private: true`); it ships via Releases only.
>  Any same-named or similar package on the registry **is not this project**. | ❌ Do not install from npm |
> | Cloning the repo root | Same source as this Release, for developers | ⚠️ You must build it yourself; Releases are easier for normal use |
>
> Looking for versions 0.1–0.6? See [`old/`](old/README.md) (per-generation notes and download methods).
> Want to publish a release yourself? See [`docs/RELEASING.md`](docs/RELEASING.md) (9-step procedure + checklist).
> ### Install 0.8.3-stable in 30 seconds
>
> ```powershell
> $v = '0.8.3-stable'; $d = "$env:USERPROFILE\Downloads"
> Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/download/v$v/dsh-external-dsh-arbiter-wf-$v.tgz" -OutFile "$d\dsh-external-dsh-arbiter-wf-$v.tgz"
> Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/download/v$v/SHA256SUMS.txt" -OutFile "$d\SHA256SUMS.txt"
> Get-Content "$d\SHA256SUMS.txt"     # compare the sha256 with the tgz you just downloaded (same file as on the Release page)
> dsh --profile po061 --from-default-profile web --dump-config        # a clean profile
> dsh plugin --profile po061 add "$d\dsh-external-dsh-arbiter-wf-$v.tgz"    # install
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
   round** plus **the session context / project files actually read this round**. It returns four kinds of content:
   **the intent of this round**, **clarifications**, **positive additions and suggestions**, and **questions worth asking**.
   It does **not** rewrite your message.
3. **The host owns the engineering side**: item ids, provenance and state updates are handled by the plugin, and the
   model's clarifications and suggestions are **always labelled as machine output** — they never enter the "you said that" class.
4. **Sidecar injection**: your message goes out **unchanged**, and the interpretation rides along as a packet for this
   round only; when the next round starts, the previous round's items retire wholesale (kept for the record, not deleted).

**Three invariants** (this is also where it differs from other tools):

| Invariant | Meaning | Not |
|---|---|---|
| **No rewriting** | the message dispatched to the working AI is the bytes you wrote | not a prompt rewriter |
| **Advice never gains authority** | clarifications and suggestions stay machine output; only what you explicitly said counts as a requirement | not free-form completion |
| **Per-round zero base** | this round's understanding does not depend on the previous round's items | not memory/profiling, not RAG |
| **Adding nothing is fine** | with nothing worth adding, the round is simply "understood, no additions" | no padding to look busy |

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

**What if it extracts nothing this round?** "Understood, but nothing worth adding" is now a **valid outcome**: it no longer pads the packet, and it does not retry just because the additions are empty. It only retries when the **output format itself is broken**.

**Does it remember the previous round's goals?** No. Each round is re-derived from *your message this round* plus *the context read this round*; see the invariants above for the cost.

**Will it invent requirements?** No. Only what you explicitly said counts as your requirement; the model's clarifications and suggestions are always labelled **machine output** and never enter the "you said that" class. Legacy-format items still require a verbatim quote, and mismatches are flagged in red in the UI.

**Does reading project files touch anything?** No: read-only, confined to your working directory, anything outside is refused.

**Turning it off / uninstalling?** Temporarily: set the tier to `off` (no interception, no injection). Fully: remove `@dsh-external/dsh-arbiter-wf` from the profile's `dsh.profile.bundles` and `dependencies`, restart DSH; its config lives in `<home>/po06.json` and you can delete it.

## Privacy and boundaries

- **Nothing leaves your machine**: no telemetry, no callbacks. All state lives under `<home>/po06-*.json*` and `po06-state/`.
- **Read-only tools are the only file access**: off by default; when on they are read-only, confined to the working directory, and run no commands.
- **No unrelated content is injected**: the packet is derived only from this round's message and the context read this round; items whose sources cannot be verified are dropped.
- **Not enabled by default (deliberately conservative)**: the assembly-time enable gate defaults to `off`. To enable it, write
  `{"settingsVersion":1,"enabled":true,"rollout":{"mode":"all"}}` to `<home>/po06.json` (for selected sessions only:
  `{"mode":"allowlist","sessions":["<session id>"]}`). As long as the old plugin is still assembled it refuses to enable with
  `DOUBLE_INTERCEPT` — having one message processed twice is the worse failure.

## Honest status (please set your expectations here)

- ✅ **Internally self-consistent, with evidence**: **93 suites / 1,003 tests green** (including package self-sufficiency and
  documentation-drift gates; plus 234 mutation guards on the release-gate line).
- 📊 **The author's hands-on observation (not a benchmark)**: testing has mostly been done in a
  **DeepSeek-V4.1-Flash + PTC + PowerShell** environment. **No professional benchmark has been run**; however, across the
  usual one-shot tasks and long-task iterations the **practical results are clearly stronger than DeepSeek-V4.1-Flash
  under the same environment and the same prompt**, and a **small sample** of projects suggests it **may also reduce token
  consumption and save cost**.
- ⚠️ **The capability is still experimental** — treat it as something you can install, try, and switch off at any time,
  **not as an upgrade**.
- 📌 What `0.8.3-stable` changes:
  ⓪ **Optimizer protocol v3 (the main change)** — the pre-send optimization protocol was rewritten as a short one: the model
  receives only a **shared core + the selected tier + a thin output format**, and answers with `intent / clarify / add / ask`.
  Item ids, provenance and state updates are **owned by the plugin** — the model no longer fills in engineering fields.
  The Chinese plain combination is now **596 / 599 / 639 characters** (light / standard / heavy) instead of several thousand.
  ① **The three tiers now differ by purpose**, not by item counts or question quotas — light clarifies the original meaning and
  surfaces genuine ambiguity; standard adds the gaps that matter most to the result; heavy develops broad positive additions,
  ideas and methods around the goal you already expressed, and states consequential tradeoffs.
  ② **Adding nothing is allowed** — "understood, nothing worth adding" is a valid outcome, and the old 12-item / 300-character /
  question quotas are gone, so long suggestions and several questions survive intact into the context and the review panel.
  ③ **Machine advice cannot claim your authority** — clarifications and suggestions are always labelled machine output; only what
  you explicitly said counts as a requirement, and your message is preserved and sent unchanged.
  ④ **Verifiable in the UI** — Details shows both a full preview for the current settings and the **last protocol actually sent**
  for this session, with its character count and reasoning effort.
  ⑤ **CI portability fixes** — a named zstd import broke the whole module on older Node (measured on CI Node 20); it is now a
  capability probe with an explicit skip. The install check's `dsh` command is injectable, so its tests no longer depend on the
  machine having DSH installed.
  ⑥ Everything else (English mode, experimental reasoning boost, the advisor `consult_task`, built-in Bash, the slash-command
  allowlist, streaming intercept output) has been there since 0.8.1 / 0.8.2.
  **No professional benchmark was run**: a shorter protocol does not by itself make the model faster — judge the value yourself
  by comparing the three tiers on the same task. Details: [`CHANGELOG.md`](CHANGELOG.md).

- Changelog: [`CHANGELOG.md`](CHANGELOG.md) ｜ manual acceptance: [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md) ｜
  release log (including every install drill actually run): [`po06/RELEASE-CHECKLIST.md`](po06/RELEASE-CHECKLIST.md)
- Install and self-check: [`po06/README.md`](po06/README.md) ｜ current Release: **[v0.8.3-stable](https://github.com/WestFox-AwA/dsh-prompt-optimizer/releases/tag/v0.8.3-stable)**
- Compatibility: `dsh-0.1.6-alpha.1` (`0.1.5-rc.1` also runs) ｜ author: 啃轮胎的西狐
- **Previous generation (the 0.5 line — still usable, no longer updated)**: a **different package**,
  `@dsh-external/dsh-prompt-optimizer`, last published `v0.5.0-beta.1`; design and usage in [`SPEC.md`](docs/SPEC.md),
  historical documentation (including the 0.5 measurements) in **[`README-0.5.en.md`](old/0.5/README.en.md)** —
  those numbers belong to **0.5 only** and are not evidence for 0.6.

## License

[BSD-3-Clause](LICENSE) · fully open source; anyone may use and modify it in any way, and suggestions are welcome.
