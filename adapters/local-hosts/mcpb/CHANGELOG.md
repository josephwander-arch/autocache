# Changelog: Autocache Claude Desktop extension

The extension version follows the Autocache plugin version (.claude-plugin/plugin.json). The
bundled server is the local-host MCP server (`@autocache/local-host-mcp` 0.1.0).

## 0.5.0 (2026-10-11, pre-release, unsigned)

First Claude Desktop extension (MCPB) packaging of Autocache.

- 10 tools over stdio: status, resume, breadcrumb start/step/complete/abort, checkpoint,
  handoff, reminders list/add; listed in `manifest.json` and checked against the live
  `tools/list` at pack time.
- Store scope `claude-desktop` under `~/.autocache/stores/`, separate from the Claude Code and
  Codex stores.
- Runs on Claude Desktop's built-in Node.js (Node 20 or newer if the built-in runtime is off).
- Manifest metadata for distribution: icon, homepage, documentation, support, repository,
  license (MIT), keywords, privacy policy, compatibility (Windows, Claude Desktop 0.10.0 or
  newer).
- Bundle includes LICENSE, README (install, uninstall, troubleshooting) and PRIVACY.md.
- `pack.ps1` stages the server plus the two core files it loads at runtime, installs production
  dependencies only, checks, packs, unpack-tests and hashes the bundle.

Known limits: explicit capture only; subset of the full Autocache operations; Windows only;
unsigned.
