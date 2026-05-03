/**
 * _refund-policy.js — 취소 정책 공용 모듈
 *
 * 투어일까지 남은 시간 + 고객 등급(Bronze/Silver/Gold/Platinum)을 입력으로
 * 환불율(0.0~1.0), 자유취소 데드라인, 최종 취소 가능 데드라인을 산출한다.
 *
 * 마스터 플랜 Phase C 취소 정책 표 (2026-04-24 합의):
 *   기간               일반  Gold  Platinum
 *   ≥72h 전            100%  100%  100%
 *   48~72h 전           80%  100%  100%
 *   24~48h 전           50%   80%  100%
 *   12~24h 전            0%   50%   80%
 *   <12h / no-show       0%    0%    0%
 *
 * Silver는 일반과 동일. 등급 미지정 시 'Bronze' 취급.
 */

/** @typedef {'Bronze'|'Silver'|'Gold'|'Platinum'} TierType */

const BASE_TABLE = [
  { thresholdHours: 72, general: 1.0,  gold: 1.0, platinum: 1.0 },
  { thresholdHours: 48, general: 0.8,  gold: 1.0, platinum: 1.0 },
  { thresholdHours: 24, general: 0.5,  gold: 0.8, platinum: 1.0 },
  { thresholdHours: 12, general: 0.0,  gold: 0.5, platinum: 0.8 },
  { thresholdHours: 0,  general: 0.0,  gold: 0.0, platinum: 0.0 },
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
    canModify: hoursUntilTour >= 24,  // 변경은 24h 이전까지만
    freeCancelUntil: new Date(freeCancelUntilTs).toISOString(),
    finalCancelUntil: new Date(finalCancelUntilTs).toISOString(),
    tierApplied: tier,
  };
}

export default evaluateRefundPolicy;
