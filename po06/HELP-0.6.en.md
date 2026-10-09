# Prompt Optimizer · User help (0.6)

<!-- po06:help-start —— 下面这行标记之后才是**用户可见**的正文（上面的说明与文中的〔依据〕都由宿主剥掉）-->

## In one line

You keep talking normally. **Before** your message goes out, it works out *what this round is really asking for* and hands that reading to the working AI — **your own words are never rewritten and never dropped**.

## How to use it (three steps)

1. Type in the input box as usual.
2. Press Enter / click send — the message **pauses** while it thinks. While you wait, the panel shows **what it is doing and what it is writing right now** (not a bare progress bar).
3. When it is done your **own words** go out; the working AI has that reading from **the very first step of this round** — no waiting for the next round.

In a hurry? Click **Skip and send** any time while it is working.

> If it cannot produce a reading (model unavailable, etc.): the **Auto** permission sends your original text and explains why in the panel;
> the **Review** permission **never sends by itself** — the panel stops in an error state and waits for you to click *Send original* or *Retry*. Your message stays in the box.

## The options

**Tier** (Off / Light / Standard / Heavy)

- **Off** — no interception, no waiting, nothing injected (use it to switch the optimizer off for a while).
- **Light** — clarify the original meaning, including references, scope and conditions that could be misunderstood; identify necessary questions.
- **Standard** — **recommended**: clarify the wording and fill the gaps that matter most, offering key useful suggestions.
- **Heavy** — broadly develop positive additions, ideas and methods that serve the existing goal; expose uncertain premises and consequential tradeoffs.
- All tiers preserve the original intent. They differ in purpose, not item counts, length quotas or a fixed workflow. Reasoning effort remains a separate setting; the compact protocol does not automatically lower Max.

**Permission** (Review / Auto)

- **Auto** — sends your message as soon as the reading is ready.
- **Review** — shows you what will be injected first; you can **edit it directly**, then click *Confirm*. It **never auto-sends** — not even when the reading fails.

**English mode** (Off / On, off by default)

- When on, **this turn's task, the optimizer instructions and the assistance text are translated into English** before they reach
  the model — the UI and the stored state stay Chinese (requirement text falls back to your original wording).
- Code blocks, paths, URLs, JSON literals and **verbatim quoted phrases** are never translated; commands starting with `/` are not
  translated either (allowlisted ones still go through interception).
- **It does not ask for a response language on your behalf**: the language the model answers in is still decided by your own words.
- Cost: one extra translation call per turn (cached), so it is off by default.

**Built-in Bash is Windows-only** (the bundled runtime is a Windows MSYS2 build); on other platforms the model does not get this tool.

**Reasoning boost** (experimental, off by default)

- Lives at the very bottom, under "Experimental", behind a divider. When on, one generation can become several calls
  (candidate selection / feedback loop / hybrid).
- The "inference trace" panel only appears while it is on, and shows every call, its duration, and which candidate was adopted.
- ⚠ **It is not established that this reliably improves capability, and it increases model working time substantially** —
  enable cautiously, and compare the same task with it on and off.

**Context** (turns 0–10 / full)

- It reads your **recent turns** to understand what you are doing; more turns = better context, slower.
- **Full** means "read everything I still hold"; the control becomes Off / On.
- Not sure? ~6 turns is a good default.

**Read-only tools** (On / Off)

- When on, it may read a few files **inside your working directory** to check facts (read-only: no writes, no commands).
- The cost is time and tokens, so it defaults to **off**.

## Bits of the UI

- **Options** — one button in the input bar. It carries the current tier/permission summary; click it for all the settings above.
- **Details** — the grey-green dot is the state (auto / record-only / disabled). *Details* opens the optimizer core editor (with undo and restore). It separates the full current-settings preview from the last actual request for this session, including characters and reasoning effort.
- **`?`** — this page.
- **Overlay** — the small window during interception. Drag it by its title bar, resize from the bottom-right corner, collapse it into a small ball and reopen it when needed.

## Recommended combinations

| Situation | Suggestion |
|---|---|
| First time | Tier **Standard** + permission **Review** (you can see exactly what it did) |
| Daily work | Tier **Standard** + permission **Auto** |
| Fast and cheap | Tier **Light** + context **2–4 turns** |
| Complex / easy to misread | Tier **Heavy** + **read-only tools** on |
| Just record, don't touch | Tier **Off** |

## FAQ

**How long does it take?** Usually 20–60 s (tier, context and model all matter). That wait is it doing the thinking.

**Will my message be changed?** No. What changes is *the reading it hands to the working AI*; the text you send is the text you wrote.

**Can it lose my message?** No. If it fails or runs out of ideas it sends your original text and tells you why.

**Does it remember last round's goals?** No — every round is re-derived from **your message this round plus the context it read this round**. Last round's goals are retired (kept for the record), so you will **not** see "a problem I already fixed demanded again". The cost: long-lived constraints are re-derived from the context each round, so do not shrink the **Context** window too far.

**Does it invent requirements for me?** It tries to write only what you said or what the context shows. Items with no source are flagged in red in the review panel.

**Can reading project files touch my stuff?** No: read-only, limited to your working directory, anything outside is refused.

**Credit**: author 啃轮胎的西狐 ｜ version shown at the top of the panel ｜ built for `dsh-0.1.6-alpha.1`
