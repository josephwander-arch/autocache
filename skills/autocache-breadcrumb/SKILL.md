---
name: autocache-breadcrumb
description: Tracked-operation discipline - open a breadcrumb, log steps at real milestones, append still-open work as pending steps, record decisions the arc cannot settle, complete or abort at the end. Fires before any job with three or more steps, any build, fix, refactor, migration, deployment, or multi-file edit; on /breadcrumb; on a PreToolUse breadcrumb nudge; and on phrases like "track this", "start working on", "let's build", "walk through", "one at a time", "note this for later", "open question", "needs a decision", "blocked on", "abandon this", "scrap that approach", "done with this".
---

# Autocache: Breadcrumb

A breadcrumb is the running record of one mutable operation. It is what makes the
next session able to continue instead of restart.

State: `~/.autocache/breadcrumbs/<id>.json`, with `breadcrumbs/active.json`
pointing at the currently open one (or null). One open breadcrumb per arc.

## When to open one

Open before the first mutating tool call when any of these is true:

- the job has three or more planned steps
- it writes to more than one file
- it is a build, deploy, migration, refactor, or a fix with a diagnosis phase
- it will plausibly outlive this session

Do not open one for: a single read, a one-line edit, a question, an exploration
pass with no writes.

## Title rule

The title must name the component and the mutable targets, so another agent knows
what is being written before it starts anything.

- Good: `auth refactor | targets: src/auth/session.js, src/middleware/auth.js`
- Bad: `fix bug`, `cleanup`, `update files`

## When a step is worth logging

Log a step when a **verifiable milestone** lands. Every step must be restartable
from - a step that only says "thinking about the schema" helps no one.

Log: file written and verified, test suite passing, build green, decision made
with its reason, blocker discovered, approach reversed.

Do not log: each individual read, each grep, intermediate edits inside one
milestone, restating the plan.

Rough cadence: 1 step per 5-15 tool calls. PostToolUse counts calls since the
last step; if it flags a long gap, log one.

Each step records: what changed, the exact paths touched, how it was verified,
and what is next.

## Pending steps: the micro-fix boundary

The planned list grows mid-operation; discovering work is normal. The rule for
whether it gets an entry is a boundary, not a judgment call:

- **Discovered and finished before your current output ends** - no entry. A
  micro-fix folds into the milestone it belongs to; recording it separately is
  noise.
- **Still open when your output ends** - it MUST be appended as a pending step
  (`/breadcrumb add`). No exceptions. Work that exists only in your head does not
  exist for the next session, and the next session is the whole point.

The test is mechanical: at the end of every response, anything you know is open
and unrecorded gets appended before you stop.

## Decisions the arc cannot settle

When the work hits a genuine fork - a question with 2-3 defensible answers - record
it instead of guessing: `/breadcrumb decide` with the question, the options, your
lean if you have one, and `waits_on`:

- `waits_on: "user"` - only the user's actual answer resolves it. Ask; never
  resolve it yourself, and never treat silence as an answer.
- `waits_on: "any_informed_session"` - any agent with the full recorded picture may
  decide, and the resolution must record `basis`: what in the record justified the
  call. "It seemed right" is not a basis.

`blocks` names the planned-step indexes that must wait. Everything not blocked
proceeds freely - a decision is a gate on specific steps, not a stop sign on the
arc. Never work a blocked step; resolve first. Resolution records `chosen`,
`decided_by`, `basis`, and `decided_at`, so the next session inherits the answer
and the reasoning, not just the outcome.

## Frozen records and the chain

A breadcrumb with `forked_to` set has been forked away: another record now owns
the remaining work. It is frozen - every step, add, decide, resolve, complete, or
abort against it is rejected with a message naming the chain head. When you see
that rejection, stop and catch up on the head; do not route around it. Taking the
work back means forking the current head (see `autocache-handoff` for the fork
protocol and the takeover eligibility ladder).

## Complete versus abort

- **Complete** when the stated targets are in their intended final state and
  verified. Completing an operation whose work you reverted is a false record.
  Completing a chain head also closes every still-open ancestor as
  `completed_via` the head - the chain finishes as a unit.
- **Abort** when the approach was abandoned, the work was rolled back, or the
  arc is being replaced by a different one. Abort with the reason - a recorded
  dead end is worth more than a missing entry.
- **Neither** when work is merely paused - leave it open and checkpoint instead
  (see `autocache-checkpoint`). Open is the correct state for unfinished work.

Always pass the breadcrumb id explicitly on step, complete, and abort. With more
than one operation on disk, "the current one" is ambiguous.

## Ownership

If `active.json` names an operation you did not open, do not silently take it
over. Adopt it deliberately and say you are adopting it; if it is fresh and
another surface may still be working it, ask first.

## Worked example

```
open   : "csv importer | targets: src/import/csv.js, src/import/schema.json, tests/import.test.js"
step 1 : schema.json written - 11 columns, dates ISO-8601. Verified: node --check passes.
         Next: parser.
step 2 : csv.js streaming parser landed. Verified: tests/import.test.js 14/14 green.
         Next: error rows.
step 3 : DECISION - malformed rows go to a .rejects sidecar, not thrown.
         Reason: a 40k-row import must not die on row 3.
step 4 : BLOCKER - quoted embedded newlines break the line splitter.
         Next: switch to a state-machine reader.
step 5 : state-machine reader landed. Verified: 14/14 plus 3 new quoting cases.
complete: all three targets final and verified.
```

Not steps: the eleven reads of the sample CSV, the four failed regexes inside
step 5, "now I will look at the tests".
