/**
 * GET /api/marketing-unsubscribe?email=...&token=...
 *
 * Public, UNAUTHENTICATED endpoint — it is the one-click 수신거부 link a future
 * marketing-mail footer will embed (정보통신망법 §50 compliance). No auth by
 * design: the recipient clicking the link in their inbox is not logged in.
 * Forgery is prevented by the per-email HMAC token (see _shared/marketing-
 * optout.js) — without the secret nobody can mint a valid token for an
 * arbitrary email.
 *
 * ⚠️ SCOPE: this records an opt-out only. It does NOT send any email and is
 * unrelated to payment / transactional-email code. Marketing sending is OFF.
 *
 * Flow:
 *   1. Validate method (GET) + presence of email & token.
 *   2. verifyUnsubscribeToken(email, token) — reject forged/missing.
 *   3. recordOptOut(db, email, source:'unsubscribe_link') — Firestore merge.
 *   4. Respond with a simple human-readable HTML page (ko/en) confirming.
 *
 * Returns HTML (not JSON) because a human in a browser sees this directly.
 */

import { initAdminDb } from './_shared/firebase-admin.js';
import {
  normalizeEmail,
  verifyUnsubscribeToken,
  recordOptOut,
} from './_shared/marketing-optout.js';
import { escapeHtml } from './_shared/escape.js';

export const config = { maxDuration: 15 };

function htmlPage({ title, heading, body, status = 200 }, res) {
  const page = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         background: #0f1020; color: #f2f2f7; margin: 0; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 440px; width: 100%; background: #1a1a2e; border: 1px solid #2a2a44;
          border-radius: 16px; padding: 32px 28px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.6; color: #c7c7d4; margin: 8px 0; }
  a { color: #b39ddb; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    ${body}
    <p><a href="https://cocotripkr.com">cocotripkr.com</a></p>
  </div>
</body>
</html>`;
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(page);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return htmlPage(
      {
        title: 'Method Not Allowed',
        heading: '잘못된 요청 · Invalid request',
        body: '<p>이 링크는 직접 클릭으로만 작동합니다.<br/>This link only works via a direct click (GET).</p>',
        status: 405,
      },
      res,
    );
  }

  const query = req.query || {};
  const email = normalizeEmail(query.email);
  const token = typeof query.token === 'string' ? query.token : '';

  if (!email || !token) {
    return htmlPage(
      {
        title: 'Unsubscribe',
        heading: '링크가 올바르지 않습니다 · Invalid link',
        body: '<p>수신거부 링크에 필요한 정보가 없습니다.<br/>This unsubscribe link is missing required information.</p>',
        status: 400,
      },
      res,
    );
  }

  // Forgery guard — reject any token that isn't HMAC(emailLower).
  if (!verifyUnsubscribeToken(email, token)) {
    return htmlPage(
      {
        title: 'Unsubscribe',
        heading: '링크가 올바르지 않습니다 · Invalid link',
        body: '<p>수신거부 링크가 유효하지 않거나 만료되었습니다.<br/>This unsubscribe link is invalid or could not be verified.</p>',
        status: 400,
      },
      res,
    );
  }

  const db = initAdminDb('marketing-unsubscribe');
  const result = await recordOptOut(db, email, { source: 'unsubscribe_link' });

  if (!result.ok) {
    return htmlPage(
      {
        title: 'Unsubscribe',
        heading: '잠시 후 다시 시도해 주세요 · Please try again',
        body: '<p>처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.<br/>Something went wrong. Please try again shortly.</p>',
        status: 500,
      },
      res,
    );
  }

  return htmlPage(
    {
      title: 'Unsubscribed',
      heading: '수신거부 완료 · Unsubscribed',
      body:
        `<p><strong>${escapeHtml(email)}</strong> 주소로의 마케팅 메일 수신이 거부되었습니다.</p>` +
        `<p>You have been unsubscribed from CocoTripKR marketing emails.</p>` +
        '<p>예약 확인 등 거래 관련 메일은 계속 발송됩니다.<br/>Transactional emails (e.g. booking confirmations) will still be sent.</p>',
      status: 200,
    },
    res,
  );
}
