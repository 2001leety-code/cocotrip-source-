# INTEGRATION 2026-10-17 — CORE follow-up (CORE2)

Writer: Opus (CORE2). Review: Astra. Scope is three narrow fixes. **Nothing in this doc has been executed.**
Edits were made with Read/Glob/Grep/Edit/Write only. No node, npm, vitest, git, network, credentials, or `.env`.

## Files changed

| File | Change |
|---|---|
| `api/mood-parse-schedule.js` | The mock decision now happens before key resolution, and the key is resolved inside the mock context. |
| `tests/unit/integration-20261017-mood-parse-mock-chain.test.ts` | Adds a block for the default provider with no keys. |
| `scripts/integration/llm-compare-outcome.mjs` | Adds `structureErrors` checks, explicit expected scenario IDs, and detection of missing, duplicate, and unexpected scenarios. |
| `scripts/llm-compare-providers.mjs` | Records `scenarioId` on each row and `expectedScenarios` in the artifact. Exits with 5 on an unknown or duplicate `--scenarios` value. |
| `tests/unit/integration-20261017-llm-compare-outcome.test.ts` | New cases plus CLI `--evaluate` runs against fixed fixtures. |
| `tests/fixtures/integration-20261017/llm-compare-all-pass.json` | Updated with `expectedScenarios`, `scenarioId`, and `structureErrors: []`. |
| `tests/fixtures/integration-20261017/llm-compare-provider-error.json` | Updated with the same fields. |
| `tests/fixtures/integration-20261017/llm-compare-structure-error.json` | **New.** |
| `tests/fixtures/integration-20261017/llm-compare-missing-scenario.json` | **New.** |
| `tests/unit/llm-esm-load-smoke.test.ts` | `node -e` replaced by fixed runner files. |
| `tests/fixtures/integration-20261017/esm-load-core.mjs` | **New.** Fixed runner that loads the 12 CORE modules. |
| `tests/fixtures/integration-20261017/esm-load-dup.mjs` | **New.** Fixed negative-control runner. |
| `tests/fixtures/integration-20261017/esm-dup-export.mjs` | **New.** Deliberately invalid module with a duplicate export. Not a child entry. |

No payment code, food index, guard, capture, UI, or `CORE.md` files were touched. No new `??` was added: the code uses `||` only.

## 1. MOOD mock key readiness

**Bug.** The handler called `resolveLlmApiKey('mood')` outside any LLM context. When `LLM_PROVIDER` is unset (the default, gemini) and `GEMINI_API_KEY` is absent, it threw and the handler returned `AI_NOT_CONFIGURED`. That happened even for an authorized `x-llm-mock: 1` request that would never call a provider.

**Fix (minimal).**
- `useMock = wantsLlmMock(req)` is evaluated at the same point as before. That point is after auth, email verification, body checks, DB init, and the allowlist check.
- `inLlmScope(fn)` wraps both key resolution and `extractStops` in `runWithLlmContext({ provider: 'mock' })` when the request is mocked.
- Inside the mock context, `resolveLlmProvider` returns `mock`. So `resolveLlmApiKey` returns its placeholder, and `createLlmModel` builds the mock model.
- Without the header, behaviour is unchanged. With no key you still get `AI_NOT_CONFIGURED`, and no real provider is constructed.

**What is preserved:**
- **Gates and order.** Auth, email, and allowlist run in the same order, and the mock header does not bypass any of them.
- **Kill switch.** The guard inside `createLlmModel` still runs for the mock provider, covering both the env switch and the runtime flag.
- **Daily usage limit.** The mock provider is still excluded by the adapter's existing design. This was not changed.
- **Confirmation.** The handler still sets `needsConfirm: true` on every response.
- **No workaround.** The fix does not rely on `LLM_PROVIDER=claude`.

**Tests added** (real adapter → real `mock.js` → real handler; same boundary mocks as before). In this block `LLM_PROVIDER`, `LLM_PROVIDER_MOOD`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` are all unset.
- **Mock header.** Returns `ok:true` with non-empty stops (the fixture count), `needsConfirm:true`, and serviceGuess `airport`. The kill-switch flag is read once, `llm_guard` is not touched, usage records model `mock:mood`, and no Sentry error is raised. Afterwards, outside the handler, the provider is still `gemini` and the key still throws, which shows the context does not leak.
- **No header.** Returns `AI_NOT_CONFIGURED` with no LLM guard, no placebook read, and no Sentry error.
- **Header `'true'` (not `'1'`).** Returns `AI_NOT_CONFIGURED`.
- **Mock header + runtime-flag kill switch, and mock header + `LLM_KILL_SWITCH=1`.** Both return `AI_PARSE_FAILED` with error code `LLM_DISABLED`.
- **Mock header with failing gates.** Missing auth, unverified email, and a non-allowlisted user return `AUTH_REQUIRED`, `EMAIL_UNVERIFIED`, and `NOT_ALLOWED`. No guard runs and no usage is recorded.
- **Existing tests.** The Claude-provider tests and the auth tests are unchanged.

## 2. Compare harness outcome

**Bugs.** `rowFailures` ignored `structureErrors`, which holds B-10/12/14/15 output. And `evaluateCompareRun` built its expected scenario set from the rows themselves, so a scenario with no rows for any provider was invisible. `SCEN` also silently dropped unknown `--scenarios` IDs.

**Fix:**
- **Row checks.** A missing or non-array `structureErrors` gives `structure_unknown`. A non-empty one gives `structure_errors`. Both fail.
- **Scenario IDs.** Each row now has a `scenarioId`, which is the `ALL` key (for example `seoul-meat`). The existing display label `scenario` (for example `seoul-2d-Meat-ko`) is kept unchanged for compatibility. Pairing is done by `scenarioId` only.
- **Expected list.** The run artifact carries `expectedScenarios: SCEN`. The harness passes it into `evaluateCompareRun` and saves it in the JSON.
- **Run-level failures** (`runErrors`): `expected_scenarios_missing`, `_empty`, `_invalid`, `_duplicate`, and `providers_missing`. Old artifacts without `expectedScenarios` therefore **fail closed**.
- **Row-level failures:** `scenario_id_missing` (a label alone is not an ID), `unexpected_scenario`, `duplicate_row`, and `unexpected_provider`.
- **Missing coverage.** `missingPairs` now comes from expected × providers. `missingScenarios` lists expected IDs with no row at all, printed as `<id>: missing_scenario`.
- **Bad `--scenarios`.** An unknown, duplicate, or empty value exits **5** before any `api/` import or cost estimate, so it costs nothing.
- **Unchanged:**
  - The result artifact is still written before `process.exitCode` is set. A source-order test checks this.
  - `--evaluate` and the `--confirm-cost` check still run before any `api/` import.
  - `--max-usd` (default 5) is still **only a preflight estimate** and is not a hard spend cap. The script header says so.

**Fixtures and expected exit codes.** Each runs as `node scripts/llm-compare-providers.mjs --evaluate=<abs path>`:

| Fixture | Expected exit |
|---|---|
| `llm-compare-all-pass.json` | 0 |
| `llm-compare-provider-error.json` | 1 |
| `llm-compare-structure-error.json` | 1 (`claude seoul-meat: structure_errors`) |
| `llm-compare-missing-scenario.json` | 1 (`jeju-vegan: missing_scenario`) |
| `does-not-exist.json` (absent on purpose) | 4 |

There is also one no-argument run, which is expected to exit 2. No API calls are made and no `-e` is used.

## 3. ESM load smoke without `node -e`

**Problem.** The smoke test spawned `node --input-type=module -e ...`, which the offline guard denies because nothing may appear before an approved entry.

**Fix:**
- **Fixed runners.** `esm-load-core.mjs` holds the exact 12 CORE paths, the same list as before with no module dropped. It resolves them from its own location (`../../../`), imports each one with the real Node ESM loader, and checks that each namespace is non-empty. It prints `LOADED 12`, or `ESM_LOAD_FAILED <module> <ErrorName>: <message>` with exit 1. It refuses any argv (exit 64).
- **Negative control.** `esm-load-dup.mjs` uses the same import and report style to load `esm-dup-export.mjs` (`export const A = 1; export { A };`).
- **How the test spawns.** It runs `spawnSync(process.execPath, [<absolute runner>], { cwd: ROOT, env, encoding, timeout })`. There are no extra args, no `execArgv`, and no shell.
- **Child env:**
  - Starts as `{ ...process.env }`, so `NODE_OPTIONS` and `OFFLINE_GUARD_CONFIG` stay byte-identical, which the guard's `envKeeps` requires.
  - Adds `METADATA_SERVER_DETECTION=none`.
  - Removes only the credential keys: FIREBASE_*, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_APPLICATION_CREDENTIALS, GEMINI_API_KEY, and ANTHROPIC_API_KEY.
  - No fake keys are added and there is no global setup change.
- **Assertions:**
  - The runner's module list equals the 12-entry CORE list.
  - The guard keys in the child env are unchanged.
  - The core runner exits 0, prints `LOADED 12`, and has no `OFFLINE_GUARD_DENIED`.
  - The dup runner exits 1 with stderr matching `ESM_LOAD_FAILED esm-dup-export.mjs SyntaxError: Duplicate export of 'A'` and no guard denial. A non-zero exit or a guard error alone does not pass.

**AdminDB at import (static inspection only, not executed).**
- `api/_shared/firebase-admin.js` bootstraps at import time, but it calls `initializeApp` only when FIREBASE_* or GOOGLE_SERVICE_ACCOUNT_KEY credentials exist. With those removed it logs a warning and leaves `_adminDb = null`.
- The module-level `initAdminDb(...)` calls in `handlerCore.js`, `ai-planner-quick.js`, `chat.js`, `translate-plan.js`, `course-ai.js`, and `place-search.js` only return that null. They make no network call.
- `user-auth.js` and `admin-auth.js` initialise lazily inside their functions.
- Other import-time `initializeApp()` calls without credentials (`api/recalc-transit.js`) are **not** in the CORE import graph as far as Grep shows. I did not trace the full transitive graph exhaustively.
- **Conclusion:** importing CORE without credentials should attempt no DB or metadata access. This is unproven until it runs under the guard, and the guard ledger is the real proof.

## Guard allowlist request (for the guard owner — I did not edit `scripts/offline`)

**Approved child entries.** Use absolute paths, with no args after the entry:
- `E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\tests\fixtures\integration-20261017\esm-load-core.mjs`
- `E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\tests\fixtures\integration-20261017\esm-load-dup.mjs`
- `E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\scripts\llm-compare-providers.mjs`. This one takes exactly one argument, `--evaluate=<abs fixture>`, using the fixtures below. It is also run once with no arguments, which is expected to exit 2.

**Fixed `--evaluate` fixture paths.** All are under `tests\fixtures\integration-20261017\`:
- `llm-compare-all-pass.json`
- `llm-compare-provider-error.json`
- `llm-compare-structure-error.json`
- `llm-compare-missing-scenario.json`
- `does-not-exist.json` (intentionally absent, expected exit 4)

**Expected outcome under the guard.** Zero network denials from all of these. `esm-dup-export.mjs` is imported, not spawned.

Note: phase-1 guard does not support Vitest yet, per its README. So these tests can only run under the guard once Vitest support lands. Until then they run in the normal offline Vitest config.

## Not run / open items

- **Not executed:** none of the tests above, `npm run build`, `npm run test:unit`, or any node process. Status is **unverified** until run.
- **Exact Duplicate-export wording.** The expected string `Duplicate export of 'A'` is V8's message. If the pinned Node version words it differently, the dup test will fail loudly. That is a visible failure, not a false pass.
- ~~`api/_ai_core/geminiPipeline.js` is `UU` (unmerged) in the git index.~~ **Superseded 2026-10-17 (CORE3 update below):** root resolved and staged it. No unmerged entries remain.
- **`.mjs` tooling.** ESLint covers only `**/*.{ts,tsx}` and Vitest only `tests/unit/**/*.test.{ts,tsx}`, so the deliberately invalid `esm-dup-export.mjs` is not linted or collected. Any other tool that globs `**/*.mjs` would trip on it by design.

---

## Update 2026-10-17 — CORE3 (Opus writer, Astra review)

Same constraints as before: Read/Glob/Grep/Edit/Write only. **Nothing below has been executed.** No test result is claimed.

### Repo state (reported by root; not re-verified by me)

- **Merge.** Root ran the reviewed resolver `A2EE75…`. Its output matched for `geminiPipeline.js` (`ECB64F…`) and the map (`899C679…`). Root staged both. **No unmerged entries remain.** The `UU` open item above is superseded.
- **Guard.** Canary PASS (38 denial cases), ready 5, launch 4.
- **Still pending.** Phase 2 has not landed, so no product tests have run under the guard yet.

### Files changed (CORE3)

| File | Change |
|---|---|
| `scripts/integration/llm-compare-outcome.mjs` | `providers` must be recorded in the run, non-empty, valid, and unique. It is never inferred from rows. |
| `tests/unit/integration-20261017-llm-compare-outcome.test.ts` | Provider cases are pure function calls. No new CLI fixture. |
| `tests/fixtures/integration-20261017/projection-worker.mjs` | **New.** A fixed worker replaces the worker source the test used to generate in TMP. |
| `tests/fixtures/integration-20261017/projection-exit.mjs` | **New.** A fixed process that exits immediately, replacing `node -e ""`. |
| `tests/unit/apply-brain-guide-projection.test.ts` | Spawns the two fixed files. Adds one bad-payload rejection case. |
| `tests/unit/plan-local-prewrite-quality-gate.test.ts` | `'node'` becomes `process.execPath`. The negative case now asserts the real gate diagnostic. |

No production projection or plan-local code changed. No auth, payment, or SSOT code changed. No new `??`.

### 1. Compare helper: providers fail closed (Astra P2)

**Bug.** When `run.providers` was missing or empty, `evaluateCompareRun` took the provider list from whatever rows existed. If every Claude row was lost, the list became `['gemini']` and the run could PASS.

**Fix.** Providers now follow the same rule as `expectedScenarios`. Each of these is a run error and gives exit 1:
- `providers_missing`: absent, or not an array.
- `providers_empty`
- `providers_invalid`: a non-string or blank entry.
- `providers_duplicate`

Valid runs behave as before. All four CLI fixtures already record `["gemini","claude"]`, so the `--evaluate` exit codes are unchanged. The policy is not broadened: coverage is still the recorded expected scenarios × the recorded providers.

**Note for the harness owner (not my file).** `--providers=gemini,gemini` would now fail with `providers_duplicate` only after the paid run. Before this change it already failed with `duplicate_row`. An early exit 5, like the one `--scenarios` has, would be a cheap follow-up.

### 2. Projection test: fixed child entries

- **`projection-worker.mjs`.** This is the same worker logic, moved into a fixed file. It imports `../../../scripts/apply-brain-guide-projection.lib.mjs` by a fixed relative path and calls it with `lockWaitMs: 5000`. Inside `afterLockAcquired` it writes `__LOCK_ACQUIRED__`, then holds the lock with `Atomics.wait` for `holdMs`. On success it writes the result JSON to stdout. On error it writes the stack to stderr and exits 1.
- **The worker's one argument is data only.** It is a base64url JSON object with exactly the keys `{root, manifest, holdMs}`:
  - `root` must be absolute, its parent must be `os.tmpdir()`, and its basename must start with `cocotrip-guide-projection-`.
  - `manifest` must be a plain object.
  - `holdMs` must be an integer from 0 to 10000.
  - Anything else gives `PROJECTION_WORKER_BAD_PAYLOAD <reason>` with exit 64, before any projection.
  - The worker never takes a module path.
- **What the test keeps.** The real two-child concurrency, the lock marker, lock release, the index/sitemap checks, the rollback negatives, and the TMP cleanup are unchanged. The test no longer writes anything into root.
- **Stale-PID case.** It spawns `projection-exit.mjs` with no args and keeps the real child PID. It waits for the real `close` event and now also asserts exit code 0. A guard-denied or failed spawn therefore cannot stand in for "a process that ran and exited".
- **New case.** A root outside the test prefix makes the worker exit 64 with the bad-payload diagnostic and no lock marker.

### 3. plan-local CLI test

- `execFileSync(process.execPath, [RUN_MJS, <scenario>], { cwd: ROOT, stdio: 'pipe' })`. The args, cwd, and output are the same as before.
- **Negative case (`__test_daycount_mismatch__`).** A throw alone no longer passes. The test now requires all of these:
  - exit status `1`;
  - stderr containing `품질 게이트 실패 — 아티팩트를 쓰지 않습니다`;
  - stderr containing `[day_count] 요청 day 수(99) ≠ 생성 day 수(N)`;
  - no `OFFLINE_GUARD_DENIED`;
  - no output artifact.
- **Fixture and output writes are unchanged.**

### Guard allowlist request — CORE3 additions (guard owner; I did not edit `scripts/offline`)

Use absolute paths under `E:\ai에이젼시만들기\versions\cocotrip-integration-20261017\`. Every child is spawned as `process.execPath <entry> [args]`, with no execArgv, no shell, and no `-e`.

| Entry | Args | Options | Data writes |
|---|---|---|---|
| `tests\fixtures\integration-20261017\projection-worker.mjs` | Exactly 1: a base64url JSON payload `{root, manifest, holdMs}`. `root` is `%TMP%\cocotrip-guide-projection-*`. `holdMs` is 600 or 0 in the concurrency case. The rejection case uses `%TMP%\not-a-cocotrip-projection-root`. | `stdio: ['ignore','pipe','pipe']`, inherited cwd and env | Within `root` only: `src\content\guides\*.json`, `_index.json`, `public\sitemap.xml`, `.guide-projection.lock` (plus transient `.tmp`/`.bak`). The rejection case writes nothing. |
| `tests\fixtures\integration-20261017\projection-exit.mjs` | none | default spawn, inherited cwd and env | none |
| `scripts\plan-local\run.mjs` | Exactly 1: `sample` or `__test_daycount_mismatch__` | `cwd: <repo root>`, `stdio: 'pipe'` | `scripts\plan-local\outputs\plan-sample.json`. The negative scenario writes no output. The test itself writes and removes `scripts\plan-local\fixtures\{blocks,selection,userinput}-__test_daycount_mismatch__.json` and removes `outputs\plan-__test_daycount_mismatch__.json` if present. |

In-process (not a child): the stale-lock case writes `.guide-projection.lock` in a TMP root, and `applyBrainGuideProjection` writes there too.

### Not run (CORE3)

- None of the changed tests have been executed. Status is **unverified**.
- **Path assumption.** The worker's TMP check assumes parent and child see the same `os.tmpdir()`, which holds because the env is inherited. If the guard rewrites TMP/TEMP for children, the concurrency case fails loudly with exit 64. It cannot pass falsely.
