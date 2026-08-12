# Autocache adapter: Codex

Codex is a real hook surface. It has real directories under `~/.codex/` and it runs
Node hook commands the same way Claude Code does. So the Codex adapter is a pure
**materialization**: it puts the shared Autocache files where Codex looks for them
and registers the hook commands. It does not rewrite them, and it does not maintain
a second copy of the logic.

The Node hook scripts and the state FORMAT are shared verbatim with every other
surface; since 0.3.0 each surface writes its own scoped store under
`~/.autocache/stores/<surface>/` (Codex: `stores/codex/`). Cross-surface resume is
explicit by design: the shared-tag bridge and breadcrumb fork chains carry work
between surfaces - a Claude arc appears in Codex through adoption or fork, not by
reading one shared live directory.

## Directory mapping

| Repository source | Installed to | Notes |
|---|---|---|
| `skills/<name>/` | `~/.codex/skills/autocache-<name>/` | Whole directory copied. `SKILL.md` frontmatter is unchanged; Codex reads the same YAML `name` / `description` pair Claude Code does. Names already starting with `autocache-` are not double-prefixed. |
| `hooks/**` | `~/.codex/hooks/autocache/**` | The entire tree, including any shared library modules the hooks require. Kept in an `autocache/` subdirectory so it can never collide with a hook you or another tool already installed at `~/.codex/hooks/`. |
| `adapters/codex/rules/autocache.md` | `~/.codex/rules/autocache.md` | The always-on behavioral rules. This is the one file authored by the adapter rather than shared, because it describes the surface. |
| `agents/*.md` | `~/.codex/agents/autocache-<name>.md` | Copied when the repository ships subagents. |
| (registration) | `~/.codex/hooks.json` | Merged, never clobbered. See below. |
| `commands/*.md` | not installed | Codex has no slash-command directory. The rules file tells the agent to honor the same verbs (`resume`, `checkpoint`, `handoff`, `status`, `remind`, `breadcrumb`, `export`) when you type them as plain requests. |

State base is `~/.autocache/` (`AUTOCACHE_HOME` overrides). The store is the scoped
`stores/codex/` beneath it (0.3.0+), created on first use and seeded from any legacy
layout by copy. The installer will create that directory if it is missing. It will
**never** write, move, or overwrite a file inside it.

## Hook registration

`~/.codex/hooks.json` uses the same shape as Claude Code's `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [ { "type": "command", "command": "node \"...\"", "timeout": 10 } ] }
    ]
  }
}
```

Events registered, matching the plugin one for one:

| Event | Script | Job |
|---|---|---|
| `SessionStart` | `session-start.js` | Restore last session summary, open breadcrumb, due reminders, self-state |
| `UserPromptSubmit` | `user-prompt-submit.js` | Surface a matching prior finding when the prompt echoes past work |
| `PreToolUse` | `pre-tool-use.js` | Advisory only. Never blocks |
| `PostToolUse` | `post-tool-use.js` | Count lead tool calls; isolate identified child events in worker streams |
| `SubagentStart` | `subagent-start.js` | Record native worker identity and inject its no-ownership boundary |
| `SubagentStop` | `subagent-stop.js` | Persist the worker result for lead verification and reconciliation |
| `Stop` | `stop.js` | Auto-checkpoint the arc |

Codex remains the worker executor and coordinator. Autocache does not replace
`spawn_agent`, follow-up, wait, interrupt, permissions, or worktrees. When Codex
supplies `agent_id` on a child tool event, that event is isolated under the
worker's state directory and cannot change the lead arc or breadcrumb. The
SubagentStart/Stop registrations themselves are stable and always record the
worker lifecycle. While a worker is active, an untagged Codex event is
quarantined as unattributed rather than allowed to change the lead. That may
under-count a simultaneous lead tool call, but it cannot corrupt ownership. No
heuristic identity guessing is used.

Registration rules the installer holds itself to:

1. **Merge, never clobber.** Your existing `hooks.json` is parsed, and only entries
   whose command points into `~/.codex/hooks/autocache/` are replaced. Everything
   else is left byte-for-byte alone.
2. **Archive first.** Before any modifying write, the current `hooks.json` is copied
   to `hooks.json.autocache-backup-<timestamp>`. The three newest backups are kept.
3. **Atomic.** Written as `hooks.json.tmp` and then renamed into place.
4. **Idempotent.** Running the installer twice changes nothing the second time and
   says so. If the merged result is identical to what is on disk, no write happens
   at all.
5. **Refuses to guess.** If `hooks.json` exists but does not parse as JSON, the
   installer stops, reports the failure, and exits non-zero rather than replacing a
   file it does not understand.
6. Every path is quoted in the emitted command. Windows home directories contain
   spaces.

Only scripts that actually exist in the repository are registered.

## Usage

```sh
node adapters/codex/install.js              # install or update
node adapters/codex/install.js --dry-run    # print the plan, write nothing
node adapters/codex/install.js --link       # symlink hooks and skills instead of copying
node adapters/codex/install.js --uninstall  # remove everything this installer added
node adapters/codex/install.js --help
```

Options:

- `--dry-run` - report every action as `would <action>`; no filesystem writes.
- `--link` - symlink instead of copy, so edits in a checked-out repository take
  effect immediately. Falls back to copying per file if the OS refuses the symlink,
  which is the normal outcome on Windows without Developer Mode or elevation.
- `--codex-home=<path>` - install into a different Codex home. Also honors the
  `CODEX_HOME` environment variable.
- `--repo=<path>` - use a different repository root instead of the one inferred
  from this script's location.
- `--uninstall` - removes `~/.codex/skills/autocache-*`, `~/.codex/hooks/autocache/`,
  `~/.codex/rules/autocache.md`, `~/.codex/agents/autocache-*.md`, and the hook
  registrations. It does not touch `~/.autocache/` or any scoped store beneath it. Your sessions, breadcrumbs and
  checkpoints survive uninstalling the front end, which is the entire point of
  keeping state out of the surface.

Exit code is 0 when every planned action succeeded or was already satisfied, and
non-zero only on a genuine failure.

## After installing

Restart Codex, or start a new session. Hook registration is read at session start;
an already-running session will not pick it up.

To verify the scoped-store layout end to end:

```sh
ls ~/.autocache/stores/codex/sessions        # sessions written by this surface
ls ~/.autocache/stores/codex/breadcrumbs     # including active.json
```

Those are plain JSON files. Read them, diff them, delete them. Nothing is hidden
and nothing leaves the machine.
