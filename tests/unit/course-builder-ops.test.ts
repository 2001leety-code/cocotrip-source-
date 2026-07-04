/**
 * courseOps 회귀 슬롯 (2026-07-04 CourseBuilderShell MVP).
 *
 * 코스 빌더 순수 리듀서 잠금 — 추가/수정/삭제/Day이동/공유 인코딩이 잘못 바뀌면 터진다.
 * 특히 decodeSharedCourse 는 URL(신뢰 불가 입력) 파서라 sanitize 잠금 필수.
 */
import { describe, it, expect } from 'vitest';

import {
  COURSE_MAX_DAYS, COURSE_MAX_STOPS_PER_DAY,
  addDay, addStop, decodeSharedCourse, emptyDraft, encodeCourseForShare,
  isValidTime, moveStopToDay, removeDay, removeStop, toItinerarySlot, updateStop, googleMapsUrl,
} from '../../src/pages/PlannerPage/components/courseBuilder/courseOps';

const stop = (title: string, extra: Record<string, unknown> = {}) => ({
  title, time: '', category: 'sight', memo: '', ...extra,
});

describe('addStop / updateStop / removeStop', () => {
  it('추가 — 제목 trim, id 부여, 해당 day 에만', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('  경복궁  '), 1001);
    expect(d.days[0].stops).toHaveLength(1);
    expect(d.days[0].stops[0].title).toBe('경복궁');
    expect(d.days[0].stops[0].id).toBeTruthy();
  });

  it('빈 제목/범위 밖 day 는 no-op (동일 참조)', () => {
    const d = emptyDraft(1000);
    expect(addStop(d, 0, stop('   '))).toBe(d);
    expect(addStop(d, 5, stop('경복궁'))).toBe(d);
  });

  it('day 당 상한 초과 시 no-op', () => {
    let d = emptyDraft(1000);
    for (let i = 0; i < COURSE_MAX_STOPS_PER_DAY; i++) d = addStop(d, 0, stop(`p${i}`));
    const full = d;
    expect(addStop(full, 0, stop('초과'))).toBe(full);
  });

  it('수정 — 시간/카테고리 패치, 불량 시간("25:99")은 무시', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('경복궁'));
    const id = d.days[0].stops[0].id;
    d = updateStop(d, 0, id, { time: '09:30', category: 'food' });
    expect(d.days[0].stops[0].time).toBe('09:30');
    expect(d.days[0].stops[0].category).toBe('food');
    const before = d;
    expect(updateStop(before, 0, id, { time: '25:99' })).toBe(before);
    expect(updateStop(before, 0, id, { title: '  ' })).toBe(before); // 제목 비우기 금지
  });

  it('삭제 — 해당 id 만, 없는 id 는 no-op', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('A'));
    d = addStop(d, 0, stop('B'));
    const idA = d.days[0].stops[0].id;
    d = removeStop(d, 0, idA);
    expect(d.days[0].stops.map((s) => s.title)).toEqual(['B']);
    expect(removeStop(d, 0, 'no-such')).toBe(d);
  });
});

describe('Day 조작 + Day 간 이동', () => {
  it('addDay 상한 / removeDay 마지막 1개 보호', () => {
    let d = emptyDraft(1000);
    for (let i = 1; i < COURSE_MAX_DAYS; i++) d = addDay(d);
    expect(d.days).toHaveLength(COURSE_MAX_DAYS);
    expect(addDay(d)).toBe(d); // 상한
    let one = emptyDraft(1000);
    expect(removeDay(one, 0)).toBe(one); // 마지막 1개 못 지움
    one = addDay(one);
    expect(removeDay(one, 1).days).toHaveLength(1);
  });

  it('moveStopToDay — 원본에서 빠지고 대상 끝에 붙음, 같은 day 는 no-op', () => {
    let d = emptyDraft(1000);
    d = addDay(d);
    d = addStop(d, 0, stop('경복궁'));
    d = addStop(d, 1, stop('해운대'));
    const id = d.days[0].stops[0].id;
    const moved = moveStopToDay(d, 0, id, 1);
    expect(moved.days[0].stops).toHaveLength(0);
    expect(moved.days[1].stops.map((s) => s.title)).toEqual(['해운대', '경복궁']);
    expect(moveStopToDay(moved, 1, id, 1)).toBe(moved);
  });
});

describe('공유 인코딩/디코딩 (URL = 신뢰 불가 입력)', () => {
  it('라운드트립 — 인코딩 후 디코딩하면 days 보존 (유니코드 포함)', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('홍대 고깃집 🍖', { time: '18:30', memo: '2층, 예약함', lat: 37.55, lng: 126.92 }));
    d = addDay(d);
    d = addStop(d, 1, stop('N서울타워'));
    const decoded = decodeSharedCourse(encodeCourseForShare(d), 2000);
    expect(decoded).not.toBeNull();
    expect(decoded!.days).toHaveLength(2);
    expect(decoded!.days[0].stops[0].title).toBe('홍대 고깃집 🍖');
    expect(decoded!.days[0].stops[0].time).toBe('18:30');
    expect(decoded!.days[0].stops[0].lat).toBe(37.55);
  });

  it('쓰레기/조작 입력은 null 또는 sanitize (throw 금지)', () => {
    expect(decodeSharedCourse('not-base64!!!')).toBeNull();
    expect(decodeSharedCourse(btoa('{"v":2,"days":[]}'))).toBeNull();
    // 제목 없는 stop 은 걸러짐, 초과 day/stop 은 컷
    const evil = { v: 1, days: [{ stops: [{ title: '', time: 'x' }, { title: 'ok', time: '99:99', memo: 1 }] }] };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(evil))));
    const out = decodeSharedCourse(b64, 3000);
    expect(out).not.toBeNull();
    expect(out!.days[0].stops).toHaveLength(1);
    expect(out!.days[0].stops[0].title).toBe('ok');
    expect(out!.days[0].stops[0].time).toBe(''); // 불량 시간 → 빈 값
    expect(out!.days[0].stops[0].memo).toBe(''); // 비문자열 → 빈 값
  });
});

describe('useItinerary 호환 변환 + 지도 링크', () => {
  it('toItinerarySlot — productType planner, 빈 time/memo 는 필드 생략', () => {
    const s = { id: 'x1', title: '경복궁', time: '', category: 'sight', memo: '' };
    const slot = toItinerarySlot(s);
    expect(slot.productType).toBe('planner');
    expect(slot.name).toBe('경복궁');
    expect('timeStart' in slot).toBe(false);
    expect('notes' in slot).toBe(false);
    const s2 = { ...s, time: '10:00', memo: '메모' };
    expect(toItinerarySlot(s2).timeStart).toBe('10:00');
    expect(toItinerarySlot(s2).notes).toBe('메모');
  });

  it('googleMapsUrl — 좌표 있으면 좌표, 없으면 이름 검색', () => {
    expect(googleMapsUrl({ title: '경복궁', lat: 37.58, lng: 126.98 })).toContain('query=37.58,126.98');
    expect(googleMapsUrl({ title: '경복궁' })).toContain(encodeURIComponent('경복궁'));
  });

  it('isValidTime — HH:MM 24h 만', () => {
    expect(isValidTime('')).toBe(true);
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
  });
});

describe('recommendations — attractions 병합 중복 제거 (React key 충돌 방지)', () => {
  it('recoForCity 결과에 중복 key 없음 (파일 간 중복 항목 dedupe)', async () => {
    const { recoForCity } = await import('../../src/pages/PlannerPage/components/courseBuilder/recommendations');
    const all = recoForCity(null, 500);
    const keys = all.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.length).toBeGreaterThan(50); // 데이터 실존 확인
  });
});

describe('recoCities — 도시 필터 상한 (UI 폭주 방지)', () => {
  it('상위 12개(기본)만, 장소 수 내림차순', async () => {
    const { recoCities } = await import('../../src/pages/PlannerPage/components/courseBuilder/recommendations');
    const cities = recoCities();
    expect(cities.length).toBeLessThanOrEqual(12);
    expect(cities.length).toBeGreaterThan(3);
    expect(cities[0]).toBe('seoul'); // 최다 장소 도시가 첫번째
  });
});

describe('계정 저장 ↔ 불러오기 라운드트립 (2026-07-04 내 코스 탭)', () => {
  it('toItinerarySlot → fromItinerarySlots 로 title/time/memo/category/좌표 보존', async () => {
    const { toItinerarySlot, fromItinerarySlots } = await import('../../src/pages/PlannerPage/components/courseBuilder/courseOps');
    let d = emptyDraft(1000);
    d = addStop(d, 0, { title: '경복궁', time: '09:00', category: 'sight', memo: '한복', lat: 37.58, lng: 126.98 });
    d = addDay(d);
    d = addStop(d, 1, { title: '해운대', time: '', category: 'food', memo: '' });
    const slotsPerDay = d.days.map((day) => day.stops.map(toItinerarySlot));
    const restored = fromItinerarySlots(slotsPerDay, 2000);
    expect(restored.days).toHaveLength(2);
    const s0 = restored.days[0].stops[0];
    expect(s0.title).toBe('경복궁');
    expect(s0.time).toBe('09:00');
    expect(s0.category).toBe('sight');
    expect(s0.memo).toBe('한복');
    expect(s0.lat).toBe(37.58);
    expect(restored.days[1].stops[0].category).toBe('food');
  });

  it('구버전 슬롯(category 없음)도 안전 복원 — etc 폴백, 이름 없는 슬롯 스킵', async () => {
    const { fromItinerarySlots } = await import('../../src/pages/PlannerPage/components/courseBuilder/courseOps');
    const restored = fromItinerarySlots([[{ name: '옛코스', timeStart: '10:00' }, { name: '' }]], 3000);
    expect(restored.days[0].stops).toHaveLength(1);
    expect(restored.days[0].stops[0].category).toBe('etc');
    expect(restored.days[0].stops[0].time).toBe('10:00');
  });
});
