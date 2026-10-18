/**
 * 2026-10-10 — 식이 요청이 없는 플랜에서도 DB 가 뒷받침하지 않는 AI 식이 주장은 남지 않는다.
 *
 * 배경: 식이 요청이 있으면 종단 게이트가 막지만, 요청이 없으면 게이트가 no-op 이라
 * Gemini 가 써 온 `dietary_tags:["halal"]`·"Halal certified!" 문구가 그대로 손님에게 갔다.
 * applyDBMatcher(식이 요청 유무와 무관하게 항상 도는 마지막 mutation)가 정리한다.
 *
 *  - dietary_tags = 매칭된 같은 도시 trusted row 가 증거를 낸 태그만 (AI 태그 폐기)
 *  - 인증 문구("certified", "100% halal", "할랄 인증" …) = DB 등급이 certified 일 때만 유지,
 *    친화 등급·미지 출처·미매칭이면 그 문장만 삭제. 정직 등급 문구(부정형)는 보존.
 *  - verified 는 기존 의미(=DB 에 실재) 유지 — AGENTS.md §1-4. 식이 안전 판정과 무관.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async () => ({ ok: true, alerted: false })),
}));

import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';
import { validateResponse } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';
import { describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';

type Row = Record<string, unknown>;
type Stop = Record<string, unknown>;

// 합성 fixture — 실제 인덱스 값 아님.
const UNKNOWN_SRC: Row = {
  name: '합성미지출처할랄', nameEn: 'Synthetic Unknown Halal', city: 'seoul', tag: 'halal',
  source: 'trend_harness_promoted', address: '서울특별시 용산구 합성로 10', lat: 37.533, lng: 126.997,
};
const FRIENDLY: Row = {
  name: '합성친화할랄', nameEn: 'Synthetic Friendly Halal', city: 'seoul', tag: 'halal',
  address: '서울특별시 용산구 합성로 100', lat: 37.5345, lng: 126.9946, rating: 4.6, reviewCount: 900,
};
const CERTIFIED: Row = {
  name: '합성인증할랄', nameEn: 'Synthetic Certified Halal', city: 'seoul', tag: 'halal',
  verification_status: 'halal_certified', address: '서울특별시 용산구 합성로 200', lat: 37.535, lng: 126.995,
};
const GENERAL: Row = {
  name: '합성불고기', nameEn: 'Synthetic Bulgogi', city: 'seoul', tag: 'general',
  address: '서울특별시 용산구 합성로 50', lat: 37.534, lng: 126.99,
};
const VEGAN_OPTIONS: Row = {
  name: '합성비건옵션', nameEn: 'Synthetic Vegan Options', city: 'seoul', tag: 'vegan',
  address: '서울특별시 종로구 합성로 7', lat: 37.57, lng: 126.98,
};
const FI = [UNKNOWN_SRC, FRIENDLY, CERTIFIED, GENERAL, VEGAN_OPTIONS];

const CLAIM = /certified|100\s*%\s*halal|할랄\s*인증(?!은 확인되지)/i;

function food(name: string, extras: Stop = {}): Stop {
  return { category: 'food', name, ...extras };
}
function plan(stops: Stop[]) {
  return { days: [{ day: 1, city: 'seoul', stops: [{ name: 'Hotel', category: 'lodging' }, ...stops] }] };
}
const count = (s: unknown, n: string) => String(s || '').split(n).length - 1;

describe('1. 식이 요청 없음 + DB 가 뒷받침 안 하는 AI 할랄 주장 → 제거', () => {
  it('미지 출처 row 에 매칭돼도 AI 태그·인증 문장은 사라지고 나머지 문장은 남는다', () => {
    const stop = food('합성미지출처할랄', {
      verified: true, dietary_tags: ['halal'],
      tip: 'Great bulgogi. Halal certified!', tip_en: '100% halal menu.',
      reason: 'Halal-certified kitchen near Itaewon.',
    });
    const it0 = plan([stop]);
    applyDBMatcher(it0, FI, 'seoul', 'en');
    expect(stop.dietary_tags).toBeUndefined();
    expect(stop.dietary_evidence).toBeUndefined();
    expect(stop.tip).toBe('Great bulgogi.');
    for (const f of ['tip', 'tip_en', 'reason']) expect(String(stop[f] || ''), f).not.toMatch(CLAIM);
    // verified 는 "DB 에 실재" 의미 그대로 (식이 인증 아님 — AGENTS.md §1-4)
    expect(stop.verified).toBe(true);
    // 식이 요청 없음 → 게이트 no-op 이어도 손님에게 갈 주장은 이미 없다
    expect(runFinalItineraryValidation(it0, { language: 'en', dietary: [], foodIndex: FI }).ok).toBe(true);
  });

  it('DB 에 없는 식당(미매칭)의 AI 할랄/비건 태그와 한국어 인증 문구도 제거', () => {
    const stop = food('합성 미등록 식당', { dietary_tags: ['halal', 'vegan'], tip: '할랄 인증 식당입니다. 국물이 진합니다.' });
    applyDBMatcher(plan([stop]), FI, 'seoul', 'ko');
    expect(stop.dietary_tags).toBeUndefined();
    expect(stop.tip).toBe('국물이 진합니다.');
    expect(stop.verified).toBe(false);
  });

  it('일반 식당(general row) 의 AI halal 태그도 제거', () => {
    const stop = food('합성불고기', { dietary_tags: ['halal'], tip: 'Tasty.' });
    applyDBMatcher(plan([stop]), FI, 'seoul', 'en');
    expect(stop.dietary_tags).toBeUndefined();
    expect(stop.tip).toBe('Tasty.');
  });
});

describe('2. DB trusted row → 태그는 증거와 함께 유지', () => {
  it('halal_certified row: 태그·증거·인증 문구 유지 + 정직 문구 1회', () => {
    const stop = food('합성인증할랄', { tip: 'Halal certified kitchen.' });
    const it0 = plan([stop]);
    applyDBMatcher(it0, FI, 'seoul', 'en');
    applyDBMatcher(it0, FI, 'seoul', 'en');
    expect(stop.dietary_tags).toEqual(['halal']);
    expect(stop.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }]);
    expect(String(stop.tip)).toContain('Halal certified kitchen.');
    expect(count(stop.tip, describeDietaryEvidence('halal_certified', 'en'))).toBe(1);
  });

  it('muslim_friendly row: 태그·증거 유지, 과장 인증 문장만 삭제, AI 가 덧붙인 vegan 태그 폐기', () => {
    const stop = food('합성친화할랄', { dietary_tags: ['halal', 'vegan'], tip: 'Halal certified! Try the lamb.' });
    applyDBMatcher(plan([stop]), FI, 'seoul', 'en');
    expect(stop.dietary_tags).toEqual(['halal']);
    expect(stop.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(String(stop.tip)).not.toMatch(/Halal certified!/);
    expect(String(stop.tip)).toContain('Try the lamb.');
    expect(count(stop.tip, describeDietaryEvidence('muslim_friendly', 'en'))).toBe(1);
  });

  it.each(['ko', 'en', 'ja', 'zh'].flatMap((l) => [[l, '합성친화할랄', 'muslim_friendly'], [l, '합성비건옵션', 'vegan_options']]))(
    '정직 등급 문구(%s, %s)는 반복 실행에도 지워지거나 중복되지 않는다', (lang, name, status) => {
    const stop = food(name, { tip: 'Nice.' });
    const it0 = plan([stop]);
    applyDBMatcher(it0, FI, 'seoul', lang);
    applyDBMatcher(it0, FI, 'seoul', lang);
    applyDBMatcher(it0, FI, 'seoul', lang);
    expect(count(stop.tip, describeDietaryEvidence(status, lang))).toBe(1);
  });
});

describe('3. 식이 요청 경로 — 기존 동작 유지', () => {
  it('Halal 요청: 교체 → 매처 2회 → 게이트 통과, 증거·문구 1회', () => {
    const dietary = ['Halal'];
    const stop = food('합성불고기', { lat: 37.534, lng: 126.99, tip: 'Great pork belly.' });
    const it0 = plan([stop]);
    const rep = replaceViolatingFoodStops(it0, validateResponse(it0, { lang: 'en', dietary }, FI), FI, dietary, 'seoul', 'en');
    expect(rep.replaced).toBe(1);
    applyDBMatcher(it0, FI, 'seoul', 'en');
    applyDBMatcher(it0, FI, 'seoul', 'en');
    expect(stop.name).toBe('합성친화할랄'); // 평점 최고 trusted 후보
    expect(stop.dietary_tags).toEqual(['halal']);
    expect((stop.dietary_evidence as unknown[]).length).toBe(1);
    expect(runFinalItineraryValidation(it0, { language: 'en', dietary, foodIndex: FI }).ok).toBe(true);
  });

  it('Halal 요청 + 미지 출처 row: 게이트는 여전히 DIETARY_VIOLATION', () => {
    const dietary = ['Halal'];
    const it0 = plan([food('합성미지출처할랄', { verified: true, dietary_tags: ['halal'], tip: 'Halal certified!' })]);
    applyDBMatcher(it0, FI, 'seoul', 'en');
    const gate = runFinalItineraryValidation(it0, { language: 'en', dietary, foodIndex: FI });
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe('DIETARY_VIOLATION');
  });
});
