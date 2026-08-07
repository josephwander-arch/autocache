---
name: autocache-handoff
description: Write a continuation packet another agent or session can execute without this conversation, and transfer ownership of an open breadcrumb through the fork chain. Fires on /handoff; on "hand this off", "pass this to", "send to Codex", "another agent should", "someone else can finish", "write this up for", "I'm switching machines", "take this over", "take it back", "is anyone working on this"; when transferring ownership of an open breadcrumb; when a breadcrumb write is rejected as frozen; and when an arc must end with work still open.
---

# Autocache: Handoff

A handoff is **not** a transcript, a summary, or a status report. It is a set of
instructions the receiver can execute cold, with no access to this conversation.

Test before writing it: could someone who has never seen this session do the next
action correctly using only this packet plus the repo? If not, it is not done.

## Required sections

Write all five. A missing section is the one the receiver needed.

1. **Done** - what actually landed, each item with its verification. If it was
   not verified, it belongs under Remaining, not Done.
2. **Remaining** - concrete units of work, ordered, each independently startable.
   Not "finish the importer" - name the file and the behavior.
3. **Risks** - what will bite them. Fragile assumptions, things that look done but
   are not, approaches already tried and rejected with the reason, environment
   traps (paths, versions, credentials, a service that must be running).
4. **Exact next action** - one command or one edit, literal enough to run.
   Not a topic. Not a choice between three options.
5. **Files in play** - absolute paths with state per file: edited/saved,
   edited/untested, staged, generated, do-not-touch.

## Rules

- **State beats narrative.** Delete every sentence describing what you were
  thinking. Keep every sentence describing what is true on disk.
- **Carry decisions with their reasons.** A decision without its reason gets
  reversed by the receiver, and the reversal costs more than the original work.
- **Record dead ends.** "Tried X, it fails because Y" prevents a repeat.
- **Name the owner.** Say which agent/surface/session held it and that you are
  releasing it. The receiver should not have to guess whether it is safe to write.
- **Leave the breadcrumb open.** A handoff transfers an open operation; do not
  complete it on the way out. Complete belongs to whoever finishes the work.
  The receiver takes ownership by forking it on arrival - say so in the packet.
- **No emoji, no decoration.** Plain text, absolute paths.
- **Verify the write.** Read the packet back before claiming it was handed off.

## Ownership moves through the fork chain

The packet transfers knowledge. Ownership transfers by **forking** the open
breadcrumb: `/breadcrumb fork <id>` writes a new record carrying the remaining
steps and unresolved decisions, then freezes the source (`forked_to`,
`forked_by`, `forked_at`). The rules:

- **Exactly one live head per chain.** The head is the only record that accepts
  writes. A frozen record rejects every step, add, decide, resolve, complete, and
  abort, and the rejection names the head - so a returning session catches up
  instead of corrupting a dead branch.
- **Take-back is a fork of the head**, never a re-opening of a frozen ancestor.
  The chain only grows forward, and every hop is attributed.
- **Completing the head completes the chain.** Every still-open ancestor is
  marked `completed_via` the head, so each earlier session resumes into
  "finished elsewhere, here is the pointer" rather than a dangling operation.
- **Aborting the head strands the chain deliberately.** Ancestors stay frozen
  pointing forward; the tail surfaces as adoptable work. An incomplete chain is
  never silently pruned - it keeps surfacing until it is completed through the
  chain or explicitly retired with a recorded reason (`/breadcrumb retire`).

## Takeover eligibility ladder

Fork a head you do not hold only when one of these is true:

1. **The holder is demonstrably inactive** past the threshold: 90 seconds of no
   recorded activity on the same machine; 2 minutes across synced machines; and
   if a file sync is detectably in progress, 3 minutes after it settles.
2. **The holder explicitly passed** the work.
3. **The user directed** the takeover.

If activity **cannot be determined**: tell the user which session holds it, as
specifically as the record allows (surface, session id, machine, last activity),
and that forking a live session could corrupt the operation. Wait 3 minutes,
re-check, and proceed only on the user's positive affirmation given after that
risk statement - not on silence, and not on an affirmation given before the risk
was stated.

If the holder is **demonstrably active**: do not fork. Work read-only, or ask
for a pass.

**Before any cross-machine fork**, compare the record file's mtime against its
recorded last activity (`updated_at`, last step `at`). An mtime newer than the
recorded activity means bytes arrived that the record does not explain - treat a
sync as in progress and wait it out.

## Worked example

```
HANDOFF - csv importer
from: claude_code (this machine) | breadcrumb bc_csvimport_0731 (OPEN, released)

DONE
- src/import/schema.json - 11 columns, ISO-8601 dates. Verified: node --check.
- src/import/csv.js - streaming state-machine reader, handles quoted newlines.
  Verified: tests/import.test.js 17/17.

REMAINING
1. Wire the .rejects sidecar writer in src/import/csv.js (writeRejects is
   declared and called but not implemented - it currently returns undefined).
2. Add a test for a 40k-row file with 3 malformed rows: import must succeed and
   emit exactly 3 rejects.
3. Hook the importer into src/cli/import-cmd.js (nothing calls it yet).

RISKS
- Malformed rows must NOT throw. A 40k-row import dying on row 3 is the bug this
  design exists to avoid.
- Do not switch to a line-split parser. It was tried and it breaks on quoted
  embedded newlines, which appear in the real address column.
- tests/fixtures/large.csv is gitignored; regenerate with
  node scripts/gen-fixture.js 40000 if it is missing.

EXACT NEXT ACTION
Implement writeRejects(rows, srcPath) in C:/proj/src/import/csv.js (stub at
line 148): write <srcPath>.rejects as one JSON object per line, then run
npm test -- import.

FILES IN PLAY
C:/proj/src/import/csv.js        edited, saved, tests green except writeRejects
C:/proj/src/import/schema.json   final, do not touch
C:/proj/tests/import.test.js     edited, saved, 17/17
C:/proj/src/cli/import-cmd.js    untouched, needs the wiring in item 3
```
