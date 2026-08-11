# Hook reference

Eight hook scripts across ten lifecycle events. All Node, all zero-dependency,
all fail open.

Registered in `hooks/hooks.json` and invoked by the harness as:

```
node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.js"
```

`${CLAUDE_PLUGIN_ROOT}` is substituted by the harness. It is always quoted, because
plugin paths contain spaces on Windows.

## The contract every hook honors

**Input** arrives as a single JSON object on stdin. Common fields across events:

| Field | Meaning |
|---|---|
| `session_id` | Harness session identifier |
| `transcript_path` | Path to the transcript file. Autocache does not read it |
| `cwd` | Working directory |
| `hook_event_name` | The event that fired |
| `agent_id` | Stable native worker id when the event fires inside a subagent |
| `agent_type` | Native worker profile/type when supplied by the harness |

Event-specific fields are listed per hook below.

**Output** is either nothing, or a single JSON object on stdout. To inject context:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "..."
  }
}
```

**Exit code is always 0.** Every hook body is wrapped in try/catch and ends in
`process.exit(0)`. Malformed stdin, empty stdin, a missing state directory, an
unwritable `AUTOCACHE_HOME`, a corrupt JSON file - all of them exit 0 and do nothing.
No hook ever blocks, denies, or halts a tool call. This is enforced by a CI job
(`fail-open`) that pipes each failure case into every hook and asserts the exit code.

**Timeouts** are set per hook in `hooks.json`. A hook that hits its timeout is killed
by the harness and the session continues.

**Disabling one hook** without uninstalling: set the matching flag under `hooks` in
`~/.autocache/config.json` to `false`. The hook still runs, reads the flag, and exits
immediately.

---

## SessionStart - `hooks/session-start.js`

**Fires:** when a session starts or resumes.

**Input:** common fields, plus `source` (for example `startup`, `resume`, `clear`).

**Reads:**

- `sessions/index.json` and the newest session file, for its summary and last findings
- `breadcrumbs/active.json` and the referenced breadcrumb, for an open arc
- `checkpoints/` for the newest checkpoint
- `reminders.json` for anything due
- `state/self_state.json` for focus and open questions
- `workers/` for the newest unreconciled stop receipt per native worker

**Writes:** `state/arc.json` (the running work-arc record - see
[state-format.md](state-format.md)), and appends a `session_start` event to
`logs/events.jsonl`.

It does **not** create a session file. Session files under `sessions/` are written only by
`/handoff`, because a session record is a deliberate act of summarising an arc, not a
side effect of opening a terminal. An earlier version of this document claimed SessionStart
opened one; it never did.

**Output:** `hookSpecificOutput.additionalContext` containing a compact restore
block - last session summary, the open breadcrumb and its last step, due reminders,
pending worker results, and self-state focus. Nothing to restore means no output at all rather than a block
that says "nothing to restore".

Fork-chain state is part of the restore block: a breadcrumb that was forked away is
reported as FROZEN with the chain head named; open decisions are listed with what
they wait on; and when the active pointer names a record another session finished
or aborted through the chain, that pointer is surfaced ("completed via ...", or an
adoptable aborted tail) instead of a dangling operation.

The restore block is bounded. It summarizes; it never pastes a transcript.

---

## UserPromptSubmit - `hooks/user-prompt-submit.js`

**Fires:** when you submit a prompt, before the model sees it.

**Input:** common fields, plus `prompt`.

**Reads:** recorded findings from recent sessions, matched against the prompt.

**Writes:** nothing beyond an optional `logs/events.jsonl` line.

**Output:** at most one prior finding, as `additionalContext`, when the prompt
clearly echoes past work. The match is a local keyword overlap against text you
recorded yourself. It is not retrieval, not semantic search, and not an index -
those are Autonomous and cannot be done with hooks and JSON.

Silence is the default. A hook that surfaces something on every prompt is noise, and
noise gets uninstalled.

---

## PreToolUse - `hooks/pre-tool-use.js`

**Fires:** before a tool call executes.

**Input:** common fields, plus `tool_name` and `tool_input`.

**Reads:** `breadcrumbs/active.json`, the active breadcrumb's `calls_since_step`,
and `config.breadcrumb.nudge_after_tool_calls`.

**Writes:** counters on the active breadcrumb only.

**Output:** advisory context, or nothing. Two cases:

1. A multi-step arc is under way with no breadcrumb open - suggest opening one.
2. A write or overwrite targets an existing file with no recorded backup - say so
   before it happens.

**This hook never blocks.** It does not return a deny decision, does not set
`permissionDecision`, and does not modify `tool_input`. It is advisory only. The
enforcement layer is the harness's own permission system, not Autocache.

---

## PostToolUse - `hooks/post-tool-use.js`

**Fires:** after a tool call completes.

**Input:** common fields, plus `tool_name`, `tool_input`, and `tool_response`.

**Reads:** `breadcrumbs/active.json` and the active breadcrumb.

**Writes:** for main-thread calls, increments `tool_calls` on `state/arc.json` and
the active breadcrumb, and records write-target paths on those records. It never
stores tool output and never invents a completed milestone.

**Output:** none in the normal case. This hook is silent by design; it is
bookkeeping.

A breadcrumb that has been forked away (`forked_to` set) is frozen: this hook
never appends to it and never counts against it. It writes one stderr line naming
the chain head - once per record, tracked in `state/arc.json` - so the returning
session catches up instead of writing into a dead branch. The shared state layer
refuses the write regardless, so even a bug here could not mutate a frozen record.

Tool responses are not stored. Only metadata - which tool, which target, when.

When the harness supplies a stable `agent_id`, the call is a native child event.
It is written only to `workers/<parent-session>/<worker>/events.jsonl`; the hook
returns before reading or writing the lead arc and breadcrumb. Claude documents
this field on child tool hooks. Codex receives the same isolation whenever its
event payload supplies the field; no path, timing, transcript, or tool-name
heuristic is used to guess identity.

Codex guarantees worker identity at SubagentStart/Stop but does not currently
promise `agent_id` on every child PostToolUse payload. While a Codex worker is
active, an untagged tool event is therefore quarantined under
`workers/<parent-session>/unattributed/events.jsonl` and cannot touch the lead
arc or breadcrumb. This may omit a simultaneous lead counter; it preserves the
more important invariant that ambiguous child work cannot mutate the durable
owner.

---

## SubagentStart - `hooks/subagent-start.js`

**Fires:** when Codex or Claude starts a native subagent.

**Input:** common fields, plus `agent_id`, `agent_type`, and optional `turn_id`.

**Writes:** one immutable `start_<receipt-id>.json` under the worker's directory,
including the parent breadcrumb and resolved chain head at start.

**Output:** child-only context stating that native machinery controls execution,
the parent remains the durable owner, and the child must return outcome, files,
proof, blockers, and remaining work. It never blocks worker creation.

---

## SubagentStop - `hooks/subagent-stop.js`

**Fires:** when a native subagent finishes responding.

**Input:** common worker fields, plus `agent_transcript_path`,
`last_assistant_message`, and `stop_hook_active`.

**Writes:** one immutable `stop_<receipt-id>.json`. The final message is capped
by `max_worker_result_chars` (default 4,000 characters); the transcript path is
recorded but the transcript is not read.

**Output:** a UI/system message naming the exact `[worker:<receipt-id>]` marker.
The lead verifies the result and logs that marker in one milestone. The hook
never blocks the stop and never mutates a breadcrumb.

---

## Claude native team events - `hooks/native-team-event.js`

The same script records `TaskCreated`, `TaskCompleted`, and `TeammateIdle` as
immutable receipts under `teams/<parent-session>/<team>/`. Task subject is
capped at 300 characters and task description at 1,000. Claude's native task
list, mailbox, permissions, and lead still control the team. Autocache never
blocks a task transition or keeps a teammate active.

---

## Stop - `hooks/stop.js`

**Fires:** when the agent finishes responding.

**Input:** common fields, plus `stop_hook_active`.

**Reads:** the open session, the active breadcrumb, and git state for `cwd` when the
directory is a repository.

**Writes:** a checkpoint under `checkpoints/` with `reason: "stop-hook"`, updates the
session's `updated_at`, appends a `checkpoint_save` event. The checkpoint's
breadcrumb block carries the chain position (`forked_from`, `forked_to`) and the
count of open decisions alongside the completed and remaining steps.

**Output:** none.

If `stop_hook_active` is true the hook exits immediately without writing, so it can
never participate in a stop loop.

---

## Adapters

`adapters/` holds the per-surface shims that translate a surface's hook payload into
the shape above. The hook bodies and the `~/.autocache/` state are identical across
surfaces - only the adapter differs.

| Surface | Adapter role |
|---|---|
| Claude Code | Native worker hooks plus native-team task/idle receipts |
| Codex | Maps the common hooks plus `SubagentStart`/`SubagentStop` |
| Grok | Read-only. No hooks. Grok narrates state and does not write it |

Adapters are linted and fail-open-tested in CI on exactly the same terms as the
hooks.

---

## Debugging a hook

Run one by hand with a payload on stdin:

```sh
echo '{"hook_event_name":"SessionStart","session_id":"test","cwd":"'"$PWD"'","source":"startup"}' \
  | AUTOCACHE_HOME=/tmp/ac-test node hooks/session-start.js
echo "exit: $?"
```

```powershell
$env:AUTOCACHE_HOME = "$env:TEMP\ac-test"
'{"hook_event_name":"SessionStart","session_id":"test","cwd":"C:\\tmp","source":"startup"}' |
  node hooks/session-start.js
"exit: $LASTEXITCODE"
```

The exit code is 0 in every case, including the broken ones - so debug by inspecting
stdout and the state directory, not by watching for a failure.

```sh
cat /tmp/ac-test/logs/events.jsonl
```

If a hook produces no output and no state, check in order: the `hooks` flags in
`config.json`, whether `AUTOCACHE_HOME` is writable, and whether the plugin is
actually enabled on the surface.
