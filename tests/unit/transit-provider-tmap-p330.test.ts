/**
 * P330 (2026-05-31): 대중교통 provider 스위치 (ODsay ↔ TMAP) 회귀 슈트.
 *
 * 운영자 의도: "전환은 아직, 구현만 — 언제든 env 한 줄로 바꿔낄 수 있게." 기본 ODsay(prod 무영향).
 * TMAP client 는 ODsay searchTransitRoute 와 100% 동일 출력 shape 반환 → formatTransitSummary
 * / RouteAgent 매핑 변경 0. fixture = 2026-05-31 실제 TMAP 응답 구조(경복궁→홍대 버스, ICN→명동 지하철).
 *
 * 검증: (1) TMAP itinerary → ODsay raw shape 매핑 정확 (2) searchDttm daytime 보정 (3) provider
 * 기본 odsay + env 스위치 (4) 호출부가 provider-aware searchTransit 사용 (직접 ODsay 아님).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapTmapItineraryToRoute, buildSearchDttm } from '../../api/_tmap_helper.js';
import { getTransitProvider } from '../../api/_transit_provider.js';

const ROOT = resolve(__dirname, '../..');

// 실제 TMAP 응답 구조 (2026-05-31 캡쳐) — 경복궁 → 합정/홍대 (버스 2회 환승)
const FIXTURE_BUS = {
  pathType: 2, totalTime: 2425, transferCount: 1, totalWalkDistance: 756, totalDistance: 8353,
  fare: { regular: { totalFare: 1500 } },
  legs: [
    { mode: 'WALK', sectionTime: 293, distance: 356, start: { name: '출발지' }, end: { name: '경복궁.국립민속박물관' } },
    { mode: 'BUS', sectionTime: 490, distance: 2085, route: '마을:종로11', start: { name: '경복궁.국립민속박물관' }, end: { name: '삼성본관앞' }, passStopList: { stationList: [{ stationName: 'a' }, { stationName: 'b' }] } },
    { mode: 'WALK', sectionTime: 0, distance: 0, start: { name: '삼성본관앞' }, end: { name: '삼성본관앞' } },
    { mode: 'BUS', sectionTime: 1340, distance: 5733, route: '지선:7011', start: { name: '삼성본관앞' }, end: { name: '극동방송' }, passStopList: { stationList: [] } },
    { mode: 'WALK', sectionTime: 302, distance: 400, start: { name: '극동방송' }, end: { name: '도착지' } },
  ],
};

// ICN T1 → 명동 (공항철도 급행 + 4호선) — AREX 직통 native 검증
const FIXTURE_SUBWAY = {
  pathType: 1, totalTime: 3780, transferCount: 1, totalWalkDistance: 900, totalDistance: 60000,
  fare: { regular: { totalFare: 4600 } },
  legs: [
    { mode: 'WALK', sectionTime: 0, distance: 5, start: { name: '출발지' }, end: { name: '인천공항1터미널' } },
    { mode: 'SUBWAY', sectionTime: 2580, distance: 50000, route: '공항철도(급행)', start: { name: '인천공항1터미널' }, end: { name: '서울역' }, passStopList: { stationList: [] } },
    { mode: 'WALK', sectionTime: 360, distance: 300, start: { name: '서울역' }, end: { name: '서울역' } },
    { mode: 'SUBWAY', sectionTime: 240, distance: 1500, route: '수도권4호선', start: { name: '서울역' }, end: { name: '명동' }, passStopList: { stationList: [{ stationName: '회현' }, { stationName: '명동' }] } },
    { mode: 'WALK', sectionTime: 540, distance: 400, start: { name: '명동' }, end: { name: '도착지' } },
  ],
};

describe('P330 mapTmapItineraryToRoute — ODsay raw shape 호환 (버스)', () => {
  const r = mapTmapItineraryToRoute(FIXTURE_BUS)!;
  it('top-level: type/totalTime(분)/fare/transfers/거리', () => {
    expect(r.type).toBe('bus'); // pathType 2
    expect(r.totalTime).toBe(40); // 2425s → 40분
    expect(r.fare).toBe(1500);
    expect(r.transfers).toBe(1);
    expect(r.totalWalk).toBe(756);
    expect(r.distance).toBe(8353);
    expect(r._provider).toBe('tmap');
  });
  it('0초 walk leg 스킵 → steps 4개 (walk2 + bus2)', () => {
    expect(r.steps).toHaveLength(4);
    expect(r.steps.filter((s: Record<string, unknown>) => s.mode === 'walk')).toHaveLength(2);
    expect(r.steps.filter((s: Record<string, unknown>) => s.mode === 'bus')).toHaveLength(2);
  });
  it('bus step: busType/busNo 파싱 + from/to/duration/stationCount', () => {
    const bus = r.steps.find((s: Record<string, unknown>) => s.mode === 'bus') as Record<string, unknown>;
    expect(bus.busType).toBe('마을');
    expect(bus.busNo).toBe('종로11');
    expect(bus.from).toBe('경복궁.국립민속박물관');
    expect(bus.to).toBe('삼성본관앞');
    expect(bus.duration).toBe(8); // 490s → 8분
    expect(bus.stationCount).toBe(2);
  });
  it('firstStation/lastStation = 첫·마지막 transit leg', () => {
    expect(r.firstStation).toBe('경복궁.국립민속박물관');
    expect(r.lastStation).toBe('극동방송');
  });
  it('formatTransitSummary 가 읽는 키 전부 존재 (shape 호환)', () => {
    for (const k of ['type', 'totalTime', 'fare', 'transfers', 'totalWalk', 'firstStation', 'lastStation', 'steps']) {
      expect(r).toHaveProperty(k);
    }
  });
});

describe('P330 mapTmapItineraryToRoute — 지하철 + AREX 직통 (ICN→명동)', () => {
  const r = mapTmapItineraryToRoute(FIXTURE_SUBWAY)!;
  it('type subway + 공항철도 급행 직통 step 보존', () => {
    expect(r.type).toBe('subway');
    const sub = r.steps.find((s: Record<string, unknown>) => s.mode === 'subway') as Record<string, unknown>;
    expect(sub.line).toBe('공항철도(급행)');
    expect(sub.from).toBe('인천공항1터미널');
    expect(sub.to).toBe('서울역');
  });
  it('firstStation=인천공항1터미널 / lastStation=명동', () => {
    expect(r.firstStation).toBe('인천공항1터미널');
    expect(r.lastStation).toBe('명동');
  });
});

describe('P330 buildSearchDttm — 출발시각 (야간 daytime 보정)', () => {
  it('departDttm 명시 시 그대로', () => {
    expect(buildSearchDttm({ departDttm: '202607101030' })).toBe('202607101030');
  });
  // Date.UTC 로 KST 벽시계 앵커(러너 TZ 독립). buildSearchDttm 은 절대시각+9h → KST.
  // 예: 14:30 KST = 05:30 UTC. new Date(2026,6,10,14,30)(로컬TZ)은 UTC 러너(CI)에서 깨짐 → 고정.
  it('주간(14:30 KST)은 현재 시각', () => {
    expect(buildSearchDttm({}, new Date(Date.UTC(2026, 6, 10, 5, 30)))).toBe('202607101430');
  });
  it('새벽(03:00)·심야(23:00 KST)는 당일 10:00 보정 (야간버스 추천 방지)', () => {
    expect(buildSearchDttm({}, new Date(Date.UTC(2026, 6, 9, 18, 0)))).toBe('202607101000');  // 03:00 KST
    expect(buildSearchDttm({}, new Date(Date.UTC(2026, 6, 10, 14, 0)))).toBe('202607101000'); // 23:00 KST
  });
});

describe('P330 getTransitProvider — 기본 ODsay + env 스위치', () => {
  const orig = process.env.TRANSIT_PROVIDER;
  afterEach(() => { if (orig === undefined) delete process.env.TRANSIT_PROVIDER; else process.env.TRANSIT_PROVIDER = orig; });
  it('미설정 → odsay (prod 기본, 무영향)', () => {
    delete process.env.TRANSIT_PROVIDER;
    expect(getTransitProvider()).toBe('odsay');
  });
  it('tmap / TMAP(대소문자) → tmap', () => {
    process.env.TRANSIT_PROVIDER = 'tmap';
    expect(getTransitProvider()).toBe('tmap');
    process.env.TRANSIT_PROVIDER = 'TMAP';
    expect(getTransitProvider()).toBe('tmap');
  });
  it('odsay / 알 수 없는 값 → odsay (안전 기본)', () => {
    process.env.TRANSIT_PROVIDER = 'odsay';
    expect(getTransitProvider()).toBe('odsay');
    process.env.TRANSIT_PROVIDER = 'foobar';
    expect(getTransitProvider()).toBe('odsay');
  });
});

describe('P330 호출부 wiring (source-grep) — provider-aware searchTransit 사용', () => {
  const routeAgent = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
  const recalc = readFileSync(resolve(ROOT, 'api/recalc-transit.js'), 'utf8');
  const provider = readFileSync(resolve(ROOT, 'api/_transit_provider.js'), 'utf8');
  it('RouteAgent 가 _transit_provider.searchTransit 호출 (직접 searchTransitRoute 아님)', () => {
    expect(routeAgent).toMatch(/import\s*\{\s*searchTransit\s*\}\s*from\s*["'][^"']*_transit_provider\.js["']/);
    expect(routeAgent).toMatch(/await\s+searchTransit\(sx,\s*sy,\s*ex,\s*ey\)/);
    expect(routeAgent).not.toMatch(/await\s+searchTransitRoute\(/); // 직접 호출 제거됨
  });
  it('recalc-transit 도 searchTransit 사용', () => {
    expect(recalc).toMatch(/import\s*\{\s*searchTransit\s*\}\s*from\s*["']\.\/_transit_provider\.js["']/);
    expect(recalc).toMatch(/searchTransit\(prev\.lng/);
  });
  it('provider 기본값 odsay (prod 무영향 보장)', () => {
    expect(provider).toMatch(/TRANSIT_PROVIDER\s*\|\|\s*['"]odsay['"]/);
  });
});
