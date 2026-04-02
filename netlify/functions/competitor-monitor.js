/**
 * CocoTripKR ??ê²½ìŸ??ëª¨ë‹ˆ?°ë§ (?¤ì?ì¤??¨ìˆ˜)
 *
 * ë§¤ì¼ ?¤ì „ 9:00 KST (= UTC 00:00) ?¤í–‰
 * Klook, Viator, GetYourGuide ??ê²½ìŸ??ê°€ê²??¤ìº”
 * ê°€ê²?ë³€?????”ë ˆê·¸ë¨ ?Œë¦¼
 *
 * CONTEXT: CocoTripKR ë§ˆì????ë™?? * SCHEDULE: 0 0 * * * (UTC) = ë§¤ì¼ KST 09:00
 */

// import { schedule } from '@netlify/functions'; // DISABLED
import { sendLongMessage, sendErrorAlert } from './telegram.js';

// ?€?€ ê²½ìŸ??URL ëª©ë¡ (ê³µê°œ ?˜ì´ì§€ ?¤í¬?˜í•‘) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const COMPETITORS = [
  {
    name: 'Klook',
    category: '?¸ì²œê³µí•­ ?½ì—…',
    url: 'https://www.klook.com/ko/activity/6095-incheon-airport-transfer-seoul/',
    priceSelector: 'price',
    lastKnownPrice: 45000, // KRW
  },
  {
    name: 'Klook',
    category: '?œìš¸ ?œí‹°?¬ì–´',
    url: 'https://www.klook.com/ko/activity/1425-seoul-city-tour/',
    priceSelector: 'price',
    lastKnownPrice: 89000,
  },
  {
    name: 'Viator',
    category: '?œìš¸ ?„ë¼?´ë¹— ?¬ì–´',
    url: 'https://www.viator.com/Seoul-tours/Private-Tours/d973-g13-c118',
    priceSelector: 'price',
    lastKnownPrice: 150, // USD
  },
  {
    name: 'GetYourGuide',
    category: '?œêµ­ ?„ë¼?´ë¹— ?¬ì–´',
    url: 'https://www.getyourguide.com/seoul-l563/private-tour-tc118/',
    priceSelector: 'price',
    lastKnownPrice: 180, // USD
  },
];

// ?€?€ ì½”ì½”?¸ë¦½ ê°€ê²©í‘œ (ë¹„êµ ê¸°ì?) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const COCOTRIP_PRICES = {
  '?¸ì²œê³µí•­ ?½ì—…': { krw: 124800, usd: 90 },
  '?œìš¸ ?œí‹°?¬ì–´': { krw: 291200, usd: 211 },
  '?œìš¸ ?„ë¼?´ë¹— ?¬ì–´': { krw: 291200, usd: 211 },
  '?œêµ­ ?„ë¼?´ë¹— ?¬ì–´': { krw: 291200, usd: 211 },
};

// ?€?€ ê°€ê²??¤í¬?˜í•‘ (ê°„ë‹¨???ìŠ¤??ê¸°ë°˜) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
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

    // ê°€ê²?ì¶”ì¶œ (?¤ì–‘???¨í„´)
    const pricePatterns = [
      /??s*([\d,]+)/,                    // ??5,000
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

    return { ...competitor, currentPrice: null, error: 'ê°€ê²?ì¶”ì¶œ ?¤íŒ¨' };
  } catch (err) {
    return { ...competitor, currentPrice: null, error: err.message };
  }
}

// ?€?€ ë©”ì¸ ?¸ë“¤???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const competitorTask = async () => {
  console.log('[competitor-monitor] ê²½ìŸ??ê°€ê²??¤ìº” ?œì‘');

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
            direction: changePct > 0 ? '?“ˆ ?¸ìƒ' : '?“‰ ?¸í•˜',
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

    // ?”ë ˆê·¸ë¨ ë³´ê³ 
    let msg = `?“Š <b>ê²½ìŸ??ê°€ê²?ëª¨ë‹ˆ?°ë§ ë¦¬í¬??/b>\n?â”?â”?â”?â”?â”?â”?â”?â”?â”\n\n`;

    if (priceChanges.length > 0) {
      msg += `? ï¸ <b>ê°€ê²?ë³€??ê°ì?!</b>\n`;
      for (const pc of priceChanges) {
        msg += `${pc.direction} ${pc.name} (${pc.category}): ${pc.lastKnownPrice} ??${pc.currentPrice} (${pc.changePct}%)\n`;
      }
      msg += '\n';
    } else {
      msg += `??ì£¼ìš” ê°€ê²?ë³€???†ìŒ\n\n`;
    }

    msg += `?“‹ <b>ê²½ìŸ??ë¹„êµ??/b>\n`;
    for (const comp of comparisons) {
      const diff = comp.cocotripPrice - comp.competitorPrice;
      const status = diff > 0 ? 'â¬†ï¸ ?°ë¦¬ê°€ ë¹„ìŒˆ' : diff < 0 ? 'â¬‡ï¸ ?°ë¦¬ê°€ ?€?? : '?Ÿ° ?™ì¼';
      msg += `??${comp.competitor} ${comp.category}: ${comp.competitorPrice} vs ì½”ì½”?¸ë¦½ ${comp.cocotripPrice} ${status}\n`;
    }

    const failedCount = scanned.filter(s => s.error).length;
    if (failedCount > 0) {
      msg += `\n? ï¸ ${failedCount}ê°??¬ì´???¤ìº” ?¤íŒ¨ (ì°¨ë‹¨ ?ëŠ” êµ¬ì¡° ë³€ê²?`;
    }

    await sendLongMessage(msg);
    console.log('[competitor-monitor] ?¤ìº” ?„ë£Œ');
    return { statusCode: 200, body: `Scanned ${scanned.length} competitors` };

  } catch (err) {
    console.error('[competitor-monitor] ?¤ë¥˜:', err.message);
    try { await sendErrorAlert('competitor-monitor', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// DISABLED: ë¹„ìš© ìµœì ?”ë? ?„í•´ ë¹„í™œ?±í™” (2026-04-02)
// export const handler = schedule('0 0 * * *', competitorTask);
export const handler = async () => ({ statusCode: 200, body: 'disabled' });
