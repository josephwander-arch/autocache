# Install

Autocache v1 is pure files: hooks, skills, commands, and JSON state. There is no
MCP server, no compiled binary, and no code signing step. Installing is dropping a
directory in the right place.

**Requirements:** Node.js (any currently supported release). Nothing else. Zero npm
dependencies - Node standard library only. Windows, macOS, and Linux.

Autocache does not use Python. `python3` does not reliably resolve on Windows, and a
hook that silently fails because its interpreter is missing is exactly the failure
this project exists to avoid.

---

## Claude Code

Claude Code loads Autocache as a plugin. The plugin registers the hooks, ships the
skills, and adds the slash commands.

```
/plugin marketplace add josephwander-arch/autocache
/plugin install autocache
```

Then restart the session. `SessionStart` runs on the next launch.

Verify:

```
/status
```

You should see the state root, whether a breadcrumb is open, and how many sessions
are on record. If the command is missing, the plugin did not load - check
`/plugin` for the install state before debugging hooks.

### Manual install (no marketplace)

Clone the repository and point Claude Code at the local directory:

```sh
git clone https://github.com/josephwander-arch/autocache.git
```

```
/plugin marketplace add ./autocache
/plugin install autocache
```

The plugin root is substituted into every hook command as `${CLAUDE_PLUGIN_ROOT}`
and is always quoted, because paths contain spaces on Windows.

---

## Codex

Codex has real directories under `~/.codex/` (`skills/`, `hooks/`, `rules/`,
`agents/`, `automations/`, `plugins/`). It does not read the Claude Code plugin
format, so the installer materializes the same behavior into those directories.

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/josephwander-arch/autocache/main/install.sh -o install.sh
less install.sh      # read it before you run it
sh install.sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/josephwander-arch/autocache/main/install.ps1 -OutFile install.ps1
Get-Content ./install.ps1   # read it before you run it
./install.ps1
```

What lands where:

| Path | Contents |
|---|---|
| `~/.codex/skills/autocache-*/SKILL.md` | The same skill bodies shipped to Claude Code |
| `~/.codex/hooks/` | The same Node hook scripts, registered per Codex's hook config |
| `~/.codex/rules/autocache.md` | The always-on behavioral rules |

The hook scripts and the `~/.autocache/` state directory are shared verbatim across
surfaces. That is the point of the design: one state directory, many front ends. A
session started under Claude Code is resumable under Codex.

Uninstall: remove the `autocache-*` skill directories, the Autocache hook entries
from the Codex hook config, and `~/.codex/rules/autocache.md`. Your state under
`~/.autocache/` is untouched unless you delete it yourself.

---

## Grok

**Grok is read-only.** This is a real limitation, stated plainly rather than papered
over: Grok is a skill and prompt surface, not a hook surface. It has no hook events
to fire on and no sanctioned local write path. Grok reads `~/.autocache/` and
narrates what it finds. It does not create sessions, does not append breadcrumb
steps, and does not write checkpoints.

Install: copy the markdown skill directories from `skills/` into your Grok skill
location, the same way you would any other Grok skill set (modeled on the layout in
`C:\CPC\grok-web-skills\` - directories of skill markdown, no hooks).

Use Grok for reading an arc back to yourself, drafting a handoff from existing state,
or reviewing what a session recorded. Do the writing from Claude Code or Codex.

---

## Where state lives

```
~/.autocache/          macOS, Linux
%USERPROFILE%\.autocache\   Windows
```

Resolved with `os.homedir()`. Override with the `AUTOCACHE_HOME` environment
variable - useful for a per-project state root, a test sandbox, or a directory you
sync yourself.

```sh
export AUTOCACHE_HOME="$HOME/work/project-x/.autocache"
```

```powershell
$env:AUTOCACHE_HOME = "C:\work\project-x\.autocache"
```

If `AUTOCACHE_HOME` points somewhere that cannot be created or written, hooks fail
open and silently do nothing. They never block the session, and they never crash it.

---

## Verifying an install

1. Start a session. Do something small.
2. Check that state appeared:

```sh
ls ~/.autocache/sessions
cat ~/.autocache/sessions/index.json
```

```powershell
Get-ChildItem $env:USERPROFILE\.autocache\sessions
Get-Content $env:USERPROFILE\.autocache\sessions\index.json
```

3. End the session, start a new one, and confirm the restore block appears at the top.

If nothing appears, see [faq.md](faq.md) - the usual causes are the plugin not
being enabled, a `AUTOCACHE_HOME` pointing at an unwritable path, or a first session
that recorded nothing worth restoring.

---

## Uninstall

- Claude Code: `/plugin uninstall autocache`
- Codex: remove the installed skills, rules, and hook registrations listed above.
- Grok: delete the copied skill markdown.

Then, if you want the data gone too:

```sh
rm -rf ~/.autocache
```

```powershell
Remove-Item -Recurse -Force $env:USERPROFILE\.autocache
```

That is the complete footprint. Nothing else on your system is modified.
