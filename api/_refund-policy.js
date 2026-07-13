/**
 * _refund-policy.js — 취소 정책 공용 모듈
 *
 * 투어일까지 남은 시간 + 고객 등급(Bronze/Silver/Gold/Platinum)을 입력으로
 * 환불율(0.0~1.0), 자유취소 데드라인, 최종 취소 가능 데드라인을 산출한다.
 *
 * 취소 정책 (2026-07-14 운영자 확정 — 24시간 바이너리):
 *   기간               환불
 *   24h 이상 전         100% (전액 무료 취소)
 *   <24h / no-show       0% (환불 불가)
 *
 * 등급(Gold/Platinum) 차등 폐지 — 전 고객 동일(운영자 결정 2026-07-14).
 * 이전 그래주에이티드(72/48/24/12h·등급별) 표는 폐기.
 * ⚠️ 돈 로직 SSOT — 운영자 실 PayPal 환불 e2e 검증 후 머지.
 */

/** @typedef {'Bronze'|'Silver'|'Gold'|'Platinum'} TierType */

// 바이너리: 24h 이상=100%, 미만=0%. 등급 컬럼은 하위호환 위해 유지하되 전부 동일.
const BASE_TABLE = [
  { thresholdHours: 24, general: 1.0, gold: 1.0, platinum: 1.0 },
  { thresholdHours: 0,  general: 0.0, gold: 0.0, platinum: 0.0 },
];

function tierKey(tier) {
  if (tier === 'Platinum') return 'platinum';
  if (tier === 'Gold')     return 'gold';
  return 'general';
}

/**
 * @param {{ tourDate: string, tourTime?: string, tier?: TierType, now?: Date }} args
 * @returns {{ hoursUntilTour: number, refundPercent: number, refundRatio: number, canRefund: boolean, canModify: boolean, freeCancelUntil: string, finalCancelUntil: string, tierApplied: TierType }}
 */
export function evaluateRefundPolicy({ tourDate, tourTime = '00:00', tier = 'Bronze', now = new Date() }) {
  // 2026-05-04: tourDate 가 비어있는 booking (예: charter_custom_estimate 의 추정가 결제
  // 시 wizard 가 dateStart 미설정 케이스, 또는 AI 플래너 처럼 tourDate 가 의미 없는 디지털
  // 상품) 에 대해 throw 대신 graceful 한 환불 정책 기본값 반환. cancelBooking handler 의
  // 500 응답 + Telegram 누락 사고 방지.
  if (!tourDate) {
    return {
      hoursUntilTour: 0,
      refundPercent: 0,
      refundRatio: 0,
      canRefund: false,
      canModify: false,
      freeCancelUntil: '',
      finalCancelUntil: '',
      tierApplied: tier,
      reason: 'tourDate missing — cannot evaluate window-based refund. Manual review required.',
    };
  }

  // 투어일/시간은 항상 KST(+09:00) 기준. Vercel Lambda가 UTC에서 돌아도 안전하게 파싱.
  const iso = `${tourDate}T${tourTime}:00+09:00`;
  const tourTs = new Date(iso).getTime();
  const hoursUntilTour = Math.max(0, (tourTs - now.getTime()) / 3_600_000);

  const key = tierKey(tier);

  // 테이블 스캔: 첫 번째 threshold를 충족하는 행의 ratio
  let ratio = 0;
  for (const row of BASE_TABLE) {
    if (hoursUntilTour >= row.thresholdHours) {
      ratio = row[key];
      break;
    }
  }

  // Free cancel until — ratio=1.0 유지되는 마지막 시점
  const freeCancelUntilTs = (() => {
    for (const row of BASE_TABLE) {
      if (row[key] >= 1.0) {
        return tourTs - row.thresholdHours * 3_600_000;
      }
    }
    return tourTs;
  })();

  // Final cancel until — ratio>0 유지되는 마지막 시점
  const finalCancelUntilTs = (() => {
    let lastPositive = tourTs;
    for (const row of BASE_TABLE) {
      if (row[key] > 0) {
        lastPositive = tourTs - row.thresholdHours * 3_600_000;
      }
    }
    return lastPositive;
  })();

  return {
    hoursUntilTour: Math.round(hoursUntilTour * 10) / 10,
    refundPercent: Math.round(ratio * 100),
    refundRatio: ratio,
    canRefund: ratio > 0,
    canModify: hoursUntilTour >= 12,  // 변경은 12h 이전까지만 (2026-05-07 통일)
    freeCancelUntil: new Date(freeCancelUntilTs).toISOString(),
    finalCancelUntil: new Date(finalCancelUntilTs).toISOString(),
    tierApplied: tier,
  };
}

export default evaluateRefundPolicy;
