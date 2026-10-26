import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
import { validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation, FINAL_GATE_DIETARY_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { findSelectedFoodRow } from '../../api/_shared/food-name-match.js';

type Row = Record<string, unknown>;
const trusted: Row = {
  name: '합성 식당', nameEn: 'Synthetic Garden', city: 'seoul',
  tag: 'vegan', verification_status: 'vegan_restaurant', lat: 37.57, lng: 126.98,
};
const meal = (fields: Row = {}) => ({ category: 'food', name: trusted.name, start_time: '12:00', stay_min: 60, ...fields });
const plan = (stop: Row, city = 'seoul') => ({ days: [{ day: 1, city, stops: [
  { name: 'Synthetic Culture A', category: 'culture', start_time: '10:00' },
  stop,
  { name: 'Synthetic Culture B', category: 'culture', start_time: '14:00' },
  { name: 'Synthetic Culture C', category: 'culture', start_time: '16:00' },
] }] });

function check(stop: Row, foodIndex: Row[] | undefined, dietary = ['Vegan'], city = 'seoul') {
  const itinerary = plan(stop, city);
  const before = JSON.stringify({ itinerary, foodIndex });
  const issues = validateResponse(itinerary, { lang: 'en', dietary }, foodIndex);
  const final = runFinalItineraryValidation(itinerary, { language: 'en', dietary, foodIndex });
  expect(JSON.stringify({ itinerary, foodIndex })).toBe(before);
  expect(hasCriticalDietaryViolation(issues)).toBe(!final.ok);
  if (!final.ok) expect(final.code).toBe(FINAL_GATE_DIETARY_CODE);
  return final.ok;
}

describe('selected meal evidence', () => {
  it.each([
    ['Halal', 'halal', 'halal_certified'],
    ['Halal', 'halal', 'muslim_friendly'],
    ['Vegan', 'vegan', 'vegan_restaurant'],
    ['Vegan', 'vegan', 'vegan_options'],
  ])('preserves %s support through the existing %s / %s tier', (diet, tag, verification_status) => {
    expect(check(meal(), [{ ...trusted, tag, verification_status }], [diet])).toBe(true);
  });

  it.each([
    { display_name: 'Synthetic Garden', name: '' },
    { name: 'Synthetic Garden' },
    { name: '  합성 식당  ', display_name: '  SYNTHETIC GARDEN  ' },
    { name: undefined, name_ko: '합성 식당', name_en: 'Synthetic Garden' },
  ])('accepts a nonblank exact canonical or established English alias: %j', fields => {
    expect(check(meal(fields), [trusted])).toBe(true);
  });

  it('accepts the established canonical prefix of a pipe-delimited database name', () => {
    expect(check(meal(), [{ ...trusted, name: '합성 식당 | Synthetic Garden' }])).toBe(true);
  });

  // 2026-10-24 (식이 준수 P2): DB 이름의 첫 쉼표 앞부분 별칭 — 실측 "무채색" ↔ "무채색, 홍대 연남동 맛집 & 술집".
  describe('comma-head alias (DB side only, uniqueness over every city-consistent row)', () => {
    const full = '무채색, 홍대 연남동 맛집 & 술집';
    const commaRow: Row = { ...trusted, name: full, nameEn: 'Muchaesaek' };
    it('accepts both the full listed name and the head before the first comma', () => {
      expect(check(meal({ name: full }), [commaRow])).toBe(true);
      expect(check(meal({ name: '무채색' }), [commaRow])).toBe(true);
    });
    it('rejects an exact name colliding with another row\'s comma-head alias (real DB pair shape), full name still unique', () => {
      const rows = [{ ...trusted, name: '무쇠김치삼겹', nameEn: '' }, { ...trusted, name: '무쇠김치삼겹, 명동 맛집 & 고기집', nameEn: '' }];
      expect(findSelectedFoodRow(meal({ name: '무쇠김치삼겹' }), rows, { dayCity: 'seoul' })).toBeNull();
      expect(check(meal({ name: '무쇠김치삼겹' }), rows)).toBe(false);
      expect(check(meal({ name: '무쇠김치삼겹, 명동 맛집 & 고기집' }), rows)).toBe(true);
    });
    it.each([false, true])('rejects a trusted/unverified alias collision regardless of row order: %s', (reverse) => {
      const unverified = { ...trusted, name: '무채색', nameEn: '', verification_status: 'unverified', source: 'naver_local' };
      const rows = reverse ? [unverified, commaRow] : [commaRow, unverified];
      expect(check(meal({ name: '무채색' }), rows)).toBe(false);
    });
    it('rejects a comma-head match whose row is in another city', () => {
      const busanRow = { ...commaRow, city: 'busan' };
      expect(check(meal({ name: '무채색' }), [busanRow])).toBe(false);
    });
    it.each(['무채색 홍대점', '무채', '무채색, 홍대', '홍대 연남동 맛집 & 술집'])('never truncates the model output or matches a substring: %s', (name) => {
      expect(check(meal({ name }), [commaRow])).toBe(false);
    });
  });

  // 2026-10-24 (O6-r5): 식별자 우선 — stop.name 으로 먼저 판정, display_name 은 name 후보 0개일 때만.
  describe('identifier-first (stop.name before display_name)', () => {
    it('accepts the list line "<name> (<nameEn>)" copied whole into name, never a longer copy', () => {
      expect(check(meal({ name: '합성 식당 (Synthetic Garden)' }), [trusted])).toBe(true);
      expect(check(meal({ name: '합성 식당 (Synthetic Garden) [VEGAN]' }), [trusted])).toBe(false);
      const commaRow = { ...trusted, name: '무채색, 홍대 연남동 맛집 & 술집', nameEn: 'Muchaesaek' };
      expect(check(meal({ name: '무채색 (Muchaesaek)' }), [commaRow])).toBe(true);
    });
    it.each([false, true])('a trusted name row wins over a general row whose nameEn equals display_name (order %s)', reverse => {
      const general = { ...trusted, name: '다른 식당', nameEn: 'Namaste Garden', tag: 'general', verification_status: undefined, source: 'google_places' };
      const rows = reverse ? [general, trusted] : [trusted, general];
      expect(check(meal({ display_name: 'Namaste Garden' }), rows)).toBe(true);
    });
    it('keeps parentheses that belong to the raw DB name: "합성 식당 (본점)" matches as is, the cut "합성 식당" is rejected', () => {
      const branchRow = { ...trusted, name: '합성 식당 (본점)' };
      expect(check(meal({ name: '합성 식당 (본점)' }), [branchRow])).toBe(true);
      expect(check(meal({ name: '합성 식당' }), [branchRow])).toBe(false);
    });
    it('a name exactly matching two rows is still rejected', () => {
      expect(check(meal({ name: '합성 식당 (Synthetic Garden)' }), [trusted, { ...trusted }])).toBe(false);
    });
    it('falls back to display_name only when name matches no row', () => {
      expect(check(meal({ name: '합성 식당 본점', display_name: 'Synthetic Garden' }), [trusted])).toBe(true);
      expect(check(meal({ name: '합성 식당 본점', display_name: 'Synthetic Garden' }), [trusted, { ...trusted, name: '합성 식당 2', verification_status: 'unverified' }])).toBe(false);
    });
  });

  it.each(['Synthetic', 'Synthetic Garden Annex', 'Synthetic-Garden'])('rejects partial, branch, or altered names: %s', name => {
    expect(check(meal({ name }), [trusted])).toBe(false);
  });

  it.each([
    { name: '', display_name: '' },
    { name: '  ', display_name: '\t' },
    { name: undefined, display_name: undefined },
    { name: 17, display_name: false },
  ])('never matches blank or non-string names: %j', fields => {
    expect(check(meal(fields), [{ ...trusted, name: '', nameEn: '' }])).toBe(false);
  });

  it('ignores stale legacy names when current names identify another restaurant', () => {
    expect(check(meal({ name: 'Unknown Meal', name_ko: trusted.name,
      display_name: 'Unknown Meal', name_en: trusted.nameEn }), [trusted])).toBe(false);
  });

  it.each([
    { dietary_tags: ['vegan'] }, { dietary: ['vegan'] }, { tags: ['vegan'] },
    { tip: 'Verified vegan restaurant' }, { reason: 'Vegan menu available' },
    { verified: true }, { verification_status: 'vegan_restaurant' },
    { dietary_evidence: [{ diet: 'vegan', tag: 'vegan', verification_status: 'vegan_restaurant' }] },
  ])('AI-provided claims cannot establish evidence: %j', claims => {
    for (const rows of [[], [{ ...trusted, tag: 'general' }], [{ ...trusted, verification_status: 'unverified' }]]) {
      expect(check(meal(claims), rows)).toBe(false);
    }
  });

  it('fails with a missing index, and never borrows another restaurant evidence', () => {
    expect(check(meal({ tip: 'Halal options available' }), undefined, ['Halal'])).toBe(false);
    expect(check(meal({ name: 'Unknown Meal', tip: 'Halal options available' }),
      [{ ...trusted, tag: 'halal', verification_status: 'halal_certified' }], ['Halal'])).toBe(false);
  });

  it.each([false, true])('rejects a trusted/unverified name collision regardless of row order: %s', reverse => {
    const rows = [trusted, { ...trusted, verification_status: 'unverified' }];
    expect(check(meal({ lat: trusted.lat, lng: trusted.lng }), reverse ? rows.reverse() : rows)).toBe(false);
  });

  it('rejects duplicate trusted rows and canonical/alias collisions', () => {
    expect(check(meal(), [trusted, { ...trusted }])).toBe(false);
    expect(check(meal(), [trusted, { ...trusted, name: 'Another Meal', nameEn: trusted.name }])).toBe(false);
    expect(findSelectedFoodRow(meal(), [trusted, trusted])).toBeNull();
  });

  it('does not manufacture uniqueness by discarding rows with missing city or different trust', () => {
    expect(check(meal(), [trusted, { ...trusted, city: undefined, verification_status: 'unverified' }])).toBe(false);
  });

  it('may distinguish exact same-name branches using their explicit city', () => {
    expect(check(meal(), [{ ...trusted, city: 'busan' }, trusted])).toBe(true);
    expect(check(meal(), [{ ...trusted, city: 'busan' }, trusted], ['Vegan'], '')).toBe(false);
  });

  it.each([
    { stopCity: undefined, rowCity: 'busan', dayCity: 'seoul' },
    { stopCity: 'busan', rowCity: 'busan', dayCity: 'seoul' },
    { stopCity: 'busan', rowCity: 'seoul', dayCity: 'seoul' },
    { stopCity: 'busan', rowCity: 'seoul', dayCity: '' },
  ])('rejects every explicit city conflict even with identical coordinates: %j', cities => {
    expect(check(meal({ city: cities.stopCity, lat: trusted.lat, lng: trusted.lng }),
      [{ ...trusted, city: cities.rowCity }], ['Vegan'], cities.dayCity)).toBe(false);
  });

  it.each(['seoul_city', 'seoul_gangnam', 'Seoul_Suburb'])(
    'preserves existing area-key city normalization: %s', city => {
      expect(check(meal({ city }), [trusted], ['Vegan'], city)).toBe(true);
      expect(check(meal({ city: 'busan_city' }), [trusted], ['Vegan'], city)).toBe(false);
    });

  it('reuses existing Korean city normalization without requiring coordinates', () => {
    expect(check(meal({ city: '서울' }), [trusted], ['Vegan'], 'Seoul')).toBe(true);
  });

  it('introduces neither a missing-city requirement nor a new coordinate-distance rule', () => {
    expect(check(meal(), [{ ...trusted, city: undefined }], ['Vegan'], '')).toBe(true);
    expect(check(meal({ lat: 35.18, lng: 129.07 }), [trusted])).toBe(true);
  });

  it('uses the existing tag-array support and source quarantine rules', () => {
    expect(check(meal(), [{ ...trusted, tag: undefined, dietary_tags: ['vegan'] }])).toBe(true);
    expect(check(meal(), [{ ...trusted, verification_status: undefined, source: 'naver_local' }])).toBe(false);
    expect(check(meal(), [{ ...trusted, verification_status: undefined, source: 'ai_curated_2026_05_21' }])).toBe(false);
  });

  it('preserves vegan-to-vegetarian coverage and rejects the reverse', () => {
    expect(check(meal(), [trusted], ['Vegetarian'])).toBe(true);
    expect(check(meal(), [{ ...trusted, tag: 'vegetarian', verification_status: 'vegan_options' }])).toBe(false);
  });

  it('requires all requested dietary evidence on the selected row', () => {
    expect(check(meal(), [trusted], ['Halal', 'Vegan'])).toBe(false);
    // 2026-10-26 (Astra B3): 명시 등급 하나는 한 계열만 보증한다 — vegan_restaurant 행에 halal 태그를 더해도 할랄 증거가 아니다.
    expect(check(meal(), [{ ...trusted, dietary_tags: ['halal'] }], ['Halal', 'Vegan'])).toBe(false); // vegan_restaurant 는 할랄 증거 아님
  });

  it.each(['beef', 'chicken', 'pork', 'fish', 'seafood', '소고기', '돼지', '닭', '생선', '해산물'])(
    'retains explicit vegan ingredient conflicts despite trusted evidence: %s', ingredient => {
      expect(check(meal({ tip: 'Serves ' + ingredient }), [trusted])).toBe(false);
    });

  it.each(['pork', '돼지', '삼겹'])('retains explicit halal conflicts: %s', ingredient => {
    expect(check(meal({ tip: 'Serves ' + ingredient }),
      [{ ...trusted, tag: 'halal', verification_status: 'halal_certified' }], ['Halal'])).toBe(false);
  });

  it.each(['no pork', 'pork-free', '돼지고기 없음', 'without beef', 'no fish'])(
    'preserves negation while still requiring selected-row evidence: %s', tip => {
      expect(check(meal({ tip }), [trusted])).toBe(true);
      expect(check(meal({ tip }), [])).toBe(false);
    });

  it('retains conflicts from legacy stop text', () => {
    expect(check(meal({ tip: undefined, tip_en: 'Serves pork' }), [trusted])).toBe(false);
    expect(check(meal({ name: undefined, name_ko: '돼지 식당' }), [{ ...trusted, name: '돼지 식당' }])).toBe(false);
  });

  it('does not block unknown general meals without a safety diet', () => {
    expect(check(meal({ name: 'Unknown Meal', tip: 'Serves pork' }), [], [])).toBe(true);
    expect(check(meal({ name: 'Unknown Meal' }), [], ['Local cuisine'])).toBe(true);
  });

  it('leaves non-food stops outside the dietary evidence check', () => {
    const issues = validateResponse({ days: [{ stops: [meal({ category: 'culture', name: 'Unknown Place' })] }] },
      { lang: 'en', dietary: ['Vegan'] }, []);
    expect(hasCriticalDietaryViolation(issues)).toBe(false);
    expect(runFinalItineraryValidation({ days: [{ stops: [
      { category: 'travel', name: 'Synthetic Airport' },
    ] }] }, { dietary: ['Vegan'], foodIndex: [] }).ok).toBe(true);
  });
});
