/**
 * Vercel API Route: Refund Policy Preview (GET)
 * GET /api/refundPolicy?tourDate=YYYY-MM-DD[&tourTime=HH:mm][&tier=Bronze|Silver|Gold|Platinum]
 *
 * 프론트엔드가 결제 전 고지 + 내 예약 목록에서 표시.
 * 실제 환불 실행은 /api/cancelBooking.
 *
 * Runtime: **edge** — 순수 compute (date math + tier lookup) + 모든 의존성이
 * Edge 호환. 매번 호출되는 결제 전 고지 페이지에서 cold start 차이 직접 영향.
 */
import { evaluateRefundPolicy } from './_refund-policy.js';

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const url = new URL(req.url);
    const tourDate = url.searchParams.get('tourDate');
    const tourTime = url.searchParams.get('tourTime') || '00:00';
    const tier     = url.searchParams.get('tier') || 'Bronze';

    if (!tourDate) {
      return new Response(JSON.stringify(_err('tourDate is required', 'MISSING_FIELDS')), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const policy = evaluateRefundPolicy({ tourDate, tourTime, tier });
    return new Response(JSON.stringify(_ok(policy)), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error('[refundPolicy] Error:', err);
    return new Response(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
