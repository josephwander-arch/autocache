---
name: autocache-reminders
description: Create, check, complete, and delete local reminders, including recurring ones. Fires on /remind; on "remind me", "don't let me forget", "next time", "later", "tomorrow", "in an hour", "every morning", "every Monday", "when I come back", "check on", "follow up"; when a due reminder appears in the SessionStart restore block; and whenever you defer something you promised to return to.
---

# Autocache: Reminders

Reminders live in `~/.autocache/reminders.json`. They are local, plain JSON, and
they only surface when an agent session runs. Say that plainly the first time a
user creates one: **this does not page you, it does not run in the background,
and it does not fire when no session is open.** It is a note your next session
will read.

## Creating one

Every reminder needs a specific action and a due time.

- Text must be executable: "re-run token expiry tests after the JWT swap", not
  "auth stuff".
- Resolve relative times against the real clock before writing. Check the actual
  current time - never compute "tomorrow" from an assumed date.
- Store an absolute ISO-8601 timestamp with offset. Relative text rots.
- Recurring reminders carry an interval (daily, weekly, weekday, or an explicit
  cadence) and a next-due timestamp. Completing one advances next-due; it does
  not delete the reminder.
- Attach the breadcrumb id when the reminder belongs to a tracked operation, so
  resuming the arc surfaces it.

## Due-check discipline

- Check due reminders at session start and when the user signals a context
  change ("ok, back", "what's next", "anything pending").
- Surface due items **once**, near the top, in one line each. Do not re-announce
  the same reminder every turn - repetition trains the user to ignore them.
- Overdue items get the age stated: "due 2 days ago". Do not silently drop them.
- If a reminder is due and the user is mid-task on something else, mention it and
  move on. Do not hijack the current arc.

## Completing and deleting

- **Complete** when the action was actually performed. Do not complete on the
  basis of mentioning it. Do not complete a reminder just because the user
  acknowledged seeing it.
- **Delete** when the reminder is obsolete - the work was cancelled, the file is
  gone, the reason evaporated. Deleting is not failure; a list full of dead
  reminders is worse than a short list.
- Never mass-delete or mass-complete without naming what is being removed and
  getting a yes.
- Completing a recurring reminder rolls it forward. If the user means "stop this
  entirely", that is a delete - confirm which one they mean.

## Worked example

```
User: "remind me to re-run the token expiry tests tomorrow morning, and every
       Monday check whether the ORM v6 release notes changed"

Check clock: 2026-07-31T16:42-04:00

add       : "re-run token expiry tests (src/auth/session.js JWT swap)"
            due 2026-08-01T09:00-04:00, breadcrumb bc_authrefactor_0731
add       : "check ORM v6 release notes for query-builder index-hint changes"
            recurring weekly, Mondays, next due 2026-08-03T09:00-04:00

Reply: Two reminders set - the token tests for tomorrow 9am, the ORM notes every
Monday. These surface when a session starts; nothing runs in the background.
```

Next session, 2026-08-01:

```
Due: re-run token expiry tests (arc: auth refactor).
```

The user runs them and they pass -> complete it. The user says "yeah I saw that"
-> leave it due. It is not done until it is done.
