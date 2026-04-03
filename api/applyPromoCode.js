/**
 * Vercel API Route: Apply Promo Code
 * POST /api/applyPromoCode
 * 
 * Firebase 없이 동작 - EARLY50 코드는 고정 로직
 * 실제 사용량 추적이 필요하면 Google Sheets로 대체
 */

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 프로모 코드 설정
const PROMO_CODES = {
  'EARLY50': { discount: 0.20, label: 'Early Bird 20% OFF', limit: 50 },
  'COCO10': { discount: 0.10, label: '10% OFF', limit: 9999 },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { code, originalPrice } = body;

    if (!code || !originalPrice) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing code or originalPrice' }));
    }

    const promo = PROMO_CODES[code.toUpperCase()];
    if (!promo) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'invalid_code', message: '유효하지 않은 코드입니다.' }));
    }

    const savedAmount = Math.round(originalPrice * promo.discount);
    const discountedPrice = originalPrice - savedAmount;

    console.log('[applyPromoCode] 적용 성공:', { code: code.toUpperCase(), originalPrice, discountedPrice });

    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      valid: true,
      code: code.toUpperCase(),
      label: promo.label,
      discountRate: promo.discount,
      originalPrice,
      savedAmount,
      discountedPrice,
    }));
  } catch (err) {
    console.error('[applyPromoCode] Error:', err);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}