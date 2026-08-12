<#
.SYNOPSIS
  Autocache installer for Windows PowerShell and PowerShell 7+.

.DESCRIPTION
  Detects which AI surfaces are present on this machine, installs into each,
  and prints a per-surface result table.

    - idempotent: running it twice changes nothing the second time
    - it never overwrites existing state under ~/.autocache
    - it exits non-zero only on a genuine failure

.PARAMETER DryRun
  Print the plan, write nothing.

.PARAMETER Link
  Symlink hooks and skills instead of copying (developer mode). Windows refuses
  symlinks without Developer Mode or elevation; the adapter falls back to copying.

.PARAMETER Uninstall
  Remove what was installed. State under ~/.autocache is kept.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -DryRun
  .\install.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Link,
    [switch]$Uninstall,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$Version = '0.3.0'
$rows = New-Object System.Collections.ArrayList
$failures = 0

function Add-Row {
    param([string]$Surface, [string]$Detected, [string]$Result, [string]$Detail)
    [void]$rows.Add([PSCustomObject]@{
        SURFACE  = $Surface
        DETECTED = $Detected
        RESULT   = $Result
        DETAIL   = $Detail
    })
    if ($Result -eq 'FAILED') { $script:failures++ }
}

function Say {
    param([string]$Text = '')
    if (-not $Quiet) { Write-Host $Text }
}

# ------------------------------------------------------------------ locations

$RepoRoot  = Split-Path -Parent $MyInvocation.MyCommand.Path
$UserHome  = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$StateRoot = if ($env:AUTOCACHE_HOME) { $env:AUTOCACHE_HOME } else { Join-Path $UserHome '.autocache' }
$CodexDir  = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $UserHome '.codex' }
$ClaudeDir = Join-Path $UserHome '.claude'

Say "Autocache installer v$Version"
if ($DryRun) { Say '  DRY RUN - nothing will be written' }
Say "  repository : $RepoRoot"
Say "  state root : $StateRoot (shared by every surface, never overwritten)"

# ------------------------------------------------------------------ preflight

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error 'FAILED: node is required and was not found on PATH.'
    Write-Host  'Autocache hooks run under plain node with zero npm dependencies.'
    Write-Host  'Install Node.js (https://nodejs.org) and run this again.'
    exit 1
}
Say ("  node       : " + (& node --version 2>$null))

$repoHooks = Join-Path $RepoRoot 'hooks'
if (-not (Test-Path -LiteralPath $repoHooks) -and -not $Uninstall) {
    Write-Error "FAILED: $repoHooks not found - this does not look like an Autocache checkout."
    exit 1
}

# The state root is created empty if absent. Existing state is never touched.
if (Test-Path -LiteralPath $StateRoot) {
    Say '  state      : existing state found, left untouched'
} elseif ($DryRun -or $Uninstall) {
    Say "  state      : would create $StateRoot"
} else {
    try {
        New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
        Say "  state      : created $StateRoot"
    } catch {
        Say "  state      : could not create $StateRoot - $($_.Exception.Message)"
    }
}
Say ''

$nodeArgs = @()
if ($DryRun)    { $nodeArgs += '--dry-run' }
if ($Link)      { $nodeArgs += '--link' }
if ($Uninstall) { $nodeArgs += '--uninstall' }

# --------------------------------------------------------------- Claude Code

$claudePresent = (Test-Path -LiteralPath $ClaudeDir) -or
                 [bool](Get-Command claude -ErrorAction SilentlyContinue)
$pluginJson = Join-Path (Join-Path $RepoRoot '.claude-plugin') 'plugin.json'

if ($claudePresent) {
    if (Test-Path -LiteralPath $pluginJson) {
        if ($Uninstall) {
            Add-Row 'claude-code' 'yes' 'manual' 'run: /plugin uninstall autocache'
            Say 'Claude Code: remove the plugin from inside Claude Code:'
            Say '    /plugin uninstall autocache'
        } else {
            Add-Row 'claude-code' 'yes' 'manual' 'one command, inside Claude Code'
            Say 'Claude Code: Autocache is a plugin, so Claude Code installs it itself.'
            Say '  Run this inside Claude Code, from any session:'
            Say "    /plugin marketplace add $RepoRoot"
            Say '    /plugin install autocache'
            Say '  (or /plugin marketplace add josephwander-arch/autocache to take it from GitHub)'
            Say '  This installer deliberately does not hand-edit the Claude Code plugin'
            Say '  directory - the harness owns it, and writing it behind its back is how'
            Say '  plugin installs get corrupted.'
        }
    } else {
        Add-Row 'claude-code' 'yes' 'skipped' 'no .claude-plugin/plugin.json in checkout'
    }
} else {
    Add-Row 'claude-code' 'no' 'skipped' 'no ~/.claude and no claude on PATH'
}
Say ''

# ---------------------------------------------------------------------- Codex

$codexPresent = (Test-Path -LiteralPath $CodexDir) -or
                [bool](Get-Command codex -ErrorAction SilentlyContinue)
$codexInstaller = Join-Path (Join-Path (Join-Path $RepoRoot 'adapters') 'codex') 'install.js'

if ($codexPresent) {
    if (Test-Path -LiteralPath $codexInstaller) {
        Say "Codex: materializing skills, hooks and rules into $CodexDir"
        $output = & node $codexInstaller "--codex-home=$CodexDir" "--repo=$RepoRoot" @nodeArgs 2>&1
        $rc = $LASTEXITCODE
        $changed = $null
        foreach ($line in $output) {
            $text = [string]$line
            if ($text -match '^AUTOCACHE_RESULT changed=(\d+)') {
                $changed = [int]$Matches[1]
            } elseif (-not $Quiet) {
                Write-Host $text
            }
        }
        if ($rc -ne 0) {
            Add-Row 'codex' 'yes' 'FAILED' 'see the codex adapter output above'
        } elseif ($Uninstall) {
            Add-Row 'codex' 'yes' 'removed' "$CodexDir (state kept)"
        } elseif ($DryRun) {
            Add-Row 'codex' 'yes' 'planned' $CodexDir
        } elseif ($changed -eq 0) {
            Add-Row 'codex' 'yes' 'unchanged' "$CodexDir (already current)"
        } else {
            Add-Row 'codex' 'yes' 'installed' "$CodexDir - restart Codex"
        }
    } else {
        Add-Row 'codex' 'yes' 'FAILED' 'adapters/codex/install.js is missing'
    }
} else {
    Add-Row 'codex' 'no' 'skipped' "no $CodexDir and no codex on PATH"
}
Say ''

# ----------------------------------------------------------------------- Grok

# Grok Build consumes AutoCache as a native plugin (.grok-plugin/plugin.json);
# nothing is copied into ~/.grok by this script. The only Grok work left here
# is removing skills installed by the retired pre-0.5.0 read-only flow.
$legacyGrokSkills = @('autocache-handoff', 'autocache-resume', 'autocache-state-reference', 'autocache-status')

$grokDest = $env:AUTOCACHE_GROK_DIR
if (-not $grokDest) {
    $candidate = Join-Path (Join-Path $UserHome '.grok') 'skills'
    if (Test-Path -LiteralPath $candidate) { $grokDest = $candidate }
}

if ($Uninstall) {
    if ($grokDest) {
        $grokRemoved = 0
        $grokFailed  = $false
        foreach ($name in $legacyGrokSkills) {
            $dest = Join-Path $grokDest $name
            if (Test-Path -LiteralPath $dest) {
                try {
                    if ($DryRun) {
                        Say "  would remove $dest"
                    } else {
                        Remove-Item -LiteralPath $dest -Recurse -Force
                        Say "  removed   $dest"
                    }
                    $grokRemoved++
                } catch {
                    $grokFailed = $true
                    Say "  failed    $dest - $($_.Exception.Message)"
                }
            }
        }
        if ($grokFailed) {
            Add-Row 'grok' 'yes' 'FAILED' "could not remove legacy skills from $grokDest"
        } elseif ($grokRemoved -eq 0) {
            Add-Row 'grok' 'yes' 'clean' "no legacy read-only skills in $grokDest"
        } elseif ($DryRun) {
            Add-Row 'grok' 'yes' 'planned' "would remove $grokRemoved legacy read-only skill(s) from $grokDest"
        } else {
            Add-Row 'grok' 'yes' 'removed' "$grokRemoved legacy read-only skill(s) from $grokDest"
        }
        Say '  The Grok Build plugin itself is managed by Grok, not this script:'
        Say "  remove it with 'grok plugin uninstall' - see adapters/grok/README.md."
    } else {
        Add-Row 'grok' 'no' 'skipped' 'no ~/.grok/skills - no legacy skills to remove'
    }
} else {
    $grokDetected = if ($grokDest -or (Test-Path -LiteralPath (Join-Path $UserHome '.grok'))) { 'yes' } else { 'no' }
    Add-Row 'grok' $grokDetected 'plugin' 'grok plugin install josephwander-arch/autocache --trust'
    Say 'Grok: nothing is copied for Grok Build. AutoCache installs as a native plugin:'
    Say '  grok plugin install josephwander-arch/autocache --trust'
    Say '  See adapters/grok/README.md for trust, enable, and verification steps.'
}
Say ''

# --------------------------------------------------------------------- report

Write-Host 'Autocache - result by surface'
Write-Host ''
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 240 | Write-Host

if ($failures -gt 0) {
    Write-Host "FAILED: $failures surface(s) did not install cleanly."
    exit 1
}

if ($Uninstall) {
    Write-Host "Uninstalled. Your state in $StateRoot was kept - sessions, breadcrumbs and"
    Write-Host 'checkpoints survive removing the front ends. Delete that directory yourself'
    Write-Host 'if you want the continuity gone too.'
} elseif ($DryRun) {
    Write-Host 'Dry run complete. Nothing was written.'
} else {
    Write-Host 'Done. Start a new session on each surface for the hooks to load.'
    Write-Host "State is local plain JSON in $StateRoot - read it, diff it, delete it."
}
exit 0
