---
name: autocache-resume
description: Read a pasted Autocache state dump and say exactly where the user left off - open breadcrumb, last session, unfinished step, next action. Fires on "where was I", "resume", "what was I doing", "pick up where I left off", or whenever a ~/.autocache JSON dump is pasted. Read-only - Grok narrates state, it never writes it.
---

# Autocache resume (Grok, read-only)

**You cannot write.** Grok has no Autocache hooks and, on the web surface, no
filesystem. Nothing you say in this skill has been saved to `~/.autocache/`. You are
reading a dump the user pasted, and every change you recommend has to be executed by
the user or by a writing surface (Claude Code, Codex). Never say "saved", "logged",
"checkpointed", or "I updated" - none of those happened.

## If no state has been pasted

Ask for it, with the command, and stop. Do not guess at prior work and do not
reconstruct an arc from the conversation and present it as recalled state.

```sh
root="${AUTOCACHE_HOME:-$HOME/.autocache}"
cat "$root/breadcrumbs/active.json" "$root/sessions/index.json" \
    "$root/state/self_state.json"  "$root/reminders.json" 2>/dev/null
```

```powershell
$root = if ($env:AUTOCACHE_HOME) { $env:AUTOCACHE_HOME } else { Join-Path $HOME '.autocache' }
Get-Content (Join-Path $root 'breadcrumbs/active.json'), (Join-Path $root 'sessions/index.json'), (Join-Path $root 'state/self_state.json'), (Join-Path $root 'reminders.json') -ErrorAction SilentlyContinue
```

## Reading order

1. `breadcrumbs/active.json` - is an arc open? Its title names the component and the
   files being changed. Its last logged step is where work actually stopped.
2. The newest entry in `sessions/index.json`, then that session file - the summary
   and findings.
3. `state/self_state.json` - the agent's running notes about itself.
4. `reminders.json` - anything due or overdue.
5. `checkpoints/` if a checkpoint id is referenced - the restore point.

## What to report, in this order

1. **The open arc.** Title, when it started, the last logged step, and how long it
   has been sitting. If `active.json` is null or missing, say there is no open arc.
   Do not manufacture one. If the record carries `forked_to`, it is frozen - the
   work moved to the record it names. Narrate the chain (who forked it, when, and
   the head's status), and if an ancestor carries `completed_via`, report the work
   as finished elsewhere via that head. Never present a frozen record as resumable
   in place.
2. **The gap.** What the last step says was done, versus what the arc title says the
   whole job is. That difference is the resume point.
3. **The next action.** One concrete thing, naming the file or component from the
   breadcrumb title.
4. **Anything due.** Overdue reminders, and any finding in the session record that
   warns about a risk in the remaining work.
5. **Anything stale or suspect.** A step logged days ago on a "quick" arc, a
   breadcrumb whose target files are not mentioned anywhere in the session findings,
   two sessions that look like the same work started twice. Say so; do not smooth
   it over.

Keep it short. The user is trying to start working again, not read a report.

## Then hand off the write

Close by giving the user the exact thing to run or paste in a surface that can
persist it, for example:

> To continue this arc with the writing surface, open Claude Code or Codex in that
> repository - the SessionStart hook restores this same state automatically and the
> breadcrumb is already open there.

## Boundaries

- If the dump is truncated or malformed, say which file was unreadable and work with
  what is left. Never fill a gap with invention.
- Autocache is the free tier. It has no knowledge base, no extraction, no retrieval,
  no index, no learning. Do not offer to build any of that from the pasted state.
- Autocache does not sync across machines. State is local to the machine that wrote
  it. If the user asks why their other laptop looks empty, that is why.
