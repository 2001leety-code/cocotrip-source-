# CocoTrip 종합 시스템 검증 보고서

**작성일**: 2026-05-13
**범위**: AI 플래너 100회 + 차터 10회 + 투어 10회 검증 준비 + 전체 시스템 audit
**작성자**: Claude (Sonnet/Opus) — 3 agent 병렬 코드 audit + 테스트 harness
**현재 main HEAD**: `c6987ef` (5/13 누적 31 PR 머지 #383~#415)

---

## ⚠️ 1. 실행 한계 (먼저 명시)

**실제 100/10/10 prod 실행은 Claude 단독 불가** — 사용자 자격 증명 필요:

| 필요 | 보유 여부 | 이유 |
|---|---|---|
| Firebase ID 토큰 | ❌ | 운영자 브라우저 console 추출 필요 |
| Gemini API 비용 | ❌ | ~$10 / 100 plan (Google billing 사용자 계정) |
| PROD 결제 bypass | ❌ | `BRAINTREE_ENV='production'` → TEST- prefix 거부 |
| Vercel preview URL | ❌ | PR #416 머지 시 자동 생성 |

**대안 (이 보고서)**: 코드 레벨 audit 완료 + 테스트 harness 운영자 실행용 제공.

---

## 📦 2. 제공 산출물

### PR #416 — `scripts/verify-prod-system-check.mjs`
- 100 AI plans + 10 charter + 10 tour 자동 실행
- 입력 다양성: 4 언어 × 7 도시 × 6 dietary × 1-7일 × single/multi-city
- 출력: `outputs/verify-{timestamp}.json` (요약) + `verify-{timestamp}-details.json` (전체)
- 동시성 worker 4 (CONCURRENCY env)
- Dry-run 모드 (`--dry-run`)
- 자동 집계: 성공률, latency p50/p95/p99, 에러 코드 분포

### 운영자 사용법 (3-step)
```bash
# 1. Vercel preview URL 확보 (PR #416 머지 시 자동 생성됨)
$env:BASE_URL = "https://cocotrip-source2026-{branch}-2001leety-3613s-projects.vercel.app"

# 2. Firebase ID 토큰 추출 (브라우저 console)
# 위 preview URL 로그인 → DevTools → Console:
# > (await firebase.auth().currentUser.getIdToken())
$env:FIREBASE_ID_TOKEN = "<paste token>"

# 3. 실행
node scripts/verify-prod-system-check.mjs --plans 100 --charters 10 --tours 10
```

### 비용 예상
- AI plans 100회: Gemini ~$10, Vercel function ~5h (worker 4 → ~1.5h)
- Charter 10회: payment bypass, ~1분
- Tour 10회: payment bypass, ~1분

---

## 🏗️ 3. 시스템 아키텍처 (3 agent audit 종합)

### 3.1 AI 플래너 (12단계, `api/ai-planner-full.js` 307L)

```
Wizard (4 steps + Review)
  → POST /api/ai-planner-full
    1. verifyUserToken (Firebase ID token)        → AUTH_REQUIRED (401)
    2. enforcePaymentAndRevision                  → PAYMENT_REQUIRED/INCOMPLETE/...
    3. day1 = tomorrow guard                       → PLANNER_DATE_TOO_SOON (400)
    4. decidePlannerMode (A/B 10% 3pass)
    5-6. runGeminiPipeline:
        - gemini-2.5-pro, temp=0.5, thinking=32K, timeout=240s
        - repairAndParseJSON / sanitizeStops
        - validateResponse (dietary critical)     → DIETARY_VIOLATION (422) ⚠️
        - validatePatternStructure (9 hard validators) → PLAN_VALIDATION_FAILED (500)
            B-DC / B-10 / B-12 / B-13 / B-LCC / B-14 / B-MEAL / B-15 / B-16
        - 1회 retry → 그래도 실패 시 throw
        - checkSoftQualityWarnings (B-18 SOFT)
        - applyDBMatcher
    7. enrichItineraryWithRoute (RouteAgent + intra-day TSP)
    8-10. calculateTmoney → recommendedRestaurants → persistPlan (Firestore)
    11. JSON 응답 {planId, planUrl, itinerary, pricing}
    12. Non-blocking: email + Sheets + Telegram + push
  → 클라이언트 navigate /my-plans/:planId
  → PDF 다운로드 (client html2pdf)
```

### 3.2 차터 Booking (`api/createPaypalOrder.js` → `capturePaypalOrder.js` → `booking-processor.js`)

```
Wizard 6 steps (CharterWizard.tsx)
  → useQuoteCalculator (matrix → geocoding → manual fallback)
  → PayPalBookingButton (SDK + QR fallback)
  → POST /api/applyPromoCode (선택)
  → POST /api/createPaypalOrder
    - SSOT api/_pricing_spec.json → resolveKrwAmount
    - Cutoff guard (charter 24h, multi_day 48h)
    - AI planner coupon reject
  → PayPal Smart Buttons → onApprove
  → POST /api/capturePaypalOrder
    - Duplicate guard (used_paypal_orders)
    - WRITE Firestore bookings/{orderID}
    - Coupon mark used (race → couponWarning + notifyOperator)
    - Fire-and-forget POST /api/booking-processor
  → background /api/booking-processor:
    1. USD→KRW
    2. Google Sheets append
    3. sendDispatchAlert + sendBookingPaymentAlert (Telegram)
    3.5. AUTO_DISPATCH_BROADCAST → 활성 driver 들에게 inline keyboard
    4. generateVoucherPDF (pdfkit + qrcode, Helvetica)
    5. createWalletPass (optional)
    6+. sendBookingConfirmation (email + PDF 첨부)
  → 클라이언트 confirmation modal
```

### 3.3 투어 Booking (동일 path, productType만 다름)

```
ToursPage → TourDetailPage
  → TourBookingDialog (12h date cutoff UI guard + autosave)
  → 동일 PayPalBookingButton 경로
  → SPEC.daily_tour_prices 가격
  → 동일 bookings/{orderID} 저장 + booking-processor + Telegram
  → GET /api/voucher?bookingID=&userEmail= (post-booking PDF 재발급)
```

### 3.4 환불 흐름 (2 path)

**A. 사용자 self-serve** (`POST /api/cancelBooking`):
1. bookings/{id} 소유권 (userEmail 일치)
2. status CONFIRMED 확인
3. AI Planner → `NO_REFUND_DIGITAL` (403, 환불 X)
4. `evaluateRefundPolicy` (api/_refund-policy.js) → ratio 결정
5. PayPal `/v2/payments/captures/{captureID}/refund`
6. bookings update: `status=CANCELED, refundID, refundedAmount, refundPercent`
7. Triple Telegram alert (booking + dispatch + operator)
8. 4-lang 환불 email

**B. 어드민 수동** (`POST /api/admin-booking-action action=mark-refunded`):
1. verifyAdminToken
2. admin_actions audit log 먼저
3. pending_bookings/{bookingRef} 또는 bookings/{id} 업데이트
4. notify + sendCustomerNotification
5. **PayPal API 호출 X** — 운영자가 PayPal dashboard에서 이미 환불 처리 (상태만 기록)

---

## 🔔 4. 알림 채널 매트릭스 (Agent C audit)

### 4.1 Telegram 5채널 (`api/_shared/notify.js`)

| 채널 | env | 용도 | Throttle | 100/10/10 예상 |
|---|---|---|---|---|
| **booking** | `TELEGRAM_BOOKING_BOT_TOKEN` | 신규 예약/환불 알림 | 없음 | 10 charter + 10 tour = **20+ msg** |
| **dispatch** | `TELEGRAM_DISPATCH_BOT_TOKEN` | 배차 알림 + driver inline keyboard | 없음 | 10 charter = **10 msg** |
| **error** | `TELEGRAM_ERROR_BOT_TOKEN` | 시스템 에러 | **5분 dedup** | ≤1-2 (retry 성공 시 silent) |
| **inquiry** | `TELEGRAM_INQUIRY_BOT_TOKEN` | 고객 채팅/문의 | 없음 | 0 (test 미발생) |
| **admin** (`TELEGRAM_BOT_TOKEN`) | (legacy/fallback) | **operator must act**: refund/coupon-warning/cs-overdue 등 | 없음 (즉시) | refund 발생 시 |

### 4.2 주요 알림 key (error 채널, dedup 5분)

| Key | Severity | 트리거 | 운영자 액션 |
|---|---|---|---|
| `ai-planner-unhandled` | high | 처리되지 않은 throw | 즉시 — Vercel logs stack 확인 |
| `plan-validation-failed-{legacy,3pass}` | high | 1회 retry 후에도 validator fail | 즉시 — circuit breaker (RUNBOOK) |
| `gemini-quota-exceeded` | **critical** | Gemini API 429/RESOURCE_EXHAUSTED | 즉시 — batch 중단, quota 확인 |
| `booking-processor-fail:{step}` | high | booking 후 side-effect 실패 | 1시간 내 — 어느 step 인지 확인 |
| `pdf-generate-puppeteer` | high | Voucher PDF 생성 실패 | 1시간 내 — Puppeteer 점검 |
| `plan-quality-local-tag-low` | low | B-18 다양성 < 30% | 무시 가능 (noise) |
| `daily-report-fail` | medium | 일일 보고 실패 | 2일 연속 시 조사 |

### 4.3 Sentry capture 인벤토리

- **server** (`api/_shared/sentry.js`): `SENTRY_DSN`, `tracesSampleRate=0.05`, `sendDefaultPii=false`
- **frontend** (`src/lib/sentry.ts`): **PROD only**, `tracesSampleRate=0.10`, ResizeObserver/ChunkLoadError 등 필터
- captureError 호출지: **30+ 파일 매핑** (Agent C 보고서 참조)
- 100 plan run 시 주요 tag: `route:/api/ai-planner-full` + `planner_mode` + `code`

### 4.4 어드민 실시간 (Firestore `onSnapshot`)

- `/admin/calendar` — bookings live
- `/admin/claims` — claims + inquiries
- `/admin/payments` — pending_bookings
- `/admin/ops` (OpsHub) — dispatch + Telegram log
- `/admin/quality` — **REST polling** (페이지 새로고침 시만)

### 4.5 Email 알림

- 신규 booking confirmation: `_send-email.js` (Gmail SMTP) + voucher PDF 첨부
- 수동 결제 요청 (PayPal QR): `_shared/manual-payment-emails.js`
- 환불 안내: inline 4-lang template
- D+2 환불 리마인더: `api/_crons/refund-reminder.js`
- **AI 플랜 실패 시 사용자 email 자동 X** — Sentry/Telegram 만 → 운영자 수동 안내

### 4.6 일일 헬스 센티넬 (GitHub Actions)

- `daily-health.yml`: **월/수/금 09:00 KST** — E2E + regression (12 assertions)
- `quality-alert.yml`: **매일 10:00 KST** — qualityScore 임계 (HARD 80, DROP 10)

---

## 🚨 5. 실패 모드 매트릭스 (전체)

### 5.1 AI 플래너 (Agent A)

| 단계 | Error Code | HTTP | Severity | 운영자 액션 |
|---|---|---|---|---|
| Auth | `AUTH_REQUIRED` | 401 | Low | None |
| Payment | `PAYMENT_REQUIRED/INCOMPLETE/DUPLICATE/REVISION_EXHAUSTED` | 403 | Low/Med | UX gate |
| Payment | `FORBIDDEN` (ADMIN-BYPASS 비-admin) | 403 | High | `ADMIN_BYPASS_EMAILS` 확인 |
| Payment | `PAYPAL_AUTH_ERROR` | 403 | High | PayPal env 확인 |
| Gemini | `GEMINI_QUOTA` | 503 | **Critical** | batch 중단, quota 상향 |
| Gemini | `GEMINI_TIMEOUT` | 504 | High | 단발 retry, 지속 시 조사 |
| Validator | `DIETARY_VIOLATION` | 422 | **Critical** | 환불 + 안내 (SAFETY-CRITICAL J) |
| Validator | `PLAN_VALIDATION_FAILED` | 500 | High | 빈도 >5/h 시 circuit breaker |
| Firestore | "Plan save failed" | 500 | High | Firebase 상태 확인, 환불 |
| RouteAgent | (silent) | n/a | Med | NAVER/ODSAY env 확인 |
| PDF (client) | "empty canvas" / "blank blob" | n/a | Med | font 로드 확인 |

### 5.2 Charter/Tour Booking (Agent B)

| 단계 | Error Code | HTTP | 운영자 액션 |
|---|---|---|---|
| Quote calc | `needsCustomQuote` (UI) | n/a | matrix-miss → inquiry form |
| Coupon | `INVALID_CODE/PROMO_LIMIT_REACHED/promo_expired` | 400 | UX 메시지 |
| createOrder | `SPEC_MISSING/INVALID_PRODUCT/BOOKING_CLOSED/INVALID_DATE` | 400 | UX gate or pricing_spec.json 확인 |
| createOrder | `AI_PLANNER_NO_COUPON` | 400 | 정책 — coupon 등 charter+tour 만 |
| SDK | "ad blocker" / "SDK timeout" | n/a | 자동 QR fallback (`PayPalQrPanel`) |
| Capture | `DUPLICATE_ORDER` | 409 | idempotency (정상) |
| Capture | `COUPON_ALREADY_USED` | n/a | bookings.couponWarning + Telegram |
| Processor | per-step fail | n/a | results.steps.{name} 확인 (`booking-processor-fail` Telegram) |
| Refund (user) | `NOT_FOUND/FORBIDDEN/INVALID_STATE/NO_REFUND_DIGITAL/NO_REFUND/LEGACY_BRAINTREE_BOOKING/REFUND_FAILED` | 403-502 | 정책 응답 |
| Refund (admin) | `AUTH_FAILED/NOT_FOUND/INVALID_STATUS` | 401-400 | admin token 확인 |
| Voucher | `MISSING_FIELDS/NOT_FOUND/FORBIDDEN/CANCELED/PDF_ERROR` | 400-500 | 정상 또는 PDF 생성 점검 |

---

## 📊 6. 예상 성공률 + 정상 노이즈 (100 plan 기준)

### Expected 성공률
- **AI 플래너**: ~90-95% `status:ready` 저장
- **Charter**: ~95-100% (TEST_ACCOUNTS bypass)
- **Tour**: ~95-100% (동일)

### 정상 retry / warning (각 ~5-15%)
- `B-12 stops < 4` 첫 시도 → retry 성공 (~5-10%)
- `B-18 local_tag` 미달 → SOFT 알림만 (10-20%)
- `unverified_restaurant` for Jeju/Gyeongju/Jeonju (DB 부족) — 최대 30%
- `RouteAgent 0 ODsay routes` (심야 시간대) — 가끔
- "Email failed" Gmail 일시 → retry — <1%

### 즉시 액션 (Critical)
- `DIETARY_VIOLATION` (1건이라도) → 환불
- `GEMINI_QUOTA` → batch 중단
- `PLAN_VALIDATION_FAILED` >5/h → circuit breaker activation

---

## ✅ 7. 운영자 모니터링 체크리스트 (100/10/10 실행 시)

### 7.1 실행 전 (env sanity)

| Env | 확인 사항 |
|---|---|
| `GEMINI_API_KEY` | set, quota ≥1000/day |
| `NAVER_CLIENT_ID/SECRET` | trim 없음 (`.trim()` 필수, P39 메모리) |
| `ODSAY_API_KEY` | set |
| `FIREBASE_PRIVATE_KEY` | len ~1700, `\n` 변환만 (NO trim) |
| `BRAINTREE_ENV` | preview = sandbox, prod = production |
| `ADMIN_BYPASS_EMAILS` | 2001leety@gmail.com 포함 |
| `VALIDATOR_BDC_ENABLED` | 미설정 또는 `true` |
| `VALIDATOR_BMEAL_ENABLED` | 미설정 또는 `true` |
| `ROUTE_TSP_ENABLED` | 미설정 또는 `true` |
| `PLANNER_AB_3PASS_PCT` | `10` (10% A/B) |
| `KRW_USD_RATE` | `1430` (SSOT) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | set |
| `GMAIL_USER` + `GMAIL_APP_PASSWORD` | set |
| `SENTRY_DSN` | set, `SENTRY_TRACES_SAMPLE_RATE=0.05` |

### 7.2 실행 중 (실시간 4-pane 모니터링)

**Pane 1 — Telegram app** (5채널 동시):
- `booking` 채널: 20+ booking 알림 도착 확인
- `dispatch` 채널: 10 charter 배차 알림
- `error` 채널: 0건 또는 1-2건 (정상 retry 후 silent)
- admin 채널 (operator-alerts): 환불/coupon warning 등

**Pane 2 — Sentry dashboard** (https://sentry.io):
- 마지막 1시간 events count
- tag `route:/api/ai-planner-full` 분포
- `planner_mode` 별 비율 (legacy 90% + 3pass 10%)

**Pane 3 — Vercel function logs** (grep patterns):
```
[planner] === START ===
[planner] env check: GEMINI_API_KEY: set(len=...)
[planner] Gemini: <ms>
[planner] 3-pass total: <ms>
[planner] qualityScore: N/100
[validator] B-MEAL Day N: foodStops=X lunch=Y dinner=Z times=[...]
[validator] B-DC ... (희귀, 0건 정상)
[Route] Day N: intra-day TSP reorder applied
[planner] 🚨 dietary_violation detected  ← critical
[planner] 🚨 pattern violation detected   ← retry trigger
[routeEnrich] summary — transit attached: N/M, geocoded: N/M
[booking-processor] 예약 처리 완료
[booking-processor] 일부 단계 실패
```

**Pane 4 — Admin pages** (실시간):
- `/admin/calendar` — booking onSnapshot live
- `/admin/payments` — pending_bookings
- `/admin/ops` (OpsHub) — dispatch + Telegram log feed
- `/admin/quality` — 정기 새로고침 (REST polling)

### 7.3 Firestore collections 모니터링

- `plans/{planId}` — 카운트 증가 (1 per AI plan success)
- `bookings/{orderID}` — booking 1 per charter/tour
- `used_paypal_orders/{orderID}` — idempotency 가드
- `error_log` — 5분 throttle 원 로그
- `telegram_throttle/{key}` — 활성 dedup 윈도우
- `api_stats/{YYYY-MM}/daily/{YYYY-MM-DD}` — fullCount/fullRevenue
- `admin_actions` — 어드민 액션 감사
- `couponWarning` 필드 (bookings 내) — race 발견 시

---

## 🛟 8. Circuit Breaker (비상 시)

5분 내 비활성 가능 (PR #412 + RUNBOOK `docs/RUNBOOK-ai-planner-validator-circuit-breaker.md`):

### Vercel Dashboard → Environment Variables 추가:
| 트리거 | env 추가 |
|---|---|
| `B-DC` false-positive 다발 | `VALIDATOR_BDC_ENABLED=false` |
| `B-MEAL` false-positive 다발 | `VALIDATOR_BMEAL_ENABLED=false` |
| TSP 가 의도 깸 | `ROUTE_TSP_ENABLED=false` |

→ Redeploy (~2분) → 즉시 비활성

**dietary (SAFETY-CRITICAL J) 는 절대 비활성 X** — 건강 위험.

---

## 🎯 9. 검증 시나리오 권장 (운영자 manual 검증)

### 9.1 AI 플래너 critical path (5 sample manual)
1. 5일 서울 + 부산 (다도시) + 비건 → Day count 5, lunch/dinner 모두 있음, dietary 100% vegan
2. 1일 제주 + 일반 → 단일일 lunch + dinner 둘 다
3. 3일 부산 + halal → halal restaurants 만, 돼지 0개
4. 7일 서울 + culture + food → 다양한 zone, late dinner 21시 OK
5. 2일 강릉 + special_request "경포대" → 명시 요청 처리

### 9.2 Charter critical path (3 sample manual)
1. ICN → 서울 staria_8 일반 (정상)
2. 5% 쿠폰 적용 → COCO5 사용 → 정산 KRW 95%
3. Custom matrix-miss (대전 → 광주) → InquiryForm

### 9.3 Tour critical path (3 sample manual)
1. 경주 day tour → 정상 booking
2. 24h cutoff edge → 23h59m 이전 = 200, 23h59m 이후 = 400 BOOKING_CLOSED
3. Voucher 재발급 → `GET /api/voucher?bookingID=&userEmail=` → PDF ≥10KB

### 9.4 환불 critical path (2 sample manual)
1. User self-serve cancel → `evaluateRefundPolicy` ratio 적용 → PayPal refund + Telegram triple alert
2. Admin mark-refunded (PayPal QR 케이스) → admin_actions audit + customer email

---

## 📚 10. 자율 검증 시스템 현황 (배포 완료)

### 10.1 Hard validators (위반 시 retry → 그래도 실패 시 throw 500)

| ID | 설명 | Env Flag (비활성) | PR |
|---|---|---|---|
| B-10 | Lodging bookend (첫/마지막 lodging) | — | legacy |
| B-12 | Min 4 stops per day | — | legacy |
| B-13 | Multi-city lodging city match (4-layer fallback) | — | #368 |
| B-LCC | Lodging_city consistency | — | PDF-issue-3 |
| B-14 | start_time hour < 24 | — | legacy |
| B-15 | Last day airport stop | — | legacy |
| B-16 | Arrival/departure_guide.airport | — | legacy |
| **B-DC** | **Day count match (durationDays)** | `VALIDATOR_BDC_ENABLED=false` | **#407** |
| **B-MEAL** | **Lunch [11,15) + Dinner [17,22) per full day** | `VALIDATOR_BMEAL_ENABLED=false` | **#407 / #410 / #412** |

### 10.2 Soft warnings (telegram alert 만, plan 저장 O)

| ID | 설명 | PR |
|---|---|---|
| B-18 | local_tag 다양성 ≥ 30% | legacy |
| dietary_violation 회피 후 OK | — | legacy |
| lodging_bookend_violation | RouteAgent 5km | — |

### 10.3 자동 회귀 슈트 (`tests/unit/responseValidator.test.ts`, `routeAgent-intra-day-tsp.test.ts`)

- 65 cases (validator) + 12 cases (TSP) — **B-DC/B-MEAL/TSP chronological 모두 포함**
- 전체 unit suite: **540 PASS** + 7 todo

### 10.4 도구: Intra-day TSP (R-TSP, PR #409 + #413)

- Haversine nearest-neighbor (forward / backward / original 중 min)
- **chronological 보존** (PR #413, P41 fix)
- lodging bookend 보존
- 좌표 누락 시 원본 fallback
- **한계 (P39)**: Haversine ≠ 실제 도로 거리. Yeongdo(섬)↔Gwangalli (다리 우회) 케이스 미해결. 후속 ODsay 실거리 캐시 필요.

---

## 📋 11. 알려진 알림 갭 (Agent C 발견)

1. **Frontend Sentry는 PROD 만** — preview 검증 시 frontend 에러 silent
2. **Email send 실패는 5분 throttle** — 동일 메시지 hourly 1회만 (10 plan 실패해도 1 메시지)
3. **TSP reorder는 alert 경로 없음** — `console.log` 만. `ROUTE_TSP_ENABLED=false` env flag로 비상 비활성
4. **chat.js/inquiry는 throttle 없음** — 봇 루프 risk (희귀)
5. **`_food_index.json` 매칭 0건 알림 없음** — qualityScore 통해 next-day 발견

---

## 🔬 12. 오답노트 / 메타 학습 (이번 cycle 신규)

`feedback_mistake_log.md` 등록:
- **P37** — Validator hard validation 갭 (prompt 명시되지만 강제 X)
- **P38** — CI 워커 직렬 timeout (workers 병렬화 first resort)
- **P39** — TSP Haversine ≠ 실제 도로 거리 (섬/강 우회)
- **P40** — Validator boundary too tight (false-positive 자기 회귀)
- **P41** — TSP reorder 가 chronological 깨면 PDF 시간 jumbled
- **P42** — branch protection required check + paths-ignore = docs-only PR BLOCK

---

## 🎬 13. 최종 권장 사항

### 즉시 (운영자 수행)
1. PR #416 머지 → preview URL 자동 생성
2. 브라우저로 preview 접속 + Firebase ID 토큰 추출
3. `node scripts/verify-prod-system-check.mjs` 실행
4. 실시간 4-pane 모니터링 (Telegram/Sentry/Vercel logs/Admin pages)

### 24h 모니터링 (실행 후)
- Telegram alert 빈도 임계 (>5/hour) 감지 시 → circuit breaker
- Sentry 신규 패턴 발견 시 → 새 오답노트 등록 + fix PR

### Phase 2 (향후, 우선순위)
1. **RouteAgent ODsay 실거리 캐시** — P39 (Yeongdo↔Gwangalli) 해결
2. **frontend Sentry preview 활성** — 검증 환경 에러 트래킹
3. **Email send 실패 alert 강화** — 5분 throttle 우회 또는 운영자 dashboard 정기 조회
4. **TSP reorder alert 경로 추가** — 의도치 않은 reorder 가시화

### Phase 3 (장기)
- `_food_index.json` Jeju/Gyeongju/Jeonju 보강 (Phase 6 from CocoTrip 로드맵)
- Sentry trace sampling 비용 검토 (현재 5%)
- B-MEAL/B-DC 데이터 축적 후 boundary 추가 튜닝

---

## 📎 14. 참조 문서

- 운영자 비상 매뉴얼: `docs/RUNBOOK-ai-planner-validator-circuit-breaker.md` (PR #414)
- 자율 검증 시스템: `feedback_systemize_over_fix.md` (메모리)
- 오답노트 패턴: `feedback_mistake_log.md` (메모리, P1-P42)
- 아키텍처: `docs/ARCHITECTURE-{frontend,backend,admin}.md`
- 결제 audit: `docs/PAYMENT-AUDIT-PHASE{1,2,3,4}.md`

---

**검증 보고서 끝**

Claude 측 작업 완료 — 실 prod 100/10/10 실행은 운영자 단계.
