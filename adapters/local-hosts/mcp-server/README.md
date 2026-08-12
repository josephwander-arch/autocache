# AutoCache local-host MCP bridge

This package is a Node 20+ ESM MCP server built with the stable v2 official
TypeScript SDK packages: `@modelcontextprotocol/server` and
`@modelcontextprotocol/node`. The official `@modelcontextprotocol/client` is a
development-only dependency for transport tests. This is an optional adapter
dependency island; the AutoCache core remains dependency-free.

Upstream reference: [MCP TypeScript SDK v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md).

## Entry points

```powershell
# LM Studio and Jan
node src/cli.js stdio

# Open WebUI
node src/cli.js http
```

Stdio writes protocol messages to stdout and diagnostics to stderr. HTTP binds
to `127.0.0.1:3210` by default and exposes:

- `POST /mcp` for MCP Streamable HTTP;
- `GET /health` for a non-sensitive health response.

The Streamable HTTP implementation is stateless at the protocol transport
layer. AutoCache continuity remains durable because every request reads or
writes the same scoped local JSON store.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AUTOCACHE_HOME` | `~/.autocache` | Base AutoCache state directory |
| `AUTOCACHE_STORE_SCOPE` | actor name, else `local-mcp` | Host-isolated store below `stores/` |
| `AUTOCACHE_MCP_ACTOR` | `local-mcp` | Provenance label written to records |
| `AUTOCACHE_WORKSPACE` | process working directory | Workspace used for Git metadata |
| `AUTOCACHE_MCP_HOST` | `127.0.0.1` | HTTP bind host |
| `AUTOCACHE_MCP_PORT` | `3210` | HTTP bind port |
| `AUTOCACHE_MCP_TOKEN` | empty | Optional bearer token; mandatory off loopback |
| `AUTOCACHE_MCP_ALLOWED_HOSTS` | empty | Comma-separated Host allowlist; mandatory off loopback |
| `AUTOCACHE_MCP_ALLOWED_ORIGINS` | empty | Comma-separated absolute browser origins; mandatory off loopback |

`AUTOCACHE_STORE_SCOPE` is mapped to the core's compatibility variable
`AUTOCACHE_SCOPE` before `hooks/lib/store.js` loads.

## HTTP safety boundary

Loopback is the default. Binding to any non-loopback address fails closed unless
all three conditions hold:

1. `AUTOCACHE_MCP_TOKEN` contains at least 16 characters; and
2. `AUTOCACHE_MCP_ALLOWED_HOSTS` contains at least one allowed HTTP Host name;
   and
3. `AUTOCACHE_MCP_ALLOWED_ORIGINS` contains at least one absolute `http://` or
   `https://` browser origin.

Host and Origin policy are intentionally separate. The v2 Node SDK Origin
guard compares the hostname parsed from the incoming Origin header; the bridge
validates origin-shaped configuration and passes the resulting hostname to that
guard. Requests without an Origin header, such as normal backend MCP clients,
remain eligible after Host and bearer checks.

Open WebUI running in Docker commonly needs a non-loopback bind from the host.
Use a host firewall, a bearer token, and the narrowest Host and Origin
allowlists. Do not publish this state-writing MCP endpoint to the public
internet.

Use one store scope per concurrently running host. A shared scope is supported
only for a deliberate single-writer handoff after the previous process has
stopped; the JSON store does not serialize cross-process read-modify-write
cycles.

## Tools

| Tool | Effect |
|---|---|
| `autocache_status` | Bounded store health and counts |
| `autocache_resume` | Last summary, active breadcrumb, checkpoint, due reminders |
| `autocache_breadcrumb_start` | Explicit start through the shared breadcrumb CLI |
| `autocache_breadcrumb_step` | Explicit milestone through the shared CLI |
| `autocache_breadcrumb_complete` | Explicit durable completion through the shared CLI |
| `autocache_breadcrumb_abort` | Explicit durable abort through the shared CLI |
| `autocache_checkpoint` | Atomic local checkpoint write |
| `autocache_handoff` | Atomic local packet write; no delivery or ownership transfer |
| `autocache_reminders_list` | Bounded reminder read |
| `autocache_reminders_add` | Atomic reminder add |

Tool output is capped. Input schemas cap string and list sizes. Breadcrumb
mutations use argument-array process spawning rather than a shell, preserve the
shared CLI's active-record and frozen-fork checks, and time out after ten
seconds. A malformed existing reminder file is never overwritten.

## Tests

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:stdio
npm run test:http
```

The suite instantiates the official SDK `Client` with both
`StdioClientTransport` and `StreamableHTTPClientTransport`. Test state uses
temporary `AUTOCACHE_HOME` directories, and the HTTP test leaves no listener
running.

## Lifecycle limitation

This bridge provides tools, not host hooks. Tool discovery and successful calls
prove MCP connectivity only. They do not prove automatic session-start,
tool-use, stop, crash, or compaction capture.
