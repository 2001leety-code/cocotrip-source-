/**
 * GET /api/braintreeClientToken
 *
 * Braintree Drop-in UI를 띄우려면 client token 필요. 매 결제마다 또는 페이지 로드
 * 직후 한 번 발급. 만료 (~24h) 짧으니 server에서 발급하고 client는 결제 직전 fetch.
 *
 * Response: { ok: true, clientToken: "..." }
 */
import { generateClientToken } from './_shared/braintree.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  try {
    // customerId optional (vault된 결제 수단 표시용). 익명 결제면 그냥 새 토큰.
    const customerId = (req.query?.customerId || '').toString().trim() || undefined;
    const clientToken = await generateClientToken(customerId);
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, clientToken }));
  } catch (err) {
    console.error('[braintreeClientToken] failed:', err.message);
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message, code: 'CLIENT_TOKEN_ERROR' }));
  }
}
