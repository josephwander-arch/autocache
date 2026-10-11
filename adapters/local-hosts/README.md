# AutoCache for local model hosts

This is one generic AutoCache continuity kit for local model hosts that can act
as MCP clients. It reuses the repository's shared `hooks/lib/store.js` state
layer and breadcrumb CLI; it does not copy or fork AutoCache's core.

## Supported host lanes

| Host | Role | Transport in this kit | Configuration |
|---|---|---|---|
| LM Studio | MCP-capable desktop host | stdio | [`lm-studio/`](lm-studio/) |
| Jan | MCP-capable desktop host | stdio | [`jan/`](jan/) |
| Open WebUI 0.6.31+ | MCP-capable web host | Streamable HTTP | [`open-webui/`](open-webui/) |
| Claude Desktop | MCP-capable desktop host (MCPB extension) | stdio | [`mcpb/`](mcpb/) |
| Ollama | Inference backend, not the MCP client for this kit | none | [`ollama/`](ollama/) |

LM Studio and Jan spawn the same Node process over stdio. Open WebUI reaches the
same server code over Streamable HTTP. All three use the same core and state
format, but the templates default to separate `lm-studio`, `jan`, and
`open-webui` store scopes. AutoCache permits one live owner per scoped store,
and its cross-process JSON updates are not transactionally serialized.

Point two hosts at the same scope only for a deliberate, non-concurrent handoff:
stop or disable the old writer, verify it is no longer running, then start the
new host against that scope. Never run concurrent writers against one scope.

Ollama is intentionally separate. It can supply the model behind Open WebUI or
another MCP-capable host, but this kit does not pretend that an Ollama model API
configuration installs an MCP server.

## What the bridge exposes

The MCP bridge exposes only explicit, bounded continuity operations:

- status and resume;
- breadcrumb start, step, complete, and abort;
- checkpoint and local handoff packet creation;
- reminder list and add.

These hosts do not load AutoCache's native lifecycle hooks. No session start,
prompt, tool call, stop, crash, or compaction event is captured automatically.
The model or operator must call the tools at the appropriate time. A handoff
tool call saves a local packet only; it does not send a message or transfer
ownership.

## Install the optional bridge dependencies

Node 20 or newer is required. From `adapters/local-hosts/mcp-server`:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

No repository-wide dependency is added. `package.json`, `package-lock.json`, and
`node_modules` are isolated under `mcp-server/`.

## State contract

The bridge maps `AUTOCACHE_STORE_SCOPE` to the shared core's
`AUTOCACHE_SCOPE` before loading `store.js`. State resolves to:

```text
<AUTOCACHE_HOME>/stores/<AUTOCACHE_STORE_SCOPE>/
```

The base default is `~/.autocache`. When `AUTOCACHE_STORE_SCOPE` is omitted, the
bridge uses `AUTOCACHE_MCP_ACTOR` (or `local-mcp`) as the scope. The supplied
host templates set explicit per-host scopes. The bridge also accepts
`AUTOCACHE_WORKSPACE` for checkpoint and handoff Git metadata.

## Upstream host references

- [LM Studio MCP host documentation](https://lmstudio.ai/docs/app/mcp)
- [Jan MCP server documentation](https://www.jan.ai/docs/desktop/integrations/mcp-servers)
- [Open WebUI native MCP documentation](https://docs.openwebui.com/features/extensibility/mcp/)
- [Open WebUI with Ollama](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-ollama/)
- [Ollama tool-calling API](https://docs.ollama.com/capabilities/tool-calling)

## Non-actions

This directory is distribution source only. Its templates do not edit a live
host, enable a server, open a firewall, start a persistent process, install a
plugin, or restart anything.
