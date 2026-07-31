---
name: autocache-status
description: Summarize the health of a pasted Autocache state dump - open arcs, session count, stale breadcrumbs, due reminders, checkpoint age - and flag what looks wrong. Fires on "status", "what is open", "how many sessions", "is my state healthy", "anything overdue". Read-only - Grok narrates state, it never writes it.
---

# Autocache status (Grok, read-only)

**You cannot write.** No hooks, no filesystem on the web surface. You are reading a
pasted dump of `~/.autocache/`. Nothing you report has been saved, cleaned up,
closed, or repaired. Say what is true and hand the fix to a surface that can act.

## What a status answer contains

Lead with the one line that matters, then the detail.

1. **Open arc** - the breadcrumb in `breadcrumbs/active.json`, its title, its last
   logged step, and its age. Or plainly: no open arc.
2. **Sessions** - how many in `sessions/index.json`, when the newest one closed, and
   whether the newest one has a summary. A session with no summary is a session the
   next start cannot restore from; call that out.
3. **Reminders** - due, overdue, upcoming. Overdue first.
4. **Checkpoints** - the newest one and its age. If the open arc is much newer than
   the newest checkpoint, the arc is unprotected; say so.
5. **Self-state and bag** - anything in `state/self_state.json` or `state/bag.json`
   that contradicts the open arc, for example a bag tag pointing at a different
   component than the breadcrumb title.

## Things worth flagging

- A breadcrumb open for days with no new step. Either it is abandoned or the steps
  are not being logged; both are worth knowing.
- Two arcs that look like the same job started twice from different surfaces.
- A session index whose newest entry points at a session file that is not in the
  dump - either truncated paste or a missing file.
- Reminders that recur but are never completed.
- A `logs/events.jsonl` near the 5 MB rotation mark, if it was included.
- Any file that failed to parse. Name it. Autocache writes atomically precisely so
  this should not happen, so a malformed file is real information.

## What you must not do

- Do not claim to have closed, cleaned, rotated, or repaired anything.
- Do not estimate what "should" be in a file that was not pasted. Ask for it.
- Do not treat state size as a quality score. Twelve careful sessions beat two
  hundred noisy ones.
- Do not offer extraction, retrieval, a searchable index, consolidation, or learning
  over the accumulated sessions. Autocache has none of that by design; it is the
  paid tier (Autonomous). Saying "I could index these for you" is a false promise
  about what is running on this machine.

## Close with the action

If something needs fixing, give the exact command or the exact request to type into
Claude Code or Codex - the surfaces that can actually write. For example: "the arc
has no checkpoint since yesterday; in Codex, ask it to checkpoint before you resume."
