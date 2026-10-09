# claude-local-plugins

Function-hooks plugins ("mods") for [Claude Code](https://claude.com/claude-code), built mainly for the Desktop Code tab. The repository is a plugin marketplace named `nhat-local`.

## Plugins

| Plugin | Version | What it does |
| --- | --- | --- |
| [`session-hub`](plugins/session-hub) | `0.1.0-local.63` | **Recommended.** One "Mod status" pane with Progress bars, Next steps suggestions, the skills and agents called this session, and prompt-cache usage, plus a prompt-cache countdown in the footer. Combines the three plugins below. |
| [`plan-progress`](plugins/plan-progress) | `0.3.0-local.15` | Live plan progress bars with stages, steps, step times and sounds. Fork of [zycck/claude-mods](https://github.com/zycck/claude-mods) `plan-progress`. |
| [`next-steps-desktop`](plugins/next-steps-desktop) | `1.0.0-desktop.15` | Up to three suggested next prompts after each turn. Fork of Anthropic's [`next-steps`](https://github.com/anthropics/claude-plugins-community/tree/main/next-steps). |
| [`cache-timer`](plugins/cache-timer) | `0.1.0-local.3` | A `Cache mm:ss` countdown in the Desktop footer showing how long the prompt cache stays warm. |

Enable either `session-hub` or the standalone plugins, not both. They register the same `/progress` commands and draw the same footer entries.

## Install

```bash
claude plugin marketplace add bqnhat/claude-local-plugins
claude plugin install session-hub@nhat-local
```

Start a new session afterwards. To pick up a newer version, run `claude plugin marketplace update nhat-local`, then `claude plugin update session-hub@nhat-local`.

## Requirements

- Function hooks are early access. An installed plugin's hooks module loads only while the engine's `tengu_plugin_hooks_modules` rollout is on for the session, or, on Claude Code builds that still read it (2.1.284), while `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set. Without either, the plugin installs but draws nothing.
- In the Desktop Code tab, panes and footer entries need the bundled Claude Code to be 2.1.286 or later.
- Sounds go through `$.audio.play`. If that fails, they fall back to PowerShell, which only works on Windows. A Windows terminal session goes straight to PowerShell, because the engine has no player there and `$.audio.play` stays silent.

## session-hub

### On Desktop

- **Footer entry.** Shows `Mods` when idle, `Progress N` while plan bars are open, `Agents N` while subagents run, `💡 N` when suggestions are ready, joined by `·` when more than one applies. Clicking it opens or closes the Mod status pane. Next to it, `⏱ mm:ss` counts down until the prompt cache goes cold, from the moment the last main-loop request was sent. It turns orange near the end. Clicking it opens the Cache section.
- **Icon rail.** The pane has one icon per section: Progress, Next steps, Skills & agents and Cache. A click anywhere on a bar or row opens or collapses it.
- **Progress section.** The model gets a `plan_progress` tool (`mcp__session-hub__plan_progress`) and a short rule with the first prompt. Larger tasks get a bar of stages and steps, with step times and soft sounds for "needs a decision", "error" and "done". If the model starts a fourth file edit or changing shell command in a turn without a bar, that call is refused once and the model is told to create one. A plan accepted from plan mode becomes a bar, and subagents started outside a plan get an automatic Agents bar. Finished bars stay in a history list.
- **Next steps section.** After each answer, the plugin forks the session and asks for up to three next prompts, one per kind: `✓` verify (or `⚖` decide), `🔍` dig, `→` advance. On Desktop each card has an accent bar in the colour of its kind and text glyphs (`✓`, `⌕`, `→`, `⇄`), a `▸ Chi tiết` toggle that opens the detail inside the card, and a `Điền ↵` button. Clicking a card or `Điền ↵` puts its prompt in the composer as a draft. The plugin never sends a prompt on its own. The fork prompt asks for labels in Vietnamese.
- **Skills & agents section.** Lists the skills and agents called this session, grouped by turn and each tagged personal, project, plugin or built-in, and the rule and `CLAUDE.md` files the session loaded.
- **Cache section.** Built from the main loop's requests in this session; subagent requests are left out. The header holds the Tokens / Savings switch, then the last request's read, wrote and new tokens with its hit rate. A card at the foot of the pane counts the cache lifetime down under every section. Two views:
  - **Tokens.** A chart of stacked read, wrote and new tokens per turn with a hit-rate line (green at 80% or more, orange at 40% or more, red below), session totals, and a table of the last 12 turns. Each turn's tokens add up every request in it, so a turn with many tool calls re-reads the whole context many times.
  - **Savings.** Running totals of cache reads and writes, and an estimate in input-token equivalents: reads save 0.975 of the input price on Claude Fable 5.1 and Claude Mythos 5.1, 0.95 on Claude Opus 5.5 and 0.9 on other models, writes cost 1 extra with the one-hour cache and 0.25 with the five-minute one. Output tokens are not counted, and the figures are list-price ratios, not your bill.

### In the terminal

The same progress bars and suggestions are drawn as bands above the prompt, and a `Progress` button in the footer shows or hides the bars. The Mod status pane has Progress, Next steps and Skills & agents tabs; the Cache section is Desktop only.

### Commands

| Command | What it does |
| --- | --- |
| `/session` | Show or hide the Mod status pane |
| `/progress` | Show or hide the progress bars |
| `/progress-clear` | Remove all progress bars |
| `/progress-demo` | Show a sample plan |
| `/progress-sounds` | Play the decision, error and done sounds |

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `minAnswerChars` | `80` | Skip suggestions after answers shorter than this many characters |
| `nextStepsModel` | (empty) | Model for next steps. Empty forks the session with its own model; a name such as `claude-haiku-5-5` sends the recent conversation to that model |
| `suggestSkills` | `true` | Tell the suggester which skills and slash commands the session has |
| `ttlMinutes` | `0` | Fix the cache lifetime (`60` or `5`); `0` learns it from the responses |
| `warnMinutes` | `1` | Minutes before expiry when the countdown turns orange |

## Development

Each plugin follows the same layout:

```
plugins/<name>/
  .claude-plugin/plugin.json   manifest, options and version
  hooks/hooks.json             points at the hooks module
  hooks/register.tsx           the hooks module
  types/index.d.ts             $.state contract
  tests/*.test.tsx             claude plugin test suites
```

Validate and test a plugin from its folder:

```bash
claude plugin validate .
claude plugin test .
```

### Preview the Mod status pane without a session

`tools/hub-preview` draws the session-hub pane from fixed sample data, so a layout change can be checked in seconds instead of in a new Claude session. `fixtures.test.tsx` builds each sample (a failed bar with a timeline, mixed running / waiting / done bars, four cache turns, an expiring or expired cache, and more) through the plugin's own hooks with `claude plugin test`, and `renderer.js` paints the drawn tree in HTML at the desktop's scale of 8px per cell.

```bash
node tools/hub-preview/preview.mjs --shots
```

```bash
node tools/hub-preview/preview.mjs --serve --watch
```

The first writes `tools/hub-preview/out/index.html` and one PNG per sample and width into `out/shots` (Playwright's headless shell, Chrome or Edge; `--theme dark` for the dark theme). The second serves the gallery on `http://127.0.0.1:4720/` and reloads it whenever `hooks/register.tsx` or a fixture changes. `--only <name>` keeps matching samples, `--widths 44,76` sets the pane widths in columns, and `CLAUDE_BIN` points at a `claude` binary when the one on `PATH` is older than the desktop's. The HTML is an approximation of the desktop renderer: check the final result once in the real pane.

This repository is the only place these plugins are developed. The former standalone repositories [`bqnhat/plan-progress`](https://github.com/bqnhat/plan-progress) and [`bqnhat/next-steps-desktop`](https://github.com/bqnhat/next-steps-desktop) are archived.

Bump `version` in `plugin.json` with every change, or `claude plugin update` will keep the cached copy, and commit and push each version so GitHub matches what is installed. A session keeps the version it loaded at start; open a new session to run an update. `upstream/` holds the diffs of `plan-progress` and `next-steps-desktop` against the upstream versions they were forked from.

## Credits and license

- `plan-progress` and the Progress section of `session-hub` are based on `plan-progress` 0.3.0 (`ea2c96b`) by Kirill Serditov, from [zycck/claude-mods](https://github.com/zycck/claude-mods), MIT.
- `next-steps-desktop` and the Next steps section of `session-hub` are based on `next-steps` 1.0.0 (`87c843d`) by Thariq Shihipar, from [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community), MIT.

Released under the MIT License. See [LICENSE](LICENSE).
