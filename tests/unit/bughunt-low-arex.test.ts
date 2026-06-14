/**
 * BUGHUNT-LOW (2026-06-14): AREX 급행 HERO 합성 ↔ TMAP native 경로 충돌 회귀 슈트.
 *
 * 배경: _buildArexExpressHero(P327) 는 ICN 도착 + rec.key==='arex_express' 면 TRANSIT_PROVIDER
 * 무관하게 발동해 ODsay 가 반환한 route 를 ICN→서울역 직통(₩9,500, 43/51분) + 서울역→호텔 last-mile
 * 합성으로 교체했다. 이 합성은 원래 ODsay 가 express path 를 못 줘서 만든 우회책. 그런데 TMAP 은
 * ICN→명동을 native 로 ₩4,600(공항철도 급행+4호선) 코히어런트하게 반환하므로, TMAP 활성 시 합성이
 * 그 ₩4,600 native 경로를 ₩9,500+last-mile 로 덮어 서울 중심부 호텔에서 더 비싸고 덜 정확해졌다.
 *
 * 수정: 합성 발동을 getTransitProvider()==='odsay' 일 때만(_transit_provider.js export). TMAP 활성
 * 시 _buildArexExpressHero 호출 skip → _routeAirportHotel 이 이미 반환한 TMAP native route 를 그대로
 * HERO 로 사용 + rec(arex_express) 강등 안 함(TMAP native 는 코히어런트). ODsay(폴백 포함 primary)
 * 일 땐 기존대로 합성 유지(ODsay 는 여전히 express path 못 줌 → 합성 필요).
 *
 * _buildArexExpressHero 자체는 provider-agnostic 순수 합성기 (게이트는 호출부) → 직접 호출은 ODsay
 * 경로 동작 보존 검증용. provider 게이트/무강등 wiring 은 source-grep 으로 검증.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { getTransitProvider } from '../../api/_transit_provider.js';

const ROOT = resolve(__dirname, '../..');
const routeAgentSrc = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');

const MYEONGDONG = { lat: 37.5635, lng: 126.9821 }; // 서울역에서 ~1.4km (게이트 안)

const FAKE_LASTMILE_SUBWAY = {
  method: 'subway', mode: 'subway', instruction: '4호선 서울역→명동',
  step_by_step: ['4호선 서울역 → 명동 (2정거장)'],
  steps_detail: [{ mode: 'subway', lineKo: '4호선', from: '서울역', to: '명동', duration: 3, stationCount: 2 }],
  transfers: 0, total_walk_m: 200, est_min: 5, est_fare_krw: 1400,
  source: 'odsay', direction: 'arrival', fromStationName: '서울역', toStationName: '명동역',
};

function makeAgent(lastMile: unknown) {
  const a = Object.create(RouteAgent.prototype) as Record<string, unknown> & {
    _buildArexExpressHero: (k: string, d: unknown, c?: string, s?: string) => Promise<Record<string, unknown> | null>;
  };
  a._routeAirportHotel = vi.fn(async () => lastMile);
  return a;
}

describe('BUGHUNT-LOW: _transit_provider getTransitProvider 게이트 가능', () => {
  const orig = process.env.TRANSIT_PROVIDER;
  afterEach(() => { if (orig === undefined) delete process.env.TRANSIT_PROVIDER; else process.env.TRANSIT_PROVIDER = orig; });

  it('기본(env 없음) → odsay = 합성 유지 경로', () => {
    delete process.env.TRANSIT_PROVIDER;
    expect(getTransitProvider()).toBe('odsay');
  });
  it('TRANSIT_PROVIDER=tmap → tmap = 합성 skip 경로', () => {
    process.env.TRANSIT_PROVIDER = 'tmap';
    expect(getTransitProvider()).toBe('tmap');
  });
});

describe('BUGHUNT-LOW: ODsay 경로 동작 보존 (_buildArexExpressHero 직접 합성)', () => {
  // 합성기 자체는 호출되면(=ODsay 경로) 기존 P327 동작 그대로 — 회귀 방지.
  it('ICN_T1 명동 → 직통 43분 + last-mile 5분 = 48분 / ₩10,900 합성', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    const r = await a._buildArexExpressHero('ICN_T1', MYEONGDONG);
    expect(r).not.toBeNull();
    expect(r!.est_min).toBe(48);
    expect(r!.est_fare_krw).toBe(10900);
    expect(r!.source).toBe('arex_express_synth');
    expect(r!.fromStationName).toBe('인천공항1터미널역'); // P274/P275 가드 통과
  });
});

describe('BUGHUNT-LOW: provider 게이트 wiring (source-grep)', () => {
  it('getTransitProvider 가 _transit_provider 에서 import 됨', () => {
    expect(routeAgentSrc).toMatch(
      /import\s*\{[^}]*\bgetTransitProvider\b[^}]*\}\s*from\s*['"][^'"]*_transit_provider\.js['"]/,
    );
  });
  it('HERO 블록이 getTransitProvider()===odsay 일 때만 _buildArexExpressHero 호출', () => {
    // odsay 면 합성, 아니면 express=null (TMAP native route 유지).
    expect(routeAgentSrc).toMatch(/getTransitProvider\(\)\s*===\s*['"]odsay['"]/);
    expect(routeAgentSrc).toMatch(
      /arexProviderOdsay\s*\?\s*await\s+this\._buildArexExpressHero\(\s*arrivalAirportKey\s*,\s*arrFromCoord/,
    );
    expect(routeAgentSrc).toMatch(/:\s*null\s*;/);
  });
  it('TMAP 활성(express=null & !arexProviderOdsay) → rec 강등 안 함 (native 는 코히어런트)', () => {
    // public_transit 강등은 ODsay 합성 실패(else) 에서만. TMAP skip 은 별도 else if 로 route/rec 유지.
    expect(routeAgentSrc).toMatch(/else\s+if\s*\(\s*!arexProviderOdsay\s*\)/);
    // 강등 effectiveRec= 가 !arexProviderOdsay 가지 아래(else) 에 위치 = TMAP 경로엔 미적용.
    const tmapBranchIdx = routeAgentSrc.indexOf('!arexProviderOdsay');
    const downgradeIdx = routeAgentSrc.indexOf("key: 'public_transit'");
    expect(tmapBranchIdx).toBeGreaterThan(0);
    expect(downgradeIdx).toBeGreaterThan(tmapBranchIdx); // 강등 분기가 TMAP skip 분기 뒤
  });
});
