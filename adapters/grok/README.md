# AutoCache adapter: Grok Build

Grok Build has native plugins, lifecycle hooks, skills, commands, agents, and
subagents. This adapter uses that machinery directly. Grok still owns worker
creation, messaging, permissions, cancellation, and execution; AutoCache records
the durable continuity envelope around it.

This replaces the former read-only prompt adapter. The old four duplicated Grok
skill copies were removed because `.grok-plugin/plugin.json` points to the same
root `skills/`, `commands/`, and `agents/` used by the other distributions.

## What is Grok-specific

- `.grok-plugin/plugin.json` declares the shared component paths and this adapter's
  hook registration file.
- `hooks/hooks.json` registers only Grok-supported AutoCache events and tags every
  invocation `--surface=grok`.
- Grok sends camelCase hook fields such as `sessionId`, `toolName`,
  `subagentId`, and `lastAssistantMessage`. `hooks/lib/store.js` copies those
  top-level fields into the shared snake_case contract without changing nested
  tool input.
- Grok child tool events identify the child session but omit its parent. AutoCache
  binds the child to one active start receipt with a bounded lookup. An unknown or
  ambiguous parent is isolated under `workers/unknown-parent/`; it never mutates
  the lead breadcrumb.
- Claude-only `TaskCreated`, `TaskCompleted`, and `TeammateIdle` events are not
  registered for Grok.

## Install from the private GitHub repository

Your Git credentials must already have access to the private repository.

```sh
grok plugin install josephwander-arch/autocache --trust
```

The plugin is disabled until enabled, and executable components remain blocked
until trusted. After installation, reload the Plugins tab or start a new session.

This repository is the plugin source, not a Grok marketplace index. If a catalog
is added later, keep it in a separate index repository and point its remote entry
at an exact AutoCache commit. Do not add a repo-root local marketplace entry: its
plugin path is empty and Grok refuses to install it.

## Verify without installing

From a checkout:

```sh
grok plugin validate .
```

Validation proves the package shape. After installation and a plugin reload or new
session, run `grok inspect --json` from a target project; that command proves loader
discovery and does not accept a `--plugin-dir` argument. A real new-session event is
still required to prove invocation; a deliberate blocking probe would be required
to prove enforcement. AutoCache hooks are continuity observers and fail open, so
they do not claim policy enforcement.

## Web Grok is different

This adapter is for Grok Build, the local coding-agent runtime. A plain grok.com
chat without local plugin/filesystem access can still read a pasted AutoCache
summary, but it cannot run this plugin or write local state.
