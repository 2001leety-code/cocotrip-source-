// ODsay departure-route fallback — 호텔→공항 경로 무조건 표시 정책 회귀 방지.
//
// 검증 포인트:
//   1. ODsay 5xx → throw (호출자 retry 가능하게)
//   2. ODsay 4xx → null 반환 (retry 무의미)
//   3. ODsay timeout(AbortError) → throw
//   4. 짧은 거리 → walk 직답 (외부 호출 없음)
//
// _routeAirportHotel 의 retry 정책은 통합 테스트 영역(env+ODsay 키 필요)이므로
// 여기선 helper 단위로만 검증.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// fetch 를 mock — vitest는 globalThis.fetch override 가능
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // ODsay key 셋팅 (helper 가 미설정 시 즉시 null 반환하므로)
  process.env.ODSAY_API_KEY = 'TEST_KEY';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('searchTransitRoute — 호텔→공항 fallback 회귀 방지', () => {
  it('짧은 거리(<300m)는 외부 호출 없이 walk 반환', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { searchTransitRoute } = await import('../../api/_odsay_helper.js');
    // 같은 좌표 → 거리 0
    const result = await searchTransitRoute(126.978, 37.5665, 126.978, 37.5665);
    expect(result).toBeTruthy();
    expect(result.type).toBe('walk');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('5xx 응답 → throw (호출자 retry 결정)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { searchTransitRoute } = await import('../../api/_odsay_helper.js');
    // 다른 좌표 → 외부 호출
    await expect(
      searchTransitRoute(126.978, 37.5665, 126.4407, 37.4602),
    ).rejects.toThrow(/ODsay HTTP 503/);
  });

  it('4xx 응답 → null (retry 무의미)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { searchTransitRoute } = await import('../../api/_odsay_helper.js');
    const result = await searchTransitRoute(
      126.978, 37.5665, 126.4407, 37.4602,
    );
    expect(result).toBeNull();
  });

  it('AbortError(timeout) → throw', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { searchTransitRoute } = await import('../../api/_odsay_helper.js');
    await expect(
      searchTransitRoute(126.978, 37.5665, 126.4407, 37.4602),
    ).rejects.toThrow();
  });

  it('정상 응답 → 경로 객체', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          path: [
            {
              info: {
                pathType: 1,
                totalTime: 50,
                payment: 4150,
                busTransitCount: 0,
                subwayTransitCount: 1,
                totalDistance: 30000,
                totalWalk: 600,
                firstStartStation: '홍대입구',
                lastEndStation: '인천국제공항1터미널',
              },
              subPath: [],
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const { searchTransitRoute } = await import('../../api/_odsay_helper.js');
    const result = await searchTransitRoute(
      126.978, 37.5665, 126.4407, 37.4602,
    );
    expect(result).toBeTruthy();
    expect(result.totalTime).toBe(50);
    expect(result.fare).toBe(4150);
    expect(result.firstStation).toBe('홍대입구');
  });
});
