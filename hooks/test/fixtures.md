# Hook test fixtures

How to exercise every Autocache hook by hand, and the exact cases CI must assert
exit code 0 on.

Every hook is a plain Node script that reads a JSON object on stdin. There is
nothing to install and nothing to mock: pipe a payload in, read stdout, stderr,
and the exit code.

## Ground rules these fixtures verify

1. **Every hook fails open.** Malformed stdin, missing state, corrupt state, or
   an unreachable home directory must all exit 0. A continuity tool that breaks
   the session it protects is worse than no tool.
2. **Nothing to restore means nothing printed.** `session-start.js` on a cold
   state directory emits zero bytes. An empty banner is noise.
3. **`pre-tool-use.js` is advisory only.** It writes to stderr, never stdout,
   never emits a permission decision, and always exits 0.
4. **State writes are atomic.** After any run, no `*.tmp` file may remain under
   the state root.

## Isolating state

Always point `AUTOCACHE_HOME` at a scratch directory. Without it the fixtures
write to the real `~/.autocache`.

```sh
# POSIX
export AUTOCACHE_HOME="$PWD/.test-home"
rm -rf "$AUTOCACHE_HOME"
```

```powershell
# Windows PowerShell
$env:AUTOCACHE_HOME = "$PWD\.test-home"
Remove-Item -Recurse -Force $env:AUTOCACHE_HOME -ErrorAction SilentlyContinue
```

Run every command below from the `hooks/` directory.

## Seed state

Write these files under `$AUTOCACHE_HOME` before the "restore" fixtures. The
hooks create missing directories on demand, so only the files you want read need
to exist.

`sessions/index.json`

```json
{ "sessions": [{ "id": "sess_20260730_a1" }] }
```

`sessions/sess_20260730_a1.json`

```json
{
  "id": "sess_20260730_a1",
  "started_at": "2026-07-30T14:00:00Z",
  "ended_at": "2026-07-30T17:40:00Z",
  "title": "hook layer",
  "summary": "Wired the PostToolUse counter into the breadcrumb record.",
  "next_steps": ["write the stop-hook checkpoint", "test malformed stdin"],
  "findings": [
    { "text": "Windows rename fails when the destination exists, so rotation must remove the old file first", "at": "2026-07-30T15:00:00Z" },
    { "text": "python3 is not on PATH under most Windows Python installs", "at": "2026-07-30T16:00:00Z" }
  ]
}
```

`breadcrumbs/active.json`

```json
{
  "id": "bc_001",
  "name": "autocache hooks | targets: hooks/*.js",
  "created_at": "2026-07-31T09:00:00Z",
  "status": "open",
  "steps": [
    { "text": "store.js", "done": true },
    { "text": "session-start" },
    { "text": "stop hook" }
  ],
  "tool_calls": 0
}
```

`reminders.json`

```json
{
  "reminders": [
    { "id": "r1", "text": "tag the v0.1.0 release", "due_at": "2026-07-30T08:00:00Z" },
    { "id": "r2", "text": "not due yet", "due_at": "2099-01-01T00:00:00Z" },
    { "id": "r3", "text": "already handled", "due_at": "2020-01-01T00:00:00Z", "completed": true }
  ]
}
```

`state/self_state.json`

```json
{ "notes": "prefers terse advisory output" }
```

`state/bag.json`

```json
{ "repo": "autocache", "branch": "main" }
```

`active.json` may also hold a bare pointer (`{"id":"bc_001"}`) with the full
record in `breadcrumbs/bc_001.json`. Both shapes are supported; run the
breadcrumb fixtures once each way.

## session-start.js

Cold state, nothing seeded. Expect **no output at all**, exit 0.

```sh
echo '{"session_id":"s1","source":"startup","cwd":"C:/proj"}' | node session-start.js
```

Seeded state. Expect a single JSON object on stdout whose
`hookSpecificOutput.additionalContext` names the last session, the open
breadcrumb with done/remaining steps, the last auto-checkpoint, due reminders
(r1 only - r2 is not due, r3 is completed), self-state, and bag tags.

```sh
echo '{"session_id":"s3","source":"resume","cwd":"C:/CPC/autocache"}' | node session-start.js
```

Pretty-print just the restored text:

```sh
echo '{"session_id":"s3","source":"resume"}' | node session-start.js \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d?JSON.parse(d).hookSpecificOutput.additionalContext:'(nothing to restore)'))"
```

Assertions: stdout is either empty or valid JSON; when non-empty,
`hookSpecificOutput.hookEventName === "SessionStart"`. The hook also resets the
arc counters for the new session, so run it before the PreToolUse fixtures if
you want a clean counter.

## user-prompt-submit.js

Under 4 words - skipped entirely, no output, exit 0.

```sh
echo '{"session_id":"s3","prompt":"keep going"}' | node user-prompt-submit.js
```

Matching prompt - expect at most 2 findings, each with session id and date.

```sh
echo '{"session_id":"s3","prompt":"why does the windows rename fail during rotation"}' | node user-prompt-submit.js
```

Non-matching prompt of 4+ words - expect no output.

```sh
echo '{"session_id":"s3","prompt":"what is the weather in Lisbon today"}' | node user-prompt-submit.js
```

Assertions: never more than 2 findings in the emitted context;
`hookSpecificOutput.hookEventName === "UserPromptSubmit"`; a match requires at
least 2 shared tokens, so single-word coincidences stay silent.

## pre-tool-use.js

Short arc with a breadcrumb open - expect silence.

```sh
echo '{"session_id":"s1","tool_name":"Read","tool_input":{"file_path":"SPEC.md"}}' | node pre-tool-use.js
```

Long arc with no breadcrumb - remove `breadcrumbs/active.json`, drive the
counter past the threshold (default 8, `breadcrumb_nudge_after` in
`config.json`), then call it. Expect one stderr line suggesting `/breadcrumb`.

```sh
rm -f "$AUTOCACHE_HOME/breadcrumbs/active.json"
for i in $(seq 1 9); do echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | node post-tool-use.js; done
echo '{"session_id":"s1","tool_name":"Write","tool_input":{"file_path":"SPEC.md"}}' | node pre-tool-use.js
```

Repeating the same call immediately must stay silent - the nudge has a cooldown
(`breadcrumb_nudge_cooldown`, default 25 calls).

Uncheckpointed write - the second stderr line above. It fires only for a path
that **already exists** and appears in no recent checkpoint. Writing a brand-new
file is silent:

```sh
echo '{"session_id":"s1","tool_name":"Write","tool_input":{"file_path":"does-not-exist.txt"}}' | node pre-tool-use.js
```

Assertions: **stdout is always empty**; exit is always 0; the output contains no
`permissionDecision`, `deny`, or `block` field. This hook is advisory by
contract, and CI should fail if it ever writes to stdout.

## post-tool-use.js

```sh
echo '{"session_id":"s2","cwd":"C:/CPC/autocache","tool_name":"Edit","tool_input":{"file_path":"C:/CPC/autocache/hooks/stop.js"}}' | node post-tool-use.js
```

Run it 15+ times against the seeded breadcrumb and expect exactly one stderr
nudge to log a step (`step_nudge_after`, default 15; it does not repeat until
another 15 calls pass). Then assert:

- `breadcrumbs/bc_001.json` (or `active.json`) has `tool_calls` equal to the
  number of runs.
- `touched_files` contains `stop.js`, de-duplicated, newest first, capped at
  `max_touched_files` (default 50).
- `state/arc.json` counts every call, including non-write tools.

Non-write tools (`Bash`, `Read`, `Grep`) increment counters but record no paths.

## Native worker and team lifecycle

The executable cross-platform regression covers SubagentStart, child
PostToolUse isolation, SubagentStop, SessionStart reconciliation, a parent fork
while a worker is running, Claude team task/idle receipts, twelve simultaneous
worker streams, and the no-`*.tmp` invariant:

```sh
node .github/scripts/worker-lifecycle.cjs
```

It must report every assertion passed. In particular, neither a single child
tool call nor the twelve parallel calls may change the lead breadcrumb's
`tool_calls`; the lead's own PostToolUse must still increment it; and a pending
stop receipt must disappear only after an exact `[worker:<receipt-id>]` marker
is logged on the chain.

## stop.js

```sh
echo '{"session_id":"s2","cwd":"C:/CPC/autocache","transcript_path":"/tmp/t.jsonl","stop_hook_active":false}' | node stop.js
```

Assertions:

- a new `checkpoints/cp_*.json` exists, and it parses;
- it carries `session_id`, `cwd`, `tool_calls`, `touched_files`, and a
  `breadcrumb` block with `completed` and `remaining` when one is open;
- `state/arc.json.last_checkpoint` names that file;
- **stdout is empty** - a Stop hook must never interfere with turn completion;
- running it again with `"stop_hook_active": true` still exits 0 and does not
  recurse.

Pruning: after more than `max_auto_checkpoints` (default 50) auto-checkpoints,
the oldest ones this hook created are deleted. Checkpoints it did not create are
never touched.

## Fork chain (lib/store.js)

The fork-chain operations live in `lib/store.js` and are exercised directly with
`node -e`. Run everything below from the `hooks/` directory with `AUTOCACHE_HOME`
pointing at a scratch directory. Each snippet prints `PASS` lines; any `FAIL` is a
regression.

Seed one live head with planned steps and a blocking decision:

```sh
node -e '
const s = require("./lib/store.js");
s.writeJSON("breadcrumbs/bc_chain_a.json", {
  version: 1, id: "bc_chain_a", name: "importer | targets: src/import.js",
  status: "open", created_at: "2026-08-01T09:00:00.000Z",
  planned_steps: ["write schema", "wire parser", "reject sidecar", "cli hook"],
  steps: [{ at: "2026-08-01T09:20:00.000Z", text: "write schema", source: "command" }],
  decisions: [{ id: "dec-1-aa", question: "throw or sidecar?",
    options: ["throw", "sidecar"], lean: "sidecar",
    waits_on: "any_informed_session", blocks: [2], status: "open", chosen: null }]
});
s.writeJSON("breadcrumbs/active.json", { version: 1, breadcrumb_id: "bc_chain_a", updated_at: "2026-08-01T09:20:00.000Z" });
console.log("seeded");
'
```

**1. Fork carries the remaining steps and reindexes decision blocks.**
`write schema` is logged, so the fork must carry exactly the three unfinished
planned steps, and the decision blocking old index 2 (`reject sidecar`) must block
new index 1.

```sh
node -e '
const s = require("./lib/store.js");
const r = s.forkBreadcrumb("bc_chain_a", { by: "codex ses_test", surface: "codex" });
if (!r.ok) { console.log("FAIL fork: " + r.error); process.exit(1); }
const f = s.readBreadcrumb(r.id);
console.log(JSON.stringify(f.planned_steps) === JSON.stringify(["wire parser","reject sidecar","cli hook"]) ? "PASS carried steps" : "FAIL carried steps: " + JSON.stringify(f.planned_steps));
console.log(JSON.stringify(f.decisions[0].blocks) === "[1]" ? "PASS blocks reindexed" : "FAIL blocks: " + JSON.stringify(f.decisions[0].blocks));
console.log(f.forked_from === "bc_chain_a" ? "PASS forked_from" : "FAIL forked_from");
const src = s.readBreadcrumb("bc_chain_a");
console.log(src.forked_to === r.id && src.forked_by === "codex ses_test" && src.forked_at ? "PASS source frozen with attribution" : "FAIL source freeze");
console.log(src.forked_to !== src.id ? "PASS never forked to itself" : "FAIL self-fork");
'
```

**2. A frozen record rejects writes, naming the head.** `saveBreadcrumb` on the
frozen source must return false and leave the file untouched; `frozenNotice` must
name the live head. The `/breadcrumb` command applies the same refusal to step,
add, decide, resolve, complete, abort, and adopt.

```sh
node -e '
const s = require("./lib/store.js");
const src = s.readBreadcrumb("bc_chain_a");
src.tool_calls = 999;
console.log(s.saveBreadcrumb(src) === false ? "PASS frozen write refused" : "FAIL frozen write accepted");
console.log(s.readBreadcrumb("bc_chain_a").tool_calls === undefined ? "PASS file untouched" : "FAIL file mutated");
const n = s.frozenNotice(s.readBreadcrumb("bc_chain_a"));
console.log(n.indexOf(src.forked_to) !== -1 && n.indexOf("Chain head") !== -1 ? "PASS notice names the head" : "FAIL notice: " + n);
'
```

Also feed the frozen state through the hook: `post-tool-use.js` must emit one
stderr line naming the head, exit 0, and leave the frozen record byte-identical.
Point `active.json` at `bc_chain_a` first (fork moved it to the new head):

```sh
node -e 'require("./lib/store.js").writeJSON("breadcrumbs/active.json", { version: 1, breadcrumb_id: "bc_chain_a", updated_at: "2026-08-01T12:00:00.000Z" })'
echo '{"session_id":"s9","tool_name":"Edit","tool_input":{"file_path":"src/import.js"}}' | node post-tool-use.js
# stderr: "[autocache] breadcrumb bc_chain_a is frozen: forked to ... Chain head: ..."
# repeat the call: silent (frozen_warned_id in state/arc.json holds the id)
```

**3. Take-back grows the chain.** Fork the head; the chain becomes three records,
each hop attributed, and `chainHead` from the original tail resolves to the newest
record.

```sh
node -e '
const s = require("./lib/store.js");
const head1 = s.readBreadcrumb("bc_chain_a").forked_to;
const r = s.forkBreadcrumb(head1, { by: "claude-code ses_back", surface: "claude-code" });
if (!r.ok) { console.log("FAIL take-back: " + r.error); process.exit(1); }
console.log(s.readBreadcrumb(head1).forked_to === r.id ? "PASS chain grew" : "FAIL chain");
console.log(s.chainHead("bc_chain_a").id === r.id ? "PASS head resolves from tail" : "FAIL head walk");
const hop = s.readBreadcrumb(head1);
console.log(hop.forked_by === "claude-code ses_back" ? "PASS hop attributed" : "FAIL attribution");
const again = s.forkBreadcrumb("bc_chain_a", {});
console.log(!again.ok && again.error.indexOf(r.id) !== -1 ? "PASS frozen ancestor cannot be forked; error names the head" : "FAIL: " + JSON.stringify(again));
'
```

**4. A blocked step is rejected until its decision resolves.** The store exposes
the blocked indexes; the `/breadcrumb step` command refuses a step whose text
matches a blocked planned step and prints the decision. Resolving with a recorded
basis unblocks it.

```sh
node -e '
const s = require("./lib/store.js");
const head = s.chainHead("bc_chain_a").record;
console.log(Array.from(s.blockedStepIndexes(head)).join(",") === "1" ? "PASS blocked index" : "FAIL blocked");
const d = head.decisions[0];
d.chosen = "sidecar"; d.decided_by = "claude-code"; d.basis = "recorded lean plus the 40k-row requirement"; d.decided_at = new Date().toISOString(); d.status = "resolved";
s.saveBreadcrumb(head);
console.log(s.blockedStepIndexes(s.chainHead("bc_chain_a").record).size === 0 ? "PASS resolution unblocks" : "FAIL still blocked");
'
```

**5. Completing the final head closes every ancestor.** Both frozen ancestors must
end `complete` with `completed_via` naming the head, so an earlier session resumes
into a pointer, not a dangling operation.

```sh
node -e '
const s = require("./lib/store.js");
const head = s.chainHead("bc_chain_a").record;
head.status = "complete"; head.completed_at = new Date().toISOString();
s.saveBreadcrumb(head);
const closed = s.propagateCompletion(head.id);
console.log(closed.length === 2 ? "PASS closed both ancestors" : "FAIL closed: " + JSON.stringify(closed));
const a = s.readBreadcrumb("bc_chain_a");
console.log(a.status === "complete" && a.completed_via === head.id ? "PASS completed_via set" : "FAIL: " + a.status + "/" + a.completed_via);
'
```

**6. Same-moment fork ids stay unique.** Two forks inside the same timestamp
second must yield three distinct ids, and no record may point at itself. (The id
scheme regenerates on collision and appends a discriminator suffix, so this holds
even when the random component repeats.)

```sh
node -e '
const s = require("./lib/store.js");
s.writeJSON("breadcrumbs/bc_fast.json", { version: 1, id: "bc_fast", name: "x | targets: y", status: "open", planned_steps: ["one", "two"], steps: [] });
const r1 = s.forkBreadcrumb("bc_fast", {});
const r2 = s.forkBreadcrumb(r1.id, {});
const ids = ["bc_fast", r1.id, r2.id];
console.log(new Set(ids).size === 3 ? "PASS ids unique: " + ids.join(" -> ") : "FAIL collision: " + ids.join(","));
console.log(ids.every(i => { const b = s.readBreadcrumb(i); return !b.forked_to || b.forked_to !== b.id; }) ? "PASS no record forked to itself" : "FAIL self-pointer");
'
```

Assertions across all six: every operation returns `{ ok: false, error }` or a
fallback instead of throwing; after any run, no `*.tmp` file remains under the
state root; an aborted (not completed) head leaves its ancestors frozen and open -
they keep surfacing at `SessionStart` until the chain is completed or retired via
`retireChain` / `/breadcrumb retire`, which records the reason on every record it
closes.

## Event log rotation

`logs/events.jsonl` rotates to `logs/events.1.jsonl` at 5 MB. The rotation must
survive an existing `events.1.jsonl`, which is the Windows trap - `rename` over
an existing destination fails there, so the old file is removed first.

```sh
node -e "const fs=require('fs'),p=process.env.AUTOCACHE_HOME+'/logs/';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'events.jsonl','x'.repeat(5*1024*1024+10));fs.writeFileSync(p+'events.1.jsonl','stale');"
echo '{"tool_name":"Edit","tool_input":{"file_path":"a.txt"}}' | node post-tool-use.js
ls -l "$AUTOCACHE_HOME/logs"   # events.jsonl small and fresh, events.1.jsonl ~5 MB
```

## Config gates

`config.json` in the state root switches the hooks off without uninstalling:

- `{"enabled": false}` - every hook becomes a no-op, including state writes.
- `{"quiet": true}` - state is still recorded, but nothing is printed to stdout
  or stderr.

```sh
echo '{"enabled":false}' > "$AUTOCACHE_HOME/config.json"
echo '{"session_id":"s","source":"resume"}' | node session-start.js   # no output
```

Delete `config.json` again before running the restore fixtures.

## Malformed-input matrix (CI asserts exit 0 on every cell)

Run each payload against every hook script. All combinations must
must exit 0, and none may write anything to stdout that is not valid JSON.

| Case | stdin |
|---|---|
| garbage | `not json at all {{{` |
| empty | (zero bytes) |
| no stdin at all | close the pipe without writing |
| JSON array | `[1,2,3]` |
| JSON scalar | `"hello"` |
| null | `null` |
| wrong field types | `{"tool_name":null,"tool_input":"nope","prompt":42}` |
| unknown event | `{"hook_event_name":"NotAnEvent"}` |
| huge prompt | a 1 MB string in `prompt` |

```sh
for f in session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js subagent-start.js subagent-stop.js native-team-event.js stop.js; do
  for payload in 'not json at all {{{' '' '[1,2,3]' '"hello"' 'null' '{"tool_name":null,"tool_input":"nope","prompt":42}'; do
    printf '%s' "$payload" | node "$f" >/dev/null 2>&1
    [ $? -eq 0 ] || { echo "FAIL $f <- $payload"; exit 1; }
  done
done
echo "fail-open matrix passed"
```

## Broken-environment matrix (CI asserts exit 0)

| Case | Setup |
|---|---|
| missing state root | `AUTOCACHE_HOME` points at a path that does not exist |
| unreadable / unwritable root | `AUTOCACHE_HOME=Z:/nope/does/not/exist` (Windows) or a `chmod 000` directory (POSIX) |
| truncated JSON | write `{"id":"bc","steps":[` to `breadcrumbs/active.json` |
| garbage JSON | write `garbage` to `state/arc.json` |
| wrong-shaped JSON | write `nope` to `reminders.json`, `{"sessions":` to `sessions/index.json` |
| leftover tmp file | create `state/arc.json.tmp` before the run |

```sh
AUTOCACHE_HOME="Z:/nope/does/not/exist" sh -c '
for f in session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js subagent-start.js subagent-stop.js native-team-event.js stop.js; do
  echo "{\"prompt\":\"one two three four five\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"x.txt\"}}" | node $f >/dev/null 2>&1
  [ $? -eq 0 ] || { echo "FAIL $f"; exit 1; }
done
echo "broken-environment matrix passed"'
```

## Lint

```sh
for f in lib/store.js session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js subagent-start.js subagent-stop.js native-team-event.js stop.js; do
  node --check "$f" || exit 1
done
node -e "JSON.parse(require('fs').readFileSync('hooks.json','utf8'))"
```

## Post-run invariant

After any fixture run, no partial write may be left behind:

```sh
find "$AUTOCACHE_HOME" -name '*.tmp' -print | grep . && echo "FAIL: tmp file left behind" || echo "no tmp files: ok"
```
