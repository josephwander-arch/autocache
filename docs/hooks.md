# Hook reference

Five hooks. All Node, all zero-dependency, all fail open.

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

**Writes:** `state/arc.json` (the running work-arc record - see
[state-format.md](state-format.md)), and appends a `session_start` event to
`logs/events.jsonl`.

It does **not** create a session file. Session files under `sessions/` are written only by
`/handoff`, because a session record is a deliberate act of summarising an arc, not a
side effect of opening a terminal. An earlier version of this document claimed SessionStart
opened one; it never did.

**Output:** `hookSpecificOutput.additionalContext` containing a compact restore
block - last session summary, the open breadcrumb and its last step, due reminders,
and self-state focus. Nothing to restore means no output at all rather than a block
that says "nothing to restore".

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

**Writes:**

- appends an automatic step to the open breadcrumb when `config.breadcrumb.auto_step`
  is true, recording the tool name and target rather than the payload
- increments `calls_since_step` on the breadcrumb and `tool_calls` on the session
- records a backup entry when the backup helper ran

**Output:** none. This hook is silent by design; it is bookkeeping.

Tool responses are not stored. Only metadata - which tool, which target, when.

---

## Stop - `hooks/stop.js`

**Fires:** when the agent finishes responding.

**Input:** common fields, plus `stop_hook_active`.

**Reads:** the open session, the active breadcrumb, and git state for `cwd` when the
directory is a repository.

**Writes:** a checkpoint under `checkpoints/` with `reason: "stop-hook"`, updates the
session's `updated_at`, appends a `checkpoint_save` event.

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
| Claude Code | Native. Payload is already in the documented shape |
| Codex | Maps Codex's hook config and payload fields onto the same events |
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
