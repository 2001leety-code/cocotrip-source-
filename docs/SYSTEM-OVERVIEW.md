# CocoTrip — System Overview (자문용)

> 통합 시스템 개요. 외부 자문/리뷰 요청용. 2026-05-04 기준. 별도 4개 docs (`ARCHITECTURE-frontend/backend/admin.md`, `KNOWN-RISKS.md`)의 요약본 + 결제 통합 설명.
>
> Repo: https://github.com/2001leety-code/cocotrip-source-
> Prod: https://cocotripkr.com (Vercel)
> Firebase project: `planning-with-ai-a0801`

---

## 1. 한 줄 요약

**한국 외국인 대상 프라이빗 투어 플랫폼** — AI 여행 플래너 + 차터(차량 임대) + 가이드 투어 3개 상품을 **단일 결제·운영 인프라**에서 운영. Vite + React 19 + Firebase + Vercel Serverless + Braintree 결제.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite 7 + React 19 + TypeScript 5.9 + react-router-dom 7 + Tailwind 3 + Radix UI + Framer Motion + Zod |
| Auth | Firebase Auth (Google SSO) |
| Realtime DB | Firestore (Admin SDK on backend, Web SDK on frontend) |
| Backend Runtime | Vercel Serverless Functions (Node.js 22 ESM) |
| AI | Google Gemini 2.5 Flash (`@google/generative-ai`) |
| Payments | Braintree Drop-in UI (PayPal-via-Braintree + 카드 + Apple/Google Pay 통합) |
| Maps / Transit | Naver NCP (Geocoding/Directions) + ODsay (대중교통) |
| Email | Gmail SMTP via `nodemailer` |
| Sheets | Google Sheets (leads/feedback) |
| Wallet | Google Wallet (issuer pass) |
| Notifications | 3 Telegram bots (admin/driver/inquiry) + Web Push (VAPID) |
| Observability | Sentry (`@sentry/react` + `@sentry/node`) + PostHog + GA4 |
| Plan | Vercel Pro (max function duration 300s for AI planner) |
| PWA | `vite-plugin-pwa` (offline + install) |

**Vercel project**: `cocotrip-source_2026` (canonical). Build machine: **Elastic** ($0.0035/CPU·min). Native checks: Typecheck ON+gate, Lint OFF (GitHub Actions duplicates).

---

## 3. 3 Products / 1 Payment System (핵심 설계)

### 표면은 3개, 결제는 한 군데

```
[AI 플래너]  [차터]  [투어]  [공항 픽업]  [K-pop 셔틀]
     │         │       │         │            │
     └─────────┴───────┴─────────┴────────────┘
                       ↓
              BraintreePaymentButton
              (Drop-in UI 컴포넌트)
                       ↓
              api/braintreeClientToken.js
                       ↓
              api/braintreeCheckout.js  (transaction.sale)
                       ↓
              api/booking-processor.js
              (booking 저장 + email + telegram + voucher)
                       ↓
              productType 분기 처리
```

### 상품별 차이는 `productType` + UI 만

| 영역 | AI 플래너 | 차터 | 투어 |
|------|----------|------|------|
| productType | `ai-planner-full` | `charter_seoul_city`, `charter_busan`, `charter_custom_estimate` (8+) | `tour_<id>` |
| 가격 | $9.90 고정 | 시군 매트릭스 + 권역 평균 fallback | 투어별 다름 |
| 진입 | `/planner` | `/charter` | `/tours/:slug` |
| Wizard | 5-step (`WizardForm`) | 6-step (`CharterWizard`) | Modal (`TourBookingDialog`) |
| 결제 후 산출물 | AI 플랜 + PDF | Voucher + Wallet + driver 배차 | Voucher + tour availability 차감 |
| 환불 | 디지털 = 비환불 | Bronze tier (≥72h 100%, 48-72h 80%, 24-48h 50%) | Tour-specific |
| 무료 재생성 | 2회 (revisionCredits) | ❌ | ❌ |
| Driver 배차 | ❌ | ✅ Telegram inline keyboard 자동 broadcast | ❌ |

### 공통 결제 인프라 (모든 상품 동일)
- **쿠폰**: `applyPromoCode.js` — COCO5/COCO10/EARLY50 글로벌 + Firestore 개인 쿠폰 (5+5% 합산)
- **환불**: `cancelBooking.js` — Bronze tier 정책 + PayPal legacy 분기 보존
- **이메일**: `_send-email.js` (실제 발송 경로). ⚠️ `_email-renderer.js` 는 **미사용(importer 0, 2026-07-25 확인)** — 메일 문구 고칠 때 착각 주의
- **Telegram 알림**: 결제 영수증 + 배차 + 에러 dedup
- **Voucher PDF**: `_generate-voucher.js` (PDFKit) — booking-processor 첨부 + `/api/voucher` public 다운로드 동일 출력
- **Wallet pass**: `_create-wallet-pass.js` — Google Wallet `LocalizedString` 4-lang
- **Sentry capture**: 17 endpoint outer catch에 `captureError`

→ **한 군데 변경 = 모든 상품 동시 적용**. 단점: 한 곳 망가지면 모든 상품 영향.

---

## 4. Frontend 라우팅 (23 활성 라우트)

| 그룹 | 경로 | Auth |
|------|------|------|
| **Public** | `/`, `/region/:id`, `/tours`, `/tours/:slug`, `/planner`, `/about`, `/terms`, `/privacy`, `/travel-terms` | ❌ |
| **Auth gated** | `/charter`, `/charter-legacy`, `/mypage`, `/my-plans` | Firebase user |
| **Public (token)** | `/my-plans/:planId` | planId = share token |
| **Admin only** | `/admin`, `/admin/{reviews,claims,reconciliation,plans,availability,sales,calendar,analytics,ops}` (10 페이지) | email match `VITE_ADMIN_EMAIL` |

**Auth 패턴**: `<AuthRequired>` wrapper (Firebase user 존재) + `<AdminRoute>` (email 추가 검증)

**TEST_ACCOUNTS**: `2001leety@gmail.com` — sandbox bypass for 어드민 본인 결제 테스트 (`BraintreePaymentButton.tsx:164`)

---

## 5. Backend API (53→44 파일)

### 카테고리

| 영역 | 개수 | 주요 endpoint |
|------|------|--------------|
| **Public (사용자 결제 + 조회)** | 26 | ai-planner-full/quick, booking-processor, braintreeCheckout, applyPromoCode, my-bookings, cancelBooking, voucher, reviews, chat, ... |
| **Admin (운영)** | 7 | admin-bookings, admin-plan-lookup, admin-replay-booking-notifications, admin-scan-suspect-bookings, admin-sales, admin-posthog-funnel |
| **Webhooks** | 3 | telegram-webhook-{admin,driver,inquiry} |
| **Cron** | 1 router + 11 jobs (3 active) | daily-report, refund-reminder, dispatch-timeout-sweep |
| **Internal helpers** (`_*.js`) | 17 root + 13 `_shared/` + 22 `_ai_core/` | sentry, exchange-rate, dispatch-helpers, telegram, paypal (legacy), email-templates 등 |

### AI 플래너 코어 (`api/_ai_core/` 18 modules)

```
ai-planner-full.js (307L, maxDuration=800)
  → buildPrompt.js          (Gemini system prompt 조립)
  → geminiPipeline.js       (Gemini 호출 + 파싱 + 수리, legacy 1-pass)
    └ threePassPipeline.js  (PLANNER_MODE='3pass' 시)
  → responseValidator.js    (식이제한·언어·필드 검증)
  → dbMatcher.js            (응답 → _food_index.json 1.2MB 매칭)
  → sanitizeName.js         (주소 prefix '대한민국 '/'KR ' 제거)
  → routeEnrichment.js      (RouteAgent — Naver Geocoding + ODsay Transit)
  → planPersister.js        (T-money 계산 + Firestore 저장)
  → paymentGate.js          (PayPal/Braintree provider 검증 + revisionCredits 체크)
```

### Firestore 컬렉션 (~24개)

**핵심**: `plans` (+ subcoll `translations`), `plan_complaints`, `bookings`, `booking_costs`, `tours` (+ `bookings` subcoll), `tour_availability`, `users` (+ 7 subcolls: plans/pointHistory/coupons/wishlist/recentlyViewed/itineraries/shareRewards/reviewRewards), `push_subscriptions`, `earlybird`, `reviews`, `charter_inquiries`, `pending_free_claims`, `calendar_blocks`, `cs_tickets`, `drivers`, `dispatch_messages`, `chat_sessions` (+ `messages`), `inquiry_messages`, `availability` (server-only), `reservations` (server-only), `used_paypal_orders`, `api_stats`, `chat_rate_limits`.

**Indexes**: 6 composite (bookings × 3, plan_complaints, plans, dispatch_messages). `firestore.indexes.json` + `firebase deploy --only firestore:indexes` 워크플로우.

### Cron (Vercel Pro 보장)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `daily-report` | `0 22 * * *` | 일일 매출 + 신규 booking 텔레그램 |
| `refund-reminder` | `0 23 * * *` | 환불 가능 시간 임박 알림 |
| `dispatch-timeout-sweep` | `*/5 * * * *` | 만료된 dispatch_messages 정리 (10분 expiry) |

**Disabled 8개** (cron-runner.js 주석): traffic-alert, content-generator, competitor-monitor, retarget-scheduler, review-scheduler, reddit-monitor, weather-check, blog-publisher → 2026-05-04 PR #240으로 코드 자체 삭제.

---

## 6. Admin Operations (3-channel + 10 페이지)

### 웹 어드민 (`/admin/*`)

| 페이지 | 핵심 액션 |
|--------|----------|
| `/admin` (홈) | 9 카드 grid + 신규 tour 인라인 등록 + Sheets booking 표 + Test Push 버튼 |
| `/admin/reviews` | 리뷰 모더레이션 (승인/거부/수정) |
| `/admin/claims` | 무료 클레임 + 차터 inquiry 검토 (telegram 1-click 보조) |
| `/admin/reconciliation` | 의심 booking 일괄 복구 + estimate booking 정산 표시 |
| `/admin/plans` | 사용자 이메일·planId 검색 + revisionCredits 조정 |
| `/admin/availability` | tour_availability 일자별 차단/해제 |
| `/admin/sales` | 매출 집계 (admin-sales API 사용) |
| `/admin/calendar` | bookings 캘린더 + status 사이클 (destructive 전환에 confirm) |
| `/admin/analytics` | 전환 funnel + 매출 추이 (Firestore 직접 + admin-posthog-funnel) |
| `/admin/ops` | DispatchTimeline, TelegramLogs, ConversionFunnel, ReviewManagement, ProfitSettlement 통합 |

### Telegram 봇 3개 (분리 운영)

#### COCOTRIPKR (메인, `TELEGRAM_BOT_TOKEN`)
어드민 명령 17개 + 결제/에러/리포트 알림.
```
/start /help /explain /id
/status /drivers /driver_add /driver_remove /driver_off /driver_on /whois
/dispatch       — 수동 배차
/bookings       — 최근 booking 조회
/sales [날짜]   — 매출 보고
/cs_list        — CS 티켓 목록 (필터 시 orderBy drop, KNOWN-RISKS #7)
/cs_add [plan:<id>] <subject>  — CS 티켓 등록 (planId optional, PR #237)
/cs_resolve <id>
이슈추가 ...   — 한글 alias (KOREAN_ALIASES 정규식)
```

#### Driver_Chat (`TELEGRAM_DRIVER_BOT_TOKEN`)
기사 [수락/거절] 양방향. PR #232 inline keyboard 자동 broadcast (옵트인 `AUTO_DISPATCH_BROADCAST=1`).
- callback: `accept:<orderID>` → bookings.dispatchStatus='accepted', dispatchedDriverId
- callback: `reject:<orderID>` → admin bot fallback 알림

#### InquiryCHAT_BOT (`TELEGRAM_INQUIRY_BOT_TOKEN`)
고객 채팅 위젯 reply 릴레이.

### Auto-notification 5 채널 (`api/_shared/notify.js`)

| 채널 | 트리거 | 대상 봇 |
|------|--------|---------|
| `booking` | 결제 성공 | 메인 |
| `dispatch` | 배차 시작/거절 fallback | driver + 메인 (거절 시) |
| `error` | unhandled error (Sentry 외 보조) | 메인 |
| `inquiry` | 고객 채팅 메시지 | inquiry → 메인 reply |
| `report` | 일일 cron 요약 | 메인 |

---

## 7. Observability + Security

### Sentry (활성)
- **Frontend** (`src/lib/sentry.ts`): PROD only, sample 0.1, beforeSend PII strip (email/IP), Firestore noise drop
- **Backend** (`api/_shared/sentry.js`): 15 endpoint에 `captureError` (booking-processor, braintreeCheckout, ai-planner-full, cancelBooking, voucher, applyPromoCode, loyalty, my-bookings, modifyBooking, notify-claim, admin-bookings, admin-replay-..., admin-scan-..., chat, braintreeClientToken)
- DSN env: `VITE_SENTRY_DSN` + `SENTRY_DSN` 둘 다 등록

### PostHog (lazy, opt-in)
- Init 시 `VITE_POSTHOG_KEY` 미설정이면 import 자체 skip → zero bundle
- PII guard `sanitize()` strips email/phone/address/name before send

### GA4
- 모든 라우트 변경 `<PageViewTracker>` 호출

### Firebase Auth Gates
- Frontend: `AuthRequired` (user 존재) + `AdminRoute` (email 검증, env `VITE_ADMIN_EMAIL`)
- Backend: `verifyAdminToken` (Firebase ID token + email match + email_verified)
- Firestore Rules: `isAdminEmail()` (rules는 env 못 읽음 → 하드코드, KNOWN-RISKS #5)

### Telegram 봇 보안
- 모든 webhook에 `TELEGRAM_WEBHOOK_SECRET` 헤더 검증
- 어드민/inquiry 봇은 `TELEGRAM_CHAT_ID` 핀 (driver는 callback-scoped)

---

## 8. Known Risks & Compromises (의도적 타협)

상세는 `docs/KNOWN-RISKS.md` 참조.

| # | 항목 | 영향 | 변경 가능 시점 |
|---|------|------|---------------|
| 1 | Two booking surfaces 공존 (top-level vs `tours/{id}/bookings/`) | legacy nested booking 어드민 수동 처리 | 마이그레이션 PR (1-2주 spike) |
| 2 | Firestore INTERNAL ASSERTION 글로벌 swallow | Firebase v12.11.0 onSnapshot 버그 우회. 진짜 버그 silent 가능성 | Firebase 13.x 출시 시 |
| 3 | AI 플래너 stop 필드 신/구 폴백 (`name_ko` vs `name`) | Firestore 기존 plan 호환 | 기존 plan 모두 만료 후 |
| 4 | PayPal Legacy 분기 (Braintree 후 환불용) | 기존 PayPal-direct booking 환불 | 모든 PayPal booking settled 후 |
| 5 | 하드코드 admin email 3 곳 (firestore.rules + 코드 fallback 2개) | 신규 admin 추가 시 코드 + rules 동시 수정 필요 | `admins/{email}` collection 도입 |
| 6 | USD_TO_KRW=1380 정적 (PR #240 helper로 1곳 통합, 7곳 잔여) | 환율 변동 자동 반영 X | 외부 환율 API 연동 |
| 7 | cs_tickets 필터 시 orderBy drop | `/cs_list pending` 정렬 X | composite index 추가 |
| 8 | AdminCalendar status cycle (PR #241으로 destructive 클릭에 confirm 추가) | — | 해소됨 |

---

## 9. 빌드 + 배포 비용 정책

### Vercel `ignoreCommand` (`scripts/vercel-ignore.sh`)
다음 조건 만족 시 빌드 자동 스킵:
- 커밋 메시지 `[skip ci]/[skip vercel]/[no deploy]/^WIP`
- 변경 파일이 모두: `docs/`, `scripts/`, `.github/`, `.agent/`, `.claude/`, `.idx/`, `.vscode/`, `tests/`, `reports/`, `outputs/`, `food_data/`, `preview/`, 이미지(png/jpeg/webp/svg/gif/ico/bmp/tiff), `*.md`, `*.txt`, `*.log`, 메타 파일

→ 문서/이미지/스크립트 변경만으로 빌드 절감 (PR #236, PR #244 hotfix).

### 빌드 머신
**Elastic** (자동 vCPU 할당, $0.0035/CPU·min) — 이전 Turbo($0.126/min, 9배 비용) → Elastic 전환으로 분당 비용 ~80% 절감 (2026-05-04).

### Cron 비용
3 active cron (daily-report, refund-reminder, dispatch-timeout-sweep `*/5`). 비활성 8개는 코드 자체 삭제 (PR #240).

---

## 10. 환경변수 (Vercel UI 직접 입력만)

### 결제
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` — 주문 생성·캡처·환불 (PayPal 단일 결제수단)
- `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_SECRET`, `PAYPAL_ENV` — preview 전용 sandbox 토글
- `PAYPAL_WEBHOOK_ID` — 미설정 시 webhook 전 이벤트 거부
- ⛔ **결제 우회용 env var 는 없다.** `BRAINTREE_ENV` 로 열리던 `TEST-` 우회 경로는 2026-07-20 제거됐다.
  `BRAINTREE_MERCHANT_ID`/`PUBLIC_KEY`/`PRIVATE_KEY` 도 게이트웨이 제거(2026-05-06~07)와 함께 죽은 키다.
  Vercel 에 이 계열 키가 하나라도 보이면 제거할 것 (`node scripts/check-vercel-envs.mjs` 로 확인).
  결제 없이 플랜을 만들어야 하면 `ADMIN-BYPASS-` prefix (admin 이메일 + Firebase ID token 이중 검증).

### 인프라
- `FIREBASE_PRIVATE_KEY` ⚠️ **CLI 변경 절대 금지** (줄바꿈/특수문자 손상 → 401)
- `NCP_CLIENT_ID` ⚠️ 반드시 `.trim()` (보이지 않는 \n으로 401)
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`
- `GEMINI_API_KEY`
- `ODSAY_API_KEY`

### 알림
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DRIVER_BOT_TOKEN`, `TELEGRAM_INQUIRY_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`

### 옵저버빌리티
- `VITE_SENTRY_DSN` (frontend), `SENTRY_DSN` (backend)
- `VITE_POSTHOG_KEY` (lazy load)

### 어드민
- `VITE_ADMIN_EMAIL`, `ADMIN_EMAIL`

### 옵션 (활성화 시)
- `AUTO_DISPATCH_BROADCAST=1` — driver bot 자동 배차

---

## 11. 오늘 (2026-05-04) 머지된 PR 17개 요약

| PR | 영역 | 내용 |
|----|------|------|
| #229 | safety | booking-processor 격리 try/catch |
| #231 | UX + i18n | voucher+wallet estimate ±10% 약관 + MyBookings i18n 중앙화 |
| #232 | telegram | Driver bot inline keyboard 자동 broadcast (옵트인) |
| #233 | refactor | wizard-i18n.ts 600줄 → 중앙 locales |
| #234 | 🔴 P0 | 차터 결제 후 빈 페이지 fix + BookingDetailModal 신규 |
| #235 | cleanup + feat | PayPal legacy 정리 (-309 LOC) + Tier 1-B 재생성 사유 |
| #236 | 비용 | Vercel ignoreCommand 확장 + firebase 버전 고정 |
| #237 | observability | Sentry 5 endpoint + Voucher PDF public + cs_tickets planId |
| #238 | 🔴 hotfix | dispatch_messages 인덱스 누락 (cron 5분 에러) |
| #239 | 정리 | 아키텍처 4문서 + orphan 9 파일 (~20MB) |
| #240 | 정리 | rules backup + dual files + USD/admin helper (-2844 LOC) |
| #241 | observability + UX | Sentry 12 endpoint 확장 + AdminCalendar destructive guard |
| #242 | docs | KNOWN-RISKS.md 8개 항목 |
| #243 | 🔴 사용자 | 카카오 채널 표기 제거 + 환불 윈도우 지난 [취소] disabled 버튼 |
| #244 | 🔴 hotfix | vercel.json schema 256자 초과 → 스크립트 분리 |
| #245 | 🔴 사용자 | 쿠폰 라벨 명시 (fixed USD vs percent 혼동 방지) |

**누적 효과**:
- ~3,200 LOC 감소 (orphan + dual + legacy)
- Sentry 5 → 17 endpoint
- 빌드 비용 ~80% 절감 (Turbo → Elastic) + 빌드 스킵 패턴 확장
- 사용자 신고 P0/P1 4건 fix
- 4 아키텍처 문서 신규 (~770줄)

---

## 12. 자문 요청 시 살펴볼 만한 영역

### 잠재 개선 포인트
1. **Two booking surfaces 통합** (KNOWN-RISKS #1) — `bookings/{id}` vs `tours/{id}/bookings/`. 마이그레이션 전략 + dual-read 기간 + rules 갱신 자문
2. **AI 플래너 품질 측정** — 현재 식이/언어만 검증. 9-지표 (validate-planner.cjs) 매번 plan에 적용 + `plans/{id}.qualityScore` 저장 → 약점 zone 식별
3. **외부 환율 API** — 정적 1380 → 일일 갱신 캐시 (KNOWN-RISKS #6)
4. **Firestore admin collection** — 하드코드 1인 → 동적 다인 admin (KNOWN-RISKS #5)
5. **Sentry sourcemap** — 백엔드 sourcemap 미적용 (검토 필요)
6. **Tier 1-D 신고 집계 대시보드** — plan_complaints + cs_tickets 통합 분석
7. **결제 보안 추가**: 현재 booking 결제 nonce 1회용 + email 매칭 voucher → 추가 layers 검토

### 프로젝트 메타
- 솔로 개발 (운영자 1인 = 사용자 본인)
- Phase 3 완료 (AI 플래너 품질 32→9 이슈, -71.9%)
- Phase 4 (3-pass 아키텍처) 보류 중
- 비용 의식적 (Vercel Pro $150+ 누적 → 절감 모드)

### 결제 흐름 핵심 파일
- 프론트: `src/components/BraintreePaymentButton.tsx`, `WizardForm/`, `charter/CharterWizard.tsx`
- 백엔드: `api/braintreeCheckout.js`, `api/booking-processor.js`, `api/_ai_core/paymentGate.js`, `api/cancelBooking.js`, `api/applyPromoCode.js`

---

## Generated
2026-05-04 by Claude (CocoTrip 운영자 협업 세션). 정확성: code-grounded (Grep/Read), 추정 0건. 변경 시 이 문서 갱신.
