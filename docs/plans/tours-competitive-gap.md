---
plan: Tours 페이지 경쟁사 비교 — 갭 분석 + 보강 계획
created: 2026-04-25
trigger: 사용자가 "다른 사이트랑 투어 비교해서 없는 기능·없는 정보 체크 + 구상 계획 작성" 지시
related-mistake-cat: 13(i18n), 19(계획서 산출물)
status: draft (구현 전 사용자 승인 필수)
---

# CocoTrip Tours — 경쟁사 갭 분석 + 보강 로드맵

## 1. 목표

`cocotripkr.com/tours` (목록) + `/tours/{slug}` (상세) 페이지를 Klook/Viator/Trazy/Creatrip/MyRealTrip 기준으로 평가하고, **외국인 VIP 프라이빗 차량 투어**라는 차별 가치는 유지한 채 부족한 정보·기능을 채우는 단계별 계획.

> 차별점 보존: 1팀 전용, AI 플래너 통합, 팁·톨·주차 포함 가격, PayPal 안심결제, 4언어.

## 2. 현재 상태 인벤토리 (2026-04-25 main 기준)

### 데이터 모델 [src/data/tours.ts](src/data/tours.ts)
```ts
type Tour = {
  id, slug, region, title(i18n), summary, description,
  priceFrom (USD per group), durationDays, durationHours, isNightTour,
  vehicleType, maxPax, thumbnail, images[], tags[], highlights[]
}
```

### 목록 페이지 [src/pages/ToursPage.tsx](src/pages/ToursPage.tsx)
지역 필터(전체/서울/DMZ·파주/강화도/춘천/단양/경주/...), 기간 필터(전체/당일/2-3일/4일+), 트러스트 박스 3종(추가비용 없음/PayPal/24-7 영어), 카드 그리드, Trip.com 호텔 추천, "Charter 문의" CTA.

### 상세 페이지 [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx)
이미지 갤러리, 제목 + summary, 메타 칩(시간/차종/평점-하드코딩 4.9/32), 포함 사항(highlights), 상품 설명(description), 세부 일정(**placeholder "coming soon"**), 추천 호텔, 페이지 하단 CTA.

## 3. 경쟁사 표준 vs 현재 갭

### 3.1 정보 갭 (없는 정보)

| # | 항목 | 경쟁사 표준 | CocoTrip 현재 | 영향 |
|---|---|---|---|---|
| I1 | **리뷰/평점 동적 데이터** | Klook·Viator·Trazy 모두 verified review + 별점 + 리뷰 N개 | TourDetail 메타칩에 `4.9 (32)` 하드코딩, TourCard에 별 아이콘만 | 전환율 직격 |
| I2 | **세부 일정 (시간별)** | "09:00 픽업 → 09:30 경복궁 → ..." 시간표 | "Coming soon" 플레이스홀더 | 결정 단계 막힘 |
| I3 | **포함/불포함 명시 분리** | "Included / Not included" 두 컬럼, 입장료·식사·팁 각각 표기 | highlights 한 덩어리 (포함만 적힘) | "숨겨진 비용 있나?" 의심 |
| I4 | **취소·환불 정책** | "Free cancellation up to 24h" 명시 + CTA 옆 | 페이지에 명시 없음 (refundPolicy.js는 백엔드만) | 결정 막힘, 지원 문의 ↑ |
| I5 | **미팅 포인트 + 지도** | 정확 주소 + 지도 핀 + 도착 안내 (지하철역에서 도보 X분) | 표시 없음 (호텔 픽업 가정) | 외국인 혼란 |
| I6 | **운전기사 정보** | 가이드 사진/이름/언어/경력/리뷰 | 차량 종류만 표시 | VIP 신뢰 약화 |
| I7 | **차량 정보 디테일** | 좌석배치도 / 와이파이 / USB / 트렁크 용량 / 사진 | "Staria 8인승" 텍스트만 | 짐 많은 가족 결정 못함 |
| I8 | **언어 옵션** | "Available in EN/KO/JA/ZH" guide 매칭 + 추가요금 명시 | 사이트 언어 표시는 있지만 가이드 언어 매칭 정보 없음 | 일·중 고객 신뢰 |
| I9 | **가용성 캘린더** | 날짜별 빈자리 / 매진 / 가격 가변 표시 | 캘린더 없음 (문의/charter로 우회) | 셀프 예약 불가능 |
| I10 | **FAQ / Q&A** | 상세 페이지 하단 FAQ 5-10개 + 사용자 Q&A | 없음 | 지원 문의 ↑ |
| I11 | **외부 평판 링크** | Tripadvisor/Google review 배지 + 별 | 없음 | 신뢰 부족 |
| I12 | **사진 캡션 / 카테고리** | "차량 / 명소 / 식사" 분류 슬라이더 | 한 슬라이더에 섞임 | 차량/숙소 사진 못 찾음 |

### 3.2 기능 갭 (없는 기능)

| # | 기능 | 경쟁사 표준 | CocoTrip 현재 | 영향 |
|---|---|---|---|---|
| F1 | **실시간 예약 캘린더** | 날짜 클릭 → 가용 차량 → 즉시 결제 | "/charter 문의" 우회 | 전환율 ↓↓ |
| F2 | **Add-on 옵션** | 한복 ₩20k, 입장권, 사진사, 도시락 — 체크박스 | 없음 (highlights에만 가끔 있음) | 객단가 못 올림 |
| F3 | **위시리스트 / 비교** | 하트 아이콘, 비교 테이블 | 없음 | 재방문 ↓ |
| F4 | **카드 정렬·고급 필터** | 가격↑↓ / 평점 / 인기 / 최근, 그룹크기, 언어, 즉시확정 | 지역+기간만 | 탐색 어려움 |
| F5 | **가격 분해 표시** | "Per group ₩X / Per person ₩Y / 성수기 +Z%" | priceFrom USD only | 인원 많은 그룹이 비교 못 함 |
| F6 | **모바일 voucher / QR** | 예약 후 QR 코드 voucher (오프라인) | 이메일만 (백엔드 발송 OK) | 현장 혼란 |
| F7 | **라이브 채팅 / 24-7 지원** | Intercom·Drift 위젯, KakaoTalk, WhatsApp 직접 | 트러스트 박스 문구만 ("24/7 영어 지원") | 클릭 가능한 chat entry 없음 |
| F8 | **Best Price Guarantee 배지** | "더 싸면 차액 환불" 또는 비교 가격 | 없음 | 가격 비교 시 패배 |
| F9 | **공유 / 추천 기능** | URL 공유, 친구 초대 + 코드 | 없음 | 바이럴 ↓ |
| F10 | **추천 시스템** | "이 투어를 본 사람이 본 다른 투어" | 없음 | 페이지 이탈 |
| F11 | **인스턴트 확정 vs 대기** | "Instant confirmation" 배지 vs "Operator confirms in 24h" | 표기 없음 | 시간 민감 고객 이탈 |

### 3.3 UX 베스트프랙티스 갭

| # | 항목 | 표준 | CocoTrip 현재 |
|---|---|---|---|
| U1 | 취소정책을 CTA 옆에 배치 (Baymard) | ✓ | 페이지 어디에도 없음 |
| U2 | 미팅 포인트 지도를 상품 상세 항상 노출 | ✓ | 없음 |
| U3 | 첫 화면(above-the-fold)에 가격·기간·평점 묶음 | ✓ | 평점 하드코딩이라 빈 신뢰 |
| U4 | "What's included" 아이콘 + 한 줄 설명 | ✓ | highlights에 일부 |
| U5 | 모바일 sticky CTA (bottom bar) | ✓ | 일반 버튼 |

## 3.4 🔴 결정적 갭 (v2 amendment, 2026-04-25 사용자 지적)

원본 분석은 정적 정보 위주였고 **예약 흐름·라우트 디테일** 누락. 코드 재확인 후 추가:

| # | 항목 | 현재 상태 | 영향 | 출처 |
|---|---|---|---|---|
| **C1** | **"예약하기" 버튼이 결제 X, charter 문의 페이지로 redirect 만** | [TourDetailPage.tsx:428-435](src/pages/TourDetailPage.tsx) `<Link to="/charter">` + 메시지 아이콘 | 결제 진입까지 추가 wizard 단계 → 이탈 ↑↑ | 코드 확인 |
| **C2** | **인원수 선택 UI 자체 부재** | charter wizard 가서 단계 채워야 입력. Tour 페이지엔 슬라이더/select 없음 | 가격 즉시 비교 불가 | UI 확인 |
| **C3** | **투어 루트(들리는 곳) 시간순 stops 정보 없음** | 상세 §일정에 `comingSoon` placeholder만. 실제 어디 들르는지 description 1-2줄에만 언급 | 가장 큰 결정 차단 — "이 투어가 뭘 보여주는지 모름" | [TourDetailPage.tsx:264-282](src/pages/TourDetailPage.tsx) |
| **C4** | **각 stop의 디테일(이름·사진·머문시간·입장료·설명) 없음** | description에 "경복궁의 고즈넉한 아침" 한 줄. 명소 사진/머문시간/입장료 분리 없음 | AI 플래너 결과의 디테일 수준에 한참 못 미침 | 데이터 모델 |
| **C5** | **stop 간 이동 방법(차/도보/지하철) 표시 없음** | PlanDetailPage엔 TransitArrow 인터리브 렌더 있지만 Tour엔 미적용 | 이동 시간 가늠 불가 | 코드 비교 |

> **C1-C5는 Tours 전환율의 직접 천장**. P0보다 더 위 우선순위 (P0-가).

## 4. 우선순위 + 구상 계획 (P0-P3)

### P0-가 [신규] — Booking Flow + Route Detail (최우선, 결정적 갭)

#### P0-가1: 예약 흐름 직접화 [C1]
- **현재:** [TourDetailPage.tsx:428](src/pages/TourDetailPage.tsx) `<Link to="/charter">` 우회
- **방향:**
  - 버튼을 `<Link>` → 모달 `<TourBookingDialog>` 로 교체. 모달에서 인원수·날짜·픽업 위치 직접 입력 → PayPal 결제 직진입
  - 기존 [PayPalBookingButton.tsx](src/components/PayPalBookingButton.tsx) 재사용 (booking-mgmt 머지됨)
  - 옵션: 기존 charter wizard 진입을 원하는 경우 secondary 버튼 ("Custom request")
  - 차터 wizard 우회 = `/tour-direct-checkout?tour=<slug>&pax=<N>&date=<YYYY-MM-DD>`로 단축
- **파일:** [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), 신규 `TourBookingDialog.tsx`, `api/createPaypalOrder.js` (productType=`tour-{slug}` 추가, pricing_spec.json 동기화)
- **의존:** charter-v2 PR #11 의 pricing SSOT 그대로 활용

#### P0-가2: 인원수·날짜 인라인 선택 [C2]
- **방향:**
  - TourDetailPage 가격 영역에 인원수 (-/+ 1~maxPax), 날짜 picker (DayPicker 사용 가능, 의존성 있음)
  - 가격이 인원수에 따라 즉시 변경 (vehicleType 변경 자동 — 8인 초과 시 Sprinter)
  - 모바일 sticky CTA 바와 sync (P1-B와 동시 진행)
- **파일:** [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), [src/lib/tourPricing.ts](src/lib/tourPricing.ts) 신규 (P1-A로 분리됐던 가격 분해 helper와 통합)

#### P0-가3: 투어 stops 데이터 + 시간순 timeline [C3, C4]
- **현재:** [TourDetailPage.tsx:264-282](src/pages/TourDetailPage.tsx) `coming soon` placeholder
- **방향:**
  - `Tour` 데이터에 `stops: TourStop[]` 추가:
    ```ts
    type TourStop = {
      time: string;          // "09:30"
      name: I18nString;      // "경복궁"
      stay_min: number;      // 90
      photo?: string;        // /public 기준
      description: I18nString;  // "조선 5대 궁궐의 정전, 수문장 교대식 09:30/11:00/13:00"
      entry_fee_krw?: number;
      naver_map_url?: string;
      tip?: I18nString;
    };
    ```
  - PlanDetailPage의 [DayTimeline.tsx](src/pages/PlanDetailPage/components/DayTimeline.tsx) + [StopCard.tsx](src/pages/PlanDetailPage/components/StopCard.tsx) 패턴 그대로 재사용 (decompose 불요 — 신규 `TourStopList.tsx` 가 비슷한 카드 + 인터리브)
  - 시간순 stops 4-7개 (투어당), 각 카드에 사진/이름/머문시간/입장료/팁
- **파일:** [src/data/tours.ts](src/data/tours.ts), 신규 `TourStopList.tsx` + `TourStopCard.tsx`
- **데이터 입력 분량:** 8개 투어 × 평균 6 stops = 48 stops × 4언어 ≈ 약 2-3시간 한정 (사용자 협업 필요 — 기존 영업 자료에서 추출)

#### P0-가4: stop 간 이동 방법 인터리브 [C5]
- **방향:**
  - PlanDetailPage의 [TransitArrow.tsx](src/pages/PlanDetailPage/components/TransitArrow.tsx) 그대로 import해서 stops 사이에 렌더
  - Tour 데이터 신규: `Tour.stops[i].transit_from_prev?: { method: 'walk'|'car'|'transit'; minutes: number; distance_km?: number }`
  - 정적 입력 (RouteAgent 호출 X — 결제 전에는 Naver/ODsay 호출 비용 절약). 영업가이드가 입력
  - 향후 P2에서 가용성 캘린더 + 실시간 RouteAgent 호출 옵션
- **파일:** [src/data/tours.ts](src/data/tours.ts), [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), TransitArrow 재사용



### P0 — 즉시 (이주일 내, 사용자 신뢰·전환율 직격)

#### P0-A: 평점·리뷰 하드코딩 제거 + 외부 평판 연동 [I1, I11, U3]
- **현재:** TourDetailPage L235 `4.9 (32)` 문자열 직접 박힘
- **방향:**
  - 단기: `Tour` 데이터에 `rating: number, reviewCount: number, reviewSource: 'google' | 'tripadvisor' | 'internal'` 필드 추가
  - 카드/상세에서 그 필드 사용
  - 상세 하단에 "리뷰 출처: Tripadvisor / Google" 링크 + 외부 별 배지
  - 장기 (P2): Firestore `tour_reviews` 컬렉션 + 사용자 작성 리뷰 + admin 승인 (claim 시스템 재사용)
- **파일:** [src/data/tours.ts](src/data/tours.ts), [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), [src/components/tours/TourCard.tsx](src/components/tours/TourCard.tsx)
- **i18n 키:** `reviewsLabel`, `reviewSource`, `seeAllReviews`

#### P0-B: 취소·환불 정책을 CTA 옆 명시 [I4, U1]
- **현재:** [api/_refund-policy.js](api/_refund-policy.js) 백엔드 룰만, 사용자에 노출 0
- **방향:**
  - TourDetailPage CTA 위에 "Free cancellation up to 7 days · 50% refund 3-7d · No refund <72h" 표시
  - "환불 정책 보기" 링크 → 모달에 tier별 표 (refundPolicy.js의 데이터 그대로)
  - CocoTrip 차터 룰을 그대로 표시 — 새 백엔드 작업 0
- **파일:** [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), 신규 `RefundPolicyModal.tsx`
- **i18n 키:** `refundFree7d`, `refundPartial`, `refundNone72h`, `viewRefundDetails`

#### P0-C: 포함/불포함 명시 분리 [I3]
- **방향:**
  - `Tour` 데이터에 `included: TourHighlight[]`, `excluded: TourHighlight[]` 필드 추가 (기존 `highlights` 호환 유지)
  - 상세에 두 컬럼 (✓ Included / ✗ Not included) 렌더
  - default Excluded: "Personal expenses · Optional attraction tickets · Lunch (unless noted)"
- **파일:** [src/data/tours.ts](src/data/tours.ts), [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx)
- **i18n 키:** `includedTitle`, `excludedTitle`, 폴백 카피 ko/en/ja/zh

#### P0-D: 세부 일정 placeholder 채우기 [I2]
- **현재:** 상세 L264-282 `comingSoon` 박스만
- **방향:**
  - `Tour.itinerary?: { time: string; title: I18nString; note?: I18nString }[]` 필드 추가
  - 시간순 vertical timeline UI (StopCard 미니 버전 재사용 가능)
  - 데이터는 영업가이드 8개 투어 전부 입력 (정적, hand-curated)
- **파일:** [src/data/tours.ts](src/data/tours.ts), [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), 신규 `TourItineraryTimeline.tsx`

### P1 — 1개월 내 (전환율 직접 영향)

#### P1-A: 가격 분해 + 그룹/인당 토글 [F5]
- TourCard·TourDetail에 "Per group $X / Per person $Y" 토글 + 인원 수 슬라이더
- 데이터: `priceFrom`만 있음 — 신규 `pricePerPerson(pax)` 계산기 (vehicleType별 baseline 사용)
- [src/data/tours.ts](src/data/tours.ts) + [src/lib/tourPricing.ts](src/lib/tourPricing.ts) 신규

#### P1-B: 모바일 sticky CTA 바 [U5]
- 모바일 viewport에서 페이지 하단에 fixed bar `[가격] [예약하기]`
- 스크롤로 가려지지 않게 z-index 50, scroll 시 첫 화면 가격 영역 통과 후 등장
- [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx) `MobileStickyCTA` 신규

#### P1-C: 미팅 포인트 + 지도 [I5, U2]
- 고정 데이터: 호텔/공항 픽업 위치 옵션 (명동/강남/홍대/ICN T1·T2 등 7개)
- TourDetail에 Naver Map 임베드 (이미 PlanDetailPage가 사용)
- "픽업 가능 지역" 표 + 호텔 주소 자유 입력 안내
- [src/pages/TourDetailPage.tsx](src/pages/TourDetailPage.tsx), 신규 `PickupZoneMap.tsx`

#### P1-D: 카드 정렬 + 고급 필터 [F4]
- ToursPage 필터에 추가: 가격↑↓ / 평점↑ / 인기↑ / 최신, 그룹크기 슬라이더, 언어 멀티셀렉트
- [src/pages/ToursPage.tsx](src/pages/ToursPage.tsx) URL 쿼리 동기화

#### P1-E: FAQ 섹션 + Q&A [I10]
- 정적 FAQ 8개 (포함 비용 / 캔슬 / 차량 / 팁 / 결제 / 언어 / 어린이 / 공항)
- 데이터: [src/data/tours.ts](src/data/tours.ts) `Tour.faqs?: { q: I18nString; a: I18nString }[]` (선택, 글로벌 폴백 있음)
- 섹션 컴포넌트: 신규 `TourFAQ.tsx` (Accordion 패턴, shadcn 사용 가능)

### P2 — 3개월 내 (성장 단계, 운영 필요)

#### P2-A: 실시간 예약 캘린더 + Instant Confirmation [F1, F11]
- 가용성 데이터 모델: Firestore `tour_availability/{tourSlug}/{YYYY-MM-DD}` (max_groups, booked, blackout)
- 캘린더 UI: `react-day-picker` (이미 의존성 있음) + 빈자리 표시
- 결제: 기존 PayPal 흐름 재사용 (`createPaypalOrder.js` + `capturePaypalOrder.js`, charter-v2 머지로 SSOT 가격 OK)
- "Instant confirmation" vs "Operator confirms in 24h" 배지 (성수기 차이)

#### P2-B: 자체 리뷰 시스템 (P0-A 장기 계획) [I1]
- Firestore `tour_reviews` 컬렉션 + 별점/사진/언어/booking 검증
- 결제 완료 14일 후 이메일 자동 요청
- Admin 승인 큐 (`/admin/claims` 패턴 재사용)

#### P2-C: Add-on 시스템 [F2]
- 한복 대여 / 입장권 (경복궁/롯데월드/N서울타워) / 전문 사진사 / 도시락
- TourDetail 결제 직전 "추가 옵션" 섹션, 체크박스 → 가격 합산
- pricing_spec.json에 `addons: { id, label_i18n, price_krw }` 추가

#### P2-D: 운전기사·차량 디테일 페이지 [I6, I7]
- `Driver.tsx` (가이드 사진/이름/언어/경력) — 4-6명 정적 데이터
- 차량별 좌석배치도 + 트렁크 용량 SVG (Staria/Sprinter/Bus)
- TourDetail 사이드바에 표시

### P3 — 6개월+ (성장 후 차별화)

#### P3-A: AI 플래너 ↔ Tours 양방향 [F10]
- AI 플래너 결과 → "이 일정으로 차터하기" → 자동 prefill (charter-v2가 이미 일부 지원)
- Tour 카드 → "이 투어 기반 AI 플래너 생성" 버튼
- 추천 엔진: Tour click 시 "이 투어를 본 사람이 본 다른 투어"

#### P3-B: 라이브 채팅 + Bundle 패키지 [F7, F8]
- KakaoTalk + Telegram + Intercom 통합
- "투어 + 호텔 + 공항픽업" 번들 → 10% 할인 (이미 charter-v2에 콤보 가격 룰 존재)

#### P3-C: 위시리스트 / 비교 / 공유 [F3, F9]
- Firestore `user_wishlist`, URL 공유 + 추천 코드

## 5. 구현 순서 (Roadmap, v2 amendment 반영)

```
Phase 0 (이번 PR — 계획서만):  this document
Phase 1-가 (P0-가 4건, 결정적 갭):     1-2주, frontend + 데이터 모델 + 결제 직진입
  순서: P0-가3 (stops 데이터 모델) → P0-가4 (transit 인터리브)
       → P0-가2 (인원수·날짜 인라인) → P0-가1 (예약 모달 + PayPal 직진입)
       (데이터 → UI → 결제 순)
Phase 1-나 (P0 4건, 정보 디테일):     1-2주, frontend only
  순서: P0-A → P0-C → P0-D(가3에 포함됨, 합치기) → P0-B
Phase 2 (P1 5건):                    3-4주
Phase 3 (P2 4건):                    2-3개월, Firestore + admin
Phase 4 (P3 3건):                    장기
```

**주의:** P0-D (시간표 placeholder 채우기)는 P0-가3 (stops 데이터 + timeline)에 흡수. 중복 제거.

## 6. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| Lock 파일 (PlanDetailPage 1200줄) 영향 | TourDetailPage(563줄)는 lock 없음, 신규 컴포넌트로 분리 시 안전 |
| 4개 언어 동시 추가 부담 (cat 13) | 새 카피마다 i18n 4개 동시 PR — checklist 강제 |
| 정적 review 데이터의 신뢰성 (P0-A 단기) | "Source: Internal · pending verified system" 명시, 거짓 데이터 금지 |
| 캘린더 도입 시 운영 부담 (P2-A) | 운영자 admin UI 우선 (`tour_availability` CRUD), 자동화는 단계별 |
| 차터 페이지와 중복 — Tours가 차터 흐름 카니발화 | Tours = 정해진 패키지 / Charter = 커스텀 견적, 명확한 분기 메시지 |

## 7. 측정지표 (배포 후)

- Tours 페이지 → 상세 진입률
- 상세 → 결제 시작 클릭률
- "Charter 문의" 우회 비율 ↓ (목표: P2-A 후 50% ↓)
- 리뷰 노출 후 카드 클릭률 (P0-A A/B)
- FAQ 도입 후 지원 문의 수 ↓ (P1-E A/B)
- 상세 페이지 평균 체류 시간 (P0-D 시간표 도입 후 ↑)

## 8. 사용자 결정 필요 (v2 갱신)

### 결정적 갭 (P0-가, 신규 최우선)
- [ ] **P0-가1 예약 모달 + PayPal 직진입** — `/charter` 우회 끊고 Tour 페이지에서 결제 끝까지? (charter wizard도 secondary로 유지?)
- [ ] **P0-가2 인원수·날짜 인라인** — DayPicker 사용 OK? (이미 의존성 있음)
- [ ] **P0-가3 stops 데이터 입력** — 8투어 × 6 stops × 4언어. 누가 입력?
  - (a) 사용자가 영업가이드 자료 줌 → Claude가 i18n 4언어 번역 + 데이터 구조 채움
  - (b) Claude가 검색해서 초안 작성 → 사용자 검수 (시간 더 듦)
- [ ] **P0-가4 transit 인터리브** — 정적 데이터로 충분? (실시간 RouteAgent 호출은 결제 후로 미루기)

### 정보 갭 (기존 P0)
- [ ] P0-A 리뷰 — 단기 정적 + 장기 Firestore 병행?
- [ ] P0-B 취소정책 모달 — refundPolicy.js 룰 그대로 노출?
- [ ] P0-C 포함/불포함 — 글로벌 default 카피로 충분 (각 투어 override)?
- [ ] FAQ 8개 카피 — Claude 초안 vs 사용자 작성?
- [ ] 미팅 포인트 — 호텔 픽업 표준 vs 공공 7곳?
- [ ] 캘린더(P2) 운영 부담 감안 시점?

### 우선순위 결정
- [ ] **결정적 갭(P0-가) 먼저 + 정보 갭(P0) 병렬?** vs **P0-가만 먼저 끝내고 P0?**
- [ ] PayPal direct checkout으로 productType 신규 (`tour-{slug}`) — pricing_spec.json 갱신 시 charter-v2 머지된 SSOT 그대로 재사용 OK?

승인 받으면 P0-가 4건부터 별도 PR로 즉시 착수 (각 PR 독립 머지 가능, 상호 의존 적게 설계).
