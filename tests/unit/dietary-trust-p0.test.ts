/**
 * 식단 안전 데이터 신뢰 P0 (2026-07-11 운영자 지시 3단계) — 회귀 가드.
 *
 * 불변식:
 *   1. naver_local/ai_curated dietary 태그 = unverified — 매칭·전파·검증 증거 금지
 *   2. 실데이터(_food_index.json): 의심 3건(생선회 vegan·화장품 vegan·치킨 halal) 격리 유지
 *   3. 커버리지 사전 체크 — 검증 후보 0 도시 = missing (완화 금지)
 *   4. 결정론적 교체 — trusted 후보로만, 부족 시 이름 생성 없이 실패 반환
 *   5. 알림 test/customer 분리 — [TEST] 라벨
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deriveVerificationStatus, isDietaryTrusted, checkDietaryCoverage,
} from '../../api/_shared/dietary-trust.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';

const mk = (over: Record<string, unknown> = {}) => ({
  name: '테스트식당', city: 'seoul', tag: 'halal', lat: 37.5, lng: 127.0,
  rating: 4.7, reviewCount: 100, placeId: 'x', ...over,
});

describe('deriveVerificationStatus / isDietaryTrusted', () => {
  it('naver_local·ai_curated dietary → unverified (매칭 금지)', () => {
    expect(deriveVerificationStatus(mk({ source: 'naver_local' }))).toBe('unverified');
    expect(deriveVerificationStatus(mk({ source: 'ai_curated_2026_05_21', tag: 'vegan' }))).toBe('unverified');
    expect(isDietaryTrusted(mk({ source: 'naver_local' }))).toBe(false);
  });

  it('google places 기반 → muslim_friendly / vegan_options (매칭 허용, 인증 아님)', () => {
    expect(deriveVerificationStatus(mk({}))).toBe('muslim_friendly');
    expect(deriveVerificationStatus(mk({ tag: 'vegan' }))).toBe('vegan_options');
    expect(isDietaryTrusted(mk({}))).toBe(true);
  });

  it('운영자 수동 승격(halal_certified)은 보존', () => {
    expect(deriveVerificationStatus(mk({ verification_status: 'halal_certified', source: 'naver_local' }))).toBe('halal_certified');
  });

  it('general 레코드는 신뢰 문제 없음 (true)', () => {
    expect(isDietaryTrusted(mk({ tag: 'general', source: 'naver_local' }))).toBe(true);
  });

  it('verification_status 없는 옛 레코드 — 소스로 fail-safe 파생', () => {
    const legacy = mk({ source: 'naver_local' });
    delete (legacy as Record<string, unknown>).verification_status;
    expect(isDietaryTrusted(legacy)).toBe(false);
  });
});

describe('실데이터 가드 — api/_food_index.json', () => {
  const index = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_food_index.json'), 'utf8'));

  it('운영자 제보 3건(생선회 vegan·화장품 vegan·치킨 halal) 전부 unverified 격리', () => {
    const suspects = index.filter((r: { name?: string }) =>
      r.name === '덕양수산' || r.name === '가족' || (r.name || '').includes('홀리카홀리카'));
    // '가족' 은 동명 general 식당 존재 — dietary 태그인 것만 검사
    const dietary = suspects.filter((r: { tag?: string }) => ['halal', 'vegan', 'vegetarian'].includes(r.tag || ''));
    expect(dietary.length).toBeGreaterThanOrEqual(3);
    for (const r of dietary) expect(r.verification_status).toBe('unverified');
  });

  it('dietary 태그 전 레코드에 verification_status 존재 + naver/ai_curated 는 전부 unverified', () => {
    const dietary = index.filter((r: { tag?: string }) => ['halal', 'vegan', 'vegetarian'].includes(r.tag || ''));
    expect(dietary.length).toBeGreaterThan(0);
    for (const r of dietary) {
      expect(r.verification_status, `${r.name} 등급 누락`).toBeTypeOf('string');
      if (['naver_local', 'ai_curated_2026_05_21'].includes(r.source)) {
        // 2026-07-12: 운영자 검증 승격(verified_overrides.json — verified_by+source_url 필수)만 예외
        if (r.verified_by && r.source_url) {
          expect(['halal_certified', 'muslim_friendly', 'vegan_restaurant', 'vegan_options'],
            `${r.name} 승격 등급 이상`).toContain(r.verification_status);
        } else {
          expect(r.verification_status, `${r.name} 격리 누락`).toBe('unverified');
        }
      }
    }
  });

  it('서울·부산 halal/vegan 은 trusted 후보 존재 (주력 시장 커버리지 유지)', () => {
    for (const city of ['seoul', 'busan']) {
      for (const diet of ['halal', 'vegan']) {
        const cov = checkDietaryCoverage(index, [city], [diet]);
        expect(cov.ok, `${city}:${diet} 커버리지 소실`).toBe(true);
      }
    }
  });
});

describe('checkDietaryCoverage — 사전 커버리지', () => {
  const idx = [
    mk({ city: 'seoul', tag: 'halal' }),                              // trusted
    mk({ city: 'jeju', tag: 'halal', source: 'naver_local' }),        // unverified
    mk({ city: 'seoul', tag: 'vegan' }),
  ];

  it('trusted 후보 있는 도시 = ok', () => {
    expect(checkDietaryCoverage(idx, ['seoul'], ['Halal']).ok).toBe(true);
  });

  it('unverified 뿐인 도시 = missing (완화 금지)', () => {
    const cov = checkDietaryCoverage(idx, ['jeju'], ['Halal']);
    expect(cov.ok).toBe(false);
    expect(cov.missing).toEqual([{ city: 'jeju', diet: 'halal' }]);
  });

  it('dietary 요청 없으면 항상 ok', () => {
    expect(checkDietaryCoverage(idx, ['jeju'], []).ok).toBe(true);
    expect(checkDietaryCoverage(idx, ['jeju'], ['Meat', 'Spicy']).ok).toBe(true);
  });

  it('vegetarian 요청은 vegan 식당으로 커버 가능', () => {
    expect(checkDietaryCoverage(idx, ['seoul'], ['Vegetarian']).ok).toBe(true);
  });
});

describe('replaceViolatingFoodStops — 결정론적 교체', () => {
  const plan = () => ({
    days: [{
      day: 1,
      stops: [
        { name: '위반식당', display_name: 'Bad Place', category: 'food', lat: 37.5, lng: 127.0, tip: 'x' },
        { name: '경복궁', category: 'sightseeing' },
      ],
    }],
  });
  const violation = [{ type: 'dietary_violation', severity: 'critical', stop: '위반식당', diet: 'halal', category: 'food' }];

  it('trusted 후보로 교체 + verified/dietary_tags/좌표 반영, tip 에 시간 확언 없음', () => {
    const it0 = plan();
    const idx = [mk({ name: '할랄식당', nameEn: 'Halal House', lat: 37.51, lng: 127.01, googleMapsUrl: 'https://maps.google.com/x' })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'seoul');
    expect(r.replaced).toBe(1);
    const s = it0.days[0].stops[0];
    expect(s.name).toBe('할랄식당');
    expect(s.verified).toBe(true);
    expect(s.dietary_tags).toContain('halal');
    expect(s.tip).toMatch(/confirm opening hours/i); // 영업시간 데이터 없음 — 확언 금지
  });

  it('unverified 후보뿐이면 교체하지 않고 failed (이름 생성·완화 금지)', () => {
    const it0 = plan();
    const idx = [mk({ name: '가짜할랄', source: 'naver_local', lat: 37.5, lng: 127.0 })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'seoul');
    expect(r.replaced).toBe(0);
    expect(r.failed).toBe(1);
    expect(it0.days[0].stops[0].name).toBe('위반식당'); // 원본 유지 → caller retry→throw
  });

  it('플랜에 이미 있는 식당은 교체 후보에서 제외', () => {
    const it0 = plan();
    it0.days[0].stops.push({ name: '할랄식당', category: 'food' });
    const idx = [mk({ name: '할랄식당', lat: 37.5, lng: 127.0 })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'seoul');
    expect(r.replaced).toBe(0);
  });

  it('8km 밖 후보는 제외 (동선 보존)', () => {
    const it0 = plan();
    const idx = [mk({ name: '부산할랄', city: 'busan', lat: 35.1, lng: 129.0 })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'seoul');
    expect(r.replaced).toBe(0);
  });
});

describe('sendErrorAlert — test/customer 분리 (3단계-A)', () => {
  it('[TEST] 라벨 + origin 필드, 하위호환(funcName, error) 유지', async () => {
    const sent: string[] = [];
    vi.resetModules();
    vi.doMock('../../api/_shared/notify.js', () => ({
      notify: (_ch: string, text: string) => { sent.push(text); return Promise.resolve({ ok: true }); },
    }));
    const { sendErrorAlert } = await import('../../api/_telegram.js');

    await sendErrorAlert({ title: 'dietary_violation persisted', testOrigin: true, context: { mode: '3pass', city: 'jeju', dietary: 'halal' } });
    expect(sent[0]).toContain('[TEST]');
    expect(sent[0]).toContain('origin: test');
    expect(sent[0]).toContain('고객 영향 없음');

    await sendErrorAlert({ title: 'dietary_violation persisted', testOrigin: false, context: { dietary: 'vegan' } });
    expect(sent[1]).not.toContain('[TEST]');
    expect(sent[1]).toContain('origin: customer');

    await sendErrorAlert('someFunc', new Error('boom'));
    expect(sent[2]).toContain('someFunc');
    expect(sent[2]).toContain('boom');
    vi.doUnmock('../../api/_shared/notify.js');
  });
});
