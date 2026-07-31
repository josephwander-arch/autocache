# Autocache adapter: Grok

## Grok reads. Grok does not write. Read this before anything else.

Grok is a **skill and prompt surface**, not a hook surface. It has no hook events, no
installer, and on the web surface no filesystem access at all. Therefore:

> **Grok can read and narrate `~/.autocache/`. Grok cannot change it.**
>
> Nothing Grok says has been saved. No session was started, no breadcrumb was
> stepped, no checkpoint was written, no reminder was added. If a change is to
> reach `~/.autocache/`, a human or a hook surface (Claude Code, Codex) has to
> make it.

This is stated first, loudly, and repeated inside every skill in this directory on
purpose. A surface that silently cannot write is exactly the failure mode Autocache
exists to prevent: you believe your work arc was recorded, you come back tomorrow,
and there is nothing there. An honest read-only narrator is useful. A narrator that
sounds like a writer is worse than nothing.

Every skill here therefore ends its output the same way - by handing you the exact
text or command to run somewhere that can actually persist it.

## What Grok is genuinely good for here

- Reading a pasted state dump and telling you, in plain language, where you left off.
- Turning a long messy session into a continuation packet you can paste into
  Claude Code or Codex.
- Reviewing a breadcrumb trail and telling you which step is actually unfinished.
- Drafting the summary text that a writing surface will then persist.

## Installing

There is nothing to install and nothing to run. These are markdown skill bodies.

- **Grok with a custom-skills or project-instructions surface**: create one entry per
  directory here, using the `name` and `description` from the file's YAML frontmatter
  and the body as the instruction text.
- **Plain chat**: paste the contents of the relevant `SKILL.md` at the top of the
  conversation, then paste your state dump under it.

## Getting state in front of Grok

Grok cannot open your files, so you produce a dump and paste it. Both commands print
a bounded digest, never the whole directory.

PowerShell (Windows):

```powershell
$root = if ($env:AUTOCACHE_HOME) { $env:AUTOCACHE_HOME } else { Join-Path $HOME '.autocache' }
Get-Content (Join-Path $root 'breadcrumbs/active.json') -ErrorAction SilentlyContinue
Get-Content (Join-Path $root 'sessions/index.json')     -ErrorAction SilentlyContinue
Get-Content (Join-Path $root 'state/self_state.json')   -ErrorAction SilentlyContinue
Get-Content (Join-Path $root 'reminders.json')          -ErrorAction SilentlyContinue
```

POSIX (macOS, Linux, Git Bash, WSL):

```sh
root="${AUTOCACHE_HOME:-$HOME/.autocache}"
cat "$root/breadcrumbs/active.json" "$root/sessions/index.json" \
    "$root/state/self_state.json"  "$root/reminders.json" 2>/dev/null
```

It is plain JSON. Read it yourself before you paste it - that is the point of keeping
state in files you own.

## Boundary

Autocache is the free tier: sessions, breadcrumbs, checkpoints, self-state, scratch
tags, local reminders. It has no knowledge base, no extraction, no retrieval, no
index, no consolidation, no context budgeting, no learning, no eval. Grok must not
offer to simulate any of those from the pasted state.

Autocache remembers your work. Autonomous remembers your knowledge.
