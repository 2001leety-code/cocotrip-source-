// TMAP 역명·노선명 외국어 표기 회귀 테스트 (2026-07-19).
//
// 배경 — prod 는 TRANSIT_PROVIDER=tmap 인데 `_tmap_helper.js` 가 `_transit_localization.js`
// 를 전혀 import 하지 않아 lineEn / fromRoman / toRoman 이 비어 있었다.
// 그런데 `translate-plan.js` 는 "en 은 lineEn/fromRoman 이 이미 있다"고 보고 en 을 건너뛴다
// (ODsay 시절 가정). 그 결과 TransitArrow 의 stationDisplay 가
// `paren = translated || roman` 에서 둘 다 undefined 를 받아 **한글 역명을 그대로** 반환했다.
// → 영어 사용자 화면·PDF 에 "수도권2호선 선릉 → 잠실" 이 한글로 노출.
//
// ja/zh 는 translate-plan 이 fromJa/fromZh 를 채워 무사했고, en 만 구멍이었다.
import { describe, it, expect } from 'vitest';
import { mapTmapItineraryToRoute } from '../../api/_tmap_helper.js';
import { localizeLineName } from '../../api/_transit_localization.js';

/** TMAP 실응답 형태(2026-07-19 프로브 실측). 노선명은 ODsay 와 달리 띄어쓰기가 없다. */
function itinerary(legs: unknown[]) {
  return {
    totalTime: 1200, totalDistance: 5000, transferCount: 0, pathType: 1,
    fare: { regular: { totalFare: 1400 } },
    legs,
  };
}

const subwayLeg = (route: string, from: string, to: string) => ({
  mode: 'SUBWAY', sectionTime: 600, distance: 4000, route,
  start: { name: from, lon: 127.0489, lat: 37.5044 },
  end: { name: to, lon: 127.1001, lat: 37.5133 },
});

const subwayStep = (route: string, from: string, to: string) => {
  const r = mapTmapItineraryToRoute(itinerary([subwayLeg(route, from, to)]))!;
  return r.steps.find((s: { mode: string }) => s.mode === 'subway')! as Record<string, unknown>;
};

describe('TMAP 지하철 step — 영어 표기 필드', () => {
  it('노선명을 정규화하고 영문을 채운다 (TMAP 은 "수도권2호선" 처럼 붙여서 준다)', () => {
    const s = subwayStep('수도권2호선', '선릉', '잠실');
    expect(s.line).toBe('수도권2호선');   // raw 는 보존 (ODsay 와 동일 계약)
    expect(s.lineKo).toBe('2호선');
    expect(s.lineEn).toBe('Line 2');
  });

  it('승·하차 역명 로마자를 채운다 — 이게 없으면 영어 화면에 한글이 그대로 나온다', () => {
    const s = subwayStep('수도권2호선', '선릉', '잠실');
    expect(s.fromRoman).toBe('Seolleung');
    expect(s.toRoman).toBe('Jamsil');
  });

  it('공식 표기가 TMAP lang=1 기계 로마자보다 정확하다', () => {
    // TMAP lang=1 실측: 홍대입구→"Hongdae", 잠실역.롯데월드→"Jamsil Station.Rosdeweoldeu".
    // 우리 표는 서울교통공사 공식 영문명을 쓴다.
    expect(subwayStep('수도권2호선', '홍대입구', '디지털미디어시티').fromRoman).toBe('Hongik Univ.');
    // 공식 영문역명 = 역 안내판 표기. 이전엔 중복키 때문에 'DMC' 로 덮어써져 있었다.
    expect(subwayStep('수도권2호선', '홍대입구', '디지털미디어시티').toRoman).toBe('Digital Media City');
  });

  it('공항철도 — TMAP 의 "수도권공항철도1호선" 도 영문으로 번역된다', () => {
    // 수도권 prefix 를 떼면 "공항철도1호선" 이라 기존 '공항철도' 키에도, 숫자 패턴에도 안 걸려
    // 미번역으로 새던 구간.
    expect(localizeLineName('수도권공항철도1호선', 'en').display).toBe('Airport Railroad (AREX)');
    expect(subwayStep('수도권공항철도1호선', '서울역', '홍대입구').lineEn).toBe('Airport Railroad (AREX)');
  });

  it('급행 등급을 지우지 않고 번역해 붙인다 — 정차역을 건너뛰어 소요시간이 다르다', () => {
    // TMAP 실응답: 서울역→인천공항1터미널 이 "공항철도(급행)" 으로 온다.
    // 괄호 때문에 SPECIAL_LINES 키에도, 숫자 패턴에도 안 걸려 미번역으로 새던 구간.
    expect(localizeLineName('공항철도(급행)', 'en').display).toBe('Airport Railroad (AREX) Express');
    expect(localizeLineName('공항철도(급행)', 'ko').display).toBe('공항철도 급행');
    // 숫자 노선도 같은 경로로 처리 — 예전엔 "9호선" 으로 급행 표시가 사라졌다.
    expect(localizeLineName('9호선(급행)', 'en').display).toBe('Line 9 Express');
    expect(localizeLineName('경의중앙선(급행)', 'ja').display).toBe('京義中央線 急行');
  });

  it('영문을 모르는 노선이면 lineEn 을 아예 안 실어 한글 중복 표기를 막는다', () => {
    const s = subwayStep('어떤신설선', '가상역', '가상역이') as Record<string, unknown>;
    expect(s.lineEn).toBeUndefined();
  });
});

describe('TMAP 버스 step — 정류장명은 한글 유지', () => {
  it('버스 정류장은 로마자화하지 않는다 (ODsay 와 동일 정책: 현장 간판 일치 우선)', () => {
    // _odsay_helper parseSubPath 버스 분기 주석 참조 — 정류장명은 고유명사/동네명이 섞여
    // 기계적 로마자 변환 품질이 낮다.
    const r = mapTmapItineraryToRoute(itinerary([{
      mode: 'BUS', sectionTime: 600, distance: 3000, route: '간선:472',
      start: { name: '서울광장', lon: 126.9779, lat: 37.5663 },
      end: { name: '잠실역.롯데월드', lon: 127.1001, lat: 37.5133 },
    }]))!;
    const bus = r.steps.find((s: { mode: string }) => s.mode === 'bus')! as Record<string, unknown>;
    expect(bus.from).toBe('서울광장');
    expect(bus.fromRoman).toBeUndefined();
    expect(bus.toRoman).toBeUndefined();
  });
});

describe('Firestore 저장 제약', () => {
  it('추가된 필드는 전부 문자열이라 중첩 배열 가드를 깨지 않는다', () => {
    const s = subwayStep('수도권2호선', '선릉', '잠실');
    for (const k of ['lineKo', 'lineEn', 'fromRoman', 'toRoman']) {
      if (s[k] !== undefined) expect(typeof s[k]).toBe('string');
    }
  });
});
