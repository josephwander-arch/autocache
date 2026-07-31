# Autocache adapters

Autocache is one state directory with many front ends.

```
~/.autocache/          <- the state. Shared verbatim by every surface.
hooks/*.js             <- the Node hook scripts. Shared verbatim by every hook surface.
skills/*/SKILL.md      <- the skill bodies. Shared verbatim by every skill surface.
```

An adapter never forks that shared material. An adapter only answers one question:
**where does this surface expect these files to live, and how does it get told to run them?**

| Adapter | Surface kind | Writes state? | Materializes into |
|---|---|---|---|
| (none needed) | Claude Code | yes, via hooks | the plugin directory itself, loaded by `/plugin` |
| `codex/` | Codex - real hook + skill directories | yes, via hooks | `~/.codex/skills`, `~/.codex/hooks`, `~/.codex/rules`, `~/.codex/agents` |
| `grok/` | Grok - prompt/skill surface only | **no** | pasted or uploaded skill markdown |

Because the hooks and the state layout are identical across adapters, a work arc
started in Claude Code is resumable in Codex, and Grok can narrate that same arc
without any of the three knowing about each other.

Grok is the exception that has to be stated out loud rather than discovered:
Grok **reads and narrates, it never writes**. See `grok/README.md`.

## Installing

From the repository root:

```sh
./install.sh          # POSIX: macOS, Linux, Git Bash / WSL on Windows
```

```powershell
.\install.ps1         # Windows PowerShell / PowerShell 7+
```

Both detect which surfaces are present, install into each, and print a per-surface
result table. Both are idempotent and neither ever overwrites existing state under
`~/.autocache/`.

To drive a single adapter directly:

```sh
node adapters/codex/install.js            # install into ~/.codex
node adapters/codex/install.js --dry-run  # show what would change, write nothing
node adapters/codex/install.js --uninstall
```
