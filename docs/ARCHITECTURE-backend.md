# CocoTripKR Backend Architecture (READ-ONLY MAP)

> Generated 2026-05-04. Sourced from `api/`, `vercel.json`, `firestore.indexes.json`, `firestore.rules`, `CLAUDE.md`.
> This file is a static map for future Claude sessions. Re-generate if `api/` structure changes substantially.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Vercel Serverless (Node.js, ESM) |
| Database | Firebase Firestore (Admin SDK) |
| AI | Google Gemini 2.5 Flash (`@google/generative-ai`) |
| Payments | Braintree (current) + PayPal (legacy refunds only) |
| Maps / Transit | Naver Maps NCP (Geocoding/Directions) + ODsay (대중교통) |
| Email | Gmail SMTP via `nodemailer` |
| Sheets / Wallet | Google Sheets API + Google Wallet (issuer pass) |
| Notifications | 3 Telegram bots (admin/driver/inquiry) + Web Push (VAPID) |
| Observability | Sentry (`@sentry/node`) |
| Plan | Vercel Pro (max function duration 300s on `ai-planner-full`) |

Project root: `E:\ai에이젼시만들기\홈페이지 클로드ai\홈페이지 사이트 최근`
Canonical Vercel project: `cocotrip-source_2026` → `cocotripkr.com`

---

## 2. API Endpoints

Total `.js` files in `api/` root: **53** (excludes subdirs `_ai_core/`, `_shared/`, `_crons/`, `_data/`, `pdf/`).

### 2.1 Public — User-facing

| Endpoint | Purpose |
|---|---|
| `api/ai-planner-full.js` | Full AI planner pipeline (Gemini + DB matcher + RouteAgent + persist). `maxDuration=800`, `memory=768`. P270 (2026-05-29). |
| `api/ai-planner-quick.js` | Quick/preview planner. `maxDuration=60`, `memory=512`. |
| `api/translate-plan.js` | Per-language translation cache for stored plans. |
| `api/recalc-transit.js` | Re-run Naver+ODsay enrichment on an existing plan. |
| `api/plan-status.js` | Polling status for async plan generation. |
| `api/submit-plan-complaint.js` | User-submitted plan complaint → `plan_complaints`. |
| `api/booking-processor.js` | Post-payment booking creation pipeline. `maxDuration=60`. |
| `api/braintreeClientToken.js` | Issues Braintree client token. |
| `api/braintreeCheckout.js` | Server-side Braintree transaction.sale(). |
| `api/applyPromoCode.js` | Validate + redeem promo/coupon. |
| `api/loyalty.js` | Points / coupons / share & review rewards. |
| `api/my-bookings.js` | User booking list (auth scoped). |
| `api/cancelBooking.js` | User cancel + refund routing. |
| `api/modifyBooking.js` | User edit booking. |
| `api/check-availability.js` | Reads `availability/{date}`. |
| `api/reserve-slot.js` | Holds inventory in `reservations/{id}` + `availability/{date}`. |
| `api/voucher.js` | Booking voucher data. |
| `api/refundPolicy.js` | Refund policy quote. |
| `api/reviews.js` | Create / list / moderate reviews. |
| `api/notify-claim.js` | "Already booked → free plan" claim notification. |
| `api/chat.js` | One-shot AI chat (Gemini, FAQ/Charter/Special routing). |
| `api/chat-poll.js` | Customer ChatWidget poll (avoids exposing Firestore). |
| `api/place-photo.js` | Google Places photo proxy. |
| `api/og-image.js` | OG image renderer. `maxDuration=30`, `memory=256`. |
| `api/pdf/generate.js` | Server-side PDF (uses `_data/*.afm` fonts). |
| `api/testEmail.js` | Gmail SMTP smoke test. |

### 2.2 Admin — Auth-gated via `_shared/admin-auth.js`

| Endpoint | Purpose |
|---|---|
| `api/admin-bookings.js` | Booking list / filter / export. |
| `api/admin-plan-lookup.js` | Plan + complaints inspection. |
| `api/admin-sales.js` | Sales aggregation. |
| `api/admin-replay-booking-notifications.js` | Re-fire booking emails / Telegram. |
| `api/admin-scan-suspect-bookings.js` | Detects suspicious / orphan bookings. |
| `api/admin-posthog-funnel.js` | PostHog funnel proxy (uses `POSTHOG_PERSONAL_API_KEY`). |
| `api/admin-test-push.js` | Web Push smoke test for an admin. |

### 2.3 Webhooks

| Endpoint | Purpose |
|---|---|
| `api/telegram-webhook-admin.js` | Admin bot — `/dispatches`, `/drivers`, `/cs`, `/claims` etc. Most complex (~1000L). Verifies `TELEGRAM_WEBHOOK_SECRET`. |
| `api/telegram-webhook-driver.js` | Driver bot — accept/decline dispatch, status updates. |
| `api/telegram-webhook-inquiry.js` | Customer inquiry bot — relays to `chat_sessions` via `_shared/chat-relay.js`. |

(No PayPal webhook endpoint found — refunds are admin-initiated.)

### 2.4 Cron — Routed through `api/cron-runner.js`

`vercel.json` cron entries (all hit `/api/cron-runner?job=<name>`):

| Schedule | Job | Handler |
|---|---|---|
| `0 22 * * *` | `daily-report` | `api/_crons/daily-report.js` — Stats from `api_stats/{YYYY-MM}/daily/{YYYY-MM-DD}`, totals from `users` + `plans`, sends Telegram digest. |
| `0 23 * * *` | `refund-reminder` | `api/_crons/refund-reminder.js` — Scans `bookings` due-soon refunds, Telegram alert. |
| `*/5 * * * *` | `dispatch-timeout-sweep` | `api/_crons/dispatch-timeout-sweep.js` (calls `_shared/dispatch-sweep.js`) — Re-broadcasts unanswered dispatches. |

`cron-runner.js` `maxDuration=60`. Disabled (commented-out) crons in `_crons/`: `traffic-alert`, `content-generator`, `competitor-monitor`, `retarget-scheduler`, `review-scheduler`, `reddit-monitor`, `weather-check`, `blog-publisher` — files exist but unwired since 2026-04-10.

### 2.5 Internal Helpers (`_*.js` — not routable as webhooks; called via import)

| File | Role |
|---|---|
| `api/_ai-employees.js` | Multi-agent runner (Gemini-based content/marketing). |
| `api/_ai-planner-legacy.js` | Pre-modularization fallback. |
| `api/_booking-templates.js` | Email + Telegram booking message templates. |
| `api/_create-wallet-pass.js` | Google Wallet JWT for boarding pass. |
| `api/_email-renderer.js` | Confirmation email HTML/text (with `name`/`display_name` fallback). |
| `api/_exchange-rate.js` | KRW/USD helper. |
| `api/_food_helper.js` | Loads `_food_index.json`, builds `getFoodContext` for prompt injection. |
| `api/_food_index.json` | ⚠️ 1.2MB DO NOT DELETE. Built by `scripts/build-food-index.js`. |
| `api/_korea_spots.json` | Spot DB. |
| `api/_spots_helper.js` | Spot context for prompt. |
| `api/_odsay_helper.js` | ODsay transit + subway realtime (`SUBWAY_REALTIME_KEY`). |
| `api/_transit_localization.js` | Transit text → ko/en/ja/zh. |
| `api/_refund-policy.js` | Refund tier rules. |
| `api/_pricing_spec.json` | Pricing matrix. |
| `api/_send-email.js` | nodemailer wrapper (Gmail SMTP). |
| `api/_send-push.js` | Web Push (`web-push` lib + VAPID). |
| `api/_plan-ready-push.js` | Pushes "your plan is ready". |
| `api/_telegram.js` | Legacy Telegram helper (single-bot). |
| `api/_google-sheets.js` | Sheets append/lookup for leads/feedback/audit. |
| `api/_generate-voucher.js` | Voucher PDF/image. |

### 2.6 Shared Modules (`api/_shared/`)

| File | Role |
|---|---|
| `admin-auth.js` | Verifies admin Firebase ID token; matches `ADMIN_EMAIL`. |
| `braintree.js` | Braintree gateway singleton. |
| `paypal.js` | PayPal access-token (legacy refunds). |
| `firebase-admin.js` | Admin SDK init (handles `FIREBASE_PRIVATE_KEY` `\n` decode + `GOOGLE_SERVICE_ACCOUNT_KEY` base64 fallback). |
| `pricing.js` | Charter / tour pricing. |
| `notify.js` | Multi-bot Telegram dispatch (admin/driver/inquiry tokens). |
| `telegram-bot.js` | Webhook secret verification + send helpers. |
| `dispatch-helpers.js` | Driver lookup, dispatch send, message logging to `dispatch_messages`. |
| `dispatch-sweep.js` | Stale dispatch re-broadcast logic (cron). |
| `chat-relay.js` | Two-way bridge `chat_sessions` ↔ Telegram inquiry bot. |
| `response.js` | Standard JSON response shape. |
| `sentry.js` | Sentry init + `captureError(err, context)` helper. |
| `log.js` | Production-aware logger. |

### 2.7 AI Core (`api/_ai_core/`) — 18 modules

| Module | Role |
|---|---|
| `buildPrompt.js` | Assembles Gemini system prompt + logs prompt metrics. |
| `responseValidator.js` | Validates language, dietary restrictions, required fields. |
| `dbMatcher.js` | Maps Gemini output to `_food_index.json` entries. |
| `sanitizeName.js` | Strips `"대한민국 "` / `"KR "` address prefixes. |
| `geminiPipeline.js` | Legacy 1-pass call + JSON parse + repair. |
| `threePassPipeline.js` | New 3-pass mode (`PLANNER_MODE=3pass`). |
| `routeEnrichment.js` | Calls RouteAgent (Naver Geocoding + ODsay). |
| `planPersister.js` | T-money calc + Firestore `plans` write. |
| `paymentGate.js` | PayPal/Braintree verification + revision counter. |
| `vehicleAndPrice.js` | `selectVehicle`, `calcPrice`, `VEHICLE_LABELS`. |
| `recommendedRestaurants.js` | `pickRecommendedRestaurants`. |
| `avoidListQuery.js` | `buildAvoidClause` for user avoid list. |
| `emailNotifier.js` | `sendNotificationEmail`, `recordLeadToSheets`. |
| `firestoreAdmin.js` | `initAdminDb()` singleton. |
| `orchestrator.js` / `.ts` | Top-level pipeline orchestrator. |
| `models.js` / `.ts` | Type defs. |
| `config.js` / `.ts` | Constants. |
| `constants.js` | Static lookups. |
| `agents/RouteAgent.js` (+ `.ts`) | Naver geocoding + ODsay transit + time stitching. |
| `agents/QAAgent.js` (+ `.ts`) | Plan QA pass. |
| `agents/SimpleAgents.js` (+ `.ts`) | Lightweight composable agents. |
| `agents/BaseAgent.js` (+ `.ts`) | Abstract base. |

> Both `.js` and `.ts` exist for several core modules — runtime imports `.js`; `.ts` are reference / source-of-truth.

---

## 3. Firestore Schema

### 3.1 Collections (from rules + `db.collection(` grep)

| Collection | Owner | Notes |
|---|---|---|
| `plans` | server-write, owner-update | AI planner output. Has subcollection `translations/{lang}`. |
| `plan_complaints` | server | User complaints. Indexed `(planId, userEmail, createdAt)`. |
| `bookings` | server-write, admin-update | Top-level. Indexed `(userEmail, createdAt)`, `(status, createdAt)`, `(provider, status, createdAt)`. |
| `booking_costs/{bookingId}` | admin-only | ProfitSettlement: driver/fuel/toll/parking/meal/other/overtime. |
| `tours/{tourId}/bookings/{bookingId}` | user-create | Per-tour booking subcollection (legacy/parallel). |
| `tour_availability/{tourId}/dates/{YYYY-MM-DD}` | admin-write, public-read | `available` / `fully_booked` / `blackout`. |
| `tours` | admin-write, public-read | Catalog. |
| `users/{uid}` | owner | Subcollections: `plans`, `pointHistory`, `coupons`, `wishlist`, `recentlyViewed`, `itineraries`, `shareRewards`, `reviewRewards`. |
| `push_subscriptions/{uid_subId}` | owner | VAPID Web Push. |
| `earlybird/{docId}` | public-read | Counter. |
| `reviews` | server-create, admin-mod | Public read. Schema validated in rules. |
| `charter_inquiries` | public-create, admin-mod | "전세차량 견적 요청" email-scoped. |
| `pending_free_claims` | public-create, admin-mod | Free-plan claims. |
| `calendar_blocks` | admin-only | Vehicle/driver downtime. |
| `cs_tickets` | admin-only | CS Kanban: `open`/`in_progress`/`resolved`, priority `low`–`critical`. |
| `drivers/{telegramChatId}` | admin-only | Registered drivers (Telegram chat_id as doc ID). |
| `dispatch_messages` | server (Admin SDK) | Audit log. Indexed `(status, expiresAt)`. |
| `chat_sessions/{sessionId}/messages/{msgId}` | admin-only / server | Two-way customer chat. |
| `inquiry_messages/{telegramMsgId}` | server-only | Telegram message_id ↔ session mapping. |
| `availability/{date}` | server-only | Slot inventory. |
| `reservations/{id}` | server-only | Slot holds. |
| `used_paypal_orders/{orderId}` | server-only | PayPal idempotency. |
| `api_stats/{YYYY-MM}/daily/{YYYY-MM-DD}` | server-only | Usage stats (daily-report cron consumer). |
| `chat_rate_limits/{key}` | server-only | Chat rate limit. |

### 3.2 Composite Indexes (`firestore.indexes.json` — 6 total)

1. `bookings` — `userEmail` ASC, `createdAt` DESC
2. `bookings` — `status` ASC, `createdAt` DESC
3. `bookings` — `provider` ASC, `status` ASC, `createdAt` DESC
4. `plan_complaints` — `planId` ASC, `userEmail` ASC, `createdAt` DESC
5. `plans` — `userEmail` ASC, `createdAt` DESC
6. `dispatch_messages` — `status` ASC, `expiresAt` ASC

### 3.3 Rules summary

- Admin gate: `request.auth.token.email == '2001leety@gmail.com'`.
- `plans` create/delete is **server-only** (Admin SDK). Owner can update (but not change `uid`).
- `bookings` top-level: read for owner-by-email or admin; create only by admin server (with `createdBy == 'admin'`); user bookings created via Admin SDK from `booking-processor.js`.
- Public reads: `tours`, `tour_availability`, `earlybird`, `reviews`, public/anonymous `plans` (via `isPublic` or null `uid`).
- Default-deny — no catch-all `allow`.

---

## 4. External Integrations

| Service | Env Vars | Purpose | Files |
|---|---|---|---|
| Gemini AI | `GEMINI_API_KEY` | Plan generation, chat, content | `_ai_core/*`, `chat.js`, `translate-plan.js`, `_ai-employees.js` |
| Braintree (current) | `BRAINTREE_MERCHANT_ID`, `BRAINTREE_PUBLIC_KEY`, `BRAINTREE_PRIVATE_KEY`, `BRAINTREE_ENV` (`sandbox` / `production`) | Card payments | `_shared/braintree.js`, `braintreeClientToken.js`, `braintreeCheckout.js` |
| PayPal (legacy) | `PAYPAL_CLIENT_ID` / `SECRET` + `PAYPAL_SANDBOX_*` | Old order verify, refunds only | `_shared/paypal.js`, `_ai_core/paymentGate.js` |
| Firebase Admin | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (or `GOOGLE_SERVICE_ACCOUNT_KEY` base64 fallback) | Firestore admin | `_shared/firebase-admin.js`, `_ai_core/firestoreAdmin.js` |
| Naver Maps NCP | `NCP_CLIENT_ID` / `_SECRET` (legacy) **and** `NAVER_CLIENT_ID` / `_SECRET` | Geocoding, directions | `_ai_core/agents/RouteAgent.js`, `recalc-transit.js`, `_crons/traffic-alert.js` |
| ODsay | `ODSAY_API_KEY` + `SUBWAY_REALTIME_KEY` | Public transit | `_odsay_helper.js`, `_ai_core/routeEnrichment.js` |
| Google Places | `GOOGLE_PLACES_API_KEY` | Place photos, lat/lng fallback | `place-photo.js`, `RouteAgent.js` |
| Google Sheets | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (or `GOOGLE_SERVICE_ACCOUNT_KEY` base64), `GOOGLE_SHEETS_SPREADSHEET_ID` | Leads, feedback, audit | `_google-sheets.js`, `_ai_core/emailNotifier.js`, `admin-bookings.js` |
| Google Wallet | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_CLASS_ID` (+ service account) | Boarding pass JWT | `_create-wallet-pass.js` |
| Gmail SMTP | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Confirmation + admin emails | `_send-email.js`, `_ai_core/emailNotifier.js`, `testEmail.js` |
| Telegram (3 bots) | `TELEGRAM_ADMIN_BOT_TOKEN` (or legacy `TELEGRAM_BOT_TOKEN`), `TELEGRAM_DRIVER_BOT_TOKEN`, `TELEGRAM_INQUIRY_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | 3-way bot split (admin/driver/inquiry) | `telegram-webhook-*.js`, `_shared/notify.js`, `_shared/telegram-bot.js`, `_telegram.js` |
| Web Push (VAPID) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Browser push | `_send-push.js`, `_plan-ready-push.js`, `admin-test-push.js` |
| Sentry | `SENTRY_DSN` | Error capture | `_shared/sentry.js` |
| PostHog | `POSTHOG_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | Funnel analytics (admin) | `admin-posthog-funnel.js` |
| Blogger (disabled) | `BLOGGER_BLOG_ID` | Cron-disabled blog publisher | `_crons/blog-publisher.js` |
| Misc | `KRW_USD_RATE` (default 1380), `AUTO_DISPATCH_BROADCAST` (`'1'` flag), `ADMIN_EMAIL` (or `VITE_ADMIN_EMAIL`), `PLANNER_MODE` (`legacy` / `3pass`), `VERCEL_URL`, `VERCEL_ENV`, `NODE_ENV` | Tuning / runtime | various |

---

## 5. AI Planner Pipeline

Per `CLAUDE.md` D 절. `api/ai-planner-full.js` (307L) is now thin — branches on `PLANNER_MODE`.

```
WizardForm (frontend)
  → POST /api/ai-planner-full
    1. paymentGate.js              — Verify PayPal/Braintree, count revisions
    2. avoidListQuery.js           — buildAvoidClause from user avoid list
    3. _food_helper.js             — getFoodContext from _food_index.json
    4. _spots_helper.js            — Spot context
    5. buildPrompt.js              — Assemble Gemini system prompt
    6. geminiPipeline.js           — Gemini 2.5 Flash call + JSON parse + repair
       (or threePassPipeline.js when PLANNER_MODE='3pass')
    7. sanitizeName.js             — Strip "대한민국 " / "KR " prefixes
    8. responseValidator.js        — validateResponse (language, dietary)
    9. dbMatcher.js                — Map restaurants to _food_index.json
   10. recommendedRestaurants.js   — pickRecommendedRestaurants
   11. routeEnrichment.js          — RouteAgent: Naver Geocoding + ODsay Transit
   12. vehicleAndPrice.js          — selectVehicle + calcPrice + T-money
   13. planPersister.js            — Firestore write (plans/{planId})
   14. emailNotifier.js            — Gmail SMTP confirmation + Sheets lead
  → response (planId)
PlanDetailPage.tsx → render + html2pdf
```

`maxDuration = 800s` (Vercel Pro Fluid Compute, P270 2026-05-29). Sentry `captureError` wraps the handler.

---

## 6. Cron Jobs (Active)

| Name | Schedule | Job |
|---|---|---|
| `daily-report` | `0 22 * * *` (22:00 KST) | Aggregates `api_stats` + `users`/`plans` totals → Telegram digest |
| `refund-reminder` | `0 23 * * *` (23:00 KST) | Scans `bookings` for upcoming refund deadlines → Telegram |
| `dispatch-timeout-sweep` | `*/5 * * * *` | Re-broadcasts unanswered `dispatch_messages` |

Disabled jobs (files retained, not wired in `cron-runner.js`): `traffic-alert`, `content-generator`, `competitor-monitor`, `retarget-scheduler`, `review-scheduler`, `reddit-monitor`, `weather-check`, `blog-publisher`.

---

## 7. Observability

`_shared/sentry.js` exposes `captureError(err, context)` and `captureMessage`. Currently called from:

- `api/ai-planner-full.js` (planner pipeline failures)
- `api/booking-processor.js` (booking creation failures)
- `api/braintreeCheckout.js` (payment failures)
- `api/cancelBooking.js` (cancellation/refund failures)
- `api/chat.js` (Gemini chat failures)

Sentry release = `VERCEL_GIT_COMMIT_SHA`. Environment = `VERCEL_ENV` (`production`/`preview`/`development`).

Other observability:
- `api/_shared/log.js` — production-aware console wrapper.
- `api_stats/{YYYY-MM}/daily/{YYYY-MM-DD}` — internal counter Firestore docs.
- PostHog (admin funnel only via `admin-posthog-funnel.js`).

---

## 8. Critical Env Vars (per CLAUDE.md I 절)

> Vercel Dashboard ONLY — never set via `vercel env add` CLI. All 23 keys must be present in production / preview / development simultaneously.

| Var | CRITICAL Note |
|---|---|
| `FIREBASE_PRIVATE_KEY` | DO NOT trim. Pattern: `(env || '').replace(/\\n/g, '\n')` only. Trim/PEM-reformat caused PR #171/#172/#173 prod outages. |
| `NCP_CLIENT_ID` | MUST `.trim()` — invisible newline causes 401. |
| `GEMINI_API_KEY` | Trim only. |
| `BRAINTREE_ENV` | `sandbox` until live cutover. |
| `TELEGRAM_WEBHOOK_SECRET` | Verifies webhook headers. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | base64-encoded JSON; fallback path for both Firebase Admin and Sheets. |

Preview deploys silently fail when a new key is added to production only — register in all 3 environments simultaneously.

---

## 9. Notable Findings

- **Dual `.js` + `.ts` in `_ai_core/`** for `orchestrator`, `models`, `config`, and all `agents/*`. Runtime uses `.js`; `.ts` is reference. Watch for drift.
- **Legacy planner** `_ai-planner-legacy.js` still in tree but only reachable via `PLANNER_MODE=legacy` branch of `geminiPipeline.js`.
- **8 unwired cron files** in `_crons/` — disabled 2026-04-10 but JS still ships.
- **Two parallel booking surfaces**: top-level `bookings/{id}` (Braintree path, server-created via Admin SDK) **and** `tours/{tourId}/bookings/{bookingId}` (user-created subcollection, used by older tour catalog flow).
- **Two PayPal env-var sets** (`PAYPAL_CLIENT_ID/SECRET` + `PAYPAL_SANDBOX_*`) — runtime picks based on env flag; Braintree migration in progress (PR #213-#222).
- **Single admin email** `2001leety@gmail.com` is hard-coded in `firestore.rules` `isAdminEmail()`. Adding admins requires rule change.
- **No PayPal webhook endpoint** — refunds are admin-initiated, not webhook-driven.
- `availability/{date}` + `reservations/{id}` collections exist but only `tour_availability/...` is exposed to clients — the older two are server-only (rule: deny all).
