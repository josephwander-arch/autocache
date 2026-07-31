# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

State-file compatibility is treated as public API: a directory written by an older
version must stay readable by a newer one. Any change that breaks that is a major
version bump and is called out here explicitly.

## [Unreleased]

Nothing yet.

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
  every hook and adapter and asserts exit code 0 in every case. That job is the most
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

[Unreleased]: https://github.com/josephwander-arch/autocache/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/josephwander-arch/autocache/releases/tag/v0.1.0
