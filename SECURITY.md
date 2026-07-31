# Security policy

## Reporting a vulnerability

Do not open a public issue.

Use GitHub's private reporting:
https://github.com/autocache-ai/autocache/security/advisories/new

Include the version or commit, the platform, what an attacker can do, and the smallest
reproduction you have.

**Response targets:** acknowledgement within 72 hours, an assessment within 7 days,
and a fix or a public explanation of why it will not be fixed within 30 days for
anything confirmed. You will be credited in the advisory and the changelog unless you
ask not to be.

Please do not test against anyone else's machine or state directory.

## What this software touches

Knowing the blast radius is most of the analysis, so here it is in full.

### It reads

- The JSON payload the harness hands each hook on stdin: session id, working
  directory, event name, tool name, tool input, tool response, prompt text for
  `UserPromptSubmit`, and a transcript path.
- Its own state under `~/.autocache/` (or `AUTOCACHE_HOME`).
- `git` metadata for the working directory when writing a checkpoint: branch, short
  head, and whether the tree is dirty.

### It does not read

- Your repository. There is no file scan and no source ingestion.
- The transcript. `transcript_path` arrives in the payload and is deliberately never
  opened.
- Environment variables other than `AUTOCACHE_HOME`, `HOME`, and `USERPROFILE`.
- Credentials, tokens, keychains, or config belonging to any other tool.

### It writes

Only under `~/.autocache/` (or `AUTOCACHE_HOME`). Nothing else on the system is
created or modified, ever - no temp files elsewhere, no lock files, no registry keys,
no shell profile edits. Every write goes to `<file>.tmp` in the same directory and is
then moved into place with `fs.renameSync`.

Recorded there: session metadata and findings you typed, breadcrumb names and steps
(tool name and target, not payloads), checkpoints including git branch and short head,
self-state notes, scratch tags, reminders, and an event log.

**Not recorded:** file contents, prompt text, model output, tool responses,
credentials, tokens, or environment variables.

### It never sends anything anywhere

There are no network calls in any hook or adapter. No HTTP, no DNS, no sockets.
Telemetry is off by default in `config.json` and there is no endpoint for it to reach
even if the flag were flipped. If a future release ever adds one, it will be opt-in,
documented, and announced in the changelog before it ships. Autocache has zero npm
dependencies, so there is no transitive package that could add a call behind your back.

## Threat model

### What Autocache defends against

- **Corrupting your state on a crash.** Atomic write-then-rename means a crash leaves
  either the old file or the new one, never a truncated file that still parses.
- **Breaking your session.** Every hook fails open, exits 0 on every path, and never
  blocks a tool call. CI has a dedicated job that pipes malformed input, empty input,
  a missing state root, an unwritable one, and corrupt state into every hook and
  asserts the exit code.
- **Leaking your work off the machine.** By having no mechanism that could.

### What it does not defend against

- **A hostile local user.** State is a plain, unencrypted, user-readable directory with
  ordinary filesystem permissions. Anyone who can read your home directory can read it.
- **A compromised agent or harness.** Autocache runs inside your agent's process tree
  and trusts the payload it is handed. If the harness is compromised, so is everything
  it feeds Autocache.
- **Malicious content in state you copied from elsewhere.** Restore output is injected
  into a model's context. If you import a state directory from an untrusted source,
  text in it reaches your model as context. Treat a foreign `~/.autocache/` the way you
  would treat a foreign repository - read it before you use it.
- **Anything about your repository's own security.** Autocache neither improves nor
  degrades it.

## For reviewers auditing this yourself

Everything is readable source: hooks and adapters are plain Node with no build step and
no dependencies. The claims above are checkable with a grep.

```sh
# no network
grep -rnE "require\('(http|https|net|dgram|tls)'\)|fetch\(|XMLHttpRequest" hooks/ adapters/

# no child processes beyond the documented git read
grep -rn "child_process" hooks/ adapters/

# every write path is atomic
grep -rn "writeFileSync\|renameSync" hooks/ adapters/

# every hook exits 0
grep -rn "process.exit" hooks/ adapters/
```

If any of those turns up something the docs do not account for, that is a finding worth
reporting.

## Supported versions

v0.1.0 is pre-1.0. Only the latest release receives fixes. There are no backports.

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| older | No |
