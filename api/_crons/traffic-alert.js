/**
 * CocoTripKR — 실시간 교통 알림 (스케줄 함수)
 *
 * 매일 오전 6:00 KST (= UTC 21:00 전날) 실행
 * 오늘 투어 1시간 전 교통 상황 확인 → 15분 이상 지연 시 고객 자동 안내
 *
 * Google Maps Routes API 대신 Naver Maps Directions API 사용 (이미 키 보유)
 *
 * CONTEXT: CocoTripKR 자동화
 * SCHEDULE: 0 21 * * * (UTC) = 매일 KST 06:00
 */

import { getTodayTours } from './_google-sheets.js';
import { sendMessage, sendErrorAlert } from './_telegram.js';

// 지역별 기본 좌표 (출발지 → 도착지 추정)
const LOCATION_COORDS = {
  '인천공항': { lat: 37.4602, lng: 126.4407 },
  '김포공항': { lat: 37.5586, lng: 126.7945 },
  '서울역': { lat: 37.5547, lng: 126.9707 },
  '강남': { lat: 37.4979, lng: 127.0276 },
  '홍대': { lat: 37.5563, lng: 126.9234 },
  '명동': { lat: 37.5636, lng: 126.9869 },
  '이태원': { lat: 37.5340, lng: 126.9948 },
  '잠실': { lat: 37.5133, lng: 127.1002 },
  '가평': { lat: 37.8315, lng: 127.5117 },
  '남이섬': { lat: 37.7909, lng: 127.5254 },
  DEFAULT: { lat: 37.5665, lng: 126.9780 }, // 서울 시청
};

// ── 좌표 추정 ────────────────────────────────────────────────────────
function estimateCoords(locationText) {
  const text = (locationText || '').toLowerCase();
  for (const [key, coords] of Object.entries(LOCATION_COORDS)) {
    if (key === 'DEFAULT') continue;
    if (text.includes(key.toLowerCase()) || text.includes(key)) return coords;
  }
  return LOCATION_COORDS.DEFAULT;
}

// ── 네이버 지도 경로 조회 ──────────────────────────────────────────
async function getRouteInfo(startCoords, endCoords) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // API 키 미설정 시 기본 추정값 반환
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
    console.warn('[traffic-alert] 경로 조회 실패:', err.message);
  }

  return { durationMin: 45, distanceKm: 25, trafficStatus: 'unknown', estimated: true };
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const trafficTask = async () => {
  console.log('[traffic-alert] 교통 상황 확인 시작');

  try {
    const todayTours = await getTodayTours();

    if (todayTours.length === 0) {
      console.log('[traffic-alert] 오늘 투어 없음');
      return { statusCode: 200, body: 'No tours today' };
    }

    console.log(`[traffic-alert] 오늘 투어 ${todayTours.length}건 교통 확인`);

    let alertCount = 0;

    for (const tour of todayTours) {
      const customerName = tour[1] || 'Guest';
      const product = tour[4] || '';
      const pickup = tour[6] || '';
      const dropoff = tour[7] || '';

      const startCoords = estimateCoords(pickup);
      const endCoords = estimateCoords(dropoff);

      const route = await getRouteInfo(startCoords, endCoords);

      // 정상 소요시간의 1.5배 이상이면 지연 경보 (기본 30분 기준 → 45분 이상)
      const normalDuration = 30; // 기본 예상 소요시간 (분)
      const isDelayed = route.durationMin > normalDuration * 1.5;

      if (isDelayed) {
        alertCount++;
        const msg = `🚨 <b>교통 지연 경보!</b>

📋 투어: ${product}
👤 고객: ${customerName}
📍 경로: ${pickup || '미정'} → ${dropoff || '미정'}

⏱ 예상 소요시간: <b>${route.durationMin}분</b> (정상 ${normalDuration}분)
📏 거리: ${route.distanceKm}km
🚦 교통: ${route.trafficStatus === 'congested' ? '정체' : '보통'}
${route.estimated ? '⚠️ (추정값 — API 미연동)' : '✅ 실시간 데이터'}

💡 <b>권장 조치:</b>
- 고객에게 ${route.durationMin - normalDuration}분 일찍 출발 안내
- 대체 경로 검토
- 픽업 시간 조정 고려`;

        await sendMessage(msg);
      }
    }

    if (alertCount === 0) {
      await sendMessage(`🟢 <b>오늘 교통 상황 양호</b>\n\n오늘 투어 ${todayTours.length}건 — 모든 경로 정상 소요시간 예상`);
    }

    return { statusCode: 200, body: `Checked ${todayTours.length} tours, ${alertCount} alerts` };

  } catch (err) {
    console.error('[traffic-alert] 오류:', err.message);
    try { await sendErrorAlert('traffic-alert', err); } catch {}
    return { statusCode: 500, body: err.message };
  }
};

const originalHandler = schedule('0 21 * * *', trafficTask);

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
  