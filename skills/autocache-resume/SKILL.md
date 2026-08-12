---
name: autocache-resume
description: Reconstruct what the previous session was doing before answering or acting. Fires at session start, on /resume, whenever SessionStart surfaces a FROZEN breadcrumb, fork-chain pointer, or unreconciled native-worker receipt, and on continuity language such as "where were we", "pick up where we left off", "continue", "did we finish", "what's left", "yesterday", "earlier", or "before the crash".
---

# Autocache: Resume

Never guess at prior state and never announce a fresh start. Read what was durably
written, then say plainly what you found and what you did not.

State lives in the scoped store `~/.autocache/stores/<surface>/` (`AUTOCACHE_HOME` overrides the base, `AUTOCACHE_SCOPE` the surface). It is plain JSON.
Read it directly if the SessionStart restore block is missing or truncated.

## Procedure

1. **Use the injected restore block first.** SessionStart emits last session
   summary, open breadcrumb, due reminders, and self-state. If it is present,
   that is your source - do not re-read the files for the same facts.
2. **If absent or thin, read in this order and stop as soon as you can act:**
   - `sessions/index.json` -> newest entry -> `sessions/<id>.json` (summary, findings)
   - `breadcrumbs/active.json` -> if non-null, `breadcrumbs/<id>.json` (steps, targets)
   - if that record carries `forked_to`, it is frozen - follow the chain to its
     head before reasoning about state (see "Catching up on a fork chain")
   - `checkpoints/` -> newest checkpoint for the same arc
   - `workers/` -> newest unreconciled `stop_*.json` receipt per native worker
   - `state/self_state.json` and `state/bag.json`
   - `reminders.json` -> anything due
3. **Reconcile against the filesystem before trusting the record.** A breadcrumb
   step says a file was written; confirm the file exists and its mtime is
   consistent. Text claims are not proof.
4. **Report in four lines, then stop.** Where we were / what is open / what is
   due / proposed next action. Do not restate the whole transcript.
5. **State gaps explicitly.** "No session record found" is a valid, useful answer.
   Never invent continuity you cannot read.
6. **Adopt before you act.** If an open breadcrumb belongs to a different agent or
   surface and is still fresh, say so and ask before taking it over. Taking over
   a live head means forking it, and forking has an eligibility ladder - see
   `autocache-handoff`.
7. **Reconcile worker results as the lead.** For each pending worker receipt,
   inspect its final message and claimed files, verify the decisive evidence,
   then log one milestone containing `[worker:<receipt-id>]`. Do not fork for a
   bounded worker return, and do not treat the receipt itself as validation.

## Catching up on a fork chain

A record with `forked_to` set is frozen: the work moved, and this record is
read-only history. Every write against it is rejected naming the chain head -
that rejection is your catch-up signal, not an error to work around. Follow
`forked_to` hop by hop to the head, then act on the head's status:

- **Head open** - the work is live in another session's hands. Read the chain's
  steps and decisions to catch up, then contribute read-only, ask for a pass, or
  take over by forking the head under the eligibility ladder in
  `autocache-handoff`. Never write to any frozen record on the way.
- **Head complete** - the chain is done. Ancestors carry `completed_via` with
  the head id: report "finished elsewhere, completed via <head>" in one line.
  There is nothing to resume.
- **Head aborted, not retired** - the chain tail is adoptable work. Offer to
  adopt it (`/breadcrumb adopt <tail-id>`) or to retire the chain with a
  recorded reason. An incomplete chain keeps surfacing until it is completed
  through the chain or explicitly retired - never silently drop one.
- **Open decisions** - a step blocked by an unresolved decision stays unworked.
  If it waits on the user, surface the question, the options, and any recorded
  lean; only the user's answer resolves it. Unblocked steps proceed freely.

Before forking across machines, compare the record file's mtime against its
recorded last activity. An mtime newer than the record explains means a sync is
in progress: wait for it to settle, then re-read.

## Do not

- Do not open a new breadcrumb when one is already open for the same arc.
- Do not close, complete, or clear anything during resume. Resume is read-only
  except for adopting an operation you intend to continue, or forking a head
  you are eligible to take over.
- Do not write to a frozen record, and do not re-open one. The chain only grows
  forward from its head.
- Do not claim the tool "remembered" anything that is not in the state files.
- Do not silence a pending worker receipt by writing its marker before checking
  the result it points to.

## Worked example

User opens with: "ok what was I doing with the auth refactor"

```
Read: sessions/index.json -> sess_2026-07-30_1912.json
Read: breadcrumbs/active.json -> bc_authrefactor_0731 (open, 6 steps, last 14h ago)
Read: reminders.json -> 1 due: "re-run token expiry tests"
Stat: src/auth/session.js mtime 2026-07-30 19:44 - matches step 6
```

Reply:

```
Where we were: auth refactor - swapped session cookies to signed JWT,
  breadcrumb bc_authrefactor_0731, last step 14h ago.
Open: step 6 landed src/auth/session.js; step 7 (middleware wiring) not started.
Due: reminder - re-run token expiry tests.
Next: wire requireAuth in src/middleware/auth.js, then run the expiry tests.
  Confirm and I will log step 7 against the same breadcrumb.
```

Counter-example - do not do this:

```
Great, let's start the auth refactor! First I'll look at your codebase...
```

That discards six recorded steps and re-does work that already landed.
