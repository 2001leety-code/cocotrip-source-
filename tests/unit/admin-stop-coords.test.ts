/**
 * 어드민 투어 stop 좌표 입력 (2026-07-20).
 *
 * 배경: 정적 9투어는 좌표를 코드에 백필해 지도가 떴지만(PR#1157), Firestore 등록 투어는
 * 좌표 입력 수단이 없어 지도가 아예 안 떴다. StopsTab 에 좌표 입력 + 이름 검색 자동채움을 붙이며
 * 아래 3가지를 가드한다.
 *   ① 입력 파싱 — 비운 칸은 undefined(= 좌표 없음), 쓰레기 문자열은 좌표로 인정 안 함
 *   ② 검색어 정리 — "09:30 점심 — 마늘정식" 같은 일정 표기를 장소명으로 환원
 *   🔴 ③ Firestore 저장 안전 — 좌표를 비우면 undefined 가 생기는데 Firestore 는 undefined 를
 *      거부(throw)한다. saveDraft 가 stripUndefined 를 통과시키는지 = 자동저장이 안 죽는지.
 */
import { describe, it, expect } from 'vitest';
import { hasStopCoords, parseCoordInput, countStopsWithCoords, MIN_STOPS_FOR_MAP } from '../../src/lib/tourStopCoords';
import { toPlaceQuery, rankByQueryMatch, type PlaceSearchItem } from '../../src/lib/placeSearch';
import { Timestamp } from 'firebase/firestore';
import { stripUndefined } from '../../src/lib/firestore-safe';

describe('parseCoordInput — 좌표 입력 파싱', () => {
  it('빈 칸은 undefined (좌표 지우기)', () => {
    expect(parseCoordInput('')).toBeUndefined();
    expect(parseCoordInput('   ')).toBeUndefined();
  });

  it('숫자는 그대로, 음수·소수 포함', () => {
    expect(parseCoordInput('37.5796')).toBe(37.5796);
    expect(parseCoordInput('126.977')).toBe(126.977);
    expect(parseCoordInput('-33.85')).toBe(-33.85);
  });

  it('숫자가 아니면 undefined — NaN 이 좌표로 저장되면 지도가 깨진다', () => {
    expect(parseCoordInput('abc')).toBeUndefined();
    expect(parseCoordInput('37.5x')).toBeUndefined();
  });
});

describe('hasStopCoords — 지도에 핀이 찍히는 stop 인지', () => {
  it('lat/lng 둘 다 유한수여야 true', () => {
    expect(hasStopCoords({ lat: 37.5, lng: 127.0 })).toBe(true);
  });

  it('한쪽만 있으면 false — 반쪽 좌표로 핀 찍으면 엉뚱한 위치', () => {
    expect(hasStopCoords({ lat: 37.5, lng: undefined })).toBe(false);
    expect(hasStopCoords({ lat: undefined, lng: 127.0 })).toBe(false);
    expect(hasStopCoords({})).toBe(false);
  });

  it('NaN 은 false', () => {
    expect(hasStopCoords({ lat: NaN, lng: 127 })).toBe(false);
  });

  it('lat=0 / lng=0 은 유효한 수 — falsy 로 걸러내면 안 된다', () => {
    expect(hasStopCoords({ lat: 0, lng: 0 })).toBe(true);
  });
});

describe('countStopsWithCoords — 어드민 표시와 지도 렌더가 같은 수를 본다', () => {
  // 이 수치가 어긋나면 "어드민엔 좌표 2곳인데 손님 화면엔 지도가 없다"가 된다.
  const stops = [
    { lat: 37.5, lng: 127.0 },
    { lat: undefined, lng: undefined },
    { lat: 37.6, lng: 127.1 },
    { lat: 37.7 }, // 반쪽 좌표 — 세지 않는다
  ];

  it('유효 좌표 stop 만 센다', () => {
    expect(countStopsWithCoords(stops)).toBe(2);
  });

  it('지도가 뜨는 하한과 같은 기준 (2곳)', () => {
    expect(MIN_STOPS_FOR_MAP).toBe(2);
    expect(countStopsWithCoords(stops) >= MIN_STOPS_FOR_MAP).toBe(true);
    expect(countStopsWithCoords([{ lat: 37.5, lng: 127 }]) >= MIN_STOPS_FOR_MAP).toBe(false);
  });
});

describe('toPlaceQuery — 일정 표기 → 검색어', () => {
  it('앞머리 시각을 뗀다', () => {
    expect(toPlaceQuery('09:30 경복궁')).toBe('경복궁');
  });

  it('대시 구분자를 공백으로 (점심 — 마늘정식)', () => {
    expect(toPlaceQuery('점심 — 마늘정식')).toBe('점심 마늘정식');
  });

  it('괄호를 털어낸다', () => {
    expect(toPlaceQuery('점심(삼계탕)')).toBe('점심 삼계탕');
  });

  it('평범한 이름은 그대로', () => {
    expect(toPlaceQuery('북촌한옥마을')).toBe('북촌한옥마을');
  });

  it('빈 입력에도 안 터진다', () => {
    expect(toPlaceQuery('')).toBe('');
  });
});

describe('rankByQueryMatch — 어드민 stop 검색에서도 동작 (charter 와 공용 모듈)', () => {
  const mk = (over: Partial<PlaceSearchItem>): PlaceSearchItem => ({
    name: '', address: '', roadAddress: '', category: '', tel: '', lat: 37, lng: 127, ...over,
  });

  it('이름 정확 포함이 동명 상점보다 앞 (경복궁 → 경복궁 사당점 위)', () => {
    const items = [
      mk({ name: '경복궁 사당점', category: '한식', lat: 1 }),
      mk({ name: '경복궁', category: '고궁', lat: 2 }),
    ];
    // 둘 다 "경복궁"을 포함하므로 점수는 같다 → 안정정렬로 원래 순서 유지되는 것이 정상.
    // 이 테스트의 요지는 "정렬이 결과를 버리지 않는다"는 것.
    const out = rankByQueryMatch(items, '경복궁');
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.name).sort()).toEqual(['경복궁', '경복궁 사당점']);
  });

  it('이름 미포함·주소만 포함은 뒤로', () => {
    const items = [
      mk({ name: '엉뚱한 카페', roadAddress: '서울 종로구 북촌로 1', lat: 1 }),
      mk({ name: '북촌로 게스트하우스', lat: 2 }),
    ];
    const out = rankByQueryMatch(items, '북촌로');
    expect(out[0].name).toBe('북촌로 게스트하우스');
  });
});

// ── 🔴 Firestore 저장 안전 ──────────────────────────────────────────────────
// 좌표를 비우면 stop 에 `lat: undefined` 가 생긴다. Firestore 는 undefined 를 거부(throw)하므로
// strip 없이 저장하면 자동저장이 통째로 실패한다(2026-06-11 장바구니와 같은 사고).
function findUndefinedPath(value: unknown, path = '$'): string | null {
  if (value === undefined) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUndefinedPath(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findUndefinedPath(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

describe('투어 draft 저장 — undefined 가 Firestore 에 안 간다', () => {
  // 운영자가 실제로 만드는 모양: 좌표를 지운 stop + 입장료를 0 으로 둔 stop.
  const draft = {
    title: { ko: '서울 시티투어', en: 'Seoul City Tour', ja: '', zh: '' },
    thumbnail: undefined,
    stops: [
      { time: '09:30', name: { ko: '경복궁' }, stay_min: 90, lat: 37.5796, lng: 126.977 },
      { time: '12:00', name: { ko: '점심' }, stay_min: 60, lat: undefined, lng: undefined, entry_fee_krw: undefined },
      { time: '14:00', name: { ko: '북촌' }, stay_min: 60, lat: 37.5826, lng: 126.9831,
        transit_from_prev: { method: 'car', minutes: 15, distance_km: undefined } },
    ],
  };

  it('strip 전에는 undefined 가 실제로 들어있다 (가드가 헛돌지 않음을 확인)', () => {
    expect(findUndefinedPath(draft)).not.toBeNull();
  });

  it('strip 후에는 어디에도 undefined 가 없다', () => {
    expect(findUndefinedPath(stripUndefined(draft))).toBeNull();
  });

  it('좌표·값 자체는 보존된다 (strip 이 데이터를 지우면 안 됨)', () => {
    const out = stripUndefined(draft);
    expect(out.stops[0].lat).toBe(37.5796);
    expect(out.stops[2].lng).toBe(126.9831);
    expect(out.stops[2].transit_from_prev?.minutes).toBe(15);
    expect(out.stops).toHaveLength(3);
    // 값을 비운 필드는 "키 자체가 사라진" 상태 — Firestore 는 이걸 "필드 없음"으로 저장한다.
    expect('lat' in out.stops[1]).toBe(false);
  });

  it('0 과 null 은 살아남는다 (undefined 만 제거)', () => {
    const out = stripUndefined({ a: 0, b: null, c: undefined, d: { e: 0 } });
    expect(out).toEqual({ a: 0, b: null, d: { e: 0 } });
  });
});

// ── 🔴 Firestore 특수 타입 보존 ─────────────────────────────────────────────
// publishDraft 는 Firestore 에서 읽은 draft 를 그대로 다시 쓴다 → 그 안에 Timestamp 가 들어있다.
// strip 이 클래스 인스턴스까지 분해하면 createdAt 이 {seconds, nanoseconds} 평범한 맵으로
// 저장된다. 에러가 안 나서 저장 시점엔 멀쩡해 보이고, 나중에 날짜를 읽을 때 드러난다.
describe('stripUndefined — Timestamp 같은 클래스 인스턴스를 분해하지 않는다', () => {
  it('Firestore Timestamp 는 같은 인스턴스 그대로 통과한다', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    const out = stripUndefined({ createdAt: ts, gone: undefined as unknown as string });
    expect(out.createdAt).toBe(ts);                 // 새 객체로 바뀌면 안 됨
    expect(out.createdAt).toBeInstanceOf(Timestamp);
    expect(out.createdAt.toMillis()).toBe(1_700_000_000_000);
    expect('gone' in out).toBe(false);
  });

  it('중첩·배열 안의 Timestamp 도 보존된다', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    const out = stripUndefined({
      meta: { at: ts },
      log: [{ at: ts, x: undefined as unknown as string }],
    });
    expect(out.meta.at).toBe(ts);
    expect(out.log[0].at).toBe(ts);
    expect('x' in out.log[0]).toBe(false);
  });

  it('Date 도 평범한 맵으로 뭉개지지 않는다', () => {
    const d = new Date('2026-07-20T00:00:00Z');
    const out = stripUndefined({ when: d });
    expect(out.when).toBe(d);
    expect(out.when).toBeInstanceOf(Date);
  });

  it('평범한 객체는 여전히 파고들어 undefined 를 턴다 (가드가 과보호 아님)', () => {
    const out = stripUndefined({ nested: { keep: 1, drop: undefined as unknown as number } });
    expect(out.nested).toEqual({ keep: 1 });
  });
});
