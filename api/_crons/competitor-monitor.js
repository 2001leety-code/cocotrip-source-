/**
 * CocoTripKR — 경쟁사 모니터링 (스케줄 함수)
 *
 * 매일 오전 9:00 KST (= UTC 00:00) 실행
 * Klook, Viator, GetYourGuide 등 경쟁사 가격 스캔
 * 가격 변동 시 텔레그램 알림
 *
 * CONTEXT: CocoTripKR 마케팅 자동화
 * SCHEDULE: 0 0 * * * (UTC) = 매일 KST 09:00
 */

import { sendLongMessage, sendErrorAlert } from '../_telegram.js';

// ── 경쟁사 URL 목록 (공개 페이지 스크래핑) ─────────────────────────
const COMPETITORS = [
  {
    name: 'Klook',
    category: '인천공항 픽업',
    url: 'https://www.klook.com/ko/activity/6095-incheon-airport-transfer-seoul/',
    priceSelector: 'price',
    lastKnownPrice: 45000, // KRW
  },
  {
    name: 'Klook',
    category: '서울 시티투어',
    url: 'https://www.klook.com/ko/activity/1425-seoul-city-tour/',
    priceSelector: 'price',
    lastKnownPrice: 89000,
  },
  {
    name: 'Viator',
    category: '서울 프라이빗 투어',
    url: 'https://www.viator.com/Seoul-tours/Private-Tours/d973-g13-c118',
    priceSelector: 'price',
    lastKnownPrice: 150, // USD
  },
  {
    name: 'GetYourGuide',
    category: '한국 프라이빗 투어',
    url: 'https://www.getyourguide.com/seoul-l563/private-tour-tc118/',
    priceSelector: 'price',
    lastKnownPrice: 180, // USD
  },
];

// ── 코코트립 가격표 (비교 기준) ──────────────────────────────────────
const COCOTRIP_PRICES = {
  '인천공항 픽업': { krw: 124800, usd: 90 },
  '서울 시티투어': { krw: 291200, usd: 211 },
  '서울 프라이빗 투어': { krw: 291200, usd: 211 },
  '한국 프라이빗 투어': { krw: 291200, usd: 211 },
};

// ── 가격 스크래핑 (간단한 텍스트 기반) ───────────────────────────────
async function scrapePrice(competitor) {
  try {
    const res = await fetch(competitor.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { ...competitor, currentPrice: null, error: `HTTP ${res.status}` };

    const html = await res.text();

    // 가격 추출 (다양한 패턴)
    const pricePatterns = [
      /₩\s*([\d,]+)/,                    // ₩45,000
      /KRW\s*([\d,]+)/i,                 // KRW 45000
      /\$\s*([\d,.]+)/,                   // $150.00
      /USD\s*([\d,.]+)/i,                 // USD 150
      /from\s*\$?\s*([\d,.]+)/i,          // from $150
      /"price":\s*"?([\d,.]+)/,           // JSON price field
      /data-price="([\d,.]+)"/,           // data attribute
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (price > 0) return { ...competitor, currentPrice: price };
      }
    }

    return { ...competitor, currentPrice: null, error: '가격 추출 실패' };
  } catch (err) {
    return { ...competitor, currentPrice: null, error: err.message };
  }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const competitorTask = async () => {
  console.log('[competitor-monitor] 경쟁사 가격 스캔 시작');

  try {
    const results = await Promise.allSettled(
      COMPETITORS.map(c => scrapePrice(c))
    );

    const scanned = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const priceChanges = [];
    const comparisons = [];

    for (const item of scanned) {
      const cocotripPrice = COCOTRIP_PRICES[item.category];

      if (item.currentPrice && item.lastKnownPrice) {
        const changePct = ((item.currentPrice - item.lastKnownPrice) / item.lastKnownPrice * 100).toFixed(1);
        if (Math.abs(changePct) > 5) {
          priceChanges.push({
            ...item,
            changePct,
            direction: changePct > 0 ? '📈 인상' : '📉 인하',
          });
        }
      }

      if (item.currentPrice && cocotripPrice) {
        comparisons.push({
          competitor: item.name,
          category: item.category,
          competitorPrice: item.currentPrice,
          cocotripPrice: cocotripPrice.krw || cocotripPrice.usd,
          url: item.url,
        });
      }
    }

    // 텔레그램 보고
    let msg = `📊 <b>경쟁사 가격 모니터링 리포트</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (priceChanges.length > 0) {
      msg += `⚠️ <b>가격 변동 감지!</b>\n`;
      for (const pc of priceChanges) {
        msg += `${pc.direction} ${pc.name} (${pc.category}): ${pc.lastKnownPrice} → ${pc.currentPrice} (${pc.changePct}%)\n`;
      }
      msg += '\n';
    } else {
      msg += `✅ 주요 가격 변동 없음\n\n`;
    }

    msg += `📋 <b>경쟁사 비교표</b>\n`;
    for (const comp of comparisons) {
      const diff = comp.cocotripPrice - comp.competitorPrice;
      const status = diff > 0 ? '⬆️ 우리가 비쌈' : diff < 0 ? '⬇️ 우리가 저렴' : '🟰 동일';
      msg += `• ${comp.competitor} ${comp.category}: ${comp.competitorPrice} vs 코코트립 ${comp.cocotripPrice} ${status}\n`;
    }

    const failedCount = scanned.filter(s => s.error).length;
    if (failedCount > 0) {
      msg += `\n⚠️ ${failedCount}개 사이트 스캔 실패 (차단 또는 구조 변경)`;
    }

    await sendLongMessage(msg);
    console.log('[competitor-monitor] 스캔 완료');
    return { statusCode: 200, body: `Scanned ${scanned.length} competitors` };

  } catch (err) {
    console.error('[competitor-monitor] 오류:', err.message);
    try { await sendErrorAlert('competitor-monitor', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

const originalHandler = competitorTask;

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  