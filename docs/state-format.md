# State format

Every byte Autocache persists lives under one directory and is plain JSON. You can
read it, diff it, grep it, commit it, or delete it. Nothing is encoded, compressed,
or encrypted, and nothing is written outside this tree.

```
~/.autocache/
  config.json
  sessions/
    <session-id>.json
    index.json
  breadcrumbs/
    <breadcrumb-id>.json
    active.json
  checkpoints/
    <checkpoint-id>.json
  state/
    self_state.json
    bag.json
  reminders.json
  logs/
    events.jsonl
```

## Rules that apply to every file

**Root resolution.** `AUTOCACHE_HOME` if set, otherwise `path.join(os.homedir(), '.autocache')`.
Paths are always built with `path.join` - no hardcoded separators.

**Atomic writes.** Every write goes to `<file>.tmp` in the same directory and is then
moved into place with `fs.renameSync`. Rename within a directory is atomic on all
three supported platforms. A crash therefore leaves either the old file or the new
file, never a truncated one that still parses as valid JSON. That specific failure -
valid-but-truncated state - is the thing this product exists to prevent.

If you find a stray `*.tmp` file, a write was interrupted. It is safe to delete.

**Fail open on read.** A missing file, an unparseable file, or an unreadable
directory is treated as "no state" and never as an error. Nothing in Autocache
throws at the session.

**Forward compatibility.** Readers must ignore unknown fields and tolerate missing
optional fields. Every top-level object carries a `version` integer so a future
release can migrate rather than guess.

**Timestamps** are ISO 8601 UTC strings, for example `2026-07-31T18:04:11.512Z`.

**Identifiers** are prefixed and sortable-ish: `ses_`, `bc_`, `ckpt_`, `rem_`,
followed by a timestamp-derived component and a short random suffix. Treat them as
opaque strings.

**Deletion is safe.** Any file here can be deleted at any time. The next hook that
needs it recreates it empty. Deleting the whole directory resets Autocache to a fresh
install.

---

## config.json

User settings. Created on first run with defaults.

```json
{
  "version": 1,
  "tier": "free",
  "telemetry": { "enabled": false },
  "created_at": "2026-07-31T17:00:00.000Z",
  "updated_at": "2026-07-31T17:00:00.000Z",
  "limits": {
    "session_index_max": 200,
    "log_max_bytes": 5242880
  },
  "hooks": {
    "session_start": true,
    "user_prompt_submit": true,
    "pre_tool_use": true,
    "post_tool_use": true,
    "stop": true
  },
  "breadcrumb": {
    "nudge_after_tool_calls": 3,
    "auto_step": true
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | Schema version of this file |
| `tier` | `"free"` | Always `"free"` in Autocache. Autonomous sets its own |
| `telemetry.enabled` | boolean | Default `false`. No hook makes network calls; there is no endpoint |
| `limits.session_index_max` | integer | How many entries `sessions/index.json` keeps |
| `limits.log_max_bytes` | integer | Rotation threshold for `logs/events.jsonl` (5 MB) |
| `hooks.*` | boolean | Per-hook kill switch. Set any to `false` to disable that hook without uninstalling |
| `breadcrumb.nudge_after_tool_calls` | integer | Tool calls before `PreToolUse` advises opening a breadcrumb |
| `breadcrumb.auto_step` | boolean | Whether `PostToolUse` appends automatic steps |

---

## sessions/&lt;session-id&gt;.json

One file per session. Written by the session lifecycle and appended to as findings
accumulate.

```json
{
  "version": 1,
  "id": "ses_20260731T170412_9f3a",
  "surface": "claude-code",
  "cwd": "C:\\CPC\\autocache",
  "title": "autocache docs and CI",
  "status": "open",
  "started_at": "2026-07-31T17:04:12.004Z",
  "updated_at": "2026-07-31T18:22:57.610Z",
  "closed_at": null,
  "tool_calls": 41,
  "breadcrumb_ids": ["bc_20260731T170530_1c77"],
  "findings": [
    {
      "at": "2026-07-31T17:31:02.119Z",
      "text": "node --check is the whole lint story; there is no dependency to install",
      "tags": ["ci"]
    }
  ],
  "summary": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Session identifier, matches the filename |
| `surface` | string | `"claude-code"`, `"codex"`, or `"grok"` |
| `cwd` | string | Working directory the session started in |
| `title` | string | Short human label, may be empty until set |
| `status` | `"open"` or `"closed"` | Closed sessions are never appended to again |
| `started_at`, `updated_at`, `closed_at` | string, nullable | ISO 8601 UTC |
| `tool_calls` | integer | Count observed by `PostToolUse` |
| `breadcrumb_ids` | string[] | Breadcrumbs opened during this session |
| `findings[]` | object[] | Explicitly recorded observations, in order |
| `summary` | string, nullable | Continuation packet text once written |

---

## sessions/index.json

A newest-first pointer list so restore never has to stat and parse every session
file. Capped at `config.limits.session_index_max`; entries past the cap are dropped
from the index, but the underlying session files are left alone.

```json
{
  "version": 1,
  "updated_at": "2026-07-31T18:22:57.612Z",
  "cap": 200,
  "sessions": [
    {
      "id": "ses_20260731T170412_9f3a",
      "title": "autocache docs and CI",
      "status": "open",
      "surface": "claude-code",
      "cwd": "C:\\CPC\\autocache",
      "started_at": "2026-07-31T17:04:12.004Z",
      "updated_at": "2026-07-31T18:22:57.610Z",
      "has_summary": false
    }
  ]
}
```

The index is a cache of the session files, not the source of truth. If it is deleted
or corrupt, it is rebuilt from the directory.

---

## breadcrumbs/&lt;breadcrumb-id&gt;.json

A tracked work arc: what is being changed, which files it will touch, and every step
logged against it.

```json
{
  "version": 1,
  "id": "bc_20260731T170530_1c77",
  "name": "docs and CI | targets: README.md, docs/, .github/workflows/ci.yml",
  "status": "open",
  "session_id": "ses_20260731T170412_9f3a",
  "surface": "claude-code",
  "cwd": "C:\\CPC\\autocache",
  "targets": ["README.md", "docs/", ".github/workflows/ci.yml"],
  "created_at": "2026-07-31T17:05:30.881Z",
  "updated_at": "2026-07-31T18:10:44.203Z",
  "completed_at": null,
  "planned_steps": ["write state-format.md", "write the CI workflow", "fail-open job"],
  "steps": [
    { "n": 1, "at": "2026-07-31T17:20:00.000Z", "text": "spec read, ownership confirmed", "auto": false },
    { "n": 2, "at": "2026-07-31T17:44:10.000Z", "text": "Write docs/state-format.md", "auto": true, "tool": "Write" }
  ],
  "decisions": [],
  "backups": [
    { "at": "2026-07-31T17:44:09.000Z", "source": "README.md", "backup": "README.md.20260731T174409.bak" }
  ],
  "calls_since_step": 2
}
```

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Must declare component and mutable targets. Generic names defeat the purpose |
| `status` | `"open"`, `"complete"`, `"aborted"` | Only one breadcrumb is open at a time per state root |
| `targets` | string[] | Files or directories the arc is expected to mutate |
| `planned_steps[]` | string[] | The still-open work, in order. **Growable**: work discovered mid-arc that is still open when the agent's output ends is appended here. A planned step counts as done once a logged step covers its text |
| `steps[]` | object[] | The log of what happened. `auto: true` entries came from `PostToolUse`, `false` entries were logged explicitly |
| `decisions[]` | object[] | Questions the arc could not settle by itself; see below |
| `backups[]` | object[] | Recorded by the backup helper before an overwrite |
| `calls_since_step` | integer | Drives the "log a step" nudge |
| `forked_from` | string, optional | Id of the record this one was forked from; see the fork chain below |
| `forked_to`, `forked_by`, `forked_at` | string, optional | Set when this record is forked away. A non-null `forked_to` means the record is **frozen** |
| `completed_via` | string, optional | Set on an ancestor when a later chain head completed the work |
| `retired`, `retired_reason`, `retired_by` | optional | Set when an incomplete chain was explicitly retired with a recorded reason |

All of the fork-chain fields are optional. A record written before they existed has
none of them and behaves exactly as it always did.

### Decisions

A decision is a question with 2-3 defensible answers that the arc recorded instead
of guessing. It lives on the breadcrumb so the next session inherits both the
question and, once resolved, the answer with its reasoning.

```json
{
  "id": "dec-1-7f2a",
  "question": "malformed rows: throw or write a .rejects sidecar?",
  "options": ["throw on first bad row", "write a .rejects sidecar"],
  "lean": "write a .rejects sidecar",
  "waits_on": "user",
  "blocks": [2],
  "status": "open",
  "raised_at": "2026-07-31T17:50:00.000Z",
  "raised_by": "claude-code",
  "chosen": null,
  "decided_by": null,
  "basis": null,
  "decided_at": null
}
```

| Field | Meaning |
|---|---|
| `options` | 2-3 candidate answers. Two minimum - one option is not a decision |
| `lean` | The recorder's preferred option, or null. A lean is advice for the resolver, not a resolution |
| `waits_on` | `"user"` - only the user's answer resolves it. `"any_informed_session"` - any agent with the full recorded picture may resolve it |
| `blocks` | Indexes into `planned_steps` that must not be worked until this resolves. Steps not listed proceed freely |
| `status` | `"open"` or `"resolved"` |
| `chosen`, `decided_by`, `decided_at` | The resolution: which option, who decided, when |
| `basis` | What justified the call - required when an agent resolves an `any_informed_session` decision |

### The fork chain

Cross-session takeover is recorded as a chain of breadcrumb records with **exactly
one live head**. Forking a record writes a new breadcrumb carrying the remaining
`planned_steps` and every unresolved decision (with `blocks` reindexed against the
new, shorter list), sets `forked_from` on the new record, and then freezes the
source by setting `forked_to`, `forked_by`, and `forked_at`.

A frozen record - non-null `forked_to` - rejects every write. The rejection names
the chain head so a returning session catches up instead of writing into a dead
branch. Taking work back is a fork of the current head; the chain grows forward and
every hop stays attributed. Fork ids are guaranteed unique against the source (a
discriminator suffix is appended on collision), so a record can never end up
`forked_to` itself.

A frozen ancestor and the head that superseded it:

```json
{
  "version": 1,
  "id": "bc_20260801T090000_a1b2",
  "name": "csv importer | targets: src/import/csv.js",
  "status": "open",
  "planned_steps": ["wire parser", "reject sidecar", "cli hook"],
  "steps": [ { "at": "2026-08-01T09:20:00.000Z", "text": "schema written", "source": "command" } ],
  "forked_to": "bc_20260801T113005_c3d4",
  "forked_by": "claude-code ses_20260801T112900_9e1f",
  "forked_at": "2026-08-01T11:30:05.112Z"
}
```

```json
{
  "version": 1,
  "id": "bc_20260801T113005_c3d4",
  "name": "csv importer | targets: src/import/csv.js",
  "status": "open",
  "planned_steps": ["wire parser", "reject sidecar", "cli hook"],
  "steps": [],
  "decisions": [],
  "forked_from": "bc_20260801T090000_a1b2",
  "created_at": "2026-08-01T11:30:05.112Z"
}
```

Completing the head walks `forked_from` back and marks every still-open ancestor
`"status": "complete"` with `completed_via` set to the head id - each earlier
session resumes into "finished elsewhere, here is the pointer" rather than a
dangling operation. Aborting the head propagates nothing: ancestors stay frozen
pointing forward, and the aborted tail surfaces as adoptable work. An incomplete
chain is never silently pruned; it keeps surfacing until it is completed through
the chain or explicitly retired, which closes every open record with `retired:
true` and the recorded reason.

## breadcrumbs/active.json

Which breadcrumb is currently open, or null. Small on purpose: it is read by
`PreToolUse` and `PostToolUse` on a hot path.

```json
{
  "version": 1,
  "breadcrumb_id": "bc_20260731T170530_1c77",
  "updated_at": "2026-07-31T17:05:30.883Z"
}
```

When nothing is open:

```json
{ "version": 1, "breadcrumb_id": null, "updated_at": "2026-07-31T18:40:00.000Z" }
```

A dangling `breadcrumb_id` whose file no longer exists is treated as null.

---

## checkpoints/&lt;checkpoint-id&gt;.json

A resumable snapshot of the arc. Written automatically by the `Stop` hook at the end
of a turn, and manually by `/checkpoint`.

```json
{
  "version": 1,
  "id": "ckpt_20260731T183012_44b1",
  "created_at": "2026-07-31T18:30:12.771Z",
  "reason": "stop-hook",
  "session_id": "ses_20260731T170412_9f3a",
  "breadcrumb_id": "bc_20260731T170530_1c77",
  "surface": "claude-code",
  "cwd": "C:\\CPC\\autocache",
  "git": {
    "branch": "main",
    "head": "a31ef8f",
    "dirty": true
  },
  "arc": {
    "title": "docs and CI",
    "last_step": "Write docs/state-format.md",
    "open_targets": ["examples/", ".github/ISSUE_TEMPLATE/"],
    "next": "write the fail-open regression job"
  },
  "notes": ""
}
```

| Field | Meaning |
|---|---|
| `reason` | `"stop-hook"` for automatic, `"manual"` for `/checkpoint` |
| `git` | Best-effort snapshot. Absent or null when the cwd is not a git repository |
| `arc` | What the next session needs to pick up: last step, what is still open, what comes next |

Checkpoints are never mutated after write. `/checkpoint clear` deletes them.

---

## state/self_state.json

The agent's running notes about itself for the current arc - focus, working
assumptions, and open questions. Rewritten in place, not appended.

```json
{
  "version": 1,
  "updated_at": "2026-07-31T18:12:00.000Z",
  "focus": "documentation and CI for the public repo",
  "working_on": "fail-open regression job",
  "assumptions": [
    "hook filenames follow the spec table",
    "adapters/ holds the non-Claude-Code surface shims"
  ],
  "open_questions": [
    "does the Codex hook config want absolute paths"
  ],
  "notes": [
    { "at": "2026-07-31T17:58:00.000Z", "text": "CI must run on all three OSes; path separators are the risk" }
  ]
}
```

---

## state/bag.json

Scratch key/value tags for the current arc. Deliberately unstructured - it is a
place to stash a build id, a branch name, a port number, or a decision, so the next
session does not have to re-derive it.

```json
{
  "version": 1,
  "updated_at": "2026-07-31T18:00:00.000Z",
  "tags": {
    "branch": { "value": "main", "at": "2026-07-31T17:10:00.000Z" },
    "ci_matrix": { "value": ["ubuntu-latest", "windows-latest", "macos-latest"], "at": "2026-07-31T17:55:00.000Z" }
  }
}
```

Values may be any JSON type. Clearing the bag empties `tags` and leaves the file.

---

## state/arc.json

The live work arc: hook bookkeeping for the turn currently in progress. This is the file
the hooks write most often, so it is documented here even though nothing outside the hooks
is expected to read it. Leaving it out would contradict the promise that your state is
plain JSON you can read - the most-written file being undocumented is exactly the gap that
makes people distrust a local-state claim.

```json
{
  "session_id": "ses_20260731T170412_9f3a",
  "cwd": "C:/work/myproject",
  "tool_calls": 14,
  "touched_files": ["C:/work/myproject/src/index.js"],
  "breadcrumb_id": "bc_20260731T170530_1c77",
  "last_checkpoint": "ckpt_20260731T183012_44b1",
  "last_breadcrumb_nudge_at": 12,
  "warned_paths": ["C:/work/myproject/src/config.js"],
  "auto_checkpoints": ["ckpt_20260731T183012_44b1"],
  "updated_at": "2026-07-31T18:30:12.774Z"
}
```

| Field | Type | Meaning |
|---|---|---|
| `session_id` | string | Session this arc belongs to, empty before one exists |
| `cwd` | string | Working directory observed at `SessionStart` |
| `tool_calls` | integer | Count seen by `PostToolUse` this arc |
| `touched_files` | string[] | Paths written or edited during the arc |
| `breadcrumb_id` | string | Open breadcrumb, empty when none |
| `last_checkpoint` | string | Newest checkpoint id, used by the next `SessionStart` |
| `last_breadcrumb_nudge_at` | integer | Tool-call count at the last nudge; `-1` means never. Prevents repeat nagging |
| `warned_paths` | string[] | Paths already warned about, so the same file is not flagged twice |
| `auto_checkpoints` | string[] | Checkpoints the `Stop` hook created, as opposed to `/checkpoint` |
| `frozen_warned_id` | string | Breadcrumb id already warned about as frozen, so `PostToolUse` says it once |
| `updated_at` | string | ISO 8601 UTC, set on every write |

Deleting this file is safe. The next `SessionStart` rebuilds it from defaults; you lose the
in-progress counters, not any session, breadcrumb, or checkpoint.

---

## reminders.json

Local reminders. No scheduler, no daemon, no notifications: due reminders surface at
`SessionStart` and on demand. Autocache cannot remind you when nothing is running.

```json
{
  "version": 1,
  "updated_at": "2026-07-31T18:00:00.000Z",
  "reminders": [
    {
      "id": "rem_20260731T175500_0a2e",
      "text": "record the terminal cast for the README",
      "created_at": "2026-07-31T17:55:00.000Z",
      "due_at": "2026-08-01T15:00:00.000Z",
      "recurrence": null,
      "status": "open",
      "completed_at": null,
      "session_id": "ses_20260731T170412_9f3a"
    },
    {
      "id": "rem_20260731T180000_71bd",
      "text": "check open issues",
      "created_at": "2026-07-31T18:00:00.000Z",
      "due_at": "2026-08-01T13:00:00.000Z",
      "recurrence": { "every": "day", "interval": 1 },
      "status": "open",
      "completed_at": null,
      "session_id": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `due_at` | ISO 8601 UTC, or null for an undated reminder |
| `recurrence` | null, or `{ "every": "day" \| "week" \| "month", "interval": integer }`. On completion the next occurrence is scheduled and a new open reminder replaces it |
| `status` | `"open"`, `"done"`, or `"deleted"` |

---

## logs/events.jsonl

Append-only newline-delimited JSON. One object per line, never rewritten. This is a
debugging aid, not state - deleting it loses nothing you need.

```
{"ts":"2026-07-31T17:04:12.010Z","event":"session_start","surface":"claude-code","session_id":"ses_20260731T170412_9f3a","data":{"restored":true}}
{"ts":"2026-07-31T17:05:30.890Z","event":"breadcrumb_start","surface":"claude-code","session_id":"ses_20260731T170412_9f3a","data":{"breadcrumb_id":"bc_20260731T170530_1c77"}}
{"ts":"2026-07-31T18:30:12.780Z","event":"checkpoint_save","surface":"claude-code","session_id":"ses_20260731T170412_9f3a","data":{"checkpoint_id":"ckpt_20260731T183012_44b1","reason":"stop-hook"}}
```

| Field | Meaning |
|---|---|
| `ts` | ISO 8601 UTC |
| `event` | Short snake_case event name |
| `surface` | Which front end emitted it |
| `session_id` | May be null when no session is open |
| `data` | Event-specific object. Never contains file contents or prompt text |

**Rotation.** When the file exceeds `config.limits.log_max_bytes` (5 MB) it is
renamed to `events.jsonl.1` and a fresh `events.jsonl` is started. Exactly one
rotated file is kept; the previous `events.jsonl.1` is overwritten.

A truncated final line - a crash mid-append - is expected and must be skipped by any
reader rather than treated as corruption.

---

## What is never written here

No file contents from your repository. No prompt text or model output. No
credentials, tokens, or environment variables. No network destinations, because
there are no network calls. If you find any of that in your state directory, that is
a security bug: see [SECURITY.md](../SECURITY.md).
