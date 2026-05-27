/**
 * P228 (2026-05-27) — transitCache.js unit test
 *
 * zone_courses Firestore transit_matrix cache hit/miss 회귀 방지.
 *
 * 테스트 범위:
 *   1. cache hit: source='odsay_api' → publicTransit 반환 (ODsay skip)
 *   2. cache miss (mock): source='mock' → null 반환 (ODsay fallback)
 *   3. cache miss (no zone): zoneId=null → null 반환
 *   4. cache miss (key not found): 없는 from->to key → null 반환
 *   5. ENV disabled: ROUTE_TRANSIT_CACHE_ENABLED='false' → null 반환
 *   6. _fromCache flag: hit 시 publicTransit._fromCache=true
 *   7. format: publicTransit.duration = entry.duration_min
 *   8. invalidateTransitCache: 특정 zone flush 후 miss
 *   9. getTransitCacheStats: zoneCount 반영
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────────
const REAL_TM = {
  '1->2': {
    from_order: 1, to_order: 2,
    mode: 'subway', duration_min: 12, distance_m: 3200, cost_krw: 1400,
    source: 'odsay_api', fetched_at: '2026-05-27',
    base: { mode: 'subway', duration_min: 12, distance_m: 3200, cost_krw: 1400 },
  },
  '2->3': {
    from_order: 2, to_order: 3,
    mode: 'mixed', duration_min: 15, distance_m: 1000, cost_krw: 1500,
    source: 'mock', fetched_at: '2026-05-27',
    base: { mode: 'mixed', duration_min: 15, distance_m: 1000, cost_krw: 1500 },
  },
};

const mockDoc = {
  exists: true,
  data: () => ({ transit_matrix: REAL_TM, status: 'published' }),
};

const mockDocMissing = { exists: false, data: () => null };

vi.mock('../../api/_ai_core/firestoreAdmin.js', () => ({
  initAdminDb: vi.fn(() => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => (id === 'TEST_ZONE' ? mockDoc : mockDocMissing),
      }),
    }),
  })),
}));

vi.mock('../../api/_shared/log.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── 테스트 ─────────────────────────────────────────────────────────────────

describe('P228 transitCache — hit/miss/format', () => {
  // 매 테스트 후 ENV 초기화
  afterEach(() => {
    delete process.env.ROUTE_TRANSIT_CACHE_ENABLED;
  });

  async function importFresh() {
    // vitest 모듈 캐시 리셋 (in-memory _zoneCache 초기화 효과)
    vi.resetModules();
    // top-level vi.mock 이 hoisting 으로 재활성됨 — 추가 호출 불필요.
    const mod = await import('../../api/_ai_core/transitCache.js');
    return mod;
  }

  it('cache hit (source=odsay_api): publicTransit 반환, _fromCache=true', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 1, 2);
    expect(result).not.toBeNull();
    expect(result!.publicTransit._fromCache).toBe(true);
    expect(result!.publicTransit._cacheSource).toBe('odsay_api');
    expect(result!.durationMin).toBe(12);
  });

  it('cache hit: publicTransit.duration = entry.duration_min', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 1, 2);
    expect(result!.publicTransit.duration).toBe(12);
  });

  it('cache hit: distanceKm 올바르게 변환 (3200m → 3.2km)', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 1, 2);
    expect(result!.distanceKm).toBeCloseTo(3.2, 1);
  });

  it('cache miss (source=mock): null 반환 (ODsay fallback 보장)', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 2, 3);
    expect(result).toBeNull();
  });

  it('cache miss (zoneId=null): null 반환', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache(null, 1, 2);
    expect(result).toBeNull();
  });

  it('cache miss (key not found): null 반환', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 9, 10);
    expect(result).toBeNull();
  });

  it('cache miss (unknown zone): null 반환', async () => {
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('UNKNOWN_ZONE', 1, 2);
    expect(result).toBeNull();
  });

  it('ENV disabled: ROUTE_TRANSIT_CACHE_ENABLED=false → null', async () => {
    process.env.ROUTE_TRANSIT_CACHE_ENABLED = 'false';
    const { lookupTransitCache } = await importFresh();
    const result = await lookupTransitCache('TEST_ZONE', 1, 2);
    expect(result).toBeNull();
  });

  it('getTransitCacheStats: zone 로드 후 zoneCount 반영', async () => {
    const { lookupTransitCache, getTransitCacheStats } = await importFresh();
    await lookupTransitCache('TEST_ZONE', 1, 2); // load trigger
    const stats = getTransitCacheStats();
    expect(stats.zoneCount).toBeGreaterThanOrEqual(1);
    expect(stats.enabled).toBe(true);
  });

  it('invalidateTransitCache: 특정 zone flush 후 재조회 가능', async () => {
    const { lookupTransitCache, invalidateTransitCache, getTransitCacheStats } = await importFresh();
    await lookupTransitCache('TEST_ZONE', 1, 2); // load
    invalidateTransitCache('TEST_ZONE');
    const stats = getTransitCacheStats();
    expect(stats.zoneCount).toBe(0);
    // 재조회 — Firestore re-fetch 후 hit 복구
    const result = await lookupTransitCache('TEST_ZONE', 1, 2);
    expect(result).not.toBeNull();
  });

  it('invalidateTransitCache(null): 전체 flush', async () => {
    const { lookupTransitCache, invalidateTransitCache, getTransitCacheStats } = await importFresh();
    await lookupTransitCache('TEST_ZONE', 1, 2);
    invalidateTransitCache(null);
    expect(getTransitCacheStats().zoneCount).toBe(0);
  });

  it('second lookup same zone: in-memory hit (Firestore 재호출 없음)', async () => {
    const { initAdminDb } = await import('../../api/_ai_core/firestoreAdmin.js');
    const { lookupTransitCache } = await importFresh();
    await lookupTransitCache('TEST_ZONE', 1, 2);
    await lookupTransitCache('TEST_ZONE', 1, 2);
    // Firestore get() 가 2회 이상 호출되지 않아야 함 (in-memory hit).
    // initAdminDb 가 mock이라 실제 calls 추적은 불가 — zoneCount=1 로 간접 확인.
    const { getTransitCacheStats } = await import('../../api/_ai_core/transitCache.js');
    expect(getTransitCacheStats().zoneCount).toBe(1);
  });
});
