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

Run each payload against each of the five hooks. Twenty-five combinations, all
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
for f in session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js stop.js; do
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
for f in session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js stop.js; do
  echo "{\"prompt\":\"one two three four five\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"x.txt\"}}" | node $f >/dev/null 2>&1
  [ $? -eq 0 ] || { echo "FAIL $f"; exit 1; }
done
echo "broken-environment matrix passed"'
```

## Lint

```sh
for f in lib/store.js session-start.js user-prompt-submit.js pre-tool-use.js post-tool-use.js stop.js; do
  node --check "$f" || exit 1
done
node -e "JSON.parse(require('fs').readFileSync('hooks.json','utf8'))"
```

## Post-run invariant

After any fixture run, no partial write may be left behind:

```sh
find "$AUTOCACHE_HOME" -name '*.tmp' -print | grep . && echo "FAIL: tmp file left behind" || echo "no tmp files: ok"
```
