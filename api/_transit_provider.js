/**
 * _transit_provider.js — 대중교통 경로 provider 스위치 (ODsay ↔ TMAP).
 *
 * 운영자 의도(2026-05-31): "전환은 아직, 구현만 — 언제든 바꿔낄 수 있게."
 * 기본값 = ODsay (prod 무영향). 환경변수 `TRANSIT_PROVIDER=tmap` 로 바꾸면 즉시 TMAP 사용.
 * 두 provider 출력 shape 동일 → formatTransitSummary / RouteAgent 매핑 코드 변경 0.
 *
 * 교체 방법: Vercel 환경변수에 TRANSIT_PROVIDER=tmap 추가 + TMAP_APP_KEY 설정 → 재배포. 끝.
 * 되돌리기: TRANSIT_PROVIDER 제거(또는 odsay) → ODsay 복귀.
 *
 * 비용/품질 근거: 메모리 project-cocotrip-session-2026-05-31-transit-odsay-cost (TMAP 0.88원/건
 * = ODsay 28~340배↓, ICN→명동 AREX 급행·서울→부산 KTX·소도시 native. 일부 도심 구간 ODsay보다 느림).
 */
import { searchTransitRoute } from './_odsay_helper.js';
import { searchTransitRouteTmap } from './_tmap_helper.js';

/** 현재 provider ('odsay' | 'tmap'). 기본 odsay. */
export function getTransitProvider() {
  return (process.env.TRANSIT_PROVIDER || 'odsay').trim().toLowerCase() === 'tmap' ? 'tmap' : 'odsay';
}

/**
 * 두 좌표 간 대중교통 경로 검색 (provider 무관 단일 진입점).
 * ODsay searchTransitRoute 와 동일 시그니처/출력 → 호출부 변경 최소.
 * @param {number} sx 출발 경도 / @param {number} sy 출발 위도 / @param {number} ex 도착 경도 / @param {number} ey 도착 위도
 * @param {object} [opts] TMAP 전용 옵션 (departDttm 등). ODsay 는 무시.
 * @returns {Promise<object|null>} ODsay 호환 raw route 또는 null.
 */
export async function searchTransit(sx, sy, ex, ey, opts = {}) {
  const primary = getTransitProvider();
  const callPrimary = () => (primary === 'tmap' ? searchTransitRouteTmap(sx, sy, ex, ey, opts) : searchTransitRoute(sx, sy, ex, ey));

  // 기본: 현행 동작(throw 전파, byte-identical). 운영자 받적(2026-06-10) — TRANSIT_FALLBACK=true 면
  // primary 가 throw(5xx/네트워크 장애) 시 다른 provider 로 자동 전환 = "오류없게 전환" 안전망.
  // (4xx/null = no-route 또는 한도 → fallback 안 함: 한도 doubling·중복호출 방지. 한도는 수정팀이 별도 알림.)
  if (String(process.env.TRANSIT_FALLBACK || '').toLowerCase() !== 'true') {
    return callPrimary();
  }
  try {
    return await callPrimary();
  } catch (e) {
    console.warn(`[transit] ${primary} 실패 → fallback:`, e && e.message);
    try {
      return primary === 'tmap' ? await searchTransitRoute(sx, sy, ex, ey) : await searchTransitRouteTmap(sx, sy, ex, ey, opts);
    } catch (e2) {
      console.error('[transit] fallback 도 실패:', e2 && e2.message);
      return null; // 둘 다 실패 → null (구간 교통 없음, 플랜은 계속)
    }
  }
}
