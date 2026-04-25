// Mock 가용성 데이터 (P2-A 1차).
// 실제 운영 시 Firestore tour_availability/{tourSlug}/{YYYY-MM-DD} 에서 fetch 예정.
// 현재는 토요일·매월 25일 이후·과거 날짜를 만석으로 가정해 UI 흐름을 검증.

export type AvailabilityCheck = {
  available: boolean;
  reason?: 'past' | 'fully_booked' | 'blackout' | 'closed';
};

const SCHEDULED_BLACKOUTS: Record<string, string[]> = {
  // 예시: 설/추석 등 정비일. 운영 정책에 맞춰 갱신.
  // 'tour-seoul-city': ['2026-09-30', '2026-10-01', '2026-10-02'],
};

/**
 * Mock 가용성 검사. 향후 Firestore tour_availability 컬렉션 연동.
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

  // 3. mock 만석 룰 (나중에 Firestore 가용성으로 교체)
  const dow = target.getDay(); // 0=Sun, 6=Sat
  const dom = target.getDate();
  // 매주 토요일은 만석으로 가정 (인기 시즌)
  if (dow === 6) return { available: false, reason: 'fully_booked' };
  // 매월 25일 이후 만석으로 가정 (월말 운영 마감)
  if (dom >= 25) return { available: false, reason: 'fully_booked' };

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
