/**
 * Vercel API Route: Submit Plan Complaint
 * POST /api/submit-plan-complaint
 * Body: { planId, reason, detail?, userEmail? }
 *
 * 2026-05-04: 학습 루프 Tier 1-A — AI 플래너 결과 품질 신고. PlanDetailPage 의 "이상해요"
 * 버튼 → 5개 reason 라디오 (잘못된 주소/식당 폐업/동선 비효율/시간 부정확/기타) → 본 endpoint.
 *
 * 흐름:
 *   1. IP rate limit (PR #429, Audit WC10): per-IP 시간당 5건 한도
 *   2. Body validation (planId + reason 필수, reason 은 5개 enum 만)
 *   3. Firestore plan_complaints 컬렉션에 저장
 *   4. 어드민 텔레그램 booking 채널 알림
 *   5. 응답
 *
 * 익명 신고 허용 (userEmail optional). 어드민이 Firestore 에서 patterns 분석 →
 * 잘못된 stop/restaurant DB 정정 + Gemini 프롬프트 개선 인풋.
 *
 * Rate limit (PR #429, Audit WC10 — 2026-05-14): 이전엔 인증/rate-limit 둘 다
 * 없어 익명 공격자가 무제한 호출 가능 → 매 호출 어드민 텔레그램 booking 채널에
 * 메시지 발송 → 운영자 채팅창 spam + Firestore writes 폭주. IP 기반 rate limit
 * (1h window, 5 req/IP) 으로 anonymous 흐름 유지 + abuse 차단.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ALLOWED_REASONS = new Set([
  'wrong_address',       // 주소가 잘못됨
  'closed_restaurant',   // 식당/장소 폐업
  'inefficient_route',   // 동선이 비효율적
  'wrong_timing',        // 시간 정보 부정확
  'other',               // 기타
]);

const REASON_LABELS_KO = {
  wrong_address:     '주소 오류',
  closed_restaurant: '폐업·운영 종료',
  inefficient_route: '동선 비효율',
  wrong_timing:      '시간 부정확',
  other:             '기타',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// IP rate limit moved to shared helper (api/_shared/ip-rate-limit.js) — same
// 5/hour / sha256 hashing / fail-OPEN behavior, now reusable by other
// anonymous endpoints (PR #432 / W-H13 adds /api/manual-payment-request).

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { planId, reason, detail = '', userEmail = '' } = body;

    if (!planId || typeof planId !== 'string') {
      return json(res, 400, _err('planId required', 'MISSING_PLAN_ID'));
    }
    if (!reason || !ALLOWED_REASONS.has(reason)) {
      return json(res, 400, _err('reason must be one of: ' + [...ALLOWED_REASONS].join(', '), 'INVALID_REASON'));
    }
    // detail 는 optional 이지만 1KB 초과는 반려 (악용 방지)
    if (typeof detail === 'string' && detail.length > 1000) {
      return json(res, 400, _err('detail too long (max 1000 chars)', 'DETAIL_TOO_LONG'));
    }

    const db = initAdminDb('submit-plan-complaint');
    if (!db) {
      return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));
    }

    // IP rate limit (PR #429 — Audit WC10). Anonymous users keep working,
    // but a single IP can't fire more than 5 complaints per hour. Telegram
    // booking channel can't be spammed via this endpoint anymore.
    const clientIp = getClientIp(req);
    const rateCheck = await checkIpRateLimit({
      db,
      ip: clientIp,
      collection: 'complaint_rate_limits',
      maxRequests: 5,
      errorLabel: 'complaints',
    });
    if (!rateCheck.ok) {
      res.setHeader?.('Retry-After', String(rateCheck.retryAfterSec));
      return json(res, rateCheck.status, _err(rateCheck.error, 'RATE_LIMITED'));
    }

    // 같은 planId 에 대한 같은 user 의 중복 신고 차단 (24h 내)
    if (userEmail) {
      const dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dupSnap = await db.collection('plan_complaints')
        .where('planId', '==', planId)
        .where('userEmail', '==', userEmail.toLowerCase().trim())
        .where('createdAt', '>=', dupSince)
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        return json(res, 409, _err('You already reported this plan in the last 24h.', 'DUPLICATE_REPORT'));
      }
    }

    // Firestore 저장
    const docRef = await db.collection('plan_complaints').add({
      planId,
      reason,
      detail: String(detail).slice(0, 1000),
      userEmail: userEmail ? userEmail.toLowerCase().trim() : null,
      status: 'open',  // open | reviewed | resolved
      createdAt: FieldValue.serverTimestamp(),
      // ip / userAgent 같은 fingerprint 는 보안 정책상 미수집
    });

    // 어드민 텔레그램 알림 (booking 채널 — cocotrip bot)
    const reasonLabel = REASON_LABELS_KO[reason] || reason;
    const truncatedDetail = detail ? String(detail).slice(0, 200) + (detail.length > 200 ? '…' : '') : '(없음)';
    const msg =
      `🚩 <b>플랜 신고 접수</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `Plan ID: <code>${planId}</code>\n` +
      `Complaint ID: <code>${docRef.id.slice(0, 12)}</code>\n` +
      `사유: <b>${reasonLabel}</b>\n` +
      `신고자: ${userEmail || '익명'}\n\n` +
      `상세:\n${truncatedDetail}\n\n` +
      `→ Firestore <code>plan_complaints/${docRef.id}</code>`;
    void notify('booking', msg).catch((err) => console.error('[submit-plan-complaint] notify failed:', err.message));

    return json(res, 200, _ok({
      complaintId: docRef.id,
      planId,
      reason,
      status: 'received',
    }));
  } catch (err) {
    console.error('[submit-plan-complaint]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
