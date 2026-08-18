/**
 * /api/preview-lead — 무료 미리보기(free-preview) 단계 이탈 회복용 리드 캡처.
 *
 * POST { email, language?, source } — AI 플래너 결제(paywall) 화면에서 손님이
 * "여행 팁 이메일 받기(선택)" 체크박스를 켜고 유효한 이메일을 입력하면 fire-and-forget
 * 으로 호출된다(결제 자체는 이 API 성패와 무관 — src/pages/PlannerPage/components/
 * PurchaseSection.tsx 참고).
 *
 * 저장 목적: 결제까지 가지 않고 이탈한 손님에게 하루 1회, 7일 이내에만 짧은 recovery
 * 이메일을 보내기 위한 최소 정보(api/_crons/preview-lead-recovery.js 가 소비).
 *
 * 법적 준수 (정보통신망법 §50): 이 API 자체는 마케팅 메일을 보내지 않는다(저장만).
 * 실제 발송은 recovery cron 이 하며, 그 cron 은 매 발송에 api/_shared/marketing-optout.js
 * 의 buildUnsubscribeUrl() 을 반드시 포함한다. 여기서는 opt-out 여부만 확인해 opted-out
 * 이메일은 애초에 저장하지 않는다(수신거부한 사람의 재요청도 저장 안 함 — 재타겟 방지).
 *
 * 개인정보 최소화: 응답 바디에 이메일을 절대 echo 하지 않는다. Firestore 문서 id 는
 * 평문 이메일이 아니라 sha256(정규화 이메일) — ip-rate-limit.js 의 hashIp 패턴과 동일하게
 * 저장소에 평문 PII 를 노출 표면으로 두지 않는다(문서 내부 emailLower 필드는 예외 —
 * recovery cron 이 실제 발송 대상 이메일을 알아야 하므로 여기까지는 불가피).
 */
import { createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { normalizeEmail, isMarketingOptedOut } from './_shared/marketing-optout.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 practical cap
const SOURCE_WHITELIST = ['planner_paywall'];
const LANG_WHITELIST = ['ko', 'en', 'ja', 'zh'];

const _ok = (data = {}) => JSON.stringify({ ok: true, ...data });
const _err = (error, code) => JSON.stringify({ ok: false, error, code });

/** Preserve a field from the existing doc, or fall back — avoids nullish-coalescing syntax (repo lint). */
function carry(existing, key, fallback) {
  return existing && typeof existing[key] !== 'undefined' ? existing[key] : fallback;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(_err('POST only', 'METHOD_NOT_ALLOWED'));
  }

  let db;
  try {
    db = initAdminDb();
  } catch (err) {
    await captureError(err, { route: '/api/preview-lead', phase: 'init' });
    res.writeHead(500, JSON_CORS);
    return res.end(_err('서버 설정 오류', 'SERVER_CONFIG'));
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    const source = typeof body.source === 'string' ? body.source : '';
    const language = LANG_WHITELIST.includes(body.language) ? body.language : 'en';

    if (!rawEmail || rawEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(rawEmail)) {
      res.writeHead(400, JSON_CORS);
      return res.end(_err('Invalid email', 'BAD_EMAIL'));
    }
    if (!SOURCE_WHITELIST.includes(source)) {
      res.writeHead(400, JSON_CORS);
      return res.end(_err('Unknown source', 'BAD_SOURCE'));
    }

    // Rate limit before any Firestore doc read — cheap defense against abuse
    // regardless of whether the submitted email turns out valid/opted-out.
    const rl = await checkIpRateLimit({
      db, ip: getClientIp(req),
      collection: 'preview_lead_rate_limits',
      maxRequests: 10, errorLabel: 'preview lead submissions',
    });
    if (!rl.ok) {
      res.writeHead(rl.status, { ...JSON_CORS, 'Retry-After': String(rl.retryAfterSec) });
      return res.end(_err(rl.error, 'RATE_LIMITED'));
    }

    const emailLower = normalizeEmail(rawEmail);

    // Opted-out email → pretend success, don't store, don't leak opt-out status.
    if (await isMarketingOptedOut(db, emailLower)) {
      res.writeHead(200, JSON_CORS);
      return res.end(_ok());
    }

    const docId = createHash('sha256').update(emailLower).digest('hex');
    const ref = db.collection('preview_leads').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    const now = Date.now();

    await ref.set({
      emailLower,
      language,
      source,
      consent: true,
      consentAtMs: carry(existing, 'consentAtMs', now),
      createdAtMs: carry(existing, 'createdAtMs', now),
      lastSeenAtMs: now,
      recoveryEmailSentAtMs: carry(existing, 'recoveryEmailSentAtMs', null),
      convertedAtMs: carry(existing, 'convertedAtMs', null),
    });

    res.writeHead(200, JSON_CORS);
    return res.end(_ok());
  } catch (err) {
    console.error('[preview-lead] failed:', err.message);
    await captureError(err, { route: '/api/preview-lead' });
    res.writeHead(500, JSON_CORS);
    return res.end(_err('서버 오류', 'INTERNAL_ERROR'));
  }
}
