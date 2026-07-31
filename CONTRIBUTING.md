# Contributing

Autocache is small on purpose. The best contributions keep it that way.

## The invariants

These are not style preferences. A change that breaks one does not merge, regardless
of how useful it is.

1. **Every hook fails open.** The body is wrapped in try/catch and every path ends in
   `process.exit(0)`. Malformed stdin, empty stdin, a missing state directory, an
   unwritable `AUTOCACHE_HOME`, corrupt JSON - all exit 0 and do nothing. A hook may
   never block, deny, crash, or hang a session. A continuity tool that breaks the
   session it exists to protect is worse than no tool.
2. **Every state write is atomic.** Write `<file>.tmp` in the same directory, then
   `fs.renameSync`. Never rewrite in place. A valid-but-truncated state file is the
   exact failure this product exists to prevent.
3. **Zero dependencies.** Node standard library only. No `package.json` dependencies,
   no lockfile, no vendored modules, no build step.
4. **Node, never Python.** `python3` does not reliably resolve on Windows, and a hook
   whose interpreter is missing fails silently. Node is present wherever these agents run.
5. **Cross-platform.** Windows, macOS, Linux. Build paths with `path.join`. Never
   hardcode a separator. Quote `"${CLAUDE_PLUGIN_ROOT}"` in every hook command, because
   Windows plugin paths contain spaces.
6. **One state root.** `AUTOCACHE_HOME` if set, otherwise `path.join(os.homedir(), '.autocache')`.
   Nothing is written outside that tree - not a temp file, not a lock, not a log.
7. **No network calls.** None, anywhere. Telemetry is off by default and has no endpoint.
8. **No emoji in files.** Chat only. Emoji are never written into any file in this
   repository - downstream tools that read and rewrite them mangle encodings, and hook
   output lands in terminals with no reliable font coverage. CI enforces this.
9. **No paid capability.** Do not implement, stub, tease, or imply free access to
   extraction, semantic/lexical/graph retrieval, index maintenance, knowledge-base
   writes with propagation, consolidation or staleness detection, context budgeting,
   learning analytics, or eval. The boundary is structural, not a license check.
10. **Honest copy.** No prompt-caching claim, no "makes the model smarter", no
    cross-machine sync claim in v1. Claim only what the code does.

## What is in scope

Sessions, breadcrumbs, checkpoints, self-state, the scratch bag, local reminders,
health and error reporting, config backup and validation, and the surface adapters
that carry those to Claude Code, Codex, and Grok. Single machine, single work arc.

Bug fixes to the above, cross-platform correctness, better restore output, and better
docs are all welcome without asking first.

## What is out of scope

Anything requiring an index, a corpus, or a running process between invocations. That
is Autonomous, and the split is architectural: a hook is a short-lived one-shot
process with no shared state, which is the opposite of what retrieval needs. See
[docs/upgrade.md](docs/upgrade.md).

Also out: adding a dependency, adding a binary, adding a build step, adding a network
call. If your idea needs one of those, open an issue before writing code - the answer
is probably no, and finding that out after the work is done helps nobody.

## Setup

```sh
git clone https://github.com/josephwander-arch/autocache.git
cd autocache
node --version    # any currently supported release
```

That is the whole setup. There is nothing to install.

## Running the checks locally

```sh
node .github/scripts/check-syntax.cjs    # node --check every .js under hooks/ and adapters/
node .github/scripts/validate-json.cjs   # every .json parses; manifests have the right shape
node .github/scripts/fail-open.cjs       # the one that matters
node .github/scripts/no-emoji.cjs        # emoji are chat-only
```

`fail-open.cjs` pipes malformed stdin, empty stdin, a nonexistent `AUTOCACHE_HOME`, an
unwritable one, and a corrupt state directory into every hook and adapter, and asserts
exit code 0 in every case. Run it before you push. If it fails, nothing else matters.

## Testing a hook by hand

Always against a throwaway state root. Never against your real one.

```sh
echo '{"hook_event_name":"SessionStart","session_id":"dev","cwd":"'"$PWD"'","source":"startup"}' \
  | AUTOCACHE_HOME=/tmp/ac-dev node hooks/session-start.js
echo "exit: $?"
cat /tmp/ac-dev/logs/events.jsonl
```

```powershell
$env:AUTOCACHE_HOME = "$env:TEMP\ac-dev"
'{"hook_event_name":"SessionStart","session_id":"dev","cwd":"C:\\tmp","source":"startup"}' |
  node hooks/session-start.js
"exit: $LASTEXITCODE"
```

The exit code is 0 even when the hook is broken - that is the design. Debug by
inspecting stdout and the state directory, not the exit code.

## Adding or changing a state file

State files outlive the version that wrote them. A user upgrades and their existing
directory has to keep working.

- Every top-level object carries a `version` integer.
- Readers ignore unknown fields and tolerate missing optional ones.
- Never rename or repurpose an existing field. Add a new one and leave the old one
  readable.
- Never require a migration to keep working. Degrade to "no state" instead.
- Document the schema in [docs/state-format.md](docs/state-format.md) in the same PR.

## Adding output to a hook

Restore output is the product's whole surface area, and it competes for the same
context window as the user's actual work. The bar:

- Silence is the default. A hook that emits something on every invocation becomes
  noise, and noise gets uninstalled.
- Bound the output. Summarize; never paste a transcript.
- Say something the user could not trivially see themselves.

## Commits and pull requests

- Small and single-purpose. One invariant-shaped change per PR.
- Commit messages say what changed and why, in the imperative.
- Fill out the PR template honestly, including the platforms you actually tested on.
  "CI is green" is not a verification of a hook that touches the filesystem.
- Update `CHANGELOG.md` under Unreleased.
- Update `docs/state-format.md` if state changed, and `docs/hooks.md` if any hook
  input, output, or event changed.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## License

Contributions are licensed under the MIT license of this repository. By opening a pull
request you agree to that.
