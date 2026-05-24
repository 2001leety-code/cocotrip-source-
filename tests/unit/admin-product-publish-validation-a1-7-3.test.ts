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
import type {
  Tour,
  TourStop,
  TourSlot,
  TourPhoto,
  I18nString,
  MeetingPoint,
  CancellationPolicy,
} from '@/data/tours';
import {
  validateProductPublish,
  countProductPhotos,
  validateStopNested,
  validateSlotNumeric,
  validateI18nLangs,
  validateMeetingPoint,
  validateCancellationPolicy,
  checkI18nWarnings,
  MIN_STOPS,
  MIN_SLOTS,
  MIN_PHOTOS,
  MIN_SLOT_CAPACITY,
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
  it('MIN_SLOT_CAPACITY = 1', () => {
    expect(MIN_SLOT_CAPACITY).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A1-7-3 follow-up — nested 검증 5종 (PR #578 review 4번 발견 갭)
//
// 회귀 차단:
//   - count-only 검증으로는 빈 stop 2개 / capacity=0 slot / lat 없는 meeting
//     통과 → 손님에게 "잘못된 카드" 노출. 5종 nested 검증으로 매트릭스 완결.
// ─────────────────────────────────────────────────────────────────────────────

// ───────── 9. validateStopNested — stops nested 필드 ────────────────────────
describe('A1-7-3 validateStopNested — stops nested', () => {
  const baseStop = (): TourStop => ({
    time: '09:00',
    name: i18n('경복궁'),
    stay_min: 60,
    description: i18n('조선시대 정궁'),
  });

  it('빈 stops 배열 → null (검증 통과)', () => {
    expect(validateStopNested([])).toBeNull();
  });

  it('모든 stop 의 name.ko/en + description.ko/en 있음 → null', () => {
    expect(validateStopNested([baseStop(), baseStop()])).toBeNull();
  });

  it('첫 stop 의 name.ko 빈 값 → fail + stops 탭', () => {
    const stops = [baseStop()];
    stops[0].name = { ko: '', en: 'Gyeongbokgung', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r).not.toBeNull();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('stop_nested_missing');
    expect(r?.suggestedTab).toBe('stops');
    expect(r?.missingFields).toContain('stops[0].name.ko');
  });

  it('첫 stop 의 name.en 빈 값 → fail (외국인 손님 노출)', () => {
    const stops = [baseStop()];
    stops[0].name = { ko: '경복궁', en: '   ', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r?.reason).toBe('stop_nested_missing');
    expect(r?.missingFields).toContain('stops[0].name.en');
  });

  it('첫 stop 의 description.ko 빈 값 → fail', () => {
    const stops = [baseStop()];
    stops[0].description = { ko: '', en: 'Joseon palace', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r?.reason).toBe('stop_nested_missing');
    expect(r?.missingFields).toContain('stops[0].description.ko');
  });

  it('첫 stop 의 description.en 빈 값 → fail', () => {
    const stops = [baseStop()];
    stops[0].description = { ko: '조선시대 정궁', en: '', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r?.reason).toBe('stop_nested_missing');
    expect(r?.missingFields).toContain('stops[0].description.en');
  });

  it('두 번째 stop 의 name.ko 빈 → fail + 메시지에 "2번째" 포함', () => {
    const stops = [baseStop(), baseStop()];
    stops[1].name = { ko: '', en: 'x', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r?.reason).toBe('stop_nested_missing');
    expect(r?.missingFields).toContain('stops[1].name.ko');
    expect(r?.message).toMatch(/2번째/);
  });

  it('첫 stop 통과 + 두 번째 stop 모든 필드 빈 → missingFields 4개', () => {
    const stops = [baseStop(), baseStop()];
    stops[1].name = { ko: '', en: '', ja: 'x', zh: 'x' };
    stops[1].description = { ko: '', en: '', ja: 'x', zh: 'x' };
    const r = validateStopNested(stops);
    expect(r?.missingFields).toHaveLength(4);
    expect(r?.missingFields).toContain('stops[1].name.ko');
    expect(r?.missingFields).toContain('stops[1].name.en');
    expect(r?.missingFields).toContain('stops[1].description.ko');
    expect(r?.missingFields).toContain('stops[1].description.en');
  });

  it('validateProductPublish 가 nested 검증까지 chain (모든 count 통과 + nested 빈) → stop_nested_missing', () => {
    const stops = validStops(MIN_STOPS);
    stops[0].name = { ko: '', en: '', ja: '', zh: '' };
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      stops,
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stop_nested_missing');
    expect(r.suggestedTab).toBe('stops');
  });
});

// ───────── 10. validateSlotNumeric — slot 숫자 ──────────────────────────────
describe('A1-7-3 validateSlotNumeric — slots numeric', () => {
  const baseSlot = (overrides: Partial<TourSlot> = {}): TourSlot => ({
    id: 'slot-1',
    start_time: '09:00',
    is_active: true,
    ...overrides,
  });

  it('빈 slots 배열 → null', () => {
    expect(validateSlotNumeric([])).toBeNull();
  });

  it('capacity 미설정 → null (Tour.maxPax 폴백 허용)', () => {
    expect(validateSlotNumeric([baseSlot()])).toBeNull();
  });

  it('capacity=1 → null (MIN_SLOT_CAPACITY 충족)', () => {
    expect(validateSlotNumeric([baseSlot({ capacity: 1 })])).toBeNull();
  });

  it('capacity=0 → fail + pricing 탭', () => {
    const r = validateSlotNumeric([baseSlot({ capacity: 0 })]);
    expect(r).not.toBeNull();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('slot_numeric_invalid');
    expect(r?.suggestedTab).toBe('pricing');
    expect(r?.missingFields?.[0]).toMatch(/slots\[0\]\.capacity=0/);
  });

  it('capacity=-1 → fail (음수 차단)', () => {
    const r = validateSlotNumeric([baseSlot({ capacity: -1 })]);
    expect(r?.reason).toBe('slot_numeric_invalid');
    expect(r?.missingFields?.[0]).toMatch(/capacity=-1/);
  });

  it('price_modifier_krw=-5000 → fail (음수 차단)', () => {
    const r = validateSlotNumeric([baseSlot({ price_modifier_krw: -5000 })]);
    expect(r?.reason).toBe('slot_numeric_invalid');
    expect(r?.missingFields?.[0]).toMatch(/price_modifier_krw=-5000/);
  });

  it('price_modifier_krw=0 → null (0 허용 — base price 사용)', () => {
    expect(validateSlotNumeric([baseSlot({ price_modifier_krw: 0 })])).toBeNull();
  });

  it('두 번째 slot 의 capacity=0 → 메시지에 "2번째"', () => {
    const r = validateSlotNumeric([baseSlot({ id: 's1', capacity: 5 }), baseSlot({ id: 's2', capacity: 0 })]);
    expect(r?.message).toMatch(/2번째/);
  });

  it('validateProductPublish 가 slot numeric 검증 chain → slot_numeric_invalid', () => {
    const slots = validSlots(MIN_SLOTS);
    slots[0] = { ...slots[0], capacity: 0 };
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      slots,
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('slot_numeric_invalid');
    expect(r.suggestedTab).toBe('pricing');
  });
});

// ───────── 11. validateI18nLangs — en 필수 + warnings ──────────────────────
describe('A1-7-3 validateI18nLangs — en 필수 (ja/zh warning)', () => {
  it('title/summary/description 모두 en 있음 → null', () => {
    expect(validateI18nLangs(validI18n)).toBeNull();
  });

  it('title.en 빈 값 → fail + basic 탭', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      title: { ko: '서울', en: '', ja: 'x', zh: 'x' },
    };
    const r = validateI18nLangs(draft);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('i18n_lang_missing');
    expect(r?.suggestedTab).toBe('basic');
    expect(r?.missingFields).toContain('title.en');
  });

  it('summary.en 빈 값 → fail', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      summary: { ko: '서울', en: '   ', ja: 'x', zh: 'x' },
    };
    const r = validateI18nLangs(draft);
    expect(r?.missingFields).toContain('summary.en');
  });

  it('description.en 빈 값 → fail', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      description: { ko: '설명', en: '', ja: 'x', zh: 'x' },
    };
    const r = validateI18nLangs(draft);
    expect(r?.missingFields).toContain('description.en');
  });

  it('title.en + summary.en + description.en 모두 빈 → 3개 missing', () => {
    const draft: Partial<Tour> = {
      title: { ko: 'k', en: '', ja: '', zh: '' },
      summary: { ko: 'k', en: '', ja: '', zh: '' },
      description: { ko: 'k', en: '', ja: '', zh: '' },
    };
    const r = validateI18nLangs(draft);
    expect(r?.missingFields).toHaveLength(3);
  });

  it('한국어 메시지에 "외국인 손님 primary" 포함', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      title: { ko: 'k', en: '', ja: '', zh: '' },
    };
    const r = validateI18nLangs(draft);
    expect(r?.message).toMatch(/외국인 손님/);
  });

  it('validateProductPublish 가 i18n lang chain → i18n_lang_missing', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      title: { ko: '서울', en: '', ja: '', zh: '' },
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('i18n_lang_missing');
  });

  // checkI18nWarnings 별도 함수
  it('checkI18nWarnings — ja/zh 모두 있음 → []', () => {
    expect(checkI18nWarnings(validI18n)).toEqual([]);
  });

  it('checkI18nWarnings — title.ja 빈 → ["title.ja"] 등 warning 반환', () => {
    const draft: Partial<Tour> = {
      ...validI18n,
      title: { ko: '서울', en: 'Seoul', ja: '', zh: '' },
    };
    const ws = checkI18nWarnings(draft);
    expect(ws).toContain('title.ja');
    expect(ws).toContain('title.zh');
  });

  it('checkI18nWarnings — 빈 draft → 모든 warning (4개)', () => {
    const ws = checkI18nWarnings({});
    expect(ws).toHaveLength(4); // title.ja/zh + summary.ja/zh
  });
});

// ───────── 12. validateMeetingPoint — kind 별 필수 ─────────────────────────
describe('A1-7-3 validateMeetingPoint — meeting_point kind', () => {
  it('meeting_point undefined → null (미설정 자체 허용)', () => {
    expect(validateMeetingPoint(undefined)).toBeNull();
  });

  it('fixed_address: lat/lng + address.ko 있음 → null', () => {
    const mp: MeetingPoint = {
      kind: 'fixed_address',
      lat: 37.5796,
      lng: 126.9770,
      address: i18n('서울 종로구 경복궁'),
    };
    expect(validateMeetingPoint(mp)).toBeNull();
  });

  it('fixed_address: lat 없음 → fail + meeting 탭', () => {
    const mp: MeetingPoint = {
      kind: 'fixed_address',
      lng: 126.9770,
      address: i18n('주소'),
    };
    const r = validateMeetingPoint(mp);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('meeting_point_invalid');
    expect(r?.suggestedTab).toBe('meeting');
    expect(r?.missingFields).toContain('meeting_point.lat');
  });

  it('fixed_address: lng 없음 → fail', () => {
    const mp: MeetingPoint = {
      kind: 'fixed_address',
      lat: 37.5796,
      address: i18n('주소'),
    };
    const r = validateMeetingPoint(mp);
    expect(r?.missingFields).toContain('meeting_point.lng');
  });

  it('fixed_address: lat=NaN → fail (Number.isFinite 검증)', () => {
    const mp: MeetingPoint = {
      kind: 'fixed_address',
      lat: NaN,
      lng: 126.9770,
      address: i18n('주소'),
    };
    const r = validateMeetingPoint(mp);
    expect(r?.missingFields).toContain('meeting_point.lat');
  });

  it('fixed_address: address.ko 빈 → fail', () => {
    const mp: MeetingPoint = {
      kind: 'fixed_address',
      lat: 37.5,
      lng: 126.9,
      address: { ko: '', en: 'addr', ja: '', zh: '' },
    };
    const r = validateMeetingPoint(mp);
    expect(r?.missingFields).toContain('meeting_point.address.ko');
  });

  it('hotel_pickup: instructions.ko 있음 → null', () => {
    const mp: MeetingPoint = {
      kind: 'hotel_pickup',
      instructions: i18n('호텔 로비'),
    };
    expect(validateMeetingPoint(mp)).toBeNull();
  });

  it('hotel_pickup: instructions.ko 없음 → fail', () => {
    const mp: MeetingPoint = {
      kind: 'hotel_pickup',
    };
    const r = validateMeetingPoint(mp);
    expect(r?.ok).toBe(false);
    expect(r?.missingFields).toContain('meeting_point.instructions.ko');
  });

  it('multi_zone: zones 1개 이상 → null', () => {
    const mp: MeetingPoint = {
      kind: 'multi_zone',
      zones: [{ id: 'z1', name: i18n('명동'), area_label: i18n('명동역') }],
    };
    expect(validateMeetingPoint(mp)).toBeNull();
  });

  it('multi_zone: zones 빈 배열 → fail', () => {
    const mp: MeetingPoint = {
      kind: 'multi_zone',
      zones: [],
    };
    const r = validateMeetingPoint(mp);
    expect(r?.missingFields).toContain('meeting_point.zones');
  });

  it('multi_zone: zones undefined → fail', () => {
    const mp: MeetingPoint = {
      kind: 'multi_zone',
    };
    const r = validateMeetingPoint(mp);
    expect(r?.missingFields).toContain('meeting_point.zones');
  });

  it('validateProductPublish 가 meeting_point chain → meeting_point_invalid', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      meeting_point: {
        kind: 'fixed_address',
        address: i18n('주소만 있음 — lat/lng 누락'),
      },
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('meeting_point_invalid');
    expect(r.suggestedTab).toBe('meeting');
  });
});

// ───────── 13. validateCancellationPolicy ──────────────────────────────────
describe('A1-7-3 validateCancellationPolicy — 환불 정책', () => {
  it('undefined → null (글로벌 inherit 기본)', () => {
    expect(validateCancellationPolicy(undefined)).toBeNull();
  });

  it('kind=inherit_global → null', () => {
    const cp: CancellationPolicy = { kind: 'inherit_global' };
    expect(validateCancellationPolicy(cp)).toBeNull();
  });

  it('kind=custom + tiers 1개 → null', () => {
    const cp: CancellationPolicy = {
      kind: 'custom',
      tiers: [{ hours_before: 24, refund_percent: { general: 100, gold: 100, platinum: 100 } }],
    };
    expect(validateCancellationPolicy(cp)).toBeNull();
  });

  it('kind=custom + tiers undefined → fail + cancellation 탭', () => {
    const cp: CancellationPolicy = { kind: 'custom' };
    const r = validateCancellationPolicy(cp);
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe('cancellation_policy_invalid');
    expect(r?.suggestedTab).toBe('cancel');
    expect(r?.missingFields).toContain('cancellation_policy.tiers');
  });

  it('kind=custom + tiers 빈 배열 → fail', () => {
    const cp: CancellationPolicy = { kind: 'custom', tiers: [] };
    const r = validateCancellationPolicy(cp);
    expect(r?.reason).toBe('cancellation_policy_invalid');
  });

  it('알 수 없는 kind → fail (schema 깨짐)', () => {
    const cp = { kind: 'unknown_kind' } as unknown as CancellationPolicy;
    const r = validateCancellationPolicy(cp);
    expect(r?.ok).toBe(false);
    expect(r?.missingFields).toContain('cancellation_policy.kind');
    expect(r?.message).toMatch(/inherit_global/);
  });

  it('validateProductPublish 가 cancellation chain → cancellation_policy_invalid', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      cancellation_policy: { kind: 'custom' }, // tiers 누락
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cancellation_policy_invalid');
  });
});

// ───────── 14. 종합 — 모든 nested 통과 + 정상 ──────────────────────────────
describe('A1-7-3 nested — 모든 검증 통과 정상 케이스', () => {
  it('count + nested + i18n en + meeting + cancellation 모두 통과 → ok', () => {
    const draft: Partial<Tour> = {
      ...fullyValidDraft,
      meeting_point: {
        kind: 'fixed_address',
        lat: 37.5796,
        lng: 126.9770,
        address: i18n('서울 종로구 경복궁'),
      },
      cancellation_policy: {
        kind: 'custom',
        tiers: [
          { hours_before: 48, refund_percent: { general: 100, gold: 100, platinum: 100 } },
          { hours_before: 24, refund_percent: { general: 50, gold: 75, platinum: 100 } },
        ],
      },
    };
    const r = validateProductPublish(draft);
    expect(r.ok).toBe(true);
  });

  it('meeting_point + cancellation_policy 미설정 (옵셔널) → ok', () => {
    const r = validateProductPublish(fullyValidDraft);
    expect(r.ok).toBe(true);
  });
});
