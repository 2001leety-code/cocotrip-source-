// 투어별 계절 적합도 — 운영자 아이디어(2026-07-14): 가짜 별점 대신 "언제 가면 좋은지"
// 정직한 계절 안내. 근거 = 한국 기후 실팩트 + 각 투어의 실제 내용(야외/도심/해변/야경).
// 주관 별점 아님 — 여름 더위·가을 단풍·봄 벚꽃 같은 검증 가능한 계절성만.
//
// best: 그 계절에 특히 좋은 투어(단풍·벚꽃·해변·설경 등) → 긍정 칩.
// summerCaution: 한여름(7~8월) 야외 비중 커서 더위·습도 부담 → 여름에만 주의 칩.
// 데이터 없는 투어 = 칩 미표시(연중 무난, 가짜 안내 안 함).
//
// 운영자 검수 후 자유 조정 — 이 파일이 계절 안내의 단일 원천.

import type { Language } from '@/i18n';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export function currentSeason(month1to12: number): Season {
  const m = month1to12;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

type SeasonInfo = { best?: Season[]; summerCaution?: boolean };

// 9개 실투어 계절 태깅 (근거 주석). 운영자 검수 대상.
export const TOUR_SEASONS: Record<string, SeasonInfo> = {
  // 도심·궁궐 도보 — 봄·가을이 걷기 쾌적. 실내 비중도 있어 여름 주의까진 X.
  'tour-seoul-city': { best: ['spring', 'autumn'] },
  // 야경 — 여름밤 시원하고 가을 야경 좋음.
  'tour-seoul-night': { best: ['summer', 'autumn'] },
  // 단양(산·동굴·잔도 등 야외) — 봄·가을 최적, 한여름 야외 더위.
  'tour-danyang': { best: ['spring', 'autumn'], summerCaution: true },
  // 강화(섬·유적 야외) — 봄·가을.
  'tour-ganghwa': { best: ['spring', 'autumn'] },
  // DMZ(노출된 야외·안보관광) — 봄·가을. 겨울 강추위 부담이나 별도표기 X.
  'tour-dmz': { best: ['spring', 'autumn'] },
  // 남이섬·춘천(야외·레일바이크) — 봄·가을(단풍)·겨울(설경/겨울연가) 정취, 한여름 더위·습도.
  'tour-nami-chuncheon': { best: ['spring', 'autumn', 'winter'], summerCaution: true },
  // 경주(유적 야외 도보·봄 벚꽃 유명) — 봄·가을 최적, 한여름 유적 도보 더위.
  'tour-gyeongju': { best: ['spring', 'autumn'], summerCaution: true },
  // 부산(해안·해변·도심) — 봄·여름(해변)·가을.
  'tour-busan-day': { best: ['spring', 'summer', 'autumn'] },
  // 멀티시티 — 연중 무난, 이동 쾌적한 봄·가을 권장.
  'tour-multicity-3d': { best: ['spring', 'autumn'] },
};

const SEASON_EMOJI: Record<Season, string> = { spring: '🌸', summer: '☀️', autumn: '🍁', winter: '❄️' };

const BEST_LABEL: Record<Season, Record<Language, string>> = {
  spring: { en: 'Best in spring', ko: '봄 추천', ja: '春におすすめ', zh: '春季推荐' },
  summer: { en: 'Great in summer', ko: '여름 추천', ja: '夏におすすめ', zh: '夏季推荐' },
  autumn: { en: 'Best in autumn', ko: '가을 추천', ja: '秋におすすめ', zh: '秋季推荐' },
  winter: { en: 'Scenic in winter', ko: '겨울 정취', ja: '冬の風情', zh: '冬季风光' },
};

const CAUTION_LABEL: Record<Language, string> = {
  en: 'Hot in summer', ko: '여름 더위 주의', ja: '夏は暑い', zh: '夏季炎热',
};

export type SeasonalTip = { tone: 'best' | 'caution'; emoji: string; label: string };

/** 현재 월 기준 투어 계절 칩. 없으면 null(칩 미표시). best 우선, 아니면 여름 주의. */
export function getSeasonalTip(tourId: string, month1to12: number, language: Language): SeasonalTip | null {
  const info = TOUR_SEASONS[tourId];
  if (!info) return null;
  const s = currentSeason(month1to12);
  if (info.best?.includes(s)) {
    return { tone: 'best', emoji: SEASON_EMOJI[s], label: BEST_LABEL[s][language] || BEST_LABEL[s].en };
  }
  if (s === 'summer' && info.summerCaution) {
    return { tone: 'caution', emoji: '☀️', label: CAUTION_LABEL[language] || CAUTION_LABEL.en };
  }
  return null;
}
