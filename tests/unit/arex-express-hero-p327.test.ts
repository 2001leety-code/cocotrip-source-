/**
 * P327 (2026-05-31): AREX 직통열차(Express) HERO 합성 회귀 슈트.
 *
 * 배경: ICN→명동 HERO 가 ODsay path[0](일반열차→홍대입구→2호선 79분 indirect)를 보여주면서
 * recommended_option 라벨은 "AREX Express 가장 빠름"(하드코딩) → 라벨↔데이터 자가모순. ODsay 는
 * express 를 별도 path 로 못 줘서(SPType 없음) HERO 에 직통(고정 시간/요금) + 서울역→호텔
 * last-mile(실 ODsay)을 합성. buildPrompt 0 (백엔드 합성 = cache miss 0).
 *
 * 검증: 게이트(비-ICN/원거리/last-mile 실패 → null = 기존 route 유지 안전) + 합성 값(시간/요금/환승
 * 누적, 직통 step, fromStationName=인천공항N터미널역 P274 가드 통과) + HERO 주입 wiring.
 *
 * _buildArexExpressHero 는 this._routeAirportHotel(ODsay 의존)만 외부 호출 → Object.create 로
 * 인스턴스 만들고 해당 메서드만 stub (env/생성자 불필요).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RouteAgent,
  AREX_EXPRESS,
  AREX_EXPRESS_FARE_KRW,
  AREX_EXPRESS_MAX_KM_FROM_SEOUL_STN,
} from '../../api/_ai_core/agents/RouteAgent.js';

const ROOT = resolve(__dirname, '../..');
const routeAgentSrc = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');

const MYEONGDONG = { lat: 37.5635, lng: 126.9821 }; // 서울역에서 ~1.4km (게이트 안)
const GANGNAM = { lat: 37.4979, lng: 127.0276 }; // 서울역에서 ~8km (게이트 밖)

const FAKE_LASTMILE_SUBWAY = {
  method: 'subway', mode: 'subway', instruction: '4호선 서울역→명동',
  step_by_step: ['4호선 서울역 → 명동 (2정거장)'],
  steps_detail: [{ mode: 'subway', lineKo: '4호선', from: '서울역', to: '명동', duration: 3, stationCount: 2 }],
  transfers: 0, total_walk_m: 200, est_min: 5, est_fare_krw: 1400,
  source: 'odsay', direction: 'arrival', fromStationName: '서울역', toStationName: '명동역',
};
const FAKE_LASTMILE_WALK = {
  method: 'walk', mode: 'walk', instruction: '도보',
  step_by_step: ['도보 18분'], steps_detail: [{ mode: 'walk', duration: 18, distance: 1300 }],
  transfers: 0, total_walk_m: 1300, est_min: 18, est_fare_krw: 0,
  source: 'odsay', direction: 'arrival', fromStationName: null, toStationName: null,
};

function makeAgent(lastMile: unknown) {
  const a = Object.create(RouteAgent.prototype) as Record<string, unknown> & {
    _buildArexExpressHero: (k: string, d: unknown, c?: string, s?: string) => Promise<Record<string, unknown> | null>;
  };
  a._routeAirportHotel = vi.fn(async () => lastMile);
  return a;
}

describe('P327 AREX express 상수', () => {
  it('T1=43분 / T2=51분 / generic=43 / fare ₩9,500 / 게이트 6km', () => {
    expect(AREX_EXPRESS.ICN_T1.express_min).toBe(43);
    expect(AREX_EXPRESS.ICN_T2.express_min).toBe(51);
    expect(AREX_EXPRESS.ICN.express_min).toBe(43);
    expect(AREX_EXPRESS.ICN_T1.from_station).toBe('인천공항1터미널역');
    expect(AREX_EXPRESS.ICN_T2.from_station).toBe('인천공항2터미널역');
    expect(AREX_EXPRESS_FARE_KRW).toBe(9500);
    expect(AREX_EXPRESS_MAX_KM_FROM_SEOUL_STN).toBe(6);
  });
});

describe('P327 게이트 — early return (ODsay 미호출 = 안전)', () => {
  it('비-ICN 공항(GMP/PUS) → null + _routeAirportHotel 미호출', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    expect(await a._buildArexExpressHero('GMP', MYEONGDONG)).toBeNull();
    expect(await a._buildArexExpressHero('PUS', MYEONGDONG)).toBeNull();
    expect(a._routeAirportHotel).not.toHaveBeenCalled();
  });
  it('서울역 6km 초과(강남) → null + ODsay 미호출', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    expect(await a._buildArexExpressHero('ICN_T1', GANGNAM)).toBeNull();
    expect(a._routeAirportHotel).not.toHaveBeenCalled();
  });
  it('destCoord 누락/좌표 null → null', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    expect(await a._buildArexExpressHero('ICN_T1', null)).toBeNull();
    expect(await a._buildArexExpressHero('ICN_T1', { lat: null, lng: null })).toBeNull();
  });
  it('P-launch: last-mile ODsay 실패 + 도보권(≤2.5km, 명동) → walk fallback 으로 직통 빌드', async () => {
    const a = makeAgent(null); // _routeAirportHotel → null
    const r = await a._buildArexExpressHero('ICN_T1', MYEONGDONG);
    expect(r).not.toBeNull(); // 도보 last-mile 합성 (이전엔 null)
    const sd = r!.steps_detail as Array<Record<string, unknown>>;
    expect(sd[sd.length - 1].mode).toBe('walk');
    expect(r!.transfers).toBe(0);
  });
  it('P-launch: last-mile 실패 + 도보 불가(>2.5km) → null (안전, 기존 route 유지)', async () => {
    const a = makeAgent(null);
    const HONGDAE_FAR = { lat: 37.5563, lng: 126.9236 }; // 서울역 ~4.1km (6km 게이트 안, 도보 cap 밖)
    expect(await a._buildArexExpressHero('ICN_T1', HONGDAE_FAR)).toBeNull();
  });
});

describe('P327 합성 — 명동 (subway last-mile)', () => {
  it('직통 43분 + last-mile 5분 = 48분, 요금 ₩9,500+₩1,400, 환승 1', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    const r = await a._buildArexExpressHero('ICN_T1', MYEONGDONG);
    expect(r).not.toBeNull();
    expect(r!.est_min).toBe(48);
    expect(r!.est_fare_krw).toBe(10900);
    expect(r!.transfers).toBe(1); // last-mile 0 + 서울역 환승 1
    expect(r!.method).toBe('subway');
    expect(r!.source).toBe('arex_express_synth');
    expect(r!._arex_express).toBe(true);
  });
  it('steps_detail[0] = 직통 구간 (인천공항1터미널역→서울역 무정차) + last-mile 이어붙임', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    const r = await a._buildArexExpressHero('ICN_T1', MYEONGDONG);
    const s0 = (r!.steps_detail as Array<Record<string, unknown>>)[0];
    expect(s0.mode).toBe('subway');
    expect(s0.from).toBe('인천공항1터미널역');
    expect(s0.to).toBe('서울역');
    expect(s0.stationCount).toBe(0); // 무정차
    expect(r!.steps_detail).toHaveLength(2); // 직통 + last-mile 1
    expect((r!.step_by_step as string[])[0]).toMatch(/AREX 직통/);
  });
  it('fromStationName=인천공항1터미널역 → P274 terminal 가드 통과(1터미널 매칭)', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    const r = await a._buildArexExpressHero('ICN_T1', MYEONGDONG);
    expect(r!.fromStationName).toBe('인천공항1터미널역');
    expect(/1터미널/.test(r!.fromStationName as string)).toBe(true);
  });
  it('T2 → 51분 + 인천공항2터미널역', async () => {
    const a = makeAgent(FAKE_LASTMILE_SUBWAY);
    const r = await a._buildArexExpressHero('ICN_T2', MYEONGDONG);
    expect(r!.est_min).toBe(56); // 51 + 5
    expect(r!.fromStationName).toBe('인천공항2터미널역');
    expect((r!.steps_detail as Array<Record<string, unknown>>)[0].from).toBe('인천공항2터미널역');
  });
});

describe('P327 합성 — walk last-mile', () => {
  it('도보 last-mile → 환승 0 (서울역 환승 없음)', async () => {
    const a = makeAgent(FAKE_LASTMILE_WALK);
    const r = await a._buildArexExpressHero('ICN', MYEONGDONG);
    expect(r!.transfers).toBe(0);
    expect(r!.est_min).toBe(61); // 43 + 18
  });
});

describe('P327 HERO 주입 wiring (source-grep 가드)', () => {
  it('HERO 블록이 ICN 게이트 + rec.key===arex_express 일 때만 직통 합성 호출', () => {
    expect(routeAgentSrc).toMatch(/isIcnArrival\s*&&\s*rec\.key\s*===\s*['"]arex_express['"]/);
    expect(routeAgentSrc).toMatch(/_buildArexExpressHero\(\s*arrivalAirportKey\s*,\s*arrFromCoord/);
  });
  it('heroRoute 가 write + P275 station 가드에 사용 (route 직접 아님)', () => {
    expect(routeAgentSrc).toMatch(/_verifyAirportStation\(\s*arrivalAirportKey\s*,\s*heroRoute\.fromStationName\s*\)/);
    expect(routeAgentSrc).toMatch(/route_to_hotel\s*=\s*\{\s*\.\.\.heroRoute/);
  });
  it('heavy-luggage(charter)/late-night(limousine) 추천은 직통 미적용 (rec.key 게이트로 보장)', () => {
    // rec.key === 'arex_express' 분기 안에서만 호출 → charter/limousine 추천은 기존 route.
    expect(routeAgentSrc).toMatch(/if\s*\(\s*isIcnArrival\s*&&\s*rec\.key\s*===\s*['"]arex_express['"]\s*\)/);
  });
});
