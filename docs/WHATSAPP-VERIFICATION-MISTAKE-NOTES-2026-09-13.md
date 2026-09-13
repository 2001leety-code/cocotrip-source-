# WhatsApp callback verification without inbox activation

## Cause and correction

Callback GET verification previously required the full live inbox configuration and inbox activation. That couples an onboarding proof to a switch that can receive customer/private messages before actual account setup is complete.

The optional exact flag `WHATSAPP_INBOX_VERIFICATION_ENABLED=true` permits only the authenticated GET challenge with a valid existing `WHATSAPP_INBOX_VERIFY_TOKEN`. The normal Vercel production-only guard remains. Preview/development never verify. Missing Vercel environment retains existing isolated-test/self-host compatibility.

- POST still needs all existing enablement, privacy, account, capture-start, retention and signature guards, before body/DB access. Verification-only does not enable POST, automatic replies, history/contact sync, or external notification.
- The flag is OFF by default. No Vercel/local/GitHub secret or flag values are changed by this patch. Live callback verification is not claimed until the real Meta/Vercel setup is approved and completed.
- Configuration location for any later activation: Vercel project cocotrip-source_2026, Production. Preview/development stay disabled. Never paste real values into this file, chat, logs or a commit.
- GET challenge success is not proof of message receipt, phone ownership, app publication or successful outgoing replies. Existing admin readiness summaries deliberately do not report verification-only as inbox ready.
- Personal-message handling is deterministic support-session gating, not AI classification: without an explicit active business support session, no message record is stored or sent to AI. The transport can still receive the body in memory before discarding it. Existing Business-app conversations are not inherently classified as business inquiries; do not promise otherwise.
- YCloud remains on hold. This patch does not establish any third party's retention guarantee, accept terms, create credentials or turn on collection.

## Verification scope

Run the new verification-only cases together with the existing WhatsApp webhook and support-session tests, changed-file lint, and the required build. No unrelated UI/surface audit is needed because this is a server-only change.

Result: all 165 cases across those three files passed; changed-file ESLint and `git diff --check` passed; `npm run build` passed. Existing bundle/class/import warnings remain unrelated and unchanged. A separate read-only review found no GET/POST gate regression.

Model record: GPT-5.3-Codex-Spark drafted the test matrix without tool calls. Root corrected its function-arity guess, millisecond clock and actual error-code assertions before applying and running it. The exact factory contract must be supplied and tested, not inferred from Function.length when default parameters exist.
