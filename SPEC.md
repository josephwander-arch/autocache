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

## Hard architectural decision: one file-based core, optional transports

AutoCache's native coding-agent distributions are **pure files** - hooks, skills,
commands, agents, and JSON state. They ship no compiled binary, daemon, code-signing
step, or runtime dependency beyond Node. A generic local-host distribution may run
the same core behind a local MCP bridge because those hosts need a tool transport,
not because AutoCache has become a knowledge server. Rationale:

1. Zero install friction is the entire point of a free tier.
2. A binary needs signing on Windows; the signing chain is a real blocker.
3. Hooks + local JSON cover 100% of the native free feature set. MCP tools expose
   the same bounded operations to hosts without a compatible lifecycle-hook API.
4. The paid boundary is capability, not transport: Autonomous adds extraction,
   retrieval, indexes, propagation, consolidation, and eval. The AutoCache bridge
   adds none of those.

Runtime: **Node.js 20+**. Not Python. Claude Code ships with Node; `python3` does not
reliably resolve on Windows (a known trap — `python3` is not on PATH under many
Windows Python installs, and the hook silently fails open). Every hook must run
under plain `node` with **zero npm dependencies** - Node standard library only.
The optional local-host bridge isolates and locks the official MCP SDK packages
under `adapters/local-hosts/mcp-server/`; those packages are never loaded by the
Claude, Codex, or Grok hook paths.

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
  workers/
    <parent-session>/<worker>/
      start_<receipt-id>.json # immutable native-worker start receipt
      stop_<receipt-id>.json  # immutable result receipt
      events.jsonl            # isolated child tool metadata; never the lead arc
  teams/
    <parent-session>/<team>/  # native task-created/completed and teammate-idle receipts
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

**Every structured JSON replacement is atomic**: write to `<file>.tmp` in the
same directory, then `fs.renameSync`. Lifecycle receipts never replace an
existing id. JSONL diagnostic streams append directly; readers skip an
interrupted final line.

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
| Native workers | use host-native execution; isolate identified child tool events; persist start/stop and team-task receipts; lead verifies and reconciles with an exact receipt marker |
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
| `PostToolUse` | `post-tool-use.js` | Count main-thread tool calls and write targets on the lead arc; route identified child calls only to that worker's event stream. Never invent a completed milestone. |
| `SubagentStart` | `subagent-start.js` | Snapshot parent chain head, write an immutable start receipt, and inject the child ownership boundary. |
| `SubagentStop` | `subagent-stop.js` | Write an immutable final-result receipt and tell the lead the exact reconciliation marker. Never mutate the breadcrumb. |
| `TaskCreated`, `TaskCompleted`, `TeammateIdle` | `native-team-event.js` | Record Claude native-team lifecycle receipts without replacing or blocking its task list and mailbox. |
| `Stop` | `stop.js` | Auto-checkpoint the arc so the next session can resume. |

Slash commands (`commands/*.md`, name = filename):
`resume`, `checkpoint`, `handoff`, `status`, `remind`, `breadcrumb`, `export`.

Subagent (`agents/session-summarizer.md`): condenses a long session into a
continuation packet without pulling the whole transcript into the main context.

## Surface: Codex

Codex has a first-class `.codex-plugin/plugin.json` for visible skills. Its current
runtime does not prove plugin-bundled hooks, so the companion adapter materializes
the remaining Codex-owned behavior into `~/.codex/`:

- plugin-owned `skills/autocache-*/SKILL.md` - same shared skill bodies
- `~/.codex/hooks/` — same Node scripts, registered per Codex's hook config
- `~/.codex/rules/autocache.md` — the always-on behavioral rules

The Node hook scripts and state **format** are shared verbatim across surfaces.
Each surface uses its own scoped store under `~/.autocache/stores/`; deliberate
cross-surface ownership moves through the shared-tag bridge and fork chain.

Codex, Claude, and Grok remain the worker control plane. AutoCache consumes only stable
native lifecycle identity (`agent_id`, `agent_type`, parent `session_id`) and
never implements its own spawn, steering, wait, cancellation, permission, or
worktree scheduler. A bounded worker return contributes to the current chain
head; only a top-level ownership transfer creates a fork.

## Surface: Grok Build

Grok Build has native plugins, hooks, skills, commands, agents, and subagents.
`.grok-plugin/plugin.json` points to the shared root components and a Grok-specific
seven-event hook map. The common stdin reader normalizes Grok's camelCase event
envelope and `subagentId`/`subagentType` fields without changing nested tool input.
Claude-only team events are not registered. Grok keeps native execution control;
AutoCache records continuity and worker receipts.

Plain grok.com chat without local plugin/filesystem access remains a hookless chat
surface and cannot be represented as an installed local plugin.

## Surface: generic local-model hosts

`adapters/local-hosts/` ships one MCP bridge with host profiles for LM Studio, Jan,
and Open WebUI. It supports stdio for local desktop clients and Streamable HTTP for
Open WebUI. The bridge exposes explicit resume, breadcrumb, checkpoint, handoff,
and reminder tools; it does not claim automatic lifecycle capture where the host
does not emit lifecycle events.

Ollama is a model engine, not the plugin client. It is supported behind Open WebUI
or another MCP-capable host rather than presented as a fourth host contract.

## GitHub repository

Repository `josephwander-arch/autocache` remains private until separately promoted.
It must contain:

- `README.md` — what it is, the free/paid line, 30-second install, screenshot slot
- `LICENSE` — MIT
- `.claude-plugin/marketplace.json` — so `/plugin marketplace add josephwander-arch/autocache` works
- `.codex-plugin/plugin.json` - first-class Codex plugin metadata
- `.grok-plugin/plugin.json` - native Grok distribution, installable directly
  from the repository
- `adapters/local-hosts/` - generic MCP bridge and three host profiles
- `install.sh` / `install.ps1` - Codex adapter installers
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
