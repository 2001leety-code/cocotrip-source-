/**
 * CocoTripKR — 투어 전날 날씨 확인 (스케줄 함수)
 *
 * 매일 오후 6:00 KST (= UTC 09:00) 실행
 * 내일 투어 예약을 확인하고 날씨 악화 시 대체 코스 제안
 *
 * 실행 내용:
 *  1. Google Sheets에서 내일 투어 목록 읽기
 *  2. Open-Meteo API로 각 투어 지역 날씨 조회
 *  3. 악천후 감지 → Gemini 4호 → 대체 코스 생성
 *  4. 텔레그램 → 태연님께 알림
 *
 * CONTEXT: CocoTripKR 자동화 스케줄 함수
 * SCHEDULE: 0 9 * * * (UTC) = 매일 KST 18:00
 */

import { getTomorrowTours } from './_google-sheets.js';
import { sendMessage, sendWeatherOkAlert, sendErrorAlert } from './_telegram.js';
import { generateWeatherAlert } from './_ai-employees.js';

// 지역별 좌표 매핑
const REGION_COORDS = {
  서울:    { lat: 37.5665, lon: 126.9780 },
  부산:    { lat: 35.1796, lon: 129.0756 },
  경주:    { lat: 35.8562, lon: 129.2247 },
  제주:    { lat: 33.4996, lon: 126.5312 },
  강릉:    { lat: 37.7519, lon: 128.8761 },
  평창:    { lat: 37.3707, lon: 128.3906 },
  전주:    { lat: 35.8200, lon: 127.1088 },
  춘천:    { lat: 37.8813, lon: 127.7298 },
  가평:    { lat: 37.8315, lon: 127.5117 },
  파주:    { lat: 37.7600, lon: 126.7800 },
  인천:    { lat: 37.4563, lon: 126.7052 },
  강화도:  { lat: 37.7472, lon: 126.4881 },
  단양:    { lat: 36.9848, lon: 128.3659 },
};

const DEFAULT_COORDS = { lat: 37.5665, lon: 126.9780 }; // 서울 기본값

// ── 지역 감지 ──────────────────────────────────────────────────────────
function detectRegion(tourRow) {
  const product  = (tourRow[4] || '').toLowerCase();
  const pickup   = (tourRow[6] || '').toLowerCase();
  const dropoff  = (tourRow[7] || '').toLowerCase();
  const combined = `${product} ${pickup} ${dropoff}`;

  for (const [region, coords] of Object.entries(REGION_COORDS)) {
    if (combined.includes(region)) return { region, coords };
  }
  return { region: '서울', coords: DEFAULT_COORDS };
}

// ── Open-Meteo API 날씨 조회 ──────────────────────────────────────────
async function getWeatherForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=Asia%2FSeoul&forecast_days=2`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    // 내일 (index 1) 날씨 데이터
    const tomorrowIndex = 1;
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
    console.warn('[weather-check] 날씨 API 오류:', err.message);
    return null;
  }
}

// WMO 날씨 코드 → 설명
function weatherCodeToDescription(code) {
  if (code === 0)           return '맑음 ☀️';
  if (code <= 3)            return '구름 조금 🌤';
  if (code <= 49)           return '안개 🌫';
  if (code <= 59)           return '이슬비 🌦';
  if (code <= 69)           return '비 🌧';
  if (code <= 79)           return '눈 🌨';
  if (code <= 84)           return '소나기 ⛈';
  if (code <= 99)           return '뇌우 ⛈';
  return '날씨 확인 중';
}

// 악천후 판단
function isBadWeather(weatherCode, precipitation, windSpeed) {
  return weatherCode >= 51 || precipitation > 10 || windSpeed > 50;
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const weatherCheckTask = async () => {
  console.log('[weather-check] 날씨 확인 시작');

  try {
    const tomorrowTours = await getTomorrowTours();

    if (tomorrowTours.length === 0) {
      console.log('[weather-check] 내일 투어 없음 — 종료');
      return { statusCode: 200, body: 'No tours tomorrow' };
    }

    console.log(`[weather-check] 내일 투어 ${tomorrowTours.length}건 확인 중`);

    for (const tourRow of tomorrowTours) {
      const tourName    = tourRow[4] || '투어';
      const customerName = tourRow[1] || 'Guest';
      const { region, coords } = detectRegion(tourRow);

      const weather = await getWeatherForecast(coords.lat, coords.lon);

      if (!weather) {
        await sendMessage(`⚠️ <b>날씨 확인 실패</b>\n투어: ${tourName} (${customerName})\n지역: ${region}\n수동 확인 필요`);
        continue;
      }

      const tourInfo = {
        tourName,
        customerName,
        region,
        tourDate: tourRow[5] || '내일',
        originalItinerary: [tourRow[6], tourRow[7]].filter(Boolean).join(' → '),
      };

      if (weather.isBad) {
        console.log('[weather-check] 악천후 감지:', region, weather.description);

        let alertMsg;
        try {
          alertMsg = await generateWeatherAlert(tourInfo, weather);
        } catch (aiErr) {
          console.warn('[weather-check] AI 대체 코스 생성 실패:', aiErr.message);
          // 기본 형식
          alertMsg = `🌧 <b>날씨 경보: 내일 악천후 예보!</b>

투어: ${tourName}
고객: ${customerName}
지역: ${region}
예보: ${weather.description} / ${weather.temperature}°C
강수량: ${weather.precipitation}mm
풍속: ${weather.windSpeed}km/h

⚠️ 실내 대체 코스 검토 및 고객 안내 필요
👉 태연님 확인 후 고객에게 통보해주세요`;
        }

        await sendMessage(alertMsg);
      } else {
        // 날씨 정상
        await sendWeatherOkAlert(tourInfo, weather);
      }
    }

    console.log('[weather-check] 날씨 확인 완료');
    return { statusCode: 200, body: `Checked ${tomorrowTours.length} tours` };

  } catch (err) {
    console.error('[weather-check] 오류:', err.message);
    try {
      await sendErrorAlert('weather-check', err);
    } catch {}
    return { statusCode: 500, body: err.message };
  }
};

// Netlify Scheduled Function: 매일 UTC 09:00 (KST 18:00)
const originalHandler = schedule('0 9 * * *', weatherCheckTask);

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
  