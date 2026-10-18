# scripts/offline — offline guard, phase 2

Cooperative, application-level egress/process guard for running repo Node code with zero
intended network access. **It is not an OS firewall and does not prove that all egress is zero.**
Native code (including the two approved native files below), `internalBinding`, inherited raw handles,
and code that captured originals before preload are outside what it proves.

Phase 1 (canary + negative) passed under root. Phase 2 adds fixed product profiles. Root has run: phase-2
self-check PASS; `install` PASS (1306 packages, no denials, manifest written); `tsc` PASS. With the guard3
increment (Rollup report probe, Vitest `--conditions`, compare/ESM child rules): self-check PASS (38 canary
denials, 5 ready/4 launches, negative exactly 2 with raw exit 0; `runs/20261017-124448-canary-5c49a753`,
`negative-dbae8260`). Then two runs were attempted and **FAILED as guard runs** (no product verdict either way):

- `20261017-124520-vite-build-d9c2b957`: exit 1, 8× `child_process.exec` denied (Vite's `net use` probe, see
  below). The Rollup translation worked: 1 report, 2 ready, 1 native esbuild launch, 1 addon load.
- `20261017-124609-vitest-unit-327dd31a`: startup failed with 2× exec and 2× `dns.promises.lookup` of
  `localhost`; no fork was reached.

Completed later root runs (historical; they predate the current full-unit/loader changes): with the Vite
`net use` compat, Vitest `server.host` and Rollup result check, guarded `vite-build` PASS
(`20261017-125449-vite-build-448124f0`) and targeted `vitest-unit` PASS, 4 files / 79 tests
(`20261017-125533-vitest-unit-28a4f2c5`). Scoped-loopback guard5 self-check PASS (`20261017-130805`). Browser
capture pilots (via `Run-Capture.ps1`, not this supervisor): pilot 1 (`20261017-130118-capture-pilot-9f0ac5f5`)
failed before the browser on the numeric-IP `dns.lookup` (see below); pilot 2
(`20261017-130830-capture-pilot-cf2cc3fe`) launched Chromium and was guard-clean, but all 12 cells failed with
`ERR_PROXY_CONNECTION_FAILED`. Its 32 images are blank browser error pages, **not UI evidence**. eslint has not run.

New since then and **unexecuted**: the full-unit / loader-canary implementation (`FULL-UNIT.md`) and the raw
proxy-order fix in `Run-Capture.ps1`'s fixed browser profile (statically reviewed, not rerun). The passes above
are not checks of these additions. Still pending: full capture, matrix, videos, new Fable pixels. No live
product API call, push or deploy has been made.

## Files

| File | Role |
|---|---|
| `guard.cjs` | Preloaded with `NODE_OPTIONS=--require` (and re-required first in fork/worker `execArgv`). Patches transports, listen, DNS, child_process, worker_threads, `process.dlopen`. Writes ledger records. |
| `Run-Offline.ps1` | Supervisor. Only the enumerated `-Mode` and `-UnitSelector` values; no free-form command, entry, or argument. |
| `canary-main.cjs`, `canary-child.cjs`, `canary-worker.cjs` | Fixed canary (unchanged from phase 1). |
| `canary-negative.cjs` | Negative fixture (unchanged). Swallows a guard error, fires and forgets a second attempt, exits 0. |
| `rollup-platform.cjs` | Fixed child that replaces Rollup's `node -p` report probe (see below). No args; refuses to run without the guard. Prints the real `process.report.getReport().header` as JSON. |
| `browser-native-rules.cjs` | Not owned here (browser owner). Required by `guard.cjs` only when the config has validator natives (browser profile); hashed as an offline source in every run. |
| `full-unit-rules.cjs` | Exact full-unit Node/Git vectors. Required by `guard.cjs` only in `vitest-unit full` and `fullunit-canary`. See `FULL-UNIT.md`. |
| `fullunit-canary.cjs` | Boundary canary for the full-unit integration (`-Mode fullunit-canary`). |
| `loader-canary-main.mjs`, `loader-canary-register.mjs`, `loader-canary-hooks*.mjs`, `loader-canary-probe.mjs` | module.register loader canary (`-Mode loadercheck`). |
| `FULL-UNIT.md` | Full-unit rules, `plan-test`, the module.register loader boundary and their canaries. |

## Commands (in this order; each run gets a new dir under `...-preservation\runs\`)

```powershell
$ps = 'E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\scripts\offline\Run-Offline.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps                          # 1. selfcheck (re-run after these changes)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode install            # 2. once, into an empty tree
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode tsc                # 3.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode vite-build         # 4.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode vitest-unit        # 5. targeted (default)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode eslint             # 6.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode vitest-unit -UnitSelector rules  # helper test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode fullunit-canary
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode loadercheck
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode vitest-unit -UnitSelector full
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode plan-test
```

The last five (and the order) are described in `FULL-UNIT.md`; **none of them has been run.**

Exit `0` = pass, `1` = run failed, `2` = refused by preflight or setup error.

## Profiles: exact node.exe argv (cwd = repo root)

| Mode | `C:\Program Files\nodejs\node.exe` + | Profile env (on top of the fresh base env) |
|---|---|---|
| canary | `scripts\offline\canary-main.cjs` | — |
| negative | `scripts\offline\canary-negative.cjs` | — |
| install | `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js ci --offline --ignore-scripts --no-audit --no-fund --no-update-notifier` | `npm_config_cache=C:\Users\dlxod\AppData\Local\npm-cache`, empty run-dir `userconfig`/`globalconfig`, run-dir `logs_dir`, `offline=true`, `ignore_scripts=true`, `audit/fund/update_notifier/progress=false` |
| tsc | `node_modules\typescript\bin\tsc -b` | — |
| vite-build | `node_modules\vite\bin\vite.js build --config scripts/integration/vite-offline-20261017.config.ts` | `PRERENDER=0`, `COCOTRIP_OFFLINE_PORT=5192` (the config requires it; nothing may listen) |
| eslint | `node_modules\eslint\bin\eslint.js .` | — |
| vitest-unit | `node_modules\vitest\vitest.mjs run --config scripts/integration/vitest-offline-20261017.config.ts` + targeted files (below), or nothing for `full` | — |

`package.json`'s `build` (`tsc -b && vite build`) is run as two separate profiles with no cmd shell.
Targeted unit files: `tests/unit/integration-20261017-llm-compare-outcome.test.ts`,
`...-mood-parse-mock-chain.test.ts`, `...-halal-tag-only-not-certified.test.ts`, `tests/unit/llm-esm-load-smoke.test.ts`.

Base env for every profile (nothing inherited): `SystemRoot`/`WINDIR`, `PATH`=nodejs dir, run-dir
`TEMP`/`TMP`/`USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA`/`CLOUDSDK_CONFIG`, `METADATA_SERVER_DETECTION=none`,
`NODE_OPTIONS=--require <guard>`, guard config path and hash. No API keys, no `LLM_PROVIDER`, no
`ESBUILD_BINARY_PATH`, no `.env`, no npmrc auth. The supervisor refuses any env key that looks like
`KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY`, and the guard refuses to start if
`GOOGLE_APPLICATION_CREDENTIALS`, `ESBUILD_BINARY_PATH`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or
`OPENAI_API_KEY` is set.

## Install manifest

`install` refuses if `node_modules` or the manifest already exists, or if the cache or npm is missing. After
a clean run (exit 0, no denials) it checks the locked versions (TS 5.9.3, Vite 7.3.6, Vitest 4.1.11,
ESLint 9.39.5, @playwright/test 1.62.1, esbuild 0.27.2, rollup 4.60.1 and both win32-x64 natives) and the
known esbuild.exe hash/size. Then it writes the read-only file
`...-preservation\offline-install\install-manifest.json`. That file holds the package-lock hash, the hashes
of the entry files, `forks.js`, `suppress-warnings.cjs` (if present), esbuild.exe and the rollup addon, and
an informational inventory of every `*.node`/`*.exe` that arrived.

Every later profile re-verifies the manifest before the run (or refuses) and again after the run (or fails).
A failed install leaves `node_modules` behind, so root must remove it before retrying.

## Child, worker and native rules per profile

| Profile | Allowed node children | Native |
|---|---|---|
| canary | `canary-child.cjs` with argv `spawn`/`fork`/`sync` only; worker `canary-worker.cjs` | none |
| install, tsc, eslint, negative | none | none |
| vite-build | none, plus the Rollup report translation | esbuild.exe, rollup addon |
| vitest-unit | `vitest\dist\workers\forks.js` (argv `[]`; fork execArgv only `--experimental-import-meta-resolve`, `--require <node_modules\vitest\suppress-warnings.cjs>`, and the exact pairs `--conditions node` / `--conditions development`, each at most once; env passthrough `TEST VITEST NODE_ENV VITEST_MODE FORCE_TTY` with plain values, uppercased); `scripts\llm-compare-providers.mjs` with no arguments or exactly `--evaluate=<F>\X` for X in `llm-compare-all-pass.json`, `llm-compare-provider-error.json`, `llm-compare-structure-error.json`, `llm-compare-missing-scenario.json`, `does-not-exist.json` (F = `tests\fixtures\integration-20261017`); `F\esm-load-core.mjs` and `F\esm-load-dup.mjs` with no arguments; plus the Rollup report translation | esbuild.exe, rollup addon |

- **Vitest fork execArgv** was read from the installed `vitest\dist\chunks\cli-api.CnMVyzaz.js`
  (`resolveOptions` ~3798-3812, `resolveConditions` 3814-3830, fork at 3151 with `env`, `execArgv`,
  `stdio:'pipe'`, `serialization:'advanced'`). Conditions are Vite's server defaults minus `module`
  (`node`, `development|production` -> `development`). `--conditions` with any other value, a bare
  `--conditions`, the `--conditions=x` form, or a repeated pair is denied (`child-execargv`). The guard
  `--require` stays first; IPC/stdio/serialization are passed through unchanged.
- **Compare CLI.** The no-argument run exits 2 before any `api/` import. `--confirm-cost` is never in an
  allowed set, so no paid path can start. `does-not-exist.json` is in the hashed inputs as `missing`, so
  creating it during a run fails the run.
- **Rollup report probe.** On Windows, `rollup\dist\native.js:15` calls
  `spawnSync(process.execPath, ['-p', "console.log(JSON.stringify(require('node:process').report.getReport().header));"], { encoding:'utf8', timeout:3000, windowsHide:true })`
  and swallows any error (lines 32-34). The guard translates **only** this call, and only in vite-build and
  vitest-unit (config `rollupReport`, `null` elsewhere). These must all match: `spawnSync`, exe = the fixed
  node.exe, argv exactly `-p` plus that script, exactly those three option keys and values, no callback, the
  direct caller frame is the pinned `native.js`, `native.js` SHA-256 `93c3da45…2b16ea`, and the
  `rollup-platform.cjs` hash pinned in the config. The call is then replaced by
  `node <scripts\offline\rollup-platform.cjs>` with the fresh launcher env (no passthrough), same
  encoding/timeout/windowsHide, and `shell:false`. It is logged as `launch kind=child translated=rollup-report`
  and must report `ready` like any child (`summary.json` has a `rollupReports` count). The `spawnSync` result is
  then checked, because Rollup swallows failures: a `result.error` (including the 3000 ms timeout, which is
  `ETIMEDOUT` with `SIGTERM`), any `signal`, or a non-zero `status` is recorded as a `rollup-report` denial
  (target `result-error:<code>` / `result-signal:<sig>` / `result-status:<n>`), so the run fails **even if the
  child had already written `ready`**. The real result is still returned to Rollup (not thrown). A child that
  never reports ready also fails the run (`launch-not-ready`). If argv matches but anything else doesn't, the
  result is a `rollup-report` denial. Every other `-p`/`-e`/`--eval` is still `child-args`.
- **Vite `net use` probe (optional platform probe, intentionally unavailable).** On Windows,
  `vite\dist\node\chunks\config.js` `windowsSafeRealPathSync` -> `optimizeSafeRealPathSync` (lines 2214-2240)
  calls `exec("net use", (error, stdout) => …)` at line 2230 only to learn mapped network drives for a realpath
  speed-up. On any callback error it returns and the plain `fs.realpathSync` stays in use. Under the old guard
  `exec` threw synchronously, before `firstSafeRealPathSyncRun` was set, so the probe re-ran on every call
  (inferred from the source as the cause of the 8 denials; not separately verified). Now, only in vite-build/vitest-unit (config `viteNetUseProbe`, `null` elsewhere), the guard
  answers **only** this call: command exactly `net use`, exactly two arguments with a function callback, direct
  caller frame = the pinned `config.js` at the pinned line inside `optimizeSafeRealPathSync`, and `config.js`
  SHA-256 `c2fcfa51…12a724ba3`. The callback gets, on `process.nextTick`, an `Error` with
  `code = 'OFFLINE_PLATFORM_PROBE_DISABLED'`, `cmd = 'net use'`, `killed = false`, `signal = null`, and empty
  stdout/stderr. `exec` returns `undefined` (Vite ignores the return value); no `ChildProcess`, shell or
  `net.exe` is ever started, and no success is faked. No mapped drive is enumerated, so Vite keeps the plain
  `fs.realpathSync` path. Each answer writes a separate `compat` record (see below). `net use` with other
  arguments or another caller is a `vite-probe` denial. Every other `exec` and every `execSync` stays
  `child-shell`.
- **Vitest localhost DNS.** Vite's `resolveHostname` (config.js 2349-2363) runs `dns.promises.lookup('localhost')`
  twice (2343) when `server.host` is the default `localhost`. `vitest-offline-20261017.config.ts` sets
  `server.host = '127.0.0.1'`, `hmr: false`, `open: false`, so no lookup happens. Its plugin refuses to run unless
  the resolved `server.host` is exactly `127.0.0.1`. Vitest keeps the server in middleware mode, so nothing
  listens. DNS stays fully denied; there is no DNS allowance.
- **Installed-source pins** (checked by the supervisor before and after vite-build/vitest-unit, separately from
  the unchanged install manifest): `rollup\dist\native.js` `93c3da45…2b16ea` and
  `vite\dist\node\chunks\config.js` `c2fcfa51…12a724ba3` (both profiles), `vitest\dist\chunks\cli-api.CnMVyzaz.js`
  `a236001d…49102e` (vitest-unit). On a mismatch the supervisor refuses (exit 2) before the run, or fails it
  after.
- **esbuild.** Vite/Vitest use esbuild's async service (`spawn ... --service=0.27.2 --ping`, already pinned).
  The `*Sync` path (`execFileSync` or esbuild's own worker thread) is **not** allowed. If a run is denied
  there, it shows as `native-args` or `worker-entry` and needs a separate, source-read rule.

- **esbuild.exe** (`node_modules\@esbuild\win32-x64\esbuild.exe`, SHA-256 `2c9cd2a3…77f5c3`, 11365376 bytes):
  args exactly `--service=0.27.2 --ping`, stdio exactly `pipe,pipe,inherit`, only `cwd`/`windowsHide` options,
  no env or shell. The hash is re-checked in each process before the first launch, and a `launch kind=native`
  record carries it. The guard cannot preload into a native process, so this is cooperative, not OS proof.
- **rollup addon** (`@rollup/rollup-win32-x64-msvc\rollup.win32-x64-msvc.node`): `process.dlopen` is allowed
  only for this path, with the hash pinned from the manifest. Each load is logged as `native-load`. Any other
  addon or exe is denied.
- Every fork gets `execArgv = ['--require', <guard>, ...vetted]`. The guard re-loads before any app import.
  IPC, `stdio`, and `serialization` are preserved. `eval`, `-e`, loaders, `--import`, shells, and other entries
  stay denied.

## What the supervisor enforces (verdict from the ledger, not the app)

A run fails on any of these:

- a non-zero exit or a timeout (the whole process tree is killed via `Win32_Process` parent ids)
- no main `ready`
- a child or worker launch without exactly one matching `ready` of the same role (a worker's pid and tid must also match)
- a `ready` record from an unregistered launch
- a native launch or load whose name or hash isn't pinned, or any native launch with a `validator` (browser only)
- vitest-unit with no guarded `forks.js` launch
- **any** denial count that differs from the profile table
- a `compat` record in a profile without `viteNetUseProbe`, with any field set other than exactly
  `t compat method caller line sourceSha256 result role pid tid ts`, or with values other than
  `vite-net-use-probe` / `child_process.exec` / `config.js` / `2230` / the pinned hash /
  `OFFLINE_PLATFORM_PROBE_DISABLED`; or more than one per process/thread. Valid ones are counted in
  `summary.json` `viteNetUseProbes`; they are not denials and are never hidden.

Ledger record types: `ready`, `launch`, `deny`, `native-load`, `compat`, and (only with a `loaderAdmission`:
vitest-unit full, plan-test, loader-canary) `loader-launch`, `loader-ready`, `loader-complete`. Anything else
fails the run. A `launch` with a `ruleId` is accepted only in the full-unit profiles, for a known rule id and the
hashed helper (Git: `git.exe`, pinned hash, one of 7 ids). See `FULL-UNIT.md` for the loader checks.

Product tables are empty. A test that "expects" an error can never pass because of a guard block: the denial
is still in the ledger and fails the run, even if the app catches it or never awaits it (this includes
Rollup's own catch and the negative-path tests such as `does-not-exist.json` or the dup-export runner). The
run also fails if any of these change during the run: the config, the offline sources (including
`rollup-platform.cjs`), or the fixed repo inputs. The repo inputs are the package files, configs, tsconfigs,
eslint config, the four targeted tests, the compare script and outcome module, the four `llm-compare-*.json`
fixtures, `does-not-exist.json` (must stay missing), `esm-load-core.mjs`, `esm-load-dup.mjs` and
`esm-dup-export.mjs`.

**Self-check.** The canary must pass with its exact table. The negative must have raw exit 0, exactly
`main|external|net.connect`=1 and `main|external|fetch`=1, and no failure other than those two denial-count lines.

## What the guard does

- **Network.** Denies `fetch`, `WebSocket`/`EventSource`, `http`/`https` `request`/`get`/`Agent.createConnection`,
  `http2.connect`, `net.connect`/`createConnection`/`Socket.prototype.connect`, `tls.connect`, every `dns`
  variant, `dgram`, and `net.Server.prototype.listen` (category `listen`; covers http/ws servers, wildcard
  binds and pipes). A connect or listen can only pass for an exact numeric `127.0.0.1:<port>` in the loopback
  allowlist. The allowlist is empty in every phase-2 profile, and the config refuses `localhost`, `::1`,
  `0.0.0.0` or wildcards.
- **Literal `127.0.0.1` in an approved listen (not DNS).** Node 22 `Server.listen(port, host)` runs
  `node:net` `lookupAndListen`, which calls `dns.lookup(address, { all: true }, (err, addresses) => ...)`
  synchronously even for a literal IP (three arguments; Node v22.15.0
  [lib/net.js 2190-2208](https://github.com/nodejs/node/blob/v22.15.0/lib/net.js#L2190-L2208), verified by Astra;
  pilot `20261017-130118-capture-pilot-9f0ac5f5` was denied there: `lookupAndListen:2195` <- `Server.listen:2097`
  <- guard listen). Only while the guarded listen has already passed the exact `127.0.0.1:<port>` allowlist
  check and its original `listen` call is still on the stack (try/finally scope, one use per listen), a
  `dns.lookup` with exactly three arguments, name exactly `'127.0.0.1'`, options a plain object
  (`Object.prototype` prototype) whose only own key (`Reflect.ownKeys`, so no symbols) is an enumerable data
  property `all` with value `true` (no getter/setter), a function third argument, and direct caller frame file
  `node:net` / function `lookupAndListen` is answered in the `all: true` shape:
  `process.nextTick(cb, null, [{ address: '127.0.0.1', family: 4 }])`, return `{}`. The original `dns.lookup` is
  never called, nothing is resolved and no DNS query is made. The scope is cleared (finally) before the callback
  runs, so the callback (and any app code after it) has no allowance. The bind is still the gated listen; no
  record is written, the same as any other allowlist pass; ready, ledger and canaries are unchanged. Any other
  lookup (two arguments, other name, other/extra options, `localhost`, outside the scope, a second lookup in the
  same listen, another caller) stays a `dns.lookup` `dns` denial; `dns.promises.*` and `Resolver` are unchanged.
  With an empty allowlist the scope is never entered. The `node:net` frame name comes from the pilot stack; the
  three-argument contract from Astra's source read. Nothing was executed here.
- **Child processes.** Per-entry rules as above. argv is checked against enumerated sets after the option
  checks, so phase-1 denial categories are unchanged. The env is rebuilt from the launcher env plus rule-listed
  passthrough keys. A caller env that drops or changes the guard keys is refused.
- **Workers.** Only listed entries (only the canary has any). `execArgv` is forced to `--require <guard>`.
  **Order:** a worker's `launch` record is written *after* `super()` returns, because only then does the thread
  id exist. A child's `launch` is written *before* the spawn. If a worker's launch record is never written,
  its own `ready` is unregistered and the run fails. If a child spawn fails, its launch stays not-ready and
  the run fails.
- **Native.** `process.dlopen` and `process.execve` are denied except for the pinned addon. `process.binding`
  is denied for network/process bindings (a tripwire).
- **Validator natives (browser profile hook; no phase-2 profile uses it).** A `nativeExe` entry with
  `validator: 'chromium'|'ffmpeg'` (and no `args`/`stdio`) requires `cfg.nativeRules = { path, sha256, policy }`;
  `nativeRules` without validator entries is an init failure, so absent browser fields change nothing. At init:
  `path` must equal `<guard dir>\browser-native-rules.cjs`; the file is hashed against `sha256`; it must not
  already be in `require.cache`; it is loaded with the literal `require('./browser-native-rules.cjs')` and
  re-hashed; the export must be frozen with a `validateNativeInvocation` function and `PLAYWRIGHT_VERSION`
  `1.62.1`; `policy` must have exactly `runRoot origin browserPath ffmpegPath` (strings), copied and frozen;
  each kind appears at most once and its entry path must equal the policy's `browserPath`/`ffmpegPath`. At
  launch (async `child_process.spawn` only, else `native-validator`): the validator must return `ok` (else
  `native-validator`, reason in the target, 200 chars max), then the pinned size/hash (`native-hash`). Spawn
  options are rebuilt as `{ stdio: <validated stdio>, env, shell:false, windowsHide:true, detached:false }`, no
  `cwd`; `env` is the launcher env minus `NODE_OPTIONS` and every `OFFLINE_GUARD*` key, and the caller's env is
  discarded. A `launch kind=native` record with `entry`, `sha256`, `validator` and the exact `argv` is written
  before the spawn. The esbuild rule (exact args/stdio) is unchanged.

## Not run / known limits

- **Listen-lookup increment (guard5, historical):** the guard SHA changed from guard4 `9D1EB4FC…9C017C`; the
  guard5 self-check PASS (`20261017-130805`) and capture pilot 2 then ran guard-clean (see top). If the arguments
  or the frame differ at runtime, the lookup stays denied (fail closed) and the rule needs a new source read.
- **Earlier increment (historical):** vite-build and targeted vitest-unit PASS (see top). The canary and negative
  have no `rollupReport`, `viteNetUseProbe` or `nativeRules`, so their expected tables are unchanged (the
  canary's `exec` stays `child-shell`). eslint has not run.
- **Browser capture** has a fixed profile in `Run-Capture.ps1` (not this supervisor). Every `Run-Offline.ps1`
  profile keeps an empty loopback allowlist, and `listen`/WebSocket stay denied there. Only the two pilots have
  run; there is no UI evidence yet. The raw proxy-order fix is statically reviewed, not rerun. Full capture,
  matrix, videos and new Fable pixels are pending.
- **`full` now carries the full-unit rules and the plan-local loader admission (unexecuted).** Any spawn outside
  the helper vectors and the static rules is still denied and fails the run. Eval stays denied.
- **module.register** is denied everywhere except the one admitted call per admitted process (FULL-UNIT.md). A
  module.register loader thread runs the guard as role `loader`.
- The ESM core runner imports 12 real `api/` modules in a guarded child. If any of them touches the network,
  DNS, or a child at import time, the denial fails the run. That is intended; it is not masked.
- The Rollup report header is the real one, so it includes host/OS/cpu/`networkInterfaces` fields, as
  upstream. It is read locally with no network call. It only reaches Rollup through the captured stdout and is
  never written to the ledger. Rollup itself only reads `osName` and `glibcVersionRuntime`.
- npm reads the shared existing cache, so cacache may write index or tmp entries there. npm also reads its
  builtin `npm\npmrc`.
- `vite-build` writes `dist-offline-20261017/`, and `tsc -b` writes its build info. Both are expected repo outputs.
- If writing to the ledger fails, the call is still blocked, but that denial isn't counted. On timeout, the tree
  kill relies on parent ids, so orphans whose parent already exited may survive.
