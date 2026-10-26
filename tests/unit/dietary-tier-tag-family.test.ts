/**
 * 식이 등급-태그 계열 일치 (2026-10-26 Astra B3) + 10/26 r3 격리 5곳 회귀 가드.
 *
 * 불변식:
 *   1. 할랄 등급(halal_certified/muslim_friendly)은 halal 태그에만, 비건 등급(vegan_restaurant/vegan_options)은
 *      vegan/vegetarian 태그에만 증거가 된다 — "halal 태그 + vegan_restaurant" 는 할랄 증거가 아니다.
 *   2. 실데이터(_food_index.json): 신뢰 등급 행 중 계열이 어긋난 행 0.
 *   3. 실데이터: 운영자 승인 격리 5곳(철판집·러빙헛 카페·ONL(퍼멘츠)·8피스 피자·Everhalal)은 unverified.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  statusMatchesTag, dietaryEvidenceFor, isDietaryTrusted, checkDietaryCoverage,
  TRUSTED_DIETARY_STATUS, DIETARY_TAGS,
} from '../../api/_shared/dietary-trust.js';

const mk = (over: Record<string, unknown> = {}) => ({
  name: '테스트식당', city: 'seoul', tag: 'halal', lat: 37.5665, lng: 126.978,
  address: '서울특별시 중구 세종대로 110', rating: 4.7, reviewCount: 100, placeId: 'x', ...over,
});

describe('statusMatchesTag', () => {
  it('같은 계열만 true', () => {
    expect(statusMatchesTag('halal_certified', 'halal')).toBe(true);
    expect(statusMatchesTag('muslim_friendly', 'HALAL')).toBe(true);
    expect(statusMatchesTag('vegan_restaurant', 'vegan')).toBe(true);
    expect(statusMatchesTag('vegan_options', 'vegetarian')).toBe(true);
  });
  it('계열이 다르거나 미지의 값이면 false', () => {
    expect(statusMatchesTag('vegan_restaurant', 'halal')).toBe(false);
    expect(statusMatchesTag('vegan_options', 'halal')).toBe(false);
    expect(statusMatchesTag('halal_certified', 'vegan')).toBe(false);
    expect(statusMatchesTag('muslim_friendly', 'vegetarian')).toBe(false);
    expect(statusMatchesTag('unverified', 'halal')).toBe(false);
    expect(statusMatchesTag('', 'halal')).toBe(false);
    expect(statusMatchesTag('halal_certified', 'general')).toBe(false);
  });
});

describe('dietaryEvidenceFor / isDietaryTrusted — 계열 불일치 = 증거 아님', () => {
  it('halal 태그 + vegan_restaurant 등급은 할랄 증거가 아니다 (이전에는 통과)', () => {
    const row = mk({ tag: 'halal', verification_status: 'vegan_restaurant' });
    expect(dietaryEvidenceFor(row, 'halal')).toBeNull();
    expect(isDietaryTrusted(row)).toBe(false);
  });
  it('vegan 태그 + halal_certified 등급은 비건·채식 증거가 아니다', () => {
    const row = mk({ tag: 'vegan', verification_status: 'halal_certified' });
    expect(dietaryEvidenceFor(row, 'vegan')).toBeNull();
    expect(dietaryEvidenceFor(row, 'vegetarian')).toBeNull();
    expect(isDietaryTrusted(row)).toBe(false);
  });
  it('계열이 맞으면 종전대로 통과 (vegetarian 요청은 vegan 식당 허용)', () => {
    expect(dietaryEvidenceFor(mk({ tag: 'halal', verification_status: 'muslim_friendly' }), 'halal'))
      .toMatchObject({ tag: 'halal', verification_status: 'muslim_friendly' });
    expect(dietaryEvidenceFor(mk({ tag: 'vegan', verification_status: 'vegan_restaurant' }), 'vegetarian'))
      .toMatchObject({ tag: 'vegan', verification_status: 'vegan_restaurant' });
    expect(isDietaryTrusted(mk({ tag: 'vegan', verification_status: 'vegan_options' }))).toBe(true);
  });
  it('커버리지 체크도 계열 불일치 행으로 채워지지 않는다', () => {
    const idx = [mk({ tag: 'halal', verification_status: 'vegan_restaurant' })];
    expect(checkDietaryCoverage(idx, ['seoul'], ['halal']).ok).toBe(false);
  });
});

describe('복합 식이 행 — 명시 등급 하나는 한 계열만 보증', () => {
  it('halal+vegan 태그에 muslim_friendly 하나면 비건 증거 없음·행 전체 신뢰 안 함', () => {
    const row = mk({ tag: undefined, dietary_tags: ['halal', 'vegan'], verification_status: 'muslim_friendly' });
    expect(dietaryEvidenceFor(row, 'halal')).toMatchObject({ verification_status: 'muslim_friendly' });
    expect(dietaryEvidenceFor(row, 'vegan')).toBeNull();
    expect(isDietaryTrusted(row)).toBe(false);
  });
});

describe('실데이터 _food_index.json', () => {
  const rows: Array<Record<string, unknown>> = JSON.parse(
    readFileSync(resolve(process.cwd(), 'api/_food_index.json'), 'utf8'),
  );
  it('신뢰 등급 행은 전부 태그와 계열이 맞다', () => {
    const bad = rows.filter((r) => {
      const tag = String(r.tag || '').toLowerCase();
      const st = String(r.verification_status || '');
      return DIETARY_TAGS.includes(tag) && TRUSTED_DIETARY_STATUS.includes(st) && !statusMatchesTag(st, tag);
    }).map((r) => `${r.name}|${r.city}|${r.tag}|${r.verification_status}`);
    expect(bad).toEqual([]);
  });
  it('10/26 운영자 승인 격리 5곳은 unverified', () => {
    const keys = [
      '철판집|seoul', '러빙헛 카페|seoul', 'ONL(퍼멘츠)|seoul', '8피스 피자|seoul',
      'Everhalal - Halal Bulgogi near Everland|yongin',
    ];
    for (const k of keys) {
      const hit = rows.filter((r) => `${r.name}|${r.city}` === k);
      expect(hit.length, k).toBeGreaterThan(0);
      for (const r of hit) {
        expect(r.verification_status, k).toBe('unverified');
        expect(isDietaryTrusted(r), k).toBe(false);
      }
    }
  });
});
