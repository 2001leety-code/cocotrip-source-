/**
 * CocoTripKR ???¤ì‹œê°?êµí†µ ?Œë¦¼ (?¤ì?ì¤??¨ìˆ˜)
 *
 * ë§¤ì¼ ?¤ì „ 6:00 KST (= UTC 21:00 ?„ë‚ ) ?¤í–‰
 * ?¤ëŠ˜ ?¬ì–´ 1?œê°„ ??êµí†µ ?í™© ?•ì¸ ??15ë¶??´ìƒ ì§€????ê³ ê° ?ë™ ?ˆë‚´
 *
 * Google Maps Routes API ?€??Naver Maps Directions API ?¬ìš© (?´ë? ??ë³´ìœ )
 *
 * CONTEXT: CocoTripKR ?ë™?? * SCHEDULE: 0 21 * * * (UTC) = ë§¤ì¼ KST 06:00
 */

// import { schedule } from '@netlify/functions'; // DISABLED
import { getTodayTours } from './google-sheets.js';
import { sendMessage, sendErrorAlert } from './telegram.js';

// ì§€??³„ ê¸°ë³¸ ì¢Œí‘œ (ì¶œë°œì§€ ???„ì°©ì§€ ì¶”ì •)
const LOCATION_COORDS = {
  '?¸ì²œê³µí•­': { lat: 37.4602, lng: 126.4407 },
  'ê¹€?¬ê³µ??: { lat: 37.5586, lng: 126.7945 },
  '?œìš¸??: { lat: 37.5547, lng: 126.9707 },
  'ê°•ë‚¨': { lat: 37.4979, lng: 127.0276 },
  '?ë?': { lat: 37.5563, lng: 126.9234 },
  'ëª…ë™': { lat: 37.5636, lng: 126.9869 },
  '?´íƒœ??: { lat: 37.5340, lng: 126.9948 },
  '? ì‹¤': { lat: 37.5133, lng: 127.1002 },
  'ê°€??: { lat: 37.8315, lng: 127.5117 },
  '?¨ì´??: { lat: 37.7909, lng: 127.5254 },
  DEFAULT: { lat: 37.5665, lng: 126.9780 }, // ?œìš¸ ?œì²­
};

// ?€?€ ì¢Œí‘œ ì¶”ì • ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function estimateCoords(locationText) {
  const text = (locationText || '').toLowerCase();
  for (const [key, coords] of Object.entries(LOCATION_COORDS)) {
    if (key === 'DEFAULT') continue;
    if (text.includes(key.toLowerCase()) || text.includes(key)) return coords;
  }
  return LOCATION_COORDS.DEFAULT;
}

// ?€?€ ?¤ì´ë²?ì§€??ê²½ë¡œ ì¡°íšŒ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function getRouteInfo(startCoords, endCoords) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // API ??ë¯¸ì„¤????ê¸°ë³¸ ì¶”ì •ê°?ë°˜í™˜
    return {
      durationMin: 45,
      distanceKm: 25,
      trafficStatus: 'unknown',
      estimated: true,
    };
  }

  try {
    const url = `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving?start=${startCoords.lng},${startCoords.lat}&goal=${endCoords.lng},${endCoords.lat}&option=traoptimal`;
    const res = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    if (data.code === 0 && data.route?.traoptimal?.[0]) {
      const summary = data.route.traoptimal[0].summary;
      return {
        durationMin: Math.ceil(summary.duration / 60000),
        distanceKm: Math.round(summary.distance / 100) / 10,
        trafficStatus: summary.duration > summary.distance / 500 * 60000 ? 'congested' : 'normal',
        estimated: false,
      };
    }
  } catch (err) {
    console.warn('[traffic-alert] ê²½ë¡œ ì¡°íšŒ ?¤íŒ¨:', err.message);
  }

  return { durationMin: 45, distanceKm: 25, trafficStatus: 'unknown', estimated: true };
}

// ?€?€ ë©”ì¸ ?¸ë“¤???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const trafficTask = async () => {
  console.log('[traffic-alert] êµí†µ ?í™© ?•ì¸ ?œì‘');

  try {
    const todayTours = await getTodayTours();

    if (todayTours.length === 0) {
      console.log('[traffic-alert] ?¤ëŠ˜ ?¬ì–´ ?†ìŒ');
      return { statusCode: 200, body: 'No tours today' };
    }

    console.log(`[traffic-alert] ?¤ëŠ˜ ?¬ì–´ ${todayTours.length}ê±?êµí†µ ?•ì¸`);

    let alertCount = 0;

    for (const tour of todayTours) {
      const customerName = tour[1] || 'Guest';
      const product = tour[4] || '';
      const pickup = tour[6] || '';
      const dropoff = tour[7] || '';

      const startCoords = estimateCoords(pickup);
      const endCoords = estimateCoords(dropoff);

      const route = await getRouteInfo(startCoords, endCoords);

      // ?•ìƒ ?Œìš”?œê°„??1.5ë°??´ìƒ?´ë©´ ì§€??ê²½ë³´ (ê¸°ë³¸ 30ë¶?ê¸°ì? ??45ë¶??´ìƒ)
      const normalDuration = 30; // ê¸°ë³¸ ?ˆìƒ ?Œìš”?œê°„ (ë¶?
      const isDelayed = route.durationMin > normalDuration * 1.5;

      if (isDelayed) {
        alertCount++;
        const msg = `?š¨ <b>êµí†µ ì§€??ê²½ë³´!</b>

?“‹ ?¬ì–´: ${product}
?‘¤ ê³ ê°: ${customerName}
?“ ê²½ë¡œ: ${pickup || 'ë¯¸ì •'} ??${dropoff || 'ë¯¸ì •'}

???ˆìƒ ?Œìš”?œê°„: <b>${route.durationMin}ë¶?/b> (?•ìƒ ${normalDuration}ë¶?
?“ ê±°ë¦¬: ${route.distanceKm}km
?š¦ êµí†µ: ${route.trafficStatus === 'congested' ? '?•ì²´' : 'ë³´í†µ'}
${route.estimated ? '? ï¸ (ì¶”ì •ê°???API ë¯¸ì—°??' : '???¤ì‹œê°??°ì´??}

?’¡ <b>ê¶Œì¥ ì¡°ì¹˜:</b>
- ê³ ê°?ê²Œ ${route.durationMin - normalDuration}ë¶??¼ì° ì¶œë°œ ?ˆë‚´
- ?€ì²?ê²½ë¡œ ê²€??- ?½ì—… ?œê°„ ì¡°ì • ê³ ë ¤`;

        await sendMessage(msg);
      }
    }

    if (alertCount === 0) {
      await sendMessage(`?Ÿ¢ <b>?¤ëŠ˜ êµí†µ ?í™© ?‘í˜¸</b>\n\n?¤ëŠ˜ ?¬ì–´ ${todayTours.length}ê±???ëª¨ë“  ê²½ë¡œ ?•ìƒ ?Œìš”?œê°„ ?ˆìƒ`);
    }

    return { statusCode: 200, body: `Checked ${todayTours.length} tours, ${alertCount} alerts` };

  } catch (err) {
    console.error('[traffic-alert] ?¤ë¥˜:', err.message);
    try { await sendErrorAlert('traffic-alert', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// DISABLED: ë¹„ìš© ìµœì ?”ë? ?„í•´ ë¹„í™œ?±í™” (2026-04-02)
// export const handler = schedule('0 21 * * *', trafficTask);
export const handler = async () => ({ statusCode: 200, body: 'disabled' });
