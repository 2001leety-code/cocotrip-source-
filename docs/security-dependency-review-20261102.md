# 🌐웹 — Preview dependency security review (2026-11-02)

Scope: package.json, package-lock.json and this report only. Existing meal/planner/payment/UI changes are preserved. No production calls, mail delivery, deployment, credential/settings changes, audit suppression, forced audit fix or shared node_modules mutation.

## Audit results

Native npm 10.9.2 audits were run against the existing and candidate lockfiles on 2026-11-02. Counts below are vulnerable package entries, including inherited parent entries; they are not distinct vulnerabilities.

| Scope | Before critical / high / moderate / low | After critical / high / moderate / low |
|---|---:|---:|
| Production (`--omit=dev`) | 2 / 11 / 10 / 0 (23 total) | 0 / 2 / 8 / 0 (10 total) |
| All dependencies | 2 / 17 / 38 / 3 (60 total) | 0 / 2 / 36 / 3 (41 total) |

The two remaining high package entries are **Inngest and its nested Zod**, both caused by **one advisory**, [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Neither audit exits cleanly. This is a test Preview candidate, not production security sign-off.

## Minimal changes and applicability

| Dependency | Locked change | Reason / execution boundary |
|---|---|---|
| DOMPurify | 3.4.14 → 3.4.17 | Guide HTML sanitization and PDF dependencies; [maintainer advisory](https://github.com/advisories/GHSA-cg2g-xh64-v4q7). The app does not enable the described SAFE_FOR_TEMPLATES + DOM-return modes, but the patch also fixes other sanitizer advisories. |
| Nodemailer | 9.1.1 → 10.1.4 | Gmail SMTP and actual MailComposer deep import. No 9.x fixed release; [recipient parsing advisory](https://github.com/advisories/GHSA-85x2-q946-cp5h). [v10 breaking note](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0) requires Node ≥20; project uses Node 22. Existing createTransport/sendMail/MailComposer calls remain unchanged. This is the only direct major update. |
| @grpc/grpc-js | Firestore 1.9.16 → 1.13.6; root 1.14.4 → 1.14.5; Google GAX 1.14.7 nested | Replace vulnerable overrides with [patched releases](https://github.com/advisories/GHSA-m9gg-hp2v-232j). App is a Firestore client, not a gRPC server using getAuthContext/mTLS RBAC. |
| @fastify/busboy | 3.2.0 → 3.2.4 | Firebase Admin transitive multipart parser; [boundary DoS](https://github.com/advisories/GHSA-xjh9-v7x6-24jw), all known fixes ≥3.2.2. No direct application multipart parser import found. |
| body-parser / proxy-addr | 1.20.6 → 1.20.9 / 2.0.7 → 2.0.8 | Optional/dev Express compatibility chain. App uses Vercel handlers and inngest/node, without a configured Express trust-proxy subnet. [body parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828), [proxy advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). |
| follow-redirects | 1.16.0 → 1.16.2 | Axios server fetch chain; [credential redirect advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). |
| qs | 6.16.0 → 6.16.1 | Existing override floor raised to the fixed version; [stringification DoS](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). |
| systeminformation | 5.33.1 → 5.33.19 | OpenTelemetry host metrics chain; [Windows command-injection advisory](https://github.com/advisories/GHSA-3f7j-7jwc-fxfj). No direct services/networkStats call with user input found. |
| Vite | 7.3.6 → 7.3.7 | Local development/editor endpoint; [fixed Vite branch](https://github.com/advisories/GHSA-698v-4r3x-3vcv). No major migration. |
| brace-expansion | 1.1.18 → 1.1.21; 2.1.4 → 2.1.7; 5.0.9 → 5.0.12 | Build/glob tool input; [maintainer fixed branches](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr). Preserve each existing major. |
| undici | 7.29.1 → 7.30.1 | jsdom/testing chain; [parser memory DoS](https://github.com/advisories/GHSA-4qv8-2p9j-2685). |
| Puppeteer | 25.1.0 → 25.16.0 | Prerenderer's optional peer (declared ≥2). Uses the same version already locked for the direct puppeteer-core dependency; removes its older chromium-bidi/Zod 3 branch. Associated browser/protocol/CLI packages largely deduplicate into the existing core tree. Browser download scripts remain disabled. |

The lockfile has 20 version changes at existing paths, 13 added paths and 18 removed paths (51 changed version paths total). Many additions/removals move the existing Puppeteer 25.16 tree rather than introducing new package versions. No SDK-wide or Firebase Admin major migration was attempted.

## Residual high: actual Zod 3 code remains vulnerable

- Inngest is still 4.24.0. Registry inspection of latest compatible Inngest 4.26.2 also requires zod ^3.25.0; that upgrade would not repair this issue.
- All 28 inspected ESM/CJS Zod import sites in the installed Inngest runtime use `zod/v3`. The [official namespace compatibility guarantee](https://zod.dev/v4/versioning) makes that API compatible with the Zod 4 package, but compatibility alone does not establish a security fix.
- The [upstream fix commit](https://github.com/colinhacks/zod/commit/a0ebf97) changes only v4 source. A bounded offline probe against existing Zod 4.6.7 showed `z.array(z.string()).max(1)` with 100 invalid elements creates **101 issues through zod/v3**, while zod/v4 rejects with **one issue**. Replacing the package version while retaining the v3 namespace would remove the audit label without fixing the code being executed; no such override is added.
- The application uses inngest/node. Inspected cloud-mode SDK code checks the Inngest request signature before runStep schema validation. This limits unsigned invocation exposure, but is not proof that the resource risk is absent. JSON parsing occurs earlier and is a separate consideration. No authentication, size-limit or production settings were changed in this dependency-only patch.
- Disposition: explicitly unresolved. Review upstream SDK/Zod v3 fix availability before production approval; next review 2026-11-09, or earlier if a compatible fix is released. Preview publication does not clear this production blocker.

## Residual moderate and low findings

Production moderate entries inherit [uuid buffer-bound advisory GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) through Google GAX/Gaxios/teeny-request/Firestore/Storage/Admin. The described vulnerable API is v3/v5/v6 with a supplied output buffer; inspected Google client call sites use uuid.v4. A uuid 9 → 11 / Firebase Admin 13 → 14 migration is deferred rather than forced into this patch. Review by 2026-11-09.

Additional moderate/low development findings are deferred under the agreed high/critical-first, minimal-change scope, with review due 2026-11-09. These are not treated as fixed or exempted. Their inspected dependency paths are build/test/prerender tools; a public development server or attacker-controlled build input would change the exposure assessment.

| Residual leaf | Advisory IDs | Deferred boundary / reason |
|---|---|---|
| glob | GHSA-3g3m-2fjr-6pw4 | Build/test filesystem traversal cancellation; fixing every parent would require a separate toolchain migration. |
| minimatch | GHSA-g3hv-75wg-m249 | Build/test glob pattern amplification; public application handlers do not import it directly. |
| ts-deepmerge | GHSA-87mf-gv2c-c62c | Prerender configuration merge; fix crosses 6.x → 8.x. |
| deepmerge | GHSA-gcqx-w48m-w2h4 | Workbox/build object merge; no direct application import found. |
| serialize-javascript | GHSA-m5mm-p8h7-m29v | Build/minification serialization of function bodies; not application user-content rendering. |
| @vitest/mocker | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp | Browser/dev mock-registration server; the verification command uses Vitest run, not an exposed interactive mock server. Kept out of this high-only tool patch. |
| postcss-selector-parser | GHSA-rj75-hqrm-r3gf | Build CSS parsing; repository CSS is the inspected input boundary. |
| fast-uri | GHSA-333x-w4r6-6crp, GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h | AJV/build configuration URI resolution; not the application's fetch URL authorization boundary. |

No allowlist or audit threshold masks these findings. Native CI audit is expected to remain nonzero.

## Verification and isolation

- Package/lock originals backed up outside the repository under `%TEMP%/cocotrip-security-20261102-minimal/*.before.json` and byte-compared before copying candidates.
- Trial used package-lock-only operations with ignore-scripts; it never created node_modules. Existing shared junction installation was not modified.
- npm ci --dry-run --ignore-scripts --no-audit passed for the candidate graph.
- npm 10.9.2 update hit an Arborist peer-set edgesOut error for combined dev updates. Explicit compatible patch floors/overrides plus package-lock-only install succeeded; no force or legacy-peer-deps bypass used.
- Existing environment warning: @sparticuz/chromium 147.0.2 requires Node ≥22.17 while this local executor is 22.15.0. This requirement predates the patch; Chromium package/engine settings are unchanged.
- Root completed a private clean npm ci --ignore-scripts installation (1,309 packages, exit 0); node_modules is now a private directory. The former shared junction is preserved outside the worktree. No shared target contents were changed.
- Affected offline focus: 14 files / 160 tests. First run: 159 passed, one stale exact-version contract assertion failed. With explicit scope approval, only three DOMPurify literal assertions changed 3.4.14 → 3.4.17; every sanitizer behavior/security assertion remained unchanged. Re-running only that file passed 8/8, so the combined focused evidence covers all 160 tests.
- The actual company Gmail sender tests compiled the application MailComposer deep import and Korean UTF-8 MIME. Separate real-package offline probes passed Firebase client and Firebase Admin construction/termination, nodemailer/lib/mail-composer/index.js message compilation, and Puppeteer API import. No RPC, email send or browser launch occurred.
- Fresh installed-root JSON audit matches the candidate production result: 10 vulnerable entries (0 critical, 2 high, 8 moderate).
- Native production gate `npm audit --omit=dev --ignore-scripts` was then executed without a severity threshold and exited **1**, as expected. Its two high entries are the one unresolved Zod advisory above; the eight moderate entries inherit the uuid advisory. The suggested force downgrade to inngest 0.3.0 was not executed.
- Verification logs are retained under `%TEMP%`: `meal-security-focused-r26.log`, `meal-security-guide-retry-r26.log`, `meal-security-audit-root-installed.json`, `meal-security-native-audit-gate-r26.log`, plus before/after production/all audit JSON files.
- Pending root coordination: the mandatory final pre-push hook will run npm run build and the full unit check once. No duplicate manual build or full suite was run for this dependency patch. Native audit remains red; this review does not authorize production promotion.
