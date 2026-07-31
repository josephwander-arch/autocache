---
name: autocache-session-close
description: Durably write everything the next session needs before an arc ends. Fires on "done for now", "that's it", "thanks, goodbye", "wrap up", "signing off", "I'm heading out", "let's stop here", "good enough for today"; before a context compaction; after finishing any substantial build, fix, or refactor; and whenever the conversation is about to end with work that produced durable changes.
---

# Autocache: Session Close

Chat context is not memory. Nothing is part of the record until it is written to
`~/.autocache/`. Close is where that happens - skip it and the next session starts
cold even though the code changes were correct.

## The closeout checklist

Run this in order. Skip a step only when it genuinely does not apply, and say
which one you skipped and why.

1. **Verify before recording.** Confirm on disk what you are about to claim -
   files exist, tests actually ran, the build actually passed. Never record a
   text claim as a verified fact.
2. **Log the final breadcrumb step**, then complete or abort it:
   - targets final and verified -> complete
   - approach abandoned or work reverted -> abort with the reason
   - work merely paused -> leave it OPEN and checkpoint instead
3. **Write the session summary.** What was done, what was verified and how,
   what is open, what is next. Concrete, with absolute paths.
4. **Checkpoint if anything is unfinished** - see `autocache-checkpoint`.
5. **Write a handoff if another agent, surface, or machine may continue** - see
   `autocache-handoff`. A handoff supersedes a bare summary; do not write both
   at length.
6. **Update self-state and clear the bag.** Persist notes that matter beyond this
   arc; drop scratch tags that do not. A bag full of dead keys is clutter the
   next session has to read past.
7. **Set reminders for the deferred items** you promised to return to.
8. **Verify the writes.** Read back what matters. "Written" from a tool is an
   acknowledgement, not proof.
9. **Report in three or four lines.** What was written, where, and what the next
   session will see on resume.

## Rules

- Close is durable-write time, not summary-prose time. If a sentence would not
  change what the next session does, leave it out.
- Do not complete a breadcrumb to make the session look tidy. An honestly open
  operation is correct state.
- Never delete session records or checkpoints as part of closing.
- If a write fails, say so plainly and tell the user what is not persisted. A
  silent failure here is the exact defect this tool exists to prevent.

## Worked example

User: "ok that's enough for today"

```
Verify : src/import/csv.js exists, mtime 16:38; npm test -- import 17/17 rerun, green
Step   : bc_csvimport_0731 step 6 - state-machine reader landed and verified;
         writeRejects still a stub at line 148. Next: implement it.
Breadcrumb: left OPEN (writeRejects unfinished)
Summary: session sess_2026-07-31_1642 written - 2 files landed, 1 stub open
Checkpt: cp_csvimport_0731 - files in play, verified/not-verified split,
         next action = implement writeRejects then npm test -- import
Bag    : cleared 3 scratch keys (fixture paths); self-state notes the
         "rejects sidecar, never throw" decision
Remind : none needed - the checkpoint carries the next action
```

Reply:

```
Written: breadcrumb step 6 (left open), session summary, and a checkpoint.
Next session resumes at: implement writeRejects in C:/proj/src/import/csv.js:148,
then npm test -- import. Tests are green at 17/17 as of now.
```
