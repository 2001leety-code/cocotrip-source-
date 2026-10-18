#Requires -Version 5.1
<#
.SYNOPSIS
  Offline guard supervisor, phase 2. Fixed, enumerated modes only; no free-form command.
.DESCRIPTION
  -Mode selfcheck (default)  canary + negative, each in a fresh run dir (phase-1 self-check).
  -Mode install              npm ci from the existing cache only. Must run first, once; refuses if
                             node_modules or the install manifest already exists. On PASS writes the
                             install manifest (versions, pinned file hashes, native inventory).
  -Mode tsc | vite-build | eslint | vitest-unit
                             Refuse unless the install manifest re-verifies (lock hash, versions, files).
  -UnitSelector targeted|full|rules  vitest-unit only. targeted = the three integration-20261017 tests,
                             llm-esm-load-smoke, and the two fetch-isolation regressions (p226-inngest-dispatch-
                             decoupling, route-transition.component). rules = the full-unit rules helper test only. full = every
                             unit test, with the full-unit rules helper and the plan-local loader admission.
  -Mode plan-test            node scripts\plan-local\run.mjs (default scenario sample) with the loader admission.
  -Mode fullunit-canary      full-unit boundary canary (helper vectors, Git, denials; exact table).
  -Mode loadercheck          module.register loader canary: `ok` must pass, each negative must fail exactly.
  Exit code: 0 = pass; 1 = run/self-check failed; 2 = refused or setup error.
#>
[CmdletBinding()]
param(
  [ValidateSet('selfcheck', 'install', 'tsc', 'vite-build', 'eslint', 'vitest-unit', 'plan-test', 'fullunit-canary', 'loadercheck')]
  [string]$Mode = 'selfcheck',
  [ValidateSet('targeted', 'full', 'rules')][string]$UnitSelector = 'targeted'
)
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$NodePath = 'C:\Program Files\nodejs\node.exe'
$NpmCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
$NpmCache = 'C:\Users\dlxod\AppData\Local\npm-cache'
$OfflineDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $OfflineDir)
if ((Split-Path -Leaf $RepoRoot) -ne 'cocotrip-integration-20261017') { throw "unexpected repo root: $RepoRoot" }
$PreservationRoot = $RepoRoot + '-preservation'
$RunsRoot = Join-Path $PreservationRoot 'runs'
$ManifestPath = Join-Path (Join-Path $PreservationRoot 'offline-install') 'install-manifest.json'
$NodeModules = Join-Path $RepoRoot 'node_modules'
$GuardPath = Join-Path $OfflineDir 'guard.cjs'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Repo([string]$Rel) { return (Join-Path $RepoRoot $Rel) }

# esbuild.exe is pinned to the known 0.27.2 binary; it must match after install and before every use.
$Esbuild = @{
  Rel    = 'node_modules\@esbuild\win32-x64\esbuild.exe'
  Sha256 = '2c9cd2a3e77a434394e4de328dad9fc09c85d2b528db3ae040f07ff84877f5c3'
  Size   = 11365376
  Args   = @('--service=0.27.2', '--ping')
  Stdio  = @('pipe', 'pipe', 'inherit')
}
# Rollup's native addon has no externally known hash: it is pinned from the lock-verified install.
$RollupRel = 'node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node'
$LockedVersions = [ordered]@{
  'typescript'                    = '5.9.3'
  'vite'                          = '7.3.6'
  'vitest'                        = '4.1.11'
  'eslint'                        = '9.39.5'
  '@playwright/test'              = '1.62.1'
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
# Recorded if present. vitest-unit requires it (approved --require path for Vitest forks).
$SuppressWarningsRel = 'node_modules\vitest\suppress-warnings.cjs'
$OptionalPinned = @($SuppressWarningsRel)
# Installed sources whose exact behaviour the guard rules were written against (read from the installed
# code, not the manifest, which stays unchanged). Checked before and after vite-build / vitest-unit.
# native.js: the `node -p` report probe translated to rollup-platform.cjs.
# cli-api chunk: Vitest fork execArgv (import-meta-resolve, suppress-warnings, --conditions node/development).
$RollupNativeJs = @{ Rel = 'node_modules\rollup\dist\native.js'; Sha256 = '93c3da450b25ba485bb3de20dded405aa9c105951e8d31964eeb49633c2b16ea' }
$VitestCliApi = @{ Rel = 'node_modules\vitest\dist\chunks\cli-api.CnMVyzaz.js'; Sha256 = 'a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e' }
# vite config.js: optimizeSafeRealPathSync's exec('net use', cb) at line 2230 (answered with an async
# OFFLINE_PLATFORM_PROBE_DISABLED callback error, no child), and resolveHostname's localhost DNS (2343/2355).
$ViteConfigJs = @{ Rel = 'node_modules\vite\dist\node\chunks\config.js'; Sha256 = 'c2fcfa51206dc1f8d22120ef4a82af8b9acdc02f4476520b6a0897d12a724ba3'; Line = 2230 }
$ViteProbeCode = 'OFFLINE_PLATFORM_PROBE_DISABLED'
$RollupPlatform = Join-Path $OfflineDir 'rollup-platform.cjs'

# browser-native-rules.cjs is required by guard.cjs only in the browser profile; hashed here as a guard dependency.
# full-unit-rules.cjs is required only in vitest-unit full / fullunit-canary; the loader canary files only run in loadercheck.
$OfflineSources = @('guard.cjs', 'canary-main.cjs', 'canary-child.cjs', 'canary-worker.cjs', 'canary-negative.cjs',
  'rollup-platform.cjs', 'browser-native-rules.cjs', 'Run-Offline.ps1', 'full-unit-rules.cjs', 'fullunit-canary.cjs',
  'loader-canary-main.mjs', 'loader-canary-register.mjs', 'loader-canary-hooks.mjs', 'loader-canary-hooks-net.mjs',
  'loader-canary-hooks-reregister.mjs', 'loader-canary-hooks-throw.mjs', 'loader-canary-probe.mjs')
$TargetedTests = @(
  'tests/unit/integration-20261017-llm-compare-outcome.test.ts',
  'tests/unit/integration-20261017-mood-parse-mock-chain.test.ts',
  'tests/unit/integration-20261017-halal-tag-only-not-certified.test.ts',
  'tests/unit/llm-esm-load-smoke.test.ts',
  'tests/unit/p226-inngest-dispatch-decoupling.test.ts',
  'tests/unit/route-transition.component.test.tsx'
)
$FixtureDir = Repo 'tests\fixtures\integration-20261017'
$FixtureFiles = @(
  'llm-compare-all-pass.json', 'llm-compare-provider-error.json', 'llm-compare-structure-error.json',
  'llm-compare-missing-scenario.json', 'does-not-exist.json', 'esm-load-core.mjs', 'esm-load-dup.mjs', 'esm-dup-export.mjs'
)
# Hashed before and after every run; any change fails the run. does-not-exist.json must stay 'missing'.
$RepoInputs = @(
  'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json',
  'tsconfig.node.json', 'eslint.config.js', 'scripts\integration\vite-offline-20261017.config.ts',
  'scripts\integration\vitest-offline-20261017.config.ts', 'scripts\llm-compare-providers.mjs',
  'scripts\integration\llm-compare-outcome.mjs'
) + @($FixtureFiles | ForEach-Object { 'tests\fixtures\integration-20261017\' + $_ }) +
  @($TargetedTests | ForEach-Object { $_.Replace('/', '\') })

# Exact expected denials per "role|category|method". Extra OR missing denials fail the run,
# so expected canary denials cannot mask any other attempt. Product profiles = empty table.
$CanaryExpected = @{
  'main|external|fetch'                        = 1
  'main|external|http.get'                     = 1
  'main|external|https.request'                = 1
  'main|external|http2.connect'                = 1
  'main|loopback|net.connect'                  = 1
  'main|local-pipe|net.connect'                = 1
  'main|external|net.Socket.connect'           = 1
  'main|loopback|net.createConnection'         = 1
  'main|external|tls.connect'                  = 1
  'main|dns|dns.lookup'                        = 1
  'main|dns|dns.promises.lookup'               = 1
  'main|dns|dns.Resolver.resolveTxt'           = 1
  'main|dns|dns.promises.Resolver.resolve4'    = 1
  'main|udp|dgram.createSocket'                = 1
  'main|native|process.binding'                = 1
  'main|external|http.request'                 = 1
  'main|child-shell|child_process.exec'        = 1
  'main|child-args|child_process.spawn'        = 1
  'main|child-exe|child_process.spawn'         = 1
  'main|child-env|child_process.spawn'         = 1
  'main|child-execargv|child_process.fork'     = 1
  'main|child-shell|child_process.spawn'       = 1
  'main|child-entry|child_process.spawnSync'   = 1
  'main|child-direct|ChildProcess.spawn'       = 1
  'main|child-args|child_process.execFileSync' = 1
  'main|worker-execargv|worker_threads.Worker' = 1
  'main|worker-env|worker_threads.Worker'      = 2
  'main|worker-eval|worker_threads.Worker'     = 1
  'main|worker-entry|worker_threads.Worker'    = 1
  'child|external|fetch'                       = 3
  'child|dns|dns.promises.lookup'              = 3
  'worker|loopback|net.connect'                = 1
  'worker|external|fetch'                      = 1
}
# The negative fixture must produce exactly these denials, with a raw exit code of 0.
$NegativeCaught = @{
  'main|external|net.connect' = 1
  'main|external|fetch'       = 1
}

# ---- full-unit rules helper (vitest-unit full, fullunit-canary) ----
$FullUnitRulesPath = Join-Path $OfflineDir 'full-unit-rules.cjs'
# Same values as GIT_PIN in full-unit-rules.cjs. Pins only cmd\git.exe, not the mingw64 git.exe or DLLs it loads.
$GitPin = @{ Path = 'C:\Program Files\Git\cmd\git.exe'; Size = 46480; Sha256 = '81ef35ae005ca9318018d18e3327578ce939fb99feaad6b2d7c8ab15f3de8db5' }
$GitRuleIds = @('git:check-ignore:android-owner/app/upload.jks', 'git:check-ignore:android-owner/app/keys/release.keystore',
  'git:check-ignore:android-owner/deep/signing/release.p12', 'git:check-ignore:android-owner/app/release.pfx',
  'git:check-ignore:android-owner/app/local.properties', 'git:check-ignore:android-owner/app/keystore.properties',
  'git:ls-files-stage-gradlew')
$FullUnitNodeRuleIds = @('node:projection-worker:first-hold-600', 'node:projection-worker:second-hold-0',
  'node:projection-worker:bad-root-exit-64', 'node:projection-exit', 'node:audit-gate:file-utf8', 'node:audit-gate:file-pipe',
  'node:audit-gate:no-file', 'node:test-quality-metrics', 'node:enrich-busan:refusal', 'node:enrich-city-restaurants:refusal',
  'node:openmontage-brief:help', 'node:openmontage-brief:bad-locale', 'node:plan-local:sample', 'node:plan-local:daycount-mismatch')
# The fullunit-canary must produce exactly these denials (all from its main process) and exit 0.
$FullUnitCanaryExpected = @{
  'main|full-unit|child_process.spawnSync'        = 5
  'main|full-unit-git|child_process.execFileSync' = 1
  'main|child-exe|child_process.spawnSync'        = 1
  'main|full-unit|child_process.fork'             = 1
  'main|loader-register|module.register'          = 1
}

# ---- plan-local runner and its module.register admission (vitest-unit full, plan-test) ----
# _mocks.mjs installMocks() registers _loader.mjs at line 140 with three fixed mock URLs. The lines are
# checked as text before every run (moved/changed = refused); the file hashes go into the hashed config.
$PlanDir = 'scripts\plan-local'
$PlanLoader = @{
  Runner = "$PlanDir\run.mjs"; Caller = "$PlanDir\_mocks.mjs"; Line = 140; Fn = 'installMocks'; Loader = "$PlanDir\_loader.mjs"
  FnLine = 137; FnText = @('export function installMocks() {')
  CallText = @('register(LOADER_URL, import.meta.url, {', 'data: {', 'axiosMockUrl: AXIOS_MOCK_URL,',
    'firestoreAdminMockUrl: FIRESTORE_ADMIN_MOCK_URL,', 'transitProviderMockUrl: TRANSIT_PROVIDER_MOCK_URL,', '},', '});')
  Data = [ordered]@{
    axiosMockUrl           = "$PlanDir\_axios-mock.mjs"
    firestoreAdminMockUrl  = "$PlanDir\_firestore-admin-mock.mjs"
    transitProviderMockUrl = "$PlanDir\_transit-provider-mock.mjs"
  }
}
$PlanRunnerRuleIds = @('node:plan-local:sample', 'node:plan-local:daycount-mismatch')
$PlanInputs = @("$PlanDir\run.mjs", "$PlanDir\_mocks.mjs", "$PlanDir\_loader.mjs", "$PlanDir\_axios-mock.mjs",
  "$PlanDir\_firestore-admin-mock.mjs", "$PlanDir\_transit-provider-mock.mjs", "$PlanDir\_pipeline.mjs",
  "$PlanDir\fixtures\sample-blocks.json", "$PlanDir\fixtures\sample-selection.json", "$PlanDir\fixtures\sample-userinput.json",
  # run.mjs prefers these when blocks-sample.json exists; currently absent, hashed as 'missing' to pin that.
  "$PlanDir\fixtures\blocks-sample.json", "$PlanDir\fixtures\selection-sample.json", "$PlanDir\fixtures\userinput-sample.json")
# Written and removed by plan-local-prewrite-quality-gate.test.ts: must be missing before (else refused) and after
# (they are hashed as inputs, so a leftover fails the run). Nothing else under fixtures/ or outputs/ is excluded.
$PlanGenerated = @("$PlanDir\fixtures\blocks-__test_daycount_mismatch__.json", "$PlanDir\fixtures\selection-__test_daycount_mismatch__.json",
  "$PlanDir\fixtures\userinput-__test_daycount_mismatch__.json", "$PlanDir\outputs\plan-__test_daycount_mismatch__.json")
# The sample artifact: plan-test requires it to be (re)written by the run; full records it.
$PlanArtifactRel = "$PlanDir\outputs\plan-sample.json"
# Entries, libs and source tests behind the full-unit vectors (hashed before/after in full, rules, fullunit-canary).
$FullUnitInputs = @('tests\unit\integration-20261017-offline-full-unit-rules.test.ts',
  'tests\unit\apply-brain-guide-projection.test.ts', 'tests\unit\audit-gate.test.ts',
  'tests\unit\quality-metrics-structural-false-positives.test.ts', 'tests\unit\paid-google-scripts-consent.test.ts',
  'tests\unit\owner-controller-preflight.test.ts', 'tests\unit\owner-android-workflow.test.ts',
  'tests\unit\openmontage-brief.test.ts', 'tests\unit\plan-local-prewrite-quality-gate.test.ts',
  'tests\fixtures\integration-20261017\projection-worker.mjs', 'tests\fixtures\integration-20261017\projection-exit.mjs',
  'scripts\apply-brain-guide-projection.lib.mjs', 'scripts\brain-guide-projection.lib.mjs', 'scripts\audit-gate.mjs',
  'scripts\test-quality-metrics.mjs', 'scripts\enrich-busan.mjs', 'scripts\enrich-city-restaurants.mjs',
  'scripts\export-openmontage-brief.mjs', 'scripts\lib\openmontage-brief.mjs', '.gitignore') + $PlanInputs
$HelperTest = 'tests/unit/integration-20261017-offline-full-unit-rules.test.ts'

# ---- loader canary (loadercheck): separately enumerated caller/loader, never the plan-local files ----
$LoaderCanary = @{
  Runner = Join-Path $OfflineDir 'loader-canary-main.mjs'; Caller = Join-Path $OfflineDir 'loader-canary-register.mjs'
  Line = 9; Fn = 'registerCanary'; FnLine = 8; FnText = @('export function registerCanary(...args) {')
  CallText = @('return register(...args);'); Probe = Join-Path $OfflineDir 'loader-canary-probe.mjs'
}
# Same mapping as HOOKS in loader-canary-main.mjs; every other variant uses loader-canary-hooks.mjs.
$LoaderCanaryHooks = @{
  'loader-network' = 'loader-canary-hooks-net.mjs'; 'loader-reregister' = 'loader-canary-hooks-reregister.mjs'
  'register-throws' = 'loader-canary-hooks-throw.mjs'
}
# Each variant is its own run. ok must PASS. Every other run must FAIL; each Expect pattern must match a
# failure line, every failure line must match Expect or Allow, and ExitZero requires raw exit 0 (caught).
$MainRegisterDenied = '^denial-count main\|loader-register\|module\.register expected=0 actual=1$'
$NoRegistration = '^loader-launch-count pid=\d+ count=0$'
$AnyExit = '^exit-code -?\d+$'
$LoaderVariants = [ordered]@{
  'ok'                 = @{ Pass = $true }
  'wrong-caller'       = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'wrong-specifier'    = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'wrong-parent'       = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'wrong-data'         = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'extra-option'       = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'own-proto'          = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'overload'           = @{ ExitZero = $true; Expect = @($MainRegisterDenied, $NoRegistration) }
  'not-admitted'       = @{ ExitZero = $true; Expect = @($MainRegisterDenied) }
  'second'             = @{ ExitZero = $true; Expect = @($MainRegisterDenied) }
  'loader-network'     = @{ ExitZero = $true; Expect = @('^denial-count loader\|loopback\|net\.connect expected=0 actual=1$') }
  'loader-reregister'  = @{ ExitZero = $true; Expect = @('^denial-count loader\|loader-register\|module\.register expected=0 actual=1$') }
  'register-throws'    = @{ ExitZero = $true; Expect = @($MainRegisterDenied, '^loader-not-complete \S+ count=0$') }
  # StartupFatal: the internal worker preload may end the process before main prints its completion marker.
  'reuse-id'           = @{ StartupFatal = $true; Expect = @('^denial-count loader\|loader-admission\|loader-preload expected=0 actual=1$', $MainRegisterDenied,
      '^loader-ready-mismatch ', '^loader-not-complete \S+ count=0$'); Allow = @($AnyExit) }
  'missing-ready'      = @{ StartupFatal = $true; Expect = @($MainRegisterDenied, '^loader-not-ready '); Allow = @($AnyExit) }
  'dup-ready'          = @{ ExitZero = $true; Expect = @('^loader-ready-count \S+ count=2$') }
  'mismatch-ready'     = @{ ExitZero = $true; Expect = @('^loader-ready-mismatch ') }
  'unregistered-ready' = @{ ExitZero = $true; Expect = @('^loader-ready-unregistered ') }
}

function Get-Field($Object, [string]$Name) {
  $p = $Object.PSObject.Properties[$Name]
  if ($p) { return $p.Value }
  return $null
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Returns an ArrayList whose elements are the arguments as given (arrays stay nested in JSON).
function New-List {
  $l = New-Object System.Collections.ArrayList
  foreach ($a in $args) { [void]$l.Add($a) }
  return , $l
}

# $Extra: profile-specific repo inputs (full-unit / plan-local), on top of the fixed $RepoInputs.
function Get-SourceHashes([string[]]$Extra = @()) {
  $h = [ordered]@{}
  foreach ($n in $OfflineSources) { $h['scripts\offline\' + $n] = Get-Sha256 (Join-Path $OfflineDir $n) }
  foreach ($r in @($RepoInputs) + @($Extra)) {
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

function Get-FilePin([string]$Rel) {
  $p = Repo $Rel
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
  return [ordered]@{ sha256 = Get-Sha256 $p; size = (Get-Item -LiteralPath $p).Length }
}

# ---- install manifest: written once after a passing install, re-verified before/after every product run ----
function New-InstallManifest([string]$RunId) {
  $fail = New-Object System.Collections.Generic.List[string]
  $versions = [ordered]@{}
  foreach ($n in $LockedVersions.Keys) {
    $v = Get-PackageVersion $n
    $versions[$n] = $v
    if ($v -ne $LockedVersions[$n]) { $fail.Add("version-mismatch $n expected=$($LockedVersions[$n]) actual=$v") }
  }
  $files = [ordered]@{}
  foreach ($r in $PinnedFiles) {
    $pin = Get-FilePin $r
    if ($null -eq $pin) { $fail.Add("pinned-missing $r") } else { $files[$r] = $pin }
  }
  $optional = [ordered]@{}
  foreach ($r in $OptionalPinned) {
    $pin = Get-FilePin $r
    if ($null -eq $pin) { $optional[$r] = [ordered]@{ present = $false } }
    else { $optional[$r] = [ordered]@{ present = $true; sha256 = $pin.sha256; size = $pin.size } }
  }
  $eb = $files[$Esbuild.Rel]
  if ($eb -and ($eb.sha256 -ne $Esbuild.Sha256 -or $eb.size -ne $Esbuild.Size)) { $fail.Add('esbuild-hash-mismatch') }

  # Informational: every native binary that arrived. Only the pinned ones are ever allowed.
  $scanErrors = @()
  $inventory = New-Object System.Collections.ArrayList
  $found = @(Get-ChildItem -LiteralPath $NodeModules -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable scanErrors |
      Where-Object { @('.node', '.exe') -contains $_.Extension.ToLowerInvariant() })
  foreach ($f in $found) {
    [void]$inventory.Add([ordered]@{ path = $f.FullName.Substring($RepoRoot.Length + 1); size = $f.Length; sha256 = Get-Sha256 $f.FullName })
  }
  if ($fail.Count -gt 0) { return @($fail) }

  $manifest = [ordered]@{
    schema            = 1
    createdByRun      = $RunId
    packageLockSha256 = Get-Sha256 (Repo 'package-lock.json')
    npmCliSha256      = Get-Sha256 $NpmCli
    versions          = $versions
    files             = $files
    optional          = $optional
    nativeInventory   = $inventory
    inventoryErrors   = @($scanErrors).Count
  }
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $ManifestPath))
  [IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json -Depth 6), $Utf8NoBom)
  (Get-Item -LiteralPath $ManifestPath).IsReadOnly = $true
  return @()
}

function Test-InstallManifest {
  $fail = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return @{ Failures = @('install-manifest-missing (run -Mode install first)'); Manifest = $null } }
  $m = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
  if ((Get-Field $m 'packageLockSha256') -ne (Get-Sha256 (Repo 'package-lock.json'))) { $fail.Add('package-lock changed since install') }
  foreach ($n in $LockedVersions.Keys) {
    $v = Get-PackageVersion $n
    if ($v -ne $LockedVersions[$n]) { $fail.Add("version-mismatch $n actual=$v") }
  }
  foreach ($p in (Get-Field $m 'files').PSObject.Properties) {
    $pin = Get-FilePin $p.Name
    if ($null -eq $pin) { $fail.Add("pinned-missing $($p.Name)") }
    elseif ($pin.sha256 -ne $p.Value.sha256 -or $pin.size -ne $p.Value.size) { $fail.Add("pinned-hash-mismatch $($p.Name)") }
  }
  foreach ($r in $PinnedFiles) {
    if (-not (Get-Field $m 'files').PSObject.Properties[$r]) { $fail.Add("manifest-lacks $r") }
  }
  foreach ($p in (Get-Field $m 'optional').PSObject.Properties) {
    $pin = Get-FilePin $p.Name
    if ($p.Value.present) {
      if ($null -eq $pin -or $pin.sha256 -ne $p.Value.sha256 -or $pin.size -ne $p.Value.size) { $fail.Add("optional-hash-mismatch $($p.Name)") }
    } elseif ($null -ne $pin) { $fail.Add("optional-appeared $($p.Name)") }
  }
  $eb = Get-FilePin $Esbuild.Rel
  if ($null -eq $eb -or $eb.sha256 -ne $Esbuild.Sha256 -or $eb.size -ne $Esbuild.Size) { $fail.Add('esbuild-hash-mismatch') }
  return @{ Failures = @($fail); Manifest = $m }
}

function Test-CompatPins([string]$ProfileName) {
  $fail = New-Object System.Collections.Generic.List[string]
  $pins = New-Object System.Collections.ArrayList
  if (@('vite-build', 'vitest-unit') -contains $ProfileName) { [void]$pins.Add($RollupNativeJs); [void]$pins.Add($ViteConfigJs) }
  if ($ProfileName -eq 'vitest-unit') { [void]$pins.Add($VitestCliApi) }
  foreach ($p in $pins) {
    $path = Repo $p.Rel
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $fail.Add("compat-missing $($p.Rel)") }
    elseif ((Get-Sha256 $path) -ne $p.Sha256) { $fail.Add("compat-hash-mismatch $($p.Rel)") }
  }
  return @($fail)
}

# The pinned register call must still be exactly these (trimmed) lines; otherwise the run is refused.
function Assert-SourceLines([string]$Path, [int]$Line, [string[]]$Expected) {
  $lines = [IO.File]::ReadAllLines($Path)
  for ($i = 0; $i -lt $Expected.Count; $i++) {
    $n = $Line - 1 + $i
    if ($n -ge $lines.Count -or $lines[$n].Trim() -ne $Expected[$i]) { throw "pinned register call moved or changed: $Path line $($n + 1)" }
  }
}

# Hashed-config admission for one module.register call (see guard.cjs). Paths absolute; hashes taken now and
# re-checked by the guard before the call and by the supervisor (source hashes) after the run.
function New-LoaderAdmission([string]$Runner, [string]$Caller, [int]$Line, [string]$Fn, [string]$Loader, $Data, [string[]]$RuleIds) {
  $items = New-Object System.Collections.ArrayList
  foreach ($k in $Data.Keys) { [void]$items.Add([ordered]@{ key = $k; path = $Data[$k]; sha256 = Get-Sha256 $Data[$k] }) }
  return [ordered]@{
    runner        = [ordered]@{ path = $Runner; sha256 = Get-Sha256 $Runner }
    runnerRuleIds = @($RuleIds)
    caller        = [ordered]@{ path = $Caller; sha256 = Get-Sha256 $Caller; line = $Line; fn = $Fn }
    loader        = [ordered]@{ path = $Loader; sha256 = Get-Sha256 $Loader }
    data          = $items
  }
}

function New-PlanAdmission([string[]]$RuleIds) {
  $caller = Repo $PlanLoader.Caller
  Assert-SourceLines $caller $PlanLoader.FnLine $PlanLoader.FnText
  Assert-SourceLines $caller $PlanLoader.Line $PlanLoader.CallText
  $data = [ordered]@{}
  foreach ($k in $PlanLoader.Data.Keys) { $data[$k] = Repo $PlanLoader.Data[$k] }
  return New-LoaderAdmission (Repo $PlanLoader.Runner) $caller $PlanLoader.Line $PlanLoader.Fn (Repo $PlanLoader.Loader) $data $RuleIds
}

# policy.runTmp is filled in with the run's own TMP/TEMP once the run dir exists.
function New-FullUnitRules {
  return [ordered]@{
    path   = $FullUnitRulesPath
    sha256 = Get-Sha256 $FullUnitRulesPath
    policy = [ordered]@{ repoRoot = $RepoRoot; runTmp = $null; gitPath = $GitPin.Path }
  }
}

# ---- fixed profiles: entry, args, env, rules. Nothing here comes from the caller except the enums ----
function Get-ProfileDef([string]$Name, $Manifest, [string]$Variant = '') {
  $esbuildExe = [ordered]@{ path = Repo $Esbuild.Rel; sha256 = $Esbuild.Sha256; size = $Esbuild.Size; args = $Esbuild.Args; stdio = $Esbuild.Stdio }
  $rollupAddon = $null
  if ($Manifest) {
    $pin = (Get-Field $Manifest 'files').PSObject.Properties[$RollupRel].Value
    $rollupAddon = [ordered]@{ path = Repo $RollupRel; sha256 = $pin.sha256; size = $pin.size }
  }
  $def = @{
    Kind = 'product'; Args = @(); Env = [ordered]@{}; TimeoutMs = 900000; Expected = @{}
    ChildRules = (New-List); WorkerEntries = @(); NativeExe = @(); NativeAddons = @(); RequireForkEntry = $null
    RollupReport = $null; ViteNetUseProbe = $null
    FullUnitRules = $null; LoaderAdmission = $null; ExtraInputs = @(); MustStayMissing = @(); PlanArtifact = $null
    RequirePlanArtifact = $false; Variant = $null
  }
  # Rollup's exact `node -p` report probe -> fixed rollup-platform.cjs, and Vite's exact `net use`
  # probe -> async callback error (vite-build / vitest-unit only).
  $rollupReport = $null
  $viteProbe = $null
  if (@('vite-build', 'vitest-unit') -contains $Name) {
    $rollupReport = [ordered]@{
      nativeJs = Repo $RollupNativeJs.Rel; nativeJsSha256 = $RollupNativeJs.Sha256
      entry = $RollupPlatform; entrySha256 = Get-Sha256 $RollupPlatform
    }
    $viteProbe = [ordered]@{ configJs = Repo $ViteConfigJs.Rel; configJsSha256 = $ViteConfigJs.Sha256; line = $ViteConfigJs.Line }
  }
  switch ($Name) {
    'canary' {
      $def.Kind = 'canary'; $def.Entry = Join-Path $OfflineDir 'canary-main.cjs'; $def.TimeoutMs = 120000
      $def.Expected = $CanaryExpected
      $def.ChildRules = New-List ([ordered]@{
          entry = Join-Path $OfflineDir 'canary-child.cjs'; argSets = (New-List @('spawn') @('fork') @('sync'))
          execArgvFlags = @(); execArgvRequire = @(); execArgvPairs = @(); envPass = @()
        })
      $def.WorkerEntries = @(Join-Path $OfflineDir 'canary-worker.cjs')
    }
    'negative' {
      $def.Kind = 'canary'; $def.Entry = Join-Path $OfflineDir 'canary-negative.cjs'; $def.TimeoutMs = 120000
    }
    'install' {
      $def.Kind = 'install'; $def.Entry = $NpmCli
      $def.Args = @('ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier')
    }
    'tsc' { $def.Entry = Repo 'node_modules\typescript\bin\tsc'; $def.Args = @('-b') }
    'vite-build' {
      $def.Entry = Repo 'node_modules\vite\bin\vite.js'
      $def.Args = @('build', '--config', 'scripts/integration/vite-offline-20261017.config.ts')
      # The offline config requires a numeric port even for build; nothing may listen (allowlist empty).
      $def.Env = [ordered]@{ PRERENDER = '0'; COCOTRIP_OFFLINE_PORT = '5192' }
      $def.NativeExe = @($esbuildExe); $def.NativeAddons = @($rollupAddon); $def.RollupReport = $rollupReport
      $def.ViteNetUseProbe = $viteProbe
    }
    'eslint' { $def.Entry = Repo 'node_modules\eslint\bin\eslint.js'; $def.Args = @('.') }
    'plan-test' {
      # package.json plan:test without npm or a shell: node <R>\scripts\plan-local\run.mjs, no arguments
      # (run.mjs defaults to `sample`), cwd = R. The process is admitted for its one module.register.
      $def.Entry = Repo $PlanLoader.Runner; $def.TimeoutMs = 600000
      $def.LoaderAdmission = New-PlanAdmission @()
      $def.ExtraInputs = @($PlanInputs) + @($PlanGenerated); $def.MustStayMissing = $PlanGenerated
      $def.PlanArtifact = Repo $PlanArtifactRel; $def.RequirePlanArtifact = $true
    }
    'fullunit-canary' {
      $def.Kind = 'canary'; $def.Entry = Join-Path $OfflineDir 'fullunit-canary.cjs'; $def.TimeoutMs = 180000
      $def.Expected = $FullUnitCanaryExpected
      $def.FullUnitRules = New-FullUnitRules
      $def.ExtraInputs = @($FullUnitInputs) + @($PlanGenerated); $def.MustStayMissing = $PlanGenerated
    }
    'loader-canary' {
      if (-not $LoaderVariants.Contains($Variant)) { throw "unknown loader canary variant: $Variant" }
      $def.Kind = 'canary'; $def.Entry = $LoaderCanary.Runner; $def.Args = @($Variant); $def.TimeoutMs = 120000
      $def.Variant = $Variant
      Assert-SourceLines $LoaderCanary.Caller $LoaderCanary.FnLine $LoaderCanary.FnText
      Assert-SourceLines $LoaderCanary.Caller $LoaderCanary.Line $LoaderCanary.CallText
      $hooks = 'loader-canary-hooks.mjs'
      if ($LoaderCanaryHooks.ContainsKey($Variant)) { $hooks = $LoaderCanaryHooks[$Variant] }
      # not-admitted: the admitted runner is another file, so this main process is not admitted.
      $runner = $LoaderCanary.Runner
      if ($Variant -eq 'not-admitted') { $runner = $LoaderCanary.Probe }
      $hooksPath = Join-Path $OfflineDir $hooks
      $probeData = [ordered]@{ probeUrl = $LoaderCanary.Probe }
      $def.LoaderAdmission = New-LoaderAdmission $runner $LoaderCanary.Caller $LoaderCanary.Line $LoaderCanary.Fn $hooksPath $probeData @()
    }
    'vitest-unit' {
      $def.Entry = Repo 'node_modules\vitest\vitest.mjs'; $def.TimeoutMs = 600000
      $def.Args = @('run', '--config', 'scripts/integration/vitest-offline-20261017.config.ts')
      if ($UnitSelector -eq 'targeted') { $def.Args += $TargetedTests }
      elseif ($UnitSelector -eq 'rules') { $def.Args += @($HelperTest); $def.ExtraInputs = $FullUnitInputs }
      else {
        # full: no filter; the helper vectors and the plan-local loader admission (two run.mjs children).
        $def.TimeoutMs = 3600000
        $def.FullUnitRules = New-FullUnitRules
        $def.LoaderAdmission = New-PlanAdmission $PlanRunnerRuleIds
        $def.ExtraInputs = @($FullUnitInputs) + @($PlanGenerated); $def.MustStayMissing = $PlanGenerated
        $def.PlanArtifact = Repo $PlanArtifactRel
      }
      $def.NativeExe = @($esbuildExe); $def.NativeAddons = @($rollupAddon); $def.RollupReport = $rollupReport
      $def.ViteNetUseProbe = $viteProbe
      $def.RequireForkEntry = 'forks.js'
      # execArgv as built by cli-api resolveOptions + resolveConditions (Vite server conditions minus
      # `module`; development|production -> development). Pairs are exact; no other --conditions value.
      $forks = [ordered]@{
        entry = Repo 'node_modules\vitest\dist\workers\forks.js'; argSets = (New-List @())
        execArgvFlags = @('--experimental-import-meta-resolve'); execArgvRequire = @(Repo $SuppressWarningsRel)
        execArgvPairs = (New-List @('--conditions', 'node') @('--conditions', 'development'))
        envPass = @('TEST', 'VITEST', 'NODE_ENV', 'VITEST_MODE', 'FORCE_TTY')
      }
      # The CLI-exit test: --evaluate on the fixed fixtures (does-not-exist.json -> exit 4) and the
      # no-argument run (exit 2 before any api/ import). Never --confirm-cost, so no paid compare.
      $compareSets = New-List @()
      foreach ($f in @('llm-compare-all-pass.json', 'llm-compare-provider-error.json', 'llm-compare-structure-error.json',
          'llm-compare-missing-scenario.json', 'does-not-exist.json')) {
        [void]$compareSets.Add(@([ordered]@{ prefix = '--evaluate='; path = Join-Path $FixtureDir $f }))
      }
      $compare = [ordered]@{
        entry = Repo 'scripts\llm-compare-providers.mjs'; argSets = $compareSets
        execArgvFlags = @(); execArgvRequire = @(); execArgvPairs = @(); envPass = @()
      }
      # Fixed real-Node ESM load runners, no arguments.
      $esmCore = [ordered]@{
        entry = Join-Path $FixtureDir 'esm-load-core.mjs'; argSets = (New-List @())
        execArgvFlags = @(); execArgvRequire = @(); execArgvPairs = @(); envPass = @()
      }
      $esmDup = [ordered]@{
        entry = Join-Path $FixtureDir 'esm-load-dup.mjs'; argSets = (New-List @())
        execArgvFlags = @(); execArgvRequire = @(); execArgvPairs = @(); envPass = @()
      }
      $def.ChildRules = New-List $forks $compare $esmCore $esmDup
    }
  }
  return $def
}

function Stop-ProcessTree([int]$RootId) {
  foreach ($k in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootId" -ErrorAction SilentlyContinue)) {
    Stop-ProcessTree ([int]$k.ProcessId)
  }
  Stop-Process -Id $RootId -Force -ErrorAction SilentlyContinue
}

function Invoke-OfflineRun {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('canary', 'negative', 'install', 'tsc', 'vite-build', 'eslint', 'vitest-unit',
      'plan-test', 'fullunit-canary', 'loader-canary')][string]$ProfileName,
    [string]$Variant = ''
  )

  # ---- preflight (throws = refused, exit 2) ----
  $manifest = $null
  if ($ProfileName -eq 'install') {
    if (Test-Path -LiteralPath $NodeModules) { throw "node_modules already exists; install runs only once into an empty tree: $NodeModules" }
    if (Test-Path -LiteralPath $ManifestPath) { throw "install manifest already exists: $ManifestPath" }
    if (-not (Test-Path -LiteralPath $NpmCache -PathType Container)) { throw "npm cache not found: $NpmCache" }
    if (-not (Test-Path -LiteralPath $NpmCli -PathType Leaf)) { throw "npm-cli.js not found: $NpmCli" }
    if (-not (Test-Path -LiteralPath (Repo 'package-lock.json') -PathType Leaf)) { throw 'package-lock.json missing' }
  } elseif (@('canary', 'negative', 'fullunit-canary', 'loader-canary') -notcontains $ProfileName) {
    $check = Test-InstallManifest
    if ($check.Failures.Count -gt 0) { throw ('install manifest does not verify: ' + ($check.Failures -join '; ')) }
    $manifest = $check.Manifest
    if ($ProfileName -eq 'vitest-unit' -and -not (Get-Field $manifest 'optional').PSObject.Properties[$SuppressWarningsRel].Value.present) {
      throw "vitest-unit needs $SuppressWarningsRel (approved fork --require path); not present in this install"
    }
    $compat = @(Test-CompatPins $ProfileName)
    if ($compat.Count -gt 0) { throw ('installed source differs from what the guard rules were written against: ' + ($compat -join '; ')) }
  }
  $def = Get-ProfileDef $ProfileName $manifest $Variant
  if (-not (Test-Path -LiteralPath $def.Entry -PathType Leaf)) { throw "entry not found: $($def.Entry)" }
  foreach ($r in @($def.MustStayMissing)) {
    if (Test-Path -LiteralPath (Repo $r)) { throw "generated test file left from an earlier run (remove it first): $r" }
  }
  if ($def.FullUnitRules) {
    $gp = $GitPin.Path
    if (-not (Test-Path -LiteralPath $gp -PathType Leaf) -or (Get-Item -LiteralPath $gp).Length -ne $GitPin.Size -or (Get-Sha256 $gp) -ne $GitPin.Sha256) {
      throw "pinned Git does not match (path/size/sha256): $gp"
    }
  }
  $artifactBefore = $null
  if ($def.PlanArtifact -and (Test-Path -LiteralPath $def.PlanArtifact -PathType Leaf)) { $artifactBefore = Get-Sha256 $def.PlanArtifact }
  $runStartUtc = [DateTime]::UtcNow

  $runId = '{0}-{1}-{2}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $ProfileName, [guid]::NewGuid().ToString('N').Substring(0, 8)
  $runDir = Join-Path $RunsRoot $runId
  if (Test-Path -LiteralPath $runDir) { throw "run dir already exists, refusing to overwrite: $runDir" }
  $ledgerDir = Join-Path $runDir 'ledger'
  $tmpDir = Join-Path $runDir 'tmp'
  $homeDir = Join-Path $runDir 'home'
  $roaming = Join-Path $homeDir 'AppData\Roaming'
  $local = Join-Path $homeDir 'AppData\Local'
  foreach ($d in @($ledgerDir, $tmpDir, $roaming, $local)) { [void][IO.Directory]::CreateDirectory($d) }

  $configPath = Join-Path $runDir 'guard-config.json'
  # NODE_OPTIONS treats backslashes inside quotes as escapes, so pass an unquoted forward-slash path.
  $guardFwd = $GuardPath.Replace('\', '/')
  if ($guardFwd -match '[\s"'']') { throw "guard path must not contain whitespace or quotes: $guardFwd" }
  $sourceBefore = Get-SourceHashes $def.ExtraInputs
  # The helper policy's runTmp is this run's fresh TMP/TEMP (outside the repo); the guard checks it equals both.
  if ($def.FullUnitRules) { $def.FullUnitRules.policy.runTmp = $tmpDir }

  # Fresh environment only: nothing inherited from the caller (no credentials, no proxies, no ADC).
  $winDir = [Environment]::GetFolderPath('Windows')
  $launcherEnv = [ordered]@{
    SystemRoot                = $winDir
    WINDIR                    = $winDir
    PATH                      = Split-Path -Parent $NodePath
    TEMP                      = $tmpDir
    TMP                       = $tmpDir
    USERPROFILE               = $homeDir
    HOME                      = $homeDir
    APPDATA                   = $roaming
    LOCALAPPDATA              = $local
    CLOUDSDK_CONFIG           = Join-Path $homeDir 'gcloud'
    METADATA_SERVER_DETECTION = 'none'
    NODE_OPTIONS              = "--require $guardFwd"
    OFFLINE_GUARD_CONFIG      = $configPath
  }
  if ($ProfileName -eq 'install') {
    # Isolated empty user/global npmrc; the shared cache is read with --offline (a miss fails).
    $npmDir = Join-Path $runDir 'npm'
    [void][IO.Directory]::CreateDirectory((Join-Path $npmDir 'logs'))
    foreach ($f in @('userconfig.npmrc', 'globalconfig.npmrc')) { [IO.File]::WriteAllText((Join-Path $npmDir $f), '', $Utf8NoBom) }
    $def.Env = [ordered]@{
      npm_config_cache           = $NpmCache
      npm_config_userconfig      = Join-Path $npmDir 'userconfig.npmrc'
      npm_config_globalconfig    = Join-Path $npmDir 'globalconfig.npmrc'
      npm_config_logs_dir        = Join-Path $npmDir 'logs'
      npm_config_offline         = 'true'
      npm_config_ignore_scripts  = 'true'
      npm_config_audit           = 'false'
      npm_config_fund            = 'false'
      npm_config_update_notifier = 'false'
      npm_config_progress        = 'false'
    }
  }
  foreach ($k in $def.Env.Keys) { $launcherEnv[$k] = [string]$def.Env[$k] }
  foreach ($k in $launcherEnv.Keys) {
    if ($k -match 'KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY') { throw "refusing sensitive-looking env key: $k" }
  }

  $config = [ordered]@{
    schema            = 3
    runId             = $runId
    profile           = $ProfileName
    nodePath          = $NodePath
    guardPath         = $GuardPath
    guardSha256       = $sourceBefore['scripts\offline\guard.cjs']
    ledgerDir         = $ledgerDir
    childRules        = $def.ChildRules
    workerEntries     = @($def.WorkerEntries)
    nativeExe         = @($def.NativeExe)
    nativeAddons      = @($def.NativeAddons)
    loopbackAllowlist = @()
    rollupReport      = $def.RollupReport
    viteNetUseProbe   = $def.ViteNetUseProbe
    launcherEnv       = $launcherEnv
  }
  # Only in the profiles that use them; every other profile's config is unchanged.
  if ($ProfileName -eq 'vitest-unit') { $config['unitSelector'] = $UnitSelector }
  if ($def.FullUnitRules) { $config['fullUnitRules'] = $def.FullUnitRules }
  if ($def.LoaderAdmission) { $config['loaderAdmission'] = $def.LoaderAdmission }
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), $Utf8NoBom)
  $configSha = Get-Sha256 $configPath
  (Get-Item -LiteralPath $configPath).IsReadOnly = $true

  $argv = @($def.Entry) + @($def.Args)
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

  Write-Host "[$ProfileName] $command"
  $proc = [Diagnostics.Process]::Start($psi)
  $nodePid = $proc.Id
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $timedOut = -not $proc.WaitForExit($def.TimeoutMs)
  if ($timedOut) {
    Stop-ProcessTree $nodePid
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
  $failures = New-Object System.Collections.Generic.List[string]
  if ($timedOut) { $failures.Add('timeout') }
  if ($exitCode -ne 0) { $failures.Add("exit-code $exitCode") }

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($f in @(Get-ChildItem -LiteralPath $ledgerDir -Filter '*.jsonl' -File)) {
    foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
      if (-not $line) { continue }
      try { $records.Add(($line | ConvertFrom-Json)) } catch { $failures.Add("ledger-parse $($f.Name)") }
    }
  }
  foreach ($r in $records) {
    if (@('ready', 'launch', 'deny', 'native-load', 'compat', 'loader-launch', 'loader-ready', 'loader-complete') -notcontains (Get-Field $r 't')) {
      $failures.Add('unknown-record')
    }
  }

  # compat = a reviewed, non-spawning answer to an exact upstream probe. Accepted only in profiles whose
  # config enables it, with the exact field set and values, and at most once per process/thread.
  $compatRecords = @($records | Where-Object { (Get-Field $_ 't') -eq 'compat' })
  $compatFields = (@('t', 'compat', 'method', 'caller', 'line', 'sourceSha256', 'result', 'role', 'pid', 'tid', 'ts') | Sort-Object) -join ','
  $compatSeen = @{}
  foreach ($r in $compatRecords) {
    $where = "pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')"
    $fields = (@($r.PSObject.Properties | ForEach-Object { $_.Name }) | Sort-Object) -join ','
    if (-not $def.ViteNetUseProbe -or $fields -ne $compatFields -or (Get-Field $r 'compat') -ne 'vite-net-use-probe' -or
        (Get-Field $r 'method') -ne 'child_process.exec' -or (Get-Field $r 'caller') -ne 'config.js' -or
        (Get-Field $r 'line') -ne $ViteConfigJs.Line -or (Get-Field $r 'sourceSha256') -ne $ViteConfigJs.Sha256 -or
        (Get-Field $r 'result') -ne $ViteProbeCode -or @('main', 'child', 'worker') -notcontains (Get-Field $r 'role')) {
      $failures.Add("compat-unexpected $where")
      continue
    }
    if ($compatSeen[$where]) { $failures.Add("compat-repeated $where") }
    $compatSeen[$where] = $true
  }

  $ready = @($records | Where-Object { (Get-Field $_ 't') -eq 'ready' })
  $launches = @($records | Where-Object { (Get-Field $_ 't') -eq 'launch' })
  $guarded = @($launches | Where-Object { (Get-Field $_ 'kind') -ne 'native' })
  $nativeLaunches = @($launches | Where-Object { (Get-Field $_ 'kind') -eq 'native' })
  $nativeLoads = @($records | Where-Object { (Get-Field $_ 't') -eq 'native-load' })
  $mainReady = @($ready | Where-Object { (Get-Field $_ 'role') -eq 'main' })
  $nodeVersion = $null
  if ($mainReady.Count -eq 1 -and (Get-Field $mainReady[0] 'pid') -eq $nodePid) {
    $nodeVersion = Get-Field $mainReady[0] 'node'
  } else {
    $failures.Add("main-not-ready count=$($mainReady.Count)")
  }
  foreach ($l in $guarded) {
    $id = Get-Field $l 'id'
    $m = @($ready | Where-Object { (Get-Field $_ 'launchId') -eq $id })
    if ($m.Count -ne 1) { $failures.Add("launch-not-ready $id count=$($m.Count)"); continue }
    if ((Get-Field $m[0] 'role') -ne (Get-Field $l 'kind')) { $failures.Add("launch-role-mismatch $id") }
    if ((Get-Field $l 'kind') -eq 'worker' -and (
        (Get-Field $m[0] 'tid') -ne (Get-Field $l 'threadId') -or (Get-Field $m[0] 'pid') -ne (Get-Field $l 'pid'))) {
      $failures.Add("worker-thread-mismatch $id")
    }
  }
  $launchIds = @($guarded | ForEach-Object { Get-Field $_ 'id' })
  foreach ($r in $ready) {
    if ((Get-Field $r 'role') -ne 'main' -and $launchIds -notcontains (Get-Field $r 'launchId')) {
      $failures.Add("unregistered-ready pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')")
    }
  }
  # Native code cannot report ready; its launch/load records must name a pinned file and hash.
  $exePins = @{}
  foreach ($n in @($def.NativeExe)) { $exePins[(Split-Path -Leaf $n.path)] = $n.sha256 }
  $addonPins = @{}
  foreach ($n in @($def.NativeAddons)) { $addonPins[(Split-Path -Leaf $n.path)] = $n.sha256 }
  $fuSha = $null
  if ($def.FullUnitRules) { $fuSha = $def.FullUnitRules.sha256 }
  foreach ($l in $nativeLaunches) {
    $ruleId = Get-Field $l 'ruleId'
    if ($null -ne $ruleId) {
      # Full-unit Git only: pinned git.exe, one of the 7 rule ids, launched by the hashed helper.
      if (-not $fuSha -or (Get-Field $l 'entry') -ne 'git.exe' -or $GitRuleIds -notcontains $ruleId -or
          (Get-Field $l 'sha256') -ne $GitPin.Sha256 -or (Get-Field $l 'rulesSha256') -ne $fuSha) {
        $failures.Add("native-launch-rule-unexpected $ruleId")
      }
      continue
    }
    if ($exePins[(Get-Field $l 'entry')] -ne (Get-Field $l 'sha256')) { $failures.Add("native-launch-unpinned $(Get-Field $l 'entry')") }
    # No phase-2 profile has a validator native (browser profile only); a validator launch here fails.
    if ($null -ne (Get-Field $l 'validator')) { $failures.Add("native-launch-validator-unexpected $(Get-Field $l 'entry')") }
  }
  # Node launches through a full-unit rule: only in the full-unit profiles, known rule id, hashed helper.
  $ruleCounts = [ordered]@{}
  foreach ($l in $launches) {
    $ruleId = Get-Field $l 'ruleId'
    if ($null -eq $ruleId) { continue }
    $ruleCounts[[string]$ruleId] = [int]$ruleCounts[[string]$ruleId] + 1
    if ((Get-Field $l 'kind') -eq 'native') { continue }
    if (-not $fuSha -or (Get-Field $l 'kind') -ne 'child' -or $FullUnitNodeRuleIds -notcontains $ruleId -or (Get-Field $l 'rulesSha256') -ne $fuSha) {
      $failures.Add("child-launch-rule-unexpected $ruleId")
    }
  }
  foreach ($l in $nativeLoads) {
    if ($addonPins[(Get-Field $l 'entry')] -ne (Get-Field $l 'sha256')) { $failures.Add("native-load-unpinned $(Get-Field $l 'entry')") }
  }
  if ($def.RequireForkEntry) {
    $forkLaunches = @($guarded | Where-Object { (Get-Field $_ 'entry') -eq $def.RequireForkEntry })
    if ($forkLaunches.Count -eq 0) { $failures.Add("no-guarded-$($def.RequireForkEntry)-launch") }
  }

  # ---- module.register loader evidence: launch <-> ready <-> complete, one registration per admitted process ----
  $loaderLaunches = @($records | Where-Object { (Get-Field $_ 't') -eq 'loader-launch' })
  $loaderReady = @($records | Where-Object { (Get-Field $_ 't') -eq 'loader-ready' })
  $loaderComplete = @($records | Where-Object { (Get-Field $_ 't') -eq 'loader-complete' })
  $loaderSummary = New-Object System.Collections.ArrayList
  $la = $def.LoaderAdmission
  if (-not $la) {
    foreach ($r in @($loaderLaunches) + @($loaderReady) + @($loaderComplete)) {
      $failures.Add("loader-record-unexpected $(Get-Field $r 't') pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')")
    }
  } else {
    $guardSha = $sourceBefore['scripts\offline\guard.cjs']
    $childIds = @($launches | ForEach-Object { [string](Get-Field $_ 'id') })
    $loaderIds = @{}
    foreach ($l in $loaderLaunches) {
      $id = [string](Get-Field $l 'id')
      # Fresh identity: unique, never a child/worker/native launch id, never the registering process's own id.
      if ($loaderIds.ContainsKey($id) -or $childIds -contains $id -or [string](Get-Field $l 'parentLaunchId') -eq $id) {
        $failures.Add("loader-launch-id-reused $id")
      }
      $loaderIds[$id] = $true
      if (@('main', 'child') -notcontains (Get-Field $l 'role') -or (Get-Field $l 'configSha256') -ne $configSha -or
          (Get-Field $l 'guardSha256') -ne $guardSha -or (Get-Field $l 'loaderSha256') -ne $la.loader.sha256 -or
          (Get-Field $l 'callerSha256') -ne $la.caller.sha256) {
        $failures.Add("loader-launch-mismatch $id")
      }
      $rs = @($loaderReady | Where-Object { [string](Get-Field $_ 'launchId') -eq $id })
      if ($rs.Count -eq 0) { $failures.Add("loader-not-ready $id"); continue }
      if ($rs.Count -gt 1) { $failures.Add("loader-ready-count $id count=$($rs.Count)"); continue }
      $r = $rs[0]
      $tid = Get-Field $r 'tid'
      if ((Get-Field $r 'role') -ne 'loader' -or (Get-Field $r 'pid') -ne (Get-Field $l 'pid') -or "$tid" -notmatch '^\d+$' -or
          [long]$tid -le 0 -or [long]$tid -eq [long](Get-Field $l 'tid') -or (Get-Field $r 'internal') -ne $true -or
          (Get-Field $r 'guardSha256') -ne $guardSha -or (Get-Field $r 'configSha256') -ne $configSha -or
          (Get-Field $r 'loaderSha256') -ne $la.loader.sha256) {
        $failures.Add("loader-ready-mismatch $id")
      }
      $cs = @($loaderComplete | Where-Object { [string](Get-Field $_ 'id') -eq $id })
      if ($cs.Count -ne 1) { $failures.Add("loader-not-complete $id count=$($cs.Count)") }
      elseif ((Get-Field $cs[0] 'pid') -ne (Get-Field $l 'pid') -or (Get-Field $cs[0] 'tid') -ne (Get-Field $l 'tid') -or
          "$(Get-Field $cs[0] 'readyTid')" -ne "$tid") {
        $failures.Add("loader-complete-mismatch $id")
      }
      [void]$loaderSummary.Add([ordered]@{ id = $id; pid = Get-Field $l 'pid'; parentTid = Get-Field $l 'tid'; loaderTid = $tid })
    }
    foreach ($r in $loaderReady) {
      if (-not $loaderIds.ContainsKey([string](Get-Field $r 'launchId'))) {
        $failures.Add("loader-ready-unregistered pid=$(Get-Field $r 'pid') tid=$(Get-Field $r 'tid')")
      }
    }
    foreach ($c in $loaderComplete) {
      if (-not $loaderIds.ContainsKey([string](Get-Field $c 'id'))) { $failures.Add("loader-complete-unregistered $(Get-Field $c 'id')") }
    }
    # Admitted processes: the main process when it is the runner (plan-test, loader-canary), or the run.mjs
    # children launched by the plan rule ids (full unit: exactly one per rule id, i.e. two processes).
    $admittedPids = New-Object System.Collections.ArrayList
    if (@($la.runnerRuleIds).Count -eq 0) {
      if ($def.Entry -eq $la.runner.path) { [void]$admittedPids.Add($nodePid) }
    } else {
      foreach ($ruleId in $la.runnerRuleIds) {
        $ls = @($guarded | Where-Object { (Get-Field $_ 'ruleId') -eq $ruleId })
        if ($ls.Count -ne 1) { $failures.Add("loader-runner-launches $ruleId count=$($ls.Count)") }
        foreach ($x in $ls) {
          $m = @($ready | Where-Object { (Get-Field $_ 'launchId') -eq (Get-Field $x 'id') })
          if ($m.Count -eq 1) { [void]$admittedPids.Add((Get-Field $m[0] 'pid')) }
        }
      }
    }
    foreach ($p in $admittedPids) {
      $n = @($loaderLaunches | Where-Object { (Get-Field $_ 'pid') -eq $p }).Count
      if ($n -ne 1) { $failures.Add("loader-launch-count pid=$p count=$n") }
    }
    foreach ($l in $loaderLaunches) {
      if ($admittedPids -notcontains (Get-Field $l 'pid')) { $failures.Add("loader-launch-unadmitted pid=$(Get-Field $l 'pid')") }
    }
  }

  # plan-local sample artifact: plan-test requires this run to have written it (full only records it).
  $planArtifact = $null
  if ($def.PlanArtifact) {
    $after = $null
    $written = $false
    if (Test-Path -LiteralPath $def.PlanArtifact -PathType Leaf) {
      $after = Get-Sha256 $def.PlanArtifact
      $written = (Get-Item -LiteralPath $def.PlanArtifact).LastWriteTimeUtc -ge $runStartUtc
    }
    $planArtifact = [ordered]@{ path = $def.PlanArtifact; sha256Before = $artifactBefore; sha256After = $after; writtenThisRun = $written }
    if ($def.RequirePlanArtifact -and -not $written) { $failures.Add('plan-artifact-not-written') }
  }

  $actual = @{}
  foreach ($r in @($records | Where-Object { (Get-Field $_ 't') -eq 'deny' })) {
    $key = '{0}|{1}|{2}' -f (Get-Field $r 'role'), (Get-Field $r 'category'), (Get-Field $r 'method')
    $actual[$key] = [int]$actual[$key] + 1
  }
  $keys = @(@($def.Expected.Keys) + @($actual.Keys) | Sort-Object -Unique)
  foreach ($k in $keys) {
    $e = [int]$def.Expected[$k]
    $a = [int]$actual[$k]
    if ($e -ne $a) { $failures.Add("denial-count $k expected=$e actual=$a") }
  }

  # ---- loader canary main's own self-assertions, from the stdout already captured above ----
  # Independent of the expected ledger failures: the main prints exactly one
  # "LOADER_CANARY variant=<v> failed=<n>" and one "  FAIL <reason>" line per own failed assertion.
  # Failure names here use the canary-completion- prefix, which no Expect/Allow pattern matches.
  # Line contents are never copied into failures (no env values in the summary).
  $canaryCompletion = $null
  if ($ProfileName -eq 'loader-canary') {
    $startupFatal = $LoaderVariants[$Variant].ContainsKey('StartupFatal')
    $evidence = 'failed'
    $markerCount = 0
    $ownFail = 0
    $before = $failures.Count
    if ($stdout -eq '<incomplete>') {
      $failures.Add('canary-completion-stdout-incomplete')
    } else {
      $lines = @($stdout -split '\r?\n')
      $markers = @($lines | Where-Object { $_.Contains('LOADER_CANARY') })
      $markerCount = $markers.Count
      $ownFail = @($lines | Where-Object { $_.StartsWith('  FAIL ') }).Count
      if ($ownFail -gt 0) { $failures.Add("canary-completion-own-fail count=$ownFail") }
      if ($markerCount -gt 1) { $failures.Add("canary-completion-duplicate count=$markerCount") }
      foreach ($m in $markers) {
        if ($m -cmatch '^LOADER_CANARY variant=(\S+) failed=(0|[1-9]\d*)$') {
          if ($Matches[1] -cne $Variant) { $failures.Add('canary-completion-wrong-variant') }
          if ($Matches[2] -ne '0') { $failures.Add("canary-completion-failed n=$($Matches[2])") }
        } else {
          $failures.Add('canary-completion-malformed')
        }
      }
      if ($markerCount -eq 0) {
        # Only a startup-fatal variant may lack the marker: nonzero raw exit, no timeout, complete stdout,
        # no own FAIL line, and every one of its expected ledger failures already present.
        $ledgerOk = $true
        foreach ($e in @($LoaderVariants[$Variant].Expect)) {
          if (-not @($failures | Where-Object { $_ -match $e }).Count) { $ledgerOk = $false }
        }
        if ($startupFatal -and $exitCode -ne 0 -and -not $timedOut -and $ownFail -eq 0 -and $ledgerOk) {
          $evidence = 'startup-fatal-without-completion'
        } else {
          $failures.Add('canary-completion-missing')
        }
      }
    }
    if ($markerCount -eq 1 -and $failures.Count -eq $before) { $evidence = 'completed-and-checked' }
    # mainSelfAssertionsObserved is true only with a checked failed=0 marker; a startup-fatal run makes
    # no claim about the main's assertions (including register-throws-style environment restoration).
    $canaryCompletion = [ordered]@{
      evidence = $evidence; startupFatalVariant = $startupFatal; markers = $markerCount; ownFailLines = $ownFail
      mainSelfAssertionsObserved = ($evidence -eq 'completed-and-checked')
    }
  }

  if ((Get-Sha256 $configPath) -ne $configSha) { $failures.Add('config-changed') }
  $sourceAfter = Get-SourceHashes $def.ExtraInputs
  foreach ($n in $sourceBefore.Keys) {
    if ($sourceAfter[$n] -ne $sourceBefore[$n]) { $failures.Add("source-changed $n") }
  }
  if ($manifest) {
    foreach ($f in (Test-InstallManifest).Failures) { $failures.Add("installed-changed $f") }
    foreach ($f in @(Test-CompatPins $ProfileName)) { $failures.Add("installed-changed $f") }
  }
  $manifestSha = $null
  if ($ProfileName -eq 'install' -and $failures.Count -eq 0) {
    foreach ($f in (New-InstallManifest $runId)) { $failures.Add("install-verify $f") }
  }
  if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) { $manifestSha = Get-Sha256 $ManifestPath }

  # Vitest's own count lines (stdout, colour codes stripped); informational, the verdict is the ledger + exit.
  $vitestCounts = $null
  if ($ProfileName -eq 'vitest-unit' -and $stdout -ne '<incomplete>') {
    $plain = $stdout -replace "\x1b\[[0-9;]*m", ''
    $vitestCounts = @([regex]::Matches($plain, '(?m)^\s*(Test Files|Tests)\s+(.+?)\s*$') | ForEach-Object { $_.Groups[1].Value + ' ' + $_.Groups[2].Value })
  }
  $loaderInfo = $null
  if ($def.LoaderAdmission) {
    $loaderInfo = [ordered]@{
      runner = $def.LoaderAdmission.runner; caller = $def.LoaderAdmission.caller; loader = $def.LoaderAdmission.loader
      data = $def.LoaderAdmission.data; runnerRuleIds = $def.LoaderAdmission.runnerRuleIds
      launches = $loaderLaunches.Count; ready = $loaderReady.Count; complete = $loaderComplete.Count; registrations = $loaderSummary
    }
  }

  $summary = [ordered]@{
    runId            = $runId
    profile          = $ProfileName
    unitSelector     = $(if ($ProfileName -eq 'vitest-unit') { $UnitSelector } else { $null })
    variant          = $def.Variant
    command          = $command
    entry            = $def.Entry
    args             = @($def.Args)
    cwd              = $RepoRoot
    fullUnitRules    = $def.FullUnitRules
    ruleLaunchCounts = $ruleCounts
    loader           = $loaderInfo
    canaryCompletion = $canaryCompletion
    planArtifact     = $planArtifact
    vitestCounts     = $vitestCounts
    nodeVersion      = $nodeVersion
    nodePid          = $nodePid
    exitCode         = $exitCode
    timedOut         = $timedOut
    configSha256     = $configSha
    sourceSha256     = $sourceBefore
    manifestSha256   = $manifestSha
    readyCount       = $ready.Count
    launchCount      = $guarded.Count
    rollupReports    = @($guarded | Where-Object { (Get-Field $_ 'translated') -eq 'rollup-report' }).Count
    viteNetUseProbes = $compatRecords.Count
    nativeLaunches   = $nativeLaunches.Count
    nativeLoads      = $nativeLoads.Count
    denials          = $actual
    expectedDenials  = $def.Expected
    failures         = @($failures)
    passed           = ($failures.Count -eq 0)
  }
  [IO.File]::WriteAllText((Join-Path $runDir 'summary.json'), ($summary | ConvertTo-Json -Depth 6), $Utf8NoBom)

  return [pscustomobject]@{
    RunDir   = $runDir
    ExitCode = $exitCode
    Denials  = $actual
    Failures = @($failures)
    Failed   = ($failures.Count -gt 0)
    Completion = $canaryCompletion
  }
}

try {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "node not found at $NodePath" }
  [void][IO.Directory]::CreateDirectory($RunsRoot)
  if ($Mode -eq 'selfcheck') {
    $canary = Invoke-OfflineRun -ProfileName 'canary'
    $negative = Invoke-OfflineRun -ProfileName 'negative'
  } elseif ($Mode -eq 'loadercheck') {
    $loaderRuns = [ordered]@{}
    foreach ($v in $LoaderVariants.Keys) { $loaderRuns[$v] = Invoke-OfflineRun -ProfileName 'loader-canary' -Variant $v }
  } else {
    $result = Invoke-OfflineRun -ProfileName $Mode
  }
} catch {
  Write-Host "REFUSED/ERROR: $($_.Exception.Message)"
  exit 2
}

if ($Mode -eq 'loadercheck') {
  # ok must pass; every negative must fail with exactly its expected evidence (see $LoaderVariants).
  $problems = New-Object System.Collections.Generic.List[string]
  $fatalNames = @($LoaderVariants.Keys | Where-Object { $LoaderVariants[$_].ContainsKey('StartupFatal') })
  if ($LoaderVariants.Count -ne 18 -or ($fatalNames -join ',') -ne 'reuse-id,missing-ready') {
    $problems.Add("variant table changed: count=$($LoaderVariants.Count) startup-fatal=$($fatalNames -join ',')")
  }
  foreach ($v in $LoaderVariants.Keys) {
    $spec = $LoaderVariants[$v]
    $run = $loaderRuns[$v]
    Write-Host "loader-canary $v run: $($run.RunDir) completion=$($run.Completion.evidence)"
    # Completion is required of every non-startup-fatal variant (also enforced by the canary-completion-* failures).
    if (-not $spec.ContainsKey('StartupFatal') -and $run.Completion.evidence -ne 'completed-and-checked') {
      $problems.Add("$v main completion not checked: $($run.Completion.evidence)")
    }
    if ($spec.ContainsKey('Pass')) {
      if ($run.Failed) { $problems.Add("$v must pass: " + ($run.Failures -join '; ')) }
      continue
    }
    if (-not $run.Failed) { $problems.Add("$v passed the supervisor but must fail"); continue }
    if ($spec.ContainsKey('ExitZero') -and $run.ExitCode -ne 0) { $problems.Add("$v raw exit code was $($run.ExitCode), expected 0 (caught)") }
    $patterns = @($spec.Expect)
    if ($spec.ContainsKey('Allow')) { $patterns += @($spec.Allow) }
    foreach ($f in $run.Failures) {
      if (-not @($patterns | Where-Object { $f -match $_ }).Count) { $problems.Add("$v unexpected failure: $f") }
    }
    foreach ($e in @($spec.Expect)) {
      if (-not @($run.Failures | Where-Object { $_ -match $e }).Count) { $problems.Add("$v missing expected failure /$e/") }
    }
  }
  if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Host "LOADERCHECK FAIL: $p" }
    exit 1
  }
  $checked = @($LoaderVariants.Keys | Where-Object { $loaderRuns[$_].Completion.evidence -eq 'completed-and-checked' }).Count
  Write-Host "LOADERCHECK PASS (ok passed; $($LoaderVariants.Count - 1) negatives failed exactly as expected; main completion checked failed=0 in $checked, startup-fatal without completion in $($LoaderVariants.Count - $checked))"
  exit 0
}

if ($Mode -ne 'selfcheck') {
  Write-Host "$Mode run: $($result.RunDir)"
  if ($result.Failed) {
    foreach ($f in $result.Failures) { Write-Host "FAIL: $f" }
    Write-Host "$Mode : FAIL"
    exit 1
  }
  Write-Host "$Mode : PASS (exit 0, denials exactly the profile table (empty for products), every guarded launch ready, natives pinned, sources unchanged)"
  exit 0
}

# ---- self-check: canary must pass; negative must show exactly its two denials with raw exit 0 ----
$problems = New-Object System.Collections.Generic.List[string]
if ($canary.Failed) { $problems.Add('canary run failed: ' + ($canary.Failures -join '; ')) }
if ($negative.ExitCode -ne 0) { $problems.Add("negative raw exit code was $($negative.ExitCode), expected 0") }
$negKeys = @(@($NegativeCaught.Keys) + @($negative.Denials.Keys) | Sort-Object -Unique)
foreach ($k in $negKeys) {
  if ([int]$NegativeCaught[$k] -ne [int]$negative.Denials[$k]) {
    $problems.Add("negative denial $k expected=$([int]$NegativeCaught[$k]) actual=$([int]$negative.Denials[$k])")
  }
}
$expectedNegFailures = @($NegativeCaught.Keys | Sort-Object | ForEach-Object { "denial-count $_ expected=0 actual=1" })
$actualNegFailures = @($negative.Failures | Sort-Object)
if (($expectedNegFailures -join "`n") -ne ($actualNegFailures -join "`n")) {
  $problems.Add('negative run failures differ from the exact expected set: ' + ($negative.Failures -join '; '))
}

Write-Host "canary   run: $($canary.RunDir)"
Write-Host "negative run: $($negative.RunDir)"
if ($problems.Count -gt 0) {
  foreach ($p in $problems) { Write-Host "SELFCHECK FAIL: $p" }
  exit 1
}
Write-Host 'canary  : PASS (all expected denials exact, all launches reported guard-ready)'
Write-Host "negative: detected despite raw exit 0; exactly: $($negative.Failures -join '; ')"
Write-Host 'SELFCHECK PASS'
exit 0
