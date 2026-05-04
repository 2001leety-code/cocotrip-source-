# Payment Audit — Apply Log

> 한 줄당: `YYYY-MM-DD | file:line | summary`. Phase 5 Edit 적용 시마다 추가.

## 2026-05-04

2026-05-04 | api/_shared/user-auth.js (NEW, 56L) | P0-#2: verifyUserToken helper added — Firebase ID token 검증 (admin-auth.js 패턴)
2026-05-04 | api/_ai_core/paymentGate.js:15-18,73-90,105,124 | P0-#2: TEST_ACCOUNTS hardcoded array 제거 + BRAINTREE_ENV='production' 시 TEST- 전면 reject + body.email 신뢰 종료(authenticatedEmail param) + Sentry captureError 2개 추가
2026-05-04 | api/ai-planner-full.js:13,60-77,89 | P0-#2: verifyUserToken 호출 + paymentGate에 authenticatedEmail 전달 + body.email 무시 (downstream email = authenticatedEmail)
2026-05-04 | src/pages/PlannerPage/hooks/usePlannerHandlers.ts:7-19,182-188,288-294 | P0-#2: getAuthHeader 추가 + handlePaymentSuccess + handleRevisionRegenerate Authorization Bearer header 첨부 (signed-out 사용자 사전 차단)
2026-05-04 | api/braintreeCheckout.js:117-191,245-246 | P0-#1: server-side coupon discount application — GLOBAL_PROMOS (EARLY50/COCO5/COCO10) hardcoded + Firestore 개인쿠폰 (couponDocId+couponUserId) lookup + fixed-USD/percent 분기 + 30% cap. 신규 booking 필드 couponDiscountKRW/promoCodeApplied (consumer 영향 없음 — 기존 모두 nullable fallback). pre-flight: TEST- prefix 0건 검증됨. 신규 필드는 braintreeCheckout 한곳에서만 write.

## Sandbox verification results (PR #247)

2026-05-04 | (verification #3) | **PASS** — curl `/api/ai-planner-full` (Authorization 헤더 없음, body.email=admin) → HTTP 401 `AUTH_REQUIRED`. P0-#2 verifyUserToken 정상 작동. 참고: TEST- 차단 레이어는 BRAINTREE_ENV='' 폴백으로 비활성 (P1-A deferred).
2026-05-04 | (verification #1) | **PASS** — signed-in (`2001leety@gmail.com`) Drop-in sandbox 결제 (`4111…1111` 12/30 123, 쿠폰 미적용). booking captureID `027ycrxp` (정상 Braintree 8자, TEST- 아님). 검증된 4 필드: `userEmail="2001leety@gmail.com"`, `couponDiscountKRW=null`, `promoCodeApplied=null`, `amountKRW=13300` (정가). `provider="braintree"`, `paymentStatus="submitted_for_settlement"`, `status="CONFIRMED"`. P0-#1 "쿠폰 미적용" 분기 정상 — `if(promoCode)` 가드로 전체 coupon 로직 skip → null fields write.
2026-05-04 | (verification #2) | **N/A** — 운영자 확인: 현재 활성 GLOBAL_PROMOS 미발행, Trip Coin 미발행 → 라이브 환경에서 promoCode-applied 경로 실행 0건. 런타임 검증 불가. 코드 인스펙션 (`api/braintreeCheckout.js:133-189`) 으로 GLOBAL_PROMOS / Firestore 쿠폰 분기 wiring 확인. 향후 쿠폰 발행 시점에 동일 체크리스트로 재검증 (couponDiscountKRW=정수, promoCodeApplied=string, amountKRW=matrix-할인액, 30% cap).
2026-05-05 | (verification #2 retroactive PASS) | **PASS (Trip Coin 실 적용 확인)** — prod 결제 captureID `9a7fqjks` (2026-05-04 23:47 KST, post PR #247 머지). booking 필드: `userEmail="2001leety@gmail.com"`, `couponDocId="DSRU7c8YaEGCXcZu2ebw"`, `couponUserId="rLpDpgI8HffwFe7x3LVD9VfARCd2"`, `couponDiscountKRW=7360` (int), `promoCodeApplied="Trip Coins redemption — $5 OFF"`, `amountKRW=5940`, `amountUSD="4.04"`. 수식 검증: $5 × 1472.03 = 7360.15 → Math.round 7360 ✓ / 13300 − 7360 = 5940 ✓ / 5940 / 1472.03 = 4.0366 → toFixed(2) "4.04" ✓ / 30% cap 미작동 (7360 < 13300 — Math.min 정상). Firestore 개인 쿠폰 lookup 분기 (`api/braintreeCheckout.js:149-179`) + fixed-USD 분기 (`:162-164`) + 차감 (`:185-189`) + booking write (`:225-253`) 모두 정상.
2026-05-05 | (operator confusion event) | **H1 confirmed** — booking missing 신고 → 실제 존재 (doc ID `9a7fqjks` 알파벳 순 정렬에서 묻힘). 11:49 KST 라 했지만 실제 createdAt = 23:47 KST. Firestore Console default sort = doc ID ascending 이라 운영자가 "맨 위" 만 본 것. 코드 결함 아님.
2026-05-04 | (out-of-scope) | **P2 observed**: AI Planner Gemini JSON parsing 3-retry fallback 발생 (response length 843→692→122, "Unterminated string in JSON"). 결제/booking 레이어 무관 (booking write 정상 완료 — 위 #1 PASS 가 증명). PR #247 audit scope 밖. 별도 세션에서 진단 (Gemini API quota / token cap / 최근 prompt 변경 영향 후보).

## Deferred P1 items (별도 PR — 본 세션 범위 밖)

2026-05-04 | api/_ai_core/paymentGate.js:86-89 | **P1-A** (deferred): fail-open 동작 — `BRAINTREE_ENV === 'production'` strict equal로 TEST- 차단. 빈 문자열/sandbox/미설정 모두 TEST- 허용. 운영자가 prod 에서 BRAINTREE_ENV='' (sandbox 폴백) 으로 self-test 환불 플로우 운영 중이라 의도된 상태. fix 방향: fail-closed 전환 (예: `env !== 'sandbox'` 시 reject). 본 PR 범위 밖, 별도 PR.
2026-05-04 | (env config) | **P1-B** (deferred): Production / Preview / Development 3-환경 Braintree 키 분리 미적용. 현재 모든 환경이 동일 BRAINTREE_* 키 (sandbox) 공유. fix 방향: Vercel env scoping (production=live keys, preview/dev=sandbox keys). 본 PR 범위 밖, 별도 PR.
2026-05-04 | src/components/WizardForm.tsx (TBD) | **P1-C** (deferred): sign-in gating UX — 결제 단계에 도달 전 wizard 진입 시점 modal 로 sign-in 요구. 현재는 결제 step에서 Bearer 401 발생 후 사용자 좌절. fix 방향: wizard entry guard + modal. 본 PR 범위 밖, 별도 PR.
