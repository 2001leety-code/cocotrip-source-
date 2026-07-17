// 투어 가용성 검사 (클라이언트 게이트).
// 운영 SSOT = Firestore tour_availability/{tourId}/dates/{YYYY-MM-DD} (fully_booked/blackout).
// 이 모듈은 Firestore 조회 실패·미등록 날짜의 기본 판정만 담당: 과거 날짜 + 정적 blackout.
//
// 2026-07-17: P2-A 시절 mock 만석 룰(토요일 전부 + 매월 25일 이후 = fully_booked)이
// TourBookingDialog 실예약 게이트에 그대로 물려 prod 예약을 차단하던 문제 제거.
// Firestore 는 "차단 추가"만 가능했고 이 mock 이 최종 거부권을 가져 운영자가 열 수 없었음.
// 날짜별 만석/휴무는 운영자가 admin(AdminTourAvailability)에서 Firestore 로 지정한다.

export type AvailabilityCheck = {
  available: boolean;
  reason?: 'past' | 'fully_booked' | 'blackout' | 'closed';
};

const SCHEDULED_BLACKOUTS: Record<string, string[]> = {
  // 예시: 설/추석 등 정비일. 운영 정책에 맞춰 갱신.
  // 'tour-seoul-city': ['2026-09-30', '2026-10-01', '2026-10-02'],
};

/**
 * 기본 가용성 검사 — 과거 날짜와 정적 blackout 만 차단한다.
 * 만석(fully_booked)·운영 휴무는 Firestore(tour_availability)가 결정하며
 * 호출처(TourBookingDialog.isDateBlocked)가 Firestore 우선으로 결합한다.
 * @param tourId  Tour ID (예: 'tour-seoul-city')
 * @param dateISO YYYY-MM-DD
 */
export function checkAvailability(tourId: string, dateISO: string): AvailabilityCheck {
  if (!dateISO) return { available: true };

  const target = new Date(dateISO + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. 과거 날짜
  if (target.getTime() < today.getTime()) {
    return { available: false, reason: 'past' };
  }

  // 2. 정비일 (정적)
  const blackouts = SCHEDULED_BLACKOUTS[tourId] || [];
  if (blackouts.includes(dateISO)) {
    return { available: false, reason: 'blackout' };
  }

  return { available: true };
}

export const REASON_LABELS: Record<NonNullable<AvailabilityCheck['reason']>, Record<'ko' | 'en' | 'ja' | 'zh', string>> = {
  past: {
    ko: '과거 날짜는 선택할 수 없습니다.',
    en: 'Past dates are not selectable.',
    ja: '過去の日付は選択できません。',
    zh: '不能选择过去的日期。',
  },
  fully_booked: {
    ko: '선택한 날짜는 예약이 마감되었습니다. 다른 날짜를 선택하세요.',
    en: 'This date is fully booked. Please pick another date.',
    ja: '選択した日付は予約満了です。他の日付をお選びください。',
    zh: '所选日期已满，请选择其他日期。',
  },
  blackout: {
    ko: '운영 정비로 휴업입니다.',
    en: 'Closed for scheduled maintenance.',
    ja: '定期メンテナンスのため休業。',
    zh: '因定期维护停业。',
  },
  closed: {
    ko: '휴업일입니다.',
    en: 'Closed on this date.',
    ja: '休業日です。',
    zh: '当日休业。',
  },
};
