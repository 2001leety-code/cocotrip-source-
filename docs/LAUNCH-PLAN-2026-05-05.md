# Launch Plan — 2026-05-05 (CocoTrip 상용화)

> 작성: 2026-05-05 · 결제 영역 보류 (PayPal 답장 + Toss Payments 신청 대기) · 비결제 6개 항목 + 누적 큐 통합 계획

## 결제 보류 영역 (이 PR 범위 외)

PayPal 한국 정책 답변 대기 + Toss Payments 내일 신청 → 다음 항목은 **이번 launch 에서 손대지 않음**:

- P1-B Vercel env Production/Preview/Dev Braintree 키 분리
- D Charter/Tour 환불 검증 sandbox 4-시나리오
- E UI 쿠폰 텍스트 mismatch (#6 signup coupon 작업으로 자연 해결됨)
- Live 전환 (Phase 0~5)
- `cancelBooking` API + Braintree refund 흐름

## 운영자 신규 지시 6 항목

### #1 — Wizard 호텔 질문 중복 제거 (page 2 + page 4 → page 4 만)

**현 상태** (`src/components/WizardForm/`):
- Step 0 Reservation (page 2): `status === 'flight_hotel'` 시 호텔 주소 인풋 노출 (line 50-95)
- Step 2 Details (page 4): `hotelInfoFromStep0` chip 으로 dedup 처리 시도 중 (line 132-138)
- 사용자 인지: 같은 질문 두 번 받는 느낌 → 혼란

**연결**: #3 의 `flight_hotel` / `all_done` 옵션 제거 → 자동 dedup. Step 0 단순화 후 Step 2 만 호텔 질문.

**파일**:
- `src/components/WizardForm/WizardStep0Reservation.tsx` — `flight_hotel` / `all_done` 옵션 + hotelAddress 인풋 제거 (status 옵션을 `nothing` / `flight` 만 남김)
- `src/components/WizardForm/WizardStep2Details.tsx` — `hotelInfoFromStep0` 가드 단순화 (dead code 정리)
- `src/components/WizardForm/index.tsx` — `hotelAddress` state 흐름 검증

**노력**: 1.5시간 · 위험 low

---

### #2 — 호텔 → 공항 ODsay 경로 무조건 표시

**현 상태**:
- `api/_ai_core/agents/RouteAgent.js:162-167` — `_routeAirportHotel(hotelLatLng, airport, 'departure')` 호출 후 `rawItinerary.departure_guide.route_to_airport` 에 저장
- `src/pages/PlanDetailPage/components/DepartureGuide.tsx:19` — `guide.route_to_airport` 가 있을 때만 ODsay 경로 렌더링
- `api/_ai_core/buildPrompt.js:145-180` — Gemini 프롬프트에 `departure_guide` 스키마 명시 (Gemini-derived `to_airport` 정보 + RouteAgent 가 ODsay 데이터로 덮어쓰기)

**진단 — 표시 안 되는 시나리오**:
1. `data.departure_airport` 미입력 → arrival airport 으로 fallback (line 146 `|| arrivalAirportKey`) — 정상 작동
2. `hotelLat && hotelLng` 없음 → 사용자가 hotel 미입력 + zone 도 미선택 → route 생성 불가
3. ODsay API timeout / failure → silent fail (route undefined) → DepartureGuide 가 텍스트만 표시

**Fix 방향**:
- (a) Hotel 미입력 + zone 도 없음 → 도시 중심 좌표 fallback (예: 서울 시청 좌표) 강제
- (b) RouteAgent ODsay 호출 실패 시 retry 1회 + 재실패 시 admin Telegram 경고
- (c) DepartureGuide 컴포넌트 — `route_to_airport` 없어도 "공항으로 가는 길" 섹션 보여주되 "ODsay 경로 데이터 일시 누락 — admin 알림 발송" 로 안내
- (d) 투어 플랜 (charter)의 동일 경로 표시 로직 재사용 — 이미 안정적으로 작동 중인 패턴

**파일**:
- `api/_ai_core/agents/RouteAgent.js` — fallback 좌표 추가, retry + 경고
- `api/_ai_core/buildPrompt.js` — Gemini 프롬프트 강화 (departure_guide.to_airport 항상 포함 강제)
- `src/pages/PlanDetailPage/components/DepartureGuide.tsx` — route_to_airport 없을 때의 graceful display
- `api/_odsay_helper.js` — searchTransitRoute timeout/retry 보강

**노력**: 4-6시간 · 위험 medium (외부 API 의존)

---

### #3 — "이미 항공권 + 호텔 예약하셨나요? 플랜 무료 받기" 제거

**현 상태**:
- `src/components/WizardForm/WizardStep0Reservation.tsx:13,44,150` — `all_done` 옵션 + claim 핸드오프 ("Continue to free claim form")
- `src/components/PendingClaimsWidget.tsx` — `pending_free_claims` Firestore collection
- `src/pages/PlannerPage/components/FreeClaimForm.tsx` — claim form
- `src/pages/PlannerPage/components/PurchaseSection.tsx` — bundle toggle
- `src/i18n/locales/ko.json:1131,1136,1139` — `bundleToggleTitle`, `alreadyBookedFlight`, `alreadyBookedHotel`
- Firestore: `pending_free_claims` collection (기존 데이터 정리 정책 결정 필요)

**삭제 범위**:
- Wizard Step 0 의 `flight_hotel` / `all_done` 옵션 + 관련 UI 분기 (#1 과 묶음)
- FreeClaimForm + PendingClaimsWidget 엔트리 + 라우팅
- BraintreePaymentButton 하단의 bundle toggle CTA
- i18n 4-lang (`bundleToggleTitle`, `alreadyBookedFlight`, `alreadyBookedHotel`, `resAllDoneTitle`, `resAllDoneSub`, `resGoClaim`) 4개 locale 동시 제거
- Firestore `pending_free_claims` 콜렉션 관련 백엔드 endpoint 가 있다면 410 Gone 처리

**Firestore cleanup**: 기존 데이터 archive 정책 결정 — admin export 후 collection drop, 또는 그냥 둠 (읽기 코드 다 삭제 → orphan).

**파일** (예상 6-8개):
- WizardStep0Reservation, PendingClaimsWidget, FreeClaimForm, PurchaseSection, i18n × 4
- 라우터 (App.tsx) 에서 FreeClaim 라우트 제거

**노력**: 2-3시간 · 위험 medium (i18n 누락 시 missing key 콘솔 에러)

---

### #4 — Wrap-up 섹션 인라인 예약 (외부 redirect 제거)

**현 상태** (`src/pages/PlanDetailPage/components/OutroSlide.tsx:84-87` + `components/ads/`):
- `HotelAd` — 외부 호텔 예약 링크
- `FlightAd` — 외부 항공권
- **`CharterBanner`** — `<a href={waUrl}>` (WhatsApp 외부 링크)
- `CarRentalAd` — 외부 렌터카

**운영자 비전**:
- 사이트 떠나지 않고 인라인 예약
- **차터** 내용 — 사용자 region 기준 (서울 → 서울 zone 만 표시 + 서울 요금만)
- 공항 픽업 / 투어 같은 패턴

**구현 설계**:

```
OutroSlide.tsx
  └── <InlineBookingPanel region={plan.region} stops={plan.itinerary.days} />
       ├── 탭: [전세차량 | 공항픽업 | 투어]
       ├── 차터 탭:
       │     ├── ZonePicker (region 필터, 예: region='seoul' → 서울 25 zones만)
       │     ├── DatePicker (plan.startDate / plan.endDate prefill)
       │     ├── VehicleSelect (passengers from plan)
       │     ├── PriceMatrix (region-scoped)
       │     └── BraintreePaymentButton (productType='charter')
       ├── 공항픽업 탭:
       │     └── 동일 패턴 (productType='airport-pickup')
       └── 투어 탭:
             └── 동일 패턴 (productType='tour-package')
```

**의존성**:
- 기존 `src/pages/CharterNewPage.tsx` 의 wizard 로직 재사용
- `src/data/zoneData.ts` (지역별 zone 데이터) region 필터링
- `src/data/pricing.ts` (요금 매트릭스) region-scoped query

**파일** (신규 4-6개 + 수정 2-3개):
- 신규: `InlineBookingPanel.tsx`, `InlineBookingTabs.tsx`, `InlineCharterForm.tsx`, `InlineAirportPickupForm.tsx`, `InlineTourForm.tsx`, `useRegionScopedZones.ts`
- 수정: `OutroSlide.tsx` (extras 배열 → InlineBookingPanel 으로 교체), `CharterBanner.tsx` 등 광고 컴포넌트 deprecate
- i18n 4-lang × 신규 키 ~30개

**노력**: 1.5-2일 · 위험 high (가장 큰 신규 surface)

**런칭 시점 옵션**:
- A) 풀구현 후 launch (Day 3 까지)
- B) Day 1 launch 시점에는 외부 링크 그대로 유지, Day 3-5 에 인라인 변경 (post-launch follow-up)
- **권장: B 안** — launch blocker 아니므로 후속 처리

---

### #5 — 식당 리스트 10가지/스타일 복원 (regression)

**현 상태**:
- `api/_ai_core/recommendedRestaurants.js:34-35` — `MAX_DIST_KM=5, TARGET_COUNT=10` (코드 자체는 살아있음)
- `:94` — `if (entry.tag !== 'general') continue;` — **vegan/halal 태그 식당 제외** (운영자 의도와 불일치)
- 결과: 사용자가 vegan/halal 선택해도 일반 식당 10개만 받음

**운영자 비전 (재해석)**:
- "각종 원하는 음식스타일에 맞는 맛집 리스트 10가지씩" = 사용자 선택한 dietary 별 10개씩
- 예: vegan 선택 시 → vegan 10개 + general 10개 = 20개
- 예: halal + vegan 선택 시 → halal 10개 + vegan 10개 + general 10개 = 30개

**Fix 설계**:

```js
// api/_ai_core/recommendedRestaurants.js — 새 함수
export function pickRecommendedRestaurantsByStyle(foodIndex, itinerary, area, dietary = []) {
  const cityKey = AREA_TO_CITY[area] || area;
  const tags = ['general', ...dietary]; // ['general', 'vegan', 'halal']
  const buckets = {};

  for (const tag of tags) {
    buckets[tag] = pickByTag(foodIndex, itinerary, cityKey, tag, 10);
  }

  return buckets; // { general: [...10], vegan: [...10], halal: [...10] }
}
```

**프론트엔드** (`src/pages/PlanDetailPage/components/RecommendedRestaurants.tsx`):
- 현재: 단일 리스트 10개 렌더
- 변경: 태그별 섹션 — "🌱 비건 추천 10곳", "🕌 할랄 추천 10곳", "🍴 일반 추천 10곳"

**Firestore plan 스키마**:
- 현재: `plan.itinerary.recommended_restaurants: Array<RecRestaurant>` (10개)
- 변경: `plan.itinerary.recommended_restaurants: { general: [], vegan: [], halal: [] }` (Map)
- 호환성: 기존 plan (Array) 도 렌더 가능하게 type guard

**파일**:
- `api/_ai_core/recommendedRestaurants.js` — 함수 시그니처 확장 (배열 → 맵)
- `api/ai-planner-full.js` — `pickRecommendedRestaurants` 호출 시 `body.dietary` 전달
- `src/pages/PlanDetailPage/components/RecommendedRestaurants.tsx` — 섹션별 렌더 + 호환성
- `src/types/plan.ts` — `recommended_restaurants` 타입 확장
- 식이제한 SAFETY-CRITICAL (CLAUDE.md J 섹션) — 5 지점 grep 검증 필수

**노력**: 4-5시간 · 위험 medium (스키마 변경 + 호환성)

**약점 데이터** (CLAUDE.md F 섹션):
- 제주/경주/전주 지역 + vegan/halal 태그 = DB 부족 → 후보 0개일 수 있음 → "추천 데이터 부족 - 곧 추가 예정" graceful 메시지

---

### #6 — 회원가입 + 5% 쿠폰 × 2장 자동 발행 + LINE/WhatsApp 로그인

**현 상태**:
- Firebase Auth: Google + Apple provider (`src/lib/firebase.js:35,155,173`)
- LINE / WhatsApp / Naver / Kakao 미통합
- 회원가입 = 첫 sign-in 시 Firebase 자동 user 생성 (별도 가입 폼 없음)
- 쿠폰 발행 코드: 0건 (Trip Coins redemption 만 존재 — `api/loyalty.js:316-364`)
- AI Plan 50% 할인: 현재 미적용 (sandbox 환경, 확인 필요)

**구현 설계**:

#### 6.1 — 회원가입 첫 sign-in 트리거 (필수)

```js
// src/hooks/useAuth.ts — onAuthStateChanged 콜백에 추가
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const isFirstSignIn = user.metadata.creationTime === user.metadata.lastSignInTime;
  if (isFirstSignIn) {
    // 백엔드에 idToken 으로 신규 user 알림 → 쿠폰 발행
    const idToken = await user.getIdToken();
    await fetch('/api/onboarding-coupons', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  }
});
```

#### 6.2 — 신규 endpoint `/api/onboarding-coupons` (필수)

```js
// api/onboarding-coupons.js (신규, ~80L)
import { verifyUserToken } from './_shared/user-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await verifyUserToken(req);
  if (!auth.ok) return res.status(401).end();

  const adminDb = initAdminDb();
  const userRef = adminDb.collection('users').doc(auth.uid);
  const userDoc = await userRef.get();

  // 멱등성: 이미 발급받은 적 있으면 skip
  if (userDoc.exists && userDoc.data().onboardingCouponsIssued) {
    return res.status(200).json({ ok: true, alreadyIssued: true });
  }

  const now = Date.now();
  const expiresAt = now + 90 * 24 * 3600 * 1000; // 90일

  // 1. 차터 5% 쿠폰
  await userRef.collection('coupons').add({
    code: `WELCOME-CHARTER-${randomSuffix()}`,
    type: 'percent',
    value: 5,
    label: 'Welcome 5% off Charter',
    productScope: 'charter', // 신규 필드 — braintreeCheckout 에서 productType 일치 검증
    isUsed: false,
    expiresAt,
    createdAt: now,
    source: 'onboarding',
  });

  // 2. 투어 5% 쿠폰
  await userRef.collection('coupons').add({
    code: `WELCOME-TOUR-${randomSuffix()}`,
    type: 'percent',
    value: 5,
    label: 'Welcome 5% off Tour',
    productScope: 'tour-package',
    isUsed: false,
    expiresAt,
    createdAt: now,
    source: 'onboarding',
  });

  await userRef.set({ onboardingCouponsIssued: true, onboardingAt: now }, { merge: true });
  res.status(200).json({ ok: true, issued: 2 });
}
```

#### 6.3 — `braintreeCheckout.js` productScope 검증 (필수)

```js
// api/braintreeCheckout.js — 쿠폰 검증 분기 보강
if (c.productScope && c.productScope !== productType) {
  console.warn('[braintreeCheckout] coupon product scope mismatch:', c.productScope, '≠', productType);
  // 무할인 진행 (transaction은 막지 않음)
} else {
  // 기존 percent/fixed 분기
}
```

#### 6.4 — AI Plan 50% 상시 할인 (필수)

```js
// api/_shared/pricing.js — AI Plan 가격 계산 시 50% 자동 적용
const AI_PLAN_BASE_USD = 9.90;
const AI_PLAN_LAUNCH_DISCOUNT = 0.5; // 50% off — no end date
export function getAiPlanPrice() {
  return AI_PLAN_BASE_USD * (1 - AI_PLAN_LAUNCH_DISCOUNT); // $4.95
}
```

또는 GLOBAL_PROMOS 에 자동 적용되는 promo 추가:
```js
// api/braintreeCheckout.js
if (productType === 'ai-planner-full') {
  totalDiscountRate += 0.5;
  appliedLabel = 'Launch Discount 50% OFF';
}
```

→ booking.couponDiscountKRW + promoCodeApplied 자동 채워짐.

#### 6.5 — LINE / WhatsApp / 추가 provider (선택 — Day 2-3)

| Provider | Firebase 지원 | 구현 비용 |
|---|---|---|
| Google | ✅ 네이티브 | 0 (이미 적용) |
| Apple | ✅ 네이티브 | 0 (이미 적용) |
| LINE | ❌ → OIDC custom | 중 (LINE Login v2.1 dev console 등록 + Firebase OIDC config + 콜백 핸들러) |
| WhatsApp | ❌ → 부재 | 불가 (Meta WhatsApp 은 messaging API only, 로그인 미지원) |
| Naver | ❌ → OIDC custom | 중 (Naver Developers + OIDC) |
| Kakao | ❌ → OIDC custom | 중 (Kakao Developers + OIDC) |

**권장**: Day 1 launch 에는 Google + Apple 만. LINE / Naver / Kakao 는 Day 3-5 follow-up. WhatsApp 은 로그인 불가 (안내).

#### 6.6 — UI 변경

- 회원가입 후 환영 토스트 + "쿠폰 2장 발행됨" 모달
- `MyPage.tsx` 의 쿠폰 섹션에서 자동 노출 (이미 `users/{uid}/coupons` 읽고 있음)

**파일**:
- 신규: `api/onboarding-coupons.js` (~80L)
- 수정: `src/hooks/useAuth.ts`, `api/braintreeCheckout.js` (productScope 검증), `api/_shared/pricing.js` 또는 `api/braintreeCheckout.js` (AI plan 50% 자동), `src/pages/MyPage.tsx` (welcome 모달)

**노력**:
- 6.1-6.4 (Day 1 필수): 4-5시간
- 6.5 LINE/Kakao/Naver (선택): 각 4-6시간 (개별)
- 6.6 UI: 2시간

**위험**:
- 멱등성 핵심 — 동일 user 가 sign-out + sign-in 반복 시 쿠폰 무한 발급 안 됨 (`onboardingCouponsIssued` flag)
- productScope 신규 필드 — 기존 쿠폰 (`productScope` 없음) 호환성 유지 (없으면 모든 productType 적용)

---

## 누적 큐 — 비결제 작업 (이번 launch 외, post-launch)

이전 세션에서 정리된 비결제 작업 — launch 안정화 후 진행:

| 항목 | 우선순위 | 노력 | 비고 |
|---|---|---|---|
| **A. P2 Gemini timeout 18s→30s** | 🟢 quick | 30분 | `ai-planner-quick.js:148` 한 줄. cold start 영향 mitigation. |
| **B. CleanUp Tier 1 — orphan 11개 (~20MB)** | 🟢 quick | 20분 | `og-image-original-backup.png` 등 |
| **C. CleanUp Tier 2 — one-shot 16 스크립트** | 🟢 quick | 30분 | `scripts/fix-*.js`, `migrate-*.js`, `probe-*.mjs` 등 |
| **D. Sentry tracesSampleRate 0.05** | 🟢 quick | 15분 | DSN 등록 후 1주 모니터 결과 따라 |
| **E. Tier 1-A LABELS → 중앙 i18n** | 🟡 medium | 1.5h | UI polish |
| **F. AdminClaims cs_tickets planId 컬럼** | 🟡 medium | 2h | Tier 1-C UI 부분 |
| **G. Frontend Error Boundary** | 🟡 medium | 2-3h | Sentry 자동 보고 |
| **I. Tier 2-D validate-planner 9지표 전체 plan 적용** | 🟠 large | 1-2일 | qualityScore Firestore 저장 |
| **K. Tier 2-E Telegram 에러 dedup** | 🟠 large | 2-3일 | 5분 단위 집계 + error_log |
| **L. Tier 3-F 주간 quality 리포트** | 🔵 long | 3-5일 | cron + Gemini 요약 |
| **M. Tier 3-G 자동 DB 보강** | 🔵 long | 1주 | unverified_restaurant 패턴 → Google Places |
| **N. Tier 4-H Operations Memory Bank** | 🔵 long | 지속 | OPERATIONS.md |
| **O. Phase 6 제주/경주/전주 식당 DB** | 🔵 long | 1주 | 약점 zone 보강 |
| **R. P1-C Wizard entry sign-in modal** | 🟡 medium | 4-6h | UX |
| **S. PayPalBookingButton rename** | 🟡 medium | 2-3h | 결제 마이그레이션 후 |

## 이미 완료된 작업 (재작업 금지 — 작업한거 또하지말고 잘체크해)

| PR | 내용 |
|---|---|
| #225 | Tier 1-A "이상해요" 버튼 + plan_complaints 콜렉션 — 백엔드 + UI 모두 |
| #229 | 차터 booking-processor 격리 try/catch (P20 예방) |
| #232 | Driver bot inline keyboard 자동 broadcast |
| #233 | wizard-i18n.ts 600줄 dict → 중앙 locales |
| #234 | P0 결제 후 빈페이지 + BookingDetailModal 신규 |
| #235 | PayPal legacy 정리 + Tier 1-B 무료 재생성 사유 |
| #237 | Sentry + Voucher PDF + cs_tickets planId (백엔드만) |
| #241 | Sentry 12 endpoint 확장 + AdminCalendar guard |
| #245 | 쿠폰 라벨 명시 표시 (fixed USD vs 5% 오해 부분) |
| #247 | **P0-#1 server-side coupon application** + **P0-#2 TEST bypass close** |
| #248 | docs(audit): #2 verification PASS |
| #249 | **P1-A paymentGate fail-closed** |
| #250 | docs(audit): followup findings P2 / D / E |

## 일정 — 내일 launch 기준 권장 순서

### Day 1 (오늘 저녁) — Launch blocker 처리

```
20:00-21:30 (1.5h)  #1 Wizard 호텔 dedup + #3 free-claim 제거 묶음 PR
21:30-23:00 (1.5h)  #5 식당 10/스타일 복원 PR
23:00-24:00 (1.0h)  #6.4 AI Plan 50% 상시 할인 PR
                     A/B/D quick wins 묶음 PR (Gemini timeout + CleanUp Section 1 + Sentry)
```

### Day 2 (내일 오전 — Toss 신청 + critical features)

```
09:00       Toss Payments 신청 (운영자 직접 — 코드 작업 아님)
09:00-13:00 (4h)   #6.1-6.3 회원가입 쿠폰 자동 발행 (멱등성 + productScope) PR
13:00-17:00 (4h)   #2 호텔→공항 ODsay 경로 fallback + retry + graceful display PR
17:00       Vercel preview 검증 + ready
18:00       prod 머지 + smoke test
20:00       launch — public marketing 시작
```

### Day 3 (post-launch follow-up)

```
오전: #4 Wrap-up 인라인 예약 (대형 — 차터 우선, 공항픽업/투어는 Day 4-5)
오후: #6.5 LINE / Naver / Kakao OIDC (각 4-6h, 우선순위 따라)
```

### Day 4-7 (안정화 + 기능 보강)

```
- #4 (4) wrap-up 인라인 풀구현
- F (AdminClaims planId 컬럼)
- G (Error Boundary)
- 누적 큐 medium 항목들
- I (Tier 2-D validate-planner 9지표) 시작
```

## Launch blocker 분류 요약

🚨 **Must-have (Day 1-2)**:
- #1 Wizard 호텔 dedup
- #3 free-claim 제거
- #5 식당 10/스타일 복원
- #6.1-6.4 회원가입 쿠폰 + AI 50% 할인
- #2 호텔→공항 ODsay 경로

⚠️ **Should-have (Day 2 야간 ~ Day 3 오전)**:
- #6.5 LINE 로그인 (가장 사용자 많음)
- A/B/D quick wins 누적

🔵 **Nice-to-have (post-launch)**:
- #4 Wrap-up 인라인 예약
- #6.5 Naver / Kakao
- 누적 큐 medium / large 항목

## CLAUDE.md 준수 체크리스트 (모든 PR 공통)

- [ ] 신규 텍스트 ko/en/ja/zh 4-lang 동시 추가
- [ ] 식이제한 변경 시 5 지점 grep (`halal|vegan|allergy|dietary`)
- [ ] stop 필드 신 스키마 (`name`/`display_name`/`tip`) — 구 스키마 폴백 유지
- [ ] PDF 컨테이너 `position:absolute; left:0` 유지
- [ ] `_food_index.json` 미수정
- [ ] 모바일/데스크톱 분리 영향 검증
- [ ] env 변수 신규 등록 시 production/preview/development 동시 등록 (CLAUDE.md I 절)
- [ ] 빌드 비용 절감 (CLAUDE.md H 절): 작업 중간 `WIP:` 커밋 prefix, docs-only auto-skip 활용
- [ ] Vercel project = `cocotrip-source_2026` 만 (중복 프로젝트 금지)

## 운영자 결정 필요 (즉시)

내일 launch 진행 위해 다음 결정 필요:

1. **#4 Wrap-up 인라인 예약** — A 안 (Day 3 까지 풀구현, launch 지연) vs B 안 (Day 1 launch 시 외부 링크 유지, post-launch 처리)? **권장: B 안**
2. **#6.5 LINE / Naver / Kakao 로그인** — Day 1 launch 시 Google + Apple 만 가능, 추가 provider 는 Day 2-3 follow-up. **권장: 동의**
3. **#3 Firestore `pending_free_claims` 데이터** — 기존 데이터 archive (admin export 후 drop) vs 그대로 둠? **권장: archive + drop**
4. **AI Plan 50% 할인 적용 방식** — (a) `pricing.js` 가격 자체를 $4.95로 (사용자 가시 단순) vs (b) GLOBAL_PROMOS 자동 적용 (booking 에 promoCodeApplied="Launch 50%" 기록되어 추적 가능). **권장: b 안 — 추적성 ↑**
5. **#1 Wizard 단순화 범위** — Step 0 reservation 자체를 페이지 통째로 제거 vs 옵션만 줄임 (`nothing` / `flight` 만)? **권장: 옵션만 줄임 (#3 의 free-claim 제거와 묶음)**

지시 부탁드립니다.
