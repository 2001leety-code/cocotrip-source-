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
  isValidStopConstraints, isValidTime, moveStopToDay, moveStopWithinDay, normalizeStopExtras,
  removeDay, removeStop, toItinerarySlot, updateStop, googleMapsUrl,
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

  it('v1 확장필드(stayMinutes/timeConstraint/placeKey)도 toItinerarySlot ↔ fromItinerarySlots 왕복 보존', async () => {
    const { toItinerarySlot, fromItinerarySlots } = await import('../../src/pages/PlannerPage/components/courseBuilder/courseOps');
    let d = emptyDraft(1000);
    d = addStop(d, 0, {
      title: '경복궁', time: '09:00', category: 'sight', memo: '', stayMinutes: 90,
      timeConstraint: 'fixed', placeKey: 'gyeongbokgung', placeSource: 'cocotrip-attractions',
    });
    const slots = d.days[0].stops.map(toItinerarySlot);
    const restored = fromItinerarySlots([slots], 2000);
    const s0 = restored.days[0].stops[0];
    expect(s0.stayMinutes).toBe(90);
    expect(s0.timeConstraint).toBe('fixed');
    expect(s0.placeKey).toBe('gyeongbokgung');
    expect(s0.placeSource).toBe('cocotrip-attractions');
  });
});

describe('v1 확장필드 — stayMinutes/timeConstraint/windowEnd/placeKey (additive, 2026-08-24)', () => {
  it('isValidStopConstraints — 필드 없음/구버전은 통과, null-safe', () => {
    expect(isValidStopConstraints(undefined)).toBe(true);
    expect(isValidStopConstraints(null)).toBe(true);
    expect(isValidStopConstraints({})).toBe(true);
    expect(isValidStopConstraints({ time: '09:00' })).toBe(true); // timeConstraint 없으면 자유시간
  });

  it('stayMinutes — 1..1440 정수만 유효', () => {
    expect(isValidStopConstraints({ stayMinutes: 90 })).toBe(true);
    expect(isValidStopConstraints({ stayMinutes: 0 })).toBe(false);
    expect(isValidStopConstraints({ stayMinutes: 1441 })).toBe(false);
    expect(isValidStopConstraints({ stayMinutes: 12.5 })).toBe(false);
  });

  it("timeConstraint='fixed' — 확정 시각(time) 필수, windowEnd 동반 시 malformed", () => {
    expect(isValidStopConstraints({ timeConstraint: 'fixed', time: '09:00' })).toBe(true);
    expect(isValidStopConstraints({ timeConstraint: 'fixed', time: '' })).toBe(false);
    expect(isValidStopConstraints({ timeConstraint: 'fixed', time: '09:00', windowEnd: '10:00' })).toBe(false);
  });

  it("timeConstraint='window' — time~windowEnd 필수, windowEnd > time", () => {
    expect(isValidStopConstraints({ timeConstraint: 'window', time: '09:00', windowEnd: '11:00' })).toBe(true);
    expect(isValidStopConstraints({ timeConstraint: 'window', time: '11:00', windowEnd: '09:00' })).toBe(false);
    expect(isValidStopConstraints({ timeConstraint: 'window', time: '09:00' })).toBe(false); // windowEnd 없음
  });

  it('windowEnd 단독(timeConstraint 없음)은 불일치 — malformed', () => {
    expect(isValidStopConstraints({ windowEnd: '10:00' })).toBe(false);
  });

  it('placeKey/placeSource — 반드시 짝, 빈 문자열/과도한 길이/미지 source 는 malformed', () => {
    expect(isValidStopConstraints({ placeKey: 'gyeongbokgung', placeSource: 'cocotrip-attractions' })).toBe(true);
    expect(isValidStopConstraints({ placeKey: 'gyeongbokgung' })).toBe(false); // placeSource 없음
    expect(isValidStopConstraints({ placeSource: 'cocotrip-attractions' })).toBe(false); // placeKey 없음
    expect(isValidStopConstraints({ placeKey: '', placeSource: 'cocotrip-attractions' })).toBe(false);
    expect(isValidStopConstraints({ placeKey: 'x'.repeat(200), placeSource: 'cocotrip-attractions' })).toBe(false);
    expect(isValidStopConstraints({ placeKey: 'ok', placeSource: 'other' as never })).toBe(false);
  });

  it('normalizeStopExtras(lenient) — 불량 필드만 조용히 제거, stop 은 항상 반환', () => {
    const s = stop('경복궁', { stayMinutes: -5, timeConstraint: 'window', time: '09:00' }); // windowEnd 없음
    const cleaned = normalizeStopExtras(s as never)!;
    expect(cleaned).not.toBeNull();
    expect('stayMinutes' in cleaned).toBe(false);
    expect('timeConstraint' in cleaned).toBe(false); // window 인데 windowEnd 없어 통째로 제거
    expect(cleaned.title).toBe('경복궁'); // stop 자체는 보존
  });

  it('normalizeStopExtras(strict) — malformed 는 stop 전체 드롭(null), 유효/무필드는 통과', () => {
    const bad = stop('X', { timeConstraint: 'fixed', time: '' });
    expect(normalizeStopExtras(bad as never, 'strict')).toBeNull();
    const good = stop('X', { timeConstraint: 'fixed', time: '09:00' });
    expect(normalizeStopExtras(good as never, 'strict')).not.toBeNull();
    const legacy = stop('X');
    expect(normalizeStopExtras(legacy as never, 'strict')).not.toBeNull();
  });

  it('addStop/updateStop — 불량 확장필드는 조용히 제거되고 장소는 남는다(lenient)', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('경복궁', { stayMinutes: 9999 }));
    expect(d.days[0].stops[0].title).toBe('경복궁');
    expect('stayMinutes' in d.days[0].stops[0]).toBe(false);

    d = addStop(d, 0, stop('N타워', { timeConstraint: 'fixed', time: '10:00' }));
    const id = d.days[0].stops[1].id;
    d = updateStop(d, 0, id, { timeConstraint: 'window' as never }); // time 없이 window 로 바꾸면 malformed → 제거
    expect(d.days[0].stops[1].title).toBe('N타워'); // 장소는 그대로
    expect('timeConstraint' in d.days[0].stops[1]).toBe(false);
  });

  it('decodeSharedCourse — 구버전 링크(확장필드 없음)는 그대로 읽힘', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('경복궁', { time: '09:00' }));
    const decoded = decodeSharedCourse(encodeCourseForShare(d), 2000)!;
    expect(decoded.days[0].stops[0].title).toBe('경복궁');
    expect('stayMinutes' in decoded.days[0].stops[0]).toBe(false);
  });

  it('decodeSharedCourse — 유효 확장필드는 라운드트립, 명시적 malformed 는 fail-closed 로 그 stop 만 드롭', () => {
    // addStop 은 UI 입력(lenient)이라 malformed 확장필드를 즉시 정리해버리므로, 여기서는
    // 조작된 원본 payload(해시 조작 등 트러스트 경계 시나리오)를 직접 구성해 decode 를 검증한다.
    const evil = {
      v: 1,
      days: [{
        stops: [
          { title: '경복궁', time: '09:00', stayMinutes: 60, timeConstraint: 'fixed', placeKey: 'gyeongbokgung', placeSource: 'cocotrip-attractions' },
          { title: '망가진곳', timeConstraint: 'fixed', time: '' }, // fixed 인데 time 없음 — malformed
        ],
      }],
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(evil))));
    const decoded = decodeSharedCourse(b64, 2000)!;
    expect(decoded.days[0].stops).toHaveLength(1); // 망가진 stop 은 드롭, 나머지는 살아남음
    const s0 = decoded.days[0].stops[0];
    expect(s0.title).toBe('경복궁');
    expect(s0.stayMinutes).toBe(60);
    expect(s0.timeConstraint).toBe('fixed');
    expect(s0.placeKey).toBe('gyeongbokgung');
  });
});

describe('moveStopWithinDay — 같은 day 내 단일 재배치', () => {
  it('지정 인덱스로 이동, 범위 클램프, no-op 은 동일 참조', () => {
    let d = emptyDraft(1000);
    d = addStop(d, 0, stop('A'));
    d = addStop(d, 0, stop('B'));
    d = addStop(d, 0, stop('C'));
    const idA = d.days[0].stops[0].id;
    const moved = moveStopWithinDay(d, 0, idA, 2);
    expect(moved.days[0].stops.map((s) => s.title)).toEqual(['B', 'C', 'A']);
    expect(moveStopWithinDay(d, 0, idA, 0)).toBe(d); // 이미 0번 — no-op
    expect(moveStopWithinDay(d, 0, 'no-such', 1)).toBe(d);
    const clamped = moveStopWithinDay(d, 0, idA, 99);
    expect(clamped.days[0].stops.map((s) => s.title)).toEqual(['B', 'C', 'A']);
  });
});
