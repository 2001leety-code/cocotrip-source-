// 버스 정류장 좌표 → 간판 ARS 번호 매칭 (2026-07-19).
//
// 배경: prod provider 가 TMAP 인데 TMAP 응답에는 ARS 번호가 없다(raw 전수 스캔 확인).
// TransitArrow·PDF 는 `fromArs`/`toArs` 를 이미 렌더하므로 데이터만 채우면 화면에 나온다.
//
// 🔴 이 기능의 유일한 실패 모드: **반대편 승강장 번호를 알려주는 것.**
// 버스 정류장은 양방향이 10~40m 거리에 서로 다른 ARS 를 가진다. 아래 테스트는
// 그 오인을 막는 규칙(이름 우선 → 거리 + 격차 → 아니면 포기)을 고정한다.
import { describe, it, expect } from 'vitest';
import { resolveBusArs, _indexSize } from '../../api/_seoul_bus_ars.js';
import { mapTmapItineraryToRoute } from '../../api/_tmap_helper.js';
import index from '../../api/_seoul_bus_ars.json';

describe('resolveBusArs — 이름이 거리보다 강한 단서', () => {
  it('이름이 맞으면 그 정류장을 준다', () => {
    // TMAP 실응답 좌표(서울시청→잠실 472번 승차지점)
    expect(resolveBusArs(37.56526, 126.97879, '서울광장')).toBe('02641');
  });

  it('🔴 8m 옆에 다른 정류장이 있어도 이름이 맞는 쪽을 고른다', () => {
    // 실제 사고 케이스: 좌표만 보면 "방배(백석예술대)역3번출구"(22981)가 2.2m 로 더 가깝고
    // "방배역"(22808)은 8.3m 다. 거리만 믿으면 틀린 승강장을 안내하게 된다.
    expect(resolveBusArs(37.48123, 126.99649, '방배역')).toBe('22808');
  });

  it('같은 이름 양방향 쌍은 이름으로 좁힌 뒤 거리로 가른다', () => {
    // 잠실역.롯데월드 는 24146·24138 두 개가 같은 이름으로 존재한다.
    expect(resolveBusArs(37.51256, 127.0982, '잠실역.롯데월드')).toBe('24146');
    expect(resolveBusArs(37.51295, 127.09776, '잠실역.롯데월드')).toBe('24138');
  });

  it('이름이 없고 후보가 붙어 있으면 포기한다 (틀린 번호보다 무번호가 낫다)', () => {
    // 같은 좌표, 이름 미제공 → 22981(2.2m)·22808(8.3m) 격차가 6m 라 판단 불가.
    expect(resolveBusArs(37.48123, 126.99649)).toBeNull();
  });

  it('이름이 안 맞아도 후보가 하나뿐이고 충분히 가까우면 채택한다', () => {
    // TMAP 이 "○○(중)" 처럼 중앙차로 접미사를 붙여 이름이 어긋나는 경우의 구제 경로.
    expect(resolveBusArs(37.56981, 126.98775, '이름이전혀다름')).toBe('01001');
  });

  it('서울 밖 좌표는 후보가 없어 null (데이터셋이 서울 전용)', () => {
    expect(resolveBusArs(35.1796, 129.0756, '부산시청')).toBeNull(); // 부산
  });

  it('잘못된 입력은 조용히 null', () => {
    expect(resolveBusArs(NaN, 126.9, '아무개')).toBeNull();
    expect(resolveBusArs(undefined as unknown as number, undefined as unknown as number)).toBeNull();
  });
});

describe('ARS 인덱스 무결성', () => {
  const rows = index as [string, number, number, string][];

  it('전건이 5자리 문자열이다 — 숫자로 저장하면 선행 0 이 날아간다', () => {
    expect(rows.every((r) => /^\d{5}$/.test(r[0]))).toBe(true);
  });

  it('선행 0 ARS 가 보존돼 있다 (CSV 경로로 받으면 30% 가 깨진다)', () => {
    // 실측 3,422건(30.4%). 이 수가 0 이 되면 어딘가에서 숫자 변환이 일어난 것.
    expect(rows.filter((r) => r[0].startsWith('0')).length).toBeGreaterThan(3000);
  });

  it('좌표 결측이 없고 전건이 서울 안에 있다', () => {
    expect(rows.some((r) => !Number.isFinite(r[1]) || !Number.isFinite(r[2]))).toBe(false);
    expect(rows.some((r) => r[1] < 37.4 || r[1] > 37.72 || r[2] < 126.7 || r[2] > 127.25)).toBe(false);
  });

  it('헬퍼가 인덱스를 실제로 읽는다 (경로가 틀리면 조용히 빈 배열이 된다)', () => {
    expect(_indexSize()).toBe(rows.length);
    expect(_indexSize()).toBeGreaterThan(11000);
  });
});

describe('mapTmapItineraryToRoute — 버스 step 에 ARS 가 실린다', () => {
  const itinerary = {
    totalTime: 900, totalDistance: 4000, transferCount: 0, pathType: 2,
    fare: { regular: { totalFare: 1500 } },
    legs: [{
      mode: 'BUS', sectionTime: 900, distance: 4000, route: '간선:472',
      start: { name: '서울광장', lon: 126.97879, lat: 37.56526 },
      end: { name: '신사중학교', lon: 127.02063, lat: 37.52308 },
    }],
  };

  it('승·하차 정류장 번호를 채운다', () => {
    const r = mapTmapItineraryToRoute(itinerary)!;
    const bus = r.steps.find((s: { mode: string }) => s.mode === 'bus')! as Record<string, unknown>;
    expect(bus.fromArs).toBe('02641');
    expect(bus.toArs).toBe('23101');
  });

  it('좌표가 없으면 필드를 아예 안 싣는다 (빈 문자열로 화면에 구멍 내지 않기)', () => {
    const noCoord = {
      ...itinerary,
      legs: [{ ...itinerary.legs[0], start: { name: '서울광장' }, end: { name: '신사중학교' } }],
    };
    const bus = mapTmapItineraryToRoute(noCoord)!.steps
      .find((s: { mode: string }) => s.mode === 'bus')! as Record<string, unknown>;
    expect(bus.fromArs).toBeUndefined();
    expect(bus.toArs).toBeUndefined();
  });
});
