<#
  resolve-source-20261017.ps1 -- resolve ONLY two whole-file conflicts (integration 2026-10-17).

    api/_ai_core/geminiPipeline.js
      baseline = OURS (unified LLM adapter: createLlmModel/resolveLlmModel/provider/usage/schema, LF)
      + ONLY the HOME dietary reinforcement:
        HALAL: a tag-derived [HALAL] marker alone is NOT certification; certification wording only
          where that same restaurant line states HALAL certification (the existing _food_helper
          trusted-context tier label [HALAL -- CERTIFIED]); a CERTIFIED label for another diet never counts.
        VEGAN: the HOME [VEGAN] line is taken byte-exact (no new policy).
    src/pages/PlanDetailPage/components/DayRouteMap.tsx
      THEIRS (HOME) raw, CRLF preserved -- validated superset of OURS
      (CARTO basemap + 429 / partial retry / stale-response guard / path validation / routeScopeKey).

  Conflict layout expected: "<<<<<<< ours\n" + OURS(LF) + "=======\n" + THEIRS(CRLF) + ">>>>>>> theirs\n".
  Inputs must match the approved (pinned) SHA-256. Every assertion, and the preflight of ALL targets
  and temp paths, runs before the first write. A failure before the write phase writes nothing.
  This is NOT a transaction: if the write phase fails part-way, the script prints the actual on-disk
  state (current SHA of each target, leftover temp files) and aborts -- it never claims nothing was written.
  Reads only the two files below under the fixed root. Does not stage, commit, or touch git.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\integration\resolve-source-20261017.ps1 -DryRun
          (then without -DryRun after review). Prints a SHA-256 receipt either way.
  This file is ASCII-only on purpose: non-ASCII text is built from \uXXXX escapes so
  Windows PowerShell 5.1 (ANSI script decoding) and pwsh 7 read it identically.
#>
[CmdletBinding()]
param([switch]$DryRun)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function U([string]$s) { return [regex]::Unescape($s) }
# Fail is only used before the write phase; the write phase reports real on-disk state instead.
function Fail([string]$m) { throw "ABORT (nothing written): $m" }
function Sha([byte[]]$b) {
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-', '').ToLowerInvariant() } finally { $h.Dispose() }
}
$Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
function Bytes([string]$s) { return $Utf8Strict.GetBytes($s) }

# ---------------------------------------------------------------- fixed root
$FixedRoot = 'E:\' + (U 'ai\uC5D0\uC774\uC83C\uC2DC\uB9CC\uB4E4\uAE30') + '\versions\cocotrip-integration-20261017'
$ScriptRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not [string]::Equals($ScriptRoot.TrimEnd('\'), $FixedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  Fail "script is not inside the fixed root. script root=$ScriptRoot fixed=$FixedRoot"
}
foreach ($m in @('AGENTS.md', 'CLAUDE.md', '.git')) {
  if (-not (Test-Path -LiteralPath (Join-Path $FixedRoot $m))) { Fail "fixed root marker missing: $m" }
}

function Resolve-Target([string]$rel) {
  $full = [System.IO.Path]::GetFullPath((Join-Path $FixedRoot $rel))
  if (-not $full.StartsWith($FixedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { Fail "path escapes root: $rel" }
  $item = Get-Item -LiteralPath $full
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Fail "reparse point refused: $rel" }
  return $full
}

# ---------------------------------------------------------------- conflict split
function Split-Conflict([string]$path) {
  $raw = [System.IO.File]::ReadAllBytes($path)
  if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { Fail "unexpected UTF-8 BOM: $path" }
  $text = $Utf8Strict.GetString($raw)                       # throws on invalid UTF-8
  if ((Sha (Bytes $text)) -ne (Sha $raw)) { Fail "UTF-8 round-trip not lossless: $path" }
  foreach ($pair in @(@('(?m)^<<<<<<< ', 1), @('(?m)^=======\r?$', 1), @('(?m)^>>>>>>> ', 1))) {
    $n = [regex]::Matches($text, $pair[0]).Count
    if ($n -ne $pair[1]) { Fail "expected exactly one marker /$($pair[0])/, found $n in $path" }
  }
  $m = [regex]::Match($text, '\A<<<<<<< ours\n(?<ours>[\s\S]*\n)=======\n(?<theirs>[\s\S]*\r\n)>>>>>>> theirs\n?\z')
  if (-not $m.Success) { Fail "not a whole-file ours/theirs conflict with LF markers: $path" }
  $ours = $m.Groups['ours'].Value
  $theirs = $m.Groups['theirs'].Value
  if ($ours.Contains("`r")) { Fail "OURS side is not pure LF: $path" }
  if ([regex]::IsMatch($theirs, '(?<!\r)\n')) { Fail "THEIRS side has a bare LF (mixed EOL): $path" }
  if ([regex]::IsMatch($theirs, '\r(?!\n)')) { Fail "THEIRS side has a bare CR: $path" }
  return [pscustomobject]@{ Raw = $raw; RawSha = (Sha $raw); Ours = $ours; Theirs = $theirs }
}

function Lines-Of([string]$s) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($l in ($s -split "\r?\n")) { $t = $l.Trim(); if ($t) { [void]$set.Add($t) } }
  return ,$set
}
# Lines present in $a but absent from $b must each match one allowed pattern (both directions are checked by callers).
function Assert-OnlyExpectedMissing([string]$a, [string]$b, [string[]]$allowed, [string]$what) {
  $bs = Lines-Of $b
  $bad = @()
  foreach ($t in (Lines-Of $a)) {
    if ($bs.Contains($t)) { continue }
    $ok = $false
    foreach ($p in $allowed) { if ([regex]::IsMatch($t, $p)) { $ok = $true; break } }
    if (-not $ok) { $bad += $t }
  }
  if ($bad.Count) { Fail ("$what -- unexpected lines:`n  " + ($bad -join "`n  ")) }
}
function Assert-Contains([string]$s, [string[]]$needles, [string]$what) {
  foreach ($n in $needles) { if (-not $s.Contains($n)) { Fail "$what missing: $n" } }
}
function Count-Of([string]$s, [string]$needle) { return ([regex]::Matches($s, [regex]::Escape($needle))).Count }
function Replace-Once([string]$s, [string]$old, [string]$new) {
  $n = Count-Of $s $old
  if ($n -ne 1) { Fail "patch anchor must occur exactly once (found $n): $old" }
  return $s.Replace($old, $new)
}

# Approved conflicted INPUT hashes (reviewed). Compared case-insensitively; any other input -> abort.
$ApprovedInSha = @{
  'api/_ai_core/geminiPipeline.js'                     = '2689E9BA73FC8B1B4C7386D1C2F3E706F2E40B28F3FA63FEBABD36605DD75040'
  'src/pages/PlanDetailPage/components/DayRouteMap.tsx' = '9252589C0B08D4CFCC448BB5FB177E98FBC09054CF69ADA07BEFEF06D15E28E7'
}
function Assert-ApprovedInput([string]$rel, [string]$sha) {
  if (-not [string]::Equals($sha, $ApprovedInSha[$rel], [StringComparison]::OrdinalIgnoreCase)) {
    Fail "$rel input sha $sha is not the approved input $($ApprovedInSha[$rel])"
  }
}

$plan = @()

# ================================================================ geminiPipeline.js
$gemPath = Resolve-Target 'api\_ai_core\geminiPipeline.js'
$g = Split-Conflict $gemPath
Assert-ApprovedInput 'api/_ai_core/geminiPipeline.js' $g.RawSha

# Each side internally consistent with what it claims to be.
Assert-Contains $g.Ours @(
  "import { createLlmModel, resolveLlmModel, resolveLlmProvider } from '../_shared/llm/index.js';",
  "return createLlmModel({",
  "}, { role: 'main', stage: 'planner-main', apiKey, forceModelOverride: opts.forceModelOverride, isAdminBypass: opts.isAdminBypass, identifierForBucketing: opts.identifierForBucketing });",
  "resolveLlmProvider('main') === 'gemini'",
  "responseSchema: PLAN_RESPONSE_SCHEMA,",
  "applyDBMatcher(itinerary, foodIndex, area, language);",
  "validateResponse(itinerary, { lang: language, dietary: dietaryArr, styles: body?.styles }, foodIndex);",
  "buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);"
) 'OURS geminiPipeline'
if ($g.Ours.Contains('@google/generative-ai')) { Fail 'OURS geminiPipeline imports the Gemini SDK directly' }
Assert-Contains $g.Theirs @("import { GoogleGenerativeAI } from '@google/generative-ai';", 'whose line is marked [HALAL]') 'THEIRS geminiPipeline'
foreach ($side in @(@('OURS', $g.Ours), @('THEIRS', $g.Theirs))) {
  if ((Count-Of $side[1] 'export { PLAN_RESPONSE_SCHEMA };') -ne 1) { Fail "$($side[0]) geminiPipeline must export PLAN_RESPONSE_SCHEMA exactly once" }
}

# Semantic difference must be exactly the reference diff (LLM adapter vs SDK + dietary lines), nothing else.
Assert-OnlyExpectedMissing $g.Ours $g.Theirs @(
  '^import \{ createLlmModel, resolveLlmModel, resolveLlmProvider \} from ''\.\./_shared/llm/index\.js'';$',
  '^// LLM ',
  '^// Gemini .*responseSchema',
  '^const model = \(/pro/i\.test\(stage\) && resolveLlmProvider\(''main''\) === ''gemini''\)$',
  '^: resolveLlmModel\(''main''\);$',
  '^return createLlmModel\(\{$',
  '^\}, \{ role: ''main'', stage: ''planner-main'', ',
  '^''- Halal: ONLY recommend restaurants explicitly certified or verified Halal\.'',$',
  '^''  reassurances like "no pork served"\. Phrase it positively: "100% halal menu"\.'',$',
  '^''- Vegan: ONLY plant-based restaurants\. NEVER recommend places serving'',$'
) 'OURS-only gemini lines'
Assert-OnlyExpectedMissing $g.Theirs $g.Ours @(
  '^import \{ GoogleGenerativeAI \} from ''@google/generative-ai'';$',
  '^const model = /pro/i\.test\(stage\)$',
  '^: resolveGeminiModel\(''main''\);$',
  '^const genAI = new GoogleGenerativeAI\(apiKey\);$',
  '^return genAI\.getGenerativeModel\(\{$',
  '^\}\);$',
  '^''- Halal: ONLY recommend restaurants from the provided list whose line is marked \[HALAL\] ',
  '^''  reassurances like "no pork served"\. Phrase it positively and without certification claims,'',$',
  '^''  e\.g\. "halal-friendly menu \(verified in our DB\)"\. Never write ',
  '^''- Vegan: ONLY plant-based restaurants\. NEVER claim "100% vegan"'
) 'THEIRS-only gemini lines'

# Apply ONLY the beneficial HOME reinforcement, with the [HALAL]=certified contradiction removed.
# HALAL: the planner context (getFoodContext) derives [HALAL] from r.tag only, so friendly and certified
# rows get the same marker. The only existing per-restaurant HALAL-certification marker in the codebase is
# the trusted-context tier label "[HALAL -- CERTIFIED]" (_food_helper getExactCityTrustedFoodContext,
# halal_certified). A CERTIFIED label for another diet ("[VEGAN -- CERTIFIED]") is not halal evidence.
# Positive certified behavior is unchanged: applyDBMatcher still appends the halal_certified note from DB evidence.
$I = '      '
$certKo = U '\uC778\uC99D'   # Korean "certification"
$em = U '\u2014'             # em dash used by _food_helper tier labels
$halalCertLabel = "[HALAL $em CERTIFIED]"
$veganCertLabel = "[VEGAN $em CERTIFIED]"
# VEGAN: HOME line, byte-exact (must exist verbatim on the THEIRS side).
$veganHome = "'- Vegan: ONLY plant-based restaurants. NEVER claim `"100% vegan`"/`"vegan restaurant`" unless the line is marked [VEGAN] in the provided list. NEVER recommend places serving',"
Assert-Contains $g.Theirs @(($I + $veganHome + "`r`n")) 'THEIRS geminiPipeline HOME vegan line'
$gemOut = $g.Ours
$gemOut = Replace-Once $gemOut ($I + "'- Halal: ONLY recommend restaurants explicitly certified or verified Halal.',`n") (
  $I + "'- Halal: ONLY recommend restaurants from the provided list whose line is marked [HALAL].',`n" +
  $I + "'  [HALAL] means our DB lists halal-friendly evidence for that restaurant - it is NOT halal certification.',`n")
$gemOut = Replace-Once $gemOut ($I + "'  reassurances like `"no pork served`". Phrase it positively: `"100% halal menu`".',`n") (
  $I + "'  reassurances like `"no pork served`". Phrase it positively and without certification claims,',`n" +
  $I + "'  e.g. `"halal-friendly menu (listed in our DB)`". Never write `"certified`", `"100%`", or `"$certKo`" unless the restaurant line is marked [HALAL] AND that same line states halal certification for that restaurant ($halalCertLabel).',`n" +
  $I + "'  A [HALAL] marker by itself is never certification; a CERTIFIED label for another diet (e.g. $veganCertLabel) is never halal certification.',`n")
$gemOut = Replace-Once $gemOut ($I + "'- Vegan: ONLY plant-based restaurants. NEVER recommend places serving',`n") ($I + $veganHome + "`n")

# Output assertions (before write).
if ($gemOut.Contains("`r")) { Fail 'gemini output must stay LF (OURS baseline EOL)' }
if ([regex]::IsMatch($gemOut, '(?m)^(<<<<<<<|=======|>>>>>>>)')) { Fail 'gemini output still has conflict markers' }
if ([regex]::IsMatch($gemOut, '100%\s*halal', 'IgnoreCase')) { Fail 'gemini output still asks for "100% halal"' }
if ($gemOut.Contains('explicitly certified or verified Halal') -or $gemOut.Contains('(DB-certified)')) { Fail 'contradictory halal wording survived' }
if ($gemOut.Contains('explicitly says CERTIFIED (operator-verified)')) { Fail 'generic (diet-agnostic) CERTIFIED wording present' }
if ((Count-Of $gemOut ($I + $veganHome + "`n")) -ne 1) { Fail 'HOME vegan line must appear exactly once, byte-exact' }
if ($gemOut.Contains('@google/generative-ai')) { Fail 'gemini output reintroduced the direct SDK import' }
if ((Count-Of $gemOut 'export { PLAN_RESPONSE_SCHEMA };') -ne 1) { Fail 'gemini output PLAN_RESPONSE_SCHEMA export count != 1' }
Assert-Contains $gemOut @(
  "import { createLlmModel, resolveLlmModel, resolveLlmProvider } from '../_shared/llm/index.js';",
  'whose line is marked [HALAL]',
  "Never write `"certified`", `"100%`", or `"$certKo`" unless the restaurant line is marked [HALAL]",
  "that same line states halal certification for that restaurant ($halalCertLabel)",
  'A [HALAL] marker by itself is never certification;',
  'NEVER claim "100% vegan"',
  'Do NOT write the words "pork/',
  'mention "halal" or "',
  'Mark each food stop with `dietary_tags: ["vegan"]`'
) 'gemini output'
if ((Count-Of $gemOut 'buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);') -ne (Count-Of $g.Ours 'buildDietaryReinforcedPrompt(systemPrompt, dietaryArr);')) { Fail 'reinforced-prompt call sites changed' }
$plan += [pscustomobject]@{ Rel = 'api/_ai_core/geminiPipeline.js'; Path = $gemPath; InSha = $g.RawSha; Policy = 'OURS(LF)+HOME dietary lines (halal corrected, vegan byte-exact)'; Out = (Bytes $gemOut); OursSha = (Sha (Bytes $g.Ours)); TheirsSha = (Sha (Bytes $g.Theirs)) }

# ================================================================ DayRouteMap.tsx
$mapPath = Resolve-Target 'src\pages\PlanDetailPage\components\DayRouteMap.tsx'
$d = Split-Conflict $mapPath
Assert-ApprovedInput 'src/pages/PlanDetailPage/components/DayRouteMap.tsx' $d.RawSha

Assert-Contains $d.Ours @("import { CARTO_VOYAGER_URL, CARTO_TILE_OPTIONS } from '@/lib/basemap';", 'export function DayRouteMap(') 'OURS DayRouteMap'
Assert-Contains $d.Theirs @(
  "import { CARTO_VOYAGER_URL, CARTO_TILE_OPTIONS } from '@/lib/basemap';",
  'L.tileLayer(CARTO_VOYAGER_URL, { ...CARTO_TILE_OPTIONS }).addTo(map);',
  "import { chunkPath, pointsToSegments, stepsToSegments, type RoutePoint, type TransitStepLike } from '@/lib/routeSegments';",
  "export function DayRouteMap({ stops, routeScopeKey = '' }: DayRouteMapProps) {",
  'if (res.status === 429) {',
  "settle(fetchedLegs, 'rateLimited', true);",
  "settle(legs, found ? 'partial' : 'none', true);",
  'labels.retryMissing',
  'const isCurrent = () => requestRef.current === request',
  'if (!isCurrent()) return;',
  'signal: request.controller.signal,',
  'segment.steps_detail.every(isRouteStep)',
  'if (step.path !== undefined && !chunkPath(step.path)) return false;',
  'json.legsLookedUp',
  'const legs: Record<number, TransitStepLike[]> = { ...fetchedLegs };',
  'naverMapDirectionsUrl(',
  'data-testid="day-route-map"',
  'function escapeHtml(s: string): string {'
) 'THEIRS DayRouteMap'
# Superset check: every OURS line is in THEIRS, except the lines THEIRS deliberately replaced.
Assert-OnlyExpectedMissing $d.Ours $d.Theirs @(
  '^import \{ useEffect, useId, useRef, useState \} from ''react'';$',
  '^import \{ pointsToSegments, type RoutePoint, type TransitStepLike \} from ''@/lib/routeSegments'';$',
  '^title: string; easy: string; hard: string; showRoute: string; loading: string;$',
  '^none: string; openNaver: string; naverCapped: string;$',
  '^case ''(ko|ja|zh)'': return \{ title: ',
  '^default: return \{ title: ',
  '^export function DayRouteMap\(\{ stops \}: DayRouteMapProps\) \{$',
  '^// Stable id so multiple day maps on one page never collide\.$',
  '^const \[failed, setFailed\] = useState\(false\);$',
  '^// Compute points once per render',
  '^// whether to render at all ',
  '^// \(2026-07-19\) ',
  '^// .*Firestore',
  '^// .*segment\.to = points',
  '^const \[fetchedLegs, setFetchedLegs\] = useState',
  '^const \[routeBusy, setRouteBusy\] = useState\(false\);$',
  '^const \[routeMsg, setRouteMsg\] = useState',
  '^const canFetchRoute = realLegs === 0 && enoughPoints;$',
  '^setRouteBusy\((true|false)\);$',
  '^setRouteMsg\((null|labels\.none)\);$',
  '^const legs: Record<number, TransitStepLike\[\]> = \{\};$',
  '^for \(const s of \(Array\.isArray\(json\?\.segments\)',
  '^if \(typeof s\?\.to === ''number'' && Array\.isArray\(s\.steps_detail\)\) legs\[s\.to\] = s\.steps_detail;$',
  '^setFetchedLegs\(legs\);$',
  '^if \(!Object\.keys\(legs\)\.length\) setRouteMsg\(labels\.none\);$',
  '^const segmentsKey = ',
  '^if \(!cancelled\) setFailed\(true\);$',
  '^\}, \[enoughPoints, JSON\.stringify\(points\.map',
  '^if \(!enoughPoints \|\| failed\) return null;$',
  '^\{routeBusy \? labels\.loading : labels\.showRoute\}$',
  '^\{routeMsg && <p className="mt-2 px-0\.5 text-\[12px\] text-ec-ink-2">\{routeMsg\}</p>\}$'
) 'OURS-only DayRouteMap lines (THEIRS must supersede OURS)'

# Dependencies THEIRS needs must exist in the current tree (read-only check of one helper file).
$segSrc = [System.IO.File]::ReadAllText((Resolve-Target 'src\lib\routeSegments.ts'), $Utf8Strict)
foreach ($e in @('export function chunkPath(', 'export function stepsToSegments(', 'export function pointsToSegments(')) {
  if (-not $segSrc.Contains($e)) { Fail "src/lib/routeSegments.ts lacks $e (THEIRS DayRouteMap depends on it)" }
}
$mapOut = $d.Theirs
if ([regex]::IsMatch($mapOut, '(?m)^(<<<<<<<|=======|>>>>>>>)')) { Fail 'DayRouteMap output still has conflict markers' }
$plan += [pscustomobject]@{ Rel = 'src/pages/PlanDetailPage/components/DayRouteMap.tsx'; Path = $mapPath; InSha = $d.RawSha; Policy = 'THEIRS raw (CRLF preserved)'; Out = (Bytes $mapOut); OursSha = (Sha (Bytes $d.Ours)); TheirsSha = (Sha (Bytes $d.Theirs)) }

# ================================================================ receipt + write
Write-Host ("resolve-source-20261017  mode=" + $(if ($DryRun) { 'DRY-RUN (no writes)' } else { 'WRITE' }))
foreach ($p in $plan) {
  Write-Host ("- {0}`n    policy     : {1}`n    input  sha : {2}`n    ours   sha : {3}`n    theirs sha : {4}`n    output sha : {5}  ({6} bytes)" -f $p.Rel, $p.Policy, $p.InSha, $p.OursSha, $p.TheirsSha, (Sha $p.Out), $p.Out.Length)
}
# ---------------------------------------------------------------- preflight (read-only; ALL targets before any write)
foreach ($p in $plan) {
  $p | Add-Member -NotePropertyName Tmp -NotePropertyValue ($p.Path + '.resolve-20261017.tmp')
  $p | Add-Member -NotePropertyName OutSha -NotePropertyValue (Sha $p.Out)
  [void](Resolve-Target $p.Rel.Replace('/', '\'))                       # still inside root, still not a reparse point
  $attr = [System.IO.File]::GetAttributes($p.Path)
  if ($attr -band [System.IO.FileAttributes]::ReadOnly) { Fail "target is read-only: $($p.Rel)" }
  $cur = Sha ([System.IO.File]::ReadAllBytes($p.Path))                  # TOCTOU: byte-identical to what was validated
  if ($cur -ne $p.InSha) { Fail "$($p.Rel) changed since validation (now $cur)" }
  Assert-ApprovedInput $p.Rel $cur
  if (Test-Path -LiteralPath $p.Tmp) { Fail "stale temp path exists: $($p.Tmp)" }
  $tmpDir = [System.IO.Path]::GetDirectoryName($p.Tmp)
  if (-not [System.IO.Directory]::Exists($tmpDir)) { Fail "temp directory missing: $tmpDir" }
  if (-not $p.Tmp.StartsWith($FixedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { Fail "temp path escapes root: $($p.Tmp)" }
}
if ($DryRun) { Write-Host 'DRY-RUN complete: all assertions and write preflight passed, nothing written.'; return }

# ---------------------------------------------------------------- write (not a transaction)
function Write-DiskState {
  foreach ($q in $plan) {
    $now = try { Sha ([System.IO.File]::ReadAllBytes($q.Path)) } catch { 'UNREADABLE: ' + $_.Exception.Message }
    $state = if ($now -eq $q.OutSha) { 'WRITTEN (output sha)' } elseif ($now -eq $q.InSha) { 'unchanged (input sha)' } else { 'MODIFIED (neither input nor output sha)' }
    Write-Host ("  {0}`n    state      : {1}`n    current sha: {2}" -f $q.Rel, $state, $now)
    if (Test-Path -LiteralPath $q.Tmp) { Write-Host "    temp left  : $($q.Tmp)" }
  }
}
try {
  foreach ($p in $plan) {
    [System.IO.File]::WriteAllBytes($p.Tmp, $p.Out)
    if ((Sha ([System.IO.File]::ReadAllBytes($p.Tmp))) -ne $p.OutSha) { throw "temp readback mismatch: $($p.Rel)" }
    [System.IO.File]::Copy($p.Tmp, $p.Path, $true)
    Remove-Item -LiteralPath $p.Tmp
    if ((Sha ([System.IO.File]::ReadAllBytes($p.Path))) -ne $p.OutSha) { throw "post-write hash mismatch: $($p.Rel)" }
    Write-Host ("  written  {0}  sha={1}" -f $p.Rel, $p.OutSha)
  }
} catch {
  $why = $_.Exception.Message
  Write-Host 'WRITE PHASE FAILED. Actual on-disk state (do NOT assume nothing was written):'
  Write-DiskState
  throw "ABORT during write phase (see on-disk state above): $why"
}
Write-Host 'Done. Files are written but still unmerged in the index; root stages them after review.'
