/**
 * place-search 키쌍 요청 레벨 폴백 — prod 장애 (2026-07-04) 회귀 잠금.
 *
 * 증상: prod GET /api/place-search 전부 401 AUTH_FAILED "NAVER_DEVELOPERS_* rejected".
 * 원인: 구 resolveCredentials 가 "존재하는 첫 키쌍"만 반환 — Vercel 에 등록된
 * NAVER_DEVELOPERS_* 가 Naver 에서 거부돼도 (만료·앱 삭제) 뒤의 살아있는
 * NAVER_CLIENT_* 를 시도조차 안 함. 파일 주석은 "모두 시도"라고 써 있었으나
 * 실제로는 첫 쌍 고정이었다.
 *
 * 잠금:
 *   1. resolveCredentialCandidates — 등록된 키쌍 전부를 우선순위대로 반환
 *   2. searchWithCredentialFallback — 401/403 이면 다음 키쌍 재시도 (최대 후보
 *      수 = 4회, 무한루프 없음), 비-auth 에러는 즉시 반환 (키 로테이션 금지),
 *      preferred(마지막 성공 키) 우선 시도
 *   3. handler e2e (axios mock) — 죽은 NAVER_DEVELOPERS_* → 살아있는
 *      NAVER_CLIENT_* 폴백으로 200 + items
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosGetMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({ default: { get: axiosGetMock } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: async () => ({ ok: true }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/translator.js', () => ({
  translatePlaceName: async (text: string) => ({ text, source: 'original' }),
}));

import {
  resolveCredentialCandidates,
  searchWithCredentialFallback,
  naverCoordToWgs84,
} from '../../api/place-search.js';

// ── 0. 좌표 포맷 자동 감지 — 현행 WGS84×1e7 응답이 전부 drop 되던 버그 잠금 ──
describe('naverCoordToWgs84', () => {
  it('현행 API WGS84 × 1e7 정수 → 그대로 나눠서 반환 (롯데호텔 서울 실측값)', () => {
    const c = naverCoordToWgs84('1269816207', '375654272');
    expect(c).toEqual({ lat: 37.5654272, lng: 126.9816207 });
  });

  it('구형 TM128 × 10 → 기존 변환 경로로 한국 영역 내 좌표 반환', () => {
    const c = naverCoordToWgs84('3123000', '5447000');
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(33);
    expect(c!.lat).toBeLessThan(39);
    expect(c!.lng).toBeGreaterThan(124);
    expect(c!.lng).toBeLessThan(132);
  });

  it('숫자 아님 / 양쪽 다 범위 밖 → null', () => {
    expect(naverCoordToWgs84('abc', '123')).toBeNull();
    expect(naverCoordToWgs84('999999999999', '999999999999')).toBeNull();
  });
});

// ── 1. 키 resolution 순수함수 ────────────────────────────────────────────────
describe('resolveCredentialCandidates', () => {
  it('등록된 키쌍 전부를 우선순위대로 반환한다 (첫 쌍만이 아니라)', () => {
    const env = {
      NAVER_DEVELOPERS_CLIENT_ID: 'dev-id',
      NAVER_DEVELOPERS_SECRET: 'dev-secret',
      NAVER_CLIENT_ID: 'plain-id',
      NAVER_CLIENT_SECRET: 'plain-secret',
    };
    const out = resolveCredentialCandidates(env);
    expect(out.map((c: any) => c.source)).toEqual(['NAVER_DEVELOPERS_*', 'NAVER_CLIENT_*']);
    expect(out[1]).toEqual({ id: 'plain-id', secret: 'plain-secret', source: 'NAVER_CLIENT_*' });
  });

  it('id/secret 중 하나만 있는 불완전 쌍은 건너뛴다 + trim 적용', () => {
    const env = {
      NAVER_LOCAL_SEARCH_CLIENT_ID: 'lonely-id-no-secret',
      NAVER_CLIENT_ID: '  padded-id  ',
      NAVER_CLIENT_SECRET: ' padded-secret ',
      NCP_CLIENT_ID: 'ncp-id',
      NCP_CLIENT_SECRET: 'ncp-secret',
    };
    const out = resolveCredentialCandidates(env);
    expect(out.map((c: any) => c.source)).toEqual(['NAVER_CLIENT_*', 'NCP_CLIENT_*']);
    expect(out[0].id).toBe('padded-id');
    expect(out[0].secret).toBe('padded-secret');
  });

  it('아무 키도 없으면 빈 배열', () => {
    expect(resolveCredentialCandidates({})).toEqual([]);
  });
});

// ── 2. 401/403 폴백 로직 ─────────────────────────────────────────────────────
describe('searchWithCredentialFallback', () => {
  const cand = (source: string) => ({ id: `${source}-id`, secret: `${source}-secret`, source });

  it('첫 키 401 → 다음 키로 재시도해 200 반환, rejected 에 죽은 키 기록', async () => {
    const doRequest = vi.fn(async (creds: any) =>
      creds.source === 'A' ? { status: 401, data: { errorCode: '024' } } : { status: 200, data: { items: [] } });
    const r = await searchWithCredentialFallback([cand('A'), cand('B')], doRequest);
    expect(r.upstream.status).toBe(200);
    expect(r.source).toBe('B');
    expect(r.rejected).toEqual([{ source: 'A', status: 401, data: { errorCode: '024' } }]);
    expect(doRequest).toHaveBeenCalledTimes(2);
  });

  it('전 키 401/403 → upstream null, 시도 횟수 = 후보 수 (무한루프 없음)', async () => {
    const doRequest = vi.fn(async () => ({ status: 403, data: {} }));
    const cands = [cand('A'), cand('B'), cand('C'), cand('D')];
    const r = await searchWithCredentialFallback(cands, doRequest);
    expect(r.upstream).toBeNull();
    expect(r.rejected.map((x: any) => x.source)).toEqual(['A', 'B', 'C', 'D']);
    expect(doRequest).toHaveBeenCalledTimes(4);
  });

  it('비-auth 에러 (429/5xx) 는 키 문제가 아니므로 로테이션 없이 즉시 반환', async () => {
    const doRequest = vi.fn(async () => ({ status: 500, data: {} }));
    const r = await searchWithCredentialFallback([cand('A'), cand('B')], doRequest);
    expect(r.upstream.status).toBe(500);
    expect(r.source).toBe('A');
    expect(doRequest).toHaveBeenCalledTimes(1);
  });

  it('preferred(마지막 성공 키) 가 있으면 그 키부터 시도한다', async () => {
    const tried: string[] = [];
    const doRequest = vi.fn(async (creds: any) => {
      tried.push(creds.source);
      return { status: 200, data: {} };
    });
    await searchWithCredentialFallback([cand('A'), cand('B'), cand('C')], doRequest, 'C');
    expect(tried).toEqual(['C']);
  });

  it('preferred 가 후보에 없어도 (env 변경) 원래 순서로 정상 동작', async () => {
    const doRequest = vi.fn(async () => ({ status: 200, data: {} }));
    const r = await searchWithCredentialFallback([cand('A')], doRequest, 'GONE');
    expect(r.source).toBe('A');
  });
});

// ── 3. handler e2e — 죽은 DEVELOPERS 키 → 살아있는 CLIENT 키 폴백 ──────────────
describe('handler: NAVER_DEVELOPERS_* 거부 → NAVER_CLIENT_* 폴백', () => {
  function fakeRes() {
    const r: any = { statusCode: 0, headers: null, body: '' };
    r.writeHead = (code: number, headers: any) => { r.statusCode = code; r.headers = headers; return r; };
    r.end = (body?: string) => { r.body = body || ''; return r; };
    return r;
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    axiosGetMock.mockReset();
    // module scope lastGoodSource 초기화 — 각 테스트가 cold start 를 재현
    vi.resetModules();
  });

  async function freshHandler() {
    return (await import('../../api/place-search.js')).default;
  }

  const NAVER_ITEM = {
    title: '르픽 카페',
    address: '서울특별시 용산구',
    roadAddress: '서울특별시 용산구 어딘가로 1',
    category: '카페',
    telephone: '',
    // 현행 API 포맷: WGS84 × 1e7 정수
    mapx: '1269816207',
    mapy: '375654272',
  };

  it('DEVELOPERS 401 → CLIENT 로 폴백해 200 + items, 이후 요청은 CLIENT 만 사용', async () => {
    vi.stubEnv('NAVER_DEVELOPERS_CLIENT_ID', 'dead-id');
    vi.stubEnv('NAVER_DEVELOPERS_SECRET', 'dead-secret');
    vi.stubEnv('NAVER_CLIENT_ID', 'live-id');
    vi.stubEnv('NAVER_CLIENT_SECRET', 'live-secret');
    vi.stubEnv('NAVER_LOCAL_SEARCH_CLIENT_ID', '');
    vi.stubEnv('NAVER_LOCAL_SEARCH_SECRET', '');
    vi.stubEnv('NCP_CLIENT_ID', '');
    vi.stubEnv('NCP_CLIENT_SECRET', '');

    axiosGetMock.mockImplementation(async (_url: string, opts: any) =>
      opts.headers['X-Naver-Client-Id'] === 'live-id'
        ? { status: 200, data: { items: [NAVER_ITEM] } }
        : { status: 401, data: { errorMessage: 'NID AUTH Result Invalid' } });

    const handler = await freshHandler();
    const req = { method: 'GET', query: { query: '르픽', limit: '2', lang: 'ko' } };

    const res1 = fakeRes();
    await handler(req, res1);
    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    expect(body1.items).toHaveLength(1);
    expect(body1.items[0].name).toBe('르픽 카페');
    expect(axiosGetMock).toHaveBeenCalledTimes(2); // dead → live

    // warm instance: lastGoodSource 캐시로 죽은 키 건너뜀 — 호출 1회만 추가
    const res2 = fakeRes();
    await handler(req, res2);
    expect(res2.statusCode).toBe(200);
    expect(axiosGetMock).toHaveBeenCalledTimes(3);
    expect(axiosGetMock.mock.calls[2][1].headers['X-Naver-Client-Id']).toBe('live-id');
  });

  it('모든 키 거부 → 401 AUTH_FAILED + detail 에 시도한 source 전부 나열', async () => {
    vi.stubEnv('NAVER_DEVELOPERS_CLIENT_ID', 'dead-id');
    vi.stubEnv('NAVER_DEVELOPERS_SECRET', 'dead-secret');
    vi.stubEnv('NAVER_CLIENT_ID', 'also-dead');
    vi.stubEnv('NAVER_CLIENT_SECRET', 'also-dead');
    vi.stubEnv('NAVER_LOCAL_SEARCH_CLIENT_ID', '');
    vi.stubEnv('NAVER_LOCAL_SEARCH_SECRET', '');
    vi.stubEnv('NCP_CLIENT_ID', '');
    vi.stubEnv('NCP_CLIENT_SECRET', '');

    axiosGetMock.mockResolvedValue({ status: 401, data: {} });

    const handler = await freshHandler();
    const res = fakeRes();
    await handler({ method: 'GET', query: { query: '르픽' } }, res);
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('AUTH_FAILED');
    expect(body.detail).toContain('NAVER_DEVELOPERS_*');
    expect(body.detail).toContain('NAVER_CLIENT_*');
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
  });
});
