/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Gemini 모킹 스캐폴딩 (course-share-api 패턴). */
/**
 * course-ai 트러스트 하드닝 잠금 (2026-08-24, planner-trust-course #3/#4/#5).
 *
 * 1. courseAiContract — fixed/window stop 은 anchor 로 원래 인덱스에 고정, malformed 는 400.
 * 2. courseCandidateCatalog — 주변 추천 identity 는 서버 카탈로그가 SSOT, 모델은 candidateId 만 선택.
 * 3. geminiModelResolver — course role 독립 ENV(GEMINI_COURSE_MODEL), usage 기록과 동일 모델.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildCourseAiContract, CourseAiContractError, mergeAnchoredOrder,
} from '../../api/_shared/courseAiContract.js';
import {
  describeCatalogCandidate, distanceKm, getCourseCandidateCatalogStatus, getCourseCandidates,
  isRecommendationGradeFood, rehydrateCandidates,
} from '../../api/_shared/courseCandidateCatalog.js';

describe('courseAiContract — anchor 분리/검증', () => {
  it('fixed/window stop 을 anchor 로, 나머지를 free 로 분리', () => {
    const { anchorIndexes, freeIds } = buildCourseAiContract([
      { id: 'a', title: 'A', lat: 1, lng: 1 },
      { id: 'b', title: 'B', timeConstraint: 'fixed', time: '09:00' },
      { id: 'c', title: 'C', lat: 2, lng: 2 },
    ]);
    expect([...anchorIndexes]).toEqual([1]);
    expect(freeIds).toEqual(['a', 'c']);
  });

  it('원본 stop 필드를 그대로 보존(메타데이터 불변)', () => {
    const { stops } = buildCourseAiContract([{ id: 'a', title: 'A', category: 'food', lat: 1, lng: 2 }]);
    expect(stops[0]).toMatchObject({ id: 'a', title: 'A', category: 'food', lat: 1, lng: 2 });
  });

  it.each([
    [[{ id: '', title: 'A' }], 'BAD_STOP_ID'],
    [[{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }], 'DUPLICATE_STOP_ID'],
    [[{ id: 'a', title: '  ' }], 'BAD_STOP_TITLE'],
    [[{ id: 'a', title: 'A', timeConstraint: 'nope' }], 'BAD_TIME_CONSTRAINT'],
    [[{ id: 'a', title: 'A', timeConstraint: 'fixed', time: '' }], 'BAD_TIME_CONSTRAINT'],
    [[{ id: 'a', title: 'A', timeConstraint: 'window', time: '09:00' }], 'BAD_WINDOW_END'],
    [[{ id: 'a', title: 'A', timeConstraint: 'window', time: '11:00', windowEnd: '09:00' }], 'BAD_WINDOW_END'],
    [[{ id: 'a', title: 'A', windowEnd: '09:00' }], 'BAD_WINDOW_END'],
    [[{ id: 'a', title: 'A', stayMinutes: 0 }], 'BAD_STAY_MINUTES'],
    [[], 'EMPTY_STOPS'],
  ])('malformed 입력 → CourseAiContractError(%2$s)', (rawStops, code) => {
    try {
      buildCourseAiContract(rawStops as any);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CourseAiContractError);
      expect((err as any).code).toBe(code);
    }
  });
});

describe('mergeAnchoredOrder — anchor 는 항상 원래 인덱스, free 만 재배치', () => {
  it('모델/폴백이 free id 순서를 뒤집어도 anchor 는 그대로', () => {
    const contract = buildCourseAiContract([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', timeConstraint: 'fixed', time: '09:00' }, // anchor, index 1
      { id: 'c', title: 'C' },
      { id: 'd', title: 'D' },
    ]);
    const order = mergeAnchoredOrder(contract, ['d', 'c', 'a']); // free 역순
    expect(order).toEqual(['d', 'b', 'c', 'a']); // b 는 인덱스 1 그대로
  });

  it('모델이 anchor 를 포함해 통째로 다시 섞어 반환해도, free 부분집합만 신호로 사용', () => {
    const contract = buildCourseAiContract([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', timeConstraint: 'fixed', time: '09:00' },
      { id: 'c', title: 'C' },
    ]);
    // 모델이 optimizedOrder 전체를 ['b','c','a'] 로 반환했다고 가정 —
    // 호출부는 free id 만 걸러 넘긴다: ['c','a']
    const order = mergeAnchoredOrder(contract, ['c', 'a']);
    expect(order).toEqual(['c', 'b', 'a']); // b 는 인덱스 1 그대로, free 는 주어진 순서대로
  });

  it('candidate 집합이 freeIds 와 다르면(중복/누락/미지 id) 원본 free 순서로 폴백', () => {
    const contract = buildCourseAiContract([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]);
    expect(mergeAnchoredOrder(contract, ['a', 'ghost'])).toEqual(['a', 'b']); // 미지 id 섞임 → 폴백
    expect(mergeAnchoredOrder(contract, ['a'])).toEqual(['a', 'b']); // 누락 → 폴백
    expect(mergeAnchoredOrder(contract, null)).toEqual(['a', 'b']); // 비배열 → 폴백
  });

  it('anchor 가 없으면 free 전체가 순서 그대로 반영', () => {
    const contract = buildCourseAiContract([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    expect(mergeAnchoredOrder(contract, ['b', 'a'])).toEqual(['b', 'a']);
  });
});

describe('courseCandidateCatalog — 서버 소유 identity (관광지 + 추천 등급 일반 식당)', () => {
  it('Vercel 함수 번들에 두 서버 카탈로그를 명시적으로 포함', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    expect(vercel.functions['api/course-ai.js']?.includeFiles)
      .toBe('api/{_attractions_index,_food_index}.json');
  });

  it('getCourseCandidates — 서울 좌표 근방에서 관광지와 식당을 함께 반환', () => {
    const candidates = getCourseCandidates({ lat: 37.5665, lng: 126.978, limit: 12 });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(candidates.some((c) => c.placeSource === 'cocotrip-attractions')).toBe(true);
    expect(candidates.some((c) => c.placeSource === 'cocotrip-food')).toBe(true);
    for (const c of candidates) {
      expect(['cocotrip-attractions', 'cocotrip-food']).toContain(c.placeSource);
      expect(c.candidateId).toBe(c.placeKey);
      expect(typeof c.lat).toBe('number');
    }
  });

  it('서버 카탈로그 두 파일이 실제로 로드됐을 때만 healthy', () => {
    const status = getCourseCandidateCatalogStatus();
    expect(status.healthy).toBe(true);
    expect(status.attractions).toBeGreaterThan(0);
    expect(status.food).toBeGreaterThan(2_000);
    expect(status.unavailable).toEqual([]);
  });

  it('여러 stop 코스는 평균점이 아니라 실제 stop 중 한 곳과 가까운 후보만 반환', () => {
    const origins = [
      { lat: 37.5796, lng: 126.9770 },
      { lat: 37.5133, lng: 127.1001 },
    ];
    const candidates = getCourseCandidates({ origins, limit: 12 });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const nearest = Math.min(...origins.map((origin) => (
        distanceKm(origin.lat, origin.lng, candidate.lat, candidate.lng)
      )));
      expect(nearest).toBeLessThanOrEqual(candidate.category === 'food' ? 5 : 20);
    }
  });

  it('식당 후보는 general + placeId + 평점/리뷰 하한을 통과한 서버 필드만 노출', () => {
    const food = getCourseCandidates({ lat: 37.5665, lng: 126.978, limit: 12 })
      .find((candidate) => candidate.category === 'food');
    expect(food).toBeDefined();
    expect(food?.candidateId).toMatch(/^food:/);
    expect(food?.placeSource).toBe('cocotrip-food');
    expect(food?.rating).toBeGreaterThanOrEqual(4.5);
    expect(food?.reviewCount).toBeGreaterThanOrEqual(20);
    expect(food).not.toHaveProperty('tag');
    expect(food).not.toHaveProperty('verification_status');
  });

  it('general 태그가 잘못 붙어도 이름·분류에 식이 표현이 있으면 후보에서 제외', () => {
    const rows = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_food_index.json'), 'utf8'));
    const eligible = rows.filter(isRecommendationGradeFood);
    expect(eligible.length).toBeGreaterThan(2_000);
    expect(eligible).toHaveLength(2_064);
  });

  it.each([
    { nameEn: 'Muslim-friendly Seoul' },
    { nameEn: 'Plant-based Seoul' },
    { nameEn: 'Kosher Seoul' },
    { name: '알레르기 프리 식당' },
    { cuisineKo: '무슬림 친화 식당' },
    { dietary_claim: 'vegan options' },
    { certification_type: 'halal-certified' },
    { nameEn: 'Pork-free Seoul' },
    { nameEn: 'Pescatarian Seoul' },
    { nameEn: 'Lactose-free Cafe' },
    { nameEn: 'Islamic-friendly Seoul' },
    { nameEn: 'Jain Restaurant' },
    { nameEn: 'Keto Cafe' },
    { nameEn: 'Shellfish-free dining' },
    { name: '이슬람 친화 식당' },
    { name: '저탄고지 식당' },
  ])('향후 DB 갱신에서 식이·인증 표현 $nameEn$name$cuisineKo$dietary_claim$certification_type 을 fail-closed 제외', (claim) => {
    expect(isRecommendationGradeFood({
      tag: 'general', placeId: 'place-id', name: '일반 식당',
      lat: 37.5, lng: 127, rating: 4.8, reviewCount: 100,
      ...claim,
    })).toBe(false);
  });

  it.each([
    { name: '프리윌피자' },
    { name: '현선이네 프리미엄' },
    { name: '카프리 디 마리' },
    { name: '르프리크' },
    { nameEn: 'Eco-friendly Grocerant' },
  ])('식이 대상어 없는 일반 상호 $name$nameEn 은 잘못 제외하지 않음', (ordinaryName) => {
    expect(isRecommendationGradeFood({
      tag: 'general', placeId: 'place-id', name: '일반 식당',
      lat: 37.5, lng: 127, rating: 4.8, reviewCount: 100,
      ...ordinaryName,
    })).toBe(true);
  });

  it('관광지 설명도 모델 문구가 아니라 카탈로그 출처 사실로 고정', () => {
    const sight = getCourseCandidates({ lat: 37.5665, lng: 126.978, limit: 12 })
      .find((candidate) => candidate.category === 'sight');
    expect(describeCatalogCandidate(sight, 'ko')).toBe('코코트립 장소 자료에 등록된 곳');
  });

  it('이미 선택된 stop 을 placeKey 로 제외', () => {
    const withoutExclusion = getCourseCandidates({ lat: 37.524, lng: 126.9806, limit: 3 });
    const first = withoutExclusion[0];
    const withExclusion = getCourseCandidates({
      lat: 37.524, lng: 126.9806, limit: 3,
      excludeStops: [{ placeKey: first.candidateId, placeSource: first.placeSource }],
    });
    expect(withExclusion.find((c) => c.candidateId === first.candidateId)).toBeUndefined();
  });

  it('이미 선택된 stop 을 근접 좌표(≈100m 이내)로도 제외', () => {
    const base = getCourseCandidates({ lat: 37.524, lng: 126.9806, limit: 1 })[0];
    const withExclusion = getCourseCandidates({
      lat: 37.524, lng: 126.9806, limit: 3,
      excludeStops: [{ lat: base.lat, lng: base.lng }],
    });
    expect(withExclusion.find((c) => c.candidateId === base.candidateId)).toBeUndefined();
  });

  it('rehydrateCandidates — 카탈로그에 없는/변조된 id 는 조용히 버림, 유효 id 만 서버값으로 복원', () => {
    const real = getCourseCandidates({ lat: 37.5665, lng: 126.978, limit: 1 })[0];
    const out = rehydrateCandidates([real.candidateId, 'totally-made-up-id', ''], 'en');
    expect(out).toHaveLength(1);
    expect(out[0].candidateId).toBe(real.candidateId);
    expect(out[0].name).toBe(real.name);
    expect(out[0].lat).toBe(real.lat);
  });

  it('rehydrateCandidates — 전부 미지 id 면 빈 배열(대체 추측 금지)', () => {
    expect(rehydrateCandidates(['nope-1', 'nope-2'], 'en')).toEqual([]);
    expect(rehydrateCandidates(undefined as any, 'en')).toEqual([]);
  });

  it('rehydrateCandidates — 모델이 이름/좌표를 같이 보내도 서버 값만 사용(신뢰 안 함)', () => {
    const real = getCourseCandidates({ lat: 37.5665, lng: 126.978, limit: 1 })[0];
    // rehydrateCandidates 는 id 문자열만 받으므로 모델이 name/lat/lng 를 얹어 보내도 애초에 입력 형태가 아님 —
    // candidateId 만 신호로 쓴다는 계약을 그대로 확인.
    const out = rehydrateCandidates([real.candidateId], 'ko');
    expect(out[0].name).not.toBe(''); // 서버 로컬라이즈 이름
    expect(out[0].lat).toBe(real.lat);
  });
});

// ── /api/course-ai 핸들러 — 실제 요청/응답 (Gemini/entitlement/rate-limit 모킹, 외부호출 0) ──

const geminiMock = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: (...a: any[]) => geminiMock(...a) }; }
  },
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
const rateLimitMock = vi.fn();
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => rateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));
const entitlementMock = vi.fn();
vi.mock('../../api/_shared/ai-entitlement.js', () => ({
  verifyUidFromAuthHeader: async () => 'uid-1',
  hasAiFeatureEntitlement: (...a: any[]) => entitlementMock(...a),
}));

const { default: handler } = await import('../../api/course-ai.js');

function mockRes() {
  const r: any = { headers: null, status: 0, body: '' };
  r.writeHead = (s: number, h: any) => { r.status = s; r.headers = h; };
  r.end = (b?: string) => { r.body = b || ''; return r; };
  return r;
}
const parse = (r: any) => JSON.parse(r.body || '{}');
const req = (stops: any[], extra: Record<string, unknown> = {}) => ({
  method: 'POST', headers: { authorization: 'Bearer t' }, body: { stops, ...extra },
} as any);

beforeEach(() => {
  geminiMock.mockReset();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ ok: true });
  entitlementMock.mockReset();
  entitlementMock.mockResolvedValue(true);
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_COURSE_MODEL;
  delete process.env.GEMINI_MODEL_OVERRIDE;
});
afterEach(() => { vi.unstubAllEnvs(); });

const STOPS = [
  { id: 'a', title: 'A', category: 'sight', lat: 37.55, lng: 126.99 },
  { id: 'b', title: 'B', category: 'sight', timeConstraint: 'fixed', time: '09:00', lat: 37.52, lng: 126.98 },
  { id: 'c', title: 'C', category: 'sight', lat: 37.58, lng: 126.97 },
];
const offeredForStops = (lang: 'ko' | 'en' | 'ja' | 'zh' = 'en') => getCourseCandidates({
  origins: STOPS.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
  excludeStops: STOPS,
  lang,
  limit: 12,
});

describe('/api/course-ai — anchor 계약 위반은 Gemini 호출 전에 400', () => {
  it('fixed 인데 time 없음 → 400, Gemini 미호출, 자격 확인도 전에 거부', async () => {
    entitlementMock.mockResolvedValue(false); // 자격이 없어도 계약 위반이 먼저 걸려야 함
    const res = mockRes();
    await handler(req([{ id: 'a', title: 'A' }, { id: 'b', title: 'B', timeConstraint: 'fixed', time: '' }]), res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_TIME_CONSTRAINT');
    expect(geminiMock).not.toHaveBeenCalled();
  });
});

describe('/api/course-ai — 키 없음(nn 폴백) 은 anchor 를 원래 인덱스로 유지', () => {
  it('optimizedOrder[1] 은 항상 anchor(b)', async () => {
    const res = mockRes();
    await handler(req(STOPS), res);
    expect(res.status).toBe(200);
    const j = parse(res);
    expect(j.source).toBe('nn');
    expect(j.optimizedOrder[1]).toBe('b');
    expect(new Set(j.optimizedOrder)).toEqual(new Set(['a', 'b', 'c']));
    expect(j.nearby.length).toBeGreaterThan(0);
    expect(j.nearbySource).toBe('cocotrip_catalog');
    expect(j.nearby.some((candidate: any) => candidate.category === 'food')).toBe(true);
    expect(j.catalogAvailable).toBe(true);
    expect(j.nearbySelectionSource).toBe('catalog');
    expect(j.nearby.every((candidate: any) => candidate.selectionSource === 'catalog')).toBe(true);
  });
});

describe('/api/course-ai — Gemini 성공 경로: anchor 강제 + candidateId 만 신뢰', () => {
  it('모델이 anchor 를 다른 자리로 옮기려 해도 서버가 원래 인덱스로 되돌림', async () => {
    process.env.GEMINI_API_KEY = 'k';
    geminiMock.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ optimizedOrder: ['b', 'a', 'c'], nearby: [] }), // b 를 맨 앞으로
      },
    });
    const res = mockRes();
    await handler(req(STOPS), res);
    const j = parse(res);
    expect(j.source).toBe('ai');
    expect(j.optimizedOrder[1]).toBe('b'); // anchor 는 인덱스 1 그대로
  });

  it('모델이 카탈로그에 없는 candidateId 를 반환하면 버리고 서버 폴백 후보만 반환', async () => {
    process.env.GEMINI_API_KEY = 'k';
    geminiMock.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          optimizedOrder: ['a', 'b', 'c'],
          nearby: [{ candidateId: 'totally-made-up', name: 'Fake Place', lat: 0, lng: 0, reason: 'trust me' }],
        }),
      },
    });
    const res = mockRes();
    await handler(req(STOPS), res);
    const j = parse(res);
    expect(j.nearby.length).toBeGreaterThan(0);
    expect(j.nearby.find((candidate: any) => candidate.candidateId === 'totally-made-up')).toBeUndefined();
    expect(j.nearby.find((candidate: any) => candidate.name === 'Fake Place')).toBeUndefined();
    expect(j.source).toBe('ai');
    expect(j.nearbySelectionSource).toBe('catalog');
    expect(j.nearby.every((candidate: any) => candidate.selectionSource === 'catalog')).toBe(true);
  });

  it('모델이 유효 candidateId 를 고르면 서버 카탈로그 값(name/lat/lng)으로 복원', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const real = offeredForStops()
      .find((candidate) => candidate.category === 'sight')!;
    geminiMock.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          optimizedOrder: ['a', 'b', 'c'],
          nearby: [{ candidateId: real.candidateId, name: 'model-lied-name', lat: 999, lng: 999, reason: '근처 명소' }],
        }),
      },
    });
    const res = mockRes();
    await handler(req(STOPS), res);
    const j = parse(res);
    expect(j.nearby.length).toBeGreaterThanOrEqual(3); // 모델 1개 + 서버 카탈로그 최소 보강
    expect(j.nearby[0].candidateId).toBe(real.candidateId);
    expect(j.nearby[0].name).toBe(real.name); // 모델이 준 이름이 아니라 서버 값
    expect(j.nearby[0].lat).toBe(real.lat);
    expect(j.nearby[0].reason).toBe('Listed in CocoTrip local place data');
    expect(j.nearbySelectionSource).toBe('mixed');
    expect(j.nearby[0].selectionSource).toBe('ai');
    expect(j.nearby.slice(1).every((candidate: any) => candidate.selectionSource === 'catalog')).toBe(true);
  });

  it('식당 이유는 모델의 식이 주장을 버리고 DB 평점·리뷰 문구로 고정', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const food = offeredForStops('en')
      .find((candidate) => candidate.category === 'food')!;
    geminiMock.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          optimizedOrder: ['a', 'b', 'c'],
          nearby: [{ candidateId: food.candidateId, reason: 'Certified halal and always open' }],
        }),
      },
    });
    const res = mockRes();
    await handler(req(STOPS, { lang: 'en' }), res);
    const picked = parse(res).nearby.find((candidate: any) => candidate.candidateId === food.candidateId);
    expect(picked).toBeDefined();
    expect(picked.reason).toMatch(/^At collection:/);
    expect(picked.reason.toLowerCase()).not.toContain('halal');
    expect(picked.reason.toLowerCase()).not.toContain('open');
  });

  it('전체 카탈로그에는 있어도 이번 요청 후보로 제시되지 않은 id 는 거부', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const farAway = getCourseCandidates({ lat: 35.1796, lng: 129.0756, limit: 12 })[0];
    geminiMock.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          optimizedOrder: ['a', 'b', 'c'],
          nearby: [{ candidateId: farAway.candidateId, reason: 'Use a real but far-away id' }],
        }),
      },
    });
    const res = mockRes();
    await handler(req(STOPS), res);
    expect(parse(res).nearby.find((candidate: any) => candidate.candidateId === farAway.candidateId)).toBeUndefined();
  });
});

describe('/api/course-ai — geminiModelResolver course role', () => {
  it('GEMINI_COURSE_MODEL 이 usage 기록과 실제 호출에 동일하게 반영', async () => {
    process.env.GEMINI_API_KEY = 'k';
    process.env.GEMINI_COURSE_MODEL = 'gemini-course-test-model';
    let capturedModel = '';
    const genAiModule = await import('@google/generative-ai');
    const spy = vi.spyOn(genAiModule.GoogleGenerativeAI.prototype, 'getGenerativeModel')
      .mockImplementation(function (this: any, opts: any) {
        capturedModel = opts.model;
        return { generateContent: () => Promise.resolve({ response: { text: () => JSON.stringify({ optimizedOrder: ['a', 'b', 'c'], nearby: [] }) } }) };
      });
    const res = mockRes();
    await handler(req(STOPS), res);
    expect(res.status).toBe(200);
    expect(capturedModel).toBe('gemini-course-test-model');
    spy.mockRestore();
  });
});
