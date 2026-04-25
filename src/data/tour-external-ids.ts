// Tour 별 외부 리뷰 ID 매핑 — 사용자가 Tripadvisor / Google Places에서 발급 후 채움.
// 매핑 비어있는 투어는 internal 평점 표시. UI는 자동 폴백.

export type ExternalIds = {
  tripadvisorLocationId?: string;
  googlePlaceId?: string;
};

export const TOUR_EXTERNAL_IDS: Record<string, ExternalIds> = {
  // 'tour-seoul-city':     { tripadvisorLocationId: 'd1234567', googlePlaceId: 'ChIJ...' },
  // 'tour-seoul-night':    { tripadvisorLocationId: 'd1234568' },
  // 'tour-dmz':            { googlePlaceId: 'ChIJ...' },
  // 사용자 발급 후 위처럼 채워주세요. 비어있으면 internal 데이터 사용.
};

export function getTourExternalIds(tourId: string): ExternalIds {
  return TOUR_EXTERNAL_IDS[tourId] || {};
}
