# Pull request

## What this changes

<!-- One or two sentences. What behavior is different after this merges. -->

## Why

<!-- The problem. Link the issue if there is one: Fixes #123 -->

## How it was verified

<!-- What you actually ran, on what platform. "CI is green" is not a verification. -->

- [ ] `node .github/scripts/check-syntax.cjs`
- [ ] `node .github/scripts/validate-json.cjs`
- [ ] `node .github/scripts/fail-open.cjs`
- [ ] Ran the affected hook by hand and inspected the state it wrote
- Platforms tested:

---

## The non-negotiables

Every box below is a project invariant, not a style preference. A PR that breaks one
does not merge regardless of how useful the feature is.

- [ ] **Fails open.** Every touched hook wraps its body in try/catch and ends every
      path in `process.exit(0)`. It cannot block, deny, crash, or hang a session.
- [ ] **Atomic writes.** Every new state write goes to `<file>.tmp` and is then moved
      into place with `fs.renameSync`. No in-place rewrites.
- [ ] **Zero dependencies.** Node standard library only. No `package.json` dependencies,
      no lockfile, no vendored modules.
- [ ] **Node, not Python.** No `python3` anywhere - it does not reliably resolve on Windows.
- [ ] **Cross-platform.** Paths built with `path.join`. No hardcoded separators. Verified
      on, or reasoned about for, Windows, macOS, and Linux.
- [ ] **State root honored.** `AUTOCACHE_HOME` if set, otherwise `os.homedir()/.autocache`.
      Nothing is written outside that tree.
- [ ] **Quoted plugin root.** Any new hook command quotes `"${CLAUDE_PLUGIN_ROOT}"` -
      Windows plugin paths contain spaces.
- [ ] **No network calls.** None. Telemetry stays off by default.
- [ ] **No emoji in files.** Chat only. Never written into any file in this repository.
- [ ] **No paid capability.** Does not implement, stub, tease, or imply free access to
      extraction, retrieval, index maintenance, knowledge-base writes with propagation,
      consolidation, context budgeting, learning analytics, or eval.
- [ ] **Honest copy.** Does not claim prompt caching, does not claim it makes the model
      smarter, does not claim cross-machine sync.

## State schema changes

<!-- Delete if none. Otherwise: what file, what fields, and how a state directory
     written by the previous version still reads correctly. -->

## Docs

- [ ] `docs/state-format.md` updated if any state file changed
- [ ] `docs/hooks.md` updated if any hook input, output, or event changed
- [ ] `CHANGELOG.md` updated under Unreleased
