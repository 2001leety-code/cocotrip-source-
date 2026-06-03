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

## 9. 결제 plan 발급 멱등성 robustness (P311 후속, 2026-06-03 자율 감사)

### 배경
P311(2026-05-30)로 capture 멱등성(`used_paypal_orders`)과 plan 발급 멱등성(`plan_issued_orders`)을 분리 → 출시 blocker 해소. 회귀 테스트 `tests/unit/payment-plan-idempotency-b3.test.ts` 존재. **실 PayPal e2e 0건**(전 트래픽 admin-bypass).

### ✅ 이중청구(double-charge) 없음 — 확인됨
capture 는 `used_paypal_orders` Firestore 트랜잭션 락(status pending→captured + 30s stale, `capturePaypalOrder.js:118-139,238`) + **PayPal 서버측이 완료(COMPLETED) 주문 재-capture 거부** → 이중청구 불가. (외부 딥서치의 "PayPal-Request-Id 없어서 이중청구 CRITICAL" 은 **과장** — PayPal 자체 enforcement + 우리 락으로 막힘.)

### robustness gap (영향 = **돈 이중청구 아님**, plan **중복발급** = Gemini 비용 + 중복 doc)

1. ✅ **RESOLVED (PR #791, 2026-06-03)** — fire-and-forget 마킹 → **await** 로 변경. `planPersister.js` `markPlanIssued()` 헬퍼 추출 + `await` (serverless freeze 전 persist 보장). 회귀 가드 `tests/unit/plan-issued-mark-p790.test.ts`.
2. ⏳ **OPEN (운영자 트레이드오프 결정 대기)** — check-then-set race: `paymentGate.js:225` 읽기 ↔ `planPersister` 쓰기 사이(plan 생성 ~수십초) 동시 같은 orderId 요청 둘 다 통과 가능 → 중복 plan.
   - 미해결 이유: 해결책(plan 생성 전 pre-claim + stale-TTL)은 **실패한 gen 의 즉시-재시도를 차단**하는 트레이드오프(race 안전 ↔ 재시도 즉시성). 페이먼트 retry 의미 변경 = 운영자 결정 사안.
   - 제안 패턴: capturePaypalOrder 의 used_paypal_orders 락(pending→captured + 30s stale + 실패 시 delete) 미러링.
3. ✅ **RESOLVED (PR #791)** — `PayPal-Request-Id` 헤더 추가(`capturePaypalOrder.js`, orderID 기반 키). defense-in-depth. 🔴 운영자 실 PayPal e2e 로 검증 권장.

### 향후 개선 (운영자 우선순위)
- 상용 결제 전 동시성 부하 테스트(같은 orderId 동시 ai-planner-full 주입) — 특히 #2 race 검증.
- #2 는 plan 중복(비용)만 영향 → 출시 blocker 아님. 실 결제량 늘면 트레이드오프 결정 + 우선순위 상향.
- ①③ 머지됨 — 실 PayPal e2e(운영자) 로 capture 헤더 동작 최종 확인.

---

## 10. 러닝 zone_course 블록 block_type 불일치 (2026-06-03 자율 감사 발견)

### 현상 / 진행 (2026-06-03 #794 부분 정정)
`src/data/zone_courses/*_running.json` 16개 중 원래 14개가 `block_type=city_day` 오타이핑이었음.
- ✅ **6개 정정됨**(#794, running_route + running_meta): seoul_jamsil, daegu_sincheon, gangneung_gyeongpo, gyeongju_bomun, busan_gwangalli, busan_haeundae (대도시 평지 urban — eligibility 안전 + 난이도 평가 명확).
- ⏳ **8개 보류**(여전히 city_day): **igidae_10km**(해안·지형 위험 → 운영자 실측 필요) + **소도시 7**(gwangju/incheon/jeonju/pohang/sokcho/suncheon/yeosu — retype 시 city_day < 3 → block_mode ineligible).
- (기존 정상 2: jeju_olle, seoul_hangang_mangwon. 따릉이 3/3 city_day=의도된 정상. 트레킹=정상.)
- 가드: `tests/unit/running-block-type-p794.test.ts` (정정/보류 분류 잠금).

### 영향
- 14개 러닝 블록이 **running 활동으로 미감지** → #786 활동가이드 러닝 how-to 안 뜸 + #784 취미day 핀 안 됨 + buildActivityMeta 러닝 SAFETY 메타(난이도/위험) 누락.
- FEATURE_ACTIVITY_BLOCKS OFF(현 prod)는 city_day 만 사용 → 14개 러닝이 **일반 관광 플랜에 day 로 leak**(안 시킨 "5km 러닝"이 sightseeing day 로 노출 — 특히 블록 적은 소도시에서 빈도↑).

### 🔴 fix = 운영자 결정 (트레이드오프, 단독 수정 보류)
14개 → `running_route` retype 시: ✅ 러닝 정상 감지 + 일반 플랜 leak 제거. ⚠️ **소도시 eligibility 위험** — city_day 풀에서 빠짐 → suncheon(총 2블록), yeosu/pohang/gwangju/incheon/jeonju/sokcho(총 3블록)가 너무 얇아져 block_mode ineligible → legacy 폴백(느림·P321 품질저하).
- 권장 경로: (a) 대도시(seoul 22 / busan 13 / jeju 9 / daegu 5 / gangneung 7 / gyeongju 5)는 retype 안전 → 먼저 적용 가능. (b) 소도시는 **real city_day 블록 추가 시드 후** retype.
- 선행 확인: block_mode min-block eligibility 임계값(shouldUseBlockMode).

---

## 11. mobility 화이트리스트 'normal' trap (2026-06-04 자율 — fix 완료)

### 현상 / root cause
`fetchAvailableBlocks` mobility 안전 가드가 `limited = mobility && mobility !== 'ok' && mobility !== 'none'` →
**'ok'/'none' 외 모든 값을 거동제약(limited)으로 오판**. limited=true 면 `unsuitable_for` 에 `wheelchair_user`/
`severe_mobility_limitation` 가진 활동 블록(트레킹·러닝) 제외. 따릉이 블록은 `unsuitable_for=['mobility_impaired']`
(UNSAFE set 밖)라 통과 → "따릉이만 나오고 트레킹/러닝은 0" 비대칭 발생.

### prod 영향 = **없음** (latent only)
prod 위저드는 `mobility='ok'` 하드코딩([WizardForm/index.tsx:213](../src/components/WizardForm/index.tsx#L213),
handlers 디폴트도 `|| 'ok'`) → 실사용자는 항상 'ok' → 가드 정상(limited=false). **'normal' 은 검증 스크립트만
보내던 값** → 활동블록 검증이 거짓 음성(false negative)이었을 뿐, 실사용 plan 은 정상.

### ✅ fix (2026-06-04)
`isLimitedMobility(mobility)` 추출 + 화이트리스트 `{ok,none,normal,good,full,fine}` 확장 → benign 값 보존,
미지의 값은 보수적으로 limited 유지. 가드: `tests/unit/activity-blocks-pre.test.ts` (normal/good/빈값 → 유지,
wheelchair/severe → 제외). prod 동작 byte-identical(항상 'ok').

### 메타 lesson (효율적 자율 검증)
**검증 스크립트는 prod 와 동일 input 을 보내야 한다.** 임의 값('normal')으로 검증 시 prod 엔 없는 코드 경로를
타 거짓 음성/양성 발생. 신규 검증 dispatch 작성 시 프론트가 실제 보내는 값(grep WizardForm/handlers)을 확인 후 사용.

### mobility 가드 자체는 prod 에서 dead (참고)
위저드가 mobility 를 수집하지 않고 'ok' 고정 → 가드는 prod 에서 한 번도 fire 안 함(휠체어 손님 트레킹 제외 SAFETY
의도가 미작동). 실제 mobility 수집 UI 추가는 운영자 기능 결정(별건).

---

## 변경 시 이 문서도 갱신
새 risk/compromise 추가하거나 기존 사항 해소되면 이 문서 갱신 필수. CLAUDE.md 와 함께 코드베이스 메타 룰의 source of truth.
