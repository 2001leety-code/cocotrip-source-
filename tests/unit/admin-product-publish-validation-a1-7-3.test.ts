// ─────────────────────────────────────────────────────────────────────────────
// A1-7-3 상품 publish validation 테스트
//
// 회귀 차단:
//   - AdminProductEditor handlePublish 가 빈 stops / slots / photos 채로 publish
//     되면 손님에게 빈 카드 노출 → 신뢰도 손상.
//   - validateProductPublish 가 누락 정확히 감지하고 한국어 메시지 + 어느 탭
//     으로 이동해야 하는지 반환해야 함.
//
// 검증 순서 (운영자 의도):
//   1. i18n basic (title.ko / summary.ko / description.ko) → basic 탭
//   2. stops >= 2 → stops 탭
//   3. slots >= 1 → pricing 탭
//   4. photos >= 3 (썸네일 + 갤러리 합산) → media 탭
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import type { Tour, TourStop, TourSlot, TourPhoto, I18nString } from '@/data/tours';
import {
  validateProductPublish,
  countProductPhotos,
  MIN_STOPS,
  MIN_SLOTS,
  MIN_PHOTOS,
} from '@/lib/admin-product-publish-validation';

// ───────── helper builders ──────────────────────────────────────────────────
const i18n = (s: string): I18nString => ({ ko: s, en: s, ja: s, zh: s });

const validI18n = {
  title: i18n('서울 시티투어'),
  summary: i18n('경복궁부터 한강까지'),
  description: i18n('하루 종일 서울 핵심 명소를 둘러봅니다.'),
};

const validStops = (n: number = MIN_STOPS): TourStop[] =>
  Array.from({ length: n }, (_, i) => ({
    time: `0${9 + i}:00`,
    name: i18n(`stop ${i + 1}`),
    stay_min: 60,
    description: i18n(`stop ${i + 1} 설명`),
  }));

const validSlots = (n: number = MIN_SLOTS): TourSlot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `slot-${i + 1}`,
    start_time: `0${9 + i}:00`,
    is_active: true,
  }));

const photo = (url: string): TourPhoto => ({
  url,
  alt: i18n('photo alt'),
});

/** 완전히 유효한 draft (모든 4단계 통과) — 각 테스트에서 한 가지씩만 빼서 검증 */
const fullyValidDraft: Partial<Tour> = {
  ...validI18n,
  stops: validStops(MIN_STOPS),
  slots: validSlots(MIN_SLOTS),
  thumbnail: '/thumb.webp',
  images: ['/g1.webp', '/g2.webp'], // 총 3장 (thumbnail + 2 gallery)
};

// ───────── 1. i18n basic 검증 ────────────────────────────────────────────────
describe('A1-7-3 validateProductPublish — i18n basic', () => {
  it('title.ko 누락 → missing_i18n + basic 탭', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      title: { ko: '', en: 'x', ja: 'x', zh: 'x' },
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_i18n');
    expect(r.suggestedTab).toBe('basic');
    expect(r.missingFields).toContain('title.ko');
  });

  it('summary.ko 누락 → missing_i18n + basic 탭', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      summary: { ko: '   ', en: 'x', ja: 'x', zh: 'x' }, // 공백만
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_i18n');
    expect(r.missingFields).toContain('summary.ko');
  });

  it('description.ko 누락 → missing_i18n + basic 탭', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      description: { ko: '', en: 'x', ja: 'x', zh: 'x' },
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_i18n');
    expect(r.missingFields).toContain('description.ko');
  });

  it('title 자체가 undefined → missing_i18n', () => {
    const draft: Partial<Tour> = {
      stops: validStops(),
      slots: validSlots(),
      thumbnail: '/t.webp',
      images: ['/g1.webp', '/g2.webp'],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_i18n');
    expect(r.suggestedTab).toBe('basic');
  });

  it('한국어 메시지에 "한국어 제목 / 요약 / 설명" 포함', () => {
    const r = validateProductPublish({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/한국어 제목/);
    expect(r.message).toMatch(/요약/);
    expect(r.message).toMatch(/설명/);
  });
});

// ───────── 2. stops 검증 ─────────────────────────────────────────────────────
describe('A1-7-3 validateProductPublish — stops', () => {
  it('stops 0개 → insufficient_stops + stops 탭', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      stops: [],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_stops');
    expect(r.suggestedTab).toBe('stops');
  });

  it('stops 1개 → insufficient_stops (MIN_STOPS=2 미달)', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      stops: validStops(1),
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_stops');
    expect(r.message).toMatch(/stop.*2.*1/); // "stop 2개 이상 필요 (현재 1개)"
  });

  it('stops undefined → insufficient_stops', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      slots: validSlots(),
      thumbnail: '/t.webp',
      images: ['/g1.webp', '/g2.webp'],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_stops');
  });
});

// ───────── 3. slots 검증 ─────────────────────────────────────────────────────
describe('A1-7-3 validateProductPublish — slots', () => {
  it('stops 충분 + slots 0개 → insufficient_slots + pricing 탭', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      slots: [],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_slots');
    expect(r.suggestedTab).toBe('pricing');
  });

  it('slots undefined → insufficient_slots', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      thumbnail: '/t.webp',
      images: ['/g1.webp', '/g2.webp'],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_slots');
    expect(r.message).toMatch(/슬롯/);
  });
});

// ───────── 4. photos 검증 ────────────────────────────────────────────────────
describe('A1-7-3 validateProductPublish — photos', () => {
  it('stops + slots OK + photos 1장 (썸네일만) → insufficient_photos + media 탭', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
      thumbnail: '/t.webp',
      // images / photos 없음 → 총 1장
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_photos');
    expect(r.suggestedTab).toBe('media');
    expect(r.message).toMatch(/3장/);
  });

  it('썸네일 + 갤러리 2장 (총 3) → ok', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
      thumbnail: '/t.webp',
      images: ['/g1.webp', '/g2.webp'],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(true);
  });

  it('썸네일 없음 + v3 photos 3장 → ok (v3 갤러리 단독 인정)', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
      photos: [photo('/p1.webp'), photo('/p2.webp'), photo('/p3.webp')],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(true);
  });

  it('v3 thumbnail_photo + v3 photos 2장 (총 3) → ok', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
      thumbnail_photo: photo('/t.webp'),
      photos: [photo('/p1.webp'), photo('/p2.webp')],
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(true);
  });

  it('빈 string url 은 0 으로 카운트 (legacy 마이그 safety)', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
      thumbnail: '',
      images: ['', '   ', '/real.webp'], // 실제 1장만 유효
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_photos');
  });
});

// ───────── 5. 검증 순서 (첫 실패에서 stop) ────────────────────────────────────
describe('A1-7-3 validateProductPublish — 검증 순서', () => {
  it('i18n + stops + slots + photos 모두 부족 → i18n 부터 먼저 안내', () => {
    const r = validateProductPublish({});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_i18n');
    expect(r.suggestedTab).toBe('basic');
  });

  it('i18n OK + stops + slots + photos 부족 → stops 부터 안내', () => {
    const r = validateProductPublish(validI18n);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_stops');
  });

  it('i18n + stops OK + slots + photos 부족 → slots 부터 안내', () => {
    const r = validateProductPublish({
      ...validI18n,
      stops: validStops(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_slots');
  });

  it('i18n + stops + slots OK + photos 부족 → photos 안내', () => {
    const r = validateProductPublish({
      ...validI18n,
      stops: validStops(),
      slots: validSlots(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_photos');
  });
});

// ───────── 6. countProductPhotos helper ─────────────────────────────────────
describe('A1-7-3 countProductPhotos', () => {
  it('빈 draft → 0', () => {
    expect(countProductPhotos({})).toBe(0);
  });

  it('thumbnail legacy 만 → 1', () => {
    expect(countProductPhotos({ thumbnail: '/t.webp' })).toBe(1);
  });

  it('thumbnail_photo v3 만 → 1', () => {
    expect(countProductPhotos({ thumbnail_photo: photo('/t.webp') })).toBe(1);
  });

  it('thumbnail + thumbnail_photo 양쪽 → 1 (중복 카운트 안 함 — OR 매트릭스)', () => {
    expect(
      countProductPhotos({
        thumbnail: '/t.webp',
        thumbnail_photo: photo('/t2.webp'),
      })
    ).toBe(1);
  });

  it('legacy images + v3 photos 합산', () => {
    expect(
      countProductPhotos({
        images: ['/g1.webp', '/g2.webp'],
        photos: [photo('/p1.webp')],
      })
    ).toBe(3);
  });

  it('전체 합산 — thumbnail 1 + images 2 + photos 1 = 4', () => {
    expect(
      countProductPhotos({
        thumbnail: '/t.webp',
        images: ['/g1.webp', '/g2.webp'],
        photos: [photo('/p1.webp')],
      })
    ).toBe(4);
  });

  it('빈 string / 공백 url 은 무시', () => {
    expect(
      countProductPhotos({
        thumbnail: '',
        images: ['', '   ', '/g1.webp'],
        photos: [photo(''), photo('/p1.webp')],
      })
    ).toBe(2); // /g1.webp + /p1.webp
  });
});

// ───────── 7. 정상 케이스 ───────────────────────────────────────────────────
describe('A1-7-3 validateProductPublish — 정상', () => {
  it('모든 필수 통과 → ok', () => {
    const r = validateProductPublish(fullyValidDraft);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.suggestedTab).toBeUndefined();
  });

  it('충분히 많은 stops / slots / photos → ok', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      stops: validStops(10),
      slots: validSlots(5),
      thumbnail: '/t.webp',
      images: Array.from({ length: 10 }, (_, i) => `/g${i}.webp`),
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(true);
  });
});

// ───────── 8. constant 노출 검증 ─────────────────────────────────────────────
describe('A1-7-3 constants', () => {
  it('MIN_STOPS = 2', () => {
    expect(MIN_STOPS).toBe(2);
  });
  it('MIN_SLOTS = 1', () => {
    expect(MIN_SLOTS).toBe(1);
  });
  it('MIN_PHOTOS = 3', () => {
    expect(MIN_PHOTOS).toBe(3);
  });
});
