# Privacy Policy: Autocache for Claude Desktop

Effective 2026-10-11. Applies to the Autocache Claude Desktop extension (`autocache-*.mcpb`)
published by AIWander.

Autocache is a local program. It does not collect, sell or share personal data, has no
account, and contains no analytics, telemetry or crash reporting. In Claude Desktop it runs
only while Desktop runs it and talks only to Desktop over a local pipe (stdio). It makes no
network connections.

**Data collection.** None by AIWander. Autocache stores only what Claude explicitly saves with
its tools: breadcrumb names, targets and steps; checkpoints; handoff notes; reminders; and
short session summaries. Whatever text Claude puts in those records is what is stored.

**Usage and storage.** The records are plain JSON files under `%USERPROFILE%\.autocache\`
(this extension uses `stores\claude-desktop\`). They are read back to Claude only when Claude
calls an Autocache tool. What Claude Desktop then sends to Anthropic as part of your
conversation is governed by Anthropic's privacy policy, not this one.

**Third-party sharing.** None. Nothing is sent to AIWander or anyone else.

**Data retention.** Records stay on your computer until you delete them. Uninstalling the
extension does not delete them; delete `%USERPROFILE%\.autocache\stores\claude-desktop\` to
remove them.

**Contact.** hello@autocache.ai, or https://github.com/josephwander-arch/autocache/issues.
