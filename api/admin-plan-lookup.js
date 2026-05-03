/**
 * Vercel API Route: Admin Plan Lookup + Adjustment
 * GET  /api/admin-plan-lookup?email=user@example.com  → 해당 이메일의 plan 목록
 * GET  /api/admin-plan-lookup?planId=<id>             → 단일 plan detail
 * POST /api/admin-plan-lookup  body { planId, action: 'addCredits', credits: number }
 *      → revisionCredits 증감 (음수도 허용 — 차감)
 *
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * 2026-05-04: Q4 — admin 이 사용자 AI 플랜을 조회 + revisionCredits 직접 조정 (CS 대응용).
 * Firestore plans 컬렉션 + plan_complaints 컬렉션 cross-reference 가능.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function summarizePlan(d, id) {
  return {
    planId: id,
    userEmail: d.userEmail || null,
    title: d.title || d.itinerary?.title || null,
    days: Array.isArray(d.itinerary?.days) ? d.itinerary.days.length : null,
    revisionCredits: typeof d.revisionCredits === 'number' ? d.revisionCredits : 0,
    paymentStatus: d.paymentStatus || null,
    transactionId: d.transactionId || null,
    createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || null,
    language: d.language || null,
    complaintsCount: 0,  // populated separately
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  try {
    const db = initAdminDb('admin-plan-lookup');
    if (!db) {
      return json(res, 500, _err('Firestore unavailable', 'DB_UNAVAILABLE'));
    }

    if (req.method === 'GET') {
      const url = new URL(req.url, `https://${req.headers.host || 'cocotripkr.com'}`);
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      const planId = url.searchParams.get('planId');

      // 1. planId 단건 — itinerary 포함 (preview 용)
      if (planId) {
        const docSnap = await db.collection('plans').doc(planId).get();
        if (!docSnap.exists) {
          return json(res, 404, _err('Plan not found: ' + planId, 'NOT_FOUND'));
        }
        const d = docSnap.data();
        // 신고 횟수도 함께
        const complaintsSnap = await db.collection('plan_complaints')
          .where('planId', '==', planId)
          .limit(50)
          .get();
        const complaints = [];
        complaintsSnap.forEach((c) => {
          const cd = c.data();
          complaints.push({
            id: c.id,
            reason: cd.reason,
            detail: cd.detail,
            status: cd.status,
            userEmail: cd.userEmail,
            createdAt: cd.createdAt?.toDate?.()?.toISOString?.() || null,
          });
        });
        return json(res, 200, _ok({
          ...summarizePlan(d, planId),
          itinerary: d.itinerary || null,
          complaints,
          complaintsCount: complaints.length,
        }));
      }

      // 2. email 검색 — 목록 (최대 50건, itinerary 제외 — 페이로드 절약)
      if (email) {
        const snap = await db.collection('plans')
          .where('userEmail', '==', email)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();
        const plans = [];
        snap.forEach((p) => plans.push(summarizePlan(p.data(), p.id)));
        return json(res, 200, _ok({ email, plans, count: plans.length }));
      }

      return json(res, 400, _err('Provide either ?email=... or ?planId=...', 'MISSING_QUERY'));
    }

    // POST — credit 조정
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const { planId, action, credits } = body;

    if (!planId) return json(res, 400, _err('planId required', 'MISSING_PLAN_ID'));
    if (action !== 'addCredits') return json(res, 400, _err('action must be "addCredits"', 'INVALID_ACTION'));
    if (typeof credits !== 'number' || !Number.isFinite(credits)) {
      return json(res, 400, _err('credits must be a finite number', 'INVALID_CREDITS'));
    }
    if (Math.abs(credits) > 100) {
      return json(res, 400, _err('credits delta out of safe range (-100 ~ +100)', 'OUT_OF_RANGE'));
    }

    const ref = db.collection('plans').doc(planId);
    const docSnap = await ref.get();
    if (!docSnap.exists) {
      return json(res, 404, _err('Plan not found: ' + planId, 'NOT_FOUND'));
    }

    await ref.update({
      revisionCredits: FieldValue.increment(credits),
      adjustedAt: FieldValue.serverTimestamp(),
      adjustedBy: tokenAuth.email || 'admin',
      adjustmentLog: FieldValue.arrayUnion({
        delta: credits,
        at: new Date().toISOString(),
        by: tokenAuth.email || 'admin',
      }),
    });

    const updated = (await ref.get()).data();
    return json(res, 200, _ok({
      planId,
      revisionCredits: typeof updated.revisionCredits === 'number' ? updated.revisionCredits : null,
      delta: credits,
    }));
  } catch (err) {
    console.error('[admin-plan-lookup]', err);
    return json(res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
