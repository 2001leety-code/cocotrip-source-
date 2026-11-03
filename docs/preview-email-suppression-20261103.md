# 🌐웹 Preview email suppression

The server suppresses email only when **both** `VERCEL_ENV === 'preview'` and `PREVIEW_EMAIL_SUPPRESS === 'true'`. Requests, recipients and client input cannot enable or disable this policy. Production behavior remains unchanged even if the flag is present there. No SMTP credential, shared secret, OAuth grant, price, capture, refund or authorization rule is changed.

The branch-scoped Preview configuration is managed separately from this code. Setting the flag on an older deployment does not implement suppression; the exact deployed source must include this patch.

## Non-delivery contract

Suppression returns `{status:'suppressed', reason:'preview_policy', delivery:'not_attempted', suppressed:true, sent:false, retryable:false}`. It supplies no provider acceptance, message ID, sent timestamp or delivered receipt. Customer-email and mail-only endpoint wrappers additionally return `ok:false` rather than pretending that delivery succeeded. A successful booking, plan issuance, settlement or date change remains a successful business operation and reports email delivery separately.

- Common SMTP returns before the quota check, credentials, transport creation, SMTP and quota increment. The independent planner notifier also returns before credentials/transport.
- Customer mail suppression creates no retry payload or mail-failure alert. The four mail-only crons return before DB initialization/query and operator summaries. Existing pending email documents are neither completed nor deleted.
- Booking processing skips the email claim and AI email-content generation, and exposes `steps.email='suppressed'`, the existing non-applicable step status, and an explicit email receipt. It writes no voucher sent/failed marker for a suppressed email. Other business steps retain their existing contracts.
- Manual confirmations preserve completed and unknown email history, including legacy unknown history. Only a new confirmation without prior history is marked suppressed. The suppression path sends no confirmation mail or mail-failure alert.
- Manage-link resend retains admin authentication and returns before booking lookup, token creation, resend claims and sent records. Booking-change mail returns before voucher generation; date changes retain their valid business state and pending recovery link without false sent records or mail-failure alerts.
- Planner responses no longer report `emailSent:true` solely because an address exists when suppression is active. Admin/cancellation logs and Telegram claim responses omit false email-success claims.
- The separate company Gmail OAuth reply sender keeps its existing production-only boundary. No new OAuth permission or transport is introduced.

## Offline verification and operational limits

Focused tests mock SMTP, quota, Firestore, authentication, PayPal, notifications and other providers. They exercise the actual mail functions and relevant handlers, including repeated suppression, strict environment matching, normal production/quota failure behavior, auth preservation, absent sent markers, legacy history, valid issuance/date changes, and the existing Preview OAuth block. No live mailbox, DB, login, purchase or paid provider was used. Source-order/literal regressions are covered by the existing affected quota/template/cron/notification suites.

The first focused run stopped at a new mock defect: its alert function returned undefined while the production helper uses `.catch()`. The mock was corrected to return a Promise; the original failure log is retained. After recovery, 17 focused files passed 274 tests. A subsequent legacy-history priority correction added a targeted regression and was verified separately. The normal commit and pre-push gates provide the final TypeScript/Vite build and full unit result; final publication evidence is recorded separately after those gates finish.

This is **email suppression in that Preview runtime**, not a mode that blocks all external effects. Sheets, Telegram, push, worker events, AI/routes, PayPal and business DB operations retain their own policies. In particular, whether an Inngest event is consumed by a production worker remains unverified; this flag is not copied into worker payloads and does not alter production worker configuration. It does not authorize real login, test-account writes, Sandbox purchases or provider calls. These require separate scope and permission.

Local evidence lives under `C:\Users\dlxod\AppData\Local\Temp\`: `r32-mail-first-focused-20261103.log`, `r32-mail-handlers-focused-20261103.log`, `r32-mail-final-focused-20261103.log`, `r32-mail-legacy-focused-20261103.log`, and the mail ESLint logs. Original source backups and SHA256 are preserved in `E:\ai에이젼시만들기\handoff-local\r32-mail-before\manifest.json`.
