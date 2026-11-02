import { describe, expect, it, vi } from 'vitest';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => 'test' }));
vi.mock('../../api/_shared/translator.js', () => ({ translatePlaceName: async (text: string) => ({ text, source: 'original' }) }));

describe('local-search display limit', () => {
  it.each([undefined, '100', '2'])('bounds requested limit %s to the regional API maximum', async (limit) => {
    vi.stubEnv('NAVER_LOCAL_SEARCH_CLIENT_ID', 'test'); vi.stubEnv('NAVER_LOCAL_SEARCH_SECRET', 'test');
    get.mockResolvedValue({ status: 200, data: { items: [] } });
    const handler = (await import('../../api/place-search.js')).default;
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handler({ method: 'GET', query: { query: 'seoul', limit } }, res);
    expect(get.mock.lastCall[1].params.display).toBe(limit === '2' ? 2 : 5);
    vi.unstubAllEnvs();
  });
});

import { cleanNaverText, parseNaverCoordinates, parseNaverLocalItem, proposeNaverFoodEnrichment } from '../../api/_ai_core/naverFoodEnrichment.js';

describe('naver local food proposal', () => {
  const item = { title: '<b>Seoul</b> &amp; Kitchen', address: 'Seoul 1', roadAddress: 'Seoul Road 1', category: 'restaurant', mapx: '1269816207', mapy: '375654272', link: 'https://example.com/place', naverPlaceId: 'naver-1', extra: 'kept' };
  const existing = { name: 'Seoul & Kitchen', address: 'Seoul Road 1', lat: 37.5654272, lng: 126.9816207, naverPlaceId: 'naver-1', verification_status: 'halal_certified', dietary_evidence: ['original'], opening_hours: 'original' };
  const meta = { query: 'Seoul Kitchen', checkedAt: '2026-11-02T00:00:00Z' };
  it('strips markup and decodes text without fabricating operating or dietary verification', () => {
    expect(cleanNaverText('<b>A</b> &amp; &#x42;')).toBe('A & B');
    const before = structuredClone(existing);
    const result = proposeNaverFoodEnrichment({ existing, response: { items: [item] }, ...meta });
    expect(result.status).toBe('match_proposal');
    expect(result.proposals[0]).toMatchObject({ source: 'naver_local_search', query: meta.query, checkedAt: meta.checkedAt, name: 'Seoul & Kitchen', opening_status: 'unknown', dietary_verification: 'unchanged', responseFields: item });
    expect(existing).toEqual(before);
    expect(result.proposals[0]).not.toHaveProperty('verification_status');
    expect(result.proposals[0]).not.toHaveProperty('dietary_evidence');
  });
  it('accepts only domestic WGS84 decimals or scaled coordinates', () => {
    expect(parseNaverCoordinates('126.9816207', '37.5654272')).toEqual({ lat: 37.5654272, lng: 126.9816207 });
    expect(parseNaverCoordinates('1269816207', '375654272')).toEqual({ lat: 37.5654272, lng: 126.9816207 });
    for (const pair of [['3123000', '5447000'], ['0', '0'], ['', '37'], ['181', '90'], ['bad', '37']]) expect(parseNaverCoordinates(...pair)).toBeNull();
  });
  it('routes name, address, identity, coordinate, and provenance ambiguity to review', () => {
    const variants = [
      { existing: { ...existing, name: 'Other' }, item },
      { existing: { ...existing, address: 'Other address' }, item },
      { existing: { ...existing, naverPlaceId: 'expected' }, item },
      { existing, item: { ...item, naverPlaceId: undefined } },
      { existing, item: { ...item, mapx: '123', mapy: '456' } },
      { existing, item: { ...item, link: 'javascript:alert(1)' } },
    ];
    for (const v of variants) expect(proposeNaverFoodEnrichment({ existing: v.existing, response: { items: [v.item] }, ...meta }).status).toBe('review');
    expect(proposeNaverFoodEnrichment({ existing, response: { items: [item, item] }, ...meta }).status).toBe('review');
    expect(proposeNaverFoodEnrichment({ existing, response: { items: [] }, ...meta }).status).toBe('no_match');
    expect(proposeNaverFoodEnrichment({ existing, response: null, ...meta }).status).toBe('unknown');
  });
  it('keeps raw fields as evidence but never uses search labels as dietary certification', () => {
    const candidate = parseNaverLocalItem({ ...item, category: 'vegan', verification_status: 'vegan_restaurant' }, meta);
    expect(candidate.dietary_verification).toBe('unchanged');
    expect(candidate).not.toHaveProperty('verification_status');
    expect(candidate.responseFields.verification_status).toBe('vegan_restaurant');
  });
});
