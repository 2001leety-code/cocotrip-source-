#requires -Version 7.0
<#
  resolve-lock-20261017.ps1 - one-shot resolver for the whole-file package-lock.json conflict.

  Baseline = OURS (HEAD: LLM/main changes, incl. @anthropic-ai/sdk) kept byte-for-byte.
  Adds exactly two raw-text insertions taken from THEIRS (HOME):
    1. root dependency line   "gsap": "3.15.0"         (between googleapis / html2pdf.js)
    2. packages entry          "node_modules/gsap": {..} (between graceful-fs / gtoken)
  Line endings: this is a known source-EOL conflict, not corruption. The OURS body is LF, the
  THEIRS body is CRLF and the git markers are LF, so the whole conflicted file is mixed by design.
  Each side is extracted raw and must be internally consistent; OURS EOL is the output style and
  only the two inserted THEIRS snippets are converted to it. OURS itself is never normalized.
  No JSON reserialization, no npm, no network. Reads only package-lock.json + package.json
  in $RepoRoot and writes only package-lock.json. Fails closed on any unexpected layout or
  on any THEIRS semantic difference that would otherwise be silently discarded.

  Run (PowerShell 7; -AsHashtable is needed for the "" root key):
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\integration\resolve-lock-20261017.ps1 -DryRun
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\integration\resolve-lock-20261017.ps1
#>
[CmdletBinding()]
param([switch]$DryRun)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = 'E:\ai에이젼시만들기\versions\cocotrip-integration-20261017'
$GsapKey = 'node_modules/gsap'
$GsapVersion = '3.15.0'
$AllowedOursOnlyRootDeps = @('@anthropic-ai/sdk')
$Utf8Strict = [Text.UTF8Encoding]::new($false, $true)

function Fail([string]$msg) { throw "resolve-lock: $msg" }

function Get-OrdinalCount([string]$hay, [string]$needle) {
  $n = 0; $i = 0
  while (($i = $hay.IndexOf($needle, $i, [StringComparison]::Ordinal)) -ge 0) { $n++; $i += $needle.Length }
  return $n
}

# Order-independent canonical string for deep equality of parsed JSON values.
function ConvertTo-Canon($v) {
  if ($null -eq $v) { return 'null' }
  if ($v -is [string]) { return (ConvertTo-Json -InputObject $v -Compress) }
  if ($v -is [bool]) { return $v.ToString().ToLowerInvariant() }
  if ($v -is [datetime]) { return 'date:' + $v.ToString('o') }
  if ($v -is [System.Collections.IDictionary]) {
    $keys = [string[]]@($v.Keys); [Array]::Sort($keys, [StringComparer]::Ordinal)
    $parts = [Collections.Generic.List[string]]::new()
    foreach ($k in $keys) { $parts.Add((ConvertTo-Json -InputObject $k -Compress) + ':' + (ConvertTo-Canon $v[$k])) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($v -is [System.Collections.IList]) {
    $parts = [Collections.Generic.List[string]]::new()
    foreach ($x in $v) { $parts.Add((ConvertTo-Canon $x)) }
    return '[' + ($parts -join ',') + ']'
  }
  return [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $v)
}

function Get-Eol([string]$t, [string]$what) {
  $crlf = Get-OrdinalCount $t "`r`n"; $lf = Get-OrdinalCount $t "`n"; $cr = Get-OrdinalCount $t "`r"
  if ($crlf -gt 0 -and $crlf -eq $lf -and $crlf -eq $cr) { return "`r`n" }
  if ($crlf -eq 0 -and $cr -eq 0 -and $lf -gt 0) { return "`n" }
  Fail "$what has mixed/unknown line endings (CRLF=$crlf LF=$lf CR=$cr)"
}

function Assert-SafeFile([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  if ([IO.Path]::GetDirectoryName($full) -ne $RepoRoot) { Fail "path escapes repo root: $full" }
  $item = Get-Item -LiteralPath $full -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "refusing reparse point: $full" }
  return $full
}

# --- paths --------------------------------------------------------------------------------
$rootItem = Get-Item -LiteralPath $RepoRoot -Force
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'repo root is a reparse point' }
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { Fail 'repo root has no .git' }
$expectedScriptDir = Join-Path $RepoRoot 'scripts\integration'
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne $expectedScriptDir) { Fail "script not running from $expectedScriptDir (got $PSScriptRoot)" }
$lockPath = Assert-SafeFile (Join-Path $RepoRoot 'package-lock.json')
$pkgPath = Assert-SafeFile (Join-Path $RepoRoot 'package.json')

# --- read + layout ------------------------------------------------------------------------
$origBytes = [IO.File]::ReadAllBytes($lockPath)
$hasBom = $origBytes.Length -ge 3 -and $origBytes[0] -eq 0xEF -and $origBytes[1] -eq 0xBB -and $origBytes[2] -eq 0xBF
$bomLen = 0; if ($hasBom) { $bomLen = 3 }
$text = $Utf8Strict.GetString($origBytes, $bomLen, $origBytes.Length - $bomLen)
if (-not $text.StartsWith("<<<<<<< ours`n", [StringComparison]::Ordinal) -and -not $text.StartsWith("<<<<<<< ours`r`n", [StringComparison]::Ordinal)) {
  Fail "line 1 is not '<<<<<<< ours' (already resolved?)"
}
$markerCount = [regex]::Matches($text, '(?m)^(<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)').Count
if ($markerCount -ne 3) { Fail "expected exactly 3 conflict marker lines, found $markerCount" }

# Marker lines are anchored on \r?\n; side bodies are captured raw (each including its final EOL).
$conflictRx = [regex]::new('\A<<<<<<< ours\r?\n(?<ours>.*?\n)=======\r?\n(?<theirs>.*?\n)>>>>>>> theirs\r?\n\z', [Text.RegularExpressions.RegexOptions]::Singleline)
$cm = $conflictRx.Match($text)
if (-not $cm.Success) { Fail 'file is not exactly <<<<<<< ours / ======= / >>>>>>> theirs wrapping the whole lock' }
$oursText = $cm.Groups['ours'].Value
$theirsText = $cm.Groups['theirs'].Value

$oursEol = Get-Eol $oursText 'OURS body'
$theirsEol = Get-Eol $theirsText 'THEIRS body'
if (-not $oursText.EndsWith($oursEol, [StringComparison]::Ordinal)) { Fail 'OURS body does not end with its EOL' }
if (-not $theirsText.EndsWith($theirsEol, [StringComparison]::Ordinal)) { Fail 'THEIRS body does not end with its EOL' }
$oursLineCount = Get-OrdinalCount $oursText "`n"; $theirsLineCount = Get-OrdinalCount $theirsText "`n"
if ($oursLineCount -ne 19163) { Fail "OURS has $oursLineCount lines (expected 19163)" }
if ($theirsLineCount -ne 19107) { Fail "THEIRS has $theirsLineCount lines (expected 19107)" }
$oursEolName = 'LF'; if ($oursEol -eq "`r`n") { $oursEolName = 'CRLF' }
$theirsEolName = 'LF'; if ($theirsEol -eq "`r`n") { $theirsEolName = 'CRLF' }

$ours = ConvertFrom-Json -InputObject $oursText -AsHashtable -Depth 200
$theirs = ConvertFrom-Json -InputObject $theirsText -AsHashtable -Depth 200
$pkg = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($pkgPath, $Utf8Strict)) -AsHashtable -Depth 50

# --- semantic diff OURS vs THEIRS: only gsap may be THEIRS-only -----------------------------
$diffs = [Collections.Generic.List[string]]::new()
$topKeys = @(@($ours.Keys) + @($theirs.Keys) | Sort-Object -Unique -CaseSensitive)
foreach ($k in $topKeys) {
  if ($k -ceq 'packages') { continue }
  if ((ConvertTo-Canon $ours[$k]) -cne (ConvertTo-Canon $theirs[$k])) { $diffs.Add("top-level '$k' differs") }
}
$oP = $ours['packages']; $tP = $theirs['packages']
if ($null -eq $oP -or $null -eq $tP -or -not $oP.ContainsKey('') -or -not $tP.ContainsKey('')) { Fail 'packages / root entry missing' }
if ($oP.ContainsKey($GsapKey)) { Fail "OURS already contains $GsapKey (already resolved?)" }
if (-not $tP.ContainsKey($GsapKey)) { Fail "THEIRS lacks $GsapKey" }

$tG = $tP[$GsapKey]
$gsapProps = @($tG.Keys | Sort-Object -CaseSensitive) -join ','
if ($gsapProps -cne 'integrity,license,resolved,version') { Fail "gsap entry has unexpected props ($gsapProps); transitive deps would need handling" }
if ($tG['version'] -cne $GsapVersion -or $tG['resolved'] -cne "https://registry.npmjs.org/gsap/-/gsap-$GsapVersion.tgz" -or -not ([string]$tG['integrity']).StartsWith('sha512-')) {
  Fail 'THEIRS gsap version/resolved/integrity not as expected'
}

foreach ($k in $tP.Keys) {
  if ($k -ceq '' -or $k -ceq $GsapKey) { continue }
  if (-not $oP.ContainsKey($k)) { $diffs.Add("THEIRS-only package: $k") }
  elseif ((ConvertTo-Canon $oP[$k]) -cne (ConvertTo-Canon $tP[$k])) { $diffs.Add("package differs: $k") }
}
$oursOnly = @($oP.Keys | Where-Object { $_ -cne '' -and -not $tP.ContainsKey($_) } | Sort-Object -CaseSensitive)
if ($oursOnly -cnotcontains 'node_modules/@anthropic-ai/sdk') { Fail 'expected node_modules/@anthropic-ai/sdk to be OURS-only' }

$oR = $oP['']; $tR = $tP['']
$rootKeys = @(@($oR.Keys) + @($tR.Keys) | Sort-Object -Unique -CaseSensitive)
foreach ($k in $rootKeys) {
  if ($k -ceq 'dependencies') { continue }
  if ((ConvertTo-Canon $oR[$k]) -cne (ConvertTo-Canon $tR[$k])) { $diffs.Add("root '$k' differs") }
}
$oD = $oR['dependencies']; $tD = $tR['dependencies']
if ($oD.ContainsKey('gsap')) { Fail 'OURS root already depends on gsap' }
if ($tD['gsap'] -cne $GsapVersion) { Fail "THEIRS root gsap is not $GsapVersion" }
foreach ($k in $tD.Keys) {
  if ($k -ceq 'gsap') { continue }
  if (-not $oD.ContainsKey($k) -or $oD[$k] -cne $tD[$k]) { $diffs.Add("root dependency differs: $k") }
}
foreach ($k in $oD.Keys) {
  if (-not $tD.ContainsKey($k) -and $AllowedOursOnlyRootDeps -cnotcontains $k) { $diffs.Add("unexpected OURS-only root dependency: $k") }
}
if ($diffs.Count -gt 0) {
  $diffs | ForEach-Object { Write-Host "  DIFF $_" }
  Fail "$($diffs.Count) THEIRS difference(s) beyond gsap would be discarded; add an explicit rule first"
}
if ($pkg['dependencies']['gsap'] -cne $GsapVersion) { Fail "package.json gsap is not $GsapVersion" }

# --- raw text insertions -------------------------------------------------------------------
# THEIRS is searched with THEIRS EOL; anchors and inserted text use OURS EOL.
$depText1 = '        "googleapis": "^171.4.0",'
$depText2 = '        "html2pdf.js": "^0.14.0",'
$gsapDepText = '        "gsap": "' + $GsapVersion + '",'
if ((Get-OrdinalCount $theirsText ($depText1 + $theirsEol + $gsapDepText + $theirsEol + $depText2 + $theirsEol)) -ne 1) { Fail 'THEIRS root gsap line not found exactly once at expected position' }
$depLine1 = $depText1 + $oursEol
$depLine2 = $depText2 + $oursEol
$gsapDepLine = $gsapDepText + $oursEol
if ((Get-OrdinalCount $oursText ($depLine1 + $depLine2)) -ne 1) { Fail 'OURS googleapis/html2pdf.js anchor not unique' }
$firstNm = $oursText.IndexOf('    "node_modules/', [StringComparison]::Ordinal)
$i1 = $oursText.IndexOf($depLine1 + $depLine2, [StringComparison]::Ordinal) + $depLine1.Length
if ($i1 -ge $firstNm) { Fail 'OURS dependency anchor is not inside the root entry' }

$e = [regex]::Escape($theirsEol)
$sliceRx = [regex]::new('(?m)^    "node_modules/gsap": \{' + $e + '(?:      [^\r\n]*' + $e + ')*?    \},' + $e)
$m = $sliceRx.Matches($theirsText)
if ($m.Count -ne 1) { Fail "THEIRS gsap slice matched $($m.Count) times" }
$sliceRaw = $m[0].Value
$prevT = $theirsText.LastIndexOf('    "node_modules/', $m[0].Index - 1, [StringComparison]::Ordinal)
if (-not $theirsText.Substring($prevT).StartsWith('    "node_modules/graceful-fs": {' + $theirsEol, [StringComparison]::Ordinal)) { Fail 'THEIRS gsap not preceded by graceful-fs' }
if (-not $theirsText.Substring($m[0].Index + $sliceRaw.Length).StartsWith('    "node_modules/gtoken": {' + $theirsEol, [StringComparison]::Ordinal)) { Fail 'THEIRS gsap not followed by gtoken' }
# Convert ONLY the inserted THEIRS block to OURS EOL (THEIRS side is internally consistent, so no bare CR/LF).
$slice = $sliceRaw
if ($theirsEol -cne $oursEol) { $slice = $sliceRaw.Replace($theirsEol, $oursEol) }
if ((Get-Eol $slice 'converted gsap slice') -cne $oursEol) { Fail 'gsap slice EOL conversion failed' }
if ((Get-OrdinalCount $slice $oursEol) -ne (Get-OrdinalCount $sliceRaw $theirsEol)) { Fail 'gsap slice line count changed during EOL conversion' }

$gtokenAnchor = $oursEol + '    "node_modules/gtoken": {' + $oursEol
if ((Get-OrdinalCount $oursText $gtokenAnchor) -ne 1) { Fail 'OURS gtoken anchor not unique' }
$i2 = $oursText.IndexOf($gtokenAnchor, [StringComparison]::Ordinal) + $oursEol.Length
$prevO = $oursText.LastIndexOf('    "node_modules/', $i2 - 1, [StringComparison]::Ordinal)
if (-not $oursText.Substring($prevO).StartsWith('    "node_modules/graceful-fs": {' + $oursEol, [StringComparison]::Ordinal)) { Fail 'OURS gtoken not preceded by graceful-fs' }
if ($i1 -ge $i2) { Fail 'unexpected anchor order' }

$final = $oursText.Insert($i2, $slice).Insert($i1, $gsapDepLine)

# --- verify final --------------------------------------------------------------------------
if ($final.Remove($i1, $gsapDepLine.Length).Remove($i2, $slice.Length) -cne $oursText) { Fail 'final is not OURS + exactly two insertions' }
if ([regex]::IsMatch($final, '(?m)^(<<<<<<<|=======|>>>>>>>)')) { Fail 'conflict markers remain' }
if ((Get-Eol $final 'final lock') -cne $oursEol) { Fail 'final line-ending style is not OURS style' }

$fin = ConvertFrom-Json -InputObject $final -AsHashtable -Depth 200
$fP = $fin['packages']
if ((@($fin.Keys | Sort-Object -CaseSensitive) -join ',') -cne (@($ours.Keys | Sort-Object -CaseSensitive) -join ',')) { Fail 'final top-level keys differ from OURS' }
foreach ($k in $ours.Keys) {
  if ($k -cne 'packages' -and (ConvertTo-Canon $fin[$k]) -cne (ConvertTo-Canon $ours[$k])) { Fail "final top-level '$k' differs from OURS" }
}
if ($fP.Count -ne $oP.Count + 1) { Fail "final package count $($fP.Count) != OURS $($oP.Count) + 1" }
foreach ($k in $oP.Keys) {
  if ($k -ceq '') { continue }
  if (-not $fP.ContainsKey($k) -or (ConvertTo-Canon $fP[$k]) -cne (ConvertTo-Canon $oP[$k])) { Fail "final package changed: $k" }
}
if ((ConvertTo-Canon $fP[$GsapKey]) -cne (ConvertTo-Canon $tG)) { Fail 'final gsap entry != THEIRS gsap entry' }
$fR = $fP['']
foreach ($k in @(@($oR.Keys) + @($fR.Keys) | Sort-Object -Unique -CaseSensitive)) {
  if ($k -cne 'dependencies' -and (ConvertTo-Canon $fR[$k]) -cne (ConvertTo-Canon $oR[$k])) { Fail "final root '$k' differs from OURS" }
}
$expectedDeps = @{}; foreach ($k in $oD.Keys) { $expectedDeps[$k] = $oD[$k] }; $expectedDeps['gsap'] = $GsapVersion
if ((ConvertTo-Canon $fR['dependencies']) -cne (ConvertTo-Canon $expectedDeps)) { Fail 'final root dependencies != OURS + gsap' }
foreach ($k in @('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')) {
  if ((ConvertTo-Canon $fR[$k]) -cne (ConvertTo-Canon $pkg[$k])) { Fail "final lock root $k != package.json $k" }
}
if ($fR['name'] -cne $pkg['name'] -or $fR['version'] -cne $pkg['version']) { Fail 'final root name/version != package.json' }

# --- write ---------------------------------------------------------------------------------
$outBytes = [byte[]]@()
if ($hasBom) { $outBytes = [byte[]](0xEF, 0xBB, 0xBF) }
$outBytes = $outBytes + $Utf8Strict.GetBytes($final)
$hashBefore = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($origBytes))
$hashAfter = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$outBytes))

Write-Host "OK  eol ours=$oursEolName ($oursLineCount lines) theirs=$theirsEolName ($theirsLineCount lines) final=$oursEolName bom=$hasBom"
Write-Host "OK  pkgs ours=$($oP.Count) theirs=$($tP.Count) final=$($fP.Count)"
Write-Host "OK  OURS-only packages kept ($($oursOnly.Count)): $($oursOnly -join ', ')"
Write-Host "OK  inserted root dep at char $i1 and $GsapKey slice ($($slice.Length) chars) at char $i2"
Write-Host "OK  before sha256=$hashBefore"
Write-Host "OK  after  sha256=$hashAfter"
if ($DryRun) { Write-Host 'DRY RUN - package-lock.json not written'; return }

$nowBytes = [IO.File]::ReadAllBytes($lockPath)
if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($nowBytes)) -cne $hashBefore) { Fail 'package-lock.json changed during run; aborting' }
[IO.File]::WriteAllBytes($lockPath, [byte[]]$outBytes)
$readBack = [IO.File]::ReadAllBytes($lockPath)
if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($readBack)) -cne $hashAfter) { Fail 'read-back hash mismatch after write' }
Write-Host 'WROTE package-lock.json (still needs: git add package-lock.json)'
