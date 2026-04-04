# CocoTrip KR — Project Context

## Overview
CocoTrip KR (`cocotripkr.com`) is a B2C inbound tourism platform targeting foreign tourists visiting South Korea.
Core offerings: AI-powered travel itinerary generation, private charter vehicles, K-pop concert shuttles, and airport transfers.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | **React 19 + Vite 7** (SPA, client-side routing via `react-router-dom`) |
| Language | **TypeScript** (strict mode, `tsc -b && vite build`) |
| Styling | **Tailwind CSS 3.4** + Radix UI primitives + `lucide-react` icons |
| State | React hooks (`useState`, `useRef`, `useContext`) — no Redux/Zustand |
| i18n | Custom `useLanguage()` hook + single `src/i18n/index.ts` (ko/en/ja/zh) |
| Auth | **Firebase Auth** (Google Sign-In with redirect fallback) |
| Payments | **PayPal REST API** (sandbox/live toggle via `PAYPAL_MODE`) |
| AI | **Google Gemini 2.5 Flash** (`@google/generative-ai`) |
| Email | **Nodemailer** (Gmail SMTP) + **EmailJS** (client-side) |
| Maps | Naver Maps API (client ID via env) |
| Sheets | **Google Sheets API** (booking log, daily reports) |
| Notifications | Telegram Bot API (admin alerts) |
| PDF | **PDFKit** + **QRCode** (voucher generation) |
| Hosting | **Vercel** (serverless functions in `api/`, cron jobs) |
| Domain | `cocotripkr.com` (Vercel alias) |
| Repo | GitHub — `2001leety-code/cocotrip-source-` |

## Deployment
- **Platform**: Vercel (production deploy via `npx vercel --prod --yes`)
- **Config**: `vercel.json` with SPA rewrites, COOP headers, 60s function timeout
- **Build**: `npm run build` → `tsc -b && vite build` → output to `dist/`
- **Cron Jobs**: 8 scheduled jobs (daily-report, traffic-alert, content-generator, competitor-monitor, retarget-scheduler, review-scheduler, reddit-monitor, weather-check)

## Environment Variables (Keys Only)
**Server-side (api/):**
`GEMINI_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

**Client-side (VITE_):**
`VITE_FIREBASE_*` (6 keys), `VITE_PAYPAL_CLIENT_ID`, `VITE_NAVER_CLIENT_ID`, `VITE_NAVER_CLIENT_SECRET`, `VITE_ADMIN_EMAIL`

## Directory Structure
```
/
├── api/                    # Vercel serverless functions
│   ├── _ai_core/           # AI agent system prompts
│   ├── _crons/             # 9 cron job handlers
│   ├── _data/              # Static data for APIs
│   ├── ai-planner-*.js     # AI itinerary endpoints
│   ├── booking-processor.js
│   ├── capturePaypalOrder.js / createPaypalOrder.js
│   ├── chat.js             # Chat widget backend
│   ├── applyPromoCode.js   # Coupon/promo system
│   └── cron-runner.js      # Cron dispatcher
├── src/
│   ├── components/         # Reusable UI components
│   ├── sections/           # Landing page sections
│   ├── pages/              # Route-level pages
│   ├── hooks/              # useAuth, useLanguage, use-mobile
│   ├── i18n/               # Single 125KB translation file
│   ├── data/               # charterPricing, kpopConcerts, seasonalSpots
│   ├── config/             # affiliateLinks
│   ├── services/           # bookingService
│   └── lib/                # Firebase init, utilities
├── vercel.json
├── firebase.json
└── package.json
```

## Routes
| Path | Component | Auth |
|------|-----------|------|
| `/` | HomePage | None |
| `/planner` | PlannerPage | Firebase Auth |
| `/charter` | CharterPage | Firebase Auth |
| `/booking` | Booking | None |
| `/admin` | Admin | Admin only |
| `/region/:regionId` | RegionDetail | None |
| `/about`, `/terms`, `/privacy`, `/travel-terms` | Static pages | None |
