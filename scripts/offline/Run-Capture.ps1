#Requires -Version 5.1
<#
.SYNOPSIS
  Browser capture supervisor (local, guarded). Fixed enumerated modes only; no free-form entry, arg or path.
.DESCRIPTION
  -Mode pilot | matrix | videos | planner-repair   (required)
  Runs `node.exe scripts\offline\browser-profile-main.mjs <mode>` under the offline guard in a NEW run dir
  under ...-preservation\runs. browser-profile-main starts the offline Vite dev server in-process on
  127.0.0.1:5192 and runs customer-capture-20261017.mjs as one guarded child. Rollup's `node -p` report
  probe is answered by guard3's fixed rollup-platform.cjs translation (same rollupReport as Run-Offline.ps1).
  Vite's optional Windows mapped-drive `net use` probe is disabled explicitly via the same viteNetUseProbe
  config as Run-Offline.ps1 (async callback error, no child, one `compat` record).
  REFUSES if guard.cjs lacks the browser-native-rules.cjs integration markers (see BROWSER.md).
  Does not dot-source Run-Offline.ps1 (it auto-executes); the shared logic below is a reviewed copy.
  Cleanup touches only processes proven to descend from the started main (held handle + creation time +
  executable). Nothing is matched by command line.
  Exit code: 0 = guard-clean and capture exit 0; 3 = guard-clean, capture recorded failures/unverified
  (review the receipt); 1 = run failed; 2 = refused or setup error. Never a visual/functional PASS.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('pilot', 'matrix', 'videos', 'planner-repair')][string]$Mode
)
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$NodePath = 'C:\Program Files\nodejs\node.exe'
$NodeVersion = 'v22.15.0'
$OfflineDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $OfflineDir)
if ((Split-Path -Leaf $RepoRoot) -ne 'cocotrip-integration-20261017') { throw "unexpected repo root: $RepoRoot" }
$PreservationRoot = $RepoRoot + '-preservation'
$RunsRoot = Join-Path $PreservationRoot 'runs'
$ManifestPath = Join-Path (Join-Path $PreservationRoot 'offline-install') 'install-manifest.json'
$NodeModules = Join-Path $RepoRoot 'node_modules'
$GuardPath = Join-Path $OfflineDir 'guard.cjs'
$MainPath = Join-Path $OfflineDir 'browser-profile-main.mjs'
$RulesPath = Join-Path $OfflineDir 'browser-native-rules.cjs'
$RollupPlatform = Join-Path $OfflineDir 'rollup-platform.cjs'
$HarnessPath = Join-Path $RepoRoot 'scripts\integration\customer-capture-20261017.mjs'
$Port = 5192
$Origin = "http://127.0.0.1:$Port"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Repo([string]$Rel) { return (Join-Path $RepoRoot $Rel) }

# ---- pins (same esbuild pin as Run-Offline.ps1; browser/ffmpeg = public Playwright cache files) ----
$Esbuild = @{
  Rel    = 'node_modules\@esbuild\win32-x64\esbuild.exe'
  Sha256 = '2c9cd2a3e77a434394e4de328dad9fc09c85d2b528db3ae040f07ff84877f5c3'
  Size   = 11365376
  Args   = @('--service=0.27.2', '--ping')
  Stdio  = @('pipe', 'pipe', 'inherit')
}
$RollupRel = 'node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node'
# Verified addon bytes (lowercase: guard pins are ^[0-9a-f]{64}$). Must also equal the install manifest's pin.
$RollupSha256 = '2716fd0f879b586b3e1fe1a60d6d6ce0afce75d4b17a4ed799d9f7519816f08f'
$RollupSize = 2539520
# Same as Run-Offline.ps1 $RollupNativeJs: the installed native.js the guard3 report translation was written against.
$RollupNativeJs = @{ Rel = 'node_modules\rollup\dist\native.js'; Sha256 = '93c3da450b25ba485bb3de20dded405aa9c105951e8d31964eeb49633c2b16ea' }
# Same as Run-Offline.ps1 $ViteConfigJs: optimizeSafeRealPathSync's exec('net use', cb) at line 2230, answered
# by the guard with an async OFFLINE_PLATFORM_PROBE_DISABLED callback error (no child; fs.realpathSync fallback).
$ViteConfigJs = @{ Rel = 'node_modules\vite\dist\node\chunks\config.js'; Sha256 = 'c2fcfa51206dc1f8d22120ef4a82af8b9acdc02f4476520b6a0897d12a724ba3'; Line = 2230 }
$ViteProbeCode = 'OFFLINE_PLATFORM_PROBE_DISABLED'
$PlaywrightBrowsers = 'C:\Users\dlxod\AppData\Local\ms-playwright'
$Chromium = @{
  Path   = Join-Path $PlaywrightBrowsers 'chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe'
  Sha256 = 'ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef'
  Size   = 211223552
}
$Ffmpeg = @{
  Path   = Join-Path $PlaywrightBrowsers 'ffmpeg-1011\ffmpeg-win64.exe'
  Sha256 = '5b8f3f59ba61685828939ff3c833109748adbdea2fff4b4ae570c9fc0fc1ff4d'
  Size   = 3490816
}

$LockedVersions = [ordered]@{
  'typescript'                    = '5.9.3'
  'vite'                          = '7.3.6'
  'vitest'                        = '4.1.11'
  'eslint'                        = '9.39.5'
  '@playwright/test'              = '1.62.1'
  'playwright-core'               = '1.62.1'
  'esbuild'                       = '0.27.2'
  '@esbuild/win32-x64'            = '0.27.2'
  'rollup'                        = '4.60.1'
  '@rollup/rollup-win32-x64-msvc' = '4.60.1'
}
$PinnedFiles = @(
  'node_modules\typescript\bin\tsc', 'node_modules\typescript\lib\tsc.js', 'node_modules\vite\bin\vite.js',
  'node_modules\vitest\vitest.mjs', 'node_modules\vitest\dist\workers\forks.js', 'node_modules\eslint\bin\eslint.js',
  $Esbuild.Rel, $RollupRel
)
$OfflineSources = @('guard.cjs', 'Run-Capture.ps1', 'browser-profile-main.mjs', 'browser-native-rules.cjs',
  'rollup-platform.cjs', 'Run-Offline.ps1')
# Hashed before and after every run; any change fails the run. The validator is pinned to this coreBundle.
$RepoInputs = @(
  'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json',
  'tsconfig.node.json', 'postcss.config.js', 'tailwind.config.js', 'scripts\audit-prerender-artifacts.mjs',
  'scripts\integration\vite-offline-20261017.config.ts', 'scripts\integration\customer-capture-20261017.mjs',
  'node_modules\playwright-core\package.json', 'node_modules\playwright-core\browsers.json',
  'node_modules\playwright-core\lib\coreBundle.js', 'node_modules\rollup\dist\native.js',
  'node_modules\vite\dist\node\chunks\config.js'
)

# Product bytes the dev server serves or main/harness can import (src imports api\_shared and api\_ai_core
# as source modules). The harness imports only node builtins and @playwright/test; its fixtures are inline.
# Fixed trees only; never node_modules, .git, caches, build output, .env* or credential-named files.
$ProvenanceTrees = @('src', 'public', 'api\_shared', 'api\_ai_core')
$ProvenanceRootExt = @('.html', '.json', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.css')
$ProvenanceSkipDirs = @('node_modules', '.git', '.vite', '.vite-temp', '.cache', 'coverage', 'dist')
$ExcludedName = '^\.env|secret|credential|service[-_]?account|adminsdk|\.pem$|\.p12$|\.pfx$|^dist-'

# Harness selections; must equal MODES in browser-profile-main.mjs (the guard compares the child argv exactly).
$ModeDefs = @{
  pilot  = @{ TimeoutMs = 65 * 60000; Ffmpeg = 0; Args = @('--group', 'planner,charter,result', '--width', '390,1440', '--lang', 'ja,en') }
  matrix = @{ TimeoutMs = 425 * 60000; Ffmpeg = 0; Args = @('--group', 'home,planner,result,tours,charter,map,static,account', '--width', '360,390,430,1024,1440', '--lang', 'ko,en,ja,zh') }
  videos = @{ TimeoutMs = 125 * 60000; Ffmpeg = 16; Args = @('--group', 'video', '--width', '390,1440', '--lang', 'en,ko', '--video-flow', 'home,planner,charter,tours') }
  # 12 planner cells only (360/390/430 x 4 langs): re-capture after a planner fix, not a matrix replacement.
  'planner-repair' = @{ TimeoutMs = 65 * 60000; Ffmpeg = 0; Args = @('--group', 'planner', '--width', '360,390,430', '--lang', 'ko,en,ja,zh') }
}

# Executables a proven-owned process may run and still be stopped by cleanup.
$KnownExes = @($NodePath, (Repo $Esbuild.Rel), $Chromium.Path, $Ffmpeg.Path,
  (Join-Path ([Environment]::GetFolderPath('System')) 'conhost.exe'))
# Pinned natives that, if alive and not attributable to this run, fail it (never stopped).
$WatchedExes = @($Chromium.Path, $Ffmpeg.Path, (Repo $Esbuild.Rel))

function Get-Field($Object, [string]$Name) {
  $p = $Object.PSObject.Properties[$Name]
  if ($p) { return $p.Value }
  return $null
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function New-List {
  $l = New-Object System.Collections.ArrayList
  foreach ($a in $args) { [void]$l.Add($a) }
  return , $l
}

function Get-Pin([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return [ordered]@{ sha256 = Get-Sha256 $Path; size = (Get-Item -LiteralPath $Path).Length }
}

function Get-SourceHashes {
  $h = [ordered]@{}
  foreach ($n in $OfflineSources) { $h['scripts\offline\' + $n] = Get-Sha256 (Join-Path $OfflineDir $n) }
  foreach ($r in $RepoInputs) {
    $p = Repo $r
    if (Test-Path -LiteralPath $p -PathType Leaf) { $h[$r] = Get-Sha256 $p } else { $h[$r] = 'missing' }
  }
  return $h
}

function Get-PackageVersion([string]$Name) {
  $pj = Join-Path $NodeModules ($Name.Replace('/', '\') + '\package.json')
  if (-not (Test-Path -LiteralPath $pj -PathType Leaf)) { return 'missing' }
  return [string](Get-Field ([IO.File]::ReadAllText($pj) | ConvertFrom-Json) 'version')
}

# Read-only copy of Run-Offline.ps1 Test-InstallManifest, plus the fixed Rollup and Playwright pins.
function Test-Installed {
  $fail = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return @('install-manifest-missing') }
  $m = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
  if ((Get-Field $m 'packageLockSha256') -ne (Get-Sha256 (Repo 'package-lock.json'))) { $fail.Add('package-lock changed since install') }
  foreach ($n in $LockedVersions.Keys) {
    $v = Get-PackageVersion $n
    if ($v -ne $LockedVersions[$n]) { $fail.Add("version-mismatch $n actual=$v") }
  }
  $files = Get-Field $m 'files'
  foreach ($p in $files.PSObject.Properties) {
    $pin = Get-Pin (Repo $p.Name)
    if ($null -eq $pin) { $fail.Add("pinned-missing $($p.Name)") }
    elseif ($pin.sha256 -ne $p.Value.sha256 -or $pin.size -ne $p.Value.size) { $fail.Add("pinned-hash-mismatch $($p.Name)") }
  }
  foreach ($r in $PinnedFiles) {
    if (-not $files.PSObject.Properties[$r]) { $fail.Add("manifest-lacks $r") }
  }
  foreach ($p in (Get-Field $m 'optional').PSObject.Properties) {
    $pin = Get-Pin (Repo $p.Name)
    if ($p.Value.present) {
      if ($null -eq $pin -or $pin.sha256 -ne $p.Value.sha256 -or $pin.size -ne $p.Value.size) { $fail.Add("optional-hash-mismatch $($p.Name)") }
    } elseif ($null -ne $pin) { $fail.Add("optional-appeared $($p.Name)") }
  }
  $eb = Get-Pin (Repo $Esbuild.Rel)
  if ($null -eq $eb -or $eb.sha256 -ne $Esbuild.Sha256 -or $eb.size -ne $Esbuild.Size) { $fail.Add('esbuild-hash-mismatch') }
  $ro = Get-Pin (Repo $RollupRel)
  $roManifest = $files.PSObject.Properties[$RollupRel]
  if ($null -eq $ro -or $ro.sha256 -ne $RollupSha256 -or $ro.size -ne $RollupSize) { $fail.Add('rollup-hash-mismatch') } elseif (
    -not $roManifest -or $roManifest.Value.sha256 -ne $RollupSha256) { $fail.Add('rollup-pin-differs-from-manifest') }
  foreach ($n in @($Chromium, $Ffmpeg)) {
    $pin = Get-Pin $n.Path
    if ($null -eq $pin -or $pin.sha256 -ne $n.Sha256 -or $pin.size -ne $n.Size) { $fail.Add("native-pin-mismatch $(Split-Path -Leaf $n.Path)") }
  }
  # Run-Offline.ps1 Test-CompatPins for the Rollup report translation and the Vite `net use` probe.
  foreach ($c in @($RollupNativeJs, $ViteConfigJs)) {
    $cp = Repo $c.Rel
    if (-not (Test-Path -LiteralPath $cp -PathType Leaf)) { $fail.Add("compat-missing $($c.Rel)") }
    elseif ((Get-Sha256 $cp) -ne $c.Sha256) { $fail.Add("compat-hash-mismatch $($c.Rel)") }
  }
  return @($fail)
}

# ---- product provenance: relative path, size, SHA-256 of every file in the fixed trees ----
function Add-ProvenanceFile($P, [IO.FileInfo]$File) {
  $rel = $File.FullName.Substring($RepoRoot.Length + 1)
  if (($File.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [void]$P.Problems.Add("reparse-point $rel"); return }
  try { $P.Files[$rel] = [ordered]@{ path = $rel; size = $File.Length; sha256 = Get-Sha256 $File.FullName } }
  catch { [void]$P.Problems.Add("unreadable $rel") }
}

function Add-ProvenanceDir($P, [IO.DirectoryInfo]$Dir) {
  $rel = $Dir.FullName.Substring($RepoRoot.Length + 1)
  try { $items = @($Dir.EnumerateFileSystemInfos()) } catch { [void]$P.Problems.Add("unlistable $rel"); return }
  foreach ($item in $items) {
    $itemRel = $item.FullName.Substring($RepoRoot.Length + 1)
    # Symlinks/junctions are never followed, wherever they point: the run refuses or fails instead.
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [void]$P.Problems.Add("reparse-point $itemRel"); continue }
    if ($item -is [IO.DirectoryInfo]) {
      if ($ProvenanceSkipDirs -contains $item.Name.ToLowerInvariant() -or $item.Name -match $ExcludedName) { [void]$P.Excluded.Add($itemRel + '\'); continue }
      Add-ProvenanceDir $P $item
    } elseif ($item.Name -match $ExcludedName) { [void]$P.Excluded.Add($itemRel) }
    else { Add-ProvenanceFile $P $item }
  }
}

function Get-Provenance {
  $p = @{ Files = @{}; Excluded = (New-List); Problems = (New-List) }
  foreach ($t in $ProvenanceTrees) {
    $d = New-Object IO.DirectoryInfo (Repo $t)
    if (-not $d.Exists) { [void]$p.Problems.Add("tree-missing $t"); continue }
    if (($d.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [void]$p.Problems.Add("reparse-point $t"); continue }
    Add-ProvenanceDir $p $d
  }
  # Repo root: top-level code/config files only (index.html, package*.json, *.config.*, tsconfig*), no dotfiles.
  foreach ($f in @((New-Object IO.DirectoryInfo $RepoRoot).EnumerateFiles())) {
    if ($ProvenanceRootExt -notcontains $f.Extension.ToLowerInvariant()) { continue }
    if ($f.Name.StartsWith('.') -or $f.Name -match $ExcludedName) { [void]$p.Excluded.Add($f.Name); continue }
    Add-ProvenanceFile $p $f
  }
  $keys = [string[]]@($p.Files.Keys)
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $p.SortedKeys = $keys
  return $p
}

function Write-Provenance($P, [string]$Path) {
  $files = New-List
  foreach ($k in $P.SortedKeys) { [void]$files.Add($P.Files[$k]) }
  $excluded = [string[]]@($P.Excluded)
  [Array]::Sort($excluded, [StringComparer]::Ordinal)
  $doc = [ordered]@{
    schema = 1; trees = $ProvenanceTrees; rootExtensions = $ProvenanceRootExt
    files = $files; excluded = $excluded; problems = @($P.Problems)
  }
  [IO.File]::WriteAllText($Path, ($doc | ConvertTo-Json -Depth 4), $Utf8NoBom)
  (Get-Item -LiteralPath $Path).IsReadOnly = $true
  return (Get-Sha256 $Path)
}

function Compare-Provenance($Before, $After) {
  $d = [ordered]@{ added = (New-List); deleted = (New-List); modified = (New-List); excludedChanged = $false }
  foreach ($k in $After.SortedKeys) { if (-not $Before.Files.ContainsKey($k)) { [void]$d.added.Add($k) } }
  foreach ($k in $Before.SortedKeys) {
    if (-not $After.Files.ContainsKey($k)) { [void]$d.deleted.Add($k); continue }
    $b = $Before.Files[$k]
    $a = $After.Files[$k]
    if ($a.sha256 -ne $b.sha256 -or $a.size -ne $b.size) { [void]$d.modified.Add($k) }
  }
  $be = [string[]]@($Before.Excluded)
  $ae = [string[]]@($After.Excluded)
  [Array]::Sort($be, [StringComparer]::OrdinalIgnoreCase)
  [Array]::Sort($ae, [StringComparer]::OrdinalIgnoreCase)
  $d.excludedChanged = (($be -join "`n") -ne ($ae -join "`n"))
  return $d
}

# ---- process ownership: identities proven from the started main, never from command lines ----
# Every owned process is held open by a Process handle from discovery until the end of the run, so its
# PID cannot be reused while tracked. A process is owned only if its parent is owned and it was created
# after that parent. Kill goes through the held handle (one process, no tree, no shell, no taskkill).
function Test-PathIn([string]$P, $List) {
  foreach ($x in $List) { if ([string]::Equals($P, $x, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
  return $false
}

function Get-ExeLeaf($Entry) {
  if ($Entry.Exe) { return (Split-Path -Leaf $Entry.Exe) }
  return '<unreadable>'
}

function Write-OwnedLog($State, $Entry) {
  $line = [ordered]@{
    pid = $Entry.Pid; parentPid = $Entry.ParentPid; createdUtc = $Entry.CreatedUtc.ToString('o')
    exe = $Entry.Exe; known = $Entry.Known; role = $Entry.Role
  }
  [IO.File]::AppendAllText($State.LogPath, (($line | ConvertTo-Json -Compress) + "`n"), $Utf8NoBom)
}

function New-OwnState($MainProc, [datetime]$MainCreatedUtc, [string]$LogPath) {
  $state = @{
    ByPid = @{}; Order = (New-List); Attributable = @{}; Unattributed = @{}; Unproven = @{}
    ScanErrors = 0; MainCreatedUtc = $MainCreatedUtc; LogPath = $LogPath
  }
  $main = [pscustomobject]@{
    Pid = $MainProc.Id; ParentPid = $PID; CreatedUtc = $MainCreatedUtc; Exe = $NodePath; Known = $true
    Proc = $MainProc; Role = 'main'; Outcome = ''; Reported = $false
  }
  $state.ByPid[[int]$MainProc.Id] = $main
  [void]$state.Order.Add($main)
  Write-OwnedLog $state $main
  return $state
}

function Add-OwnedProcess($State, $Row, $Parent, [datetime]$CreatedUtc) {
  $id = [int]$Row.ProcessId
  $key = '{0}|{1}' -f $id, $CreatedUtc.Ticks
  $p = $null
  try {
    $p = [Diagnostics.Process]::GetProcessById($id)
    [void]$p.Handle
    $startUtc = $p.StartTime.ToUniversalTime()
  } catch {
    if ($p) { $p.Dispose() }
    $base = $_.Exception.GetBaseException()
    # Already gone: nothing of it is left to clean up.
    if ($base -is [ArgumentException] -or $base -is [InvalidOperationException]) { return $false }
    $State.Unproven[$key] = 'no-handle'
    return $false
  }
  # A different start time means the PID was already reused by an unrelated process: not ours.
  if ([Math]::Abs(($startUtc - $CreatedUtc).Ticks) -ge 10000) { $p.Dispose(); return $false }
  $exe = [string]$Row.ExecutablePath
  if (-not $exe) { try { $exe = [string]$p.MainModule.FileName } catch { $exe = '' } }
  $entry = [pscustomobject]@{
    Pid = $id; ParentPid = $Parent.Pid; CreatedUtc = $CreatedUtc; Exe = $exe
    Known = [bool]($exe -and (Test-PathIn $exe $KnownExes)); Proc = $p; Role = 'descendant'; Outcome = ''; Reported = $false
  }
  $State.ByPid[$id] = $entry
  [void]$State.Order.Add($entry)
  Write-OwnedLog $State $entry
  return $true
}

function Update-OwnedProcesses($State) {
  try {
    # Identity fields only. CommandLine is never requested; rows of other processes are not kept.
    $rows = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate, ExecutablePath FROM Win32_Process' -ErrorAction Stop)
  } catch {
    $State.ScanErrors++
    return
  }
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($r in $rows) {
      $id = [int]$r.ProcessId
      if ($State.ByPid.ContainsKey($id) -or $null -eq $r.CreationDate) { continue }
      $parent = $State.ByPid[[int]$r.ParentProcessId]
      if ($null -eq $parent) { continue }
      $created = ([datetime]$r.CreationDate).ToUniversalTime()
      # Created before our parent existed: a child of an earlier holder of that PID.
      if ($created -lt $parent.CreatedUtc) { continue }
      $key = '{0}|{1}' -f $id, $created.Ticks
      if ($State.Attributable.ContainsKey($key)) { continue }
      $State.Attributable[$key] = $true
      if (Add-OwnedProcess $State $r $parent $created) { $grew = $true }
    }
  }
  foreach ($r in $rows) {
    $exe = [string]$r.ExecutablePath
    if (-not $exe -or $null -eq $r.CreationDate -or -not (Test-PathIn $exe $WatchedExes)) { continue }
    $created = ([datetime]$r.CreationDate).ToUniversalTime()
    if ($created -lt $State.MainCreatedUtc) { continue }
    $key = '{0}|{1}' -f [int]$r.ProcessId, $created.Ticks
    if ($State.ByPid.ContainsKey([int]$r.ProcessId) -or $State.Attributable.ContainsKey($key)) { continue }
    $State.Unattributed[$key] = Split-Path -Leaf $exe
  }
}

# Emits the alive entries one by one; callers always wrap in @(). An unreadable state counts as alive.
function Get-AliveOwned($State) {
  foreach ($e in $State.Order) {
    $exited = $false
    try { $exited = $e.Proc.HasExited } catch { $exited = $false }
    if (-not $exited) { $e }
  }
}

function Stop-OwnedProcess($Entry) {
  if (-not $Entry.Known) { $Entry.Outcome = 'alive-not-stopped-unknown-exe'; return }
  try {
    if (-not $Entry.Proc.HasExited) { $Entry.Proc.Kill() }
    if ($Entry.Proc.WaitForExit(5000)) { $Entry.Outcome = 'stopped'; return }
  } catch {
    try { if ($Entry.Proc.HasExited) { $Entry.Outcome = 'exited'; return } } catch { }
  }
  $Entry.Outcome = 'stop-failed'
}

function Invoke-OwnedCleanup($State, [bool]$TimedOut, $Failures) {
  if (-not $TimedOut) {
    # Graceful first: owned natives follow their pipes and exit on their own once main has exited.
    $sw = [Diagnostics.Stopwatch]::StartNew()
    do {
      Update-OwnedProcesses $State
      if (@(Get-AliveOwned $State).Count -eq 0) { break }
      Start-Sleep -Milliseconds 500
    } while ($sw.ElapsedMilliseconds -lt 15000)
  }
  $tag = 'leftover-process'
  if ($TimedOut) { $tag = 'timeout-stopped' }
  for ($round = 0; $round -lt 3; $round++) {
    Update-OwnedProcesses $State
    $alive = @(Get-AliveOwned $State)
    if ($alive.Count -eq 0) { break }
    [Array]::Reverse($alive) # latest-discovered descendants first, main last
    foreach ($e in $alive) {
      if (-not $e.Reported) { $Failures.Add("$tag $(Get-ExeLeaf $e) pid=$($e.Pid)"); $e.Reported = $true }
      Stop-OwnedProcess $e
    }
  }
  foreach ($e in @(Get-AliveOwned $State)) { $Failures.Add("owned-still-alive $(Get-ExeLeaf $e) pid=$($e.Pid) outcome=$($e.Outcome)") }
  foreach ($e in $State.Order) {
    if (-not $e.Known) { $Failures.Add("unexpected-descendant-exe $(Get-ExeLeaf $e) pid=$($e.Pid)") }
  }
  # Fail closed: incomplete or unproven process records are never resolved by killing.
  if ($State.ScanErrors -gt 0) { $Failures.Add("process-scan-failed count=$($State.ScanErrors)") }
  foreach ($k in $State.Unproven.Keys) { $Failures.Add("process-ownership-unproven $($k.Split('|')[0]) (not stopped)") }
  foreach ($k in $State.Unattributed.Keys) { $Failures.Add("unattributed-native $($State.Unattributed[$k]) pid=$($k.Split('|')[0]) (not stopped)") }
}

function Invoke-CaptureRun {
  # ---- preflight (throws = refused, exit 2) ----
  if ($RollupSha256 -notmatch '^[0-9a-f]{64}$') { throw 'rollup pin is not a 64-hex SHA-256' }
  $guardText = [IO.File]::ReadAllText($GuardPath)
  foreach ($marker in @("require('./browser-native-rules.cjs')", 'validateNativeInvocation')) {
    if (-not $guardText.Contains($marker)) { throw "guard3 browser integration pending: guard.cjs lacks $marker (see BROWSER.md)" }
  }
  foreach ($f in @($NodePath, $MainPath, $RulesPath, $RollupPlatform, $HarnessPath)) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "missing: $f" }
  }
  $installed = @(Test-Installed)
  if ($installed.Count -gt 0) { throw ('install does not verify: ' + ($installed -join '; ')) }
  $def = $ModeDefs[$Mode]

  $runId = '{0}-capture-{1}-{2}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Mode, [guid]::NewGuid().ToString('N').Substring(0, 8)
  $runDir = Join-Path $RunsRoot $runId
  if (Test-Path -LiteralPath $runDir) { throw "run dir already exists, refusing to overwrite: $runDir" }
  $ledgerDir = Join-Path $runDir 'ledger'
  $tmpDir = Join-Path $runDir 'tmp'
  $homeDir = Join-Path $runDir 'home'
  $roaming = Join-Path $homeDir 'AppData\Roaming'
  $local = Join-Path $homeDir 'AppData\Local'
  foreach ($d in @($ledgerDir, $tmpDir, $roaming, $local)) { [void][IO.Directory]::CreateDirectory($d) }
  $captureDir = Join-Path $runDir 'capture'

  $configPath = Join-Path $runDir 'guard-config.json'
  $guardFwd = $GuardPath.Replace('\', '/')
  if ($guardFwd -match '[\s"'']') { throw "guard path must not contain whitespace or quotes: $guardFwd" }
  $sourceBefore = Get-SourceHashes
  $provBefore = Get-Provenance
  if ($provBefore.Problems.Count -gt 0) { throw ('product provenance refused: ' + (@($provBefore.Problems) -join '; ')) }
  $provBeforeSha = Write-Provenance $provBefore (Join-Path $runDir 'provenance-before.json')

  # Fresh environment only: nothing inherited (no credentials, ADC, proxies, user profile or browser profile).
  $winDir = [Environment]::GetFolderPath('Windows')
  $launcherEnv = [ordered]@{
    SystemRoot                                 = $winDir
    WINDIR                                     = $winDir
    PATH                                       = Split-Path -Parent $NodePath
    TEMP                                       = $tmpDir
    TMP                                        = $tmpDir
    USERPROFILE                                = $homeDir
    HOME                                       = $homeDir
    APPDATA                                    = $roaming
    LOCALAPPDATA                               = $local
    CLOUDSDK_CONFIG                            = Join-Path $homeDir 'gcloud'
    METADATA_SERVER_DETECTION                  = 'none'
    PRERENDER                                  = '0'
    COCOTRIP_OFFLINE_PORT                      = [string]$Port
    # Registry lookup of the installed headless shell + ffmpeg (read only). The harness's
    # --browser-executable pattern does not accept the chrome-headless-shell-win64 layout.
    PLAYWRIGHT_BROWSERS_PATH                   = $PlaywrightBrowsers
    # Otherwise Playwright spawns winldd and writes a marker into the shared browser cache.
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1'
    NODE_OPTIONS                               = "--require $guardFwd"
    OFFLINE_GUARD_CONFIG                       = $configPath
  }
  foreach ($k in $launcherEnv.Keys) {
    if ($k -match 'KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY') { throw "refusing sensitive-looking env key: $k" }
  }

  $harnessArgs = @('--base-url', $Origin, '--out', $captureDir) + $def.Args
  $config = [ordered]@{
    schema            = 3
    runId             = $runId
    profile           = "capture-$Mode"
    nodePath          = $NodePath
    guardPath         = $GuardPath
    guardSha256       = $sourceBefore['scripts\offline\guard.cjs']
    ledgerDir         = $ledgerDir
    childRules        = New-List ([ordered]@{
        entry = $HarnessPath; argSets = (New-List $harnessArgs)
        execArgvFlags = @(); execArgvRequire = @(); execArgvPairs = @(); envPass = @()
      })
    workerEntries     = @()
    nativeExe         = @(
      [ordered]@{ path = Repo $Esbuild.Rel; sha256 = $Esbuild.Sha256; size = $Esbuild.Size; args = $Esbuild.Args; stdio = $Esbuild.Stdio },
      [ordered]@{ path = $Chromium.Path; sha256 = $Chromium.Sha256; size = $Chromium.Size; validator = 'chromium' },
      [ordered]@{ path = $Ffmpeg.Path; sha256 = $Ffmpeg.Sha256; size = $Ffmpeg.Size; validator = 'ffmpeg' }
    )
    nativeAddons      = @([ordered]@{ path = Repo $RollupRel; sha256 = $RollupSha256; size = $RollupSize })
    nativeRules       = [ordered]@{
      path   = $RulesPath
      sha256 = $sourceBefore['scripts\offline\browser-native-rules.cjs']
      policy = [ordered]@{ runRoot = $runDir; origin = $Origin; browserPath = $Chromium.Path; ffmpegPath = $Ffmpeg.Path }
    }
    loopbackAllowlist = @("127.0.0.1:$Port")
    # Same fields as Run-Offline.ps1 (vite-build / vitest-unit): pinned native.js and fixed report child.
    rollupReport      = [ordered]@{
      nativeJs = Repo $RollupNativeJs.Rel; nativeJsSha256 = $RollupNativeJs.Sha256
      entry = $RollupPlatform; entrySha256 = $sourceBefore['scripts\offline\rollup-platform.cjs']
    }
    # Same fields as Run-Offline.ps1: Vite's optional mapped-drive probe is disabled explicitly.
    viteNetUseProbe   = [ordered]@{ configJs = Repo $ViteConfigJs.Rel; configJsSha256 = $ViteConfigJs.Sha256; line = $ViteConfigJs.Line }
    launcherEnv       = $launcherEnv
  }
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $Utf8NoBom)
  $configSha = Get-Sha256 $configPath
  (Get-Item -LiteralPath $configPath).IsReadOnly = $true

  $argv = @($MainPath, $Mode)
  foreach ($a in $argv) { if ($a -match '"') { throw "argument contains a quote: $a" } }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodePath
  $psi.Arguments = (@($argv | ForEach-Object { '"' + $_ + '"' }) -join ' ')
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $psi.Environment.Clear()
  foreach ($k in $launcherEnv.Keys) { $psi.Environment[$k] = [string]$launcherEnv[$k] }
  $psi.Environment['OFFLINE_GUARD_CONFIG_SHA256'] = $configSha
  $command = '"' + $NodePath + '" ' + $psi.Arguments

  $failures = New-Object System.Collections.Generic.List[string]
  Write-Host "[capture-$Mode] $command"
  $launchFloorUtc = [DateTime]::UtcNow
  $proc = [Diagnostics.Process]::Start($psi)
  $nodePid = $proc.Id
  # Lower bound if the start time cannot be read; still after any earlier holder of this PID.
  $mainCreatedUtc = $launchFloorUtc
  try { $mainCreatedUtc = $proc.StartTime.ToUniversalTime() } catch { }
  $own = New-OwnState $proc $mainCreatedUtc (Join-Path $runDir 'owned-processes.jsonl')
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $timedOut = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    Update-OwnedProcesses $own
    while (-not $proc.WaitForExit(2000)) {
      Update-OwnedProcesses $own
      if ($sw.ElapsedMilliseconds -ge $def.TimeoutMs) { $timedOut = $true; break }
    }
  } finally {
    Invoke-OwnedCleanup $own $timedOut $failures
  }
  if ($timedOut) {
    [void]$proc.WaitForExit(10000)
    $exitCode = -1
  } else {
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
  }
  $stdout = '<incomplete>'
  $stderr = '<incomplete>'
  if ($outTask.Wait(10000)) { $stdout = $outTask.Result }
  if ($errTask.Wait(10000)) { $stderr = $errTask.Result }
  [IO.File]::WriteAllText((Join-Path $runDir 'stdout.txt'), $stdout, $Utf8NoBom)
  [IO.File]::WriteAllText((Join-Path $runDir 'stderr.txt'), $stderr, $Utf8NoBom)

  # ---- verdict from the ledger, independent of what the app reported ----
  if ($timedOut) { $failures.Add('timeout') }
  if (@(0, 12, 13) -notcontains $exitCode) { $failures.Add("exit-code $exitCode") }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($f in @(Get-ChildItem -LiteralPath $ledgerDir -Filter '*.jsonl' -File)) {
    foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
      if (-not $line) { continue }
      try { $records.Add(($line | ConvertFrom-Json)) } catch { $failures.Add("ledger-parse $($f.Name)") }
    }
  }
  foreach ($r in $records) {
    if (@('ready', 'launch', 'deny', 'native-load', 'compat') -notcontains (Get-Field $r 't')) { $failures.Add('unknown-record') }
  }
  $ready = @($records | Where-Object { (Get-Field $_ 't') -eq 'ready' })
  $launches = @($records | Where-Object { (Get-Field $_ 't') -eq 'launch' })
  $guarded = @($launches | Where-Object { (Get-Field $_ 'kind') -ne 'native' })
  $nativeLaunches = @($launches | Where-Object { (Get-Field $_ 'kind') -eq 'native' })
  $nativeLoads = @($records | Where-Object { (Get-Field $_ 't') -eq 'native-load' })

  foreach ($r in $ready) {
    if ((Get-Field $r 'guardSha256') -ne $config.guardSha256 -or (Get-Field $r 'configSha256') -ne $configSha) {
      $failures.Add("ready-pin-mismatch pid=$(Get-Field $r 'pid')")
    }
  }
  $mainReady = @($ready | Where-Object { (Get-Field $_ 'role') -eq 'main' })
  $nodeVersion = $null
  if ($mainReady.Count -eq 1 -and (Get-Field $mainReady[0] 'pid') -eq $nodePid) { $nodeVersion = Get-Field $mainReady[0] 'node' } else {
    $failures.Add("main-not-ready count=$($mainReady.Count)")
  }
  if ($nodeVersion -and $nodeVersion -ne $NodeVersion) { $failures.Add("node-version $nodeVersion") }

  # Guarded launches are exactly: one harness spawn from main, plus guard3's translated Rollup report
  # children (rollup-platform.cjs via spawnSync, at most one per guarded process). Anything else fails.
  $harnessLeaf = Split-Path -Leaf $HarnessPath
  $platformLeaf = Split-Path -Leaf $RollupPlatform
  $harnessLaunches = New-Object System.Collections.Generic.List[object]
  $rollupLaunches = New-Object System.Collections.Generic.List[object]
  foreach ($l in $guarded) {
    $kind = Get-Field $l 'kind'
    $entry = Get-Field $l 'entry'
    $translated = Get-Field $l 'translated'
    $method = Get-Field $l 'method'
    if ($kind -eq 'child' -and $null -eq $translated -and $entry -eq $harnessLeaf -and $method -eq 'child_process.spawn') {
      $harnessLaunches.Add($l)
    } elseif ($kind -eq 'child' -and $translated -eq 'rollup-report' -and $entry -eq $platformLeaf -and $method -eq 'child_process.spawnSync') {
      $rollupLaunches.Add($l)
    } else {
      $failures.Add("unexpected-guarded-launch kind=$kind entry=$entry translated=$translated method=$method")
    }
  }
  # Each guarded launch: exactly one ready, as a child, no execArgv (spawn/spawnSync, guard via NODE_OPTIONS).
  $readyByLaunch = @{}
  foreach ($l in $guarded) {
    $id = Get-Field $l 'id'
    $m = @($ready | Where-Object { (Get-Field $_ 'launchId') -eq $id })
    if ($m.Count -ne 1) { $failures.Add("launch-not-ready $id count=$($m.Count)"); continue }
    if ((Get-Field $m[0] 'role') -ne 'child' -or (Get-Field $l 'kind') -ne 'child') { $failures.Add("launch-role-mismatch $id") }
    if (@(Get-Field $m[0] 'execArgv' | Where-Object { $null -ne $_ }).Count -ne 0) { $failures.Add("launch-execargv $id") }
    $readyByLaunch[[string]$id] = $m[0]
  }
  $harnessPid = $null
  if ($harnessLaunches.Count -ne 1) {
    $failures.Add("harness-launches expected exactly one $harnessLeaf child, got $($harnessLaunches.Count)")
  } else {
    $h = $harnessLaunches[0]
    if ((Get-Field $h 'role') -ne 'main' -or (Get-Field $h 'pid') -ne $nodePid) { $failures.Add('harness-not-launched-by-main') }
    $hr = $readyByLaunch[[string](Get-Field $h 'id')]
    if ($hr) { $harnessPid = Get-Field $hr 'pid' }
  }
  $rollupPerLauncher = @{}
  foreach ($l in $rollupLaunches) {
    $lp = Get-Field $l 'pid'
    $fromMain = (Get-Field $l 'role') -eq 'main' -and $lp -eq $nodePid
    $fromHarness = (Get-Field $l 'role') -eq 'child' -and $null -ne $harnessPid -and $lp -eq $harnessPid
    if (-not ($fromMain -or $fromHarness)) { $failures.Add("rollup-report-unexpected-launcher pid=$lp") }
    $rollupPerLauncher[[string]$lp] = [int]$rollupPerLauncher[[string]$lp] + 1
  }
  foreach ($k in $rollupPerLauncher.Keys) {
    if ($rollupPerLauncher[$k] -gt 1) { $failures.Add("rollup-report-repeated pid=$k count=$($rollupPerLauncher[$k])") }
  }
  $launchIds = @($guarded | ForEach-Object { Get-Field $_ 'id' })
  foreach ($r in $ready) {
    if ((Get-Field $r 'role') -ne 'main' -and $launchIds -notcontains (Get-Field $r 'launchId')) {
      $failures.Add("unregistered-ready pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')")
    }
  }

  # compat: same exact field set/values/roles as Run-Offline.ps1, at most once per process/thread, and only
  # from a process/thread that itself reported a pinned ready (main, or a registered guarded launch).
  $compatRecords = @($records | Where-Object { (Get-Field $_ 't') -eq 'compat' })
  $compatFields = (@('t', 'compat', 'method', 'caller', 'line', 'sourceSha256', 'result', 'role', 'pid', 'tid', 'ts') | Sort-Object) -join ','
  $compatSeen = @{}
  foreach ($r in $compatRecords) {
    $where = "pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')"
    $fields = (@($r.PSObject.Properties | ForEach-Object { $_.Name }) | Sort-Object) -join ','
    if ($fields -ne $compatFields -or (Get-Field $r 'compat') -ne 'vite-net-use-probe' -or
        (Get-Field $r 'method') -ne 'child_process.exec' -or (Get-Field $r 'caller') -ne 'config.js' -or
        (Get-Field $r 'line') -ne $ViteConfigJs.Line -or (Get-Field $r 'sourceSha256') -ne $ViteConfigJs.Sha256 -or
        (Get-Field $r 'result') -ne $ViteProbeCode -or @('main', 'child', 'worker') -notcontains (Get-Field $r 'role')) {
      $failures.Add("compat-unexpected $where")
      continue
    }
    $owner = @($ready | Where-Object {
        (Get-Field $_ 'pid') -eq (Get-Field $r 'pid') -and (Get-Field $_ 'tid') -eq (Get-Field $r 'tid') -and
        (Get-Field $_ 'role') -eq (Get-Field $r 'role') })
    if ($owner.Count -ne 1) { $failures.Add("compat-unregistered $where count=$($owner.Count)") }
    elseif ((Get-Field $owner[0] 'role') -ne 'main' -and $launchIds -notcontains (Get-Field $owner[0] 'launchId')) {
      $failures.Add("compat-unregistered $where")
    }
    if ($compatSeen[$where]) { $failures.Add("compat-repeated $where") }
    $compatSeen[$where] = $true
  }

  # Native code cannot report ready: each launch/load must name a pinned file, hash and validator.
  $exePins = @{
    (Split-Path -Leaf $Esbuild.Rel)   = @{ sha = $Esbuild.Sha256; validator = $null }
    (Split-Path -Leaf $Chromium.Path) = @{ sha = $Chromium.Sha256; validator = 'chromium' }
    (Split-Path -Leaf $Ffmpeg.Path)   = @{ sha = $Ffmpeg.Sha256; validator = 'ffmpeg' }
  }
  $nativeCounts = @{}
  foreach ($l in $nativeLaunches) {
    $entry = [string](Get-Field $l 'entry')
    $pin = $exePins[$entry]
    if ($null -eq $pin -or $pin.sha -ne (Get-Field $l 'sha256') -or $pin.validator -ne (Get-Field $l 'validator')) {
      $failures.Add("native-launch-unpinned $entry")
    }
    $nativeCounts[$entry] = [int]$nativeCounts[$entry] + 1
  }
  $chromeCount = [int]$nativeCounts[(Split-Path -Leaf $Chromium.Path)]
  $ffmpegCount = [int]$nativeCounts[(Split-Path -Leaf $Ffmpeg.Path)]
  if ($chromeCount -ne 1) { $failures.Add("chromium-launches expected=1 actual=$chromeCount") }
  if ($ffmpegCount -ne $def.Ffmpeg) { $failures.Add("ffmpeg-launches expected=$($def.Ffmpeg) actual=$ffmpegCount") }
  foreach ($l in $nativeLoads) {
    if ((Get-Field $l 'entry') -ne (Split-Path -Leaf $RollupRel) -or (Get-Field $l 'sha256') -ne $RollupSha256) {
      $failures.Add("native-load-unpinned $(Get-Field $l 'entry')")
    }
  }

  # Product profile: the expected denial table is empty, so any denial fails, caught or not.
  $denials = @{}
  foreach ($r in @($records | Where-Object { (Get-Field $_ 't') -eq 'deny' })) {
    $key = '{0}|{1}|{2}' -f (Get-Field $r 'role'), (Get-Field $r 'category'), (Get-Field $r 'method')
    $denials[$key] = [int]$denials[$key] + 1
  }
  foreach ($k in $denials.Keys) { $failures.Add("denial $k count=$($denials[$k])") }

  if ((Get-Sha256 $configPath) -ne $configSha) { $failures.Add('config-changed') }
  $sourceAfter = Get-SourceHashes
  foreach ($n in $sourceBefore.Keys) {
    if ($sourceAfter[$n] -ne $sourceBefore[$n]) { $failures.Add("source-changed $n") }
  }
  foreach ($f in (Test-Installed)) { $failures.Add("installed-changed $f") }

  $provAfter = Get-Provenance
  foreach ($pr in $provAfter.Problems) { $failures.Add("provenance-after $pr") }
  $provAfterSha = Write-Provenance $provAfter (Join-Path $runDir 'provenance-after.json')
  $provDiff = Compare-Provenance $provBefore $provAfter
  $provChanged = $provDiff.added.Count + $provDiff.deleted.Count + $provDiff.modified.Count
  if ($provChanged -gt 0 -or $provDiff.excludedChanged) {
    [IO.File]::WriteAllText((Join-Path $runDir 'provenance-diff.json'), ($provDiff | ConvertTo-Json -Depth 3), $Utf8NoBom)
    foreach ($kind in @('added', 'deleted', 'modified')) {
      if ($provDiff[$kind].Count -gt 0) { $failures.Add("provenance-$kind count=$($provDiff[$kind].Count) (provenance-diff.json)") }
    }
    if ($provDiff.excludedChanged) { $failures.Add('provenance-excluded-set-changed (provenance-diff.json)') }
  }

  $receiptPath = Join-Path $captureDir 'receipt.json'
  $receipt = $null
  if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
    $r = [IO.File]::ReadAllText($receiptPath) | ConvertFrom-Json
    $receipt = [ordered]@{ sha256 = Get-Sha256 $receiptPath; complete = Get-Field $r 'complete'; totals = Get-Field $r 'totals' }
    if ((Get-Field $r 'complete') -ne $true) { $failures.Add('receipt-incomplete') }
  } else { $failures.Add('receipt-missing') }

  $owned = New-List
  foreach ($e in $own.Order) {
    [void]$owned.Add([ordered]@{
        pid = $e.Pid; parentPid = $e.ParentPid; createdUtc = $e.CreatedUtc.ToString('o'); exe = $e.Exe
        known = $e.Known; role = $e.Role; outcome = $e.Outcome
      })
  }
  foreach ($e in $own.Order) { if ($e.Role -ne 'main') { $e.Proc.Dispose() } }

  $guardClean = ($failures.Count -eq 0)
  $summary = [ordered]@{
    runId           = $runId
    profile         = "capture-$Mode"
    command         = $command
    cwd             = $RepoRoot
    nodeVersion     = $nodeVersion
    nodePid         = $nodePid
    exitCode        = $exitCode
    harnessExit     = $(switch ($exitCode) { 0 { 0 } 12 { 2 } 13 { 3 } default { $null } })
    timedOut        = $timedOut
    configSha256    = $configSha
    sourceSha256    = $sourceBefore
    provenance      = [ordered]@{
      beforeSha256 = $provBeforeSha; afterSha256 = $provAfterSha; files = $provBefore.SortedKeys.Count
      excluded = $provBefore.Excluded.Count; added = $provDiff.added.Count; deleted = $provDiff.deleted.Count
      modified = $provDiff.modified.Count
    }
    harnessArgs     = $harnessArgs
    readyCount      = $ready.Count
    launchCount     = $guarded.Count
    rollupReports   = $rollupLaunches.Count
    viteNetUseProbes = $compatRecords.Count
    nativeLaunches  = $nativeCounts
    nativeLoads     = $nativeLoads.Count
    denials         = $denials
    ownedProcesses  = $owned
    receipt         = $receipt
    failures        = @($failures)
    guardClean      = $guardClean
    verdict         = 'NOT A PASS: guard/ledger result only. Screens and videos need human review; native processes are not OS-proven offline.'
  }
  [IO.File]::WriteAllText((Join-Path $runDir 'summary.json'), ($summary | ConvertTo-Json -Depth 6), $Utf8NoBom)
  return [pscustomobject]@{ RunDir = $runDir; ExitCode = $exitCode; Failures = @($failures); GuardClean = $guardClean }
}

try {
  [void][IO.Directory]::CreateDirectory($RunsRoot)
  $result = Invoke-CaptureRun
} catch {
  Write-Host "REFUSED/ERROR: $($_.Exception.Message)"
  exit 2
}
Write-Host "capture-$Mode run: $($result.RunDir)"
if (-not $result.GuardClean) {
  foreach ($f in $result.Failures) { Write-Host "FAIL: $f" }
  Write-Host "capture-$Mode : FAIL"
  exit 1
}
if ($result.ExitCode -ne 0) {
  Write-Host "capture-$Mode : guard-clean; capture recorded failures/unverified states (harness exit $(if ($result.ExitCode -eq 12) { 2 } else { 3 })). Review receipt."
  exit 3
}
Write-Host "capture-$Mode : guard-clean, capture exit 0. Evidence for human review, not a PASS."
exit 0
