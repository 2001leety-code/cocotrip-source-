# Payment Audit — Apply Log

> 한 줄당: `YYYY-MM-DD | file:line | summary`. Phase 5 Edit 적용 시마다 추가.

## 2026-05-04

2026-05-04 | api/_shared/user-auth.js (NEW, 56L) | P0-#2: verifyUserToken helper added — Firebase ID token 검증 (admin-auth.js 패턴)
2026-05-04 | api/_ai_core/paymentGate.js:15-18,73-90,105,124 | P0-#2: TEST_ACCOUNTS hardcoded array 제거 + BRAINTREE_ENV='production' 시 TEST- 전면 reject + body.email 신뢰 종료(authenticatedEmail param) + Sentry captureError 2개 추가
2026-05-04 | api/ai-planner-full.js:13,60-77,89 | P0-#2: verifyUserToken 호출 + paymentGate에 authenticatedEmail 전달 + body.email 무시 (downstream email = authenticatedEmail)
2026-05-04 | src/pages/PlannerPage/hooks/usePlannerHandlers.ts:7-19,182-188,288-294 | P0-#2: getAuthHeader 추가 + handlePaymentSuccess + handleRevisionRegenerate Authorization Bearer header 첨부 (signed-out 사용자 사전 차단)
