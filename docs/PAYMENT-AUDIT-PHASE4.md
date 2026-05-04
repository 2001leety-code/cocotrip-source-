# Payment Stabilization Audit — Phase 4 (Prioritized Fix Plan)

> Generated 2026-05-04. Sourced from Phase 1 (47 grep findings) + Phase 2 (5 verifications, 2 P0 regressions) + Phase 3 (57 test scenarios). Sorted P0 → P3.
>
> **Only P0 enters Phase 5.** P1+ deferred to separate per-item PRs after operator review.

---

## Priority Scale

| Tier | Definition |
|------|-----------|
| **P0** | actively breaking payments or refunds in prod |
| **P1** | silent data loss or incorrect state |
| **P2** | edge case affecting <1% of users |
| **P3** | code smell, no user impact |

---

## Fix Plan

| Priority | File:Line | Bug | Proposed fix | Risk if deployed | Risk if NOT deployed | Est. LOC |
|---|---|---|---|---|---|---|
| **P0-#1** | `api/braintreeCheckout.js:117` (and lookups in F7) | Only EARLY50 (`promoCode === 'EARLY50' → 0.8x`) is server-applied. COCO5/COCO10/WELCOME5/fixed-USD coupons IGNORED on server — UI shows discount, server charges full price. (Phase 2 §3 / Phase 3 #C2-C6) | Server-side: when `promoCode` or `couponDocId` present, look up the coupon (global table OR Firestore by `(couponUserId, couponDocId)`), recompute the discount on `krwAmount` using the SAME logic as `api/applyPromoCode.js` (`type === 'fixed' && currency === 'USD'` → `discountKRW = value * usdToKrw`; else `discountRate = value/100`). Apply BEFORE `usdAmount = (krwAmount/usdToKrw).toFixed(2)`. **DO NOT modify `transaction.sale` arguments — only the `amount` field is recomputed prior.** Add idempotent `bookings.{couponDocId,couponDiscountKRW,promoCodeApplied}` fields for audit. | LOW (well-tested logic mirrors applyPromoCode); risk of double-discount if frontend also adjusts `customAmountKRW` — guard by computing from `resolveKrwAmount(productType, passengers)` not `customAmountKRW` for non-estimate. For estimate, frontend's `customAmountKRW` is pre-coupon (per `CharterNewPage:222`), so server discount is the only application. | HIGH — silent revenue loss invisible (UI promises 5%, server charges full). User trust risk if discovered. EARLY50 still works so 20% promotions look fine but 5/10% campaigns silently disabled. | ~40 |
| **P0-#2** | `api/_ai_core/paymentGate.js:67-83` + `api/ai-planner-full.js` (no Firebase auth) | `body.email` is client-trusted. Attacker can POST `{email: '<admin>', paypalOrderId: 'TEST-anything'}` → `isTestAccount=true` → bypass payment → free AI plan generated (~$0.05 Gemini compute + $9.90 lost revenue per attack). Admin email is publicly visible (CLAUDE.md, firestore.rules, frontend bundle). (Phase 2 §5 / Phase 3 #S3) | Two-layer fix: (a) **Add Firebase ID token verification** to `api/ai-planner-full.js` — extract `Authorization: Bearer <idToken>` header, `getAuth().verifyIdToken(token)` → `decoded.email`. Use the **decoded email**, ignore `body.email` entirely. (b) Centralize TEST_ACCOUNTS into env var (`PAYMENT_TEST_ACCOUNTS=2001leety@gmail.com,...`) read by all 3 files. (c) Optional: limit TEST mode to `BRAINTREE_ENV=sandbox` only (i.e., disable in production). | MEDIUM — requires frontend to send Firebase ID token in every planner request. `WizardForm/index.tsx` must be updated to attach `Authorization` header. Test mode workflow for admin needs ID token. Sandbox flow may break if admin account not signed in. | CRITICAL — exploitable, costs $9.90 + Gemini compute per attack. Public knowledge of admin email + TEST- prefix makes this trivially scriptable. | ~80 |

---

| Priority | File:Line | Bug | Proposed fix | Risk if deployed | Risk if NOT deployed | Est. LOC |
|---|---|---|---|---|---|---|
| **P1-#3** | `api/_ai_core/paymentGate.js` (no Sentry import) | `captureError` not imported; payment verification failures (Braintree verify, PayPal auth, duplicate order, payment incomplete) only `console.error` logged. (Phase 1 F5) | Add `import { captureError } from '../../_shared/sentry.js';` and `await captureError(e, { route: 'paymentGate', orderId, requestEmail })` in each catch block (lines 104, 117). | LOW — non-functional addition. Sentry already configured. | MEDIUM — silent payment-verify failures (e.g., Braintree API outage) won't alert admin. | ~10 |
| **P1-#4** | `api/braintreeCheckout.js:153-186` | Firestore booking save inner try/catch swallows error to "prevent refund infinite loop". User paid but no booking record → no email/voucher/telegram. (Phase 1 F3) | Add `await captureError(dbErr, { route: 'braintreeCheckout', step: 'firestore_save', transactionId, userEmail, krwAmount })` inside the inner catch (line 184). DO NOT change throw behavior. Add structured log so admin replay-tools can find orphaned transactions. | LOW — pure observability addition; throw behavior unchanged. | MEDIUM — paid but unrecorded bookings are invisible until customer complains. | ~5 |
| **P1-#5** | `api/braintreeCheckout.js:220` | booking-processor fetch fire-and-forget `.catch((err) => console.error(...))` — Sentry not captured. (Phase 1 F3) | Replace `.catch((err) => console.error(...))` with `.catch(async (err) => { console.error(...); await captureError(err, { route: 'braintreeCheckout', step: 'booking_processor_fetch', transactionId }); })`. | LOW. | MEDIUM — booking-processor invocation failures (network, 5xx) invisible. | ~5 |
| **P1-#6** | `api/booking-processor.js:164-274` (7 isolated try/catch blocks) | Each step (sheets/telegram/dispatchBroadcast/pdf/wallet/email/sheetsUpdate) only `console.error` per failure. `results.steps.<X>` stored but no Sentry alert. (Phase 1 F4) | Per step, add `await captureError(err, { route: 'booking-processor', step: '<name>', bookingRef, productType })` inside each catch. Keep `results.steps.<X> = error: ...` for client/admin visibility. | LOW — pure observability. | MEDIUM — customer doesn't get email/voucher and admin doesn't know until customer complains. PR #229 isolation works correctly but observability is asymmetric. | ~15 |
| **P1-#7** | `src/components/BraintreePaymentButton.tsx:390-395` | Frontend payment failure (`catch (err)` block at L390) only `console.error` + PostHog `payment_failed`. Sentry relies on global init auto-capture which may miss handled errors. (Phase 1 F1) | Add `import * as Sentry from '@sentry/react';` and `Sentry.captureException(err, { tags: { area: 'payment', productType }, extra: { effectiveKRW, hasPromo: promoApplied } })` inside the catch. | LOW — additive. | MEDIUM — payment failure rate trend invisible in Sentry; only PostHog event without stack trace. | ~5 |
| **P1-#8** | `src/components/BraintreePaymentButton.tsx:164` + `api/braintreeCheckout.js:43` + `api/_ai_core/paymentGate.js:15` + `firestore.rules` | TEST_ACCOUNTS hardcoded `'2001leety@gmail.com'` in 4 places. Email rotation requires 4 separate edits + rules deploy. (Phase 2 OQ#2) | Move to env var: `VITE_PAYMENT_TEST_ACCOUNTS` (frontend, comma-separated) and `PAYMENT_TEST_ACCOUNTS` (backend). All 3 code files read from env. firestore.rules left untouched (rules cannot read env — KNOWN-RISKS #5). Add to .env.example. | LOW — env var addition. STOP CONDITION: env var addition triggers a halt per contract. Operator must explicitly authorize. | LOW. Cosmetic / future-proofing. | ~10 + env config |

---

| Priority | File:Line | Bug | Proposed fix | Risk if deployed | Risk if NOT deployed | Est. LOC |
|---|---|---|---|---|---|---|
| **P2-#9** | `api/braintreeCheckout.js:70-81` | `couponDocId` ownership not re-verified at checkout. Frontend sends `couponDocId` from response; server stores it but doesn't check it belongs to the authenticated user. (Phase 3 #C12) | After P0-#2 (Firebase ID token verification), additionally verify `users/{decoded.uid}/coupons/{couponDocId}` exists and `isUsed: false`. Atomic update on success. | MEDIUM — adds Firestore reads per checkout, may need composite index. Depends on P0-#2 being merged first. | LOW — same-tenant exploit only (cannot use another user's coupon without authenticating as them, which P0-#2 prevents). | ~15 |
| **P2-#10** | `api/ai-planner-full.js` (no rate limit) | After P0-#2 fixes auth, an authenticated user could still spam plan generation. (Phase 3 #S5) | Add per-uid + per-IP rate limit: `chat_rate_limits` collection or Vercel Edge Middleware. Window: 5 plans/hour/uid. | MEDIUM — wrong limits could throttle legitimate users. Tune in canary. | LOW — Gemini cost is bounded by revisionCredits (2 per plan). Realistic abuse window is small. | ~30 |
| **P2-#11** | `api/booking-processor.js:76-78` | Body parse silent catch: `try { body = JSON.parse(body) } catch { body = {} }` — malformed body silently treated as empty. | Add `console.warn` + `captureError` in the catch. Keep fallback to `{}` so handler doesn't crash. | LOW. | LOW — parsing always succeeds for valid JSON; only attacker/dev tools trigger this path. | ~5 |
| **P2-#12** | `src/components/WizardForm/index.tsx:184-230` | Frontend AI plan generation fetch failure: `catch { setErrorMsg(...) }` — no Sentry. (Phase 1 F9) | Add `Sentry.captureException(err, { tags: { area: 'planner', step: 'fetch' }})` before `setErrorMsg`. Also log `data.error` value before mapping to UI string. | LOW. | LOW — UI shows generic message; user is informed; admin loses telemetry on AI plan failure rate. | ~5 |

---

| Priority | File:Line | Bug | Proposed fix | Risk if deployed | Risk if NOT deployed | Est. LOC |
|---|---|---|---|---|---|---|
| **P3-#13** | `api/cancelBooking.js:36-37,109` | Empty `TEST_ACCOUNTS = []` + `void TEST_ACCOUNTS;` dead code. (Phase 1 F6) | Remove the array and the void statement. Update header comment to "환불은 항상 LIVE — 2026-04-30부터". | TRIVIAL. | NONE. | ~3 |
| **P3-#14** | `src/components/BraintreePaymentButton.tsx:256, 580, 582` (and elsewhere) | Hardcoded `1350` divisor for KRW→USD display. PR #240 added `src/lib/exchange-rate.ts` but this file wasn't migrated. | `import { USD_TO_KRW } from '@/lib/exchange-rate'; (effectiveKRW / USD_TO_KRW).toFixed(2)`. | TRIVIAL. | NONE — display only; actual server uses `getUsdToKrwRaw()`. | ~5 |
| **P3-#15** | `api/booking-processor.js:283-288` | `try { … } catch {}` — empty catch, intentional (replay tool fallback) but undocumented. | Add explanatory comment. | TRIVIAL. | NONE. | ~2 |

---

## Summary

| Tier | Count | Total Est. LOC |
|------|-------|---------------|
| P0 | 2 | 120 |
| P1 | 6 | 50 |
| P2 | 4 | 55 |
| P3 | 3 | 10 |
| **Total** | **15** | **235** |

---

## Phase 5 Inputs

Per contract: **only P0 items enter Phase 5.**

### P0-#1: Coupon discount server-side application
- Touches: `api/braintreeCheckout.js` (~40 LOC) — adds discount lookup before `transaction.sale`. **`transaction.sale` arguments unchanged** (only `amount` value recomputed).
- New behavior: server-validated discounts for COCO5/COCO10/WELCOME5/fixed-USD; UI promises === server charges.
- Test plan: rerun Phase 3 #C2 / #C3 / #C4 / #C5 / #C6 — must change from "regression confirmed" to "fix verified".

### P0-#2: TEST_ACCOUNTS bypass on /api/ai-planner-full
- Touches: `api/ai-planner-full.js` (~50 LOC, add Firebase Auth verify) + `api/_ai_core/paymentGate.js` (~10 LOC, use authenticated email) + frontend `WizardForm` (~20 LOC, attach Authorization header).
- ⚠️ STOP CONDITION CHECK: Phase 5 fix may need to add a new env var if we centralize TEST_ACCOUNTS, but minimal fix can leave the hardcoded array intact for now and only add Firebase Auth verification — NO env addition needed for the security fix itself.
- Test plan: rerun Phase 3 #S3 — must change from "exploit succeeds" to "401/403 (token missing)" or "401 (token mismatch with body.email)".

---

## STOP CONDITION Awareness for Phase 5

The contract lists 4 stop conditions. Per Phase 5 plan:
1. ✅ "Any change to `api/braintreeCheckout.js` touching `transaction.sale` arguments" — P0-#1 modifies `amount` value but does NOT change `transaction.sale` argument list/structure. Will surface diff for explicit review.
2. ✅ "Any Firestore schema change on `bookings`, `booking_costs`, `used_paypal_orders`" — P0-#1 ADDS optional fields (`couponDiscountKRW`, `promoCodeApplied`). Operator must explicitly approve. Alternative: log to existing field, no schema change.
3. ✅ "Any environment variable addition or rename" — P0-#1 needs none. P0-#2 minimal fix needs none (Firebase Admin SDK already initialized via FIREBASE_PRIVATE_KEY). Will halt if env addition becomes necessary.
4. ✅ "Discovery of an active P0 not in the original list" — Both P0s found ARE in the original list (item 3 PR #245 broader scope, item 5 TEST_ACCOUNTS bypass). Phase 5 proceeds.

**Awaiting operator decision per P0**:
- Schema-add (Firestore booking field) — yes/no?
- Frontend Authorization header in WizardForm — yes/no? (alternative: server reads `idToken` from body field, less ideal but no frontend change)

---

PHASE 4 COMPLETE
File written: docs/PAYMENT-AUDIT-PHASE4.md
Findings: 15 items (P0=2, P1=6, P2=4, P3=3, total ~235 LOC)
Open questions:
  1. P0-#1 — add `couponDiscountKRW`/`promoCodeApplied` to `bookings` schema (operator approval required, schema-add stop condition)?
  2. P0-#2 — frontend `Authorization` header in WizardForm — yes/no? (or accept idToken in body fallback?)
  3. P0-#2 — should TEST mode be disabled entirely in production (BRAINTREE_ENV=production), or kept as opt-in for admin?
Awaiting: "apply P0 #1" or "apply P0 #2" to begin Phase 5
