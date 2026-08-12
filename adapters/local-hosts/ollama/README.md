# Ollama: inference backend, not this kit's MCP client

Ollama runs and serves local models. Its tool-calling API lets an application
provide function schemas and execute a tool loop, but this AutoCache kit does
not treat that inference API as a host-side MCP server registration surface.
There is therefore no `mcp.json` or AutoCache plugin to install into Ollama.

Use this topology instead:

```text
Ollama model service -> Open WebUI (MCP client) -> AutoCache Streamable HTTP bridge
```

Open WebUI can use Ollama for inference and independently connect to this kit's
MCP endpoint under `Admin Settings > External Tools`. Another MCP-capable host
can play the same client role while using Ollama through its API.

[`open-webui-provider.env.example`](open-webui-provider.env.example) is an Open
WebUI provider setting, not an Ollama plugin template. Use the host/container
address appropriate to the deployment; same-host non-container configurations
commonly use `http://127.0.0.1:11434` instead.

The model still must reliably support tool calling, and the MCP client remains
responsible for displaying or enforcing tool permissions. AutoCache lifecycle
capture remains explicit on these hookless hosts.

Official references:

- [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [Connect Open WebUI to Ollama](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-ollama/)
- [Open WebUI native MCP](https://docs.openwebui.com/features/extensibility/mcp/)
