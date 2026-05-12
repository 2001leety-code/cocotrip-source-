# CocoTrip 회귀 테스트 슈트 운영 가이드

## 목적

Gemini 비결정성으로 같은 fix 가 일부 plan 에서 회귀 재발하는 문제 + 사용자 prod 시각 검수 의존도를 자동 assertion 으로 대체.

오늘까지 받아적기 항목들 (B-1 ~ B-15) 은 모두 운영자가 prod 페이지를 눈으로 확인해야만 발견됐음. PR 머지 전 자동 검증 필요.

**2026-05-12 L2 확장 (B-16/B-17/B-18):** 구조 검증(B-2 ~ B-15) 외 PDF 사전조건/가격
합리성/다양성 지표 3개 차원 추가. 자율 검증 v1 의 Auto-Regression 단계 강화.

## 실행 방법

### 1) 로컬 실행 (prod 대상)

```bash
# .env.local 에 secrets 가 있어야 함:
#   HEALTH_CHECK_EMAIL=<admin 계정>
#   HEALTH_CHECK_PASSWORD=<admin 비밀번호>
# .env 에 VITE_FIREBASE_API_KEY 존재.

node scripts/validate-prod-regression.mjs

# 다른 base URL 대상 (preview SSO 우회 후):
BASE_URL=https://my-pr-preview.vercel.app node scripts/validate-prod-regression.mjs
```

Exit code:
- `0` — 15/15 PASS
- `1` — 1건 이상 FAIL

### 2) CI 자동 실행 (PR 라벨 trigger)

PR 에 `ready-for-regression` 라벨 추가 → `pr-regression.yml` workflow trigger.
실행 후 PR 댓글로 결과 자동 게시. FAIL 시 머지 차단.

### 3) GitHub Secrets (CI 작동을 위해 운영자 1회 등록 필요)

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret 이름 | 값 |
| --- | --- |
| `FIREBASE_WEB_API_KEY` | `.env` 의 `VITE_FIREBASE_API_KEY` 값 |
| `HEALTH_CHECK_EMAIL` | admin 계정 이메일 (TEST- prefix 바이패스 권한 보유 — 2001leety@gmail.com 또는 헬스체크 전용 계정) |
| `HEALTH_CHECK_PASSWORD` | 위 계정 비밀번호 |

## 받아적기 15항목 가설/증상/검증법

각 항목은 prod 에서 실제 발견된 버그 클래스. 회귀 발생 시 fix 후 동일 assertion 으로 영구 가드.

### B-2 — 다도시 stops 분배

- **가설:** 사용자가 `regions: ['seoul', 'busan']` 입력했는데 한 도시 stop 만 생성.
- **증상:** PlanDetailPage 에서 Day 1-5 모두 서울만, 부산 stops 0개.
- **검증:** `stops[*].address` 한글 도시 keyword (서울/부산) 카운트 → 둘 다 > 0.
- **회귀 위험:** Gemini 가 두 번째 도시 무시. 또는 `recommendedZones` 만 첫 도시 처리.

### B-3 — 추천 식당 region 균등

- **가설:** `itinerary.recommended_restaurants` 가 한 도시로만 편중.
- **증상:** 부산 갔는데 부산 식당 추천 0건, 모두 서울 식당.
- **검증:** `r.region` 카운트 → seoul >= 1 AND busan >= 1, 차이 <= max.
- **회귀 위험:** `pickRecommendedRestaurants` 가 region 분배 X. food index 데이터 부족.

### B-6a — Day 5 출력

- **가설:** `durationDays: 5` 인데 응답에 4일치만 들어옴.
- **증상:** PlanDetailPage 에 Day 4 까지만 표시, 출국일 행 없음.
- **검증:** `days.length === 5`.
- **회귀 위험:** Gemini 가 마지막 day 누락. JSON 파싱 fail. validateResponse 가 truncate.

### B-9 — 다도시 intercity_transit 존재

- **가설:** `regions: ['seoul','busan']` 인데 도시 간 이동 (KTX/버스/항공) 안내 누락.
- **증상:** Day 3 city=Busan 으로 바뀌었는데 어떻게 서울 -> 부산 이동했는지 안내 X.
- **검증:** days 중 어느 하나라도 `intercity_transit` 객체 존재 (mode/est_min/instruction 등).
- **회귀 위험:** Gemini 가 region 전환 인지 X. buildPrompt 의 intercity_transit 강제 약화.

### B-7 — transit_from_prev 채움률

- **가설:** stop 간 이동 정보 (transit) 가 일부만 채워짐.
- **증상:** PDF 에 "이동: 15분" 같은 transit hint 가 한두 stop 만 표시.
- **검증:** 첫 stop 제외 모든 stop 의 `transit_from_prev` (또는 `transit`) 존재 비율 >= 80%.
- **회귀 위험:** RouteAgent.js silent swallow (try/catch 무음 fail). ODsay API 키 expired. Naver Geocoding rate limit.

### B-8 — 봉고차 없음 (Staria 통일)

- **가설:** 차량명이 "봉고" 로 표시. (cocotripkr 는 Staria/Sprinter/Bus 만 사용)
- **증상:** PDF / 이메일 / 응답 어디든 "봉고" 단어 등장.
- **검증:** `JSON.stringify(response).match(/봉고/g) === null`.
- **회귀 위험:** Gemini 가 한국 차종 사전 지식으로 "봉고" 라고 자체 작성. vehicle override 가 깨짐.

### B-10 — Day별 lodging bookend

- **가설:** Day 첫 stop 이 lodging (호텔/숙소) 이 아닌 관광지로 시작.
- **증상:** Day 1 첫 stop 이 "북촌 한옥마을" — 짐 어디 둠? 사용자 동선 X.
- **검증:** 모든 day 의 `stops[0].category === 'lodging'`.
- **회귀 위험:** buildPrompt.js 의 lodging 강제 prompt 약화. Gemini 가 무시.

### B-11 — ODsay source 비율

- **가설:** transit 모드가 모두 "car/private" 만 — 대중교통 안내 부재.
- **증상:** 외국인 사용자가 지하철/버스 옵션 못 봄. ODsay API 결과 미반영.
- **검증:** transit 의 mode 가 subway/bus/walk/transit/metro 비율 >= 50%.
- **회귀 위험:** ODsay API 키 만료. RouteAgent 가 ODsay 결과 throw away.

### B-12 — Day별 stops >= 4

- **가설:** Day 5 (출국일) 외에 stops 가 너무 적음.
- **증상:** Day 3 = 1 stop. 사용자가 "왜 이렇게 한가해?" 컴플레인.
- **검증:** 각 day 의 `stops.length >= 4`, 단 마지막 day (출국일) 는 >= 2 완화.
- **회귀 위험:** Gemini 가 day 분배 실패. lodging 추가하면서 다른 stop 제거.

### B-13 — 도시 전환 day lodging name 매칭

- **가설:** 서울 → 부산 전환 day 의 lodging 이 서울 호텔로 잘못 매칭.
- **증상:** Day 3 city=Busan 인데 lodging 주소가 "서울특별시...".
- **검증:** lodging stop 의 name 또는 address 가 `day.city` 한글명 포함.
- **회귀 위험:** Gemini 가 도시 전환 인지 못함. address fallback 이 첫 도시 사용.
- **백엔드 가드 (2026-05-12):** `validatePatternStructure` 가 다도시 plan(regions.length≥2)
  + day.city 명시된 day 의 첫 lodging stop name/address 가 day.city (영문 또는 한글 alias)
  포함 여부 검증. 위반 시 1회 retry → 그래도 위반이면 plan 저장 차단.

### B-14 — 모든 stop start_time < 24:00

- **가설:** `start_time` 이 "25:30" 같은 invalid 값.
- **증상:** UI 가 시간 정렬 fail. NaN 표시.
- **검증:** `HH:MM` 정규식 + h<24, mm<60.
- **회귀 위험:** Gemini 가 다음날 일정을 "26:00" 으로 표기 (잘못된 시간 연속성).

### B-15 — 출국일 공항 stop 또는 transit

- **가설:** 출국일 마지막에 공항 이동 stop/안내 누락.
- **증상:** Day 5 마지막 stop 이 점심 식당, 공항 어떻게 가지?
- **검증:** 마지막 day 의 stops 중 category='airport' 또는 'travel', 또는 name/address 에 공항/airport/ICN/GMP/PUS/CJU 토큰 포함. 또는 day-level meta (return_to_airport / airport_transfer) 또는 마지막 stop transit_to_airport.
- **회귀 위험:** Gemini 가 출국 시각 (departureTime) 이전에 일정 종료 후 공항 transfer 안내 skip.
- **백엔드 가드 (2026-05-12):** `validatePatternStructure` 가 회귀 슈트와 동일 기준 적용 (category travel/airport, 공항 토큰, day-level meta, transit_to_airport). 위반 시 retry → 차단.

### B-16 — PDF 생성 사전조건

- **가설:** PDF 표지/마지막 페이지 필수 필드 (`tour_title`, `departure_guide`, `arrival_guide.airport`, `planId`) 누락 시 클라이언트 PDF 렌더 일부 칸 빈칸 출력.
- **증상:** PlanDetailPage 에서 PDF 다운로드 후 표지 제목 비어있음. 마지막 페이지 출국 안내 누락. 또는 `planId` 누락 시 plan URL 공유 X.
- **검증:** PDF 자체는 client-side 라 직접 렌더 검증 불가. 백엔드 측 사전조건만 검증 — 4개 필드 모두 truthy + arrival_guide.airport 가 request body arrivalAirport (ICN) 포함.
- **회귀 위험:** Gemini prompt 에서 표지/출국 안내 필드 약화. `data.planId` 응답 누락. arrival_guide 가 다른 공항 코드 반환.

### B-17 — 가격 데이터 구조 합리성 (2026-05-12 logic 수정)

> **수정 사항**: 초안의 "daily_budget 합산 ≈ total_cost (diff ≤ 20%)" 는 잘못된 가정. `total_cost_krw` 는 차터 차량 base_price (Staria ₩330K 등), `daily_budget_summary` 는 일별 잡비 (entry fees + meals + activities + shopping) — 둘은 같을 필요 없는 별도 항목. **자율 검증 1차 가동에서 자동 감지** → 즉시 fix.

- **가설:** `daily_budget_summary` 가 day 수와 맞지 않거나 일부 day 가 0 또는 base_price 누락.
- **증상:** PDF/이메일에 일별 잡비 일부 비어있음. 사용자 "이 날은 비용 없나?" 컴플레인.
- **검증** (새 logic):
  - `daily_budget_summary.length === days.length` (일 수 일치)
  - 각 day `total_krw > 0` (빈 day 없음)
  - `base_price_krw > 0` (차량비 데이터 존재)
- **회귀 위험:** Gemini 가 day 일부 누락하고 daily_budget 만 4일치 출력. price calculator silent fail. 통화 변환 (KRW ↔ USD) 일관성 깨짐.

### B-18 — 다양성 지표 (unique stop name + local_tag)

- **가설:** Gemini 가 같은 stop 을 여러 day 에 반복 출력. local_tag (Local Pick / Hidden Gem / Bakery Pilgrimage / Blue Ribbon) 누락 — 차별화 카피 부재.
- **증상:** Day 1·3·5 모두 "경복궁" 반복. 모든 식당이 평범 — "Local Pick" 라벨 없음. 사용자가 "AI 가 짠 거 같지 않다" 평가.
- **검증:**
  - unique ratio = `new Set(names).size / names.length` ≥ 70%
  - local_tag ratio = `(local_tag ∈ valid set).count / names.length` ≥ 30%
  - 둘 다 만족 시 PASS
- **회귀 위험:** Gemini prompt 의 diversity rule 약화. local_tag 사전 (4개 값) 변경 시 기준 갱신 필요. dbMatcher 가 매칭 못 한 stop 의 local_tag 누락.

## 새 회귀 추가 절차

prod 에서 새 회귀가 발견되면:

1. fix PR 작성 + 머지
2. `scripts/validate-prod-regression.mjs` 에 `results.push({ id: 'B-NN', ... })` 1개 추가
3. 이 README 에 B-NN 항목 가설/증상/검증법 추가
4. 별도 PR 로 슈트만 업데이트 (`chore(regression): add B-NN ...`)

## 운영 모드

- PR 머지 전 워크플로우 `ready-for-regression` 라벨 부착 → 1회 실행 (15 assertion) → PR 댓글 결과 확인 → PASS 시 머지.
- 비용: PR 1개당 Gemini API 1회 호출 ($0.02 추정) + GitHub Actions 5분.
- 라벨 없으면 실행 X — 명시적 opt-in.

## 알려진 한계

- **API response 만 검증** — PDF 페이지 분배, 인쇄 영역, html2canvas 렌더 결과는 미포함.
  - 추후 별도 PR 로 Playwright headless + `page.evaluate(generatePDF)` 자동화 가능 (CLAUDE.md B-3 의 all-white 가드 우회).
- **Gemini 비결정성** — temperature=0.95 라 1회 실행으로 100% 보장 X. 통계적으로 회귀 패턴 검출에는 충분.
- **prod 직접 호출** — preview SSO 통과 자동화 미구현. `BASE_URL` env 로 수동 override 가능하지만 SSO 우회는 별도 작업.

## 시나리오 매트릭스 (L2, 2026-05-12 도입)

`pr-regression` 1 시나리오 (서울+부산 5일 ko) 만으로는 다양한 user input 조합 회귀를
잡지 못한다는 한계. `.github/workflows/scenario-matrix.yml` 가 주간 1회 6 시나리오를
prod 대상 실행하여 단도시/다도시/4-lang/dietary/공항 조합 회귀를 자동 검출.

### 6 시나리오

| 시나리오 | regions | duration | lang | dietary | arrival |
| --- | --- | --- | --- | --- | --- |
| `seoul-only-ko-3d` | seoul | 3 | ko | - | ICN |
| `busan-only-en-3d` | busan | 3 | en | - | PUS |
| `jeju-only-ja-4d` | jeju | 4 | ja | - | CJU |
| `seoul-busan-zh-5d` | seoul,busan | 5 | zh | - | ICN |
| `seoul-halal-en-4d` | seoul | 4 | en | Halal | ICN |
| `seoul-vegan-ja-3d` | seoul | 3 | ja | Vegan | ICN |

### env 매개변수 (scripts/validate-prod-regression.mjs)

`SCENARIO_NAME` / `SCENARIO_REGIONS` (comma split) / `SCENARIO_DURATION` /
`SCENARIO_LANG` (ko|en|ja|zh) / `SCENARIO_DIETARY` (comma split, 빈 값 OK) /
`SCENARIO_ARRIVAL_AIRPORT` (ICN|GMP|PUS|CJU). 모두 미설정 시 기존 hardcoded 값
(`seoul,busan` / 5 / ko / Meat / ICN) 으로 fallback → daily-health / pr-regression
호환 유지.

### 조건부 assertion (단일 region 시나리오)

다음 항목은 `regions.length === 1` 시 자동 skip (PASS 로 카운트):
- B-2 (다도시 stops 분배)
- B-3 (추천 식당 region 균등)
- B-9 (intercity_transit KTX 등)
- B-13 (도시 전환 day lodging 매칭)

### 실행 방법

```bash
# 단일 시나리오 로컬 실행
SCENARIO_NAME=seoul-only-ko-3d \
SCENARIO_REGIONS=seoul \
SCENARIO_DURATION=3 \
SCENARIO_LANG=ko \
SCENARIO_ARRIVAL_AIRPORT=ICN \
  node scripts/validate-prod-regression.mjs

# CI 자동 실행: 일요일 01:00 UTC = KST 10:00 (주간 1회)
# 수동: GitHub → Actions → "Scenario Matrix (weekly)" → Run workflow
```

### 비용

- Gemini: 6 call/week ≈ $0.12/week ≈ $0.50/월
- GitHub Actions: 6 × ~5분 = ~30분/주 = ~2시간/월 (무료 한도 내)
- 실패 시 issue 자동 생성 (label `regression,scenario-matrix`)

## 결제 회귀 슈트 (validate-prod-payment.mjs)

**도입 (2026-05-12 자율 검증 v2 P0)** — 현재 결제 흐름 회귀 검출 0건/일 (사용자가 결제
fail 신고해야만 알 수 있음 → 사후 발견). PR 머지 전 자동 8 assertion 으로 PayPal 결제
endpoint / webhook / 쿠폰 정책 회귀 자동 검증.

**Braintree/Toss 제외** — 운영자 명시 (2026-05-06, PayPal 단일 정책 확정).

### 실행 방법

```bash
# 로컬 실행 (.env.local secrets 필요)
node scripts/validate-prod-payment.mjs

# CI: PR 에 'ready-for-payment-regression' 라벨 → pr-payment-regression.yml trigger
```

### 8 assertion 가설/증상/검증법

#### B-PAY1 — PayPal SDK script 로드

- **가설:** PayPal Smart Buttons SDK CDN (`paypal.com/sdk/js`) 가 차단되거나 client-id
  rotated 후 prod 미반영.
- **증상:** 결제 페이지에서 PayPal 버튼 렌더 실패 → "결제 수단을 불러올 수 없습니다".
- **검증:** `https://www.paypal.com/sdk/js?client-id=${VITE_PAYPAL_CLIENT_ID}&currency=USD`
  200 + content-type javascript. env 미설정 시 skip + warning.
- **회귀 위험:** VITE_PAYPAL_CLIENT_ID rotate 후 Vercel env 갱신 누락. PayPal API 키 만료.
  네트워크 차단 (한국 환경 5/6 batch 이슈).

#### B-PAY2 — createPaypalOrder endpoint

- **가설:** order 생성 endpoint 의 입력 검증 회귀. AI 플래너 + 쿠폰 reject 정책 (2026-05-05
  운영자 정책: AI 플래너 = 디지털 상품 = 모든 쿠폰 reject) 회귀.
- **증상:** AI 플래너 결제에 5% 쿠폰 적용되어 13,300원 → 12,635원 결제 — 운영자 수익 손실.
- **검증:**
  - case A: productType 누락 → 400 MISSING_FIELDS
  - case B: AI 플래너 + promoCode → 400 AI_PLANNER_NO_COUPON
- **회귀 위험:** AI 플래너 쿠폰 reject logic 제거. 검증 순서 swap (productType 검증 후 쿠폰
  검증으로 순서 변경 시 우회 가능).

#### B-PAY3 — Manual payment request

- **가설:** 한국 체류 외국인의 PayPal QR 수동 결제 신고 endpoint
  (`/api/manual-payment-request`) 회귀. pending_bookings Firestore 저장 실패 또는
  bookingRef 검증 약화.
- **증상:** 사용자가 [결제 완료 신고] 누르면 500 또는 silent fail → 운영자 텔레그램 알림
  못 받음 → 입금 매칭 X.
- **검증:** POST → status 200 + ok=true + bookingRef pattern (CT-YYYYMMDD-XXX) 통과.
  admin email 인증 시 즉시 CONFIRMED + adminBypass=true. 일반 사용자는 AWAITING_VERIFICATION.
- **회귀 위험:** BOOKING_REF_PATTERN 정규식 회귀. Firestore admin 초기화 fail.
  ADMIN_BYPASS_EMAILS 누락.

#### B-PAY4 — 5% 쿠폰 productScope

- **가설:** charter / tour-package 만 적용 가능한 5% 쿠폰이 AI 플래너에도 적용되거나 그 반대.
  운영자 정책: COCO5 (글로벌) = charter+tour만, AI 플래너 = reject.
- **증상:** AI 플래너 결제 화면에서 COCO5 입력하면 5% 할인 적용 (잘못된 동작).
- **검증:** applyPromoCode + COCO5 + charter productType → valid:true. AI 플래너는
  createPaypalOrder 단에서 reject (B-PAY2 caseB 와 layered 검증).
- **회귀 위험:** couponMatchesProduct() logic 회귀. productScope 검증 path swap.

#### B-PAY5 — Trip Coins redeem percent

- **가설:** Trip Coins 쿠폰 (회원가입 보너스) 가 fixed-USD type 으로 잔존하면 환율 변동에
  취약 + 백오피스 운영 복잡. PR #270 마이그레이션 후 percent type 으로 통일.
- **증상:** USD 5 고정 쿠폰 → 환율 1380 → 6,900 KRW 할인 (예상 5% 와 다름).
- **검증:** users/{uid}/coupons 조회 — 모든 entry type='percent'. 현재 직접 검증 endpoint
  부재로 soft check (코드 logic 잔존 확인만).
- **회귀 위험:** 신규 쿠폰 발급 endpoint 가 fixed-USD type 으로 생성. 마이그레이션 스크립트
  실수.
- **격상 경로:** `/api/admin-coupon-audit` endpoint 추가 후 정식 검증으로 격상.

#### B-PAY6 — Webhook idempotency

- **가설:** PayPal webhook 같은 transmission-id 재시도 시 중복 처리 → 같은 booking 에 두
  번 confirm → bookings status race / 텔레그램 중복 알림.
- **증상:** 한 결제에 [입금 확인 ✅] 알림 2회 발사.
- **검증:** 같은 transmission-id 로 2회 POST → 응답 status / body 일관. 정상 처리 path 면
  paypal_webhook_log/{eventId} 가 1건만 생성 (직접 Firestore 검증 불가하므로 응답 일관성만).
- **회귀 위험:** logRef.get() 체크 누락. status='processed' 갱신 누락.

#### B-PAY7 — Webhook signature verify

- **가설:** PayPal verify-webhook-signature API 우회 가능. 잘못된 signature header 로 POST
  해도 처리됨.
- **증상:** 공격자가 가짜 PAYMENT.CAPTURE.COMPLETED webhook 발사 → 미결제 booking 이
  CONFIRMED 처리 → 무료 투어.
- **검증:** 잘못된 signature → 401 또는 PAYPAL_WEBHOOK_ID 미설정 503. 200+ok:true 면 fail.
- **회귀 위험:** verifyWebhookSignature() 호출 누락. PAYPAL_WEBHOOK_ID env 미설정 묵음 통과.

#### B-PAY8 — 환불 흐름

- **가설:** PAYMENT.CAPTURE.REFUNDED webhook 처리 path 회귀. bookings status='REFUNDED'
  전환 안 됨 → 운영자가 PayPal 환불했는데 시스템상 CONFIRMED.
- **증상:** 환불 후에도 텔레그램 배차 알림 / 영수증 이메일 발송.
- **검증:** REFUNDED event_type 으로 webhook 호출 → 401/503/200(unmatched) 응답 (env
  설정에 따라). unsupported 분기 진입 시 fail.
- **회귀 위험:** event_type 분기 회귀. extractRefundedCaptureId() links 파싱 fail.

### 운영자 후속 액션 (Secrets 등록 시 active)

- **GitHub Secrets**:
  - `VITE_PAYPAL_CLIENT_ID` 추가 → B-PAY1 SDK 로드 검증 활성화 (현재 skip+warning)
- **Vercel env (이미 등록)**:
  - `PAYPAL_WEBHOOK_ID` → B-PAY6/7/8 signature verify 정식 검증 (현재 503 fallback)
- **admin endpoint 추가 시**:
  - `/api/admin-coupon-audit` → B-PAY5 정식 검증으로 격상
