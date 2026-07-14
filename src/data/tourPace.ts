// 투어 여행 스타일(pace) — 가이드 P7 'Trip Style' 필터용.
// Relaxed / Balanced / Active. 근거 = 실제 소요시간 + 투어 내용(야외·도보량·이동),
// 주관 등급 아님(11h 산·야외 = 활동적, 5h 야경 드라이브 = 여유). 운영자 검수 후 조정.
// 계절칩(tourSeasons.ts)과 동일 패턴 — 데이터 단일 원천.

import type { Language } from '@/i18n';

export type TripPace = 'relaxed' | 'balanced' | 'active';

// 9개 실투어 pace (근거 주석). 운영자 검수 대상.
export const TOUR_PACE: Record<string, TripPace> = {
  'tour-seoul-city': 'balanced',   // 9h 도심 궁궐·마을 도보, 표준 관광
  'tour-seoul-night': 'relaxed',   // 5h 야경 위주, 차량 이동 많고 도보 적음
  'tour-danyang': 'active',        // 11h 산·동굴·잔도 등 야외 활동 비중 큼
  'tour-ganghwa': 'balanced',      // 9h 섬·유적, 보통 강도
  'tour-dmz': 'balanced',          // 9h 안보관광 가이드 동행, 보통 강도
  'tour-nami-chuncheon': 'active', // 10h 남이섬·레일바이크 등 야외 활동
  'tour-gyeongju': 'active',       // 11h 유적 광범위 도보, 긴 일정
  'tour-busan-day': 'balanced',    // 10h 해안·도심, 표준 관광
  'tour-multicity-3d': 'active',   // 3일 다도시, 이동·일정 밀도 높음
};

export const PACE_ORDER: TripPace[] = ['relaxed', 'balanced', 'active'];

const PACE_META: Record<TripPace, { emoji: string; label: Record<Language, string> }> = {
  relaxed:  { emoji: '🌿', label: { en: 'Relaxed',  ko: '여유롭게', ja: 'ゆったり',   zh: '轻松' } },
  balanced: { emoji: '⚖️', label: { en: 'Balanced', ko: '균형있게', ja: 'バランス',   zh: '均衡' } },
  active:   { emoji: '⚡', label: { en: 'Active',   ko: '활동적',   ja: 'アクティブ', zh: '充实' } },
};

export function paceEmoji(pace: TripPace): string {
  return PACE_META[pace].emoji;
}

export function paceLabel(pace: TripPace, language: Language): string {
  return PACE_META[pace].label[language] || PACE_META[pace].label.en;
}
