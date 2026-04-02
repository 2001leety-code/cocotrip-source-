/**
 * CocoTripKR ???¬ì–´ ?„ë‚  ? ì”¨ ?•ì¸ (?¤ì?ì¤??¨ìˆ˜)
 *
 * ë§¤ì¼ ?¤í›„ 6:00 KST (= UTC 09:00) ?¤í–‰
 * ?´ì¼ ?¬ì–´ ?ˆì•½???•ì¸?˜ê³  ? ì”¨ ?…í™” ???€ì²?ì½”ìŠ¤ ?œì•ˆ
 *
 * ?¤í–‰ ?´ìš©:
 *  1. Google Sheets?ì„œ ?´ì¼ ?¬ì–´ ëª©ë¡ ?½ê¸°
 *  2. Open-Meteo APIë¡?ê°??¬ì–´ ì§€??? ì”¨ ì¡°íšŒ
 *  3. ?…ì²œ??ê°ì? ??Gemini 4?????€ì²?ì½”ìŠ¤ ?ì„±
 *  4. ?”ë ˆê·¸ë¨ ???œì—°?˜ê»˜ ?Œë¦¼
 *
 * CONTEXT: CocoTripKR ?ë™???¤ì?ì¤??¨ìˆ˜
 * SCHEDULE: 0 9 * * * (UTC) = ë§¤ì¼ KST 18:00
 */

// import { schedule } from '@netlify/functions'; // DISABLED
import { getTomorrowTours } from './google-sheets.js';
import { sendMessage, sendWeatherOkAlert, sendErrorAlert } from './telegram.js';
import { generateWeatherAlert } from './ai-employees.js';

// ì§€??³„ ì¢Œí‘œ ë§¤í•‘
const REGION_COORDS = {
  ?œìš¸:    { lat: 37.5665, lon: 126.9780 },
  ë¶€??    { lat: 35.1796, lon: 129.0756 },
  ê²½ì£¼:    { lat: 35.8562, lon: 129.2247 },
  ?œì£¼:    { lat: 33.4996, lon: 126.5312 },
  ê°•ë¦‰:    { lat: 37.7519, lon: 128.8761 },
  ?‰ì°½:    { lat: 37.3707, lon: 128.3906 },
  ?„ì£¼:    { lat: 35.8200, lon: 127.1088 },
  ì¶˜ì²œ:    { lat: 37.8813, lon: 127.7298 },
  ê°€??    { lat: 37.8315, lon: 127.5117 },
  ?Œì£¼:    { lat: 37.7600, lon: 126.7800 },
  ?¸ì²œ:    { lat: 37.4563, lon: 126.7052 },
  ê°•í™”??  { lat: 37.7472, lon: 126.4881 },
  ?¨ì–‘:    { lat: 36.9848, lon: 128.3659 },
};

const DEFAULT_COORDS = { lat: 37.5665, lon: 126.9780 }; // ?œìš¸ ê¸°ë³¸ê°?
// ?€?€ ì§€??ê°ì? ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function detectRegion(tourRow) {
  const product  = (tourRow[4] || '').toLowerCase();
  const pickup   = (tourRow[6] || '').toLowerCase();
  const dropoff  = (tourRow[7] || '').toLowerCase();
  const combined = `${product} ${pickup} ${dropoff}`;

  for (const [region, coords] of Object.entries(REGION_COORDS)) {
    if (combined.includes(region)) return { region, coords };
  }
  return { region: '?œìš¸', coords: DEFAULT_COORDS };
}

// ?€?€ Open-Meteo API ? ì”¨ ì¡°íšŒ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function getWeatherForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=Asia%2FSeoul&forecast_days=2`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    // ?´ì¼ (index 1) ? ì”¨ ?°ì´??    const tomorrowIndex = 1;
    const weatherCode   = data.daily?.weathercode?.[tomorrowIndex] ?? 0;
    const tempMax       = data.daily?.temperature_2m_max?.[tomorrowIndex] ?? 0;
    const tempMin       = data.daily?.temperature_2m_min?.[tomorrowIndex] ?? 0;
    const precipitation = data.daily?.precipitation_sum?.[tomorrowIndex] ?? 0;
    const windSpeed     = data.daily?.windspeed_10m_max?.[tomorrowIndex] ?? 0;

    return {
      weatherCode,
      description: weatherCodeToDescription(weatherCode),
      temperature: `${tempMin}~${tempMax}`,
      precipitation,
      windSpeed,
      isBad: isBadWeather(weatherCode, precipitation, windSpeed),
    };
  } catch (err) {
    console.warn('[weather-check] ? ì”¨ API ?¤ë¥˜:', err.message);
    return null;
  }
}

// WMO ? ì”¨ ì½”ë“œ ???¤ëª…
function weatherCodeToDescription(code) {
  if (code === 0)           return 'ë§‘ìŒ ?€ï¸?;
  if (code <= 3)            return 'êµ¬ë¦„ ì¡°ê¸ˆ ?Œ¤';
  if (code <= 49)           return '?ˆê°œ ?Œ«';
  if (code <= 59)           return '?´ìŠ¬ë¹??Œ¦';
  if (code <= 69)           return 'ë¹??Œ§';
  if (code <= 79)           return '???Œ¨';
  if (code <= 84)           return '?Œë‚˜ê¸???;
  if (code <= 99)           return '?Œìš° ??;
  return '? ì”¨ ?•ì¸ ì¤?;
}

// ?…ì²œ???ë‹¨
function isBadWeather(weatherCode, precipitation, windSpeed) {
  return weatherCode >= 51 || precipitation > 10 || windSpeed > 50;
}

// ?€?€ ë©”ì¸ ?¸ë“¤???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const weatherCheckTask = async () => {
  console.log('[weather-check] ? ì”¨ ?•ì¸ ?œì‘');

  try {
    const tomorrowTours = await getTomorrowTours();

    if (tomorrowTours.length === 0) {
      console.log('[weather-check] ?´ì¼ ?¬ì–´ ?†ìŒ ??ì¢…ë£Œ');
      return { statusCode: 200, body: 'No tours tomorrow' };
    }

    console.log(`[weather-check] ?´ì¼ ?¬ì–´ ${tomorrowTours.length}ê±??•ì¸ ì¤?);

    for (const tourRow of tomorrowTours) {
      const tourName    = tourRow[4] || '?¬ì–´';
      const customerName = tourRow[1] || 'Guest';
      const { region, coords } = detectRegion(tourRow);

      const weather = await getWeatherForecast(coords.lat, coords.lon);

      if (!weather) {
        await sendMessage(`? ï¸ <b>? ì”¨ ?•ì¸ ?¤íŒ¨</b>\n?¬ì–´: ${tourName} (${customerName})\nì§€?? ${region}\n?˜ë™ ?•ì¸ ?„ìš”`);
        continue;
      }

      const tourInfo = {
        tourName,
        customerName,
        region,
        tourDate: tourRow[5] || '?´ì¼',
        originalItinerary: [tourRow[6], tourRow[7]].filter(Boolean).join(' ??'),
      };

      if (weather.isBad) {
        console.log('[weather-check] ?…ì²œ??ê°ì?:', region, weather.description);

        let alertMsg;
        try {
          alertMsg = await generateWeatherAlert(tourInfo, weather);
        } catch (aiErr) {
          console.warn('[weather-check] AI ?€ì²?ì½”ìŠ¤ ?ì„± ?¤íŒ¨:', aiErr.message);
          // ê¸°ë³¸ ?•ì‹
          alertMsg = `?Œ§ <b>? ì”¨ ê²½ë³´: ?´ì¼ ?…ì²œ???ˆë³´!</b>

?¬ì–´: ${tourName}
ê³ ê°: ${customerName}
ì§€?? ${region}
?ˆë³´: ${weather.description} / ${weather.temperature}Â°C
ê°•ìˆ˜?? ${weather.precipitation}mm
?ì†: ${weather.windSpeed}km/h

? ï¸ ?¤ë‚´ ?€ì²?ì½”ìŠ¤ ê²€??ë°?ê³ ê° ?ˆë‚´ ?„ìš”
?‘‰ ?œì—°???•ì¸ ??ê³ ê°?ê²Œ ?µë³´?´ì£¼?¸ìš”`;
        }

        await sendMessage(alertMsg);
      } else {
        // ? ì”¨ ?•ìƒ
        await sendWeatherOkAlert(tourInfo, weather);
      }
    }

    console.log('[weather-check] ? ì”¨ ?•ì¸ ?„ë£Œ');
    return { statusCode: 200, body: `Checked ${tomorrowTours.length} tours` };

  } catch (err) {
    console.error('[weather-check] ?¤ë¥˜:', err.message);
    try {
      await sendErrorAlert('weather-check', err);
    } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// Netlify Scheduled Function: ë§¤ì¼ UTC 09:00 (KST 18:00)
// DISABLED: ë¹„ìš© ìµœì ?”ë? ?„í•´ ë¹„í™œ?±í™” (2026-04-02)
// export const handler = schedule('0 9 * * *', weatherCheckTask);
export const handler = async () => ({ statusCode: 200, body: 'disabled' });
