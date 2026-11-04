# 🌐웹 Inngest native Zod security compatibility

This isolated branch migrates the pinned Inngest 4.24.0 runtime to native Zod 4.6.7. It changes no planner, payment, worker business logic, API authorization, retry policy, or issuance transaction. It has not been pushed or deployed.

The [reviewed advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) lists Zod versions below 4.6.6 as affected. The [upstream fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) checks bounded array/set/map upper limits before parsing elements. This is not a global cap on errors or a fix for every unbounded schema. Tests explicitly retain that limitation.

## Applied scope

- The scoped npm override removes Inngest's nested Zod 3.25.76 and resolves native Zod 4.6.7. The package version alone is insufficient: all 28 SDK ESM/CJS runtime imports are redirected through an SDK-private adapter. No global Zod object or prototype is mutated.
- Two SDK error accessors use native `issues` rather than v3 `errors`. Six implicitly optional any/unknown properties are explicitly optional in both formats; Realtime's optional transformed timestamp preserves absent-key behavior.
- All 15 single-argument record factories use explicit string keys and the original value validator. Remix's additional two-argument key/value factory retains both schemas, including arbitrary environment values. The adapter rejects an **own** `__proto__` key before parsing. Native Zod otherwise skips this key before validating its value, which would have accepted six previously invalid corpus inputs. This deliberately also rejects some previously valid own-`__proto__` inputs. Inherited properties are not automatically rejected; ordinary `constructor` and `prototype` keys remain value-validated.
- Native Zod rejects symbol record keys that v3 ignored. This is a documented tightening for non-JSON JavaScript inputs; HTTP JSON cannot carry symbol keys.
- Actual schema declarations are regenerated for native Zod, including the guarded record's pipeline type. Unused v3 type imports are removed. Targeted compile assertions preserve app-used send/handler/step output contracts and record-backed FunctionConfig/IncomingOp output shapes. The guarded record's preprocessing input type is accurately `unknown`, rather than the former statically constrained record input; its output remains value-validated. Raw schema input inference and Zod error issue formatting are not claimed to be universally equivalent to v3. This app imports `Inngest`, `NonRetriableError`, and `inngest/node` serve, rather than consuming raw SDK Zod schemas.

## Reproducibility and maintenance

`scripts/security/inngest-native-v4-manifest.json` pins before/after SHA256 for 38 SDK files plus eight added helper/declaration files. Applying the patch requires supported versions, a private node_modules directory, private regular files, recognized source hashes, and correct patch artifact hashes. Every file is validated before the first write. Reapplication is idempotent; a changed SDK version or unknown source hash fails closed.

`postinstall` runs the reviewed patcher. `npm run build` checks all installed hashes before the repository's actual `tsc -b && vite build`. An install with scripts disabled therefore needs the explicit reviewed apply command before it can build. A dependency upgrade requires reviewing a new manifest and the compatibility corpus; it cannot silently reuse this patch.

Generated declarations derive from the installed pinned SDK's embedded TypeScript source. `verify-inngest-native-types.mjs` selects the actual schema definitions, retains the original Realtime schema/type equality assertion, compiles with strict checking and `skipLibCheck:false`, and requires byte-identical emitted artifacts. It also compiles `tests/type-fixtures/inngest-native-v4-contract.ts`, with valid inputs, output equalities and expected invalid assignments. This isolated declaration check supplements the actual project build.

The test baseline fixture records the original Inngest 4.24.0 runtime with its actually resolved Zod 3.25.76, not root Zod4's v3 compatibility namespace. It includes original SDK source hashes, all 15 record schema expressions and 22 boundary results per site, worker/hydration/error outputs, and Realtime missing/undefined/null outputs. Values use Node V8 serialization to preserve undefined and Date. Vulnerable baseline packages and the earlier v3 backport prototype are not shipped in the final dependency tree.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
# Expected refusal before application:
node scripts/security/inngest-native-v4.mjs --check
node scripts/security/inngest-native-v4.mjs --apply
node scripts/security/inngest-native-v4.mjs --check
node scripts/security/verify-inngest-native-types.mjs
npx vitest run tests/unit/sdk-zod-native-install-20261103.test.ts tests/unit/sdk-zod-record-values-20261103.test.ts tests/unit/sdk-zod-native-v4-corpus-20261103.test.ts tests/unit/sdk-zod-signed-worker-20261103.test.ts --maxWorkers=2
npm run build
npm audit --omit=dev --audit-level=high
```

SDK-generated declaration fragments and patched SDK sources derive from Inngest 4.24.0, copyright Inngest contributors, Apache-2.0 licensed; the installed SDK license remains present. Zod remains its upstream MIT-licensed package. This app-specific compatibility patch needs independent review before any publication. Live cloud signatures, production workers and paid services are not exercised by these offline tests.

## Local verification record

Final private installed candidate, 2026-11-03:

| Check | Actual result |
| --- | --- |
| Fresh `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0, 1,308 packages; independent node_modules, no shared dependency changes |
| Actual build before applying patch | Exit 1 at the security check, before TypeScript/Vite |
| Reviewed postinstall and installed hashes | 46/46 files verified; application is idempotent |
| SDK security/compatibility focused tests | 4 files, 437 tests passed after the Remix correction |
| Existing worker/retry/atomic issuance regressions | 3 files, 85 tests passed |
| Declaration regeneration and API input/output compile fixture | Exact generated artifacts, strict diagnostics 0, no skipLibCheck |
| Final owned-file ESLint | Exit 0 |
| Final actual `npm run build` after the adapter correction | Exit 0, TypeScript + Vite + PWA completed |
| Native `npm audit --omit=dev --audit-level=high --json` | Exit 0; high 0, critical 0; Zod/Inngest advisory absent |

The audit still reports eight moderate package entries propagated from one existing UUID advisory, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). It is not suppressed or migrated in this SDK change. The final adapter correction did not change the audited dependency graph.

Logs are under `C:\Users\dlxod\AppData\Local\Temp\`: `sdk-native-private-ci-20261103.log`, `sdk-native-unapplied-build-refusal-20261103.log`, `sdk-native-final-focus-20261103.log`, `sdk-native-worker-regression-20261103.log`, `sdk-native-final-types-20261103.log`, `sdk-native-final-eslint-20261103.log`, `sdk-native-final-build-20261103.log`, and `sdk-native-audit-20261103.json`.

No full unit-suite rerun, cloud worker call, actual payment, customer write, notification, remote push or deployment was performed. The checks are offline compatibility evidence for this application, not a claim that every external consumer of Inngest's raw Zod schema API is unchanged.
