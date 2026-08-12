# Jan

Jan is the second stdio host profile for the same bridge.

1. Install the bridge dependencies with `npm ci` in `../mcp-server`.
2. Open Jan `Settings > MCP Servers` and choose `Add MCP Server`.
3. Select `STDIO`.
4. Copy the command, args, and environment fields from
   [`mcp-server-fields.example.json`](mcp-server-fields.example.json), replacing
   all placeholders with absolute paths.
5. Keep Jan's normal per-tool permission prompts during initial validation.
6. Enable the entry only when you are ready to start its child process.

The JSON file is a field worksheet, not a claimed Jan import format. Jan's
official flow is UI-based and exposes Transport, Command/URL, Args, and Env
fields. The template does not edit Jan settings or enable the server.

Use the safe default `AUTOCACHE_STORE_SCOPE=jan` while another host may run.
Reusing LM Studio's or Open WebUI's scope is a deliberate single-writer handoff
only: stop the prior process and verify it is gone before Jan starts. AutoCache
does not transactionally serialize concurrent cross-process JSON updates.

Jan does not supply AutoCache lifecycle events through this connection. Every
status, resume, checkpoint, breadcrumb, handoff, or reminder action is an
explicit MCP tool call.

Official reference: [Jan MCP Servers](https://www.jan.ai/docs/desktop/integrations/mcp-servers).
