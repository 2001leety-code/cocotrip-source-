/**
 * Vercel API Route: Refund Policy Preview (GET)
 * GET /api/refundPolicy?tourDate=YYYY-MM-DD[&tourTime=HH:mm][&tier=Bronze|Silver|Gold|Platinum]
 *
 * 프론트엔드가 결제 전 고지 + 내 예약 목록에서 표시.
 * 실제 환불 실행은 /api/cancelBooking.
 */
import { evaluateRefundPolicy } from './_refund-policy.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const tourDate = url.searchParams.get('tourDate');
    const tourTime = url.searchParams.get('tourTime') || '00:00';
    const tier     = url.searchParams.get('tier') || 'Bronze';

    if (!tourDate) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('tourDate is required', 'MISSING_FIELDS')));
    }

    const policy = evaluateRefundPolicy({ tourDate, tourTime, tier });
    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok(policy)));
  } catch (err) {
    console.error('[refundPolicy] Error:', err);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
