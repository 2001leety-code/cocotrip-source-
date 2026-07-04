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
