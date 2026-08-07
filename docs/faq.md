# FAQ

### Is this Anthropic's prompt caching?

No, and the distinction matters. Anthropic's prompt cache is a five-minute-TTL prefix
match applied to API requests to cut token cost. It is invisible to you, it expires
in minutes, and nothing survives a session boundary. Autocache never touches it and
cannot extend it.

The name refers to caching *your work context* - what you were doing, what you had
decided, what was still open - on your own disk, so the next session can restore it.
Different layer, different lifetime, unrelated mechanism.

### Does it make the model smarter?

No. It restores context. That is the whole claim, and for the problem it solves it is
enough. A model that starts a session already knowing it was mid-refactor with two
files backed up and one dead end ruled out is not smarter; it is just not starting
from zero.

### Does it read my code?

No. Hooks see the metadata the harness hands them - which tool ran, which target,
when - plus whatever you explicitly record as a finding or a step. There is no
repository scan, no file content ingestion, and no transcript parsing. `transcript_path`
arrives in the hook payload and is deliberately not read.

### Does it phone home?

No. There are no network calls in any hook. Telemetry is off by default in
`config.json`, and there is no endpoint for it to reach even if you turned the flag
on. If a future release ever adds one it will be opt-in, documented, and announced in
the changelog before it ships.

### Where is my data and how do I delete it?

`~/.autocache/`, or `%USERPROFILE%\.autocache\` on Windows, or whatever
`AUTOCACHE_HOME` points at. Plain JSON. Delete the directory and Autocache is back to
a fresh install; nothing else on your system changes.

### Will a hook ever break my session?

That is the failure mode the whole design is aimed at. Every hook body is wrapped in
try/catch and always exits 0. Malformed input, empty input, missing state, corrupt
JSON, an unwritable state root - every one of those exits 0 and does nothing. CI has
a dedicated `fail-open` job that pipes each of those cases into every hook and every
adapter and asserts the exit code. If that job fails, the build fails, regardless of
what else passed.

`PreToolUse` is advisory only. It never returns a deny decision and never modifies a
tool call.

### Why Node and not Python?

Because `python3` does not reliably resolve on Windows. Many Windows Python installs
do not put `python3` on PATH, so the hook fails silently and the user concludes the
tool does not work. Node is present wherever these agents run. Zero npm dependencies
means there is nothing to install and nothing to break on a version bump.

### Does it sync across machines?

Not in v1. State is local. You can point `AUTOCACHE_HOME` at a directory you sync
yourself, but nothing about concurrent writes from two machines is designed for or
tested, so treat that as unsupported.

What the fork chain adds for a self-synced directory is ownership discipline, not
sync: an operation has exactly one live head, a forked-away record rejects writes
naming the head, and the takeover ladder in the `autocache-handoff` skill treats a
detectable in-progress sync as a reason to wait. That makes a collision detectable
and attributable; it does not make concurrent writes safe.

### Can two sessions run at once?

Yes, on one machine. Each session gets its own file. The one shared piece of state is
the active breadcrumb: one open arc per state root. If two sessions both want a
tracked arc, give the second one its own `AUTOCACHE_HOME`.

### Can I use it with Claude Code, Codex, and Grok at the same time?

Claude Code and Codex share the state directory verbatim - that is the design. A
session started under one is resumable under the other. Grok reads the same
directory but does not write to it.

### Why can Grok only read?

Grok is a skill and prompt surface, not a hook surface. There are no hook events to
fire on and no sanctioned local write path. Rather than ship something that appears
to record and silently does not, Grok is documented as read-only: it narrates the
state that the other surfaces wrote.

### How big does the state directory get?

Small. Session and breadcrumb records are text metadata measured in kilobytes. The
event log is capped at 5 MB and rotates, keeping exactly one previous file, so the
practical ceiling is about 10 MB of logs plus your records. There is no growth
mechanism that runs while you are not using it.

### Nothing showed up at session start. What is wrong?

In order of likelihood:

1. The plugin is not actually enabled on the surface. Check `/plugin` first.
2. `AUTOCACHE_HOME` points at a path that cannot be created or written. Hooks fail
   open, so this looks exactly like the tool doing nothing.
3. The previous session recorded nothing worth restoring - no findings, no breadcrumb,
   no checkpoint. `SessionStart` stays silent rather than emitting an empty block.
4. A hook is disabled via the `hooks` flags in `config.json`.

Run the hook by hand with the recipe in [hooks.md](hooks.md#debugging-a-hook) and
inspect stdout and the state directory. The exit code tells you nothing - it is
always 0.

### There are `.tmp` files in the state directory.

A write was interrupted. Every write goes to `<file>.tmp` and is then renamed into
place, so an orphaned `.tmp` means the process died mid-write and the real file is
intact. Delete them.

### Can I edit the state files by hand?

Yes. It is plain JSON and hand-edits are a legitimate way to fix a bad title or drop
a stale reminder. Keep it valid - an unparseable file is treated as absent, so a
syntax error looks like data loss. Do it while no session is running.

### Can I commit `~/.autocache/` to a repository?

Nothing stops you, and per-project state via `AUTOCACHE_HOME` makes it plausible. Read
the files first. They contain your working directory paths, session titles, and any
findings you recorded, and that is your judgment call, not ours.

### What is not in the free tier?

Extraction, semantic and lexical and graph retrieval, index maintenance,
knowledge-base writes with propagation, consolidation and staleness detection,
context budgeting, learning analytics, and eval. None of it is stubbed, and none of
it is coming to the free tier. It is Autonomous: see [upgrade.md](upgrade.md).

### Is the free tier crippled to sell the paid one?

No. Free is complete for its job - single machine, single work arc, never forgets what
it was doing. The paid tier is not a bigger version of that; it is a different
capability that needs an index and a server. The honest way to put the line is:
Autocache remembers your work, Autonomous remembers your knowledge.

### How do I report a bug or a security issue?

Bugs: open an issue with the templates in `.github/ISSUE_TEMPLATE/`. Security:
[SECURITY.md](../SECURITY.md) - do not open a public issue for it.
