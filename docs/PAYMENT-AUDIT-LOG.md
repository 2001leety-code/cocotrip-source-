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

## 2026-05-05 — Followup investigations (P2 / D / E)

2026-05-05 | api/ai-planner-quick.js:140-196 | **P2 진단**: Gemini JSON unterminated 3-retry fallback 원인 = `AbortController` **18s timeout** (line 148). cold start (Vercel serverless 첫 호출) + Gemini SDK init + Gemini API round-trip + JSON streaming 합산 가능 시간이 18s 초과 가능. 응답 길이 843→692→122 패턴 = 매 attempt 마다 timeout 시점이 더 빨라짐 (cold→warm 전환 안 되고 retry간 800ms 만 sleep). `maxOutputTokens=2000`, `temperature=0.7`, `responseMimeType='application/json'` 설정은 정상. fix 후보 (별도 PR): (1) timeout 18s → 30s 상향, (2) cold start warmup endpoint, (3) 첫 attempt 만 timeout 30s + 이후 18s, (4) Gemini stream 응답 partial parse fallback. 우선순위 medium — 사용자 영향 = 무료 preview 플랜 단순 메시지로 폴백 (유료 ai-planner-full 은 별도, `maxOutputTokens=32000` 사용 중).

2026-05-05 | (test plan) | **D — Charter/Tour 환불 검증 (계획)**: `api/cancelBooking.js` 의 `evaluateRefundPolicy` 시간 기반 환불 (T-30/T-7/T-3/T-1) 흐름 sandbox 검증. 시나리오: (1) productType=charter 결제 + tourDate=오늘+10일 → /api/cancelBooking → 100% refund + Braintree refund tx + booking.status='CANCELED' + refundID 기록, (2) tourDate=오늘+2일 → partial refund (정책별 ratio), (3) tourDate=오늘+0.5일 → NO_REFUND, (4) `productType.startsWith('ai-planner')` → NO_REFUND_DIGITAL (디지털 상품 정책, PR #247 audit scope 외 — 운영자 의도된 정책으로 확인됨). 본 PR 범위 외. 별도 세션에서 sandbox booking 4건 생성 + 결과 비교.

2026-05-05 | src/components/BraintreePaymentButton.tsx:212-213, src/i18n/locales/{ko,en}.json:1560 | **E — UI/system mismatch 발견**: UI 텍스트 `"AI 플래너 1회 = 5% 쿠폰 1장"` (`couponAdTitle` 키, ko/en 양쪽). 실 시스템: `api/_ai_core/planPersister.js:117-159` 가 AI plan 결제 시 **Trip Coins 적립** (Bronze 1% / Silver 1.5% / Gold 2% / Platinum 3%, $9.90 결제 → Bronze 10 coins). 5% 쿠폰 자동 발행 코드 0건. Trip Coins 500개 모이면 `api/loyalty.js:316-364` 의 redeem-coupon 으로 $5 fixed-USD 쿠폰 교환 가능. 즉 UI 카피는 1회 결제로 5% 쿠폰 받는다는 인상을 주지만 실제로는 50회 결제 분의 Trip Coins 적립 후 $5 fixed 쿠폰 1장 교환. **결정 필요**: (a) UI 카피를 적립 정책에 맞게 수정 ("AI 플래너 1회 = Trip Coins 적립"), (b) 5% 쿠폰 자동 발행 기능 신규 구현 (현재 Bronze tier 'Welcome 5% coupon' 은 1회성 가입 혜택), (c) 'AI 플래너 1회 = 5% 쿠폰' 의 "5%" 가 사실은 charter 결제 시 5% 절약을 가리키는 의도라면 카피 명확화. 운영자 결정 후 별도 PR. 관련 prior: PR #245 ("쿠폰 라벨 명시 표시 — fixed USD 쿠폰을 5%로 오해하는 문제") 가 일부 라벨만 fix.
