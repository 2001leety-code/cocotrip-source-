# Isolated Preview operator notification suppression

Only the exact server combination `VERCEL_ENV=preview` and
`PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS=true` enables this policy.
Scope the value to the `feat/meal-notice-readability-20261102` Preview branch.
Production and other branches retain existing behavior.

The policy stops Telegram (including alternate chat IDs and driver bot API
methods), Discord mirrors, and the reviewed independent notification paths
before outbound attempts. Suppression is not provider acceptance: no sent
message ID or sent/unknown claim is created by the guarded booking/dispatch
notification paths. Low-level Bot API suppression throws the existing failure
contract with code `PREVIEW_NOTIFICATION_SUPPRESSED`.

Keep `PREVIEW_EMAIL_SUPPRESS`, `PREVIEW_SHEETS_SUPPRESS` and
`PREVIEW_PUSH_SUPPRESS` enabled separately. This operator policy does not
replace them and does not disable general booking/database business work,
maps/LLM calls, or arbitrary third-party scripts.

The isolated Preview refuses Inngest serving and publishing; direct worker and
failure callbacks stop before business effects. Normal Preview planning already
uses the existing inline path because dispatch requires production. These guards
apply to the runtime executing this code. They do not prove the actual Inngest
registration/key/environment routing, or protect an older production worker from
an arbitrary externally submitted event. Establish those targets before live
queue testing. A 403 worker endpoint is intentional; do not retry/sync it to make
it appear healthy.

Offline regression coverage includes configured Discord with empty Telegram
chat ID, alternate chat ID, production behavior, driver dispatch bookkeeping,
worker ingress/publishing/failure callbacks, and the existing email/Sheets/push
policies. No actual provider notification or Sandbox purchase is needed to test
these contracts. A fresh deployment is needed for a changed server flag.

The daily-report HTTP endpoint now uses the existing shared cron authentication
check before executing the job. Valid scheduled CRON_SECRET Bearer and existing
admin-token callers remain supported; unauthenticated direct calls return401.
No cron secret or schedule setting is changed.
