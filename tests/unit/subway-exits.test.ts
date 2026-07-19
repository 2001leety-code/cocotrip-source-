// 지하철 출구 번호 안내 (2026-07-20).
//
// prod provider 가 TMAP 인데 TMAP 응답에는 출구가 없다(raw 전수 스캔 확인).
// TAGO 지하철정보도 답이 아니다 — 공식 스펙상 출구 레코드에 **위경도가 아예 없어**
// "목적지에서 가장 가까운 출구"를 고를 수 없다. 그래서 OSM 출입구 노드를 쓴다.
//
// 🔴 이 기능의 실패 모드는 두 가지고, 아래 테스트가 각각을 막는다:
//   ① 이웃 역 출구 번호를 주는 것 — 출구 번호는 역마다 독립이라 그냥 틀린 안내다.
//   ② 환승역에 출구를 붙이는 것 — 환승은 역 안에서 일어나는데 "나가라"로 읽힌다.
import { describe, it, expect } from 'vitest';
import { resolveStationExit, canonicalStationName, _indexSize } from '../../api/_subway_exits.js';
import { mapTmapItineraryToRoute } from '../../api/_tmap_helper.js';
import index from '../../api/_subway_exits.json';

const at = (lat: number, lng: number, name?: string) => ({ lat, lng, name });

describe('resolveStationExit — 목적지 방향에 따라 다른 출구', () => {
  it('명동역에서 북쪽과 남쪽 목적지는 서로 다른 출구가 나온다', () => {
    const myeongdong = at(37.5636, 126.9827, '명동');
    const north = resolveStationExit(myeongdong, { lat: 37.5672, lng: 126.9827 });
    const south = resolveStationExit(myeongdong, { lat: 37.5600, lng: 126.9827 });
    expect(north).toBeTruthy();
    expect(south).toBeTruthy();
    expect(north).not.toBe(south);
  });

  it('강남역 동/서 목적지도 갈린다', () => {
    const gangnam = at(37.4979, 127.0276, '강남');
    expect(resolveStationExit(gangnam, { lat: 37.4979, lng: 127.0321 }))
      .not.toBe(resolveStationExit(gangnam, { lat: 37.4979, lng: 127.0231 }));
  });
});

describe('🔴 이웃 역 오인 방지', () => {
  it('명동과 을지로입구는 270m 거리인데 서로 다른 출구 집합을 쓴다', () => {
    // 좌표만으로 역을 고르면 명동 조회가 을지로입구 출구를 물어온다(실제로 그랬다).
    // 이름을 먼저 보게 해서 막는다.
    const target = { lat: 37.5650, lng: 126.9827 };
    const myeongdong = resolveStationExit(at(37.5636, 126.9827, '명동'), target);
    const euljiro = resolveStationExit(at(37.5660, 126.9826, '을지로입구'), target);
    expect(myeongdong).toBeTruthy();
    expect(euljiro).toBeTruthy();
    // 두 역의 출구 목록이 분리돼 있어야 한다
    const md = index.find((e) => e[0] === '명동');
    const ej = index.find((e) => e[0] === '을지로입구');
    expect(md, '명동 클러스터').toBeTruthy();
    expect(ej, '을지로입구 클러스터').toBeTruthy();
    expect(md![3].length).toBeGreaterThan(5);
    expect(ej![3].length).toBeGreaterThan(5);
  });

  it('동명이역은 좌표로 갈린다 — 시청(서울/부산/대전)', () => {
    const seoul = resolveStationExit(at(37.5636, 126.9770, '시청'), { lat: 37.5663, lng: 126.9770 });
    const busan = resolveStationExit(at(35.1798, 129.0769, '시청'), { lat: 35.1825, lng: 129.0769 });
    expect(seoul).toBeTruthy();
    expect(busan).toBeTruthy();
    expect(index.filter((e) => e[0] === '시청').length).toBeGreaterThanOrEqual(2);
  });

  it('이름을 못 맞추고 좌표도 멀면 아무것도 주지 않는다', () => {
    // 역에서 한참 떨어진 좌표 — 200m 좌표 폴백에도 안 걸린다.
    expect(resolveStationExit(at(37.4000, 127.4000, '없는역이름'), { lat: 37.4001, lng: 127.4001 })).toBeNull();
  });

  it('잘못된 입력은 조용히 null', () => {
    expect(resolveStationExit(null, { lat: 37.5, lng: 127 })).toBeNull();
    expect(resolveStationExit(at(37.5, 127, '강남'), null)).toBeNull();
    expect(resolveStationExit(at(NaN, 127, '강남'), { lat: 37.5, lng: 127 })).toBeNull();
  });
});

describe('canonicalStationName — 공식 데이터 표기 흔들림 흡수', () => {
  it('"역" 접미사를 떼어 같은 역으로 묶는다', () => {
    // 공식 데이터가 "홍대입구"와 "홍대입구역"을 따로 실어 출구가 5+4 로 쪼개져 있었다.
    expect(canonicalStationName('홍대입구역')).toBe('홍대입구');
    expect(canonicalStationName('홍대입구')).toBe('홍대입구');
    expect(canonicalStationName('서울역')).toBe('서울');
  });

  it('괄호 부제를 제거한다', () => {
    expect(canonicalStationName('자양(뚝섬한강공원)')).toBe('자양');
  });

  it('짧은 이름의 "역"은 건드리지 않는다', () => {
    expect(canonicalStationName('역곡')).toBe('역곡'); // 접미사가 아니라 이름의 일부
  });
});

describe('출구 인덱스 무결성', () => {
  const rows = index as [string, number, number, [string, number, number][]][];

  it('모든 역이 이름·좌표·출구를 갖는다', () => {
    expect(rows.length).toBeGreaterThan(800);
    expect(rows.every((r) => r[0] && Number.isFinite(r[1]) && Number.isFinite(r[2]) && r[3].length)).toBe(true);
  });

  it('한 역 안에 같은 출구 번호가 중복되지 않는다', () => {
    const bad = rows.filter((r) => new Set(r[3].map((e) => e[0])).size !== r[3].length);
    expect(bad.map((r) => r[0])).toEqual([]);
  });

  it('알려진 역의 출구 수가 실제와 맞는다', () => {
    // nullish 연산자는 레포 mojibake 검사기가 깨진 글자로 오인해 커밋을 막는다 → `||` 사용.
    const count = (n: string) => (rows.find((r) => r[0] === n) || [, , , []])[3].length || 0;
    expect(count('강남')).toBe(12);       // 실제 1~12번
    expect(count('홍대입구')).toBe(9);     // 실제 1~9번
    expect(count('이태원')).toBe(4);       // 실제 1~4번
    expect(count('반월당')).toBe(23);      // 대구 최대 규모
  });

  it('헬퍼가 인덱스를 실제로 읽는다 (경로가 틀리면 조용히 빈 배열이 된다)', () => {
    expect(_indexSize()).toBe(rows.length);
  });
});

describe('mapTmapItineraryToRoute — 출구는 들어갈 때와 나올 때만', () => {
  /** 강남(2호선)→교대 환승→경복궁(3호선). 실제 TMAP 응답 형태. */
  const transferItinerary = {
    totalTime: 1800, totalDistance: 9000, transferCount: 1, pathType: 1,
    fare: { regular: { totalFare: 1400 } },
    legs: [
      { mode: 'WALK', sectionTime: 300, distance: 250, start: { name: '출발지', lon: 127.0276, lat: 37.4979 }, end: { name: '강남', lon: 127.0276, lat: 37.4979 } },
      { mode: 'SUBWAY', sectionTime: 400, distance: 3000, route: '수도권2호선', start: { name: '강남', lon: 127.0276, lat: 37.4979 }, end: { name: '교대', lon: 127.0146, lat: 37.4935 } },
      { mode: 'SUBWAY', sectionTime: 800, distance: 6000, route: '수도권3호선', start: { name: '교대', lon: 127.0146, lat: 37.4935 }, end: { name: '경복궁', lon: 126.9737, lat: 37.5759 } },
      { mode: 'WALK', sectionTime: 200, distance: 180, start: { name: '경복궁', lon: 126.9737, lat: 37.5759 }, end: { name: '도착지', lon: 126.9770, lat: 37.5759 } },
    ],
  };

  it('첫 승차역과 마지막 하차역에만 출구가 붙는다', () => {
    const r = mapTmapItineraryToRoute(transferItinerary)!;
    const subways = r.steps.filter((s: { mode: string }) => s.mode === 'subway') as Record<string, unknown>[];
    expect(subways.length).toBe(2);
    expect(subways[0].fromExit, '첫 승차역 강남').toBeTruthy();
    expect(subways[0].toExit, '환승역 교대는 나가는 곳이 아니다').toBeUndefined();
    expect(subways[1].fromExit, '환승역 교대는 들어오는 곳이 아니다').toBeUndefined();
    expect(subways[1].toExit, '마지막 하차역 경복궁').toBeTruthy();
  });

  it('좌표가 없으면 필드를 아예 안 싣는다', () => {
    const noCoord = {
      ...transferItinerary,
      legs: transferItinerary.legs.map((l) => ({ ...l, start: { name: l.start.name }, end: { name: l.end.name } })),
    };
    const subways = mapTmapItineraryToRoute(noCoord)!.steps
      .filter((s: { mode: string }) => s.mode === 'subway') as Record<string, unknown>[];
    expect(subways.every((s) => s.fromExit === undefined && s.toExit === undefined)).toBe(true);
  });
});
