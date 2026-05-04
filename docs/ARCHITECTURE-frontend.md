# CocoTrip Frontend Architecture Map

> READ-ONLY orientation doc generated 2026-05-04. Source of truth: `src/App.tsx`, `package.json`, `src/main.tsx`. If routes diverge from this file, App.tsx wins.

---

## 1. Tech Stack

Vite 7 + React 19 + TypeScript 5.9 + react-router-dom 7 + Tailwind 3 + Radix UI + Firebase 12 (Auth + Firestore) + Braintree (`braintree-web-drop-in`) + Sentry + PostHog + Framer Motion + Zod. PWA via `vite-plugin-pwa`. Build output deployed to Vercel (`cocotripkr.com`).

---

## 2. Routes Table

All routes defined in `src/App.tsx` `<AnimatedRoutes/>` (lines 169-364). 23 active routes + 1 DEV-only.

| Path | Page Component | File | Access |
|---|---|---|---|
| `/` | `HomePage` (inline) | `src/App.tsx` L81 | public |
| `/region/:regionId` | `RegionDetail` | `src/pages/RegionDetail.tsx` | public |
| `/booking` | (redirect → `/tours`) | — | public |
| `/tours` | `ToursPage` | `src/pages/ToursPage.tsx` (554L) | public |
| `/tours/:slug` | `TourDetailPage` | `src/pages/TourDetailPage.tsx` (698L) | public |
| `/planner` | `PlannerPage` | `src/pages/PlannerPage/index.tsx` (158L) | public (payment-gated downstream) |
| `/charter` | `CharterNewPage` | `src/pages/CharterNewPage.tsx` (266L) | **auth** (`AuthRequired`) |
| `/charter-new` | (redirect → `/charter`) | — | — |
| `/charter-legacy` | `CharterPage` | `src/pages/CharterPage.tsx` | **auth** |
| `/about` | `About` | `src/pages/About.tsx` | public |
| `/terms` | `Terms` | `src/pages/Terms.tsx` | public |
| `/privacy` | `Privacy` | `src/pages/Privacy.tsx` | public |
| `/travel-terms` | `TravelTerms` | `src/pages/TravelTerms.tsx` | public |
| `/mypage` | `MyPage` | `src/pages/MyPage.tsx` (753L) | **auth** |
| `/my-plans` | `MyPlansPage` | `src/pages/MyPlansPage.tsx` | **auth** |
| `/my-plans/:planId` | `PlanDetailPage` | `src/pages/PlanDetailPage/index.tsx` (352L) | public (planId is access token) |
| `/admin` | `Admin` | `src/pages/Admin.tsx` (423L) | **admin** |
| `/admin/reviews` | `AdminReviews` | `src/pages/AdminReviews.tsx` | **admin** |
| `/admin/claims` | `AdminClaims` | `src/pages/AdminClaims.tsx` | **admin** |
| `/admin/reconciliation` | `AdminReconciliation` | `src/pages/AdminReconciliation.tsx` | **admin** |
| `/admin/plans` | `AdminPlans` | `src/pages/AdminPlans.tsx` | **admin** |
| `/admin/availability` | `AdminTourAvailability` | `src/pages/AdminTourAvailability.tsx` | **admin** |
| `/admin/sales` | `AdminSales` | `src/pages/AdminSales.tsx` | **admin** |
| `/admin/calendar` | `AdminCalendar` | `src/pages/AdminCalendar.tsx` | **admin** |
| `/admin/analytics` | `AdminAnalytics` | `src/pages/AdminAnalytics.tsx` | **admin** |
| `/admin/ops` | `AdminOpsHub` | `src/pages/AdminOpsHub.tsx` | **admin** |
| `/dev/transit-test` | `DevTransitTest` | `src/pages/DevTransitTest.tsx` | DEV only (`import.meta.env.DEV`) |

All page modules are `lazy()`-imported with `<Suspense fallback={<PlannerSkeleton/>}>` (charter uses `<CharterSkeleton/>`). `PlanDetailPage` uses `lazyRetry()` with one-shot reload to recover from stale chunks after deploy.

---

## 3. Critical User Flows

### F1 — AI Plan flow (paid, $9.90)
1. User lands on `/planner` → `src/pages/PlannerPage/index.tsx`
2. WizardForm at `src/components/WizardForm/index.tsx` (390L) drives Step0 Reservation → Step0 Destination → Step1 Food (halal/vegan/allergy SAFETY-CRITICAL) → Step2 Details → Step3 Review
3. Review step triggers payment via `src/components/BraintreePaymentButton.tsx` (TEST_ACCOUNTS bypass `2001leety@gmail.com`, line 164/173)
4. POST → `api/ai-planner-full.js` (Gemini 2.5 + DB matcher + RouteAgent + Firestore)
5. Redirect → `/my-plans/:planId` → `src/pages/PlanDetailPage/index.tsx` renders Day timelines + ad slides + PDF download via `pdfGenerator.ts` (933L)

### F2 — Charter flow (vehicle hire)
1. `/charter` → `CharterNewPage` (266L) wraps `<CharterWizard>` (`src/components/charter/CharterWizard.tsx` 170L)
2. Steps 1-6: Origin → Service → Destination → Pax+Vehicle → Date+Options → Quote
3. Step6 Quote calls Braintree payment; on success writes `bookings` + `charter_inquiries` Firestore docs
4. Auth gate: `<AuthRequired>` wraps the route

### F3 — Tours flow (catalog)
1. `/tours` → `ToursPage` (554L) — Firestore `tours` collection + `tour_availability` realtime
2. `/tours/:slug` → `TourDetailPage` (698L) → `<TourBookingDialog>` (`src/components/tours/TourBookingDialog.tsx`)
3. Booking writes via `src/services/bookingService.js` to `tours/{tourId}/bookings`

### F4 — Auth / login
- Firebase Google SSO via `src/lib/firebase.js::signInWithGoogle` (popup + redirect fallback)
- `<AuthRequired>` (`src/components/AuthRequired.tsx`) shows branded login card with Google button + handles `getRedirectResult()` post-redirect
- `<AdminRoute>` (`src/components/AdminRoute.tsx`) layers email check on top: `user.email === VITE_ADMIN_EMAIL`

### F5 — My Page (bookings + plans)
- `/mypage` (753L) — multi-tab dashboard: bookings (`<MyBookingsTab>`) + loyalty (points, coupons via `useLoyalty`) + wishlist + recently-viewed
- `/my-plans` — Firestore `users/{uid}/plans` realtime listener
- `/my-plans/:planId` — opens `PlanDetailPage` directly (planId in URL acts as share token)

### F6 — Admin ops
- 11 admin routes (see Routes Table) — Ops Hub at `/admin/ops` is the landing tab. Each tab page mounts its own Firestore listener (no shared store). DispatchTimeline + TelegramLogs + ConversionFunnel + ReviewManagement + ProfitSettlement under `src/components/admin/`.

### F7 — Home (landing)
- `HomePage` (inline in `App.tsx`) splits **mobile** vs **desktop** at `useIsMobile()`:
  - Mobile → `<MobileHome>` (app-style)
  - Desktop → Header + HeroSlider + HeroCards + (lazy) CustomerGallery + GoogleReviews + Services + SeasonalBanner + Regions + (lazy) Membership + CTA + Footer

---

## 4. State & Data Management

**No global store (Redux/Zustand).** State lives in:
- React Context: `LanguageProvider` (`src/hooks/useLanguage.ts`), `CommandPaletteProvider` (`src/components/CommandPalette.tsx`), `ErrorBoundary`
- React Query / SWR: not used. Direct Firestore `onSnapshot()` listeners in hooks/pages
- Local component state for wizard forms (no form library — manual `useState`)

**Firestore collections referenced from frontend:**
| Collection | Where read/written |
|---|---|
| `users/{uid}/itineraries` | `useItinerary.ts` |
| `users/{uid}/plans` | `MyPlansPage.tsx` |
| `users/{uid}/coupons`, `users/{uid}/pointHistory` | `useLoyalty.ts` |
| `users/{uid}/wishlist` | `useWishlist.ts` |
| `users/{uid}/recentlyViewed` | `useRecentlyViewed.ts` |
| `plans` | `MyPage.tsx`, `MobileHome.tsx`, `ConversionFunnel.tsx` |
| `bookings` | `AdminCalendar.tsx`, `AdminAnalytics.tsx`, `DispatchTimeline.tsx`, `ProfitSettlement.tsx`, `ConversionFunnel.tsx` |
| `tours/{tourId}/bookings` | `services/bookingService.js` |
| `tours` | `Admin.tsx` |
| `tour_availability/{tourId}/dates` | `tour-availability-store.ts` |
| `reviews` | `ReviewManagement.tsx` |
| `cs_tickets` | `ReviewManagement.tsx` |
| `dispatch_messages` | `TelegramLogs.tsx` |
| `drivers` | `DispatchTimeline.tsx` |
| `pending_free_claims` | `AdminClaims.tsx`, `PendingClaimsWidget.tsx`, `FreeClaimForm.tsx` |
| `charter_inquiries` | `AdminClaims.tsx`, `PendingClaimsWidget.tsx`, `CharterInquireModal.tsx` |
| `calendar_blocks` | `AdminCalendar.tsx` |
| `booking_costs` | `ProfitSettlement.tsx` |

Firestore INTERNAL ASSERTION errors are globally suppressed in `src/main.tsx` L15-28 (Firebase v12.11.0 onSnapshot bug workaround).

---

## 5. i18n Architecture

**Central locales** (`src/i18n/`):
- `index.ts` — 30-line loader: `translations[language]` returns the typed object
- `locales/{ko,en,ja,zh}.json` — **1968 lines each** (all 4 in parity, total 7872 lines)
- Type derived from ko.json: `export type Translations = typeof ko;`

**Detection** (`src/hooks/useLanguage.ts`):
- localStorage key `cocotrip_lang` → navigator.languages → `'en'` default
- Cross-tab sync via `storage` event
- `<html lang>` attribute kept in sync
- PostHog `language_switched` event fires on actual change

**Wizard-i18n shim** (`src/components/charter/wizard-i18n.ts`):
- Adapter exposing `getWizardI18n(language): WizardI18n` — wraps the central `charterWizard` namespace from JSON locales with functional formatters (template substitution, plural, toFixed)
- Migration completed in PR E2 (2026-05-04) — was previously a 600-line standalone dict
- Consumers: `CharterWizard`, `Step1Origin`-`Step6Quote`, `CharterNewPage`, `MyBookingsTab` — they only call `getWizardI18n(language)`, internals are JSON-backed

---

## 6. Auth & Permissions

**Firebase Auth** (`src/lib/firebase.js`):
- `signInWithGoogle()` — popup primary, redirect fallback for blocked popups
- `handleRedirectResult()` — called on app boot in `<GlobalWidgets>` and again in `<AuthRequired>` to settle redirect login
- `useAuth()` (`src/hooks/useAuth.ts`) — `{ user, loading, error }`

**Gates:**
- `<AuthRequired>` — wraps `/charter`, `/charter-legacy`, `/mypage`, `/my-plans`. Shows branded 4-lang login card if `!user`. Spinner while `loading || redirectChecking`.
- `<AdminRoute>` — wraps all `/admin/*`. Email match: `user.email.toLowerCase() === VITE_ADMIN_EMAIL`. Shows "Access denied" card if mismatched.

**TEST_ACCOUNTS bypass:**
- Defined in `src/components/BraintreePaymentButton.tsx` L164: `['2001leety@gmail.com']`
- L173: `isTestAccount = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim())` — bypasses real Braintree charge in sandbox flow

---

## 7. Observability

**Sentry** — confirmed **active in PROD only** (`src/lib/sentry.ts`):
- Init in `src/main.tsx` L10
- Gated on `import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN`
- `tracesSampleRate: 0.1`
- `beforeSend` strips `event.user.email` + `event.user.ip_address`, drops FIRESTORE / NetworkError / "Failed to fetch" / "Load failed" noise

**PostHog** — confirmed active when key set (`src/lib/posthog.ts`):
- Init in `src/main.tsx` L35 via `bootPostHog()`
- Lazy `import('posthog-js')` so missing `VITE_POSTHOG_KEY` → zero bundle bytes
- PII guard: `sanitize()` strips email/phone/address/name/etc before send
- Captures pageview + pageleave; autocapture deferred — manual `track()` is source of truth

**GA4** — `src/lib/analytics.ts::initGA` + `trackPageView` on every route change (`<PageViewTracker>` in App.tsx L157)

**Firestore noise suppressor** — `src/main.tsx` L15-28 swallows "FIRESTORE INTERNAL ASSERTION FAILED" globally on `error` and `unhandledrejection`.

No explicit ad-blocker handling beyond Sentry's `ChunkLoadError` ignore list and Firestore suppression.

---

## 8. Key Shared Components (top 10 by usage)

| Component | File | Role |
|---|---|---|
| `AuthRequired` | `src/components/AuthRequired.tsx` | Login gate with 4-lang Google button |
| `AdminRoute` | `src/components/AdminRoute.tsx` | Admin email check |
| `BraintreePaymentButton` | `src/components/BraintreePaymentButton.tsx` | Drop-in payment + TEST_ACCOUNTS bypass |
| `WizardForm/` | `src/components/WizardForm/` | AI Planner 5-step wizard (data + helpers + steps) |
| `charter/CharterWizard` | `src/components/charter/CharterWizard.tsx` | Charter 6-step wizard host |
| `ChatWidget` | `src/components/ChatWidget.tsx` | Chat (lazy-loaded global widget; ChatFAB removed → Telegram bot) |
| `MobileBottomNav` | `src/components/MobileBottomNav.tsx` | Mobile app-style bottom tabs |
| `CommandPalette` | `src/components/CommandPalette.tsx` | Cmd-K palette (Provider mounted at App root) |
| `ErrorBoundary` | `src/components/ErrorBoundary.tsx` | Top-level boundary, mounted between Language + Router |
| `ui/` (Radix wrappers) | `src/components/ui/` | shadcn-style primitives — Dialog/AlertDialog/Select/Tabs/etc |

Notable secondary: `KpopConcertPopup`, `CookieBanner`, `PWAUpdatePrompt`, `SeasonalBanner`, `EarlyBirdBanner`, `PendingClaimsWidget`, `ReviewSubmitModal`, `WishlistButton`, `TravelTimeline`, `LoyaltyBadge`.

Page subfolders (decomposed): `pages/PlannerPage/{index,components,hooks,lib,constants,types}` and `pages/PlanDetailPage/{index,components,hooks,lib,pdfGenerator,useAutoTranslate,constants,types}`. Backup file `WizardForm.backup.tsx` exists at component root.

---

## Notes / Anomalies

- `WizardForm.backup.tsx` is an unused backup file sitting next to the active `WizardForm/` folder — orphan candidate.
- `/charter-new` is a dead URL kept only as `<Navigate>` redirect to `/charter` (post-rename).
- `/booking` redirect to `/tours` exists for old bookmark compatibility — no live booking page anymore (PR #197 removed `BookingPageWrapper`).
- `pages/CharterPage.tsx` (legacy) still mounted at `/charter-legacy` — kept for fallback. Active charter is `CharterNewPage`.
- `DevTransitTest` route exists only when `import.meta.env.DEV` — chunk tree-shaken out of prod.
- `services/bookingService.js` is the only `.js` file under `src/services/` — TypeScript-conversion candidate.
