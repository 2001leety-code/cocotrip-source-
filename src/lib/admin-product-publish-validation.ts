// ─────────────────────────────────────────────────────────────────────────────
// admin-product-publish-validation.ts — A1-7-3 상품 publish 검증 SSOT
//
// 문제 (pre-fix):
//   AdminProductEditor.handlePublish 가 title.ko / summary.ko / description.ko
//   만 검증. 빈 stops / slots / photos 통과 → 손님에게 빈 카드 노출 (메뉴판/
//   가격표/사진 없이 매장 문 열어버림).
//
// Post-fix:
//   1. i18n basic (기존 검증 보존) — title.ko / summary.ko / description.ko 필수
//   2. stops >= 2 — 손님이 어디를 가는지 보여줘야 의미있는 투어
//   3. slots >= 1 — 슬롯 없이는 손님이 예약 자체 불가
//   4. photos >= 3 (썸네일 + 갤러리 합산) — 손님이 분위기 판단 불가
//
// 운영자 의도:
//   - 부족 시 toast 한국어 메시지 + 어느 탭 가야하는지 정확히 안내
//   - thumbnail (legacy string) 과 thumbnail_photo (v3 TourPhoto) 양쪽 인정
//   - images (legacy string[]) 와 photos (v3 TourPhoto[]) 양쪽 합산
//
// 참조:
//   - A1-7-2 zone-course-publish-validation.ts (helper 패턴)
//   - CLAUDE.md (필드명 폴백 패턴)
// ─────────────────────────────────────────────────────────────────────────────
import type { Tour } from '@/data/tours';

/** publish 검증 결과 — UI 가 toast + 탭 이동에 사용. */
export interface ProductValidationResult {
  ok: boolean;
  reason?:
    | 'missing_i18n'
    | 'insufficient_stops'
    | 'insufficient_slots'
    | 'insufficient_photos';
  message?: string;
  suggestedTab?: 'basic' | 'media' | 'stops' | 'pricing';
  /** 정확히 어느 필드/값이 부족한지 (UI 디버깅용) */
  missingFields?: string[];
}

/** stops 최소 2 — 1-stop 투어는 의미없음 (이동 자체가 투어 본질) */
export const MIN_STOPS = 2;

/** slots 최소 1 — 슬롯 0 = 예약 불가 */
export const MIN_SLOTS = 1;

/** photos 최소 3 (썸네일 1 + 갤러리 2) — 분위기 판단 가능 */
export const MIN_PHOTOS = 3;

/**
 * 사진 개수 카운트 — legacy + v3 양쪽 합산.
 *
 *  - thumbnail (string) 또는 thumbnail_photo (TourPhoto) 가 있으면 1장
 *  - images (string[]) + photos (TourPhoto[]) 합산
 *
 * 빈 문자열은 0 으로 처리 (legacy 상품 마이그 시 빈 string 들어올 수 있음).
 */
export function countProductPhotos(draft: Partial<Tour>): number {
  const thumbnailCount =
    (typeof draft.thumbnail === 'string' && draft.thumbnail.trim().length > 0) ||
    (draft.thumbnail_photo && typeof draft.thumbnail_photo.url === 'string' && draft.thumbnail_photo.url.trim().length > 0)
      ? 1
      : 0;

  const legacyImages = Array.isArray(draft.images)
    ? draft.images.filter((u) => typeof u === 'string' && u.trim().length > 0).length
    : 0;

  const v3Photos = Array.isArray(draft.photos)
    ? draft.photos.filter((p) => p && typeof p.url === 'string' && p.url.trim().length > 0).length
    : 0;

  return thumbnailCount + legacyImages + v3Photos;
}

/**
 * publish 전 검증. 검증 순서 (운영자 의도):
 *   1. i18n basic — 가장 기본. 이거 없으면 다른거 의미 X
 *   2. stops — 일정 없이는 투어 자체 정의 불가
 *   3. slots — 일정 있어도 예약 슬롯 없으면 손님 결제 불가
 *   4. photos — 가장 cosmetic 하지만 빈 카드 노출 차단
 *
 * 첫 실패에서 즉시 return — 한 번에 하나만 안내 (운영자 인지부하 축소).
 */
export function validateProductPublish(draft: Partial<Tour>): ProductValidationResult {
  // 1. i18n basic
  const titleKo = draft.title?.ko?.trim();
  const summaryKo = draft.summary?.ko?.trim();
  const descKo = draft.description?.ko?.trim();
  if (!titleKo || !summaryKo || !descKo) {
    const missing: string[] = [];
    if (!titleKo) missing.push('title.ko');
    if (!summaryKo) missing.push('summary.ko');
    if (!descKo) missing.push('description.ko');
    return {
      ok: false,
      reason: 'missing_i18n',
      message: '기본 정보 탭의 한국어 제목 / 요약 / 설명이 모두 필수입니다.',
      suggestedTab: 'basic',
      missingFields: missing,
    };
  }

  // 2. stops >= 2
  const stops = draft.stops || [];
  if (stops.length < MIN_STOPS) {
    return {
      ok: false,
      reason: 'insufficient_stops',
      message: `일정 탭에 stop ${MIN_STOPS}개 이상 필요합니다 (현재 ${stops.length}개). 손님이 어디를 가는지 보여줘야 합니다.`,
      suggestedTab: 'stops',
      missingFields: [`stops (${stops.length}/${MIN_STOPS})`],
    };
  }

  // 3. slots >= 1
  const slots = draft.slots || [];
  if (slots.length < MIN_SLOTS) {
    return {
      ok: false,
      reason: 'insufficient_slots',
      message: `가격·예약 탭에 슬롯 ${MIN_SLOTS}개 이상 필요합니다. 슬롯 없이는 손님이 예약 자체 불가합니다.`,
      suggestedTab: 'pricing',
      missingFields: [`slots (${slots.length}/${MIN_SLOTS})`],
    };
  }

  // 4. photos >= 3 (썸네일 + 갤러리)
  const totalPhotos = countProductPhotos(draft);
  if (totalPhotos < MIN_PHOTOS) {
    return {
      ok: false,
      reason: 'insufficient_photos',
      message: `미디어 탭에 사진 ${MIN_PHOTOS}장 이상 필요합니다 (썸네일 + 갤러리 합산, 현재 ${totalPhotos}장). 손님이 분위기를 판단할 수 없습니다.`,
      suggestedTab: 'media',
      missingFields: [`photos (${totalPhotos}/${MIN_PHOTOS})`],
    };
  }

  return { ok: true };
}
