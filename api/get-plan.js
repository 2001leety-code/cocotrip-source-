/**
 * GET /api/get-plan
 *
 * 게스트(비로그인) 플랜을 타기기/이메일 링크로 열 때
 * Firestore 직접 읽기(onSnapshot)가 익명 uid 불일치로 막히면,
 * accessToken 으로 검증하는 서버 경유 읽기 fallback.
 *
 * Firebase Admin SDK 로 Firestore 보안 룰 우회, 토큰 일치 시에만 반환.
 *
 * Query params (GET) 또는 body (POST):
 *   planId  — 필수
 *   token   — accessToken (게스트 플랜 소유 검증용). URL 쿼리 허용.
 *
 * 권한 판정:
 *   - plan.accessToken && token 일치 → full (소유자급, PII 포함)
 *   - plan.isPublic === true         → masked (PII 제거)
 *   - 그 외                          → 403 거부
 *
 * 주의: nullish-coalescing 연산자 금지 — || 사용.
 */

import { initAdminDb } from './_ai_core/firestoreAdmin.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// PII 필드 목록 — PlanDetailPage/index.tsx L120-128 마스킹 목록과 일치.
// 최상위 필드
const TOP_LEVEL_PII = ['uid', 'guestEmail', 'accessToken', 'pricing'];
// input 하위 필드
const INPUT_PII = ['specialRequest', 'hotel_address', 'arrival_airport', 'departure_airport'];

/**
 * 권한 판정 + 마스킹 순수 헬퍼.
 * @param {object} plan    Firestore 에서 읽은 플랜 원본 (deep clone 권장)
 * @param {string} token   요청자가 제출한 accessToken (없으면 '')
 * @returns {{ access: 'full'|'masked'|'denied', plan?: object }}
 */
export function resolvePlanAccess(plan, token) {
  // full: accessToken 일치 (소유자급)
  if (plan.accessToken && token && plan.accessToken === token) {
    return { access: 'full', plan };
  }

  // masked: 공개 플랜
  if (plan.isPublic === true) {
    const masked = JSON.parse(JSON.stringify(plan));
    // 최상위 PII 제거
    for (const field of TOP_LEVEL_PII) {
      delete masked[field];
    }
    // input 하위 PII 제거
    if (masked.input) {
      for (const field of INPUT_PII) {
        delete masked.input[field];
      }
    }
    return { access: 'masked', plan: masked };
  }

  // 그 외: 거부
  return { access: 'denied' };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  try {
    // planId, token: GET 쿼리 또는 POST body 모두 허용
    const query = req.query || {};
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const planId = ((query.planId || body.planId) || '').trim();
    const token = ((query.token || body.token) || '').trim();

    // 1. planId 필수
    if (!planId) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'planId is required' }));
    }

    // 2. Admin SDK 로 plans/{planId} 읽기
    const adminDb = initAdminDb('get-plan');
    if (!adminDb) {
      console.error('[get-plan] Firestore admin unavailable');
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const snap = await adminDb.collection('plans').doc(planId).get();

    // 3. 없으면 404
    if (!snap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Plan not found' }));
    }

    const planRaw = snap.data() || {};

    // 4. 권한 판정
    const result = resolvePlanAccess(planRaw, token);

    if (result.access === 'denied') {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    }

    // 5. 응답 (full or masked)
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, plan: result.plan }));

  } catch (err) {
    console.error('[get-plan] Error:', err);
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
  }
}
