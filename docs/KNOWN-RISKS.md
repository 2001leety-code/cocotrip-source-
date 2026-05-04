# CocoTrip — Known Risks & Compromises

> 의도적으로 남겨둔 위험·타협 사항. 신규 세션이 이를 모르고 변경하면 prod 사고 가능.
> Generated 2026-05-04. 변경 시 갱신.

---

## 1. Two Booking Surfaces 공존 (Firestore)

### 현황
두 개의 booking 컬렉션 패턴이 동시에 존재:

| Surface | 경로 | 용도 | Auth |
|---------|------|------|------|
| **Top-level (current)** | `bookings/{bookingID}` | Braintree 결제 + Admin SDK 처리 | server-side write only |
| **Nested (legacy)** | `tours/{tourId}/bookings/{bookingId}` | 사용자 직접 생성 (구 시스템) | rules로 user 자기 booking write 허용 |

### 영향
- `cancelBooking.js`, `modifyBooking.js` 등은 top-level만 처리
- legacy nested booking은 어드민 수동 처리 필요
- `firestore.rules` 가 둘 다 허용하므로 신규 booking 잘못된 surface로 쓰면 문제

### 변경 시 주의
- 둘 다 사용 중인지 prod 데이터 확인 필요
- nested booking 이전 시 firestore.rules + 모든 query 일괄 마이그레이션 필요
- 단순 path 변경 X — 기존 데이터 마이그레이션 + dual-read fallback 기간 필요

### 향후 작업
- (P1) 신규 nested booking 생성 차단 (rules 강화)
- (P2) 기존 nested booking → top-level 마이그레이션 스크립트
- (P3) rules에서 nested write 제거

---

## 2. Firestore INTERNAL ASSERTION 글로벌 swallow

### 위치
`src/main.tsx` L15-28

### 현상
Firebase v12.11.0 의 `onSnapshot` 버그로 random `INTERNAL ASSERTION FAILED` 에러 발생. 사용자에게 영향 없지만 console 노이즈 + Sentry 알림 폭주 우려.

### 우회 코드
```ts
// main.tsx 상단
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('INTERNAL ASSERTION FAILED')) {
    event.preventDefault(); // swallow
    console.warn('[firebase] INTERNAL ASSERTION swallowed:', event.reason.message);
  }
});
```

### 위험
- 이 에러가 **진짜 버그**인 케이스를 놓칠 수 있음 (silent failure)
- Firebase 업그레이드 시 패턴 안 맞으면 silent failure 추가 가능

### 모니터링
- Firebase 13.x 출시 시 onSnapshot 수정 여부 확인 → swallow 제거
- 현재는 console.warn으로 빈도 모니터 (Sentry 알림 X)
- 재발 빈도 폭증 시 user-facing 이슈 의심

### 변경 금지 (현재 상태 유지)
- swallow 패턴 자체 제거 시 dev console + Sentry 폭주
- Firebase 다운그레이드는 다른 회귀 위험

---

## 3. AI 플래너 stop 필드 스키마 (CLAUDE.md §C 참조)

### 현황
구 스키마 (`name_ko`, `name_en`, `tip_en`)와 신 스키마 (`name`, `display_name`, `tip`) 혼재.

### 폴백 패턴 (모든 코드에서 준수)
```js
stop.display_name || stop.name_en || stop.name || stop.name_ko
stop.name || stop.name_ko  // 한국어명 (네이버맵 검색)
stop.tip || stop.tip_en
```

### 변경 금지
- Gemini 프롬프트는 신 스키마 (`name`, `display_name`, `tip`)만 사용
- 코드는 폴백 패턴 유지 (Firestore 기존 plan 호환)
- 한쪽만 변경 시 prod plan 빈칸 노출

---

## 4. PayPal Legacy 분기 (Braintree 마이그레이션 후)

### 보존 영역
- `api/_shared/paypal.js` (token helper)
- `api/_ai_core/paymentGate.js` `detectProvider()` PayPal branch
- `api/cancelBooking.js` PayPal refund branch
- `PAYPAL_CLIENT_ID/SECRET` env vars

### 사유
PR #235에서 PayPal endpoints (createPaypalOrder, capturePaypalOrder) 삭제했지만, **기존 PayPal-direct booking의 환불 처리**를 위해 위 4개는 보존.

### 제거 시점
- 모든 PayPal-direct booking이 settled/refunded 상태로 확정된 후
- Firestore `bookings` 컬렉션에서 `provider: 'paypal'` 미해결 booking 0건 확인

---

## 5. Hardcoded admin email (3 곳)

### 위치
- `firestore.rules` `isAdminEmail()` — `'2001leety@gmail.com'`
- `src/pages/AdminClaims.tsx:60` (PR #240으로 env 폴백 변경 가능)
- `src/pages/AdminReviews.tsx:31` (동일)

### 유효한 env 사용 위치
- `src/AdminRoute` — `VITE_ADMIN_EMAIL`
- `api/_shared/auth.js` `verifyAdminToken` — `ADMIN_EMAIL`

### 신규 admin 추가 시
1. `firestore.rules` `isAdminEmail()` 에 새 email 추가 (rules는 env 못 읽음 — 코드 변경 + deploy 필요)
2. `VITE_ADMIN_EMAIL` env 갱신 (Vercel UI)
3. `ADMIN_EMAIL` env 갱신
4. 위 2개 .tsx 하드코드 fallback도 같이 봐야 함 (env 누락 시 single email만 동작)

### 향후 개선
- Firestore `admins/{email}` 컬렉션으로 동적 관리 → rules + 코드 모두 collection lookup 패턴
- 현재는 1인 admin이라 over-engineering 회피

---

## 6. USD_TO_KRW = 1380 hardcoded (3 → 1 with helper)

### Before (5/4 이전)
3 곳 매직 넘버 중복:
- telegram /sales 명령
- AdminAnalytics.tsx
- booking-processor 기본값

### After (PR #240 이후)
- `api/_shared/exchange-rate.js` (백엔드)
- `src/lib/exchange-rate.ts` (프론트엔드)
- `USD_TO_KRW = 1380` 상수 + `usdToKrw/krwToUsd` 헬퍼

### 변경 시 영향
- 환율 변경 시 prod 표시 가격 즉시 변동 (booking-processor 기본 가격, /sales 보고서, AdminAnalytics 매출)
- 실제 결제는 Braintree/Firestore에 저장된 KRW 그대로 — 환율 변경이 retroactive 적용 안 됨

### 향후 개선
- 외부 환율 API 연동 (현재 정적 1380 고정)
- 캐시 + 일일 갱신 패턴

---

## 7. cs_tickets 필터 시 orderBy drop (Telegram /cs_list)

### 위치
`api/telegram-webhook-admin.js` `handleCsList`

### 현상
`/cs_list pending` 같이 status 필터 + orderBy createdAt 조합 시 Firestore composite index 필요. 인덱스 없어서 코드가 의도적으로 orderBy drop.

### 영향
- 필터된 ticket 목록이 날짜순 정렬 X
- `/cs_list all` (필터 없음)은 정상 정렬

### 향후 개선
- composite index 추가: `cs_tickets (status ASC + createdAt DESC)`
- `firestore.indexes.json` 갱신 + deploy
- 그 후 `handleCsList` 의 orderBy drop 제거

---

## 8. AdminCalendar status cycle (PR #240으로 confirm 추가)

### Before
status 클릭 → 즉시 다음 상태로 전환 (cancelled → pending → confirmed → cancelled cycle). 실수 클릭 시 데이터 손실 가능.

### After (PR #240 이후)
destructive 전환 (특히 → cancelled) 에 confirm 추가.

---

## 변경 시 이 문서도 갱신
새 risk/compromise 추가하거나 기존 사항 해소되면 이 문서 갱신 필수. CLAUDE.md 와 함께 코드베이스 메타 룰의 source of truth.
