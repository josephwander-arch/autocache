# Worked example: a session resuming

What Autocache actually does, end to end. Two sessions on the same machine, a day
apart, with the terminal closed in between.

---

## Day one, 16:40 - the arc gets tracked

The work is a fix to a retry path. Three files are in scope, so a breadcrumb goes in
before anything is touched.

```
> /breadcrumb start retry backoff fix | targets: src/net/retry.js, src/net/client.js, test/retry.test.js
```

```
breadcrumb open: bc_20260730T164012_5c1e
  name    retry backoff fix | targets: src/net/retry.js, src/net/client.js, test/retry.test.js
  targets src/net/retry.js, src/net/client.js, test/retry.test.js
  session ses_20260730T163350_a17b
```

Work happens. `PostToolUse` appends automatic steps as files are edited - tool name
and target only, never file contents. Two findings get recorded explicitly, because
they are the kind of thing that is expensive to rediscover:

```
> the 500ms floor is deliberate - the gateway rate-limits below it, do not "fix" it
```

```
finding recorded on ses_20260730T163350_a17b
```

```
> jitter has to be applied before the cap, not after, or the cap eats the jitter
```

```
finding recorded on ses_20260730T163350_a17b
```

Then the day ends mid-arc, with the test file untouched and one question open. The
terminal gets closed. No `/checkpoint` is typed, because the `Stop` hook already wrote
one at the end of the last turn:

```json
{
  "version": 1,
  "id": "ckpt_20260730T171904_2fd0",
  "created_at": "2026-07-30T17:19:04.221Z",
  "reason": "stop-hook",
  "session_id": "ses_20260730T163350_a17b",
  "breadcrumb_id": "bc_20260730T164012_5c1e",
  "surface": "claude-code",
  "cwd": "/home/joseph/work/gateway",
  "git": { "branch": "fix/retry-backoff", "head": "9c41ab2", "dirty": true },
  "arc": {
    "title": "retry backoff fix",
    "last_step": "Edit src/net/client.js",
    "open_targets": ["test/retry.test.js"],
    "next": "cover the jitter-before-cap ordering in a test"
  },
  "notes": ""
}
```

---

## Day two, 09:12 - the session restores

A new session starts in the same directory. `SessionStart` fires, reads the state
directory, and emits a restore block as `additionalContext` before the first prompt is
processed. Nothing is typed to make this happen.

```
Autocache restore - 2026-07-31T09:12:44Z

Last session  ses_20260730T163350_a17b  closed 16h ago  /home/joseph/work/gateway
  retry backoff fix. Backoff and client changes landed; tests not started.

Open breadcrumb  bc_20260730T164012_5c1e  retry backoff fix
  targets    src/net/retry.js, src/net/client.js, test/retry.test.js
  6 steps    last: Edit src/net/client.js (2026-07-30T17:18:51Z)
  still open test/retry.test.js

Checkpoint  ckpt_20260730T171904_2fd0  stop-hook
  branch fix/retry-backoff at 9c41ab2, working tree dirty
  next   cover the jitter-before-cap ordering in a test

Findings from last session
  - the 500ms floor is deliberate - the gateway rate-limits below it, do not "fix" it
  - jitter has to be applied before the cap, not after, or the cap eats the jitter

Self-state
  focus  retry backoff fix
  open   does the gateway rate-limit per-connection or per-key

Reminders due
  - re-run the soak test before merging  (due 2026-07-31T09:00Z)
```

The first prompt of the day is then short, because none of the context has to be
re-explained:

```
> pick it up
```

```
Picking up bc_20260730T164012_5c1e. src/net/retry.js and src/net/client.js are
done and the tree is dirty on fix/retry-backoff. What is left is test/retry.test.js,
and the specific case to cover is jitter applied before the cap.

Two constraints from yesterday that I will not violate: the 500ms floor stays, and
jitter goes before the cap. The open question - per-connection or per-key rate
limiting - is still unanswered and does not block the test.

Starting on the test now.
```

The model is not smarter than it was yesterday. It simply is not starting from zero.

---

## Closing the arc

```
> /breadcrumb complete jitter ordering covered; soak test passed
```

```
breadcrumb complete: bc_20260730T164012_5c1e
  7 steps  duration 17h 8m  targets all closed
```

```
> /handoff
```

Writes the continuation packet - see [handoff-packet.md](handoff-packet.md).

---

## What made the restore possible

| Written when | What | Where |
|---|---|---|
| Breadcrumb opened | Arc name, targets, session link | `breadcrumbs/bc_20260730T164012_5c1e.json` |
| Each tool call | Automatic step, tool name and target only | same file, `steps[]` |
| Each finding | Text you typed, with a timestamp | `sessions/ses_20260730T163350_a17b.json` |
| End of every turn | Checkpoint with git state and what is next | `checkpoints/ckpt_20260730T171904_2fd0.json` |
| Throughout | Event trail for debugging | `logs/events.jsonl` |

All of it is plain JSON under `~/.autocache/`. None of it left the machine, none of it
contains file contents or prompt text, and deleting the directory removes every trace.
