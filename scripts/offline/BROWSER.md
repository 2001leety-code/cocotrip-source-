# scripts/offline — browser capture profile

Status: **written, not executed, not yet PASS.** The guard browser-native integration is now present in `guard.cjs` (GUARD4). It awaits root review, then the pilot. None of the capture files has been run, parsed or syntax-checked (no node, Vite, browser or PowerShell). GUARD4 reports guard4 self-check PASS, vite-build PASS (`20261017-125449-vite-build-448124f0`: exit 0, 0 denials, 1 probe, 1 rollup report) and targeted vitest-unit PASS (`…-125533-vitest-unit-28a4f2c5`: 4 files/79 tests, 0 denials, 14 ready/13 launches). Those are Run-Offline profiles, not a capture run.

What the integrated guard does, as read from `guard.cjs` (not observed in a capture run):

- **Native env.** `nativeEnv` is `LAUNCHER_ENV` minus `NODE_OPTIONS` and every `OFFLINE_GUARD*` key.
- **Spawn.** Validator natives are async `spawn` only.
- **Rules module.** It's loaded only after the path and hash match. It must be a frozen pure module with `PLAYWRIGHT_VERSION === '1.62.1'`.

Added in this revision (unexecuted): the **Vite `net use` probe** integration. See the [Vite mapped-drive probe](#vite-mapped-drive-probe) section.

Resolved in the previous revision (unchanged here):

- **Rollup addon pin.** Now the full verified `2716fd0f879b586b3e1fe1a60d6d6ce0afce75d4b17a4ed799d9f7519816f08f`, size 2539520. It's lowercase because the guard requires `^[0-9a-f]{64}$`. The earlier pin had lost its leading `2`.
- **Rollup report.** The config now carries guard3's actual `rollupReport` (`nativeJs`, `nativeJsSha256`, `entry`, `entrySha256`), the same as `Run-Offline.ps1`. The old `rollupReportCompat` placeholder is gone.
- **`execArgvPairs`.** Every child rule now has it, as guard3 init requires.
- **Process cleanup.** It's now ownership-based, with no command-line matching.
- **Provenance.** A product provenance manifest is taken before and after the run.

Nothing here is a PASS. A capture run produces evidence for human review. Native processes aren't proven offline at the OS level, and there is no OS egress proof.

## Files (this writer owns only these)

| File | Role |
|---|---|
| `Run-Capture.ps1` | Supervisor. `-Mode pilot\|matrix\|videos` only. Fresh run dir, clean env, read-only hashed config, ledger verdict |
| `browser-profile-main.mjs` | Guarded main. Starts Vite in-process on `127.0.0.1:5192`, runs the harness as one guarded node child, always closes the server |
| `browser-native-rules.cjs` | Pure validator `validateNativeInvocation(kind, argv, options, policy)` for `chromium` / `ffmpeg`. No I/O, env reads or execution |
| `BROWSER.md` | This file |

This revision changed only `scripts/integration/vite-offline-20261017.config.ts` and `BROWSER.md` (see [Vite dev client HMR transport](#vite-dev-client-hmr-transport)). The previous revision changed only `Run-Capture.ps1` and `BROWSER.md`. Not edited: `guard.cjs`, `rollup-platform.cjs`, `Run-Offline.ps1`, `README.md` (GUARD3/GUARD4 own these); `browser-profile-main.mjs`, `browser-native-rules.cjs` and the capture harness (under other reviewers now); configs, UI and tests.

## Command (after root review only)

```powershell
$ps = 'E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\scripts\offline\Run-Capture.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode pilot    # first; review evidence
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode matrix
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps -Mode videos
```

| Exit | Meaning |
|---|---|
| 0 | Guard-clean, harness exit 0 |
| 3 | Guard-clean; harness exit 2 or 3 (failures or unverified recorded in the receipt) |
| 1 | Run failed (ledger, denial, hash, timeout, leftover, missing receipt) |
| 2 | Refused |

## What runs

- **Process:** `C:\Program Files\nodejs\node.exe "<repo>\scripts\offline\browser-profile-main.mjs" "<mode>"`, cwd = repo, hidden window, stdout/stderr captured.
- **Server:** main imports `vite` and calls `createServer` with:
  - `configFile = scripts/integration/vite-offline-20261017.config.ts`
  - `mode development`, `envFile:false`
  - `server {host:'127.0.0.1', port:5192, strictPort, open:false, hmr:false}`

  It then checks that `httpServer.address()` is exactly `127.0.0.1:5192`. There's no npm, no shell and no `vite.js` child.
- **Child:** main spawns exactly one child, `process.execPath` with `[<repo>\scripts\integration\customer-capture-20261017.mjs, --base-url, http://127.0.0.1:5192, --out, <run>\capture, ...mode args]`, using `{cwd: repo, stdio:'inherit', windowsHide:true}`. The guard rebuilds its env. The mode args come from the harness's actual `readOptions`:

| Mode | Mode args | Cells |
|---|---|---|
| pilot | `--group planner,charter,result --width 390,1440 --lang ja,en` | 12 |
| matrix | `--group home,planner,result,tours,charter,map,static,account --width 360,390,430,1024,1440 --lang ko,en,ja,zh` | 160 |
| videos | `--group video --width 390,1440 --lang en,ko --video-flow home,planner,charter,tours` | 16 webm (390-en, 1440-ko × 2 motions × 4 flows) |

- **Timeouts:** main kills only its own harness child after 60/420/120 min. After 65/425/125 min the supervisor stops only proven-owned processes (see Process ownership).
- **Rollup:** Vite's `rollup/dist/native.js` probe `spawnSync(node, ['-p', <report script>])` is translated by guard3 into `node <scripts\offline\rollup-platform.cjs>`. That gives a ledger `launch` with `kind:'child'`, `translated:'rollup-report'`, `entry:'rollup-platform.cjs'` and `method:'child_process.spawnSync'`, followed by a guarded `ready` from that child.
- **Vite `net use` probe:** see [Vite mapped-drive probe](#vite-mapped-drive-probe).
- **Harness exit mapping:** main maps harness exit 0/2/3 to 0/12/13. Anything else is 1. Main writes `<run>\profile-main.json`.
- **Browser executable:** no `--browser-executable` is passed. The harness pattern `chrome-win(64)?` rejects the installed `chrome-headless-shell-win64` layout. Instead `PLAYWRIGHT_BROWSERS_PATH=C:\Users\dlxod\AppData\Local\ms-playwright` lets Playwright's registry resolve the headless shell (`headless:true` → `chromium-headless-shell`, coreBundle.js:43106) and ffmpeg (registry only, coreBundle.js:36821). Both are read-only.
- **Skipped host check:** `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` is set. Without it, Playwright spawns `winldd` (coreBundle.js:31875) and writes a `DEPENDENCIES_VALIDATED` marker into the shared cache.

### Run dir layout (`...-preservation\runs\<ts>-capture-<mode>-<id>\`)

The validator depends on it.

```
guard-config.json (read-only, hash in env)  ledger\  tmp\ (=TEMP; Chromium profile + Playwright artifacts)
home\AppData\{Roaming,Local}  capture\ (harness --out; receipt.json, shots\, videos\)  profile-main.json
provenance-before.json  provenance-after.json (both read-only)  provenance-diff.json (only on change)
owned-processes.jsonl  stdout.txt  stderr.txt  summary.json
```

### Environment (cleared, then only these)

- `SystemRoot`, `WINDIR`, `PATH` (nodejs dir)
- run-dir `TEMP`, `TMP`, `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `CLOUDSDK_CONFIG`
- `METADATA_SERVER_DETECTION=none`, `PRERENDER=0`, `COCOTRIP_OFFLINE_PORT=5192`
- `PLAYWRIGHT_BROWSERS_PATH`, `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
- `NODE_OPTIONS=--require <guard>`, `OFFLINE_GUARD_CONFIG`, `OFFLINE_GUARD_CONFIG_SHA256`

There are no keys, no ADC, no proxies, and no user or browser profile. Key names matching `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PROXY` are refused.

### Preflight (all refuse with exit 2)

- **Guard:** the browser-native markers are present (now present in `guard.cjs`). `rollup-platform.cjs` exists.
- **Install manifest:** re-verified using a read-only copy of Run-Offline's logic. That covers the lock hash, the locked versions plus `playwright-core 1.62.1`, every manifest file pin, the optional pins, and esbuild `2c9cd2a3…77f5c3`/11365376.
- **Rollup addon:** must equal `2716fd0f…9816f08f`/2539520 and the manifest's pin.
- **Rollup `native.js`:** must equal `93c3da450b25ba485bb3de20dded405aa9c105951e8d31964eeb49633c2b16ea`, the same as Run-Offline `Test-CompatPins`.
- **Vite `config.js`:** must equal `c2fcfa51206dc1f8d22120ef4a82af8b9acdc02f4476520b6a0897d12a724ba3`, the same as Run-Offline `Test-CompatPins`.
- **Chromium headless shell:** `CE4635CD…CED50EF`/211223552.
- **ffmpeg:** `5B8F3F59…FC0FC1FF4D`/3490816.
- **Product provenance:** before-manifest with no problems (see below).

The install manifest is never written. All the install checks, including `native.js` and Vite `config.js`, are repeated after the run (`installed-changed …`). `rollup-platform.cjs`, `native.js` and Vite `config.js` are also in the before/after source hashes.

### Product provenance (before and after)

- **Trees:** `src\`, `public\`, `api\_shared\` and `api\_ai_core\` (src imports both as source modules), plus repo-root top-level `.html/.json/.js/.cjs/.mjs/.ts/.tsx/.css` files (`index.html`, `package*.json`, `*.config.*`, `tsconfig*`).
- **Harness:** it imports only node builtins and `@playwright/test`. Its `/api` fixtures are inline, so there are no fixture files to add.
- **Never enumerated:**
  - root dotfiles
  - `.env*` names, and names matching `secret|credential|service[-_]?account|adminsdk|*.pem|*.p12|*.pfx`
  - directories `node_modules`, `.git`, `.vite`, `.vite-temp`, `.cache`, `coverage`, `dist`, `dist-*`

  Excluded paths are listed by name only, never read or hashed.
- **Record:** each file gets `{path (repo-relative), size, sha256}`, sorted ordinally. Written locally only; nothing is sent anywhere.
- **Symlinks/junctions:** any reparse point inside a tree, or a tree that is itself one, is never followed. It refuses before the run and fails after it. An unlistable directory or unreadable file is handled the same way.
- **After the run:** the added, deleted and modified (size or hash) files, plus any change in the excluded-name set, are written to `provenance-diff.json`, and each kind is a failure. The existing fixed input hashes (`$RepoInputs`, offline sources) are kept unchanged alongside this.

## Guard integration contract (now integrated in `guard.cjs`; awaiting root review)

Config `schema: 3` as written by `Run-Capture.ps1`. Fields beyond phase 2:

```jsonc
"loopbackAllowlist": ["127.0.0.1:5192"],
"childRules": [{ "entry": "<repo>\\scripts\\integration\\customer-capture-20261017.mjs",
                 "argSets": [[ "--base-url","http://127.0.0.1:5192","--out","<run>\\capture", ...mode args ]],
                 "execArgvFlags": [], "execArgvRequire": [], "execArgvPairs": [], "envPass": [] }],
"workerEntries": [],
"nativeExe": [ { esbuild: path, sha256, size, args, stdio },                // unchanged phase-2 rule
               { "path": "<chrome-headless-shell.exe>", "sha256", "size", "validator": "chromium" },
               { "path": "<ffmpeg-win64.exe>",          "sha256", "size", "validator": "ffmpeg" } ],
"nativeAddons": [ { rollup path, sha256, size } ],
"nativeRules": { "path": "<repo>\\scripts\\offline\\browser-native-rules.cjs", "sha256": "<hex>",
                 "policy": { "runRoot": "<run>", "origin": "http://127.0.0.1:5192",
                             "browserPath": "<chrome-headless-shell.exe>", "ffmpegPath": "<ffmpeg-win64.exe>" } },
"rollupReport": { "nativeJs": "<repo>\\node_modules\\rollup\\dist\\native.js",
                  "nativeJsSha256": "93c3da450b25ba485bb3de20dded405aa9c105951e8d31964eeb49633c2b16ea",
                  "entry": "<repo>\\scripts\\offline\\rollup-platform.cjs",
                  "entrySha256": "<before-run hash of rollup-platform.cjs>" },  // same fields as Run-Offline.ps1
"viteNetUseProbe": { "configJs": "<repo>\\node_modules\\vite\\dist\\node\\chunks\\config.js",
                     "configJsSha256": "c2fcfa51206dc1f8d22120ef4a82af8b9acdc02f4476520b6a0897d12a724ba3",
                     "line": 2230 }                                          // same fields as Run-Offline.ps1
```

`nativeAddons` is `{ path: <rollup .node>, sha256: "2716fd0f879b586b3e1fe1a60d6d6ce0afce75d4b17a4ed799d9f7519816f08f", size: 2539520 }`.

The guard must do the following:

1. **Init.** If any `nativeExe` entry has a `validator`, then `cfg.nativeRules` is required. Its `validator` must be `chromium` or `ffmpeg`, and the entry has no `args`/`stdio`.
   - `norm(nativeRules.path)` must equal `norm(path.join(__dirname, 'browser-native-rules.cjs'))`.
   - Hash the file bytes and compare them to `nativeRules.sha256` **before** loading.
   - Then load it with the literal `require('./browser-native-rules.cjs')`. The path never comes from a caller.
   - Keep the module object and `nativeRules.policy` frozen in closure.
   - Any mismatch is `initFail`. (`Run-Capture.ps1` checks for the markers `require('./browser-native-rules.cjs')` and `validateNativeInvocation` in `guard.cjs`.)
2. **`vetNative`, when `rule.validator` is set.** Use these instead of the exact-args/`cwd|stdio|windowsHide`-only checks:
   - `const v = rules.validateNativeInvocation(rule.validator, argv, options, policy)`. If `!v.ok`, throw `deny(method, 'native-validator', base)`. The reason may go into the ledger target and is truncated to 200 chars.
   - `pinnedFileOk(rule)` must hold, otherwise `native-hash`. Hash before the first use in each process, as for esbuild.
   - Return `safe = { stdio: options.stdio.slice(), env: nativeEnv, shell: false, windowsHide: true, detached: false }`. Leave `cwd` out. `nativeEnv` is `LAUNCHER_ENV` minus `NODE_OPTIONS` and every `OFFLINE_GUARD*` key; Playwright's `options.env` (the harness `process.env`) is discarded. Validator natives are allowed through async `spawn` only.
   - Write `record({ t:'launch', kind:'native', id, method, entry: base, sha256: rule.sha256, validator: rule.validator, argv })` **before** the spawn. The supervisor requires `validator` to match the pin, and requires exactly 1 Chromium launch and 16 ffmpeg launches for `videos` (0 otherwise).
3. **What Playwright 1.62.1 actually passes** (coreBundle.js:8899–8911): `childProcess.spawn(exe, args, { detached: false /*win32*/, env, cwd: undefined, shell: undefined, stdio })`.
   - Chromium: stdio `['ignore','pipe','pipe','pipe','pipe']`.
   - ffmpeg: stdio `['pipe','pipe','pipe']` (`stdio:"stdin"`), with `env` undefined.
   - The keys exist even when their value is undefined, so phase-2 `vetNative` denies them as `native-option`. That's why the validator path is needed.
4. **Kill path stays denied.** Playwright's force kill on win32 is `spawnSync('taskkill /pid N /T /F', {shell:true})` (coreBundle.js:8988). It must remain denied. A denial there fails the run, and the supervisor's ownership-based cleanup stops what's left.
5. **Rollup.** Already in guard3 (`isRollupReport` / `rollupReportCall`). It applies only with `cfg.rollupReport` set, which this profile does. Every other `-p`/`-e` stays denied.
6. **Vite probe.** See [Vite mapped-drive probe](#vite-mapped-drive-probe).
7. **Ledger.** No record types beyond Run-Offline's. The supervisor accepts only `ready|launch|deny|native-load|compat` and treats every denial as a failure.

### Vite mapped-drive probe

Vite's optional Windows mapped-drive optimization (`config.js` `optimizeSafeRealPathSync`) calls `exec('net use', cb)`. The capture config disables it explicitly with the same `viteNetUseProbe` fields as Run-Offline (vite-build / vitest-unit).

**Guard behaviour** (`guard.cjs`, not edited here):

- **Not executed.** The guard never runs `net use`.
- **Exact pinned call only.** The call must be exactly two args with a function callback, and its direct caller must be the pinned `config.js` at line 2230 in `optimizeSafeRealPathSync`, with the file hash matching.
- **Answer.** That call gets an async callback error `OFFLINE_PLATFORM_PROBE_DISABLED` with empty output. No child or shell is started. Vite then keeps its real `fs.realpathSync` fallback.
- **Ledger.** It writes one `compat` record.
- **Everything else is denied.** Any other `exec` and every `execSync` stay `child-shell` denials. There's no arbitrary shell and no DNS allowance.

**Supervisor rule** (same as Run-Offline). It accepts only this exact record, with exactly these fields:

```jsonc
{ "t":"compat", "compat":"vite-net-use-probe", "method":"child_process.exec", "caller":"config.js", "line":2230,
  "sourceSha256":"c2fcfa51…a724ba3", "result":"OFFLINE_PLATFORM_PROBE_DISABLED",
  "role":"main|child|worker", "pid", "tid", "ts" }
```

- **Once per thread.** At most one record per pid/tid; a repeat fails as `compat-repeated`.
- **Registered owner.** The record's pid, tid and role must match exactly one `ready` record, and that ready must be main or a registered guarded launch. Otherwise it fails as `compat-unregistered`.
- **Any other compat record** fails as `compat-unexpected`.
- **Summary.** `summary.json` records `viteNetUseProbes` (count).
- **Pinned bytes.** `config.js` is checked before and after the run: in preflight, `installed-changed` and the source hashes.

### Vite dev client HMR transport

Status: **written, runtime pending, not PASS.** Pilot3 captured valid product UI: all 12 cells reached their expected states, the guard was clean and the source was unchanged. It still failed on 16 console errors, all from the Vite dev client's HMR WebSocket attempt, which the existing WS block correctly refuses.

**Why `hmr:false` is not enough.** In Vite 7.3.6, `config.js` 27491–92 (`vite:client-inject`) treats a non-object `server.hmr` the same as the default client options. The installed `client.mjs` 823 then still runs `transport.connect(createHMRHandler(handleMessage));`, so `/@vite/client` opens a WebSocket on every page.

**Fix.** The offline config has a plugin, `cocotrip-offline-20261017-vite-client`, with `apply:'serve'` and `enforce:'post'`:

- **Startup pin.** At `configResolved` it hashes `<repo>\node_modules\vite\dist\client\client.mjs` and refuses to start unless the SHA-256 is `ADC8D1D9BAB80984E8F7136074AF8EE8E6F63BCF8EE75D8950577E4BD73AF23A`. The file is hashed again when it's transformed.
- **Exact target.** It transforms only the id equal to that file's path in Vite's `normalizePath(CLIENT_ENTRY)` form. The same file under any other id form (query, backslashes, different case) throws. Every other module is untouched.
- **Exact call.** The transform input must contain the call string exactly once, otherwise it throws. Only that call is replaced, with an explicit offline no-op comment. The rest of the client, including `updateStyle`/`removeStyle`, CSS handling and exports, is unchanged. It returns `map: null` and prints one stdout line per transform.
- **Ordering.** The plugin runs **before** `vite:client-inject`: in the installed Vite 7.3.6 `config.js`, `postPlugins` (28508) come before `clientInjectionsPlugin` (28511). The target call contains no injected constant, so the replacement survives the later injection and the order doesn't affect the match.
- **Nothing mutated.** `node_modules` is never written.

**Not changed:** browser WS/HTTP routing, default-deny, console classification, the guard and the harness. No dev WebSocket should be opened at all. If client code calls `transport.send`/`invoke`, it now throws `called before connect`, which surfaces as an error (fail closed). That's expected not to happen without HMR traffic, but it hasn't been observed. If Vite's resolved client path differs from `<repo>\node_modules\vite` (or by drive-letter case), the plugin either throws or never sees the target. The pilot would then fail again on console errors, never pass silently.

### What the validator enforces

The expected values come from the installed bundle. Any other Playwright version is refused by preflight; any other arg list is refused at launch.

- **Chromium argv:** exactly, in order:
  1. `chromiumSwitches()` (coreBundle.js:34639)
  2. `--enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=… --no-sandbox`
  3. `--proxy-server=http://127.0.0.1:9`
  4. `--proxy-bypass-list=<-loopback>;127.0.0.1:5192`
  5. the 8 harness args

  Items 3–4 are raw harness args, the first entries of `launch({ args })`. The harness doesn't use the `proxy` launch option. With `proxy: { bypass: '127.0.0.1:5192' }`, Playwright appends `<-loopback>` last (coreBundle.js:43077–43093). In Chromium the last matching rule wins, so that subtractive rule overrode the explicit origin, and pilot `20261017-130830-capture-pilot-cf2cc3fe` got `ERR_PROXY_CONNECTION_FAILED` in all 12 cells. Those screens are browser error pages, not UI evidence. Putting `<-loopback>` first removes the implicit loopback bypass. The exact numeric `127.0.0.1:<port>` last restores only that origin. There is no localhost, wildcard, bare-loopback or CIDR entry. Sources: Chromium `net/docs/proxy.md` (implicit bypass ordering) and `proxy_host_matching_rules_unittest.cc` (`RemoveImplicitAndAddLocalhost` / `AddLocalhostThenRemoveImplicit`). This ordering hasn't been run yet.
  6. `--user-data-dir=<runRoot>\tmp\playwright_chromiumdev_profile-XXXXXX`
  7. `--remote-debugging-pipe --no-startup-window`

  Positional URLs, `--remote-debugging-port`, extensions, extra switches, files and other profiles are rejected because the list is exact.
- **ffmpeg argv:** exactly coreBundle.js:36869 (`-f matroska … -i pipe:0 -y -an -r 25 -c:v vp8 … -vf <filter>`), followed by one output.
  - The `-vf` filter is `pad=W:H:0:0:gray,crop=W:H:0:0`, the recorder default at coreBundle.js:36868 (CRPage has no `getFFmpegVideoFilterArgs`; the `scale=…` filter at 41847 is BidiPage's and was wrongly copied before 2026-10-18, which denied run `20261018-182251-capture-videos-9cd5e4f6`), with W×H strictly `390x844` for `390-en` or `1440x1000` for `1440-ko`.
  - The output must be `<runRoot>\capture\videos\<home|planner|charter|tours>\<390-en|1440-ko>-<no-preference|reduce>\raw\page@<32 hex>.webm`.
  - There are no file or network inputs.
- **Options:** only `detached|env|cwd|shell|stdio`, with `detached===false`, shell unset or false, cwd unset, env an object or undefined, and the exact stdio per kind.
- **Policy:** canonical absolute `runRoot`; origin exactly `http://127.0.0.1:<port>`; exe paths that end in the expected file names and sit outside `runRoot`.

## Supervisor verdict (fails on any)

- exit code not 0/12/13, or a timeout
- main not ready (or wrong pid or node version), or any `ready` whose `guardSha256`/`configSha256` differ from the config
- guarded launches that aren't exactly:
  - one harness launch (`kind:'child'`, no `translated`, entry `customer-capture-20261017.mjs`, `child_process.spawn`), recorded by main's pid
  - zero or more Rollup report launches (`kind:'child'`, `translated:'rollup-report'`, entry `rollup-platform.cjs`, `child_process.spawnSync`)

  Rollup report launches must be recorded by main or by the harness child, at most one per launching process (native.js caches the header).
- any other guarded launch (other entry, a worker, another `translated` value)
- any guarded launch without exactly one matching `ready` with role `child` and an empty `execArgv`
- an unregistered `ready`
- a `compat` record that is not the exact Vite probe record, is repeated for a pid/tid, or doesn't belong to a registered ready
- a native launch with an unpinned name, hash or validator
- a Chromium count ≠ 1, or an ffmpeg count ≠ the mode's expected count
- a native load other than the pinned Rollup addon
- **any** denial
- a config, source, Playwright bundle, install, `native.js`, Vite `config.js` or native pin that changed
- any product provenance addition, deletion, modification, excluded-set change or after-run problem
- a missing or incomplete `receipt.json`
- any process-ownership failure (below)

`summary.json` keeps the guard result separate from the harness result. It records `rollupReports`, `viteNetUseProbes`, the provenance hashes and counts, and `ownedProcesses` (pid, parent pid, creation time, exe, outcome).

### Process ownership and cleanup

Nothing is matched by command line. CommandLine is never queried, logged or persisted.

**Discovery**

- **Root:** the `Process` object the supervisor started (main), with its start time.
- **Scan:** every 2 s while main runs, and again during cleanup, the supervisor reads only `ProcessId, ParentProcessId, CreationDate, ExecutablePath` from `Win32_Process`. Rows of unrelated processes are not kept.
- **Ownership rule:** a process is owned only if its parent is already owned and it was created at or after that parent. An earlier holder of a reused parent PID is therefore excluded.
- **Handle:** the supervisor opens a handle to each owned process at discovery and holds it until the end of the run. While a handle is open, the PID can't be reused. The handle's start time must match the scanned creation time within 1 ms; a mismatch means the PID was already reused, and the process is not ours.
- **Log:** each identity (pid, parent, creation UTC, exe, role) is appended to `owned-processes.jsonl` while the process is alive.

**Cleanup**

1. **Normal exit (graceful).** After main exits, owned processes get up to 15 s to exit on their own.
2. **Timeout.** No grace period, because main is hung.
3. **Stop.** Each still-alive owned process is stopped through its own held handle (`Process.Kill()`: one process, no tree, no shell, no `taskkill`, no global settings). Stops run latest-discovered first and main last, for up to 3 rescans. Each stop is a failure (`leftover-process` or `timeout-stopped`).
4. **Only known executables are stopped:** node.exe, this repo's esbuild.exe, the pinned headless shell and ffmpeg, and System32 `conhost.exe`. An owned process with another or an unreadable exe fails the run (`unexpected-descendant-exe`) and is left running.

**Fail closed, never resolved by killing**

- **`process-scan-failed`:** a `Win32_Process` query failed.
- **`process-ownership-unproven`:** a child of an owned process exists but can't be opened.
- **`unattributed-native`:** a pinned headless shell, ffmpeg or esbuild was created after main started and isn't attributable to the owned tree. That covers orphans whose parent was never observed, and also another concurrent Playwright user, which fails the run as well.
- **`owned-still-alive`:** an owned process survived the stop.

## Limitations (stated, not hidden)

- **Native processes aren't proven offline.** Chromium, its renderer/GPU/utility subprocesses, ffmpeg and esbuild can't load the Node guard.
  - The evidence is the pinned hash plus the exact validated argv in the ledger, plus the browser-side layers: harness routes before goto, service workers blocked, the dead proxy `127.0.0.1:9` with only the exact origin bypassed, and background networking/component update/sync/pings off.
  - None of this is OS egress proof. Zero OS-level egress is **not** claimed.
- The Vite server runs in the guarded main process. Node-side network from Vite or plugins stays under the guard: the `/api` proxy is removed by the config, and any connect or DNS is denied and fails the run. Browser→server traffic on `127.0.0.1:5192` is native-to-Node loopback and isn't in the ledger.
- The run writes into the repo: Vite writes `node_modules\.vite\` (the dep optimizer) and the config-bundle temp files. Those are outside the provenance trees and aren't hashed. A temp file left at the repo root would show up as a provenance addition and fail the run.
- Provenance covers only the fixed trees above, not all of `scripts\` or `tests\`. It is a before/after comparison: a file changed and restored during the run isn't detected.
- Chromium's own subprocess stop relies on Playwright's graceful close. A forced kill is a guard denial, which fails the run, followed by ownership-based cleanup.
- Ownership discovery polls every 2 s. A process that is created and orphaned (parent exits) between two scans can't be proven owned. If it's a pinned native it's reported as `unattributed-native` and left running; otherwise it is not detected. The ownership code has not been executed either. `Process.Handle`/`StartTime` behaviour and the `Win32_Process` field reads are reviewed assumptions, not observed ones.
- Phones are Chromium emulation. Maps and fixtures are synthetic. See `scripts/integration/CAPTURE-20261017.md`. CAPTURE-20261017.md proposed dev port 5191; this profile uses 5192 as instructed.
- Nothing has been executed: no node, Vite, browser or PowerShell, and no syntax check. Whether Vite in main (or the harness) actually triggers the Rollup report or `net use` probe in a capture run is not observed; the verdict accepts zero or one per process (per pid/tid for `compat`). The order is:
  1. Root review of the integrated guard and this supervisor.
  2. Run the pilot first and review its evidence.
