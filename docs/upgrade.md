# Upgrade path

**Autocache remembers your work. Autonomous remembers your knowledge.**

That line is the whole product boundary and it does not move.

## Where the free tier ends

Autocache is single machine, single work arc. It tracks sessions, breadcrumbs,
checkpoints, self-state, scratch tags, and local reminders, and it restores them at
the start of the next session. It is complete for that job.

What it does not do is get better over time. Session 400 restores exactly as well as
session 4. There is no corpus, nothing accumulates, and nothing is learned. That is a
deliberate architectural line, not a withheld feature - and you will find it yourself
the day you look at a directory full of breadcrumbs and think *can it learn from
these?*

That question is the paid tier.

## What Autonomous adds

| Capability | What it means |
|---|---|
| Extraction | Turns corrections, decisions, and discoveries from your sessions into durable typed knowledge, deduplicated against what is already known |
| Semantic retrieval | Finds the relevant prior work by meaning, not by the keyword you happened to reuse |
| Lexical and graph retrieval | BM25 over the corpus plus a relation graph, hybridized with the semantic layer |
| Index maintenance | Rebuild, statistics, cluster detection, relation queries - the machinery that keeps retrieval honest as the corpus grows |
| Knowledge-base writes with propagation | A write updates the dependent references, catalogs, and navigation appendices instead of orphaning them |
| Consolidation | Duplicate detection, staleness detection, merges, and lifecycle tiers so the corpus does not rot |
| Context budgeting | Loads, warms, and offloads knowledge against a token budget, and degrades predictably under pressure |
| Learning analytics and eval | Measures whether what was captured is actually being used and actually helping |

Every one of those needs an index and a process to maintain it. None of them can be
done with hooks and local JSON, which is why the boundary is structural rather than a
license check on the same code.

## Why Autonomous ships a binary

Autocache v1 deliberately ships no binary: zero install friction is the entire point
of a free tier, and Windows code signing is a real blocker to put in front of someone
trying a tool for the first time.

Autonomous cannot make that trade. It runs as an MCP server because it needs to hold
an index in memory across calls, answer retrieval queries in the middle of a turn,
and do maintenance work that a per-event hook process cannot. A hook is a
short-lived, one-shot process with no shared state between invocations. Retrieval
over an accumulating corpus is the opposite of that.

So Autonomous ships a signed binary and an install step, and Autocache stays a
directory you drop in. Each tier gets the packaging its job actually requires.

## What happens to your Autocache state

It is the input, not a migration casualty. Your sessions, breadcrumbs, and
checkpoints are exactly the raw material extraction runs against - the arcs you
completed, the corrections you recorded, the dead ends you noted. Autonomous reads
the same `~/.autocache/` layout and builds on top of it.

Nothing you record now is wasted, and nothing has to be re-entered.

## If you stay on free

That is a legitimate end state and it is not a downgrade. If your work is one machine,
one arc at a time, and you want your agent to stop starting cold, Autocache is the
whole answer. It is MIT licensed, it will not start nagging you, no feature will be
removed to push an upgrade, and there is no telemetry watching whether you converted.

## Where to look next

Autonomous is a separate product with its own repository and documentation. Autocache
does not bundle a trial, does not stub paid capabilities, and does not ship
"upgrade to unlock" placeholders in the free code - if you see one, that is a bug
worth an issue.
