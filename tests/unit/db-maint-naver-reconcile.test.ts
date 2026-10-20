/**
 * DB 유지보수 — Naver 로컬검색 재대조 순수 함수·apply 안전장치 (네트워크 없음, fetch mock).
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — .mjs 스크립트(타입 선언 없음)
import * as nr from '../../scripts/db-maintenance/naver-reconcile.mjs';

const row = { name: '홍수계찜닭 타임스퀘어점', address: '서울특별시 영등포구 영중로 15 타임스퀘어', lat: 37.5170576, lng: 126.9045635, city: 'seoul' };
const item = (over = {}) => ({
  title: '<b>홍수계찜닭</b> 타임스퀘어점',
  link: 'http://www.hongsugye.com/',
  category: '육류,고기요리>찜닭',
  address: '서울특별시 영등포구 영등포동4가 442-9',
  roadAddress: '서울특별시 영등포구 영중로 15 타임스퀘어',
  telephone: '02-1234-5678',
  mapx: '1269045635',
  mapy: '375170576',
  ...over,
});

describe('이름·좌표 함수', () => {
  it('HTML·공백·기호 제거 후 비교', () => {
    expect(nr.normName('<b>A-B</b> c&amp;d')).toBe('abcd');
    expect(nr.similarity('홍수계 찜닭', '<b>홍수계</b>찜닭')).toBe(1);
    expect(nr.similarity('종가찜닭', '완전다른집')).toBeLessThan(0.6);
  });
  it('nameEn 은 title 과 비교(둘 중 높은 값)', () => {
    expect(nr.nameScore({ name: '가나다', nameEn: 'Hong Soo Gye' }, '<b>Hong Soo Gye</b>')).toBe(1);
  });
  it('mapx/mapy ÷1e7 = WGS84 (KATEC 아님)', () => {
    expect(nr.naverToWgs84('1269045635', '375170576')).toEqual({ lng: 126.9045635, lat: 37.5170576 });
    expect(nr.naverToWgs84('', 'x')).toBeNull();
  });
  it('haversine: 위도 0.001도 ≈ 111m', () => {
    const d = nr.haversineM({ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
  it('질의 = 상호 + 구/군 (없으면 시)', () => {
    expect(nr.buildQuery(row)).toBe('홍수계찜닭 타임스퀘어점 영등포구');
    expect(nr.districtToken({ address: '경상북도 안동시 번영길 11', city: 'andong' })).toBe('안동시');
    expect(nr.districtToken({ address: '', city: 'jeju' })).toBe('jeju');
    expect(nr.buildQuery({ name: '카페&amp;김', address: '경상북도 안동시 x' })).toBe('카페&김 안동시');
  });
});

describe('분류', () => {
  it('matched / review / unmatched 경계', () => {
    expect(nr.classify(0.8, 300)).toBe('matched');
    expect(nr.classify(0.79, 100)).toBe('review');
    expect(nr.classify(0.95, 301)).toBe('review');
    expect(nr.classify(0.95, 1001)).toBe('unmatched');
    expect(nr.classify(0.59, 10)).toBe('unmatched');
    expect(nr.classify(0.99, null)).toBe('review');
  });
  it('evaluateRow: 최고 후보 선택 + proposed 필드', () => {
    const far = item({ title: '홍수계찜닭 타임스퀘어점', mapx: '1270045635' });
    const r = nr.evaluateRow(row, [far, item()]);
    expect(r.status).toBe('matched');
    expect(r.distanceM).toBe(0);
    expect(r.proposed).toMatchObject({ naverLink: 'http://www.hongsugye.com/', roadAddress: expect.any(String), telephone: '02-1234-5678' });
  });
  it('다른 가게 → unmatched, 결과 0건 → unmatched', () => {
    expect(nr.evaluateRow(row, [item({ title: '전혀다른식당' })]).status).toBe('unmatched');
    expect(nr.evaluateRow(row, []).status).toBe('unmatched');
  });
  it('--no-link 선택', () => {
    const rows = [{ name: 'a' }, { name: 'b', placeId: 'x' }, { name: 'c', naverLink: 'u' }, { name: 'd', city: 'jeju' }];
    expect(nr.selectRows(rows, { noLink: true, limit: Infinity }).map((s: { index: number }) => s.index)).toEqual([0, 3]);
    expect(nr.selectRows(rows, { noLink: true, city: 'jeju', limit: Infinity }).map((s: { index: number }) => s.index)).toEqual([3]);
    expect(nr.selectRows(rows, { noLink: true, limit: 1 })).toHaveLength(1);
  });
});

describe('applyUpdates', () => {
  const rows = [{ name: 'a', lat: 1, lng: 2 }, { name: 'b', lat: 3, lng: 4 }];
  it('matched 없으면 아무것도 안 바꾼다', () => {
    const { rows: out, updated } = nr.applyUpdates(rows, [{ index: 0, name: 'a', status: 'review', proposed: { naverLink: 'u' } }]);
    expect(updated).toBe(0);
    expect(out).toEqual(rows);
  });
  it('matched 는 naverLink/roadAddress/telephone 만 쓰고 좌표·상호·category 불변', () => {
    const { rows: out, updated } = nr.applyUpdates(rows, [
      { index: 1, name: 'b', status: 'matched', proposed: { naverLink: 'https://map.naver.com/p/1', roadAddress: 'r', telephone: 't', category: 'c', lat: 9 } },
    ]);
    expect(updated).toBe(1);
    expect(out[1]).toEqual({ name: 'b', lat: 3, lng: 4, naverLink: 'https://map.naver.com/p/1', roadAddress: 'r', telephone: 't' });
    expect(out[0]).toEqual(rows[0]);
  });
  it('비-Naver link 는 쓰지 않고 rejectedLinks 로만 보고 (naver.com/naver.me 하위만 허용)', () => {
    const bad = 'https://100원커피이벤트-선착순주문하기.com';
    const { rows: out, updated, rejectedLinks } = nr.applyUpdates(rows, [
      { index: 0, name: 'a', status: 'matched', proposed: { naverLink: bad, roadAddress: 'r' } },
      { index: 1, name: 'b', status: 'matched', proposed: { naverLink: 'https://evilnaver.com/x' } },
    ]);
    expect(out[0]).toEqual({ ...rows[0], roadAddress: 'r' });
    expect(out[1]).toEqual(rows[1]);
    expect(updated).toBe(1);
    expect(rejectedLinks).toEqual([{ index: 0, name: 'a', link: bad }, { index: 1, name: 'b', link: 'https://evilnaver.com/x' }]);
    expect(nr.isNaverHost('https://m.place.naver.com/restaurant/1')).toBe(true);
    expect(nr.isNaverHost('https://naver.me/abc')).toBe(true);
  });
  it('상호 불일치면 거부', () => {
    expect(() => nr.applyUpdates(rows, [{ index: 0, name: 'zzz', status: 'matched', proposed: { naverLink: 'u' } }])).toThrow();
  });
});

describe('createClient / main (fetch mock)', () => {
  const env = { NAVER_CLIENT_ID: 'id-test', NAVER_CLIENT_SECRET: 'secret-test' };
  const ok = (items: unknown[]) => ({ ok: true, status: 200, json: async () => ({ items }) });

  it('키 없으면 값 없는 메시지로 즉시 실패', () => {
    expect(() => nr.createClient({ env: {} })).toThrow(/NAVER_CLIENT_ID/);
  });
  it('429 는 1회 재시도, 요청 카운트에 포함', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }).mockResolvedValueOnce(ok([item()]));
    const c = nr.createClient({ env, fetchImpl: f, delayMs: 0, retryMs: 0 });
    expect(await c.search('q')).toHaveLength(1);
    expect(c.state.requests).toBe(2);
    expect(String(f.mock.calls[0][0])).toContain('https://openapi.naver.com/v1/search/local.json');
  });
  it('요청 상한·연속 실패 상한에서 중단', async () => {
    const capped = nr.createClient({ env, fetchImpl: vi.fn().mockResolvedValue(ok([])), delayMs: 0, cap: 2 });
    await capped.search('a');
    await capped.search('b');
    await expect(capped.search('c')).rejects.toThrow();
    expect(capped.state.stopped).toBe('request-cap');
    const failing = nr.createClient({ env, fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }), delayMs: 0, maxFails: 3 });
    for (let i = 0; i < 3; i++) await failing.search('x').catch(() => {});
    expect(failing.state.stopped).toBe('consecutive-failures');
  });
  it('--apply 에 matched 가 없으면 파일 바이트 불변(백업도 없음)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nr-'));
    const idx = join(dir, 'idx.json');
    const text = JSON.stringify([{ name: '식당', address: '서울특별시 중구 x', lat: 37.5, lng: 127, city: 'seoul' }]);
    writeFileSync(idx, text);
    const f = vi.fn().mockResolvedValue(ok([item({ title: '전혀다른곳' })]));
    const res = await nr.main(['--no-link', '--apply', '--out', dir], { env, fetchImpl: f, indexPath: idx });
    expect(res.updated).toBe(0);
    expect(readFileSync(idx, 'utf8')).toBe(text);
    expect(res.sha256After).toBe(res.sha256Before);
  });
  it('matched 가 있으면 한 줄 minified 로 3필드만 반영, 행 수 동일', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nr-'));
    const idx = join(dir, 'idx.json');
    writeFileSync(idx, JSON.stringify([row]));
    const f = vi.fn().mockResolvedValue(ok([item()]));
    const res = await nr.main(['--no-link', '--apply', '--out', dir], { env, fetchImpl: f, indexPath: idx });
    expect(res.updated).toBe(1);
    const after = readFileSync(idx, 'utf8');
    expect(after.includes('\n')).toBe(false);
    const [r0] = JSON.parse(after);
    // 2026-10-10: 비-Naver link(가게 홈페이지)는 쓰지 않고 rejectedLinks 로만 보고
    expect(r0).toMatchObject({ lat: row.lat, lng: row.lng, name: row.name, roadAddress: '서울특별시 영등포구 영중로 15 타임스퀘어', telephone: '02-1234-5678' });
    expect(r0.naverLink).toBeUndefined();
    expect(res.rejectedLinks).toEqual([{ index: 0, name: row.name, link: 'http://www.hongsugye.com/' }]);
    expect(r0.category).toBeUndefined();
  });
});
