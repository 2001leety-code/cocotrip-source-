# Payment Stabilization Audit — Phase 3 (Regression Test Matrix)

> Generated 2026-05-04. Manual test checklist for the payment pipeline. **Sandbox or Canary execution only — DO NOT run destructive scenarios against prod.**
>
> Conventions:
> - **Sandbox** = `BRAINTREE_ENV=sandbox` + `2001leety@gmail.com` test account, Drop-in card `4111 1111 1111 1111` 12/30 CVV 123
> - **Canary** = production env with low-value real charge ($1 USD test booking, refund within window)
> - **Read-only** = no real charge, observe Firestore + Sentry
> - For each scenario: capture Firestore booking doc + Sentry event ID + Telegram alert screenshot before marking pass
>
> **A note on the 2 P0 regressions** (Phase 2):
> - P0-#1 coupon discount not server-applied → tests #C2/#C3/#C8 will FAIL on current main. Use them to confirm the bug repros, NOT to assert a passing build.
> - P0-#2 TEST_ACCOUNTS bypass on `/api/ai-planner-full` → tests #S5 / #S6 will succeed (FREE plan generated) on current main. Use them to confirm the exploit repros.

---

## A. Successful Payment (each productType)

| # | Scenario | Product | Expected | Reproduction steps | Sandbox or Canary? |
|---|---|---|---|---|---|
| A1 | Single charter, ICN→서울시내, staria, 2 pax | `charter_seoul_city` | Drop-in opens → card → 200 OK → Firestore `bookings/{txnId}` CONFIRMED + customerEmail + krwAmount=matrix value + telegram booking alert + voucher PDF email | `/charter` → fill 6 steps → ICN→Gangnam → 2 pax → Pay → enter sandbox card | Sandbox |
| A2 | Charter estimate, ICN→부산시내 (zone fallback) | `charter_custom_estimate` | krwAmount = `customAmountKRW`, `requiresReconciliation: true` flag in booking doc, "권역 평균 추정가" notice in voucher | `/charter` → 부산시내 → quote shows estimate → Pay sandbox | Sandbox |
| A3 | AI Planner, 2 days, Seoul | `ai-planner-full` | $9.90 charge → Firestore `plans/{id}` doc + revisionCredits=2 + AI plan generation triggered + email confirmation w/o voucher (digital) | `/planner` → Wizard 5 steps → Pay sandbox → wait for plan generation | Sandbox |
| A4 | Tour booking, 1 tour | `tour_<id>` | Tour availability decremented in `tour_availability/{tourId}/dates/{date}` + booking written under `tours/{tourId}/bookings/{id}` (legacy nested surface) + voucher email | `/tours/<slug>` → "Book" → date picker → Pay sandbox | Sandbox |
| A5 | Airport pickup standalone | `airport_transfer` | matrix-priced booking + voucher | `/charter` 위저드 (`service=airport_transfer`) → Step6Quote → Pay sandbox | Sandbox |
| A6 | K-pop shuttle one-way | `kpop_shuttle_oneway` | matrix-priced booking + voucher | `KpopShuttleBanner` (homepage) → Pay sandbox | Sandbox |

---

## B. Post-Payment UX (PR #234 verification)

| # | Scenario | Product | Expected | Reproduction steps | Sandbox? |
|---|---|---|---|---|---|
| B1 | "내 예약 보기" lands on `/mypage?tab=bookings` (PR #234 fix) | any | Booking card visible, no blank page | After payment success modal → click "내 예약 보기" | Sandbox |
| B2 | Booking card click → BookingDetailModal opens | charter | Modal shows bookingRef, status, service label, pickup/dropoff, vehicle, pax, KRW+USD amount, email | Sandbox booking from A1 → /mypage → tab bookings → click card | Sandbox |
| B3 | BookingDetailModal opens for AI Plan booking | `ai-planner-full` | Modal opens; voucher button HIDDEN; "non-refundable" notice visible | Sandbox booking from A3 → /mypage → tab bookings → click card | Sandbox |
| B4 | BookingDetailModal opens for canceled booking | any | Modal opens; voucher button HIDDEN; "이 예약은 취소되었습니다" notice | Cancel A1 within window → click card | Sandbox |
| B5 | Voucher PDF download | charter | `/api/voucher?bookingID=...&userEmail=...` returns PDF (Content-Type: application/pdf, no-store) | A1 booking → click "Voucher 다운로드" | Sandbox |
| B6 | Voucher download with mismatched email | charter | 403 Email mismatch | curl `/api/voucher?bookingID=<A1>&userEmail=other@example.com` | Sandbox |
| B7 | Voucher download with canceled booking | charter | 410 Booking canceled | Cancel A1 → curl voucher endpoint | Sandbox |
| B8 | Booking detail contact info | any | "문의: cocotripkr@gmail.com 또는 우측 상단 1:1 문의하기" — KakaoTalk 표기 0 (PR #243) | Open BookingDetailModal | Sandbox |

---

## C. Coupon — Stacking, edge cases, **P0 server-side application** (P2 §3 regression)

| # | Scenario | Product | Expected (intended behavior) | Actual (per current code) | Reproduction steps | Sandbox? |
|---|---|---|---|---|---|---|
| C1 | Apply EARLY50 → 20% discount | charter | `bookings.amountKRW = matrix * 0.8`; user paid 80% | ✅ Confirmed: F3 L117 hardcodes EARLY50 0.8x | A1 with EARLY50 in promo input → Pay → check Firestore `bookings.amountKRW` | Sandbox |
| C2 | Apply COCO5 → 5% discount | charter | `bookings.amountKRW = matrix * 0.95` | ❌ **REGRESSION**: krwAmount stays full price; user shown discount but charged FULL | A1 with COCO5 → Pay → diff `bookings.amountKRW` vs UI displayed effectiveKRW | Sandbox |
| C3 | Apply COCO10 → 10% discount | charter | `bookings.amountKRW = matrix * 0.9` | ❌ **REGRESSION** (same as C2) | A1 with COCO10 → Pay | Sandbox |
| C4 | Apply WELCOME5 (Firestore percent 5%) | charter | `bookings.amountKRW = matrix * 0.95` | ❌ **REGRESSION** | New user → auto WELCOME5 → A1 → Pay | Sandbox |
| C5 | Apply Trip Coin redemption coupon (fixed $5 USD) | charter (large amount, e.g. ₩600k) | `bookings.amountKRW = matrix - (5*usdToKrw)` | ❌ **REGRESSION**: server ignores coupon entirely | Redeem coins → coupon → A2 large estimate → Pay | Sandbox |
| C6 | Stack COCO5 + WELCOME5 (5%+5%) | charter | UI shows -10%; server should apply 10% | ❌ **REGRESSION**: server applies 0% (neither in EARLY50 list) | A1 with codes=[COCO5, WELCOME5] | Sandbox |
| C7 | Stack EARLY50 + COCO5 (`stackable: false` for EARLY50) | charter | EARLY50 dominates (20%); UI rejects stacking attempt | UI: rejects (`globalPromo.stackable: false` for EARLY50). Server: applies EARLY50 only. | Try multi-code with EARLY50 + COCO5 | Sandbox |
| C8 | Apply expired coupon | charter | UI: red "프로모션 종료" message; server: applyPromoCode returns valid:false | ✅ Confirmed: applyPromoCode L66-67 expiresAt check returns null → "Invalid code" | Use a coupon with `expiresAt < now` | Sandbox |
| C9 | Apply already-used coupon (`isUsed: true`) | charter | UI: invalid; server: returns valid:false | ✅ Confirmed: applyPromoCode L43-44 `where('isUsed', '==', false)` | Reuse spent coupon | Sandbox |
| C10 | Apply unknown code | charter | "유효하지 않은 코드" / 400 INVALID_CODE | ✅ Confirmed: applyPromoCode L213-215 falls through to INVALID_CODE | Random string promo code | Sandbox |
| C11 | Apply coupon BUT submit Pay without applying (race condition) | charter | UI shows undiscounted price; user pays full | ✅ Probably correct — promoApplied state must be true to send `promoCode` in body | Apply coupon → Cancel before Pay → Pay anyway | Sandbox |
| C12 | Coupon `couponDocId` mismatch (couponDocId from another user) | charter | Server should still mark coupon as `isUsed: true` for the wrong user OR reject | ❓ INSUFFICIENT — current code does not re-verify couponDocId ownership at checkout, only at applyPromoCode. Phase 4 should propose re-verify. | Tamper request body: `couponDocId: <other user's coupon ID>` | Sandbox |

---

## D. Refund — Bronze tier matrix (PR #243 server-side enforcement)

| # | Scenario | tourDate offset | refundRatio | Expected | Reproduction steps | Sandbox? |
|---|---|---|---|---|---|---|
| D1 | Refund ≥72h before | tourDate = now+96h | 1.00 | 100% refund processed; `bookings.status = CANCELED`, `refundedAmount = full`, telegram refund alert | A1 with future date → /mypage → cancel button → confirm | Sandbox |
| D2 | Refund 48-72h before | tourDate = now+60h | 0.80 | 80% refund | A1 → mock tourDate ahead → cancel | Sandbox (modify tourDate via Firestore admin for test) |
| D3 | Refund 24-48h before | tourDate = now+36h | 0.50 | 50% refund | Same approach | Sandbox |
| D4 | Refund <24h before | tourDate = now+12h | 0.00 (canRefund=false) | 409 NO_REFUND; cancel button disabled in UI; alert on click shows `refundClosed` text | A1 → tourDate near → /mypage → cancel attempt | Sandbox |
| D5 | Refund AI Plan booking | any | 403 NO_REFUND_DIGITAL | A3 → /mypage → cancel attempt | Sandbox |
| D6 | Refund already-canceled booking | any | 400/409 already canceled | D1 → cancel again | Sandbox |
| D7 | PayPal legacy booking refund (provider='paypal') | charter | PayPal API refund → status COMPLETED, regardless of Braintree gateway | Locate pre-Braintree booking (provider:'paypal' in Firestore) → cancel via /mypage | Canary (production legacy data) |

---

## E. Idempotency + Failure Modes

| # | Scenario | Expected | Reproduction steps | Sandbox? |
|---|---|---|---|---|
| E1 | Network failure during `transaction.sale` (mid-flight) | NO booking written; user can retry; no duplicate charge | Open Drop-in → submit → kill network mid-request → see error → retry | Sandbox (browser DevTools network throttle "Offline" mid-flight) |
| E2 | Duplicate submission (rapid double-click on Pay) | Single charge; second click rejected by Drop-in (nonce single-use) | A1 → click Pay twice rapidly | Sandbox |
| E3 | Same nonce reused after Drop-in error | Drop-in must teardown + recreate before retry; backend must reject reused nonce | Force first attempt to fail server-side → click Pay again | Sandbox |
| E4 | booking-processor side-effect failure (PDF gen exception) → booking still persists | Firestore booking CONFIRMED; `results.steps.pdf = "error: …"`; admin sees in /admin/reconciliation | Force PDFKit error (e.g., bad font path) → A1 | Sandbox (requires test-only PDF helper) |
| E5 | booking-processor email send failure | Booking persists; `results.steps.email = "error: ..."`; admin reconciliation flags missing email | Make Gmail SMTP env temporarily invalid → A1 | Sandbox (don't test in canary, would lose real email) |
| E6 | booking-processor telegram failure | Booking persists; admin can replay via `/admin/reconciliation` "일괄 재전송" | Set telegram bot tokens to invalid → A1 | Sandbox |
| E7 | Duplicate paypalOrderId on `/api/ai-planner-full` | 403 DUPLICATE_ORDER (used_paypal_orders sentinel) | Submit same orderID twice | Sandbox |

---

## F. **TEST_ACCOUNTS bypass exploit** (P2 §5 regression)

| # | Scenario | Endpoint | Expected (intended) | Actual (per current code) | Reproduction steps | Sandbox? |
|---|---|---|---|---|---|---|
| S1 | TEST_ACCOUNTS bypass on Drop-in submit (frontend, non-admin email logged in) | `/api/braintreeCheckout` | Treated as LIVE — `isTestAccount=false` (server-side, body-trusted email) | ✅ Server only logs mode; gateway uses BRAINTREE_ENV regardless. **Not exploitable here.** | Login as non-admin → tamper userEmail prop → click "Test Mode bypass" button | Sandbox |
| S2 | TEST_ACCOUNTS bypass — non-admin email forwarded with paypalOrderId='TEST-…' to `/api/ai-planner-full` | `/api/ai-planner-full` | 403 FORBIDDEN | ✅ Confirmed: F5 L82 rejects when `!isTestAccount` | curl POST /api/ai-planner-full with `email='attacker@example.com'`, `paypalOrderId='TEST-fake'` | Sandbox |
| S3 | TEST_ACCOUNTS bypass — admin email forwarded with paypalOrderId='TEST-…' to `/api/ai-planner-full` (NO Firebase auth) | `/api/ai-planner-full` | 403 (would-be-attacker can't claim admin email without auth) | ❌ **REGRESSION (P0)**: F5 L67 trusts `body.email`; bypass succeeds → free AI plan + Gemini call (~$0.05) | curl POST /api/ai-planner-full with `email='2001leety@gmail.com'`, `paypalOrderId='TEST-fake'` + valid wizard fields | Sandbox |
| S4 | Same as S3 but on `/api/braintreeCheckout` | `/api/braintreeCheckout` | Real charge attempted (sandbox or live env) — bypass logs but doesn't skip charge | ✅ F3 only logs mode; transaction.sale always called | curl POST /api/braintreeCheckout with admin email | Sandbox |
| S5 | S3 confirmed exploit → check rate limit | `/api/ai-planner-full` | Should be rate-limited per IP/email | ❌ INSUFFICIENT — no rate limiting found in payment gate. Adding to Phase 4. | Submit S3 exploit 100 times in 60s | Sandbox |
| S6 | TEST_ACCOUNTS hardcoded email change (admin rotates) | all 4 files | Single source of truth | ❌ Email duplicated 4 places (BraintreePaymentButton:164, braintreeCheckout:43, paymentGate:15, firestore.rules) — change requires 4 PRs | grep `2001leety@gmail.com` | n/a |

---

## G. Cross-cutting

| # | Scenario | Expected | Reproduction steps | Sandbox? |
|---|---|---|---|---|
| G1 | Sentry capture on `/api/braintreeCheckout` 5xx | Sentry event `route=/api/braintreeCheckout` w/ stack | Force exception (e.g., invalid nonce + invalid productType) | Sandbox |
| G2 | Sentry capture on `/api/booking-processor` 5xx | Sentry event for outer catch | Send malformed body | Sandbox |
| G3 | Sentry capture on `/api/_ai_core/paymentGate.js` failure path | ❌ **NO SENTRY HERE** — Phase 4 candidate | trigger Braintree verify failure | Sandbox |
| G4 | Sentry capture on `BraintreePaymentButton` checkout error | global Sentry init catches; explicit `captureException` would improve telemetry | Force frontend payment failure | Sandbox |
| G5 | dispatch_messages composite index works (status + expiresAt) | dispatch-timeout-sweep cron runs without 9 FAILED_PRECONDITION | After PR #238 + `firebase deploy --only firestore:indexes` | Production canary |
| G6 | Voucher PDF rendered for `requiresReconciliation: true` booking | amber "권역 평균 추정가" notice visible on PDF | A2 estimate booking → download voucher | Sandbox |
| G7 | Wallet pass for `requiresReconciliation: true` booking | LocalizedString reconciliation notice in textModule | A2 estimate booking → click Add to Google Wallet | Sandbox |

---

## H. Empty Post-Payment Page (PR #234 specific)

| # | Scenario | Expected | Reproduction steps | Sandbox? |
|---|---|---|---|---|
| H1 | Charter payment success → "내 예약 보기" → /mypage rendered (not blank) | Bookings tab visible, A1 booking listed | Complete A1 → success modal → click | Sandbox |
| H2 | Tour payment success → /mypage shows tour booking | Same as above for tour-typed booking | Complete A4 → success modal → click | Sandbox |
| H3 | AI Plan payment success → redirect to /my-plans/:planId, not /mypage | Plan detail page renders | Complete A3 → wait → redirect | Sandbox |
| H4 | K-pop shuttle payment success → /mypage rendered | Shuttle booking visible in MyBookings | Complete A6 → click | Sandbox |

---

## Total Coverage Summary

| Section | Scenarios |
|---------|-----------|
| A. Successful payment per productType | 6 |
| B. Post-payment UX | 8 |
| C. Coupons + P0 #1 | 12 |
| D. Refund Bronze tier matrix | 7 |
| E. Idempotency + Failure modes | 7 |
| F. TEST_ACCOUNTS bypass + P0 #2 | 6 |
| G. Cross-cutting (Sentry, indexes, voucher) | 7 |
| H. Empty page repro (PR #234) | 4 |
| **Total** | **57** |

Sandbox: 51 / Canary: 1 (D7) / Manual review: 5 (S6, code-only)

---

## How to Run

1. **Set up sandbox**: `BRAINTREE_ENV=sandbox` in Vercel preview env. Use admin email for all tests except S2/S3 (intentional non-admin).
2. **Per scenario**: capture (a) Firestore booking doc, (b) Sentry event ID if any, (c) telegram screenshot if alert.
3. **For P0 repros (C2-C6, S3)**: explicit goal is to **prove the bug exists**. Mark "Pass = bug reproduces as documented".
4. **Do NOT run E5 (email failure)** in canary — would lose real customer emails. Sandbox only.
5. **Do NOT run F1 (test mode bypass UI button)** in production — admin only sandbox.

---

PHASE 3 COMPLETE
File written: docs/PAYMENT-AUDIT-PHASE3.md
Test coverage: 57 scenarios across 8 sections
Open questions: none (matrix is build-only, no execution attempted)
Awaiting: "Proceed to Phase 4"
