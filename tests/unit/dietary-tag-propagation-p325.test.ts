/**
 * P325 (2026-06-28) SAFETY-CRITICAL 회귀 테스트.
 *
 * 근본: dbMatcher.applyDBMatcher 가 DB 인증 식당의 tag(halal/vegan)를 stop.dietary_tags 로
 * 전파하지 않아, 이름에 halal 토큰이 없는 식당(DB halal 의 ~80%)이 responseValidator 에
 * "증거 없음"으로 보여 거짓 dietary_violation → 422 거짓 거부 → 환불.
 *
 * fix: applyDBMatcher 가 match.tag(halal/vegan/vegetarian)를 stop.dietary_tags 에 전파
 * (city-mismatch 제외 = DB 인증 식당만). 검증 로직 자체는 그대로 엄격 유지(완화 아님).
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore — JS 모듈
import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';
// @ts-ignore — JS 모듈
import { validateResponse } from '../../api/_ai_core/responseValidator.js';

// 이름에 halal 토큰이 전혀 없는 DB-verified halal 식당 (실제 DB의 다수 케이스)
const HALAL_DB = [{
  name: 'Sinchon Burger',
  nameEn: 'Sinchon Burger',
  tag: 'halal',
  city: 'seoul',
  address: '서울특별시 마포구 신촌로 1',
  lat: 37.5598,
  lng: 126.9423,
  rating: 4.7,
  reviewCount: 200,
  allergens: { nuts: false, shellfish: false, gluten: false, dairy: false },
}];

const makeItinerary = () => ({
  days: [{
    city: 'seoul',
    stops: [{ category: 'food', name: 'Sinchon Burger', display_name: 'Sinchon Burger', tip: 'tasty spot' }],
  }],
});

describe('P325 — DB dietary tag propagation (halal false-violation fix)', () => {
  it('halal 식당(이름에 halal 토큰 없음) 매칭 시 stop.dietary_tags=[halal] 전파', () => {
    const itin = makeItinerary();
    applyDBMatcher(itin, HALAL_DB, 'seoul', 'en');
    const stop = itin.days[0].stops[0];
    expect(stop.dietary_tags).toBeDefined();
    expect(stop.dietary_tags.map((t: string) => String(t).toLowerCase())).toContain('halal');
  });

  it('전파된 dietary_tags 로 validateResponse 가 거짓 dietary_violation 을 안 낸다', () => {
    const itin = makeItinerary();
    applyDBMatcher(itin, HALAL_DB, 'seoul', 'en');
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, HALAL_DB);
    const violations = (issues || []).filter((i: any) => i.type === 'dietary_violation');
    expect(violations).toHaveLength(0);
  });

  it('대조(fix 없으면): 태그 미전파 + 이름에 토큰 없으면 violation 발생 — 검증 엄격성 유지 확인', () => {
    const itin = makeItinerary();
    // applyDBMatcher 미실행 → dietary_tags 없음. 이름 'Sinchon Burger' 에 halal 토큰 없음.
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, []);
    const violations = (issues || []).filter((i: any) => i.type === 'dietary_violation');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('city-mismatch 식당은 tag 전파 안 함(다른 도시 = 요청 도시 기준 미검증)', () => {
    const itin = makeItinerary(); // seoul 요청
    const busanHalalDb = [{ ...HALAL_DB[0], city: 'busan' }]; // 부산 식당만
    applyDBMatcher(itin, busanHalalDb, 'seoul', 'en');
    const stop = itin.days[0].stops[0];
    // cross-city 는 hard-reject(verified=false) → dietary_tags 전파 안 됨
    const tags = (stop.dietary_tags || []).map((t: string) => String(t).toLowerCase());
    expect(tags).not.toContain('halal');
  });
});

/**
 * 2026-07-10 (주간 halal 422 근본 fix) — PROD 실행 순서 회귀.
 *
 * prod 는 validateResponse 가 applyDBMatcher 보다 먼저 돈다(geminiPipeline legacy :1526→:1681).
 * 위 P325 테스트는 매칭→검증 순서라 prod 의 거짓 422 경로를 커버하지 못했음(CI green ≠ prod safe).
 * fix: validateResponse 가 이미 받는 foodIndex 로 검증 시점에 DB 인증(tag)을 직접 대조.
 */
const dietaryViolations = (issues: any) =>
  (issues || []).filter((i: any) => i.type === 'dietary_violation');

describe('2026-07-10 — prod 순서(검증→매칭)에서 DB 인증 인정', () => {
  it('PROD 순서: dbMatcher 없이도 DB halal 인증 식당은 violation 아님', () => {
    const itin = makeItinerary(); // 태그·halal 토큰 전혀 없음, DB 이름 정합만
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, HALAL_DB);
    expect(dietaryViolations(issues)).toHaveLength(0);
  });

  it('DB에 없는 식당은 여전히 violation (엄격성 유지)', () => {
    const itin = makeItinerary();
    itin.days[0].stops[0].name = 'Random BBQ House';
    itin.days[0].stops[0].display_name = 'Random BBQ House';
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, HALAL_DB);
    expect(dietaryViolations(issues).length).toBeGreaterThan(0);
  });

  it('DB 인증이어도 실제 pork 언급(비부정)은 여전히 violation — DB 태그가 conflict 를 덮지 않음', () => {
    const itin = makeItinerary();
    itin.days[0].stops[0].tip = 'famous for grilled pork belly';
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, HALAL_DB);
    expect(dietaryViolations(issues).length).toBeGreaterThan(0);
  });
});

describe('2026-07-10 — 부정문("no pork") 거짓 conflict fix', () => {
  const halalStop = (tip: string) => ({
    days: [{
      city: 'seoul',
      stops: [{ category: 'food', name: 'Halal Kitchen', display_name: 'Halal Kitchen',
                dietary_tags: ['halal'], tip }],
    }],
  });

  it('"Halal certified — no pork served" 안심 문구는 violation 아님', () => {
    const issues = validateResponse(halalStop('Halal certified — no pork served here.'),
                                    { lang: 'en', dietary: ['Halal'] }, []);
    expect(dietaryViolations(issues)).toHaveLength(0);
  });

  it('"pork-free menu" 도 violation 아님', () => {
    const issues = validateResponse(halalStop('100% pork-free menu, halal verified.'),
                                    { lang: 'en', dietary: ['Halal'] }, []);
    expect(dietaryViolations(issues)).toHaveLength(0);
  });

  it('"돼지고기 없음" 한국어 부정문도 violation 아님', () => {
    const issues = validateResponse(halalStop('할랄 인증 — 돼지고기 없음.'),
                                    { lang: 'en', dietary: ['Halal'] }, []);
    expect(dietaryViolations(issues)).toHaveLength(0);
  });

  it('진짜 pork 언급("famous pork belly")은 여전히 violation', () => {
    const issues = validateResponse(halalStop('halal? actually famous pork belly.'),
                                    { lang: 'en', dietary: ['Halal'] }, []);
    expect(dietaryViolations(issues).length).toBeGreaterThan(0);
  });

  it('식당 이름의 삼겹(정체성)은 여전히 violation', () => {
    const itin = {
      days: [{ city: 'seoul', stops: [{ category: 'food', name: '삼겹살 하우스',
        display_name: 'Samgyeop House', dietary_tags: ['halal'], tip: 'halal option available' }] }],
    };
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Halal'] }, []);
    expect(dietaryViolations(issues).length).toBeGreaterThan(0);
  });

  it('vegan: "no meat, no fish used" + vegan 태그 → violation 아님', () => {
    const itin = {
      days: [{ city: 'seoul', stops: [{ category: 'food', name: 'Green Table',
        display_name: 'Green Table', dietary_tags: ['vegan'],
        tip: '100% vegan — no meat, no fish used in any dish.' }] }],
    };
    const issues = validateResponse(itin, { lang: 'en', dietary: ['Vegan'] }, []);
    expect(dietaryViolations(issues)).toHaveLength(0);
  });
});
