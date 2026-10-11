<#
.SYNOPSIS
  Build the Autocache Claude Desktop extension (.mcpb) from this repository.

.DESCRIPTION
  Stages adapters\local-hosts\mcp-server (without node_modules and test) plus the two core
  files its runtime loads (hooks\lib\store.js and
  skills\autocache-breadcrumb\scripts\breadcrumb.js, each under a CommonJS package.json because
  the server package is ESM), installs production dependencies with npm ci --omit=dev, checks
  the server (MCP initialize + tools/list against a throwaway AUTOCACHE_HOME, tool names equal
  manifest.json), validates and packs with the mcpb CLI, unpacks the result and repeats the
  handshake against the unpacked copy, then writes dist\SHA256SUMS.txt and
  build\pack-report.json.

  It never installs anything and never touches Claude Desktop, its config, or ~/.autocache.

  Requirements: Node.js 20+, npm, and the mcpb CLI (npm install -g @anthropic-ai/mcpb).

.PARAMETER OutDir
  Where the .mcpb and SHA256SUMS.txt go. Default: adapters\local-hosts\mcpb\dist.
.PARAMETER Clean
  Delete OutDir and the staging folder first.
.PARAMETER Sign
  Sign the .mcpb with `mcpb sign` using McpbCert/McpbKey. The bundle contains no executable,
  so there is no Authenticode step. Without a certificate, -Sign only warns. See SIGNING.md.
.PARAMETER McpbCert
  PEM certificate for `mcpb sign`.
.PARAMETER McpbKey
  PEM private key for `mcpb sign`.
.PARAMETER McpbIntermediate
  Optional PEM intermediate certificate(s).
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [switch]$Clean,
  [switch]$Sign,
  [string]$McpbCert,
  [string]$McpbKey,
  [string[]]$McpbIntermediate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$Here      = $PSScriptRoot
$Repo      = (Resolve-Path (Join-Path $Here '..\..\..')).Path
$ServerSrc = Join-Path $Here '..\mcp-server'
$Build     = Join-Path $Here 'build'
$Stage     = Join-Path $Build 'stage\autocache'
if (-not $OutDir) { $OutDir = Join-Path $Here 'dist' }
$Handshake = Join-Path $Here 'mcp-handshake.mjs'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$BundleFiles = @('manifest.json', 'icon.png', 'README.md', 'PRIVACY.md', 'CHANGELOG.md')
$Core = @('hooks\lib\store.js', 'skills\autocache-breadcrumb\scripts\breadcrumb.js')

$report = [ordered]@{
  started_at = (Get-Date).ToString('o'); repo = $Repo; head = $null; dirty_paths = @()
  version = $null; bundles = [ordered]@{}; warnings = @()
}
function Step([string]$m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Warn([string]$m) { Write-Warning $m; $script:report.warnings += $m }
function Save-Report {
  New-Item -ItemType Directory -Force -Path $Build | Out-Null
  $report.finished_at = (Get-Date).ToString('o')
  [IO.File]::WriteAllText((Join-Path $Build 'pack-report.json'), ($report | ConvertTo-Json -Depth 8), $Utf8NoBom)
}
function Die([string]$m) { [Console]::Error.WriteLine("ERROR: $m"); Save-Report; exit 1 }
function Invoke-Native([string]$exe, [string[]]$argList, [string]$log) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $exe @argList *> $log } finally { $ErrorActionPreference = $prev }
  return $LASTEXITCODE
}
function Get-Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Invoke-Handshake([string[]]$cmd, [string[]]$envPairs) {
  $a = @($Handshake, '--timeout', '15000')
  foreach ($e in $envPairs) { $a += @('--env', $e) }
  $a += '--'; $a += $cmd
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & node @a 2>$null } finally { $ErrorActionPreference = $prev }
  return (($out -join "`n") | ConvertFrom-Json)
}
function Assert-ToolsMatch([string]$manifestPath, $live, [string]$label) {
  $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $diff = @(Compare-Object @($m.tools.name | Sort-Object) @($live.tools.name | Sort-Object))
  if ($diff.Count -gt 0) {
    Die "$label manifest tools differ from live tools/list: $(($diff | ForEach-Object { "$($_.SideIndicator)$($_.InputObject)" }) -join ', ')"
  }
}
function Test-Server([string]$serverDir, [string]$label) {
  $home_ = Join-Path ([IO.Path]::GetTempPath()) ("autocache-handshake-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $home_ | Out-Null
  try {
    $hs = Invoke-Handshake @('node', (Join-Path $serverDir 'src\cli.js'), 'stdio') @(
      "AUTOCACHE_HOME=$home_", 'AUTOCACHE_STORE_SCOPE=claude-desktop', 'AUTOCACHE_MCP_ACTOR=claude-desktop')
  } finally { Remove-Item -LiteralPath $home_ -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }
  if (-not $hs.ok) { Die "$label handshake failed: $($hs.error) $($hs.stderrTail)" }
  return $hs
}

# --- 1. tooling and version -------------------------------------------------------------------
Step '1. tooling'
foreach ($t in 'node', 'npm', 'mcpb') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    if ($t -eq 'mcpb') { Die 'mcpb CLI missing: npm install -g @anthropic-ai/mcpb' }
    Die "$t not on PATH"
  }
}
$report.tooling = [ordered]@{ node = (& node -v); npm = (& npm -v); mcpb = (& mcpb --version) }
$report.head = (& git -C $Repo rev-parse --short HEAD)
$report.dirty_paths = @(& git -C $Repo status --porcelain -- adapters/local-hosts/mcp-server hooks/lib skills/autocache-breadcrumb/scripts)
if ($report.dirty_paths.Count -gt 0) { Warn "server sources have uncommitted changes: $($report.dirty_paths -join '; ')" }
$manifest = Get-Content -LiteralPath (Join-Path $Here 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$plugin = Get-Content -LiteralPath (Join-Path $Repo '.claude-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plugin.version -ne $manifest.version) { Die "plugin.json version $($plugin.version) != manifest.json version $($manifest.version)" }
$Version = $manifest.version; $report.version = $Version
if ($Clean) {
  foreach ($d in $OutDir, $Stage) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -Confirm:$false } }
}
New-Item -ItemType Directory -Force -Path $Build, $OutDir | Out-Null

# --- 2. stage ---------------------------------------------------------------------------------
Step '2. stage'
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force -Confirm:$false }
$server = Join-Path $Stage 'server'
New-Item -ItemType Directory -Force -Path $server | Out-Null
foreach ($f in $BundleFiles) { Copy-Item -LiteralPath (Join-Path $Here $f) -Destination $Stage }
Copy-Item -LiteralPath (Join-Path $Repo 'LICENSE') -Destination $Stage
foreach ($item in Get-ChildItem -LiteralPath $ServerSrc -Force) {
  if ($item.Name -in @('node_modules', 'test', '.gitignore')) { continue }
  Copy-Item -LiteralPath $item.FullName -Destination $server -Recurse -Force
}
foreach ($c in $Core) {
  $dst = Join-Path $server $c
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item -LiteralPath (Join-Path $Repo $c) -Destination $dst -Force
}
foreach ($d in 'hooks', 'skills') {
  [IO.File]::WriteAllText((Join-Path $server "$d\package.json"), "{ `"type`": `"commonjs`" }`n", $Utf8NoBom)
}
$prov = "Autocache local-host MCP server, staged for the Autocache MCPB.`nsource: $Repo @ $($report.head)`nversion: $Version`nfiles: adapters/local-hosts/mcp-server (minus node_modules, test), hooks/lib/store.js, skills/autocache-breadcrumb/scripts/breadcrumb.js`nnode_modules: npm ci --omit=dev`n"
[IO.File]::WriteAllText((Join-Path $server 'VENDORED_FROM.txt'), $prov, $Utf8NoBom)
Push-Location $server
try { $rc = Invoke-Native 'npm' @('ci', '--omit=dev', '--no-audit', '--no-fund') (Join-Path $Build 'npm_ci.log') } finally { Pop-Location }
if ($rc -ne 0) { Die "npm ci --omit=dev failed (exit $rc); see build\npm_ci.log" }
$hs = Test-Server $server 'staged server'
Assert-ToolsMatch (Join-Path $Stage 'manifest.json') $hs 'autocache'
$report.server = [ordered]@{
  server_info = $hs.serverInfo; protocol = $hs.protocolVersion; tool_count = $hs.toolCount
  annotated_tools = $hs.annotatedCount; titled_tools = $hs.titledCount
  node_modules_packages = @(Get-ChildItem -LiteralPath (Join-Path $server 'node_modules') -Filter 'package.json' -File -Recurse).Count
}
if ($hs.annotatedCount -lt $hs.toolCount) { Warn "$($hs.toolCount - $hs.annotatedCount) tools have no MCP annotations." }
Write-Host "autocache: $($hs.toolCount) tools, serverInfo $($hs.serverInfo.name) $($hs.serverInfo.version); manifest matches"

# --- 3. validate, pack, (sign), unpack test ---------------------------------------------------
Step '3. validate / pack'
$rc = Invoke-Native 'mcpb' @('validate', (Join-Path $Stage 'manifest.json')) (Join-Path $Build 'mcpb_validate.log')
if ($rc -ne 0) { Die 'mcpb validate failed; see build\mcpb_validate.log' }
$name = "autocache-$Version-win.mcpb"
$out = Join-Path $OutDir $name
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force -Confirm:$false }
$rc = Invoke-Native 'mcpb' @('pack', $Stage, $out) (Join-Path $Build 'mcpb_pack.log')
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $out)) { Die 'mcpb pack failed; see build\mcpb_pack.log' }
if ($Sign -and $McpbCert -and $McpbKey) {
  $sa = @('sign', $out, '--cert', $McpbCert, '--key', $McpbKey)
  if ($McpbIntermediate) { $sa += '--intermediate'; $sa += $McpbIntermediate }
  $rc = Invoke-Native 'mcpb' $sa (Join-Path $Build 'mcpb_sign.log')
  if ($rc -ne 0) { Die 'mcpb sign failed; see build\mcpb_sign.log' }
} elseif ($Sign) {
  Warn 'no -McpbCert/-McpbKey given, so the .mcpb is not signed.'
}
$z = [IO.Compression.ZipFile]::OpenRead($out)
try { $entries = @($z.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }) } finally { $z.Dispose() }
foreach ($need in @('manifest.json', 'icon.png', 'LICENSE', 'PRIVACY.md', $manifest.server.entry_point)) {
  if ($entries -notcontains $need) { Die "$name is missing archive-root entry '$need'" }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("autocache-unpack-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
  $rc = Invoke-Native 'mcpb' @('unpack', $out, $tmp) (Join-Path $Build 'mcpb_unpack.log')
  if ($rc -ne 0) { Die 'mcpb unpack failed; see build\mcpb_unpack.log' }
  $uhs = Test-Server (Join-Path $tmp 'server') "unpacked $name"
  Assert-ToolsMatch (Join-Path $tmp 'manifest.json') $uhs "unpacked $name"
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }
$info = (& mcpb info $out 2>&1) -join ' '
$report.bundles[$name] = [ordered]@{
  size = (Get-Item -LiteralPath $out).Length; sha256 = (Get-Sha $out); entries = $entries.Count
  unpacked_handshake = "$($uhs.toolCount) tools, $($uhs.serverInfo.name) $($uhs.serverInfo.version)"
  mcpb_signed = ($info -notmatch 'Not signed')
}
Write-Host ("{0}  {1} entries  {2}" -f $name, $entries.Count, $report.bundles[$name].sha256)

[IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS.txt'), "$(Get-Sha $out)  $name`n", $Utf8NoBom)
Save-Report
Write-Host "Done. $OutDir ; report: $(Join-Path $Build 'pack-report.json')" -ForegroundColor Green
if ($report.warnings.Count -gt 0) { Write-Host "$($report.warnings.Count) warning(s); see report." -ForegroundColor Yellow }
exit 0
