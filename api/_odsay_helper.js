/**
 * ODsay Lab — 대중교통 경로 탐색 헬퍼
 * https://lab.odsay.com
 *
 * AI Planner의 RouteAgent에서 각 정류장 간 실제 대중교통 경로를
 * 조회하여 환승 정보, 소요 시간, 요금, 상세 이동 단계를 제공합니다.
 */

const ODSAY_BASE = 'https://api.odsay.com/v1/api';

/**
 * 두 좌표 간 대중교통 경로 검색
 * @param {number} sx - 출발지 경도 (longitude)
 * @param {number} sy - 출발지 위도 (latitude)
 * @param {number} ex - 도착지 경도
 * @param {number} ey - 도착지 위도
 * @returns {object|null} 최적 경로 요약 또는 null
 */
export async function searchTransitRoute(sx, sy, ex, ey) {
  const apiKey = (process.env.ODSAY_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[ODsay] ODSAY_API_KEY not configured');
    return null;
  }

  // 거리가 너무 가까우면 (약 300m 이내) 도보로 처리
  const dist = haversineDistance(sy, sx, ey, ex);
  if (dist < 0.3) {
    return {
      type: 'walk',
      totalTime: Math.max(3, Math.round(dist / 0.07)), // ~4.2km/h walking
      fare: 0,
      transfers: 0,
      steps: [{ mode: 'walk', description: `도보 약 ${Math.round(dist * 1000)}m`, duration: Math.max(3, Math.round(dist / 0.07)) }],
    };
  }

  try {
    const url = `${ODSAY_BASE}/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      console.warn(`[ODsay] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();

    if (data.error || !data.result?.path?.length) {
      console.warn('[ODsay] No routes found or error:', data.error?.msg || 'empty');
      return null;
    }

    // 최적 경로 (첫 번째 = 최단 시간)
    const best = data.result.path[0];
    const info = best.info;

    // 상세 이동 단계 파싱
    const steps = (best.subPath || []).map(sub => parseSubPath(sub)).filter(Boolean);

    return {
      type: info.pathType === 1 ? 'subway' : info.pathType === 2 ? 'bus' : 'subway+bus',
      totalTime: info.totalTime,       // 분
      fare: info.payment,              // 원
      transfers: (info.busTransitCount || 0) + (info.subwayTransitCount || 0),
      distance: info.totalDistance,     // 미터
      steps,
      // 대안 경로 수
      alternatives: Math.min(data.result.path.length - 1, 2),
    };
  } catch (err) {
    console.warn('[ODsay] API error:', err.message);
    return null;
  }
}

/**
 * ODsay subPath를 읽기 쉬운 단계로 변환
 */
function parseSubPath(sub) {
  // trafficType: 1=지하철, 2=버스, 3=도보
  if (sub.trafficType === 3) {
    if (sub.sectionTime < 1) return null;
    return {
      mode: 'walk',
      description: `도보 ${sub.distance}m`,
      duration: sub.sectionTime,
    };
  }

  if (sub.trafficType === 1) {
    // 지하철
    const lineName = sub.lane?.[0]?.name || '';
    return {
      mode: 'subway',
      line: lineName,
      from: sub.startName,
      to: sub.endName,
      duration: sub.sectionTime,
      stationCount: sub.stationCount,
      description: `${lineName} ${sub.startName}역 → ${sub.endName}역 (${sub.stationCount}정거장, ${sub.sectionTime}분)`,
    };
  }

  if (sub.trafficType === 2) {
    // 버스
    const busNo = sub.lane?.[0]?.busNo || '';
    const busType = sub.lane?.[0]?.type || 0;
    const busLabel = getBusTypeLabel(busType);
    return {
      mode: 'bus',
      busNo,
      busType: busLabel,
      from: sub.startName,
      to: sub.endName,
      duration: sub.sectionTime,
      stationCount: sub.stationCount,
      description: `${busLabel} ${busNo}번 ${sub.startName} → ${sub.endName} (${sub.stationCount}정거장, ${sub.sectionTime}분)`,
    };
  }

  return null;
}

/**
 * 버스 유형 라벨
 */
function getBusTypeLabel(type) {
  const map = {
    1: '일반', 2: '좌석', 3: '마을', 4: '직행좌석',
    5: '공항', 6: '간선', 7: '외곽', 10: '순환', 11: '광역', 12: '인천',
  };
  return map[type] || '버스';
}

/**
 * Haversine 거리 (km)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * ODsay 경로 결과를 사람이 읽기 좋은 영문 요약으로 변환
 */
export function formatTransitSummary(route, lang = 'en') {
  if (!route) return null;
  if (route.type === 'walk') {
    return { method: 'walk', summary: `Walk ${route.steps[0]?.description || ''}`, duration: route.totalTime, fare: 0 };
  }

  const stepsText = route.steps
    .filter(s => s.mode !== 'walk' || s.duration >= 3)
    .map(s => {
      if (s.mode === 'subway') return `🚇 ${s.line}: ${s.from} → ${s.to} (${s.duration}min)`;
      if (s.mode === 'bus') return `🚌 Bus ${s.busNo}: ${s.from} → ${s.to} (${s.duration}min)`;
      return `🚶 Walk ${s.duration}min`;
    });

  return {
    method: route.type,
    summary: stepsText.join(' → '),
    duration: route.totalTime,
    fare: route.fare,
    transfers: route.transfers,
    steps: route.steps,
  };
}
