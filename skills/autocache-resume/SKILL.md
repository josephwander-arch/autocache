---
name: autocache-resume
description: Reconstruct what the previous session was doing before answering or acting. Fires at session start, on /resume, and whenever the user opens with continuity language - "where were we", "what was I doing", "pick up where we left off", "continue", "still working on", "did we finish", "what's left", "yesterday", "earlier", "before the crash" - or when a SessionStart restore block is present, or when the user references work you have no record of in this context.
---

# Autocache: Resume

Never guess at prior state and never announce a fresh start. Read what was durably
written, then say plainly what you found and what you did not.

State root is `~/.autocache/` (`AUTOCACHE_HOME` overrides it). It is plain JSON.
Read it directly if the SessionStart restore block is missing or truncated.

## Procedure

1. **Use the injected restore block first.** SessionStart emits last session
   summary, open breadcrumb, due reminders, and self-state. If it is present,
   that is your source - do not re-read the files for the same facts.
2. **If absent or thin, read in this order and stop as soon as you can act:**
   - `sessions/index.json` -> newest entry -> `sessions/<id>.json` (summary, findings)
   - `breadcrumbs/active.json` -> if non-null, `breadcrumbs/<id>.json` (steps, targets)
   - `checkpoints/` -> newest checkpoint for the same arc
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
   surface and is still fresh, say so and ask before taking it over. See
   `autocache-breadcrumb`.

## Do not

- Do not open a new breadcrumb when one is already open for the same arc.
- Do not close, complete, or clear anything during resume. Resume is read-only
  except for adopting an operation you intend to continue.
- Do not claim the tool "remembered" anything that is not in the state files.

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
