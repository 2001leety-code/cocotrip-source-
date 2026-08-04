/**
 * Route quality metrics — per-day intra-city 동선 측정 (순수 함수, side-effect 0).
 *
 * 2026-06-10: 운영자 검증 요청 → 실 5일 plan(550fb532) 진단에서 Day2 26.4km /
 * Day3 24.9km 서울 횡단(X자 zigzag) 발견. 근본 원인 = Gemini 가 비인접 zone
 * (종로+강남+홍대)을 한 day 에 섞고, 식당이 12:00/18:00 시각에 고정돼 RouteAgent
 * 의 reorderStopsByProximity(chronology 가드)가 못 푼다.
 *
 * 이 모듈은 그 동선을 "측정"만 한다 — stop 재정렬·시각 재할당은 식사 시각 고정
 * 때문에 위험(PDF 시간 jumbled / time-stitching 파괴)이라 하지 않는다. 근본 개선은
 * buildPrompt 의 ZONE CLUSTERING STRICT 룰(프롬프트). 본 측정은 그 효과를 prod
 * 로그로 추적 + 회귀 테스트 + qa 검증 스크립트에서 재사용.
 */

// Haversine 거리(km). 구현은 constants.js(의존성 없는 leaf)로 옮겼다 —
// 공항 이동 거리 보정이 그 파일에서 필요해졌고, 같은 식이 두 벌 있으면 갈린다.
// 기존 소비처 14곳의 import 경로를 바꾸지 않기 위해 여기서 다시 내보낸다.
// (이 파일 안에서도 쓰므로 re-export 가 아니라 import 후 내보낸다 — `export ... from` 은
//  지역 바인딩을 만들지 않아 아래 38·50 줄이 ReferenceError 가 된다.)
import { haversineKm } from './constants.js';

export { haversineKm };

const round1 = (n) => Math.round(n * 10) / 10;
const stopName = (s) => s?.display_name || s?.name || s?.name_en || s?.name_ko || '(stop)';

/**
 * 한 day 의 stops 배열에서 동선 지표 계산.
 * - lodging(첫/끝) 포함 — 사용자가 실제 도는 경로.
 * - intercity_transit(도시 전환)은 stops 가 아니라 day-level 객체라 자동 제외 → 항상 intra-city.
 * - 좌표 있는 stop 만 사용 (NOGEO lodging 등은 거리 계산에서 빠짐).
 *
 * @param {Array} stops
 * @returns {{ coordCount:number, pathKm:number, maxLegKm:number, spanKm:number, pathPerSpan:number, longestLeg:({from:string,to:string,km:number}|null) }}
 */
export function computeDayRouteMetrics(stops) {
  const coord = (Array.isArray(stops) ? stops : []).filter((s) => s && s.lat != null && s.lng != null);
  let pathKm = 0;
  let maxLegKm = 0;
  let longestLeg = null;
  for (let i = 1; i < coord.length; i++) {
    const d = haversineKm(coord[i - 1], coord[i]);
    if (d == null) continue;
    pathKm += d;
    if (d > maxLegKm) {
      maxLegKm = d;
      longestLeg = { from: stopName(coord[i - 1]), to: stopName(coord[i]), km: round1(d) };
    }
  }
  // span = 가장 먼 두 stop 직선거리 (그날 cluster 의 크기).
  let spanKm = 0;
  for (let i = 0; i < coord.length; i++) {
    for (let j = i + 1; j < coord.length; j++) {
      const d = haversineKm(coord[i], coord[j]);
      if (d != null && d > spanKm) spanKm = d;
    }
  }
  // pathPerSpan: 잘 묶인 day 는 ~1.5-2 (선형/왕복), zigzag 는 3+ (왔다갔다).
  // span 이 매우 작으면(0.2km 미만, 도보권 밀집) 비율이 불안정 → 0 으로 무시.
  const pathPerSpan = spanKm > 0.2 ? round1(pathKm / spanKm) : 0;
  return {
    coordCount: coord.length,
    pathKm: round1(pathKm),
    maxLegKm: round1(maxLegKm),
    spanKm: round1(spanKm),
    pathPerSpan,
    longestLeg,
  };
}

/**
 * day 가 과도한 zigzag(비인접 zone 횡단)인지 휴리스틱 판정.
 * 단도시 intra-day 기준. 임계값은 caller 가 조정 가능.
 * - pathKm 절대값 초과 (기본 16km — 정상 서울 day 는 4-12km, 26km Day2 는 초과)
 * - 또는 pathPerSpan 비율 초과 (기본 3.2 — 왔다갔다 횟수가 많음)
 * coordCount < 3 (lodging 1-2개뿐, 밤도착 등) 은 판정 제외.
 *
 * @param {object} metrics - computeDayRouteMetrics 결과
 * @param {{maxPathKm?:number, maxRatio?:number}} [opts]
 * @returns {boolean}
 */
export function isExcessiveDayRoute(metrics, { maxPathKm = 16, maxRatio = 3.2 } = {}) {
  if (!metrics || metrics.coordCount < 3) return false;
  return metrics.pathKm > maxPathKm || metrics.pathPerSpan > maxRatio;
}
