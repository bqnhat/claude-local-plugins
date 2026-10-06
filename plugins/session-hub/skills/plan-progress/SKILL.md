---
name: plan-progress
description: Reference for the plan_progress bars (tool ops, limits, refusals, /progress commands). The working rules arrive with the session's first prompt; load only when the user asks about the bars or a call was refused.
---

# plan_progress

Create once with the whole plan, then move it with short ops. Never resend `stages` except to restructure.

Create: `{id, title, stages:[{name, steps:[{title, status}]}]}`, with the first step `"active"` and the rest `"pending"`; `kind:"todo"` for one flat list. 2-7 stages, titles of at most 4 words, in the user's language, one `id` per task. A bar holds at most 12 stages, 120 steps and 12 substeps per step; anything beyond is dropped and the result says what was kept.

Ops:
- `{id, next:true}` — active step done, next one active
- `{id, done:["A"], active:"B"}` — mark done, pick current
- `{id, failed:"B", note}` — error
- `{id, state:"needs_input", note}` — before asking the user
- `{id, state:"running"}` — back to work
- `{id, state:"done"}` — finish; every open step is marked done

States: `running`, `needs_input`, `error`, `done`. A bar whose steps are all done becomes `done` by itself. AskUserQuestion marks the open bar `needs_input` while the question is up.

The result already says `id: done/total, state, active step`; no need to check the bar.

Refusals:
- `no bar "<id>" yet` — an op was sent for an id that has no bar; create it with `title` and `stages`.
- `several changes ahead` — the fourth file edit or changing shell command of a turn ran with no open bar; it is refused once per turn. Create the bar, then retry.

A plan accepted from plan mode becomes a bar by itself, and subagents get an automatic **Agents** bar when no plan is open.

User commands: `/progress` shows or hides the bars (on Desktop it opens the Progress section of the Mod status pane), `/progress-demo` shows a sample plan, `/progress-sounds` plays the decision, error and done sounds, `/progress-clear` removes every bar, `/session` shows or hides the Mod status pane. On Desktop the footer entry reads `Mods`, or `Progress N` while bars are open; in the terminal a `Progress` button stays in the footer while the mod is loaded.
