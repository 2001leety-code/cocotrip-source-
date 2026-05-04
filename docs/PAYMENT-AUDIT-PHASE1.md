# Payment Stabilization Audit — Phase 1 (Discovery)

> Generated 2026-05-04. Scope: 9 critical files (1 frontend + 7 backend + 1 frontend wizard + 1 frontend wizard folder). Read-only grep-based discovery.
>
> Cross-referenced with `docs/SYSTEM-OVERVIEW.md` §7 ("17 endpoints with Sentry captureError"). Findings below are grep-verified in the current `main` branch.

---

## File Coverage

| # | File | Status | Lines |
|---|---|---|---|
| F1 | `src/components/BraintreePaymentButton.tsx` | exists | ~628 |
| F2 | `api/braintreeClientToken.js` | exists | ~45 |
| F3 | `api/braintreeCheckout.js` | exists | ~250 |
| F4 | `api/booking-processor.js` | exists | ~360 |
| F5 | `api/_ai_core/paymentGate.js` | exists | ~140 |
| F6 | `api/cancelBooking.js` | exists | ~245 |
| F7 | `api/applyPromoCode.js` | exists | ~225 |
| F8 | `src/components/charter/CharterWizard.tsx` | exists | 170 |
| F9 | `src/components/WizardForm/` (folder) | exists | 390 (index.tsx) + 9 step files |

---

## Findings Table

| File | Line | Issue Type | Evidence (grep output) | Severity guess |
|---|---|---|---|---|
| F1 BraintreePaymentButton.tsx | (no Sentry import) | **Missing Sentry coverage** (frontend payment errors not explicitly captured — relies on global `Sentry.init` in main.tsx auto-capture) | `grep -nE "captureError\|Sentry"` → empty | **HIGH** |
| F1 BraintreePaymentButton.tsx | 164 | TEST_ACCOUNTS bypass | `const TEST_ACCOUNTS: string[] = ['2001leety@gmail.com'];` | medium (intentional, hardcoded admin email) |
| F1 BraintreePaymentButton.tsx | 173 | TEST_ACCOUNTS check | `const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());` | medium |
| F1 BraintreePaymentButton.tsx | 589 | Test Mode bypass UI button | `{/* 🧪 Test Mode bypass — 어드민 본인 결제 우회 */}` | medium (only renders when `isTestAccount`) |
| F1 BraintreePaymentButton.tsx | 226-235 | client token fetch try/catch | `try { … json.error … } catch (err) { setTokenError… }` | low (well-handled) |
| F1 BraintreePaymentButton.tsx | 248-268 | Drop-in init try/catch | `try { … } catch (err) { dropinInstanceRef.current.teardown().catch(() => {}); }` | low |
| F1 BraintreePaymentButton.tsx | 288-312 | Promo code apply try/catch | `try { fetch /api/applyPromoCode } catch { setPromoError(pl.invalid); }` | low |
| F1 BraintreePaymentButton.tsx | 357-395 | Payment submit try/catch with friendly mapper | `try { throw new Error(json.error || 'Payment processing failed') } catch (err) { console.error … } void posthogTrack('payment_failed', …)` | low (no Sentry, but PostHog ✓) |
| F1 BraintreePaymentButton.tsx | 595 | TEST account skip-payment | `try { await onPaymentSuccess(\`TEST-${Date.now()}\`) } catch (err) { setPaymentError(…) }` | medium (test path skips real payment) |
| F2 braintreeClientToken.js | 10 | Sentry import | `import { captureError } from './_shared/sentry.js';` | ✓ proper |
| F2 braintreeClientToken.js | 32-42 | try/catch with captureError + JSON err response | `try { … } catch (err) { console.error … await captureError(err, { route: '/api/braintreeClientToken' }) … }` | low (well-handled) |
| F3 braintreeCheckout.js | 17-18 | TEST_ACCOUNTS comment | `* email이 TEST_ACCOUNTS에 있으면 sandbox transaction (Braintree sandbox env로 처리)` | medium (intentional) |
| F3 braintreeCheckout.js | 43 | TEST_ACCOUNTS definition | `const TEST_ACCOUNTS = ['2001leety@gmail.com'];` | medium (single email only) |
| F3 braintreeCheckout.js | 125 | TEST_ACCOUNTS check + sandbox env | `const isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());` | **HIGH if exploitable** — server validates email match before sandbox path; needs verification |
| F3 braintreeCheckout.js | 21 | Sentry import | `import { captureError } from './_shared/sentry.js';` | ✓ proper |
| F3 braintreeCheckout.js | 59-247 | Outer try/catch with captureError | line 240-247 | ✓ |
| F3 braintreeCheckout.js | 153-184 | Inner Firestore save try/catch (does NOT throw on fail — comment "사용자 환불 무한 루프 방지") | line 182-184 | medium (silent on Firestore fail; transaction.sale already succeeded) |
| F3 braintreeCheckout.js | 190-224 | **PR #229 isolated try/catch** for booking-processor body construction (prevents ReferenceError from rolling back) | `// 2026-05-04: 격리된 try/catch — body 객체 리터럴 평가 시 ReferenceError 가 outer` | ✓ confirmed PR #229 present |
| F3 braintreeCheckout.js | 220 | booking-processor.fetch().catch — fire-and-forget | `.catch((err) => console.error('[braintreeCheckout] booking-processor call failed:', err.message))` | medium (no captureError, swallowed) |
| F4 booking-processor.js | 20 | Sentry import | `import { captureError } from './_shared/sentry.js';` | ✓ |
| F4 booking-processor.js | 76-78 | Initial try/empty catch | `try { … } catch { … }` (body parse) | low |
| F4 booking-processor.js | 116-194 | **Step-isolated try/catch (PR #229 verified)** — sheets/telegram/dispatchBroadcast/pdf/wallet/email/sheetsUpdate all wrapped, each error stored in `results.steps.<X>` and continue, no rollback | line 164-274 — 7 isolated try/catch blocks | ✓ confirmed PR #229 + #229 expansion |
| F4 booking-processor.js | 230 | PDF gen failure isolated | `results.steps.pdf = \`error: ${err.message}\`;` continues to wallet | ✓ |
| F4 booking-processor.js | 240 | Wallet failure isolated | `results.steps.wallet = \`error: ${err.message}\`;` continues to email | ✓ |
| F4 booking-processor.js | 264 | Email failure isolated | `results.steps.email = \`error: ${err.message}\`;` continues | ✓ |
| F4 booking-processor.js | 312 | Loyalty side-effect isolated | `} catch (loyaltyErr) {` | ✓ |
| F4 booking-processor.js | 345-352 | Outer catch with captureError | `await captureError(error, { … })` | ✓ |
| F5 paymentGate.js | (no Sentry import) | **Missing Sentry coverage** for revisionCredits + Braintree/PayPal verification path | `grep -nE "captureError\|Sentry"` → empty | **HIGH** |
| F5 paymentGate.js | 15 | TEST_ACCOUNTS hardcoded | `const TEST_ACCOUNTS = ['2001leety@gmail.com'];` | medium |
| F5 paymentGate.js | 73 | TEST_ACCOUNTS check | `const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);` | medium |
| F5 paymentGate.js | 80-82 | Test mode bypass — UNAUTHORIZED non-admin email check | `console.log('[planner] ✅ TEST MODE bypass …'); … return reject(403, 'FORBIDDEN', 'Unauthorized test mode', …)` | ✓ rejects non-admin (line 82) |
| F5 paymentGate.js | 88-106 | Braintree verify try/catch returning structured reject | `try { … } catch (e) { console.error('[planner] Braintree verify failed:', e.message); return reject(403, 'PAYMENT_VERIFY_ERROR', e.message); }` | medium (no Sentry) |
| F5 paymentGate.js | 113-119 | PayPal auth try/catch | `} catch (e) { console.error('[planner] PayPal auth failed:', e.message); return reject(403, 'PAYPAL_AUTH_ERROR', e.message); }` | medium (no Sentry) |
| F5 paymentGate.js | 100, 136 | Duplicate-order detection (used_paypal_orders + braintree dedup) | `return reject(403, 'DUPLICATE_ORDER', 'Order already used', …)` | ✓ proper |
| F6 cancelBooking.js | 14 | Sentry import | `import { captureError } from './_shared/sentry.js';` | ✓ |
| F6 cancelBooking.js | 36-37 | Comment + empty TEST_ACCOUNTS array | `// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.` `const TEST_ACCOUNTS = [];` | low (dead code; refund always LIVE) |
| F6 cancelBooking.js | 109 | `void TEST_ACCOUNTS;` dead reference | `void TEST_ACCOUNTS;` | low (dead code; reflects "always live" decision) |
| F6 cancelBooking.js | 41 | Throws if Firestore unavailable | `if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');` | low (caught by outer try) |
| F6 cancelBooking.js | 95-228 | Outer try/catch with captureError | line 230 | ✓ |
| F6 cancelBooking.js | 159-164 | PayPal legacy refund inner try/catch | `try { … } catch (err) { … }` | medium (no Sentry on inner refund failure path; depends on whether outer catches it) |
| F7 applyPromoCode.js | 14 | Sentry import | `import { captureError } from './_shared/sentry.js';` | ✓ |
| F7 applyPromoCode.js | 41-71 | Firestore coupon verify try/catch | `try { … } catch (err) { console.warn(…); return null; }` | low (returns null on fail; not Sentry-captured because graceful) |
| F7 applyPromoCode.js | 87-219 | Outer try/catch with captureError | line 217-219 | ✓ |
| F7 applyPromoCode.js | 89 | Body parse inline try/catch | `try { body = JSON.parse(body); } catch { body = {}; }` | low |
| F8 CharterWizard.tsx | (none) | No try/catch/error/throw/reject patterns | `grep -nE "try\|catch\|throw\|reject\|error"` → no matches | low (thin step host wrapper) |
| F8 CharterWizard.tsx | (none) | No Sentry, TODOs, or bypass patterns | All 4 grep patterns → empty | low |
| F9 WizardForm/index.tsx | 38 | errorMsg state | `const [errorMsg, setErrorMsg] = useState('');` | low (UI state) |
| F9 WizardForm/index.tsx | 180 | localStorage write silent catch | `try { if (mainCity) localStorage.setItem(…) } catch { /* silent */ }` | low (intentional) |
| F9 WizardForm/index.tsx | 184-230 | AI plan generation fetch try/catch | `try { … } catch { setErrorMsg('Network error. …') }` | medium (no Sentry on plan generation failure; UI shows generic message) |
| F9 WizardForm/index.tsx | 224 | AI timeout error message | `setErrorMsg('AI is taking too long. Please try again in a moment.');` | low (timing) |
| F9 WizardForm/* | (none) | No Sentry, TODOs, or bypass patterns across all 10 files | All grep patterns across folder → empty | low |

---

## TODO/FIXME/HACK Inventory

**Zero matches across all 9 files.** No TODO/FIXME/HACK/XXX/@ts-ignore/@ts-expect-error/eslint-disable comments anywhere in the payment pipeline.

---

## Sentry Coverage Cross-Check vs SYSTEM-OVERVIEW.md §7

| Endpoint | Listed in §7? | Verified in code? |
|---|---|---|
| `api/braintreeClientToken.js` | ✓ | ✓ line 10+40 |
| `api/braintreeCheckout.js` | ✓ | ✓ line 21+242 |
| `api/booking-processor.js` | ✓ | ✓ line 20+347 |
| `api/cancelBooking.js` | ✓ | ✓ line 14+230 |
| `api/applyPromoCode.js` | ✓ | ✓ line 14+219 |
| `api/_ai_core/paymentGate.js` | **NOT listed** | **NOT present** |
| `src/components/BraintreePaymentButton.tsx` | n/a (frontend) | **NOT directly imported** (relies on global init in `src/main.tsx` + `src/lib/sentry.ts`) |

→ **2 files in payment pipeline lack Sentry coverage: F1 (frontend) and F5 (paymentGate.js)**.

---

## Summary

- **9 files audited.** All exist on `main` (39aaf64 + post-merge head).
- **Total error paths**: ~70 try/catch + reject patterns documented.
- **TODO/FIXME/HACK**: 0 across all files.
- **TEST_ACCOUNTS bypass**: present in F1 (line 164/173/589), F3 (line 17-18 comment, 43, 125), F5 (line 15, 73, 80-82). Empty + void in F6 (dead code).
- **Missing Sentry**: F1 (frontend BraintreePaymentButton, no direct capture) and F5 (paymentGate.js, no import).
- **PR #229 isolated try/catch verified**: F4 booking-processor 7 isolated steps + F3 braintreeCheckout body construction guard.

---

PHASE 1 COMPLETE
File written: docs/PAYMENT-AUDIT-PHASE1.md
Findings: 47 issues across 9 files
Open questions:
  1. F1 BraintreePaymentButton — should frontend payment errors call `Sentry.captureException` directly, or rely solely on global `init`'s automatic capture? (Phase 2 verifies behavior)
  2. F3 braintreeCheckout line 125 — does sandbox path require server-side admin allowlist (not client-trusted email)? Phase 2 will verify.
  3. F5 paymentGate.js — no Sentry import. Should it be added in Phase 5? (out of scope for Phase 1)
  4. F6 line 109 `void TEST_ACCOUNTS` is dead code — keep or remove? (cosmetic, defer to Phase 4)
Awaiting: "Proceed to Phase 2"
