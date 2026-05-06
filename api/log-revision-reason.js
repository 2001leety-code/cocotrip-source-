/**
 * POST /api/log-revision-reason
 *
 * 사용자가 "🔄 무료 재생성" 클릭 시 선택적으로 이유 (1-2 단어 또는 카테고리 chip)
 * 를 받아 plans/{planId}.revisionReasons 배열에 push.
 *
 * Tier 1-B (운영 학습 루프) — 첫 결과 만족도 추정 + revisionCredits 사용 패턴 분석.
 *
 * Body:
 *   {
 *     planId,                    // 'plan_xxx' 필수
 *     reason: 'restaurant' | 'route' | 'schedule' | 'language' | 'other',
 *     freeText?: string,         // 옵션, 100자 이내
 *     language?: 'ko'|'en'|'ja'|'zh'
 *   }
 *
 * Auth: optional Bearer Firebase token. plan owner 만 push 가능 (uid 매칭).
 *       비로그인/공개 plan 도 push 허용 (revisionToken 검증은 ai-planner-full 에서 후속).
 *
 * 부수효과 X — 단순 메타데이터 로깅. 재생성 자체는 별도 endpoint (/api/ai-planner-full).
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

const VALID_REASONS = new Set(['restaurant', 'route', 'schedule', 'language', 'other']);
const MAX_FREE_TEXT_LEN = 100;

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
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

    const { planId, reason, freeText = '', language = 'en' } = body;

    if (!planId || typeof planId !== 'string') {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('planId required', 'MISSING_PLAN_ID')));
    }
    if (!VALID_REASONS.has(reason)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`Invalid reason. Allowed: ${[...VALID_REASONS].join(', ')}`, 'INVALID_REASON')));
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
