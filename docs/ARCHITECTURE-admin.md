# CocoTrip Admin Operations — Read-Only Map

Generated: 2026-05-04. Scope: web admin pages (`/admin/*`) + 3 telegram bots + auto notifications. Source files are
absolute paths under `홈페이지 클로드ai/홈페이지 사이트 최근/`.

---

## 1. Admin Pages Table

All routes are gated by `AdminRoute` (`src/components/AdminRoute.tsx`) → Google sign-in + email match against
`VITE_ADMIN_EMAIL`. Server endpoints additionally re-verify via `verifyAdminToken()` (Firebase ID token →
`ADMIN_EMAIL` env). Firestore rules enforce a third layer (`isAdminEmail()`).

| Path | File | Purpose | Key actions |
|---|---|---|---|
| `/admin` | `src/pages/Admin.tsx` | Home dashboard — 9 quick-link cards + Google Sheets booking table + collapsible tour-creation form | List `/api/admin-bookings`, "🔔 Test Push" via `/api/admin-test-push`, create new tour doc in Firestore `tours/` |
| `/admin/reviews` | `src/pages/AdminReviews.tsx` | Reported-review moderation | List `reported`/`hidden`/`all` via `POST /api/reviews {action:'admin-list'}`, moderate via `{action:'moderate', decision:'keep'\|'hide'\|'delete'}` |
| `/admin/claims` | `src/pages/AdminClaims.tsx` | 2-tab moderation: **무료 신청** (`pending_free_claims`) + **차터 문의** (`charter_inquiries`) | Realtime `onSnapshot`, approve/reject via direct `updateDoc` (status + reviewedAt + reviewedBy + optional rejectReason). Pending counts shown per tab. |
| `/admin/reconciliation` | `src/pages/AdminReconciliation.tsx` | Suspect-booking scan + notification replay (PR #224) | `GET /api/admin-scan-suspect-bookings` lists candidates (CONFIRMED + braintree + replayedAt missing), `POST /api/admin-scan-suspect-bookings {dryRun:false}` bulk replay, `POST /api/admin-replay-booking-notifications {bookingId}` single replay. Flags `charter_custom_estimate` rows as 정산 필요. |
| `/admin/plans` | `src/pages/AdminPlans.tsx` | AI plan lookup + revisionCredits adjustment | `GET /api/admin-plan-lookup?email=` (list) or `?planId=` (detail w/ complaints), `POST {action:'addCredits', credits:±N}` adjust |
| `/admin/availability` | `src/pages/AdminTourAvailability.tsx` | Per-tour day toggle: available → fully_booked → blackout (cycle) | `fetchMonthAvailability` / `setAvailability` writes to Firestore `tour_availability/{tourId}/dates/{YYYY-MM-DD}` |
| `/admin/calendar` | `src/pages/AdminCalendar.tsx` | Monthly calendar of bookings + `calendar_blocks` | Realtime `onSnapshot` (current month ±1). Click date → drawer. Status cycling (pending→confirmed→completed→cancelled→pending) writes `bookings.adminStatus`. Add manual booking or block (`addDoc`/`setDoc` to either collection). |
| `/admin/sales` | `src/pages/AdminSales.tsx` | KPI dashboard (today/week/month/YTD) + daily bar chart + product breakdown + recent bookings | Reads `/api/admin-sales` (server aggregates Firestore bookings). Uses fixed exchange rate from `booking-processor`. |
| `/admin/analytics` | `src/pages/AdminAnalytics.tsx` | Firestore-derived analytics (12 product labels) — funnel, share-of-tour, monthly revenue | Direct `getDocs` on `bookings`. Categorizes ai_planner/charter/airport/combo/kpop. |
| `/admin/ops` | `src/pages/AdminOpsHub.tsx` | 5-tab operations hub | Tabs: **배차 타임라인** (`DispatchTimeline`), **텔레그램 로그** (`TelegramLogs`), **순수익 정산** (`ProfitSettlement`), **전환 퍼널** (`ConversionFunnel`), **리뷰 / CS** (`ReviewManagement`). Components live in `src/components/admin/`. |

`/admin` home grid currently renders **9 quick-link cards** (reviews, claims, reconciliation, plans, calendar,
sales, analytics, ops, availability). The 10th — Google-Sheets booking table + Test Push + tour-creation form — is
inline on the same page.

---

## 2. Admin Telegram Commands (`api/telegram-webhook-admin.js`, 1138 lines)

Auth: `X-Telegram-Bot-Api-Secret-Token` + `chat_id == TELEGRAM_CHAT_ID` (admin-only — other chats silently
ignored). Bot token: `TELEGRAM_ADMIN_BOT_TOKEN` → fallback `TELEGRAM_BOT_TOKEN`. Korean aliases via
`KOREAN_ALIASES` regex table; arguments may also be Korean. Total **15 commands** (excluding aliases).

| Slash command | Korean alias | Args | Effect / DB target |
|---|---|---|---|
| `/start` | 시작, 스타트 | — | Welcome text |
| `/help` | 도움, 도움말, 헬프, 명령(어) | — | `HELP_TEXT` (full reference) |
| `/explain` | 설명, 가이드, 매뉴얼, 사용법, 운영가이드 | — | `EXPLAIN_TEXT` (3-bot role + 3-step dispatch flow) |
| `/id` | 내아이디, 아이디 | — | Echo own `chat_id` |
| `/status` | 상태, 시스템상태 | — | "봇 webhook 정상 / Phase 2 / KST 시각" |
| `/drivers` | 기사, 기사목록, 기사명단 | — | List `drivers/*` (active/inactive) |
| `/driver_add` | 기사추가, 기사등록 | `<chatId> <name> [vehicle]` | `drivers/{chatId}.set({chatId, name, vehicle, active:true, registeredAt})` |
| `/driver_remove` | 기사삭제, 기사제거 | `<chatId>` | `drivers/{chatId}.delete()` |
| `/driver_off` | 기사휴무, 기사비활성, 기사오프 | `<chatId>` | `drivers/{chatId}.update({active:false})` |
| `/driver_on` | 기사출근, 기사활성, 기사온 | `<chatId>` | `drivers/{chatId}.update({active:true})` |
| `/whois` | 누구 | `<chatId>` | Driver profile + last-7-day dispatch stats (sent/accepted/rejected/expired) |
| `/dispatch` | 배차, 배차발송 | `<orderID> <driverChatId>` | (1) Reads `bookings/{orderID}`, (2) reads `drivers/{chatId}`, (3) sends inline-keyboard message via **driver bot**, (4) writes `dispatch_messages/{orderID_chatId}` (status: sent, expiresAt = sentAt+10min), (5) updates `bookings/{orderID}.dispatchedAt/dispatchedTo` |
| `/bookings` | 예약, 예약목록, 오늘예약 | `[YYYY-MM-DD]` (default: today KST) | Lists `bookings where tourDate==date`, totals USD, marks cancelled |
| `/sales` | 매출, 매출요약 | `[YYYY-MM]` (default: this month KST) | Aggregates bookings in month — total/avg/by-product (top 10), KRW conversion at fixed 1380 |
| `/cs_list` | 이슈, 이슈목록, 씨에스, cs | `[open\|in_progress\|resolved\|all]` (default: open) | Lists `cs_tickets` (limit 20) |
| `/cs_add` | 이슈추가, cs추가 | `<orderID> <priority> <issue...> [plan:<planId>]` | Creates `cs_tickets` with auto-filled `customer` (from booking.payerName/userEmail) and inferred `planId` if booking has one |
| `/cs_resolve` | 이슈해결, cs해결, 해결 | `<ticketId>` (full or 12-char prefix) | `cs_tickets/{id}.update({status:'resolved', resolvedAt})` |

**Lazy expiry sweep**: every admin webhook hit calls `sweepExpiredDispatches()` → auto-rejects dispatch_messages
older than 10 minutes (Hobby cron 1×/day workaround; even on Pro this remains active).

---

## 3. Driver Telegram Commands (`api/telegram-webhook-driver.js`, 378 lines)

Bot token: `TELEGRAM_DRIVER_BOT_TOKEN`. Drivers are anyone whose chat_id is registered via admin's
`/driver_add` — webhook does **not** restrict by chat_id (any user can `/start` to learn their id).

| Slash | Korean alias | Effect |
|---|---|---|
| `/start` | 시작, 스타트 | Onboarding text — tells driver to send 아이디 |
| `/help` | 도움, 도움말, 헬프, 사용법, 명령(어) | `HELP_TEXT` |
| `/explain` | 설명, 가이드, 매뉴얼, 운영가이드, 역할 | `DRIVER_EXPLAIN_TEXT` (registration + dispatch flow) |
| `/id` | 내아이디, 아이디, 내id, 내ID | Echo `chat_id` to forward to admin |

Driver bot is **command-light** by design — actual work is via inline-keyboard callbacks. Free-text messages get
"명령어를 사용해 주세요: /help".

---

## 4. Inquiry Bot (`api/telegram-webhook-inquiry.js`, 150 lines)

Bot token: `TELEGRAM_INQUIRY_BOT_TOKEN`. Strict admin-only: rejects any `chat_id != TELEGRAM_CHAT_ID`.

**Flow**: customer types in chat widget at cocotripkr.com → `/api/chat` calls `notify('inquiry', ...)` → message
arrives in this bot with a session_id encoded → admin **replies (Reply)** to that exact message → webhook detects
`reply_to_message_id` → calls `relayAdminReply()` → `chat-relay.js` looks up the session mapping → admin's text is
appended to customer's chat session in Firestore → customer sees it in widget.

| Command | Korean alias | Effect |
|---|---|---|
| `/explain`, `/help` | 설명, 가이드, 매뉴얼, 사용법, 도움말, 헬프 | `INQUIRY_EXPLAIN_TEXT` (warns: must use Reply, not new message) |
| (any non-reply text) | — | Big warning that the message reached **no one** + Reply instructions |

**Footnote** in code: `relayAdminReply` is also wired into `telegram-webhook-admin.js` (lines 178-194) — so the
inquiry bot is technically optional if running single-bot mode.

---

## 5. Auto Notifications Admin Receives

Routed through `api/_shared/notify.js` → channel-specific bot tokens (each channel can have its own bot, falling
back to `TELEGRAM_BOT_TOKEN`). All channels deliver to the same `TELEGRAM_CHAT_ID` (admin) — separation is purely
visual (Telegram groups messages per-bot in the app).

| When (trigger) | Channel | Bot token env | Message | Source file |
|---|---|---|---|---|
| New paid booking confirmed | `booking` | `TELEGRAM_BOOKING_BOT_TOKEN` | `sendBookingPaymentAlert` (USD/KRW + 환율 + 쿠폰 + transactionId) | `api/_telegram.js:173`, called by `api/booking-processor.js` |
| New paid booking — driver-relevant info | `dispatch` | `TELEGRAM_DISPATCH_BOT_TOKEN` | `sendDispatchAlert` (pickup→dropoff route, vehicle, pax, memo — financials stripped) | `api/_telegram.js:146` |
| Legacy single-message booking alert | `booking` | (booking) | `sendBookingAlert` (combined payment+booking, used by older callers) | `api/_telegram.js:102` |
| Booking cancelled / refund | `booking` + `dispatch` | (both) | Refund + dispatch-cancel pair | `api/cancelBooking.js:83-84` |
| Free-plan claim submitted | admin bot direct | `TELEGRAM_ADMIN_BOT_TOKEN` | `notify-claim.js` sends inline-keyboard `[✓ 승인][✗ 거부]` (callback prefix `claim_approve:` / `claim_reject:`) | `api/notify-claim.js` |
| Driver accepts dispatch | `dispatch` | (dispatch) | `✓ 배차 수락\n{orderID} → {driverName}` | `api/telegram-webhook-driver.js:297` |
| Driver rejects dispatch | admin direct + `dispatch` | (admin + dispatch) | `⚠️ 기사 거절 — 수동 재배차 필요` (sent twice — once via raw admin bot, once via dispatch channel) | `api/telegram-webhook-driver.js:353-374` |
| Dispatch 10-min timeout | `dispatch` | (dispatch) | Auto-reject + driver message PII purge | `api/_shared/dispatch-sweep.js:93` |
| Customer chat-widget message | `inquiry` | `TELEGRAM_INQUIRY_BOT_TOKEN` | Session id + customer message; admin replies → relay to widget | `api/chat.js:396` |
| API/automation error | `error` | `TELEGRAM_ERROR_BOT_TOKEN` | `sendErrorAlert(funcName, error)` — 함수명 + 메시지 + 시각 | `api/_telegram.js:201`, used by 28+ files |
| Daily report (cron) | `report` | `TELEGRAM_REPORT_BOT_TOKEN` | `api/_crons/daily-report.js` — 매출/AI 비용 등, 07:00 KST | `api/_crons/daily-report.js` |
| Plan complaint submitted | `booking` | (booking) | "사용자가 플랜 신고: {reason}" | `api/submit-plan-complaint.js:121` |
| Misc cron fire-and-forget | `report` / `error` | per-channel | refund-reminder, traffic-alert, content-generator, reddit-monitor, retarget-scheduler, weather-check, review-scheduler, competitor-monitor, blog-publisher | `api/_crons/*.js` |

**Channel summary** = 5 logical channels (`booking`, `dispatch`, `error`, `inquiry`, `report`) × N triggers above.
Roughly **14 distinct notification types** counted across the codebase.

---

## 6. Inline Keyboard Callbacks

| `callback_data` prefix | Bot that sends | Bot that handles | Handler | Effect |
|---|---|---|---|---|
| `accept:<orderID>` | admin (sends to driver bot) | driver | `handleAccept` (driver webhook) | `dispatch_messages.status=accepted`; `bookings.driver/driverChatId/vehicleType/dispatchStatus=accepted/dispatchedDriverId/acceptedAt`; edits driver's message to "✓ 배차 수락 완료"; notifies admin via `dispatch` channel |
| `reject:<orderID>` | admin (sends to driver bot) | driver | `handleReject` (driver webhook) | `dispatch_messages.status=rejected`; `bookings.dispatchStatus=rejected` (only if not already accepted — first-to-accept wins for broadcasts); strips PII from driver's message; sends `⚠️ 기사 거절` to admin bot **directly** + `dispatch` channel |
| `claim_approve:<claimId>` | admin (notify-claim.js) | admin | `handleClaimCallback` | `pending_free_claims/{id}.status=approved`; sends approval email via `sendEmail`; edits original message |
| `claim_reject:<claimId>` | admin (notify-claim.js) | admin | `handleClaimCallback` | Same path with status=rejected + default Korean rejectReason + rejection email |

Driver bot rejects unknown callbacks with toast "잘못된 콜백" / "만료된 배차 요청". Admin bot rejects non-claim
callbacks with toast "관리자봇은 일반 콜백 사용 안 함".

---

## 7. Admin Auth / Access Control (3 layers)

1. **Frontend route gate** — `src/components/AdminRoute.tsx`: requires Firebase auth user, then strict-equal
   `user.email.toLowerCase() === VITE_ADMIN_EMAIL`. Single-admin design (currently `2001leety@gmail.com`).
   Hard-coded fallback in `AdminClaims.tsx` (`user?.email === '2001leety@gmail.com'`) and `AdminReviews.tsx`
   (`ADMIN_EMAILS = ['2001leety@gmail.com']`) — these duplicate the env-based check. **Note**: only the env-driven
   `AdminRoute` actually mounts the page, so the page-level guards are belt-and-suspenders.
2. **Server endpoint gate** — `api/_shared/admin-auth.js#verifyAdminToken`: client passes Firebase ID token via
   `Authorization: Bearer …`; server calls `verifyIdToken()`, requires `email_verified=true`, compares lowercased
   `decoded.email` to `ADMIN_EMAIL` (or fallback `VITE_ADMIN_EMAIL`).
3. **Firestore rules** — `firestore.rules` enforces `isAdminEmail()` for collections like `pending_free_claims`,
   `cs_tickets`, `dispatch_messages`, etc.
4. **Telegram bots** — admin bot pins to `TELEGRAM_CHAT_ID`; inquiry bot pins to same; driver bot is open
   (anyone can `/start`/`/id`) but only registered drivers receive dispatch messages, and callbacks are scoped to
   `dispatch_messages/{orderID_chatId}` so a stranger clicking would not match a record. Webhook secret header is
   verified for all 3 bots.

---

## 8. Common Workflows

### A. Booking 검증·복구 (paid booking missed notification)
1. Admin opens `/admin/reconciliation` → autoload `GET /api/admin-scan-suspect-bookings` (CONFIRMED + braintree
   provider + replayedAt missing, ~last 24h).
2. Reviews candidates table; flagged 정산 필요 = `charter_custom_estimate` (post-trip distance reconciliation).
3. Click "알림 재전송" (single) or "일괄 재전송" (bulk, with confirm) → triggers replay endpoint → re-sends
   telegram + email + sheets + PDF, marks `replayedAt`.

### B. 환불 처리 (refund)
- API only — `api/cancelBooking.js`. UI sits on user-facing pages. Admin sees the result via parallel
  `notify('booking', refundMsg)` + `notify('dispatch', dispatchMsg)`. AdminCalendar can mark a booking
  `cancelled` via status cycling (writes `adminStatus`), but actual money refund is not in the admin UI.

### C. 클레임 승인/거부 (free-plan claim)
- Two equivalent paths:
  - **Telegram 1-click**: `notify-claim.js` posts inline `[✓ 승인][✗ 거부]` → `handleClaimCallback` → updates
    `pending_free_claims/{id}` + sends email. Default reject reason is canned ("예약 정보 검증 실패…").
  - **Web `/admin/claims`**: realtime list, approve/reject with custom reject reason via `window.prompt`
    (Korean). Writes same fields directly via `updateDoc` (no email here — email is only on telegram path).
- Tab 2 of `/admin/claims` (차터 문의) uses the **same** approve/reject pattern but writes
  `charter_inquiries/{id}`.

### D. 배차 (dispatch — manual + auto broadcast)
1. Manual single-driver: `/dispatch CT-… 1234567890` (admin bot) → driver inline keyboard → 10-min timeout.
2. Auto broadcast (multi-driver): triggered by `booking-processor` when a booking's productType qualifies
   (driver-broadcast.js → all `drivers where active=true`). First-to-accept wins; others' messages are
   auto-rejected on click (status check at top of `handleCallback`). `bookings.dispatchedDriverId` records the
   winning driver.

### E. 플랜 수정 (revisionCredits 조정 via /admin/plans)
1. Search by email or planId via `GET /api/admin-plan-lookup`.
2. Detail view shows itinerary + `complaintsCount` + complaints feed.
3. "+/-" credit slider → `POST … {action:'addCredits', credits:±N}` → server increments
   `plans/{planId}.revisionCredits`. Confirm prompt before destructive ops.

### F. CS 티켓 처리 (이슈)
- Telegram only. Web /admin/ops "리뷰 / CS" tab shows reviews + ticket overview but the CRUD path is bot:
  - `이슈추가 CT-… high plan:abc 픽업 30분 지연` → `cs_tickets` doc with auto-filled customer + planId.
  - `해결 abc123def456` → status=resolved + resolvedAt.
  - `이슈 open` → list (limit 20).

---

## Notable / 의외의 발견

- **Two `relayAdminReply` paths**: both `telegram-webhook-admin.js:178-194` and `telegram-webhook-inquiry.js`
  handle reply→widget relay. Comment in inquiry webhook says "단일 봇 운영 시엔 admin webhook이 같은 처리를 하므로
  본 파일은 사용 안 됨". So inquiry bot is optional duplication.
- **Driver-reject sends admin alert *twice***: once raw via `TELEGRAM_BOT_TOKEN` to `TELEGRAM_CHAT_ID` (line 362),
  once via `notify('dispatch', …)` (line 374). If `TELEGRAM_DISPATCH_BOT_TOKEN` is unset, dispatch falls back
  to `TELEGRAM_BOT_TOKEN` and the admin sees the same "수동 재배차 필요" alert duplicated in the same chat.
- **Sales `/sales` and `/admin/sales` use independent code paths** — telegram cmd does its own Firestore
  aggregation with hard-coded krwRate=1380; web page hits `/api/admin-sales` which uses `booking-processor.js`'s
  exchange rate. They can disagree.
- **`/admin` Test Push button** writes to `admin-test-push` endpoint that sends FCM to *all* admin's registered
  devices (not all users) — purely a dev tool for sanity-checking push token registration.
- **AdminCalendar status cycle** is destructive: cancelled→pending on next click. There is no undo, just keep
  cycling. Easy to mis-click.
- **Hardcoded admin email** in `AdminClaims.tsx:60` and `AdminReviews.tsx:31` parallel to env-based gate. If
  `VITE_ADMIN_EMAIL` ever changes, those files must also be updated.
- **`/cs_list` non-`all` filter** silently drops orderBy due to "where + orderBy 조합 시 인덱스 필요" — comment
  + code show two separate queries built but only one is executed. Result: filtered lists are not date-ordered.
- **AdminAnalytics fixed exchange rate** is duplicated as `USD_TO_KRW = 1380` (line 9) — same magic constant lives
  in 3 places (telegram /sales, AdminAnalytics, booking-processor default).
- **Tour-creation form** on `/admin` writes raw to `tours/` collection — no admin-token endpoint between client
  and Firestore. Relies on Firestore rules for `tours/` write protection.
