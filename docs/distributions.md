# AutoCache distributions

AutoCache ships four distributions from one repository. They share the state
format, hook implementation, skills, commands, and agents. A distribution adds
only the loader and event translation its host requires.

| Capability | Claude Code | Codex | Grok Build | Generic local hosts |
|---|---|---|---|---|
| Package entry | `.claude-plugin/` | `.codex-plugin/` | `.grok-plugin/` | `adapters/local-hosts/` |
| Procedures | native plugin skills/commands | plugin skills plus Codex rule/agent adapter | native plugin skills/commands | MCP tool descriptions and host profile |
| Lifecycle capture | native hooks | Codex-owned hook registration | native Grok hooks | explicit MCP calls unless host hooks are added |
| Native workers | Claude owns execution; AutoCache records receipts | Codex owns execution; AutoCache records receipts | Grok owns execution; AutoCache records receipts | host-dependent; bridge does not spawn workers |
| State writes | automatic hooks plus commands | automatic hooks plus CLI/skills | automatic hooks plus commands | explicit MCP tools |
| Shared store | `~/.autocache/stores/claude-code` | `~/.autocache/stores/codex` | `~/.autocache/stores/grok` | configured scope per host |
| Runtime dependencies | Node standard library | Node standard library | Node standard library | official MCP SDK and HTTP package, isolated and locked |

## Why this is not four forks

Four copied implementations would drift the first time a state rule, security fix,
or receipt schema changed. Instead:

1. Core state behavior lives under `hooks/lib/`.
2. Shared human/model procedures live under `skills/`, `commands/`, and `agents/`.
3. Surface manifests point at those shared directories.
4. Adapter tests feed each surface's real event shape into the same core.

The result preserves each runtime's native strengths. AutoCache does not create a
second worker scheduler or message bus. It adds durable resume state, fork-chain
ownership, checkpoints, handoffs, reminders, and worker-result receipts around
the runtime that already executes the work.

## Generic-host target choice

The generic distribution targets three hosts with current, documented MCP client
support:

- LM Studio: local stdio MCP configuration.
- Jan: stdio or Streamable HTTP MCP configuration.
- Open WebUI 0.6.31 or newer: Streamable HTTP MCP endpoint.

Ollama provides models and tool calling, but it is not itself the desktop plugin
loader in this design. Use Ollama behind Open WebUI or another MCP-capable host.

## Proof states

Keep these separate for every distribution:

1. Source found: the manifest and adapter exist in the repository.
2. Installed: the host copied or registered the distribution.
3. Loader-discoverable: the host lists it after a rescan or new session.
4. Invoked: a real lifecycle event or MCP tool call produced bounded state.
5. Activated: the intended hooks/tools are enabled and trusted.

Package validation proves only source shape. It does not prove installation,
discovery, invocation, activation, or policy enforcement.
