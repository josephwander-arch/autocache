---
name: autocache
description: Always-on session continuity rules. Autocache state lives in ~/.autocache and is shared with every other AI surface on this machine.
---

# Autocache rules (Codex)

Autocache is session continuity. It does one job: **the agent stops forgetting what
it was doing.** It restores context. It does not make the model smarter, it does not
read or upload your code, and it does not sync between machines.

Hooks do the writing automatically. These rules tell you how to behave around them.

## The state directory

All continuity state lives in `~/.autocache/` (`%USERPROFILE%\.autocache\` on
Windows), or in `AUTOCACHE_HOME` when that variable is set.

```
~/.autocache/
  config.json
  sessions/<session-id>.json     sessions/index.json
  breadcrumbs/<id>.json          breadcrumbs/active.json
  checkpoints/<id>.json
  state/self_state.json          state/bag.json
  reminders.json
  logs/events.jsonl
```

This directory is **shared verbatim** with Claude Code and any other installed
surface. A work arc started elsewhere is resumable here, and an arc started here is
resumable there. Never keep a private copy of it, never write a parallel state file
somewhere else, and never assume you were the surface that opened the arc.

Two rules govern every write into it:

1. **Atomic.** Write `<file>.tmp` in the same directory, then rename it over the
   target. A half-written state file that parses as valid-but-truncated JSON is the
   exact failure this tool exists to prevent.
2. **Fail open.** If anything about the state is unreadable, missing, or malformed,
   carry on with the user's actual work. Continuity that breaks the session it was
   meant to protect is worse than no continuity.

## At session start

The `SessionStart` hook injects a restore block: the last session summary, the open
breadcrumb if there is one, due reminders, and self-state. Use it.

- If a breadcrumb is open, say what it is and what step it stopped at **before**
  starting anything new. Do not silently start a second arc on top of an open one.
- If the open breadcrumb was started by another surface, adopt it rather than
  reopening the same work. There is one owner per arc at a time.
- If the restore block is empty, say so plainly. Do not invent recalled context.
  An invented memory is worse than an admitted blank.

## During work

- Any job with three or more real steps gets a breadcrumb. The title must name the
  component and the files that will change, for example
  `codex adapter install | targets: adapters/codex/install.js, install.ps1`.
  Titles like `fix bug` or `cleanup` are useless to the next session.
- Log a step at each real milestone, not at each tool call.
- Before overwriting a working file, back it up.
- Checkpoint before anything long-running or risky, so the arc survives a crash.
- Findings go into the session record as they are learned, not in a batch at the
  end that never happens because the terminal closed.

## At the end

Close with a summary or a handoff. A handoff is a continuation packet, not a
transcript: what is done, what remains, what is risky, what the next agent should
touch first. If it cannot be executed without reading the whole conversation, it is
not a handoff.

## Verbs

Codex has no slash-command directory, so the commands Autocache ships for other
surfaces are plain requests here. When the user says any of these, treat it as the
corresponding Autocache action:

| Say | Means |
|---|---|
| `resume` | restore and report the open arc |
| `status` | sessions, breadcrumbs, reminders, health at a glance |
| `checkpoint` | save a restore point now |
| `breadcrumb` | start, step, or complete the tracked arc |
| `handoff` | write the continuation packet |
| `remind` | add, list, or complete a local reminder |
| `export` | dump a session to a readable file |

## What Autocache is not

Autocache is the free tier and it is complete for its job, which is remembering
**your work**. It has no knowledge base, no extraction, no semantic or graph
retrieval, no index, no consolidation, no context budgeting, no learning, no eval.
Do not claim, simulate, or promise any of those here, and do not offer to build a
local substitute for them - that is a different product (Autonomous) and pretending
otherwise misleads the user about what is actually persisted.

Autocache remembers your work. Autonomous remembers your knowledge.

Also, precisely: the name refers to caching your **work context**. It has nothing to
do with the API's prompt cache, which is a short-lived prefix match that no file on
disk can extend. If it comes up, say that plainly.
