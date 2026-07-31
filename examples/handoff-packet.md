# Worked example: a handoff packet

A handoff is not a transcript. It is a continuation packet: what is done, what is
left, what will bite the next agent, and the exact first move. If the receiving agent
has to ask a clarifying question before it can act, the packet failed.

Written by `/handoff`, optionally via the `session-summarizer` subagent so a long
session gets condensed without pulling the whole transcript into the main context.

---

## What `/handoff` produces

````
> /handoff to codex
````

```
handoff written
  session    ses_20260730T163350_a17b
  breadcrumb bc_20260730T164012_5c1e
  summary    stored on the session record
  resume     start a session under any surface sharing ~/.autocache
```

The packet itself:

---

# Handoff: retry backoff fix

**From** Claude Code, session `ses_20260730T163350_a17b`
**Breadcrumb** `bc_20260730T164012_5c1e` (open)
**Repository** `/home/joseph/work/gateway`, branch `fix/retry-backoff` at `9c41ab2`, working tree dirty
**Written** 2026-07-31T11:02:18Z

## Goal

Retries hammer the gateway during a partial outage. Fix the backoff so it actually
backs off, without dropping below the rate limiter's floor.

## Done

1. `src/net/retry.js` - exponential backoff with full jitter, applied before the cap.
2. `src/net/client.js` - calls the new backoff; the old inline `setTimeout` retry loop
   is gone.
3. `test/retry.test.js` - covers jitter-before-cap ordering. Passes.

Verified by running the unit suite and one soak run against the staging gateway. Both
green.

## Remaining

1. The soak test has only been run once. Run it again after any change to
   `src/net/retry.js` before merging.
2. `docs/networking.md` still documents the old fixed-interval retry. Not updated.
3. No test covers the 500ms floor itself. The floor is enforced but unguarded, so a
   future edit can silently remove it.

## Constraints that will bite you

- **The 500ms floor is deliberate.** The gateway rate-limits below it. It reads like a
  magic number and it is not - do not "clean it up."
- **Jitter goes before the cap, not after.** Applied after, the cap eats the jitter and
  every client retries in lockstep, which is the bug this change exists to fix.
- **Open question, unanswered:** whether the gateway rate-limits per-connection or per-key.
  It does not block this work, but it decides whether the floor should be per-client or
  global. Ask the gateway owner before extending this.

## Risk

Medium. The change is confined to the retry path, but that path is on every outbound
call. The failure mode of getting it wrong is a retry storm during exactly the outage
you were trying to survive - the thing you would least want to discover in production.

Rollback is `git checkout src/net/retry.js src/net/client.js`. Nothing is deployed and
no state outside the repository was modified.

## Your first move

```sh
cd /home/joseph/work/gateway
git status                 # confirm the dirty tree matches 9c41ab2 + these three files
npm test -- retry          # should be green before you change anything
```

Then start with the missing floor test - it is the smallest piece and it locks in the
constraint that the next person is most likely to break.

## State to adopt

```
breadcrumb  bc_20260730T164012_5c1e   adopt it rather than opening a new one
session     ses_20260730T163350_a17b  closed, summary attached
checkpoint  ckpt_20260731T110218_8ae3 manual, written with this handoff
```

---

## Picking it up on another surface

The state root is shared verbatim, so the receiving agent reads the same
`~/.autocache/`. Under Codex:

```
> /resume
```

```
Autocache restore - 2026-07-31T11:40:03Z

Handoff waiting  from claude-code  written 38m ago
  retry backoff fix - 3 items done, 3 remaining, medium risk

Open breadcrumb  bc_20260730T164012_5c1e  retry backoff fix
  adopt to continue logging steps against it
```

```
> adopt it
```

```
breadcrumb adopted: bc_20260730T164012_5c1e
  owner claude-code -> codex
  7 steps carried forward
```

Ownership moved. One active owner per arc at a time, so the previous surface stops
stepping it and the trail stays single-threaded.

---

## Rules that make a packet worth reading

1. **Done means verified, not attempted.** Say what you ran. "Should work" belongs
   under Remaining.
2. **Constraints are the highest-value section.** Anything a reasonable engineer would
   undo because it looks wrong needs a sentence saying why it is right.
3. **Open questions stay open.** Do not resolve them by guessing in the packet - a
   confident wrong answer is worse than an acknowledged gap.
4. **State the first move as a command.** The receiving agent should be able to start
   without a reply.
5. **Name the rollback.** If it is not reversible, say that instead, loudly.
6. **No transcript.** Nobody reads it, and it buries the three lines that matter.
