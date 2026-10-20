# Full-unit rules, plan:test and the module.register loader boundary (integration 2026-10-17)

Status: **implemented, NOT executed.** Nothing in this increment was run: no Node, no tests, no canary, no
self-check. No runtime PASS is claimed. Root reviews, hashes, then runs the fixed profiles in the order below.

| File | Role |
| --- | --- |
| `full-unit-rules.cjs` | Bounded validator for the full-unit Node children and the 7 Git vectors. Never executes anything and never reads env, `.env` or secrets. Its only I/O is `lstat` and `realpath.native` for containment. Required by `guard.cjs` only in `vitest-unit -UnitSelector full` and `fullunit-canary`. |
| `tests/unit/integration-20261017-offline-full-unit-rules.test.ts` | Imports the helper directly. Spawns nothing. Filesystem cases run only on win32 inside one owned `mkdtemp` root. Offline selector: `-Mode vitest-unit -UnitSelector rules`. |
| `fullunit-canary.cjs` | Boundary canary for the helper integration (approved vectors + exact denials). `-Mode fullunit-canary`. |
| `loader-canary-*.mjs` | module.register loader canary (one caller, four loaders, one probe, one main). `-Mode loadercheck`. |

## Helper API (frozen `module.exports`)

```
validateFullUnitNode(entry, argv, options, policy)
validateFullUnitGit(file, argv, options, policy)
  -> { ok: true, ruleId, entry, argv, options, fixedEnv? }   (deep-frozen)
  -> { ok: false, reason }
```

- `entry` is argv[0] after the fixed node.exe. `argv` is the arguments after `entry`. `options` are the caller's spawn options.
- `policy` must be exactly `{ repoRoot, runTmp, gitPath }`:
  - All three are canonical `X:\...` paths, backslashes only.
  - `gitPath` must be the pinned Git.
  - `repoRoot` and `runTmp` must not overlap, and both must be real directories (`realpath.native` equals the path, so there is no junction, symlink or short name anywhere on the path).
  - `runTmp` must be the exact `os.tmpdir()` of the process that spawns, i.e. TMP/TEMP of the run.
- **Order:** policy, then the entry. An unrecognized entry returns exactly `unknown entry` before argv or options are looked at. A recognized entry always returns its own reason (argv, options, payload...), never `unknown entry`. The guard relies on this: only `unknown entry` may go on to the static child rules.
- The result is what to launch: `entry` is absolute (the pinned `git.exe` for Git), `argv` is a copy (with Git's protective prefix), and `options` holds `cwd` plus the vector's `stdio`/`encoding`/`timeout` and nothing else. Caller env is never returned; the only env is `fixedEnv`.
- `result.options.cwd` is always `repoRoot`, for every accepted Node and Git child. That includes the vectors whose caller passes no `cwd` (projection worker, projection-exit, enrich-*, `ls-files`), which inherit the vitest cwd (= `R`) in the source tests. This only sets the launch cwd. The caller's options are still checked against the exact table shape, so a caller `cwd` on those vectors is rejected.
- Options and policy are copied into null-prototype objects. Accessors, symbol keys, inherited properties (non-`Object.prototype` prototype) and an own `__proto__` key (as produced by `JSON.parse` or `Object.defineProperty`) all fail as `options must be plain data` / `policy must be exactly {...}`. A `__proto__` key in the projection payload counts as an extra key (top level) or a manifest mismatch. An own `__proto__` env key is not the sentinel, so an inherited sentinel fails.
- The rules are compiled in. An unknown entry, an unknown vector, extra or missing options (including `shell`), or extra args all fail. Vectors with fixed arguments (`argv`) match the exact list only; there is no free-form flag or scenario.
- Also exported: `GIT_PIN`, `GIT_PROTECT_ARGS`, `GIT_FIXED_ENV`, `GIT_IGNORE_CANDIDATES`, `PROJECTION_MANIFESTS`, `BAD_PROJECTION_ROOT_NAME`, `NODE_RULE_IDS`, `NODE_ENTRY_RELS` (new: repo-relative entries; the guard refuses a config whose static rules overlap them), `GIT_RULE_IDS`.

## Vectors

| ruleId | entry | argv | options (exact keys) | source |
| --- | --- | --- | --- | --- |
| `node:projection-worker:first-hold-600` / `second-hold-0` | `<R>\tests\fixtures\integration-20261017\projection-worker.mjs` | 1 payload | `stdio: ['ignore','pipe','pipe']` | apply-brain-guide-projection.test.ts:104-106, 271-274 |
| `node:projection-worker:bad-root-exit-64` | same | payload with root `<runTmp>\not-a-cocotrip-projection-root` | same | :291-298 (must reach the worker, which exits 64) |
| `node:projection-exit` | `<R>\tests\fixtures\integration-20261017\projection-exit.mjs` | none | none / `{}` (launched with `cwd=R`) | :303 |
| `node:audit-gate:file-utf8` | alias `scripts/audit-gate.mjs` | `<runTmp>\audit-gate-<6 alnum>\audit.json` | `cwd=R, encoding:'utf8', stdio: IPP` | audit-gate.test.ts:40-47 |
| `node:audit-gate:file-pipe` / `no-file` | alias `scripts/audit-gate.mjs` | the same file / none | `cwd=R, stdio:'pipe'` | :104-127 |
| `node:test-quality-metrics` | alias `scripts/test-quality-metrics.mjs` | none | `cwd=R, stdio:'pipe'` | quality-metrics-structural-false-positives.test.ts:151-157 |
| `node:enrich-busan:refusal`, `node:enrich-city-restaurants:refusal` | `<R>\scripts\<name>.mjs` | none | `encoding:'utf8', env` holding `GOOGLE_PLACES_API_KEY='must-not-be-used'` exactly once | paid-google-scripts-consent.test.ts:32-41 |
| `node:openmontage-brief:help` | `<R>\scripts\export-openmontage-brief.mjs` | exactly `--help` | `encoding:'utf8', cwd=R, timeout:30000` | openmontage-brief.test.ts:523-538 |
| `node:openmontage-brief:bad-locale` | same | exactly `--locale fr` | same | same |
| `node:plan-local:sample` | `<R>\scripts\plan-local\run.mjs` | exactly `sample` | `cwd=R, stdio:'pipe'` | plan-local-prewrite-quality-gate.test.ts:203-252 |
| `node:plan-local:daycount-mismatch` | same | exactly `__test_daycount_mismatch__` | same | same |
| `git:check-ignore:<candidate>` ×6 | `git` or `C:\Program Files\Git\cmd\git.exe` | `check-ignore -q <candidate>` | `cwd=R` | owner-controller-preflight.test.ts:133-141 |
| `git:ls-files-stage-gradlew` | same | `ls-files --stage android-owner/gradlew` | `encoding:'utf8'` | owner-android-workflow.test.ts:62 |

Projection payload, audit file, aliases and the Google sentinel are unchanged from the preparation:
canonical base64url ≤ 16384 chars, keys exactly `root,manifest,holdMs` in that order and canonical JSON,
byte-identical pinned manifests, only the three combinations; `<runTmp>\audit-gate-<6>\audit.json` as a real
single-link regular file ≤ 1 MiB, never read; only the exact alias strings with `cwd = R`; `fixedEnv` exactly
`{ GOOGLE_PLACES_API_KEY: 'must-not-be-used' }`, all other caller env discarded. The openmontage and plan-local
entries are absolute only (the relative spellings are `unknown entry`, and then fail the static rules).

## Guard integration (`guard.cjs`)

**Load.** Only when the hashed config has `fullUnitRules = { path, sha256, policy }`, and only in profile
`vitest-unit` with `unitSelector = full` or `fullunit-canary` (anything else is an init failure). `path` must equal
`<guard dir>\full-unit-rules.cjs`; the file is hashed before and after the literal `require('./full-unit-rules.cjs')`;
it must not be in `require.cache` before, and the require must add exactly that one cache entry. The export must be
frozen with both validators, a frozen `GIT_PIN` and frozen `NODE_RULE_IDS`/`GIT_RULE_IDS`/`NODE_ENTRY_RELS`. The
policy must be exactly `{ gitPath, repoRoot, runTmp }` with `repoRoot` = the repo the guard lives in, `runTmp` =
the launcher's `TMP` and `TEMP` (both, exact string; the supervisor sets it to the run's fresh `tmp` dir outside
`R`), `gitPath` = `GIT_PIN.path`; it is frozen and must pass the helper's own policy check (a probe call must return
`unknown entry`). A static child or worker rule naming a helper entry is an init failure.

**Normalized invocation.** `vetChild` now returns the complete `{ file, args, options }` that the wrapper executes
(`spawn`/`spawnSync`/`execFile`/`execFileSync`, callback kept, still through `approvedCall`, so the
`ChildProcess.prototype.spawn` guard is unchanged). For static rules this is the caller's file/args with the safe
options, exactly as before. Full-unit vectors:

- **Node** (exe = the fixed node.exe): the helper sees `argv[0]`, the rest, and the caller's options. `ok` ->
  `file = cfg.nodePath`, `args = [result.entry, ...result.argv]`, `options = result.options` (copied) + `env` =
  fresh launcher env + new unique `OFFLINE_GUARD_LAUNCH_ID` + only `result.fixedEnv` (which may not touch a launcher
  or `OFFLINE_GUARD*` key), `shell:false`, `windowsHide:true`. A caller env (enrich-* only) must still keep the guard
  keys (`envKeeps`). Launch record: `{ t:'launch', kind:'child', entry, ruleId, rulesSha256 }` (no argv: the
  projection payload is never logged). `unknown entry` -> the static rules (compare/ESM/forks unchanged). Any other
  helper result -> `full-unit` denial with the helper's reason. `fork` of a recognized entry is always denied
  (`full-unit`); the helper vectors are spawn-family only.
- **Git** (exe exactly `git` or the pinned path; not for fork): the helper must accept the vector, else
  `full-unit-git`. Then size + SHA-256 of `C:\Program Files\Git\cmd\git.exe` are re-read **before every launch**
  (no per-process cache; mismatch = `native-hash`). Launch: `file = GIT_PIN.path` (no PATH lookup), `args =
  result.argv` (`--no-optional-locks -c core.fsmonitor=false` + vector), `options = result.options` (`cwd = R`) +
  `env` = launcher env minus `NODE_OPTIONS`/`OFFLINE_GUARD*` plus only the helper's `GIT_*` fixedEnv
  (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=NUL`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`), `shell:false`,
  `windowsHide:true`. Record `{ t:'launch', kind:'native', entry:'git.exe', sha256, ruleId, rulesSha256, argv }`
  (the argv is fixed and safe). Any other Git exe (`git.exe`, `bin\git.exe`, ...) stays a `child-exe` denial.

## module.register boundary (Node 22.15.0)

Source facts (official v22.15.0 source as embedded by the parent; **not** verified by running anything here):
the first `module.register` creates `internal/worker` `InternalWorker` (no env/execArgv options); the worker
postpones preloads and `initializeHooks` runs `loadPreloadModules` before importing the user loader; the env is
a native-store copy of `process.env`; execArgv/options are inherited; `isInternalThread` is true; the tid is unique
but not fixed; `register` waits synchronously for import/initialize. Anchors: `lib/internal/modules/esm/hooks.js`
466-483, `lib/internal/main/worker_thread.js` 130-145, `lib/internal/modules/esm/utils.js` 285-309,
`src/node_worker.cc` 491-506 and 617-620, `lib/internal/worker.js` 180-208.

**Admission config** (`loaderAdmission`, hashed): `runner {path, sha256}`, `runnerRuleIds`, `caller {path, sha256,
line, fn}`, `loader {path, sha256}`, `data [{key, path, sha256}]`. Allowed only in `vitest-unit full` (runner =
`run.mjs` as a child; `runnerRuleIds` = the two plan rule ids, which must be helper ids), `plan-test` and
`loader-canary` (runner = the main entry; `runnerRuleIds` empty).

| | plan-local (full, plan-test) | loader canary |
| --- | --- | --- |
| runner | `scripts\plan-local\run.mjs` | `scripts\offline\loader-canary-main.mjs` (`not-admitted`: the probe file) |
| caller | `scripts\plan-local\_mocks.mjs` line 140, `installMocks` | `scripts\offline\loader-canary-register.mjs` line 9, `registerCanary` |
| loader | `scripts\plan-local\_loader.mjs` | `loader-canary-hooks.mjs` (or `-net`/`-reregister`/`-throw` per variant) |
| data | `axiosMockUrl`, `firestoreAdminMockUrl`, `transitProviderMockUrl` -> the three `_*-mock.mjs` | `probeUrl` -> `loader-canary-probe.mjs` |

The supervisor refuses the run if the pinned call lines no longer read exactly as expected (text check of
`_mocks.mjs` 137 and 140-146, `loader-canary-register.mjs` 8-9), and hashes every admitted file into the config.

**Admitted process.** Main role: `process.argv[1]` = runner, `execArgv` empty, no runner rule ids. Child role
(full unit): same, plus the parent's ledger must hold exactly one `launch` record for this process's launch id
with `kind:'child'`, a listed plan rule id and the helper hash. Nothing else (vitest main, forks, other children,
ordinary workers, loader threads) can register.

**Wrapper (`require('module').register`, patched before `syncBuiltinESMExports`, so `import { register } from
'node:module'` in `_mocks.mjs` gets it).** Denied (`loader-register`) in a loader/worker thread, in an unadmitted
process, and on any second call. The admission is consumed before any check. Then: direct caller frame = pinned
file/line/function; exactly 3 arguments (no options-object overload); `parentURL` = the caller frame's own module
URL and the pinned caller file; `specifier` = canonical `file:` URL of the pinned loader; `options` exactly
`{ data }` (own enumerable data keys, `Object.prototype`, so `transferList`, symbols, accessors and an own
`__proto__` fail) and `data` exactly the pinned keys in order, each a canonical `file:` URL of its pinned file;
`execArgv` empty and `NODE_OPTIONS`/`OFFLINE_GUARD_CONFIG`/config hash unchanged; runner, caller, loader and data
files re-hashed. Then:

1. `loader-launch` record with a fresh id (`<pid>.<tid>.<seq>`, never the process's own launch id) and the
   caller/loader/config/guard hashes.
2. `process.env` is emptied and refilled **in place** with the launcher env + config hash + that id (the caller's
   keys/values are kept only in memory for restore, never logged). This keeps run.mjs's dummy `GEMINI_API_KEY`
   (set before `installMocks`) out of the loader thread; the guard's startup forbidden-key check stays on.
3. The original `register` is called with the validated values (`{ data }` rebuilt from the checked strings).
4. `finally`: the same env object gets back exactly its original keys and values.
5. Exactly one `loader-ready` for that id must exist (pid = this process, tid positive and ≠ caller tid,
   `internal:true`, guard/config/loader hashes). Then `loader-complete {id, readyTid}`. A throw, 0 or ≥ 2 readies or
   any mismatch writes a `loader-register` denial (sticky: it fails the run even if the caller catches and exits 0)
   and rethrows.

**Loader thread** (`isInternalThread === true` -> role `loader`, ledger `loader-<pid>-t<tid>.jsonl`). Before
anything else it must find exactly one `loader-launch` for its env launch id in the same pid's main/child ledger
(parent tid from the id), with matching config/guard/loader hashes, no earlier `loader-ready` for that id, and the
loader file must re-hash. Otherwise: `loader-preload`/`loader-admission` denial and init failure (the register
fails). The env flag alone is not admission. All network/child/native/worker patches are installed; its own
`module.register` is denied; last it writes `loader-ready {launchId, internal, node, guard/config/loader hashes,
execArgv}` instead of `ready`. Its argv is not compared.

**Supervisor.** Record types `loader-launch`, `loader-ready`, `loader-complete` are accepted only with a
`loaderAdmission`. Per `loader-launch`: unique fresh id; role main/child; hashes match; exactly one `loader-ready`
(`loader-not-ready` / `loader-ready-count`) with matching role/pid/tid/internal/hashes (`loader-ready-mismatch`);
exactly one `loader-complete` with the same pid/tid and `readyTid` (`loader-not-complete` /
`loader-complete-mismatch`). Every ready/complete must belong to a launch (`loader-ready-unregistered` /
`loader-complete-unregistered`). Each admitted process has exactly one registration (`loader-launch-count`); a
registration in any other process fails (`loader-launch-unadmitted`). Full unit: exactly one guarded `run.mjs`
launch per plan rule id (`loader-runner-launches`), i.e. two admitted processes (sample, mismatch); plan-test: the
main process only. Ordinary worker accounting is unchanged.

## Supervisor profiles (`Run-Offline.ps1`)

| Mode | node.exe + | Adds |
| --- | --- | --- |
| `vitest-unit -UnitSelector rules` | vitest `run --config <offline config> tests/unit/integration-20261017-offline-full-unit-rules.test.ts` | targeted profile rules; full-unit inputs hashed |
| `vitest-unit -UnitSelector full` | vitest `run --config <offline config>` (no filter) | `fullUnitRules`, plan `loaderAdmission` (2 rule ids), full-unit inputs, generated-file check, artifact record, Vitest count lines |
| `plan-test` | `<R>\scripts\plan-local\run.mjs` (no args = `sample`, no npm/shell) | plan `loaderAdmission` (main), plan inputs, artifact must be written by this run |
| `fullunit-canary` | `scripts\offline\fullunit-canary.cjs` | `fullUnitRules`; exact denial table below; no install manifest needed |
| `loadercheck` | `scripts\offline\loader-canary-main.mjs <variant>` per variant | canary `loaderAdmission`; per-variant expectations |

Every new profile keeps the fresh launcher env, empty loopback allowlist, no DNS/listen allowance, no generic
`exec`. Git is the only native and only in the full-unit profiles. Generated plan files
(`fixtures\{blocks,selection,userinput}-__test_daycount_mismatch__.json`, `outputs\plan-__test_daycount_mismatch__.json`)
must be missing before the run (else refused) and are hashed as inputs (a leftover fails the run).
`outputs\plan-sample.json` is recorded (before/after hash, written-this-run); `plan-test` requires it written.
The same profile-specific inputs are hashed both before and after the run. Plan inputs also pin the presence/absence
of the preferred `fixtures\{blocks,selection,userinput}-sample.json` (currently absent, recorded as `missing`).
Summary additions: `entry`, `args`, `variant`, `fullUnitRules`, `ruleLaunchCounts`, `loader` (pins, counts,
`{id, pid, parentTid, loaderTid}` per registration), `canaryCompletion` (loader canary), `planArtifact`, `vitestCounts`.

**fullunit-canary expected denials** (all `main`): `full-unit|spawnSync` 5 (projection-exit extra arg,
projection-exit extra `cwd`, openmontage `--locale de`, audit alias with `cwd=R\scripts`, plan free scenario
`other`), `full-unit-git|execFileSync` 1 (`git status`), `child-exe|spawnSync` 1 (`Git\bin\git.exe`),
`full-unit|fork` 1 (fork of projection-exit), `loader-register|module.register` 1 (no admission). Approved:
projection-exit (0), openmontage `--help` (0, usage) and `--locale fr` (2, usage), `git check-ignore -q
android-owner/app/upload.jks` (0), `git ls-files --stage android-owner/gradlew` (`100755`).

**loadercheck variants** (each its own run): `ok` must PASS (one registration; env object same and exactly
restored; dummy restored; probe imported through the loader; loader saw no dummy, `isInternalThread`, tid > 0
equal to its ready, launch id = the fresh id). Must FAIL with exactly: `wrong-caller`, `wrong-specifier`,
`wrong-parent`, `wrong-data`, `extra-option` (`transferList`), `own-proto`, `overload` -> main `loader-register`
denial + `loader-launch-count ... count=0`, raw exit 0; `not-admitted`, `second` -> the denial only, exit 0;
`loader-network` -> `loader|loopback|net.connect`, exit 0; `loader-reregister` -> `loader|loader-register`, exit 0;
`register-throws` (loader `initialize` throws, main catches) -> main denial + `loader-not-complete`, exit 0;
`reuse-id` (forged ready for the next id) -> `loader|loader-admission|loader-preload` + main denial +
`loader-ready-mismatch` + `loader-not-complete`; `missing-ready` (loader ledger files blocked) -> main denial +
`loader-not-ready`; `dup-ready` -> `loader-ready-count ... count=2`, exit 0; `mismatch-ready` (forged triplet,
wrong guard hash) -> `loader-ready-mismatch`, exit 0; `unregistered-ready` -> `loader-ready-unregistered`, exit 0.
Only the startup-fatal `reuse-id` and `missing-ready` may also end with a non-zero raw exit (allowed, recorded);
everything else must match exactly.

**Main completion** (checked separately from the ledger, using the stdout the run already captured): the main
prints `LOADER_CANARY variant=<v> failed=<n>` and one `  FAIL <reason>` line per own failed assertion. In all 18
variants a malformed, wrong-variant, duplicate or `failed>0` marker, or any `  FAIL ` line, fails the run with a
`canary-completion-*` failure that no Expect/Allow pattern matches. The 16 non-startup-fatal variants (including
`ok` and `register-throws`) need exactly one `failed=0` marker for this variant -> `canaryCompletion.evidence =
completed-and-checked`. `reuse-id` / `missing-ready` (the loader worker preload can end the process before main
completes) may lack the marker only with a non-zero raw exit, no timeout, complete stdout and all their expected
ledger failures -> `startup-fatal-without-completion` (`mainSelfAssertionsObserved: false`: nothing about the
main's own checks, e.g. env restoration, is claimed); raw exit 0 needs the `failed=0` marker. Not yet run.

## Run order for root (none of this has been run)

1. `-Mode selfcheck` (guard changed; canary/negative tables unchanged).
2. `-Mode vitest-unit -UnitSelector rules` (helper test).
3. `-Mode fullunit-canary`.
4. `-Mode loadercheck`.
5. `-Mode vitest-unit` (targeted regression).
6. `-Mode vitest-unit -UnitSelector full` (record the actual counts from `summary.json` `vitestCounts`; the old
   source snapshot counted 919 tests).
7. `-Mode plan-test`.

Expected domain results: openmontage help 0 / fr 2; audit 0/1/2; Google 2; projection bad root 64; plan sample 0
with `outputs\plan-sample.json`, mismatch 1 with the real `[day_count]` diagnostic and no artifact; compare/ESM
negatives unchanged. A guard denial is never a substitute for a domain failure: any denial fails the run.

## Limits

- The guard is cooperative. Pinning `cmd\git.exe` does not pin the `mingw64\bin\git.exe` it forwards to, or any DLL,
  and nothing here proves the OS is offline. Git config: `GIT_CONFIG_GLOBAL=NUL`/`NOSYSTEM=1` keep the results only
  because the repo `.gitignore` covers all six candidates (hashed as an input).
- Admission hashes are taken by the supervisor at run start (and the sources re-hashed after); the call-site text is
  checked, but there are no hard-coded SHA literals for the plan/canary files. Root may convert them to literals.
- `module.registerHooks` (in-thread, no worker) is not patched.
- The loader canary forges ledger records the way hostile app code could; a perfectly forged triplet without a real
  registration is indistinguishable (no thread ran, so nothing unguarded ran either).
- `missing-ready` blocks the loader ledger files `t1`..`t8`; if Node gives the loader a higher thread id the
  variant does not fail as expected and loadercheck reports it.
