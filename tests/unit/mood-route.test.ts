import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// axios 모킹 — geocode + Naver Directions 호출을 가짜 응답으로 대체.
// (computeRoute 는 외부 네트워크 없이 순수 로직만 검증.)
vi.mock('axios', () => {
  const get = vi.fn();
  return { default: { get }, get };
});
import axios from 'axios';
// @ts-expect-error — ESM .js (Vercel serverless 공유 모듈)
import { computeRoute } from '../../api/_shared/mood-route.js';

const mockGet = (axios as unknown as { get: ReturnType<typeof vi.fn> }).get;

// Naver Geocoding 성공 응답 — (lat=y, lng=x).
function geocodeOK(lat: number, lng: number) {
  return { status: 200, data: { addresses: [{ y: String(lat), x: String(lng) }] } };
}
// Naver Geocoding 실패 응답 — 주소 0건.
function geocodeEmpty() {
  return { status: 200, data: { addresses: [] } };
}
// Naver Directions 성공 — distance(m), duration(ms), tollFare(원).
function directionsOK(distanceM: number, durationMs: number, tollFare?: number) {
  const summary: Record<string, number> = { distance: distanceM, duration: durationMs };
  if (tollFare !== undefined) summary.tollFare = tollFare;
  return { status: 200, data: { code: 0, route: { traoptimal: [{ summary }] } } };
}

describe('mood-route — computeRoute (Naver Directions)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    process.env.NCP_CLIENT_ID = 'test-id';
    process.env.NCP_CLIENT_SECRET = 'test-secret';
  });
  afterEach(() => {
    delete process.env.NCP_CLIENT_ID;
    delete process.env.NCP_CLIENT_SECRET;
    delete process.env.NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_SECRET;
  });

  it('성공: geocode×2 + directions → km/tollKRW/durationMin', async () => {
    mockGet
      .mockResolvedValueOnce(geocodeOK(37.5, 127.0)) // origin
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1)) // destination
      .mockResolvedValueOnce(directionsOK(12345, 1_800_000, 4500)); // 12.345km, 30min, ₩4500

    const r = await computeRoute({ origin: '강남역', destination: '판교역' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.km).toBe(12.3);       // 12345m → 12.345 → 소수1 반올림
    expect(r.durationMin).toBe(30); // 1,800,000ms → 30분
    expect(r.tollKRW).toBe(4500);
  });

  it('톨비 필드 없으면 tollKRW=0', async () => {
    mockGet
      .mockResolvedValueOnce(geocodeOK(37.5, 127.0))
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1))
      .mockResolvedValueOnce(directionsOK(5000, 600_000)); // tollFare 없음
    const r = await computeRoute({ origin: 'A', destination: 'B' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tollKRW).toBe(0);
    expect(r.km).toBe(5);
  });

  it('경유지: waypoints 가 "lng,lat|lng,lat" 파이프 포맷으로 전달 (Naver 명세)', async () => {
    mockGet
      .mockResolvedValueOnce(geocodeOK(37.5, 127.0))  // origin
      .mockResolvedValueOnce(geocodeOK(37.3, 127.2))  // destination
      .mockResolvedValueOnce(geocodeOK(37.45, 127.05)) // waypoint A
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1))   // waypoint B
      .mockResolvedValueOnce(directionsOK(30000, 2_400_000, 6600));
    const r = await computeRoute({ origin: 'O', destination: 'D', waypoints: ['A', 'B'] });
    expect(r.ok).toBe(true);
    // 마지막 호출 = directions. waypoints 파라미터 검증.
    const dirCall = mockGet.mock.calls.at(-1)!;
    const params = (dirCall[1] as { params: Record<string, string> }).params;
    expect(params.waypoints).toBe('127.05,37.45|127.1,37.4');
    expect(params.start).toBe('127,37.5');
    expect(params.goal).toBe('127.2,37.3');
  });

  it('경유지 5개 초과 → TOO_MANY_WAYPOINTS (400, geocode 호출 전 거부)', async () => {
    const r = await computeRoute({ origin: 'O', destination: 'D', waypoints: ['1', '2', '3', '4', '5', '6'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toBe('TOO_MANY_WAYPOINTS');
    expect(mockGet).not.toHaveBeenCalled(); // 가드가 geocode/directions 호출 전에 차단
  });

  it('geocode 실패(origin) → GEOCODING_FAILED detail=origin', async () => {
    mockGet
      .mockResolvedValueOnce(geocodeEmpty())          // origin 실패
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1)); // destination ok
    const r = await computeRoute({ origin: 'no-such-place', destination: 'B' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('GEOCODING_FAILED');
    expect(r.detail).toBe('origin');
    expect(r.status).toBe(404);
  });

  it('directions code != 0 → DIRECTIONS_FAILED (502)', async () => {
    mockGet
      .mockResolvedValueOnce(geocodeOK(37.5, 127.0))
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1))
      .mockResolvedValueOnce({ status: 200, data: { code: 1, message: 'no route' } });
    const r = await computeRoute({ origin: 'A', destination: 'B' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DIRECTIONS_FAILED');
    expect(r.status).toBe(502);
  });

  it('origin/destination 빈 값 → MISSING_PARAMS (400, 네트워크 호출 0)', async () => {
    const r = await computeRoute({ origin: '', destination: 'B' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('MISSING_PARAMS');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('NCP/NAVER 키 모두 미설정 → NCP_NOT_CONFIGURED (500, 네트워크 호출 0)', async () => {
    delete process.env.NCP_CLIENT_ID;
    delete process.env.NCP_CLIENT_SECRET;
    delete process.env.NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_SECRET;
    const r = await computeRoute({ origin: 'A', destination: 'B' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('NCP_NOT_CONFIGURED');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('변수명 폴백: NCP_CLIENT_* 없고 NAVER_CLIENT_* 만 있어도 동작 (prod 시나리오)', async () => {
    delete process.env.NCP_CLIENT_ID;
    delete process.env.NCP_CLIENT_SECRET;
    process.env.NAVER_CLIENT_ID = 'naver-id';
    process.env.NAVER_CLIENT_SECRET = 'naver-secret';
    mockGet
      .mockResolvedValueOnce(geocodeOK(37.5, 127.0))
      .mockResolvedValueOnce(geocodeOK(37.4, 127.1))
      .mockResolvedValueOnce(directionsOK(8000, 900_000, 1200));
    const r = await computeRoute({ origin: 'A', destination: 'B' });
    expect(r.ok).toBe(true);              // NCP_NOT_CONFIGURED 아님 — NAVER_CLIENT_* 폴백 사용
    if (!r.ok) return;
    expect(r.km).toBe(8);
    expect(r.tollKRW).toBe(1200);
    // geocode 헤더에 NAVER 키가 실림 확인
    const firstCall = mockGet.mock.calls[0];
    const headers = (firstCall[1] as { headers: Record<string, string> }).headers;
    expect(headers['X-NCP-APIGW-API-KEY-ID']).toBe('naver-id');
  });

  it('axios throw → DIRECTIONS_FAILED (502, 예외 안전)', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'));
    const r = await computeRoute({ origin: 'A', destination: 'B' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DIRECTIONS_FAILED');
  });
});
