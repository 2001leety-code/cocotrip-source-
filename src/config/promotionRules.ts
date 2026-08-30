/**
 * 플랜 화면 판촉(제휴 광고) 규칙 — **단일 기준 파일**. (2026-08-02)
 *
 * 왜 모았나: "광고를 몇 개까지, 어디에 노출하나" 와 "이 손님에게 이 광고가 말이 되나" 가
 * `buildSlides.ts`(슬라이드 조립)와 `PreTripSlide.tsx`(카드 렌더) 양쪽에 흩어져 있었다.
 * 한쪽만 고치면 다른 쪽이 옛 규칙으로 남는다. 그래서 규칙은 여기 한 곳에만 둔다.
 *
 * ⚠️ 타입만 가져오므로(`import type`) 빌드 결과에 페이지 모듈 의존이 남지 않는다.
 */
import type { PlanDocument } from '@/pages/PlanDetailPage/types';

export type AdCategory = 'flight' | 'hotel' | 'charter' | 'esim' | 'carRental' | 'airportPickup' | 'train';

/**
 * 플랜 한 건에 허용되는 판촉 노출 한도.
 *
 * 근거 — P-Quality D안(2026-04-24): 예전에는 Day 슬라이드 사이사이에 광고 슬라이드를 끼워
 * 4일짜리 플랜에서 슬라이드의 41%가 광고였다. 손님이 "내 여행 제안서" 가 아니라 "광고 앱"
 * 으로 받아들였다. 그래서 일정 흐름을 끊는 광고 슬라이드는 0으로 못박고, 판촉은
 * PreTrip 섹션 1개와 Outro 섹션 1개로만 내보낸다.
 *
 * 🔒 이 숫자는 장식이 아니다 — `tests/unit/promotion-rules-ssot.test.ts` 가 실제
 *    `buildSlides()` 결과를 세어 이 값과 대조한다. 슬라이드 조립을 바꿔 광고가 늘면 테스트가 깨진다.
 */
export const PLAN_PROMOTION_LIMITS = Object.freeze({
  /** Day 사이에 끼워 넣는 광고 전용 슬라이드 수. */
  interruptingSlides: 0,
  /** 일정 뒤 여행 준비 섹션(PreTrip) 수. */
  preTripSection: 1,
  /** 마지막 섹션(Outro) 수. */
  outroSection: 1,
});

/**
 * 이 손님의 플랜 맥락에서 해당 판촉을 띄우는 게 말이 되는가.
 * 노출 자리를 정하는 것과 별개로, 이미 해결한 문제를 다시 파는 것을 막는 규칙이다.
 */
export function adApplies(category: AdCategory, plan: PlanDocument): boolean {
  const input = plan?.input || {};
  if (category === 'hotel') {
    // 숙소를 이미 잡은 손님에게 호텔을 다시 권하지 않는다.
    return !input.hotel_address;
  }
  if (category === 'flight') {
    // 출발이 7일 이내면 항공권 예약은 이미 늦었다.
    // 경계 규칙: `daysUntil > 7` — **7일 경계는 exclusive**(딱 7.0일 남은 시점은 숨김).
    //   startDate 는 여행 첫날이며 그 날 자체를 포함한다(inclusive) — 즉 "출발일까지
    //   남은 일수" 를 재는 것이지 "출발 전날까지" 가 아니다.
    const startDate = input.startDate as string | undefined;
    if (!startDate) return true;
    const start = Date.parse(startDate);
    if (Number.isNaN(start)) return true;
    const daysUntil = (start - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntil > 7;
  }
  if (category === 'charter') {
    // P2 감사(2026-04-27): 차터를 이미 예약/문의한 손님에겐 광고를 건너뛴다.
    // input.charter_booked = true (차터 PayPal 결제 후 백엔드가 set)
    // 또는 charter_inquiry_id 존재 (CharterInquireModal 서버 접수 후 저장)
    // → 둘 중 하나라도 있으면 스킵.
    if (input.charter_booked === true || input.charter_inquiry_id) return false;
  }
  if (category === 'train') {
    // batch 9 (2026-05-09): 다도시 플랜(서울→부산 등)에서만 KTX/SRT 를 추천한다.
    // 한 도시 플랜에 띄우면 노이즈 — regions 가 2개 이상일 때만 노출.
    const regions = (input.regions as unknown as string[]) || [];
    return Array.isArray(regions) && regions.length >= 2;
  }
  return true;
}
