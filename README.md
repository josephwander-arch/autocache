# AutoCache

**Your agent stops forgetting what it was doing.**

Free-tier session continuity for AI coding agents. Native hooks or explicit MCP
tools capture the shape of your work, state persists as plain JSON on your own
disk, and the next session restores it. No account and no hosted service.

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

The first-class Codex plugin supplies AutoCache's visible skills and local
breadcrumb CLI. Codex does not load native hooks from plugins, so the adapter
installs the same hook scripts, rule, and session-summarizer agent without
duplicating the plugin-owned skills.

```sh
codex plugin add autocache@personal
node adapters/codex/install.js --plugin-mode
```

The personal marketplace is a local-development path. Published installers may
use a different marketplace name while keeping the plugin id `autocache`.

Direct installer fallback (when the plugin marketplace is unavailable):

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

Grok Build has a first-class native plugin. It loads the shared skills, commands,
agents, and lifecycle hooks through `.grok-plugin/plugin.json` while keeping full
control of native worker execution.

```sh
grok plugin install josephwander-arch/autocache --trust
```

Reload plugins or start a new session, then verify loader discovery with
`grok inspect --json`. Plain grok.com chat is a different, hookless surface.

### Claude Desktop

Download `autocache-0.5.0-win.mcpb` from the [releases page](https://github.com/josephwander-arch/autocache/releases) and double-click it (or Settings > Extensions > Advanced settings > Install Extension...). Claude Desktop supplies Node.js; no clone or `npm ci` is needed. Details: [adapters/local-hosts/mcpb/README.md](adapters/local-hosts/mcpb/README.md).

### Local-model hosts

The generic distribution is one MCP bridge with tested profiles for LM Studio,
Jan, and Open WebUI. Ollama is supported as the model engine behind one of those
MCP-capable hosts; Ollama itself is not the plugin client.

```sh
cd adapters/local-hosts/mcp-server
npm ci --ignore-scripts
```

Choose the host profile under `adapters/local-hosts/`. These hosts expose explicit
continuity tools; they do not receive automatic lifecycle capture unless their own
runtime supplies equivalent hooks.

The Node hook scripts and the `~/.autocache/` state directory are shared verbatim
across surfaces. A session started under Claude Code is resumable under Codex or
Grok Build, and the same state is available through the local-host MCP bridge.

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
- **It does not replace native agent teams.** Codex, Claude, and Grok still spawn,
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

Claude Code, Codex, and Grok Build require Node.js 20 or newer and use only the Node
standard library at runtime. The optional generic MCP bridge keeps its official MCP
SDK and HTTP dependencies isolated under `adapters/local-hosts/mcp-server/` with a
committed lockfile. Windows, macOS, and Linux are supported.

## Docs

- [Install per surface](docs/install.md)
- [Four distributions and compatibility](docs/distributions.md)
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
