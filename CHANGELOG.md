# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

State-file compatibility is treated as public API: a directory written by an older
version must stay readable by a newer one. Any change that breaks that is a major
version bump and is called out here explicitly.

## [Unreleased]

### Added

- A native Grok Build distribution with a `.grok-plugin` manifest,
  shared skills/commands/agents, a seven-event Grok hook map, and
  camelCase lifecycle-envelope normalization. Grok keeps native worker control;
  AutoCache persists continuity and immutable worker receipts.
- One generic local-host MCP distribution with profiles for LM Studio, Jan, and
  Open WebUI. Ollama is documented as the model engine behind an MCP-capable host,
  not as a plugin client. The bridge uses the stable split MCP TypeScript SDK v2
  packages in an isolated, locked Node 20+ package.
- Cross-surface packaging and proof documentation that keeps source, installation,
  loader discovery, real invocation, activation, and enforcement separate.

### Changed

- Removed the four duplicated read-only Grok skill copies. Grok Build now consumes
  the shared root skills directly, preventing a second procedure fork.
- Clarified that AutoCache's paid boundary is knowledge capability, not whether a
  local transport happens to use MCP. The generic bridge provides continuity tools;
  extraction, retrieval, indexing, propagation, consolidation, and eval remain
  Autonomous-only.

### Fixed

- Grok child lifecycle and tool events now normalize `sessionId`, `subagentId`,
  `subagentType`, `toolName`, and related top-level fields. Bounded parent lookup
  preserves child isolation; unknown or ambiguous parents cannot mutate the lead
  fork-chain head.

## [0.4.0] - 2026-08-12

### Added

- A first-class Codex plugin manifest and personal-marketplace development
  flow. The plugin owns AutoCache's six skills; the Codex adapter's new
  `--plugin-mode` installs native hooks, the rule, and the summarizer agent
  without creating duplicate skill registrations.
- A zero-dependency breadcrumb CLI for Codex and other skill-capable surfaces
  without Claude-style slash commands. It covers start, step, pending work,
  decisions, completion, abort, adoption, fork chains, retirement, backup,
  status, and list operations against the same scoped JSON store as the hooks.

### Fixed

- `activeBreadcrumb()` now treats an explicit null `active.json` pointer as
  idle state instead of an open breadcrumb. The old interpretation prevented
  a new breadcrumb from starting after a normal completion or abort.
- The seven Claude command snippets computed their state root as the BASE
  directory, so since 0.3.0 the slash commands read and wrote the legacy root
  while the hooks wrote the scoped store. They now resolve
  `<base>/stores/<scope>` exactly like the hooks (AUTOCACHE_SCOPE override,
  claude-code default).
- Documentation reconciled to the scoped-store reality: the Codex rule,
  Codex adapter README, command intros, and five skill files no longer
  describe one shared live `~/.autocache/` root. One shared FORMAT,
  per-surface stores, cross-surface resume via the shared-tag bridge and
  fork chains. A future-migration note for Codex plugin-bundled hooks is
  recorded in docs/hooks.md.

## [0.3.3] - 2026-08-12

### Fixed

- External-marker reconciliation no longer loses receipts to archive volume.
  Two live defects in `externalRecordHasMarker`: the 300-file collection cap
  was applied during an UNORDERED walk, so date-named archive dirs (oldest
  first in readdir order) filled the cap before the newest records were even
  collected - a receipt re-pended the moment its breadcrumb archived; and a
  burst of newer archive records could crowd still-ACTIVE records out of the
  bounded read window. Now: active-dir records are always read (own cap),
  archive dirs enumerate newest-first before the cap, and only archive
  records compete for the mtime-ranked read slots. Regression tests plant
  350 filler records and assert both tiers still find their markers.

## [0.3.2] - 2026-08-11

### Added

- Quarantined start-less stops with no worker type and no transcript are
  classified `probable_draft: true` - the live-identified signature of the
  runtime leaking the user's own typed drafts as SubagentStop events. Session
  start now reports drafts ("the user's own unsent typing - private") apart
  from unexplained events held for human review.
- `pruneQuarantinedDrafts()`: probable drafts older than
  `quarantine_draft_retention_days` (default 14) are pruned at session start.
  Non-draft quarantined events are never auto-pruned.

## [0.3.1] - 2026-08-11

### Fixed

- External reconciliation now survives a store with no local `breadcrumbs/`
  dir: the local-fallback scan's `readdirSync` throw used to abort
  `receiptReconciled` before the external-marker check ran, so a marker
  written in the external tracker never cleared the receipt. Found by live
  runtime probing minutes after 0.3.0 shipped; the repo gates were green
  because every test store had a local breadcrumbs dir. Regression test added.
- `breadcrumbSnapshot` falls through to the shared-tag bridge whenever there
  is no usable local tag - a junk `active.json` without an id no longer
  produces a null local binding instead of an external one.

## [0.3.0] - 2026-08-11

### Added

- Scoped stores: one universal state contract, one store per AI surface at
  `<base>/stores/<scope>`. Scope is `AUTOCACHE_SCOPE`, else the process-level
  surface name, else `default`. First run of a scope seeds continuity state
  from a legacy unscoped layout by copy (never move) and records
  `state/seed.json`. Older stores remain readable in place; nothing is
  relocated out from under other surfaces still running older hooks.
- Quarantine for unattributable stops: a `SubagentStop` with no matching start
  receipt is preserved verbatim under `quarantine/` with `quarantined: true`,
  `quarantine_reason: no_matching_start_receipt`, `untrusted_content: true`,
  and a `transcript_exists` disk check. It is never written to `workers/`,
  never surfaced as a worker result, never given a reconciliation directive,
  and never replayed as an instruction. Session start prints a bounded count
  only. Motivated by live phantom stop events observed 2026-08-11 arriving on
  conversation turn boundaries with user-shaped `final_message` text.
- `sweepOrphanStops()`: session start moves legacy stop-without-start worker
  dirs from `workers/` into `quarantine/`; `pendingWorkerReceipts()` also
  skips any stop lacking `start_receipt_id` so legacy phantoms can never
  resurface.
- Shared-tag bridge (inert by default): when no Autocache breadcrumb is open,
  receipts bind to the newest active external breadcrumb owned by this
  surface's actor, read from `config.json` `external_breadcrumb_dirs` /
  `external_breadcrumb_owner`. Receipts now carry `breadcrumb_source`
  (`autocache` | `external` | null), and exact-marker reconciliation also
  searches the external tracker's active and completed records, bounded.

### Changed

- `recordWorkerStop()` is fail-closed: no start receipt now routes to
  quarantine instead of writing an unpaired `workers/` receipt.

## [0.2.0] - 2026-08-11

### Added

- **Native worker integration.** Codex and Claude keep their native spawn,
  steering, wait, cancellation, permission, and worktree machinery. Autocache
  now records immutable `SubagentStart` and `SubagentStop` receipts keyed by the
  native parent/session and worker ids. Identified child `PostToolUse` events go
  to a per-worker stream and cannot increment or mutate the lead arc or active
  breadcrumb. Claude `TaskCreated`, `TaskCompleted`, and `TeammateIdle` events
  get separate native-team receipts without replacing its task list or mailbox.
  Codex does not promise worker identity on every child tool payload; while a
  worker is active, untagged events are quarantined instead of being allowed to
  change the lead arc. This prefers an omitted counter over a false owner write.
- **Lead-only worker reconciliation.** SessionStart resurfaces the latest
  unreconciled result per worker. The lead verifies it and records the exact
  `[worker:<receipt-id>]` marker in one breadcrumb milestone. A bounded worker
  never forks or owns the top-level chain; fork remains reserved for transfer of
  top-level outcome responsibility between sessions, surfaces, or machines.
- **Fork-chain takeover.** Cross-session and cross-agent handoff of an open
  breadcrumb is now a chain of records with exactly one live head. `/breadcrumb
  fork <id>` writes a new breadcrumb carrying the remaining steps and unresolved
  decisions (block indexes reindexed), then freezes the source with `forked_to`,
  `forked_by`, `forked_at`. A frozen record rejects every write - the rejection
  names the chain head so a returning session catches up instead of corrupting a
  dead branch. Take-back is a fork of the current head, so the chain grows forward
  with every hop attributed. Fork ids are guaranteed unique against the source; a
  record can never end up forked to itself.
- **Completion propagation.** Completing a chain head marks every still-open
  ancestor `complete` with `completed_via` set to the head id, so earlier sessions
  resume into "finished elsewhere, here is the pointer" rather than a dangling
  operation. Aborting a head propagates nothing: ancestors stay frozen pointing
  forward and the tail surfaces as adoptable work. An incomplete chain keeps
  surfacing until it is completed through the chain or explicitly retired with a
  recorded reason (`/breadcrumb retire <id> <reason>`).
- **Growable pending steps.** `planned_steps` grows mid-operation via `/breadcrumb
  add`, with a mechanical boundary: work discovered and finished before the
  agent's current output ends needs no entry; work still open when the output ends
  must be appended.
- **Awaiting-decision entries.** Breadcrumbs carry decisions - question, 2-3
  options, optional lean, `waits_on` (`"user"` or `"any_informed_session"`), and
  the `planned_steps` indexes they block. Blocked steps are refused until the
  decision resolves; unblocked steps proceed freely. Resolution records `chosen`,
  `decided_by`, `basis`, and `decided_at`. A `waits_on: "user"` decision resolves
  only with the user's actual answer.
- **Takeover eligibility ladder** in the `autocache-handoff` skill (referenced
  from `autocache-resume` and `/breadcrumb`): fork an idle head on demonstrated
  inactivity past a threshold, an explicit pass, or the user's direction; when
  activity cannot be determined, name the holding session, state the corruption
  risk, wait, re-check, and proceed only on the user's affirmation given after
  the risk statement. Cross-machine forks first compare the record file's mtime
  against its recorded last activity to detect an in-progress sync.
- **Hook surfacing.** `SessionStart` reports frozen breadcrumbs with their chain
  head, open decisions, finished-elsewhere pointers, and adoptable aborted tails.
  `PostToolUse` never steps or counts against a frozen record and emits a single
  advisory line naming the head. `Stop` checkpoints carry the chain position and
  the open-decision count.

### Changed

- `planned_steps` was already written by `/breadcrumb start` but was invisible to
  the hooks; the restore block and `Stop` checkpoints now count unfinished planned
  steps as remaining work. Log-style step entries (those carrying a timestamp or a
  source) are now classed as completed rather than remaining in the restore block.

State-file compatibility is preserved: every new breadcrumb field is optional, a
directory written by 0.1.0 reads unchanged, and records written with the new fields
degrade gracefully under 0.1.0 readers (a frozen record simply shows as open).

## [0.1.0] - 2026-07-31

First release. Free-tier session continuity for AI coding agents: your agent stops
forgetting what it was doing.

### Added

- **Pure-files architecture.** No MCP server, no compiled binary, no signing chain,
  no build step. Hooks, skills, commands, and JSON state. Install is dropping a
  directory in place.
- **Node runtime, zero npm dependencies.** Node standard library only. Windows,
  macOS, and Linux. Deliberately not Python, because `python3` does not reliably
  resolve on Windows and a hook with a missing interpreter fails silently.
- **State directory** at `~/.autocache/`, overridable with `AUTOCACHE_HOME`:
  `config.json`, `sessions/`, `breadcrumbs/`, `checkpoints/`, `state/`,
  `reminders.json`, and `logs/events.jsonl` rotated at 5 MB.
- **Atomic writes everywhere.** Write `<file>.tmp`, then `fs.renameSync`. A crash
  leaves the old file or the new file, never a truncated one that still parses.
- **Fail-open guarantee.** Every hook wraps its body in try/catch and exits 0 on
  every path. Malformed input, empty input, missing state, an unwritable state root,
  and corrupt JSON all exit 0 and do nothing. No hook blocks, denies, or halts a tool
  call.
- **Five Claude Code hooks:** `SessionStart` restore, `UserPromptSubmit` prior-finding
  surfacing, `PreToolUse` advisory breadcrumb and backup nudges, `PostToolUse`
  automatic breadcrumb stepping, `Stop` automatic checkpointing.
- **Slash commands:** `/resume`, `/checkpoint`, `/handoff`, `/status`, `/remind`,
  `/breadcrumb`, `/export`.
- **`session-summarizer` subagent** that condenses a long session into a continuation
  packet without pulling the whole transcript into the main context.
- **Free-tier feature set:** boot and identity restore; session lifecycle (start, add
  finding, list, get, close, export, delete); session summary and handoff packets;
  breadcrumbs (start, step, complete, abort, status, list, adopt, backup); checkpoint
  save, load, and clear plus a git rollback helper; self-state and scratch bag; local
  reminders including recurring, plus a time check; health check, error log, and
  fallback suggestion; config backup and validation before edits.
- **Codex surface** via an installer that materializes the same skills, hooks, and
  rules into `~/.codex/`. The hook scripts and the state directory are shared verbatim,
  so a session started under Claude Code is resumable under Codex.
- **Grok surface** as markdown skills only, documented plainly as read-only: Grok is a
  prompt surface with no hook events, so it narrates `~/.autocache/` and does not write
  to it.
- **Documentation:** install per surface, full state-file schemas, hook reference,
  FAQ, and the upgrade path. Worked examples of a resume and a handoff.
- **CI:** `node --check` across `hooks/` and `adapters/` on three operating systems
  and two Node majors; JSON parse and manifest shape validation, including asserting
  that `"${CLAUDE_PLUGIN_ROOT}"` is quoted; a repository hygiene job; and the
  **fail-open regression job**, which pipes malformed stdin, empty stdin, a
  nonexistent `AUTOCACHE_HOME`, an unwritable one, and a corrupt state directory into
  every lifecycle hook and hook adapter and asserts exit code 0 in every case. That job is the most
  important thing in CI: a continuity tool that breaks a session is worse than no tool.
- MIT license, contributing guide, security policy, and issue and pull request
  templates.

### Deliberately not included

Not a backlog. These are the paid tier (Autonomous) and the boundary is architectural,
not a license check: extraction, semantic and lexical and graph retrieval, index
maintenance, knowledge-base writes with propagation, consolidation and staleness
detection, context budgeting, learning analytics, and eval. All of them need an index
and a process that lives between invocations, which a one-shot hook cannot be.

Autocache remembers your work. Autonomous remembers your knowledge.

### Notes on claims

- Autocache is unrelated to Anthropic's prompt caching, which is a five-minute-TTL
  prefix match on API requests. The name refers to caching your work context on disk.
- Autocache does not make the model smarter. It restores context.
- State is local. There is no cross-machine sync in v1.
- Telemetry is off by default and no hook makes any network call.

[Unreleased]: https://github.com/josephwander-arch/autocache/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/josephwander-arch/autocache/releases/tag/v0.2.0
[0.1.0]: https://github.com/josephwander-arch/autocache/releases/tag/v0.1.0
