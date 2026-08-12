---
name: autocache-checkpoint
description: Save a restorable snapshot of the current work arc, and restore from one. Fires on /checkpoint; before anything risky or irreversible (large refactor, dependency bump, schema change, force push, mass rename); when context is filling up or compaction is near; before a long unattended run; at the end of a work block; and on phrases like "save my place", "checkpoint this", "before I break something", "restore", "roll back to", "go back to before", "I have to step away".
---

# Autocache: Checkpoint

A checkpoint answers one question: **if this context vanished right now, what
would the next session need to pick the work up mid-flight?**

State: `~/.autocache/stores/<surface>/checkpoints/<id>.json`. Written atomically. Stop also writes
one automatically at the end of an arc - your manual checkpoints are the ones
taken at moments only you can recognize as important.

## When to checkpoint

- Before an irreversible or hard-to-undo action - and pair it with a real backup
  of the files themselves. A checkpoint records intent, not file contents.
- Before a long unattended run, so a crash mid-run is recoverable.
- When context pressure is rising and detail is about to be summarized away.
- At a natural seam: a phase finished, a decision made, tests green.
- When the user steps away.

Do not checkpoint after every tool call. A checkpoint that captures nothing new
since the last one is noise that makes the useful ones harder to find.

## What belongs in one

Include, concretely:

- **goal** - what this arc is trying to achieve, in one sentence
- **breadcrumb id** - the open operation, if any
- **files in play** - absolute paths, and the state each is in (edited and saved,
  edited and untested, staged, untouched but relevant)
- **verified so far** - what actually passed, and how it was checked
- **not verified** - what was written but never run
- **decisions** - choices made and the reason, so they are not relitigated
- **blockers** - what is stuck, with the exact error text
- **next action** - one specific action, not a topic

Exclude: full file contents, transcript prose, tool output dumps, anything
recoverable by reading the repo. A checkpoint is a pointer set, not an archive.

## How to restore

1. Load the newest checkpoint for the arc (or the one the user names).
2. Reconcile against reality before acting: do the listed files exist, do the
   mtimes match, is the branch what it says, is the breadcrumb still open.
3. Report drift out loud. If the repo moved on since the checkpoint, the
   checkpoint is a hypothesis, not a fact.
4. Resume at the recorded next action. Do not redo verified work.
5. Clear a checkpoint only when its arc is closed - stale ones are cheap, and a
   deleted one you needed is not recoverable.

## Worked example

```
/checkpoint  before bumping the ORM major version

goal        : migrate to ORM v6 without changing query semantics
breadcrumb  : bc_ormv6_0731
files       : C:/proj/src/db/client.js       - edited, saved, tests green
              C:/proj/src/db/queries.js      - edited, saved, NOT run
              C:/proj/package.json           - unchanged, bump pending
              C:/proj/migrations/007_idx.sql - new, never applied
verified    : npm test -- db/client  18/18
not verified: queries.js rewrite; 007_idx.sql against a real database
decisions   : keep raw SQL for the reporting joins - v6 query builder loses the
              index hint and the report went 40x slower in the spike
blockers    : none
next action : bump orm to ^6.2.0 in package.json, npm install, run
              npm test -- db/queries and read the first failure
```

Restoring it a day later: confirm queries.js still has the rewrite, confirm
package.json is still on v5, then run the bump. Do not re-verify client.js.
