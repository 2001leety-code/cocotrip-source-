---
plan: CocoTrip 운영 런북 — 예약·알림·대응
created: 2026-04-25
audience: 운영자(태연), Claude(자동화 supervisor)
related: api/booking-processor.js, api/_telegram.js, api/_email-renderer.js,
         api/cancelBooking.js, api/modifyBooking.js, api/my-bookings.js
---

# CocoTrip 운영 런북

## 0. 요약 — 한눈에 보기

```
고객이 결제 → PayPal capture → bookings/{orderID} 저장
        ↓
  ┌─────────────────────────────────────────────┐
  │ Step 1  Google Sheets 기록 (자동)           │
  │ Step 2  Telegram 푸시 알림 (자동·즉시)      │
  │ Step 3  PDF 바우처 생성 (자동)              │
  │ Step 4  Google Wallet 패스 (자동, 옵션)     │
  │ Step 5  고객 이메일 (PDF 첨부, 자동)        │
  │ Step 6  Sheets 상태 '확정' 마킹 (자동)      │
  └─────────────────────────────────────────────┘
        ↓
  운영자(태연)
   - Telegram 알림에서 즉시 확인
   - Sheets에서 일자별 일괄 조회
   - /admin 페이지에서 통계 + 검색
```

**SLA:** 결제 완료부터 운영자 알림까지 10초 이내(텔레그램), 고객 이메일은 30초 이내.

---

## 1. 알림 채널 (3중 redundancy)

### 1.1 Telegram (1차 — 즉시 확인용)
- **수신 위치**: 운영자 모바일 Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID에 묶인 채팅방)
- **전송 시점**: PayPal capture 직후 (~3-5초)
- **포맷**: Gemini가 생성한 사람 친화 메시지 + 공항 픽업이면 ✈ 터미널/편명/수하물 섹션 자동 포함
- **운영자 액션**: 메시지 받으면 → 30분 내 차량·기사 배차 결정
- **장애 시**: bot token 미설정 → console.error만 남고 결제는 통과 (silent fail). 매주 1회 더미 결제로 확인

### 1.2 Google Sheets (2차 — 기록·검색·정산용)
- **위치**: 운영자가 관리하는 마스터 시트 (env에 ID 저장)
- **기록 컬럼**: bookingRef, 결제일, 고객명/이메일, 상품, 투어일, 인원, 차량, 금액KRW/USD, 환율, 쿠폰, **memo (공항 정보 통합)**
- **활용**:
  - 날짜별 정렬 → 일일 출발 명단
  - memo 컬럼만 보면 공항 픽업 디테일 (터미널/편명/수하물) 한눈에
  - 정산용 — 월말 매출 합계
- **장애 시**: Sheets API 실패 → console.error, 결제는 통과. **bookings/{orderID} Firestore 레코드는 있으니 복구 가능**

### 1.3 고객 확인 이메일 (3차 — 고객 응대용)
- **발신**: GMAIL_USER (CocoTrip 공식 메일)
- **내용**: 예약번호, 투어 정보, **PDF 바우처 첨부** (운전기사가 스캔), Wallet 링크 (옵션)
- **자동 발송**: Step 5
- **장애 시**: 이메일 실패해도 결제 통과. Telegram 알림에 "이메일 미발송" 표시되면 운영자가 수동 발송

---

## 2. 운영자 핵심 화면 (URL 모음)

| URL | 용도 | 권한 |
|---|---|---|
| **`/admin`** | 전체 booking 통계 + 검색 + 헤더 자동 추출 (memo 포함) | Admin 클레임 필요 |
| **`/admin/claims`** | (1) Free claim 승인/거부 (2) Charter inquiry 응답 | Admin |
| **(향후) `/admin/tours`** | 투어 데이터 CRUD + stops 입력 | Admin |
| **(향후) `/admin/availability`** | 투어별 가용성 캘린더 (Firestore) | Admin |
| **`/my-plans`** | 사용자 자기 plan 조회 | 본인 로그인 |
| **`/my-bookings`** (MyPage 탭) | **사용자 self-serve 취소/수정** | 본인 로그인 |
| **Google Sheets** | 정산용 마스터 시트 | Sheets 공유 권한 |
| **PayPal Business** | 환불 직접 처리 (cancelBooking API가 PayPal Refund 자동 호출하지만 백업) | PayPal 로그인 |

---

## 3. 일/주/월 체크리스트

### 매일 (10분)
- [ ] Telegram 알림 누락 없는지 확인 (전날 알림 vs Sheets 기록 cross-check)
- [ ] 다음날 출발 예정 booking 명단 조회 (Sheets 날짜 필터)
- [ ] 공항 픽업 booking은 터미널/편명/수하물 confirm 필요
- [ ] 운전기사·차량 배차 매칭 (driverLanguages == booking.driverLang)
- [ ] (cancelBooking 들어왔으면) PayPal Refund 정상 처리 확인

### 매주 월요일 (30분)
- [ ] 텔레그램 dummy 결제 1건 → 알림 흐름 정상 확인
- [ ] `/admin` 통계 → 주간 매출/예약수
- [ ] `/admin/claims` 승인 대기 큐 처리 (주 단위 SLA: 7일 이내)
- [ ] Vercel 로그 `vercel logs --search "status:500" --since 7d` → 에러 누적 확인
- [ ] `node scripts/validate-planner.cjs` (주간 1회, Gemini 5호출 비용 발생)

### 매월 첫째 영업일 (1시간)
- [ ] Sheets 매출 집계 → 정산
- [ ] 환불 발생 booking 점검 (cancelBooking 통계)
- [ ] 가격 spec 갱신 필요 여부 (성수기/비수기)
- [ ] common-mistakes 카테고리 신규 항목 검토 → 사전 방지 룰 추가

---

## 4. 비상 대응 — 자주 일어나는 시나리오

### A. Telegram 알림이 안 온다
1. `vercel logs --search "telegram"` 확인 → bot token 미설정 vs API 에러 구분
2. bot token 미설정이면 Vercel 환경변수에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 등록 → 재배포
3. 그동안 Sheets에서 직접 booking 조회 (1차 백업)

### B. PayPal 결제 됐는데 bookings 컬렉션에 없음
1. capturePaypalOrder 로그 확인 → Firestore write 실패 가능
2. PayPal Business에서 capture ID + payer email 확인
3. Firestore Console에서 수동 booking 레코드 추가 (orderID, captureID, customer info)
4. Sheets에 수동 기록

### C. 고객이 cancelBooking 했는데 PayPal Refund 미처리
1. `/admin` → 해당 booking → status가 'CANCELED' 인데 refundedAmount 0인지 확인
2. 그렇다면 PayPal Business → 해당 거래 → 수동 환불
3. Firestore 직접 update → refundedAmount 채움

### D. 플래너 ai-planner-full 500 에러
1. `vercel logs --search "ai-planner-full" --since 1h --search "status:500"`
2. SyntaxError → buildPrompt.js 백틱/${} escape 확인 (cat 20, 21 참조)
3. ReferenceError → 동일 buildPrompt 변수 scope 확인
4. Gemini API 키 만료 → `GEMINI_API_KEY` 갱신
5. 비상 시 hotfix 브랜치로 fix → `gh pr merge --squash --admin`

### E. 호텔/항공 추천 (charter cross-sell)
- AI 플래너에 hotel_address 있으면 호텔 광고 skip (자동 처리)
- 별도 운영 액션 불필요

---

## 5. 자동 알림 메시지 템플릿 (현재 동작 중)

### 5.1 Telegram (`api/_telegram.js` `sendBookingAlert`)
```
🎉 새 예약 들어왔어요!
━━━━━━━━━━━━━━━
👤 고객 정보
이름: {name}
이메일: {email}
상품: {productType}
날짜: {tourDate}
인원: {pax}명

✈️ 공항 픽업  (airport 필드 있을 때만)
━━━━━━━━━━━━━━━
터미널: T1/T2
편명: {flightNumber}
수하물: {total}개 (S{small}·M{medium}·L{large})

💰 결제 정보
━━━━━━━━━━━━━━━
USD: ${amount}
KRW: ₩{amountKRW}
환율: {exchangeRate}
```

### 5.2 고객 이메일 (`api/_email-renderer.js`)
- 제목: `[CocoTrip] 예약 확인 — {productType} on {tourDate}`
- 본문: 4언어 자동 (Gemini 기반)
- 첨부: PDF 바우처 (운전기사 스캔용)
- 추가: Google Wallet 패스 링크 (옵션)

---

## 6. 신규 투어 booking 흐름 (PR #19~#34 통합 후)

```
사용자 → /tours → /tours/{slug} → 예약 모달 (TourBookingDialog)
   인원수·날짜 (DayPicker)·기사 언어·addon 선택
        ↓
   PayPal 직진입 (TourBookingDialog 안 PayPalBookingButton)
        ↓
   /api/createPaypalOrder
     - productType: charter_seoul_city 등 (TOUR_TO_CHARTER_KEY 매핑)
     - priceKRW: getTourPriceKRW(tour.id) + addons
        ↓
   PayPal 승인 → /api/capturePaypalOrder
     - bookings/{orderID} Firestore 저장 (captureID, airport, addons memo)
        ↓
   /api/booking-processor (이미 Step 1-7)
     - Sheets, Telegram, PDF, Email 동일 흐름
```

**투어 booking은 charter booking과 같은 인프라 사용** — 별도 알림 채널 만들 필요 없음. memo 필드에 `Tour: {title} | {pax} pax | {LANG} driver | Add-ons: hanbok_rental,...` 형태로 자동 포함.

---

## 7. 운영자 → Claude 인계 (다음 세션)

이번 세션 다른 사람이 이어서 일할 때 알아야 할 것:
- main 최신 커밋 + 모든 PR (메모리 [project_cocotrip_phase4_plan.md](project_cocotrip_phase4_plan.md) + 본 런북)
- 환경 변수: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GMAIL_USER`, `GMAIL_PASS`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `(VITE_TRIPADVISOR_API_KEY, VITE_GOOGLE_PLACES_API_KEY)` — 후 2개 옵션
- Firestore 컬렉션: `bookings`, `pending_free_claims`, `charter_inquiries`, (향후) `tour_availability`
- 관리자 페이지: `/admin`, `/admin/claims`
- 아직 미구현: tour_availability 백엔드, /admin/tours, /admin/availability

---

## 8. 향후 자동화 우선순위

| # | 항목 | 이유 |
|---|---|---|
| 1 | tour_availability Firestore 컬렉션 + admin 캘린더 | 가용성 mock 졸업 |
| 2 | KakaoTalk 알림채널 | 한국어 고객 응대 (Telegram 외) |
| 3 | 운전기사 자동 매칭 (driver pool 생기면) | 배차 수동 결정 자동화 |
| 4 | 환불 정책 자동 알림 (취소 7일 전 reminder) | 무환불 데드라인 안내 |
| 5 | Tripadvisor/Google API 통합 | 외부 검증 평점 노출 |
| 6 | 매출 대시보드 (월/주/일) | Sheets 의존 졸업 |
