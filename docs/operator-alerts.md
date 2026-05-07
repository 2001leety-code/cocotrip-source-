# 운영자 텔레그램 알림 시스템 (PR-G)

운영자가 직접 액션해야 하는데 까먹기 쉬운 항목들을 텔레그램으로 자동 알림.

## 채널 정책

운영자 보유 3개 봇 중 **A번 (메인 / COCOTRIPKR)** 만 사용. B/C 채널은 변경 X.

| 채널 | 환경변수 | 역할 |
|------|----------|------|
| **A. COCOTRIPKR (admin 본인)** | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | **운영자 액션 필요 알림 (PR-G 전부 여기)** |
| B. Driver_Chat (기사용) | `TELEGRAM_DRIVER_BOT_TOKEN` | 변경 X |
| C. InquiryCHAT_BOT | `TELEGRAM_INQUIRY_BOT_TOKEN` | 변경 X |

채널 라우터 (`api/_shared/notify.js`) 와는 별도로 운영자 본인 메인 채널은 무조건
`api/_shared/operator-alerts.js` 의 `notifyOperator()` 가 직접 `TELEGRAM_BOT_TOKEN` 으로
전송. 채널 분리 운영 중에도 메인 봇으로 들어와야 한다는 사용자 정책 반영.

## 알림 항목 종합

| # | 카테고리 | 트리거 | 빈도 | 메시지 prefix |
|---|----------|--------|------|---------------|
| 1 | 배차 미입력 D-3 | `bookings` status=CONFIRMED, tourDate ∈ [today, today+3], driver/driverChatId/acceptedAt 모두 비어있음 | 매일 KST 09:00 + 18:00 | `[운영자 알림 · 배차 미입력]` |
| 2 | 일일 to-do 종합 | 6개 카테고리 카운트 | 매일 KST 10:00 | `[운영자 알림 · 일일 to-do]` |
| 3 | 환불 처리 | `cancelBooking.js` 환불 처리 직후 | 즉시 | `[운영자 알림 · 환불]` |
| 4 | 쿠폰 race 경고 | `capturePaypalOrder.js` 가 couponWarning 마킹 직후 | 즉시 | `[운영자 알림 · 쿠폰 경고]` |

### 일일 to-do 6개 카테고리 (2번)

| 항목 | 검출 조건 | 운영자 액션 |
|------|-----------|--------------|
| a) 수동 환불 (couponWarning) | bookings.couponWarning 존재, status≠REFUNDED | PayPal 대시보드 수동 환불 |
| b) 미답변 CS 티켓 24h+ | cs_tickets.status='open', createdAt 24h 경과 | /admin → CS 탭 답변 |
| c) 미응답 plan 신고 24h+ | plan_complaints.status='open', createdAt 24h 경과 | Firestore plan_complaints 검토 |
| d) 가입 쿠폰 0건 회원 | users.createdAt 1h~7d, onboardingCouponsIssued≠true, coupons subcoll 0건 | `/admin/claims` 또는 admin-coupon-fix endpoint 호출 |
| e) booking-processor 처리 누락 24h+ | bookings.status=CONFIRMED, createdAt 24h+, bookingRef 비어있음 | `/api/admin-replay-booking-notifications` 재실행 |
| f) 환불 요청 미처리 24h+ | bookings.refundRequestedAt 존재, refundedAt 없음 | /admin/refunds 또는 cancelBooking 수동 실행 |

모두 0건이면 메시지 발송 X (조용한 날).

## Vercel cron 스케줄

```
배차 미입력 (오전):    0 0 * * *   → UTC 00:00 = KST 09:00
배차 미입력 (저녁):    0 9 * * *   → UTC 09:00 = KST 18:00
일일 to-do:            0 1 * * *   → UTC 01:00 = KST 10:00
```

vercel.json `crons` 배열에 등록됨. 다음 배포부터 자동 활성.

## 환경변수 요구사항

| 변수 | 필수 | 미설정 시 동작 |
|------|------|---------------|
| `TELEGRAM_BOT_TOKEN` | 필수 | 알림 silent skip (console.error) |
| `TELEGRAM_CHAT_ID` | 필수 | 알림 silent skip (console.error) |
| `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | 필수 | cron 503 응답 |
| `CRON_SECRET` | 선택 | 미설정 시 인증 우회 (수동 호출 가능) |

## 운영자 manual trigger

테스트용 dryRun 호출:
```
GET /api/cron-runner?job=dispatch-reminder&dryRun=1
GET /api/cron-runner?job=operator-todo-reminder&dryRun=1
```
응답에 매칭된 항목 + 메시지 미리보기 포함, Telegram 발송 안 함.

실제 발송:
```
GET /api/cron-runner?job=dispatch-reminder
GET /api/cron-runner?job=operator-todo-reminder
```

`CRON_SECRET` 설정된 경우 `&token=$CRON_SECRET` 또는 `x-cron-token` 헤더 필요.

## 환불 요청 경로 검증 (PR-G 작업 결과)

검토 결과:
- **사용자 self-cancel** → `POST /api/cancelBooking` → 즉시 PayPal/Braintree 환불
  처리 + bookings.status='CANCELED'. 이 경로에 `notifyOperator('refund', ...)` 추가됨
  (PR-G).
- **CS / InquiryForm** 으로 들어오는 환불 문의는 별도 `refunds` 컬렉션 없음 — 운영자가
  cs_tickets / inquiry 채팅에서 manual cancelBooking 호출. cs_tickets 24h+ 미답변은
  일일 to-do 알림에 포함됨.
- **쿠폰 race fix** (PR #285) 로 자동 환불 못한 케이스 → `bookings.couponWarning`
  플래그. capturePaypalOrder.js 에 즉시 알림 추가됨 (PR-G).

`refunds` 컬렉션은 코드베이스에 존재하지 않음. 향후 환불 요청 큐를 별도 컬렉션으로
분리 시 `operator-todo-reminder.js` 의 `fetchUnprocessedRefunds()` 함수 시그니처
재사용 가능. 현재는 `bookings.refundRequestedAt` 필드 기반 (manual-payment-request
등에서 향후 추가 가능).

## 컬렉션 이름 검증

코드베이스 grep 결과:
- `cs_tickets` (lowercase) — 정확. status enum: `'open' | 'closed' | 'in_progress'`
- `plan_complaints` — 정확. status enum: `'open' | 'reviewed' | 'resolved'`
- `bookings` — 정확. status enum: `'CONFIRMED' | 'CANCELED' | 'REFUNDED' | 'PENDING'` (대문자)
- `users` 와 서브컬렉션 `coupons` — 정확
- `refunds` — **존재하지 않음**. 환불은 bookings 안에 통합됨.

## silent fail 방지

모든 알림 발송 호출은:
1. `notifyOperator()` 자체가 `console.error` 로 실패 로깅
2. 호출자가 `.catch()` 로 추가 로깅
3. 함수 결과는 `{ ok, category, error? }` 객체 반환 (호출자가 추적 가능)

throw 발생시키지 않음 — booking-processor 같은 핵심 흐름이 알림 실패로 중단되면 안 됨.

## 추후 작업 후보 (PR-G 범위 외)

- [ ] InquiryForm 환불 키워드 자동 분류 → 즉시 운영자 알림
- [ ] 알림 메시지에 inline keyboard 추가 (`/admin/refunds/<id>` 직접 링크 또는 1-click 환불 버튼)
- [ ] `refunds` 별도 컬렉션 도입 시 fetchUnprocessedRefunds 활성화
- [ ] manual-payment-request 의 환불 요청 케이스 모니터링
