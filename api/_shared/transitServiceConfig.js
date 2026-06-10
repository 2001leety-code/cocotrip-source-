/**
 * 교통 provider 서비스 한도·만료 SSOT — 수정팀(운영 감시원)이 만료/소진 전에 미리 알림 = 매끄러운 전환.
 *
 * 2026-06-10 운영자 받적: "ODsay Basic 만료 2026-10-14·1000회/일을 시스템이 기억했다가, 만료/한도 전에
 * 오류없게 전환하게." → 날짜·한도를 여기 박제하고, opsWatchdogChecks.checkTransitService 가 매일 감시.
 *
 * 새 서비스/요금제 갱신 시 이 파일만 고치면 됨 (만료일·한도 SSOT).
 */
export const TRANSIT_SERVICES = {
  odsay: { label: 'ODsay Basic', expiryDate: '2026-10-14', dailyQuotaCalls: 1000 },
  tmap_free: { label: 'TMAP 무료', expiryDate: null, dailyQuotaCalls: 10 },
  tmap_paid: { label: 'TMAP 유료', expiryDate: null, dailyQuotaCalls: null }, // 유료=사실상 무제한, 한도감시 제외
};

/** 플랜 1개당 평균 교통 API 호출 수 (메모리 deep-research 실측). 한도 사용량 추정용. */
export const CALLS_PER_PLAN = 18.8;

/** 현재 활성 provider 서비스 키 (env 기반). 기본 odsay. TMAP은 TMAP_PAID=true 면 유료로 간주. */
export function activeServiceKey(env = process.env) {
  const p = String(env.TRANSIT_PROVIDER || 'odsay').trim().toLowerCase();
  if (p === 'tmap') return env.TMAP_PAID === 'true' ? 'tmap_paid' : 'tmap_free';
  return 'odsay';
}
