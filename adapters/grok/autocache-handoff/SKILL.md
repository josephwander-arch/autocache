---
name: autocache-handoff
description: Turn a long Grok conversation or a pasted Autocache dump into an executable continuation packet the user can paste into Claude Code or Codex. Fires on "hand this off", "write a handoff", "summarize this for Claude Code", "continuation packet", "I am switching agents". Read-only - Grok drafts the packet, it never writes it to disk.
---

# Autocache handoff (Grok, read-only)

**You cannot write.** Grok cannot create a session record, close a breadcrumb, or put
a file in `~/.autocache/`. What you produce here is **text the user pastes** into a
surface that can persist it. Say that when you hand it over. Never imply the handoff
has been filed.

## A handoff is a continuation packet, not a transcript

The test: can the receiving agent act on this without reading the conversation it
came from? If not, it is a summary, not a handoff. Cut narrative, keep state.

## Structure - use exactly these five sections

```
## Done
- <verified outcomes only, each naming the file or component touched>

## Remaining
- <the next concrete action first, then the rest, in order>

## Risks
- <what will bite the next agent: a known-broken path, an unverified assumption,
   a file that was changed but not tested, an external dependency>

## Files
- <absolute paths that were touched or must be touched next, one per line>

## Verify
- <the exact command or check that proves the work is actually done>
```

## Rules for the content

- **Verified versus assumed.** Mark anything you did not see proof of. "Tests pass"
  is a claim; "tests were not run" is state. The second one is more useful.
- **Absolute paths.** A relative path in a handoff is a guess about the receiver's
  working directory.
- **Name the arc.** If a breadcrumb id or title is in the dump, put it at the top so
  the receiver adopts the existing arc instead of opening a second one.
- **One owner.** State plainly that the user is moving ownership to the receiving
  agent. Two agents stepping the same breadcrumb is how work gets done twice.
- **No invented completion.** If the conversation trailed off mid-task, the packet
  says so. A handoff that overstates progress costs the next session more time than
  no handoff at all.

## Delivery

Give the packet as one copy-paste block, then one line telling the user where it goes:

> Paste this into Claude Code or Codex in that repository. Those surfaces have the
> Autocache hooks, so the packet becomes part of the session record there. Nothing
> has been saved from this conversation.

If the user wants it on disk immediately, they can write it themselves; it is their
directory and it is plain text:

```sh
mkdir -p "${AUTOCACHE_HOME:-$HOME/.autocache}/handoffs"
$EDITOR "${AUTOCACHE_HOME:-$HOME/.autocache}/handoffs/handoff-$(date +%Y%m%d-%H%M).md"
```

Note that a hand-written file there is a convenience for the human, not a state
write - the hooks own `sessions/`, `breadcrumbs/`, and `checkpoints/`.

## Boundary

Autocache carries the work arc, not a knowledge base. Do not promise the receiving
agent will "remember this permanently", "learn from it", or "search it later" - free
Autocache does not extract, index, or retrieve. It restores what you were doing.
That is the claim, and it is enough.
