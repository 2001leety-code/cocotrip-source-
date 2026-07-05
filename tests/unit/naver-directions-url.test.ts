/**
 * naverMapDirectionsUrl 잠금 (2026-07-05) — 경로 지도는 길찾기(동선), 주소검색은 위치.
 */
import { describe, it, expect } from 'vitest';
import { naverMapDirectionsUrl, naverMapSearchUrl } from '../../src/lib/naverMap';

describe('naverMapDirectionsUrl — 길찾기(출발·경유·도착 동선)', () => {
  it('출발→도착 (경유 없음) — /p/directions + /-/car', () => {
    const url = naverMapDirectionsUrl([
      { lat: 37.5099, lng: 127.0872, name: '이사님집' },
      { lat: 37.4689, lng: 126.4333, name: '인천공항' },
    ]);
    expect(url).toContain('map.naver.com/p/directions/');
    expect(url).toContain('127.0872,37.5099'); // 경도,위도 순
    expect(url).toContain('126.4333,37.4689');
    expect(url.endsWith('/-/car')).toBe(true);
    expect(url).toContain(encodeURIComponent('이사님집'));
  });

  it('경유지 포함 — 출발/경유/도착 순서 유지', () => {
    const url = naverMapDirectionsUrl([
      { lat: 37.5099, lng: 127.0872, name: '집' },
      { lat: 37.5299, lng: 126.9648, name: '용산역' },
      { lat: 37.4689, lng: 126.4333, name: '공항' },
    ]);
    const segs = url.replace('https://map.naver.com/p/directions/', '').replace('/-/car', '').split('/');
    expect(segs).toHaveLength(3);
    expect(segs[0]).toContain(encodeURIComponent('집'));
    expect(segs[1]).toContain(encodeURIComponent('용산역'));
    expect(segs[2]).toContain(encodeURIComponent('공항'));
  });

  it('좌표 2개 미만 or 무효 좌표 → 빈 문자열 (링크 폴백)', () => {
    expect(naverMapDirectionsUrl([{ lat: 37.5, lng: 127, name: 'a' }])).toBe('');
    expect(naverMapDirectionsUrl([
      { lat: NaN, lng: 127, name: 'a' },
      { lat: 37.5, lng: 127, name: 'b' },
    ])).toBe(''); // 유효 1개 → 빈
  });

  it('주소검색 위치 URL은 그대로 (동선 아님) — 구분 유지', () => {
    expect(naverMapSearchUrl('강남역')).toBe('https://map.naver.com/p/search/' + encodeURIComponent('강남역'));
    expect(naverMapSearchUrl('강남역')).not.toContain('directions');
  });
});

describe('MoodRouteMap 배선 불변식 (2026-07-05)', () => {
  it('경로 지도는 route.points 를 role별 이름으로 길찾기 URL 생성, 주소검색은 위치 유지', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../src/components/MoodRouteMap.tsx'), 'utf8');
    // 길찾기 URL 함수 사용 + route.points → role별 origin/waypoint/destination 이름 매칭
    expect(src).toMatch(/naverMapDirectionsUrl/);
    expect(src).toMatch(/route\.points\.map/);
    expect(src).toMatch(/p\.role === 'origin'/);
    expect(src).toMatch(/p\.role === 'destination'/);
    expect(src).toMatch(/waypoints\[.*p\.index/);
    // 좌표 없으면 naverMapSearchUrl(위치) 폴백 유지
    expect(src).toMatch(/directionsUrl \|\| naverMapSearchUrl/);
    // 링크 문구: 동선 vs 위치 구분
    expect(src).toMatch(/동선 보기/);
  });
});
