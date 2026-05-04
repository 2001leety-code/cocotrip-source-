# Payment Stabilization Audit — Phase 2 (Known Bug Verification)

> Generated 2026-05-04. Re-greps current `main` to verify each known fix. Does not trust PR descriptions.

---

## 1. PR #234 — Charter post-payment blank page → BookingDetailModal renders for ALL productTypes

**Verdict: VERIFIED FIXED**

**Evidence (re-grep):**
- `src/components/MyBookingsTab.tsx:271` — `<BookingDetailModal booking={detailTarget} … />` mounted unconditionally when `detailTarget` truthy
- Line 271 has no productType gate — ANY booking type opens the modal
- Line 458-459: `isAiPlanner` and `showVoucherBtn` only conditionally HIDE the voucher button (digital products), NOT the modal itself
- Line 444 (post-PR #243): "환불 윈도우 지난 [취소] disabled" 영역도 conditional render지만 모달은 노출됨
- Line 245 (legacy text): productType-aware label `!b.canRefund && !b.canModify && !ai-planner` for refund-window-closed indicator inside card

Edge cases verified:
- AI Plan booking → modal opens, voucher button hidden (correct; digital product has no voucher)
- Canceled booking → modal opens, voucher button hidden (correct)
- Legacy booking with no productType → `prettyProductLabel` returns '-', modal still opens

---

## 2. PR #243 — Refund-window-expired [cancel] server-side enforcement

**Verdict: VERIFIED FIXED**

**Evidence (re-grep):**
- `api/cancelBooking.js:144-149`:
  ```
  // 2. 환불 정책 평가
  const policy = evaluateRefundPolicy({ tourDate: booking.tourDate, tier });
  if (!policy.canRefund) {
    res.writeHead(409, JSON_CORS);
    return res.end(JSON.stringify(_err('Cancellation window closed — no refund available', 'NO_REFUND')));
  }
  ```
- Server independently evaluates Bronze tier policy from `booking.tourDate` (Firestore-stored value, not client-trusted) and rejects 409 if `!canRefund`
- Line 136-142: AI-planner blanket reject (403 NO_REFUND_DIGITAL) before policy eval
- Client UI (PR #243 `MyBookingsTab.tsx`) correctly disables button BUT server is the authority

Cross-reference: PR #234 client adds disabled button + alert; PR #243 server hardens by 409 reject. Two layers correctly aligned.

---

## 3. PR #245 — Coupon label vs server validation match (and adjacent server-side discount application)

**Verdict: REGRESSION DETECTED (broader scope than original PR #245)**

PR #245's narrow goal (frontend label clarity) is **VERIFIED FIXED**:
- `src/components/BraintreePaymentButton.tsx:193 & 300` — `appliedLabel` state set from `d.label` (server response, comes from coupon doc's `label` field)
- Coupon label render now shows `appliedLabel || pl.success` instead of generic "할인 적용됨"

**However**, broader regression exists on the actual discount application:

**Critical finding: Non-EARLY50 coupons are NOT applied server-side to the actual transaction amount.**

Evidence:
- `api/braintreeCheckout.js:117` — `if (promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);`
- This is the ONLY server-side discount logic. COCO5, COCO10, WELCOME5, fixed-USD coin coupons → IGNORED on server.
- `BraintreePaymentButton.tsx:363-373` request body sends `promoCode, couponDocId, couponUserId, customAmountKRW (estimate)` but **NOT the discounted amount**
- Server: `krwAmount = resolveKrwAmount(productType, passengers)` (matrix) OR `customAmountKRW` (estimate). Then conditionally `* 0.8` for EARLY50 only.
- Result: User clicks "Apply COCO5", UI shows ~~₩600,000~~ ₩570,000, clicks Pay → server charges ₩600,000 (full price)
- For estimate productType: `customAmountKRW = estimateKRW` (PRE-coupon) per `CharterNewPage.tsx:222`. `discountedKRW` is set on frontend via `applyPromoCode` API but never propagates to checkout request body.

**Severity: P0** — silent price mismatch on user side. UI promises discount, server charges full price.

**Note on user screenshot scenario** (60만원 → 6,750 discount → 593,250):
- That exact amount appears only in UI display (`effectiveKRW / 1350 = 439.44 USD`).
- Server-side actual charge: `customAmountKRW (600,000) / usdToKrw` — this does NOT equal 593,250 / 1350 unless `usdToKrw` happens to match. Bug obscured by exchange-rate variance.
- Stored `bookings.amountKRW = krwAmount` (line 163, F3) — i.e., 600,000 NOT 593,250. Admin can verify via `/admin/sales` once redeployed.

**Coupon label match (the narrow PR #245 question)**: server returns `label` directly from Firestore coupon doc (`coupons/{id}.label`), no transformation. So label IS accurate. The bug is the discount NOT being applied, not label being wrong.

---

## 4. PR #229 — booking-processor isolated try/catch → step failures don't roll back booking

**Verdict: VERIFIED FIXED**

**Evidence (re-grep):**
- `api/booking-processor.js` has 7 isolated try/catch blocks (Phase 1 inventory):
  - L164-171: sheets
  - L181-194: telegram
  - L205-218: dispatchBroadcast
  - L224-230: pdf
  - L235-241: wallet
  - L245-265: email + AI side-effect
  - L269-274: sheetsUpdate
- Each error stored in `results.steps.<X> = \`error: ${err.message}\`` and CONTINUES — does NOT throw.
- `api/braintreeCheckout.js:153-186` writes the actual `bookings/{transactionId}` doc BEFORE invoking booking-processor (fire-and-forget fetch at L195-220). So booking-processor's "failure" cannot rollback the Firestore booking write — they are decoupled processes.
- Inner ReferenceError guard at `braintreeCheckout.js:190-224` (PR #229) prevents body-construction errors from leaking.
- Outer catch at `booking-processor.js:345-352` calls `captureError` but returns 500 — by that point booking is already saved (or fetch failed before getting here). No rollback path exists.

Idempotency: NO. If client retries the fetch, multiple bookings could be created (different `transaction.id`). But Drop-in nonce is single-use → second submit fails. Safe enough.

---

## 5. TEST_ACCOUNTS bypass — non-admin email triggering sandbox path

**Verdict: REGRESSION DETECTED — exploitable on `/api/ai-planner-full`**

**Evidence (re-grep):**

### a) Frontend BraintreePaymentButton.tsx
- L164: `const TEST_ACCOUNTS: string[] = ['2001leety@gmail.com'];`
- L173: `const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());`
- `userEmail` prop comes from authenticated `useAuth()` user object in parent (CharterNewPage, PlannerPage)
- L589-597: when `isTestAccount` true, "🧪 Test Mode bypass" UI button → calls `onPaymentSuccess(\`TEST-${Date.now()}\`)` — bypasses real Braintree charge
- **Frontend assessment**: client-trusted `userEmail` could be tampered locally to claim admin email. BUT subsequent server-side validation gates whether bypass actually succeeds.

### b) Backend braintreeCheckout.js
- L43: `const TEST_ACCOUNTS = ['2001leety@gmail.com'];`
- L125: `const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());`
- L126-127: `console.log('[braintreeCheckout] mode:', isTestAccount ? 'SANDBOX (test acct)' : 'LIVE', …)`
- **Server only LOGS the mode** — does NOT change Braintree gateway env. Gateway init uses `BRAINTREE_ENV` env var (always live in prod).
- **F3 assessment**: `isTestAccount` check is purely informational on this endpoint. NO actual sandbox path bypass triggered by client-supplied email here.

### c) Backend paymentGate.js (called from `api/ai-planner-full.js`)
- L15: `const TEST_ACCOUNTS = ['2001leety@gmail.com'];`
- L67: `const requestEmail = (body.email || '').toLowerCase().trim();` — **client-trusted, NOT authenticated**
- L73: `const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);`
- L20-23: `function detectProvider(orderId) { if (orderId.startsWith('TEST-')) return 'test'; … }`
- L76-83:
  ```
  const provider = detectProvider(paypalOrderId);
  if (provider === 'test') {
    if (isTestAccount) {
      console.log('[planner] ✅ TEST MODE bypass — skipping payment verification for:', requestEmail);
    } else {
      return reject(403, 'FORBIDDEN', 'Unauthorized test mode', …);
    }
  }
  ```
- **Exploit path**: attacker sends POST `/api/ai-planner-full` with body `{ email: '2001leety@gmail.com', paypalOrderId: 'TEST-anything', …other planner fields }`
  - L67 → requestEmail = '2001leety@gmail.com'
  - L73 → isTestAccount = true
  - L76 → provider = 'test'
  - L79 → bypass payment verification → AI plan generated for FREE ($9.90 lost per attack)
- **No Firebase ID token verification in `api/ai-planner-full.js`** (grep `verifyIdToken|getAuth|Authorization` → no matches)
- The hardcoded admin email is **publicly known** (visible in CLAUDE.md, `firestore.rules`, multiple frontend files).

**Severity: P0** — exploitable, costs $9.90 per AI plan + AI compute. Mitigated only by obscurity (no public docs about TEST- prefix), but anyone who reads frontend bundle can find it.

---

## Sentry Coverage Cross-Check (followup from Phase 1)

Confirmed gaps still present:
- `api/_ai_core/paymentGate.js` — no `captureError` import. Payment verification failures (Braintree verify failed, PayPal auth failed, duplicate order) only `console.error` logged. **NOT in Sentry.**
- `src/components/BraintreePaymentButton.tsx` — relies on global `Sentry.init` auto-capture from `src/main.tsx`. Frontend payment errors do NOT explicitly call `Sentry.captureException`. PostHog `payment_failed` event fires (line 392) but Sentry visibility weaker.

---

## Open Questions / Risks Requiring Operator Decision

1. **Coupon server-side application bug** — was this intentional (only EARLY50 honored, rest are "fake discounts" for marketing display) or a regression after Braintree migration? Cannot tell from code alone. Would require git blame on F3 lines 116-117 + product owner intent.
2. **TEST_ACCOUNTS hardcoded email** appears in **at least 4 places** (F1 line 164, F3 line 43, F5 line 15, plus `firestore.rules` per SYSTEM-OVERVIEW). Even if Phase 5 adds Firebase ID token verification to `/api/ai-planner-full`, the constant should ideally be centralized.
3. **Decoupling vs idempotency**: PR #229's design (booking write → fire-and-forget fetch to booking-processor) means email/telegram failures show in `results.steps` but never alert anyone unless admin checks. Recommend follow-up to add Sentry capture per failed step (currently only console.error).

---

PHASE 2 COMPLETE
File written: docs/PAYMENT-AUDIT-PHASE2.md
Findings:
  • PR #234 — VERIFIED FIXED (modal renders for all productTypes)
  • PR #243 — VERIFIED FIXED (server-side 409 on closed window)
  • PR #245 — REGRESSION DETECTED (broader: server applies only EARLY50, all other coupons are display-only) ⚠️ P0
  • PR #229 — VERIFIED FIXED (7 isolated try/catch + decoupled booking write)
  • TEST_ACCOUNTS bypass — REGRESSION DETECTED (`/api/ai-planner-full` exploitable; admin email is hardcoded + publicly known) ⚠️ P0
Open questions:
  1. Coupon discount not applied server-side — intentional or regression? (need product owner intent)
  2. TEST_ACCOUNTS centralization — defer to Phase 4
  3. Per-step Sentry capture in booking-processor — defer to Phase 4
Awaiting: "Proceed to Phase 3"
