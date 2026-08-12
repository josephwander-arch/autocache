# Open WebUI

Open WebUI 0.6.31 or newer natively connects to MCP Streamable HTTP servers.
This profile runs the same AutoCache bridge as a local HTTP process.

## Start boundary

After installing dependencies in `../mcp-server`, an operator can start the
bridge from that directory with:

```powershell
node src/cli.js http
```

This repository does not create a service, scheduled task, container, startup
entry, or persistent listener. The command above is documentation, not an
activation performed by the kit.

## Same-host setup

1. Copy [`server.env.example`](server.env.example) values into the environment
   of the bridge process.
2. Keep `AUTOCACHE_MCP_HOST=127.0.0.1` when Open WebUI can reach host loopback.
3. In Open WebUI, open `Admin Settings > External Tools`, add a server, and set
   its type to `MCP (Streamable HTTP)`.
4. Use `http://127.0.0.1:3210/mcp`, plus Bearer auth if a token is set.

## Open WebUI in Docker

A container cannot normally reach the host's loopback interface. A typical
host URL is `http://host.docker.internal:3210/mcp`; Linux deployments may also
need an explicit host-gateway mapping.

To bind the bridge beyond loopback, all of these are required:

- set `AUTOCACHE_MCP_HOST` to the narrowest reachable interface (or `0.0.0.0`
  only when necessary);
- set a long random `AUTOCACHE_MCP_TOKEN` and configure the same Bearer token in
  Open WebUI;
- set `AUTOCACHE_MCP_ALLOWED_HOSTS` to the actual Host names Open WebUI uses;
- set `AUTOCACHE_MCP_ALLOWED_ORIGINS` to the exact browser-facing Open WebUI
  origins that may appear in an Origin header;
- restrict the port with the host firewall.

The bridge refuses non-loopback startup without the token, Host allowlist, and
Origin allowlist. Host names and browser origins are separate policy inputs.
Do not expose it to the public internet.

[`external-tool-fields.example.json`](external-tool-fields.example.json) is a
UI worksheet, not a claimed Open WebUI import payload. Adding MCP servers is an
admin action. Select MCP Streamable HTTP, not OpenAPI.

Open WebUI supplies MCP connectivity, not AutoCache lifecycle hooks. Explicitly
call resume/checkpoint/breadcrumb tools; do not claim automatic capture.
Keep `AUTOCACHE_STORE_SCOPE=open-webui` while another host may run. A shared
scope is safe only as a sequential handoff after the prior writer has stopped.

Official reference: [Open WebUI Model Context Protocol](https://docs.openwebui.com/features/extensibility/mcp/).
