# LM Studio

LM Studio is the stdio host profile for this kit. Its current official MCP host
format is Cursor-style `mcp.json`.

1. Install the bridge dependencies with `npm ci` in `../mcp-server`.
2. In LM Studio, open the Program sidebar and choose `Install > Edit mcp.json`.
3. Merge the `autocache-local` entry from [`mcp.json.example`](mcp.json.example)
   into the existing `mcpServers` object. Do not replace unrelated entries.
4. Replace every placeholder with an absolute path. Prefer an absolute Node
   executable path so LM Studio does not depend on a GUI process's `PATH`.
5. Keep the safe default `AUTOCACHE_STORE_SCOPE=lm-studio` while another local
   host may run. Reusing another host's scope is a deliberate handoff only:
   stop that writer first and verify it is no longer running.
6. Save, review the tool list, and keep per-call confirmation enabled while
   validating the bridge.

LM Studio reloads configured MCP child processes when its live configuration is
saved. That is an activation action and is deliberately not performed by this
kit. The template itself is inert.

The bridge does not add LM Studio lifecycle hooks. Call `autocache_resume` at
the start of a useful arc and call checkpoint/breadcrumb tools explicitly.
Do not run two host processes against one store scope; AutoCache permits one
live owner and does not transactionally serialize cross-process JSON updates.

Official reference: [Use MCP Servers in LM Studio](https://lmstudio.ai/docs/app/mcp).
