# Autocache

**Your agent stops forgetting what it was doing.**

Free-tier session continuity for AI coding agents. Hooks capture the shape of your
work as it happens, state persists as plain JSON on your own disk, and the next
session restores it. No server, no binary, no npm dependencies, no account.

[![CI](https://github.com/josephwander-arch/autocache/actions/workflows/ci.yml/badge.svg)](https://github.com/josephwander-arch/autocache/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## The problem

You close the terminal and the arc is gone: what you were mid-way through, what you
already ruled out, which file you were about to back up.
The next session starts cold, so you re-explain the same context, and the agent
re-discovers the same dead ends you paid for yesterday.
Nothing about that is a model problem. It is a state problem, and state belongs on disk.

<!-- TERMINAL RECORDING: docs/assets/resume.cast - a session closing mid-arc and the next session restoring it. Placeholder until recorded. -->

## Install in 30 seconds

### Claude Code

```
/plugin marketplace add josephwander-arch/autocache
/plugin install autocache
```

Restart the session. The `SessionStart` hook runs on the next launch and there is
nothing else to configure.

### Codex

Codex has its own `~/.codex/` directories, so an installer materializes the same
skills, hooks, and rules there.

```sh
# inspect first, then run
curl -fsSL https://raw.githubusercontent.com/josephwander-arch/autocache/main/install.sh -o install.sh
sh install.sh
```

```powershell
# Windows
irm https://raw.githubusercontent.com/josephwander-arch/autocache/main/install.ps1 -OutFile install.ps1
./install.ps1
```

### Grok

Grok is a prompt surface, not a hook surface. Copy the markdown skills from
`skills/` into your Grok skill directory. Grok **reads** `~/.autocache/` and narrates
what it finds; it does not write state. See [docs/install.md](docs/install.md).

The Node hook scripts and the `~/.autocache/` state directory are shared verbatim
across surfaces. A session started under Claude Code is resumable under Codex.

## What it stores, and where

Everything lives under `~/.autocache/` (`%USERPROFILE%\.autocache\` on Windows).
Override the location with the `AUTOCACHE_HOME` environment variable.

```
~/.autocache/
  config.json               user settings, tier flag, telemetry opt-in (default OFF)
  sessions/
    <session-id>.json       one file per session: findings, timings, status
    index.json              newest-first pointer list, capped
  breadcrumbs/
    <breadcrumb-id>.json    a tracked work arc and its steps
    active.json             the currently-open breadcrumb, or null
  checkpoints/
    <checkpoint-id>.json    resumable snapshot of the arc
  workers/
    <session>/<worker>/     immutable start/stop receipts and child tool events
  teams/
    <session>/<team>/       Claude native-team task and idle receipts
  state/
    self_state.json         the agent's running notes about itself
    bag.json                scratch key/value tags for the current arc
  reminders.json            local reminders, including recurring
  logs/
    events.jsonl            append-only, rotated at 5 MB
```

Plain JSON. Human-readable. Structured record replacement is atomic
(`<file>.tmp` then rename), so a crash cannot replace a good receipt with a
truncated one. Diagnostic `events.jsonl` streams append directly; a crash can
leave one truncated final line, which readers must ignore.
Full schemas: [docs/state-format.md](docs/state-format.md).

## Free vs paid

**Autocache remembers your work. Autonomous remembers your knowledge.**

| | Autocache (free) | Autonomous (paid) |
|---|---|---|
| Boot / identity restore | Yes | Yes |
| Session lifecycle: start, finding, list, get, close, export, delete | Yes | Yes |
| Session summary and handoff packets | Yes | Yes |
| Breadcrumbs: start, step, complete, abort, status, list, adopt, backup | Yes | Yes |
| Native worker receipts, child-event isolation, lead reconciliation | Yes | Yes |
| Checkpoint, load, clear, git rollback helper | Yes | Yes |
| Self-state and scratch bag | Yes | Yes |
| Local reminders, recurring, time check | Yes | Yes |
| Health check, error log, fallback suggestion | Yes | Yes |
| Config backup and validation before edits | Yes | Yes |
| Scope | Single machine, one top-level work arc plus native child workers | Accumulating knowledge base |
| Knowledge extraction from your sessions | No | Yes |
| Semantic, lexical, and graph retrieval | No | Yes |
| Index maintenance and consolidation | No | Yes |
| Context budgeting | No | Yes |
| Learning analytics and eval | No | Yes |
| Install | Drop in a directory | Ships an MCP server binary |

Autocache never gets smarter. It just never forgets what it was doing, and for its
job that is complete. The moment you have a pile of breadcrumbs and session records
and start wondering whether anything can *learn* from them, that question is the
paid tier: [docs/upgrade.md](docs/upgrade.md).

## What this is not

- **It does not read your code.** Hooks see the tool-call metadata the harness hands
  them, plus what you explicitly record. There is no repository scan and no file
  content ingestion.
- **It does not phone home.** No network calls in any hook. Telemetry is off by
  default and there is no endpoint configured for it to reach.
- **It is not prompt caching.** Anthropic's prompt cache is a five-minute-TTL prefix
  match on API requests. Nothing Autocache writes survives it, and nothing survives a
  session boundary. The name refers to caching *your work context* on disk, not to the
  API's token cache. The two are unrelated.
- **It does not make the model smarter.** It restores context. That is all it does.
- **It does not replace native agent teams.** Codex and Claude still spawn,
  steer, wait for, and stop their workers. Autocache isolates identified child
  events, persists their return receipts, and leaves one durable top-level
  fork-chain owner.
- **It does not sync across machines in v1.** State is local. If you want it on two
  machines, you move the directory yourself.
- **It is not a knowledge base.** No extraction, no retrieval, no learning. Those are
  Autonomous, and they genuinely cannot be done with hooks and JSON.
- **State is yours.** Read it with any JSON tool. `rm -rf ~/.autocache` uninstalls all
  of it, and nothing else on your system changes.

## Requirements

Node.js (any currently supported release) and nothing else. Zero npm dependencies -
Node standard library only. Windows, macOS, and Linux.

## Docs

- [Install per surface](docs/install.md)
- [State format](docs/state-format.md)
- [Hook reference](docs/hooks.md)
- [FAQ](docs/faq.md)
- [Upgrade path](docs/upgrade.md)
- [Worked resume](examples/resume-transcript.md) and [worked handoff](examples/handoff-packet.md)

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
The rule that outranks every feature: **every hook fails open**. A continuity tool
that breaks the session it exists to protect is worse than no tool.

## License

MIT. Copyright (c) 2026 Joseph Wander. See [LICENSE](LICENSE).
