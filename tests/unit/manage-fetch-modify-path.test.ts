/* eslint-disable @typescript-eslint/no-explicit-any -- fetch 모킹 스캐폴딩. */
/**
 * manageFetch 허용 경로 (2026-10-23, 후속 ②b) — 조회·취소·날짜 변경 3개, 나머지 보호 엔드포인트는 throw.
 * 요청 계약: POST · JSON · Authorization 없음 · 토큰은 본문 manageToken 으로만(URL 쿼리 없음).
 * lint P43 허용 목록과 같은 집합인지도 잠근다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { manageFetch } from '../../src/lib/manageFetch';
import { P43_MANAGE_FETCH_PATHS } from '../../scripts/lib/p43-protected-calls.mjs';

const fetchSpy = vi.fn<(url: string, init: any) => Promise<any>>(async () => ({ ok: true, status: 200 }));

afterEach(() => { vi.unstubAllGlobals(); fetchSpy.mockClear(); });

describe('manageFetch', () => {
  it.each(['/api/booking-manage', '/api/cancelBooking', '/api/modifyBooking'])('%s → POST JSON, token in body, no Bearer', async (path) => {
    vi.stubGlobal('fetch', fetchSpy);
    await manageFetch(path, { manageToken: 'TOK', body: { bookingID: 'B1', changes: { tourDate: '2099-01-02' } } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(path);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(JSON.parse(init.body)).toEqual({ bookingID: 'B1', changes: { tourDate: '2099-01-02' }, manageToken: 'TOK' });
    expect(url).not.toContain('TOK');
  });

  it.each(['/api/voucher', '/api/my-bookings', '/api/reviews', '/api/modifyBooking?x=1'])('%s → throws before any request', async (path) => {
    vi.stubGlobal('fetch', fetchSpy);
    await expect(manageFetch(path, { manageToken: 'TOK' })).rejects.toThrow(/path not allowed/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('client allowlist === lint P43 allowlist', async () => {
    const src = (await import('node:fs')).readFileSync('src/lib/manageFetch.ts', 'utf8');
    const m = /const MANAGE_PATHS = new Set\(\[([^\]]*)\]\)/.exec(src);
    const client = new Set((m ? m[1] : '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
    expect([...client].sort()).toEqual([...P43_MANAGE_FETCH_PATHS].sort());
  });
});
