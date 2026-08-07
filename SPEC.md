# Autocache — build specification (v0.1.0)

> This file is the single source of truth for every agent building Autocache.
> Read it fully before writing any file. Do not invent structure that contradicts it.

## What Autocache is

Free-tier **session continuity** for AI coding agents. One sentence:

> **Your agent stops forgetting what it was doing.**

It is the free half of a two-tier product. The paid half is **Autonomous**.
The line between them is fixed and must never be blurred in any copy, README, or docs:

> **Autocache remembers your work. Autonomous remembers your knowledge.**

- **Autocache (free)** — single machine, single work-arc. Sessions, breadcrumbs,
  checkpoints, self-state, scratch tags, local reminders. No corpus. No retrieval.
  No learning. It never gets smarter; it just never forgets what it was doing.
- **Autonomous (paid)** — extraction, semantic + graph retrieval over an accumulating
  knowledge base, context budgeting, consolidation, eval. It compounds.

The upgrade trigger is designed in, not bolted on: Autocache users accumulate
breadcrumbs and session records and eventually ask *"can it learn from these?"*
That question **is** the paid tier.

## Hard architectural decision: v1 ships NO binary

Autocache v1 is **pure files** — hooks, skills, commands, and JSON state. No MCP
server, no compiled binary, no code signing, no install step beyond dropping a
directory. Rationale:

1. Zero install friction is the entire point of a free tier.
2. A binary needs signing on Windows; the signing chain is a real blocker.
3. Hooks + local JSON cover 100% of the free feature set. Nothing is compromised.
4. It makes the paid boundary *structural*: Autonomous ships the MCP server, and
   retrieval genuinely cannot be done with hooks and JSON.

Runtime: **Node.js**. Not Python. Claude Code ships with Node; `python3` does not
reliably resolve on Windows (a known trap — `python3` is not on PATH under many
Windows Python installs, and the hook silently fails open). Every hook must run
under plain `node` with **zero npm dependencies** — Node standard library only.

## State layout

All state lives under `~/.autocache/` (`%USERPROFILE%\.autocache\` on Windows).
Resolve with `os.homedir()`. Honor `AUTOCACHE_HOME` as an override.

```
~/.autocache/
  config.json               # user settings, tier flag, telemetry opt-in (default OFF)
  sessions/
    <session-id>.json       # one file per session
    index.json              # newest-first pointer list, capped
  breadcrumbs/
    <breadcrumb-id>.json
    active.json             # the currently-open breadcrumb, or null
  checkpoints/
    <checkpoint-id>.json
  state/
    self_state.json         # agent's own running notes about itself
    bag.json                # scratch key/value tags for the current arc
    arc.json                # live turn bookkeeping: counters, touched files,
                            # checkpoint pointer. Hook-internal, but documented
                            # in docs/state-format.md because it is the most
                            # frequently written file and the product claims
                            # all state is readable plain JSON.
  reminders.json
  logs/
    events.jsonl            # append-only, rotated at 5 MB
```

**Every write is atomic**: write to `<file>.tmp` in the same directory, then
`fs.renameSync`. A half-written state file that reads as valid-but-truncated JSON
is the exact failure mode this product exists to prevent.

**Every hook fails open.** Any throw, any parse error, any missing file exits 0
silently. A continuity tool that breaks the session it is meant to protect is worse
than no tool. Wrap every hook body in try/catch and `process.exit(0)`.

## Feature set (the free tier, exactly)

Derived from the tiering of Autonomous's 121 tools. Free = these groups only:

| Group | Capability |
|---|---|
| Boot / identity | Restore prior context at session start; report status |
| Session lifecycle | start, add finding, list, get, close, export, delete |
| Session summary / handoff | Write a continuation packet another agent can execute |
| Breadcrumbs | start, step, add, complete, abort, status, list, adopt, backup; decisions (raise, resolve); fork-chain takeover (fork, retire) |
| Checkpoint / rollback | save, load, clear; git rollback helper |
| Self-state + bag | self_state get/update; bag tag/read/clear |
| Local reminders | add, list, complete, delete, check_due, recurring; time check |
| Health / errors | health check, error log, fallback suggestion |
| Config safety | backup + validate agent config before edits |

**Explicitly NOT in Autocache** (these are the paid moat — do not implement,
do not stub, do not mention as "coming soon" in a way that implies free):
extraction, semantic/lexical/graph retrieval, index maintenance, knowledge-base
writes with propagation, consolidation/dedup/staleness, context budgeting
(`vol_load`/`warm`/`offload`/`degrade_check`), learning analytics, eval.

## Fork-chain: work that outlives its session

Breadcrumbs carry three extensions so an operation can survive discovery,
indecision, and takeover. All three are pure work-continuity - they record what is
happening to the work, and nothing here learns, retrieves, or indexes. They stay
entirely on the free side of the line.

**Pending steps grow.** A breadcrumb's planned list is not fixed at start. The
boundary is mechanical: work discovered and finished before the agent's current
output ends needs no entry; work still open when the output ends MUST be appended
as a pending step. Unrecorded open work is invisible to the next session, and the
next session is the product.

**Decisions are recorded, not guessed.** A breadcrumb carries decision entries:
id, question, 2-3 options, an optional lean, `waits_on`, and the `planned_steps`
indexes it blocks. Steps not blocked proceed freely; a blocked step is not worked
until the decision resolves. `waits_on: "user"` resolves only with the user's
actual answer; `waits_on: "any_informed_session"` lets any agent with the full
recorded picture decide, and the resolution's `basis` field records what justified
the call. Resolution always records `chosen`, `decided_by`, and `decided_at`.

**Takeover is a fork chain with exactly one live head.** Forking a live head -
active, not forked away, not terminal, with remaining steps or unresolved
decisions - writes a NEW breadcrumb carrying the remaining steps and unresolved
decisions (block indexes reindexed), with `forked_from` pointing back; the source
is then marked `forked_to` / `forked_by` / `forked_at` and is FROZEN. Fork ids are
guaranteed unique against the source - a discriminator suffix on collision - so a
record can never be `forked_to` itself. A frozen record rejects every step,
add, decision, complete, and abort write, and the rejection names the chain head
so the returning session catches up before continuing. Take-back is a fork of the
current head: the chain grows, every hop attributed.

Completing the head walks the `forked_from` ancestry and marks every still-open
ancestor `completed_via` the head id, so any earlier session resumes into
"finished elsewhere, here is the pointer" rather than a dangling operation.
Aborting a head leaves the ancestors frozen pointing forward, and the tail
surfaces as adoptable work. An incomplete chain is never silently pruned: it keeps
surfacing at every restore until it is completed through the chain or explicitly
retired with a recorded reason.

**Takeover eligibility is protocol, not code.** The hooks stay advisory and the
state layer only refuses what is structurally wrong (writes to a frozen record);
who may fork when is a judgment the skills spell out. Fork an idle head when the
holder is demonstrably inactive past a threshold (90 seconds on the same machine;
2 minutes across synced machines; 3 minutes after a detectable file sync
settles), on an explicit pass, or on the user's direction. When activity cannot
be determined, the agent must tell the user which session holds the work and that
forking a live session could corrupt it, wait 3 minutes, re-check, and proceed
only on the user's positive affirmation given after that risk statement. A
demonstrably active holder is never forked - read-only or ask for a pass. Before
any cross-machine fork, the record file's mtime is compared against its recorded
last activity; an mtime newer than the record explains means a sync is in
progress. The full ladder lives in the `autocache-handoff` skill and is
referenced from `autocache-resume` and `/breadcrumb`. "Synced machines" here
means the user syncing the state directory with their own tooling - Autocache
still ships no sync, per the honesty constraints below.

State-format details and worked records are in `docs/state-format.md`. Old records
without any of these fields keep working unchanged; every new field is optional.

## Surface: Claude Code plugin

Canonical layout, verified against the installed `hookify` plugin:

```
autocache/
  .claude-plugin/plugin.json      # { name, description, author, version, homepage }
  hooks/hooks.json                # event -> [{ hooks: [{type:"command", command, timeout}] }]
  hooks/*.js                      # invoked as: node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"
  skills/<skill-name>/SKILL.md    # YAML frontmatter: name, description
  commands/*.md                   # slash commands, one file each
  agents/*.md                     # subagent definitions
```

`${CLAUDE_PLUGIN_ROOT}` is substituted by the harness — always quote it, paths
contain spaces on Windows.

Hooks to register:

| Event | File | Job |
|---|---|---|
| `SessionStart` | `session-start.js` | Restore: last session summary, open breadcrumb, due reminders, self-state. Emit `hookSpecificOutput.additionalContext`. |
| `UserPromptSubmit` | `user-prompt-submit.js` | Surface a matching prior finding when the prompt echoes past work. |
| `PreToolUse` | `pre-tool-use.js` | Advisory only. Nudge for a breadcrumb on a 3+ step arc; warn before overwriting a file with no backup. Never block. |
| `PostToolUse` | `post-tool-use.js` | Auto-append to the open breadcrumb; count tool calls since last logged step. |
| `Stop` | `stop.js` | Auto-checkpoint the arc so the next session can resume. |

Slash commands (`commands/*.md`, name = filename):
`resume`, `checkpoint`, `handoff`, `status`, `remind`, `breadcrumb`, `export`.

Subagent (`agents/session-summarizer.md`): condenses a long session into a
continuation packet without pulling the whole transcript into the main context.

## Surface: Codex

Codex has real directories at `~/.codex/`: `skills/`, `hooks/`, `rules/`,
`agents/`, `automations/`, `plugins/`. It is **not** the Claude Code plugin format.
Ship an installer that materializes the same behavior into those directories:

- `~/.codex/skills/autocache-*/SKILL.md` — same skill bodies
- `~/.codex/hooks/` — same Node scripts, registered per Codex's hook config
- `~/.codex/rules/autocache.md` — the always-on behavioral rules

The Node hook scripts and the `~/.autocache/` state are **shared verbatim** across
surfaces. That is the whole point: one state directory, many front ends. A session
started under Claude Code must be resumable under Codex.

## Surface: Grok

Grok is a skill/prompt surface, not a hook surface. Ship markdown only, modeled on
`C:\CPC\grok-web-skills\` (directories of skill markdown). No hooks, no state
mutation from Grok itself — Grok **reads** `~/.autocache/` and narrates; it does
not write. Say this plainly in the docs; a surface that silently can't write is
the failure mode.

## GitHub repository

Public repo `josephwander-arch/autocache`. Must contain:

- `README.md` — what it is, the free/paid line, 30-second install, screenshot slot
- `LICENSE` — MIT
- `.claude-plugin/marketplace.json` — so `/plugin marketplace add josephwander-arch/autocache` works
- `install.sh` / `install.ps1` — one-liner installers for the non-Claude-Code surfaces
- `docs/` — install per surface, state format, hook reference, FAQ, upgrade path
- `.github/workflows/ci.yml` — lint hooks with `node --check`, validate every JSON against its schema, run the hook test fixtures
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`
- `examples/` — a worked resume, a worked handoff

CI must include a **fail-open regression test**: feed each hook malformed stdin,
missing state, and an unreadable home directory, and assert exit code 0 every time.

## autocache.ai

Static, fast, no framework required. Sections in order:

1. **Hero** — the one sentence + a terminal recording of a session resuming.
2. **The problem** — concrete: you close the terminal, you come back, it's gone.
3. **How it works** — three panels: hooks capture, state persists, next session restores.
4. **Free vs paid** — the table. Honest. Free is genuinely complete for its job.
5. **Install** — tabs for Claude Code / Codex / Grok. Copy-paste, under 30 seconds.
6. **What it is not** — it does not read your code, does not phone home, telemetry off by default, state is local plain JSON you can read and delete.
7. **Upgrade** — Autonomous, and exactly what it adds.
8. **Footer** — GitHub, docs, license.

Tone: engineer-to-engineer. No hype, no "revolutionary", no "AI-powered".
Claim only what the code does.

## Honesty constraints (binding on all copy)

1. **Do not claim prompt caching.** Anthropic's prompt cache is a 5-minute-TTL
   prefix match. Nothing Autocache writes survives it, and nothing survives a
   session boundary. The name refers to *caching your work context*, not to the
   API's token cache. If the distinction comes up in docs, state it plainly.
2. **Do not claim it makes the model smarter.** It restores context. That is all,
   and it is enough.
3. **Do not claim cross-machine sync in v1.** State is local. Say so.
