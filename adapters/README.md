# AutoCache adapters

AutoCache has one continuity core and four distributions. The adapters translate
surface conventions; they do not copy or fork the state engine.

```
~/.autocache/                 shared local state contract
hooks/*.js                    shared lifecycle implementation
skills/*/SKILL.md             shared skills
commands/*.md                 shared commands
agents/*.md                   shared agents
```

| Distribution | Native integration | Adapter responsibility |
|---|---|---|
| Claude Code | plugin, hooks, skills, commands, agents | Claude manifest and Claude-only native-team events |
| Codex | plugin skills plus adapter-installed hooks/rules/agent | materialize Codex-owned runtime files until plugin hooks are proven live |
| Grok Build | plugin, hooks, skills, commands, agents | Grok manifest, supported-event map, camelCase envelope normalization |
| Local-model hosts | MCP tools | one MCP bridge with LM Studio, Jan, and Open WebUI profiles |

Ollama is covered by the local-host distribution as a model engine. Ollama itself
is not the plugin client; run it behind Open WebUI, LM Studio, Jan, or another
MCP-capable host.

Claude Code, Codex, and Grok use native lifecycle events. The generic MCP bridge
cannot invent events a host does not expose, so its start, checkpoint, and close
actions are explicit tools. That difference is disclosed in each host profile.

## Drift rule

An adapter may add only a manifest, registration map, installer, transport, or
field translation required by its surface. Shared state logic stays under `hooks/`,
and shared procedure stays under `skills/`, `commands/`, and `agents/`. A surface
fix that belongs in the core is made once in the core and regression-tested from
every affected adapter.

## Entry points

- Claude Code: `.claude-plugin/`
- Codex: `.codex-plugin/` plus `adapters/codex/install.js`
- Grok Build: `.grok-plugin/` plus `adapters/grok/hooks/hooks.json`
- Local hosts: `adapters/local-hosts/`

See [the installation guide](../docs/install.md) for exact commands and proof
states.
