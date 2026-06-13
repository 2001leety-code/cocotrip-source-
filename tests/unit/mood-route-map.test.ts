/**
 * MOOD 경로 미니맵 — naverMapSearchUrl 순수함수 + 배선/안전 소스가드 (2026-06-14).
 *
 * 2단: VITE_NCP_MAP_CLIENT_ID 있으면 Naver Dynamic Map 임베드, 없으면 지도 링크 폴백.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { naverMapSearchUrl } from '../../src/lib/naverMap';

describe('naverMapSearchUrl', () => {
  it('주소를 네이버 지도 검색 딥링크로 인코딩 (round-trip)', () => {
    const url = naverMapSearchUrl('인천공항 제1터미널');
    expect(url.startsWith('https://map.naver.com/p/search/')).toBe(true);
    const q = url.split('/search/')[1];
    expect(decodeURIComponent(q)).toBe('인천공항 제1터미널');
  });
  it('앞뒤 공백 trim', () => {
    const url = naverMapSearchUrl('  강남역  ');
    expect(decodeURIComponent(url.split('/search/')[1])).toBe('강남역');
  });
});

describe('naverMap 로더 — 스크립트 스펙', () => {
  const loader = readFileSync(resolve(process.cwd(), 'src/lib/naverMap.ts'), 'utf8');
  it('현행 스펙: oapi.map.naver.com + ncpClientId + submodules=geocoder', () => {
    expect(loader).toContain('oapi.map.naver.com/openapi/v3/maps.js');
    expect(loader).toContain('ncpClientId=');
    expect(loader).toContain('submodules=geocoder');
    // legacy ncpKeyId 미사용
    expect(loader).not.toContain('ncpKeyId');
  });
});

describe('MoodRouteMap — 배선·안전 (소스가드)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/MoodRouteMap.tsx'), 'utf8');

  it('키 미설정/실패 시 링크 폴백 (graceful, 키 불필요 항상 동작)', () => {
    expect(src).toContain('VITE_NCP_MAP_CLIENT_ID');
    expect(src).toContain('naverMapSearchUrl');
    expect(src).toMatch(/showEmbed\s*=\s*!!clientId/);
  });

  it('훅이 early-return 위에서 호출 (rules-of-hooks 회귀 방지)', () => {
    const earlyReturn = src.indexOf('if (points.length === 0) return null');
    const useEffectIdx = src.indexOf('useEffect(');
    const useStateIdx = src.indexOf('useState');
    expect(earlyReturn).toBeGreaterThan(0);
    expect(useEffectIdx).toBeGreaterThan(0);
    expect(useEffectIdx).toBeLessThan(earlyReturn);
    expect(useStateIdx).toBeLessThan(earlyReturn);
  });

  it('지오코딩 디바운스 (타이핑 중 쿼터 보호)', () => {
    expect(src).toContain('setTimeout');
  });
});

describe('MoodPortal — 지도 컴포넌트 배선', () => {
  const portal = readFileSync(resolve(process.cwd(), 'src/pages/MoodPortal.tsx'), 'utf8');
  it('MoodRouteMap import + 렌더', () => {
    expect(portal).toMatch(/import\s*\{\s*MoodRouteMap\s*\}/);
    expect(portal).toMatch(/<MoodRouteMap/);
  });
});
