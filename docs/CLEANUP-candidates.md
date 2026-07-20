# Cleanup Candidates — Orphan & Dead-Code Scan

Generated: 2026-05-04
Repo: `cocotrip-source` (`홈페이지 클로드ai/홈페이지 사이트 최근/`), branch `main`
Method: read-only — `git ls-files` + ripgrep usage analysis. No deletions performed.

> NOTE — the suspect files listed in the original task spec
> (`cocotrip_backfill.py`, `master_data.py`, `seoul_master_data.json`,
> `monthly_food_factory.py`, `pricing.py`, `pricing_spec.json`,
> `_korea_spots_backup.json`, `email-preview.html`, `planner-diagram.html`,
> `send_backfill.js`, `verify_agents.py`, `error.log`, `deploys.txt` …)
> live in the OUTER directory `E:\ai에이젼시만들기\` (the CocoTripKR
> Python project root), **not in this `cocotrip-source` repo**. They are
> NOT tracked by this git repo and therefore out-of-scope for this scan.
> Recommend: handle those in a separate housekeeping pass against the
> Python project's own repo / .gitignore.

---

## 1. Definitely Safe to Delete (no references, clearly orphan)

| # | File | Size | Reason | Risk |
|---|------|-----:|--------|------|
| 1 | `public/og-image-original-backup.png` | 20 MB | Pure backup of the OG image. `vite.config.ts:43` *explicitly excludes it from precache* (`'**/og-image-original-backup.png'`). Zero other references. Single biggest reclaim. | low |
| 2 | `src/components/WizardForm.backup.tsx` | 32 KB | `.backup.tsx` snapshot of WizardForm. Zero imports or string references in the codebase. | low |
| 3 | `api/_ai-planner-legacy.js` | 4 KB | No callers anywhere. Superseded by `api/ai-planner-full.js` + `api/_ai_core/*`. | low |
| 4 | `api/testEmail.js` | 4 KB | Diagnostic-only endpoint. Only reference is its own JSDoc. Email pipeline now uses `_send-email.js` + bookings flow. | low |
| 5 | `find_ko.py` | 1 KB | One-shot Korean-string finder over a hardcoded file list. Not invoked by any script/CI. | low |
| 6 | `replace-colors.js` | 4 KB | One-shot brand-color migration (`#E84B8A` → `#7C5CFC`). Migration completed; no callers. | low |
| 7 | `test-extractor.js` | 4 KB | Stand-alone Gemini sanity-check script at repo root. Reads `.env` directly with a hand-rolled parser. Zero callers. | low |
| 8 | `server.log` | 1 KB | Stale log captured during local server.js run. `*.log` is already in `.gitignore`; this file is tracked accidentally. Should be `git rm` + remain ignored. | low |
| 9 | `info.md` | 4 KB | Untouched shadcn scaffold boilerplate ("Setup complete: /mnt/okcomputer/output/app …"). Zero references. | low |
| 10 | `AUTOMATION_ARCHITECTURE.md` | 8 KB | No links in/to it from any md/code/CI. | low |
| 11 | `firestore.rules.backup` | 1 KB | Pre-isPublic backup. Documentation in `docs/HANDOFF-firestore-rules.md` still references it as a rollback target — see §3 for nuance, but `HANDOFF-firestore-rules-hardening.md:251-252,255` itself recommends moving these to gitignore. | low‑medium |

**Subtotal Section 1: ~20.06 MB reclaim, 11 files.**

---

## 2. Probably Safe to Delete (one-shot scripts that already ran)

| # | File | Reason | Risk |
|---|------|--------|------|
| 12 | `scripts/fix-escaped-files.js` | One-shot recovery for JSON-escaped content corruption. | medium — verify no future need |
| 13 | `scripts/fix-file.js` | "v2" of the same recovery script. | medium |
| 14 | `scripts/fix-regex.js` | Targeted at `src/pages/PlanDetailPage.tsx`, which has since been split into a folder. Bound to a path that no longer exists. | low‑medium |
| 15 | `scripts/fix-ts.js` | Generic TS-rewrite helper, not invoked from package.json or CI. | medium |
| 16 | `scripts/migrate-fields.js` | Phase 3-4 field rename (`name_ko → name`). Migration done; rule documented in `CLAUDE.md` §C. | medium |
| 17 | `scripts/migrate-plans-public.mjs` | One-shot Firestore `isPublic: false` backfill. Rules now enforce isPublic; backfill complete. | medium — keep if you ever need to re-run on a new collection |
| 18 | `scripts/probe-realtime-keys.mjs` | Exploratory probe to discover what subway/bus realtime keys unlock. Findings now baked into `_transit_localization.js`. | medium |
| 19 | `scripts/probe-subway-station.mjs` | Same family — exploratory. | medium |
| 20 | `scripts/probe-timetable.mjs` | Same family. | medium |
| 21 | `scripts/dump-odsay-raw.mjs` | One-shot ODsay schema discovery. | medium |
| 22 | `scripts/smoke-line-names.mjs` | Manual smoke test — not in CI, not in package.json. | medium |
| 23 | `scripts/smoke-timetable.mjs` | Same. | medium |
| 24 | `scripts/add_admin_i18n.py` | One-shot i18n migration helper (per file docstring). | medium |
| 25 | `scripts/add_cmdk_i18n.py` | Same — one-shot i18n migration. | medium |
| 26 | `setup-google-auth.ps1` | Local-only Google service-account setup helper (PowerShell). Not in any docs/CI. | medium |
| 27 | `server.js` (3-line debug shim) + dotenv-loaded local express on :3001 | Only referenced by `NOTES.md` as historical context. Not part of production. | medium — keep if anyone still uses it locally |

**Subtotal Section 2: ~70 KB, 16 files.**

---

## 3. Needs User Decision

| File | Reason | Suggested call |
|------|--------|----------------|
| `firestore.rules.hardened` (8 KB) | Was the staged hardened ruleset; per `docs/HANDOFF-firestore-rules-hardening.md:252` the author already flagged it for deletion ("교체 후 중복 파일 정리"). Some HANDOFF docs still reference it for rollback narrative. | DELETE — content has been promoted to `firestore.rules`; gitignore the ext as recommended |
| `firestore.rules.preHardening` (1 KB) | Pre-deploy rollback snapshot. `ROADMAP-ALL-PENDING.md:87` says "keep, for rollback". | KEEP for now; gitignore `*.preHardening` going forward |
| `firestore.rules.backup` (1 KB) | Same family as preHardening — rollback target. | Same — keep, but consider moving to a tagged release / git history rather than tracking in main |
| `api/_data/*.afm` (14 fonts) | PDFKit Adobe Font Metrics. Used at runtime by `pdfkit` if not bundled in node_modules. | KEEP — depends on whether the Vercel function actually reads these. Verify with a single deploy log search before deleting. |
| `api/admin-test-push.js` | Used by `src/pages/Admin.tsx:40` (POST `/api/admin-test-push`). Active feature. | KEEP — but consider gating behind admin-only env flag in prod |
| `src/pages/DevTransitTest.tsx` | `src/App.tsx:64-65` lazy-loads it ONLY in `import.meta.env.DEV`. Tree-shaken from prod bundle. | KEEP — useful for transit debugging |
| `src/components/PayPalBookingButton.tsx` | ~~Braintree 로 forward 하는 thin wrapper~~ → **2026-07-20 정정**: Braintree 제거(`a091e19a`/`40b4e96f`, 2026-05-06~07) 후 이 파일이 **실 결제 컴포넌트**다 — PayPal JS SDK Smart Buttons + 쿠폰/프로모 + 어드민 `ADMIN-BYPASS-` 우회를 직접 구현하고, SDK CDN 차단 시 `PayPalQrPanel` (paypal.me QR) 로 lazy fallback 한다. 16개 surface 에서 임포트. | **KEEP — cleanup 후보 아님.** 이름이 실제와 일치하므로 rename 도 불필요. |
| `package.json` 의 `braintree`, `braintree-web`, `braintree-web-drop-in`, `@types/braintree-web-drop-in` | Braintree 게이트웨이는 2026-05-06~07 에 전량 제거됐고 `src/`·`api/` 어디서도 import 하지 않는다 (2026-07-20 grep 0건). 번들에는 안 들어가지만 `npm install` 시간·lockfile·의존성 감사 노이즈로 남는다. | ✅ DELETED — 2026-07-20 제거 완료 (`npm run build` / `npm run verify:all` 통과). env var 는 2026-07-20 `BRAINTREE_ENV` → `PAYMENT_BYPASS_ENV` 로 리네임됨(폴백 없음). Vercel 에서 구 변수 제거 필요 — 아래 항목 참조. |
| `BRAINTREE_ENV` (Vercel 환경변수) | 2026-07-20 리네임 후 코드 어디서도 읽지 않는다. 남아 있어도 게이트는 닫혀 있어 위험하지 않지만, `PAYMENT_BYPASS_ENV` 없이 이것만 있는 상태는 "반쪽 마이그레이션" 으로 감지돼 텔레그램 경고가 나간다. | DELETE — Vercel 대시보드에서 preview/production 양쪽 제거. `node scripts/check-vercel-envs.mjs` 로 잔존 확인 가능. |

---

## 4. Keep (looked suspicious but verified active)

| File | Reason |
|------|--------|
| `api/_ai-employees.js` | Imported by `booking-processor.js`, `_crons/weather-check.js`, `_crons/review-scheduler.js`. |
| `api/_food_index.json` | CLAUDE.md §B explicitly forbids deletion. Live DB matcher dependency. |
| `api/_pricing_spec.json` | Active pricing source under `api/_shared/pricing.js`. |
| `scripts/build-food-index.js` | Active build step for `_food_index.json`. |
| `scripts/validate-planner.cjs` | Documented quality gate (CLAUDE.md §E). |
| All `.afm` files in `api/_data/` | Likely needed by pdfkit at runtime — needs deployment-log verification before any removal. Treat as Keep until proven unused. |

---

## Process notes

- All deletions should land via a single PR titled `chore: prune orphan files` so reviewers can sanity-check at once.
- Before deleting Section 2 scripts, grep CI workflows: `grep -rn "scripts/<name>" .github/`. Sample done — none referenced.
- `.gitignore` already covers `*.log`; running `git rm --cached server.log` is enough to drop the tracked copy.
- After Section 1 deletions, repo size drops by ~20 MB (overwhelmingly from the og-image backup).
