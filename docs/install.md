# Install

AutoCache's Claude Code, Codex, and Grok Build distributions are pure files: hooks,
skills, commands, agents, and JSON state. The optional generic local-host
distribution adds a Node MCP bridge; there is no compiled binary or code-signing
step.

**Requirements:** Node.js 20 or newer. The three native coding-agent distributions
use only the Node standard library. The optional MCP bridge keeps its official SDK
dependencies isolated in its own locked package. Windows, macOS, and Linux.

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

Grok Build loads AutoCache as a native plugin with skills, commands, agents, and
lifecycle hooks. It sends camelCase event fields; the adapter normalizes only the
top-level envelope and routes the event to the same hook implementation used by
Claude Code and Codex.

Install directly from the repository:

```sh
grok plugin install josephwander-arch/autocache --trust
```

Then reload plugins or start a new session. Verify source shape with
`grok plugin validate .` and loader discovery with `grok inspect --json`. A real
new-session event is required to prove invocation. Trust is separate from enablement;
without trust, executable hooks remain blocked.

This repository is the plugin source, not a Grok marketplace index. A future
marketplace should live in a separate index repository and point at an exact
AutoCache commit; a repo-root local marketplace entry would resolve back to an
empty plugin path.

Plain grok.com chat is not Grok Build. Without local plugin and filesystem access it
can read a pasted summary but cannot run this distribution.

---

## Generic local-model hosts

One MCP bridge serves three supported host profiles:

| Host | Transport | Profile |
|---|---|---|
| LM Studio | stdio | `adapters/local-hosts/lm-studio/` |
| Jan | stdio or Streamable HTTP | `adapters/local-hosts/jan/` |
| Open WebUI 0.6.31+ | Streamable HTTP | `adapters/local-hosts/open-webui/` |
| Claude Desktop (Windows) | MCPB extension, stdio | `adapters/local-hosts/mcpb/` |

Install the bridge's pinned dependencies:

```sh
cd adapters/local-hosts/mcp-server
npm ci --ignore-scripts
```

Then copy the selected host's configuration template and replace its repository
path. The MCP bridge exposes explicit resume, breadcrumb, checkpoint, handoff, and
reminder tools. It does not claim automatic lifecycle capture on a host that does
not expose lifecycle events.

Ollama is supported as a model backend, not as a fourth plugin client. Use it behind
Open WebUI or another MCP-capable host; see `adapters/local-hosts/ollama/`.

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
- Grok Build: `grok plugin uninstall autocache --confirm`
- Local-model hosts: remove the MCP server entry; optionally remove
  `adapters/local-hosts/mcp-server/node_modules/`.

Then, if you want the data gone too:

```sh
rm -rf ~/.autocache
```

```powershell
Remove-Item -Recurse -Force $env:USERPROFILE\.autocache
```

That is the complete footprint. Nothing else on your system is modified.
