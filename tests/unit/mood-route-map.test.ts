/**
 * MOOD 경로 지도 — 핀만 → 경로 선(폴리라인)+마커+소요시간 업그레이드 (2026-06-14 재작성).
 *
 * 백엔드(computeRoute / api·mood-route)가 path/points 반환 → 프론트(MoodRouteMap)가 폴리라인+마커.
 * 가격(km/tollKRW)은 그대로. NCP 도메인 미등록은 navermap_authFailure 로 앱이 자가진단.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { naverMapSearchUrl } from '../../src/lib/naverMap';

const r = (p: string) => resolve(process.cwd(), p);

describe('naverMapSearchUrl', () => {
  it('주소를 네이버 지도 검색 딥링크로 인코딩 (round-trip)', () => {
    const url = naverMapSearchUrl('인천공항 제1터미널');
    expect(url.startsWith('https://map.naver.com/p/search/')).toBe(true);
    expect(decodeURIComponent(url.split('/search/')[1])).toBe('인천공항 제1터미널');
  });
  it('앞뒤 공백 trim', () => {
    const url = naverMapSearchUrl('  강남역  ');
    expect(decodeURIComponent(url.split('/search/')[1])).toBe('강남역');
  });
});

describe('naverMap 로더 — 스크립트 스펙', () => {
  const loader = readFileSync(r('src/lib/naverMap.ts'), 'utf8');
  it('현행 스펙: oapi.map.naver.com + ncpClientId + submodules=geocoder (legacy ncpKeyId 미사용)', () => {
    expect(loader).toContain('oapi.map.naver.com/openapi/v3/maps.js');
    expect(loader).toContain('ncpClientId=');
    expect(loader).toContain('submodules=geocoder');
    expect(loader).not.toContain('ncpKeyId');
  });
  it('Polyline/Point 타입 노출 (경로 선·마커 앵커)', () => {
    expect(loader).toContain('Polyline:');
    expect(loader).toContain('Point:');
  });
});

describe('백엔드 — 경로 좌표 반환', () => {
  it('computeRoute 가 path + points 반환 (가격 필드는 그대로)', () => {
    const src = readFileSync(r('api/_shared/mood-route.js'), 'utf8');
    expect(src).toMatch(/const path\s*=\s*Array\.isArray\(route0\.path\)/);
    expect(src).toMatch(/role:\s*'origin'/);
    expect(src).toMatch(/role:\s*'destination'/);
    expect(src).toContain('return { ok: true, km, tollKRW, durationMin, path, points }');
  });
  it('/api/mood-route 응답 data 에 path/points 포함', () => {
    const src = readFileSync(r('api/mood-route.js'), 'utf8');
    expect(src).toMatch(/path:\s*route\.path/);
    expect(src).toMatch(/points:\s*route\.points/);
  });
});

describe('MoodRouteMap — 경로 선 + 마커 + 자가진단 (소스가드)', () => {
  const src = readFileSync(r('src/components/MoodRouteMap.tsx'), 'utf8');
  it('route.path 로 Polyline + points 로 출발/경유/도착 마커', () => {
    expect(src).toContain('naver.maps.Polyline');
    expect(src).toMatch(/route\.path\.map/);
    expect(src).toMatch(/for \(const p of route\.points\)/);
    expect(src).toContain('ROLE_LABEL');
  });
  it('거리·소요시간 뱃지', () => {
    expect(src).toMatch(/route\.km[\s\S]{0,30}route\.durationMin/);
  });
  it('NCP 인증 실패 자가진단 (navermap_authFailure) + 링크 폴백 (graceful)', () => {
    expect(src).toContain('VITE_NCP_MAP_CLIENT_ID');
    expect(src).toContain('navermap_authFailure');
    expect(src).toMatch(/authFailed/);
    expect(src).toContain('naverMapSearchUrl');
    expect(src).toMatch(/showEmbed\s*=\s*!!clientId/);
  });
  it('훅이 early-return 위에서 호출 (rules-of-hooks 회귀 방지)', () => {
    const earlyReturn = src.indexOf('if (!linkTarget && !hasRoute) return null');
    const useEffectIdx = src.indexOf('useEffect(');
    const useStateIdx = src.indexOf('useState');
    expect(earlyReturn).toBeGreaterThan(0);
    expect(useEffectIdx).toBeGreaterThan(0);
    expect(useEffectIdx).toBeLessThan(earlyReturn);
    expect(useStateIdx).toBeLessThan(earlyReturn);
  });
});

describe('MoodPortal — route(path/points) 를 지도에 전달', () => {
  const portal = readFileSync(r('src/pages/MoodPortal.tsx'), 'utf8');
  it('MoodRoute 타입 path/points + 지도에 route 전달', () => {
    expect(portal).toMatch(/import\s*\{\s*MoodRouteMap\s*\}/);
    expect(portal).toMatch(/path:\s*\[number,\s*number\]\[\]/);
    expect(portal).toMatch(/points:\s*MoodRoutePoint\[\]/);
    expect(portal).toMatch(/<MoodRouteMap[\s\S]{0,200}route=\{route\}/);
  });
});
