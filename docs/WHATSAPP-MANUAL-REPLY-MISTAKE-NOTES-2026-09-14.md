# WhatsApp manual reply release notes — 2026-09-14

## Scope and current boundary

- Adds an authenticated admin manual-reply endpoint and reuses the existing email draft/confirm UI with Korean, English, Japanese and Chinese copy.
- Real business-number Cloud API onboarding is still incomplete. This code release does not connect the number, accept Tech Provider terms, subscribe to YCloud, change credentials or activate reception/sending.
- Phone Business app conversations are untouched. No history/contact synchronization or automatic acknowledgements were added.
- STOP/block/session expiry prevent drafting/approval/dispatch. Only a stored live receipt after explicit START, from the configured phone account, can supply recipient and reply context.
- Source, case-retention state and current support session are read in the same Firestore transaction. The verified selected customer-message timestamp is a conservative reply-window lower bound.
- The existing two-hour explicit-support session is stricter than the provider's 24-hour reply window. A normal new message alone does not reopen support consent.
- The same durable reply workflow handles both channels. Approval binds original source, actor, draft, consent and retention revision. Concurrent sends claim once; unknown outcomes never automatically retry. A verified pre-send failure can be retried once only after a new human confirmation.
- STOP concurrent with the transaction is caught on retry. STOP after the atomic claim cannot recall an external provider request; Firestore and Meta do not share an atomic transaction.
- Provider acceptance is not customer delivery or read confirmation. Neither this adapter nor the UI claims real receipt.

## Runtime settings (Vercel only; not changed in this release)

- `WHATSAPP_REPLY_ENABLED`: exact `true`, only in Vercel production; defaults OFF.
- `WHATSAPP_REPLY_SEND_ENABLED`: separate exact `true`; defaults OFF. With valid inbox configuration, drafts can be prepared while sending stays OFF.
- `WHATSAPP_REPLY_ACCESS_TOKEN`: server-only Meta send token; not returned in summaries or logged. No token was created or saved in this task.
- Uses the already pinned `WHATSAPP_INBOX_PHONE_NUMBER_ID` and requires the existing inbox readiness and `explicit_sessions_v1` mode. Verification-only GET does not enable replies.
- New flags must not be enabled until real number/account ownership, scoped credentials and live support-consent handling are verified. Preview/development must stay non-sending.

## Contract reference

[Meta official Cloud API text-reply request and response](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-96e6cec1-2d22-4c72-b920-7e3e6f8729de), checked 2026-09-14.
The adapter pins Graph v26.0 and the official graph.facebook.com host. No redirects, templates, bulk sends, attachments or client-provided destination overrides.

## Mistakes caught and regression coverage

- The first mandatory pre-push run found two direct-import CORS assertions after handler extraction (11684 passed, 2 failed). The second full suite passed 11688 tests but the matching static guard required explicit endpoint imports. Both wrappers now pin and pass their real CORS functions to the common handler; original direct-import assertions and the static guard remain intact, with additional allowed OPTIONS / hostile OPTIONS-GET-POST / unauthenticated GET / attempted CORS override tests. No CORS policy or static rule was weakened. Both failed pushes stopped locally before any remote build; all lightweight gates are checked before the final full guard run.
- An open/protected v2 case has retention deadline zero (not immediately expired). WhatsApp approval must omit that zero from the minimum and still stop at the support-session deadline. New tests cover open/protected/closed cases.
- Spark's initial pure payload/receipt draft permitted CR, used an overly broad plain-object check, omitted expected-recipient syntax validation and included one malformed test bracket. Root corrected these before execution and expanded negative tests. Actual model: GPT-5.3-Codex-Spark, medium; payload/receipt implementation and test draft, not a whole-feature attribution.
- Generic email handler extraction keeps channel and config readers pinned by each server entry point. Existing email API/component regressions are included; no email credential or behavior activation changed.
- A valid JSON `DELIVERY_UNCERTAIN` response must keep the UI send lock just as a transport timeout does.
- Local UI requires synthetic Firebase public configuration to initialize the app; no production credential is needed. CUA clicks use the existing dev-only in-memory inquiry harness, not production authentication bypass.
- Mandatory repository pre-push checks remain enabled. Existing unrelated Lighthouse failure is not represented as fixed or green by this release.

## Verification evidence

- Focused backend/source/handler/receipt/config/deadline tests and UI tests run with synthetic data only; actual Meta send/receipt remains unverified.
- `npm run build` is the type/build evidence; no `tsc --noEmit` no-op used.
- Local CUA checked Korean draft/save/explicit confirmation/provider-acceptance distinction at desktop and 390px widths, with no horizontal overflow. Runtime OFF cases are checked separately before release.
- Required release checks and exact deployment SHA are recorded in the shared work log after release, not assumed here.
