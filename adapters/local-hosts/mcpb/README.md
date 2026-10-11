# Autocache for Claude Desktop

Autocache is a Claude Desktop extension that gives Claude a small notebook on your own
computer, so a long piece of work can survive the end of a chat. Claude can record what it is
working on (a "breadcrumb" with steps), save a checkpoint, write a handoff note for the next
chat, and set reminders. In a new chat, Claude reads that back and picks up where it stopped.

Publisher: AIWander. Product page: https://autocache.ai. Source:
https://github.com/josephwander-arch/autocache (MIT). Version: 0.5.0.

**Unsigned build.** Until AIWander signs a release, this file carries no publisher signature,
and Claude Desktop will say so when you install. Check the SHA-256 hash (below) first.

## How it works, in one paragraph

Claude Desktop chats have no automatic hooks, so Autocache records only what Claude explicitly
saves with its tools. Nothing is captured in the background. Everything is plain JSON in a
folder in your user profile. There is no account, no cloud copy and no network access.

## Requirements

- Windows 10 or Windows 11 (ARM64 or x64; the same bundle works on both).
- Claude Desktop for Windows, version 0.10.0 or newer.
- Node.js: Claude Desktop includes its own Node.js runtime for extensions, so you normally
  install nothing else. If you turned off Claude Desktop's built-in Node.js, you need Node.js
  20 or newer on PATH (`node -v`).

## Install

1. Download `autocache-0.5.0-win.mcpb` and `SHA256SUMS.txt` from the release page.
2. Optional but recommended for unsigned builds: in PowerShell, run
   `Get-FileHash .\autocache-0.5.0-win.mcpb -Algorithm SHA256` and check that the hash matches
   the line in `SHA256SUMS.txt`.
3. Install it in any one of these ways:
   - double-click the `.mcpb` file, or
   - drag it into the Claude Desktop window, or
   - in Claude Desktop open **Settings > Extensions > Advanced settings > Install Extension...**
     and choose the file.
4. Review the name, publisher and tool list, then click **Install**.

If Windows SmartScreen warns about the download, that is because the file is unsigned. Keep it
only if the hash matched in step 2.

## First-run check

Start a new chat and ask "run autocache_status". Claude should report the store location
(`...\.autocache\stores\claude-desktop`) and zero or more breadcrumbs, checkpoints and
reminders. Then ask "start a breadcrumb called test with two steps", then "complete it". If both
work, the extension is writing to disk.

## Tools (10)

| Tool | What it does |
|---|---|
| autocache_status | Store health and counts |
| autocache_resume | Last session summary, active breadcrumb, latest checkpoint, due reminders |
| autocache_breadcrumb_start | Start one tracked piece of work (refuses if one is already active) |
| autocache_breadcrumb_step | Record one finished step |
| autocache_breadcrumb_complete | Close the active breadcrumb with an outcome |
| autocache_breadcrumb_abort | Abandon the active breadcrumb with a reason, keeping the record |
| autocache_checkpoint | Save a snapshot of where the work stands |
| autocache_handoff | Save a note for the next chat (stays on this computer) |
| autocache_reminders_list | List reminders |
| autocache_reminders_add | Add a reminder, optionally with a due time or a repeat |

The companion skills (`autocache-*.zip` on the release page) tell Claude when to use these
tools, for example to call `autocache_resume` at the start of continuing work. Upload them in
Claude under **Settings > Capabilities > Skills**; they are optional but recommended, because
without them Claude only uses Autocache when you ask.

## Privacy Policy

Autocache collects nothing and sends nothing. It has no account, no analytics, no telemetry
and no network access; in Claude Desktop it talks only to Desktop over a local pipe. It stores
what Claude saves with its tools (breadcrumb names and steps, checkpoints, handoff notes,
reminders, short session summaries) as JSON files under `%USERPROFILE%\.autocache\` on this
computer. Results go back only to Claude through Claude Desktop, where they become part of
your conversation under Anthropic's terms. Nothing is shared with AIWander or anyone else.
Files stay until you delete them; uninstalling does not delete them. The full policy is in
[PRIVACY.md](PRIVACY.md). Contact: hello@autocache.ai.

## Uninstall

In Claude Desktop open **Settings > Extensions**, choose **Autocache (AIWander)** and click
**Uninstall**. That removes the program.

What stays behind:

- Your saved history in `%USERPROFILE%\.autocache\stores\claude-desktop\`. Delete that
  folder to remove it. Other folders under `stores\` belong to other apps that use Autocache
  (for example Claude Code or Codex); leave them unless you mean to remove those too.
- Claude Desktop's own log of the extension, under `%APPDATA%\Claude\logs\`.
- Uploaded skills stay in your Claude account until you delete them under
  **Settings > Capabilities > Skills**.

## Troubleshooting

- **The tools do not appear.** Check **Settings > Extensions** that Autocache is enabled, then
  start a new chat. If it shows an error, open its log from that page or in
  `%APPDATA%\Claude\logs\`.
- **"node" not found.** Claude Desktop's built-in Node.js is turned off and Node.js is not on
  PATH. Turn the built-in runtime back on in Claude Desktop's extension settings, or install
  Node.js 20 or newer.
- **"breadcrumb already active".** Only one breadcrumb can be open at a time. Ask Claude to
  complete or abort the current one first.
- **Two copies of every tool.** Autocache is also configured another way (for example by an
  installer that edited `claude_desktop_config.json`). Remove one of the two.
- **SmartScreen or "unknown publisher".** Expected for unsigned builds. Verify the hash first.

## Known limits

- Nothing is saved automatically. If a chat ends before Claude saves a checkpoint or handoff,
  that context is gone.
- This extension has 10 of the full Autocache operations. Breadcrumb add, decide, adopt, fork
  and retire, and reminder complete and delete, exist only in the hook-based Autocache plugin
  for coding tools.
- Tools run only in Claude Desktop on this computer; claude.ai in a browser and the mobile apps
  cannot reach them.
- Windows only in this release. The server is plain Node.js, so macOS should work, but it is
  untested and not declared.

## Support

https://github.com/josephwander-arch/autocache/issues or hello@autocache.ai.

## Building from source

From a clone of the repository, with Node.js 20+, npm and the mcpb CLI
(`npm install -g @anthropic-ai/mcpb`):

```powershell
pwsh -NoProfile -File adapters\local-hosts\mcpb\pack.ps1 -Clean
```

Output: `adapters\local-hosts\mcpb\dist\autocache-0.5.0-win.mcpb` and `SHA256SUMS.txt`; build
report in `adapters\local-hosts\mcpb\build\pack-report.json`. Signing: [SIGNING.md](SIGNING.md).
