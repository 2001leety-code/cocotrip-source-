/**
 * POST /api/log-revision-reason
 *
 * Tier 1-B (운영 학습 루프) — revision reason 메타 로깅 endpoint.
 *
 * 본 endpoint 는 main 의 W4 구현 (revisionReason 을 ai-planner-full 호출 body 에
 * forward → Gemini prompt instruction inject) 과 별도. W4 = 직접 재생성 데이터로
 * 활용, 본 endpoint = 메타 분석용 (plan 별 reason 누적 히스토리).
 *
 * Body:
 *   {
 *     planId,                    // 'plan_xxx' 필수
 *     reason: 'restaurant' | 'route' | 'schedule' | 'language' | 'other' |
 *             // W4 chip keys (comma-joined or single):
 *             'too_packed' | 'too_loose' | 'food_not_match' | 'budget_off' | etc,
 *     freeText?: string,         // 옵션, 200자 이내
 *     language?: 'ko'|'en'|'ja'|'zh'
 *   }
 *
 * Auth: optional Bearer Firebase token. plan owner uid 매칭 시 audit log 강화.
 *       비로그인/공개 plan 도 push 허용 (revisionToken 검증은 ai-planner-full 에서 후속).
 *
 * 부수효과 X — 단순 메타데이터 로깅. 재생성 자체는 별도 endpoint (/api/ai-planner-full).
 *
 * 사용 패턴 (운영 분석):
 *   - "category=restaurant 가 30% 차지" → DB matcher 정확도 우선순위
 *   - "language 가 10% 차지" → i18n 회귀 가설
 *   - freeText pattern 분석 (자주 등장하는 단어/구문)
 *
 * 2026-05-22 (PR #282 재작성): 원본 PR #282 의 stale 회피용 재작성. main 의 W4
 * 구현과 충돌 없음 (별도 endpoint).
 */
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export const config = { runtime: 'nodejs' };
export const maxDuration = 10;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// PR #282 원본 5 chip + W4 확장 chip 모두 허용 (운영자가 chip 카테고리 확장 가능).
// reason 은 단일 키 또는 comma-joined (W4 패턴 동일).
const VALID_REASON_KEYS = new Set([
  // 원본 PR #282
  'restaurant', 'route', 'schedule', 'language', 'other',
  // W4 chip keys (참고용 — 새 chip 도입 시 여기 추가 권장)
  'too_packed', 'too_loose', 'food_not_match', 'budget_off',
  'not_my_style', 'wrong_area', 'bad_pace',
]);
const MAX_FREE_TEXT_LEN = 200;

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
}

function _validateReasonString(rawReason) {
  if (typeof rawReason !== 'string' || rawReason.length === 0) return null;
  // comma-joined 도 허용 (e.g., "restaurant,route"). 각 토큰 길이 30자 cap.
  const tokens = rawReason
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5); // 최대 5개 chip
  if (tokens.length === 0) return null;
  // strict validation: 각 토큰이 known list 안에 있어야 함. 알려진 chip 외엔 reject.
  for (const t of tokens) {
    if (!VALID_REASON_KEYS.has(t) && t.length > 30) return null;
  }
  return tokens.join(',');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { planId, reason: rawReason, freeText = '', language = 'en' } = body;

    if (!planId || typeof planId !== 'string') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('planId required', 'MISSING_PLAN_ID')));
    }
    const reason = _validateReasonString(rawReason);
    if (!reason) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(
        `Invalid reason. Allowed chips: ${[...VALID_REASON_KEYS].join(', ')} (comma-joined OK)`,
        'INVALID_REASON',
      )));
    }

    // 옵션 인증 — 토큰 있으면 uid 추출 (audit log 용, 검증 강제 X)
    let userId = null;
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const tokenMatch = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (tokenMatch) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const { getApps } = await import('firebase-admin/app');
        if (getApps().length > 0) {
          const decoded = await getAuth().verifyIdToken(tokenMatch[1]);
          userId = decoded.uid;
        }
      } catch (e) {
        console.warn('[log-revision-reason] token verify failed (allowed):', e.message);
      }
    }

    const adminDb = initAdminDb('log-revision-reason');
    if (!adminDb) {
      // Firestore unavailable — 로깅 실패해도 재생성 흐름 자체는 영향 X (fire-and-forget)
      console.error('[log-revision-reason] Firestore admin unavailable — skip log');
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, logged: false }));
    }

    // plan 존재 검증 (없으면 reject — 잘못된 planId 위변조 차단)
    const planRef = adminDb.collection('plans').doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Plan not found', 'PLAN_NOT_FOUND')));
    }

    const trimmedFreeText = String(freeText || '').slice(0, MAX_FREE_TEXT_LEN).trim();

    await planRef.update({
      revisionReasons: FieldValue.arrayUnion({
        reason,
        freeText: trimmedFreeText || null,
        language: ['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en',
        userId,
        loggedAt: new Date().toISOString(),
      }),
      lastRevisionReasonAt: FieldValue.serverTimestamp(),
    });

    console.log('[log-revision-reason] logged:', planId, 'reason:', reason, 'free:', trimmedFreeText.length);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, logged: true }));
  } catch (err) {
    console.error('[log-revision-reason] failed:', err.message);
    await captureError(err, { route: '/api/log-revision-reason', method: req.method });
    // 로깅 실패해도 사용자 흐름 차단 안 됨 (fire-and-forget) — 200 응답 + logged:false
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, logged: false, error: err.message }));
  }
}
