---
name: autocache-state-reference
description: Reference for the ~/.autocache state layout - what each file is, what it means, how to read it, and what Autocache deliberately does not contain. Fires on "what is in .autocache", "what does this JSON mean", "explain my state files", "is this normal", or when a user pastes an Autocache file and asks what it is. Read-only - Grok explains state, it never writes it.
---

# Autocache state reference (Grok, read-only)

**You cannot write.** Grok reads and explains. Every change described here has to be
made by the user or by a hook surface (Claude Code, Codex).

Autocache is session continuity for AI coding agents. It restores what the agent was
doing. It does not read the user's code, it does not phone home, telemetry is off by
default, and the state is plain JSON the user can open, diff, and delete.

## Layout

Root is `~/.autocache/`, or `AUTOCACHE_HOME` when that variable is set. On Windows
that is `%USERPROFILE%\.autocache\`.

```
~/.autocache/
  config.json               user settings, tier flag, telemetry opt-in (default off)
  sessions/
    <session-id>.json       one file per session: findings, summary, timestamps
    index.json              newest-first pointer list, capped
  breadcrumbs/
    <breadcrumb-id>.json    one tracked work arc: title, steps, targets, status
    active.json             the currently open breadcrumb, or null
  checkpoints/
    <checkpoint-id>.json    a restore point for an arc
  state/
    self_state.json         the agent's running notes about itself
    bag.json                scratch key/value tags for the current arc
  reminders.json            local reminders, including recurring ones
  logs/
    events.jsonl            append-only, rotated at 5 MB
```

## How to read it

- **Start at `breadcrumbs/active.json`.** If it names an arc, that is the live work.
  Its title should name the component and the files being changed; its last step is
  where work stopped.
- **`sessions/index.json` is newest-first**, so the first entry is the last session.
  Follow it to the session file for the summary and findings.
- **A session with no summary** is a session that ended without a proper close. It
  restores less. That is worth pointing out.
- **Timestamps are the tell.** An arc whose last step is much older than the newest
  session means steps stopped being logged, not that work stopped.
- **`logs/events.jsonl` is one JSON object per line.** Tail it; do not try to parse
  the whole file as a single document.

## Properties that are supposed to hold

- **Structured JSON replacement is atomic** - state JSON is written as `<file>.tmp`
  in the same directory and then renamed. JSONL logs are append-only instead: keep
  every valid line and ignore only a malformed or truncated final line after an
  interrupted append. Never treat the entire JSONL file as an atomic replacement.
- **Every hook fails open** - a missing, unreadable, or malformed file must never
  break the session. An empty restore is expected behavior on a fresh machine.
- **State is shared verbatim across surfaces** - Claude Code and Codex read and write
  the same directory, so an arc started in one is resumable in the other.
- **State is local.** There is no cross-machine sync in v1. A second machine has its
  own, separate `~/.autocache/`.
- **A stray `.tmp` file** in a state directory is a write that was interrupted; the
  real file beside it is still intact, which is the entire reason for the pattern.

## What is deliberately not here

No corpus, no extracted knowledge, no embeddings, no semantic or graph search, no
index, no consolidation or dedup, no context budgeting, no learning, no eval. If a
user asks Grok to search across all their past sessions for a concept, be straight:
free Autocache stores work arcs, it does not index knowledge. That capability is the
paid tier, Autonomous.

> Autocache remembers your work. Autonomous remembers your knowledge.

## One naming clarification worth making

"Autocache" refers to caching your **work context** on disk. It has nothing to do
with the model API's prompt cache, which is a short-lived prefix match that nothing
written to a file can extend, and which never survives a session boundary. If a user
believes Autocache is reducing their token cost through the API cache, correct it.

## Deleting

The user owns the directory. Removing `~/.autocache/` removes all continuity and
nothing else - no uninstall step, no service, no account. Say that plainly when
asked; a tool you cannot walk away from is a worse tool.
