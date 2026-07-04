/**
 * courseOps — 코스 빌더 순수 로직 (2026-07-04 CourseBuilderShell MVP화).
 *
 * UI(useCourseBuilder 훅)와 분리된 순수 함수 모음 — 잠금테스트 대상
 * (tests/unit/course-builder-ops.test.ts). 전부 불변(immutable) 갱신.
 *
 * 스키마는 useItinerary(ItinerarySlot/ItineraryDay)와 호환되게 설계 —
 * 로그인 시 toItinerarySlots() 로 그대로 Firestore 저장(users/{uid}/itineraries).
 */

export interface CourseStop {
  id: string;
  /** "09:30" — 빈 문자열 허용(시간 미정) */
  time: string;
  title: string;
  /** 'food' | 'sight' | 'show' | 'stay' | 'etc' — UI 칩 표시용 */
  category: string;
  memo: string;
  lat?: number;
  lng?: number;
}

export interface CourseDay {
  stops: CourseStop[];
}

export interface CourseDraft {
  v: 1;
  days: CourseDay[];
  updatedAt: number;
}

export const COURSE_STORAGE_KEY = 'cocotrip:course:draft:v1';
export const COURSE_MAX_DAYS = 10;
export const COURSE_MAX_STOPS_PER_DAY = 20;

let seq = 0;
export function genStopId(now: number = Date.now()): string {
  seq = (seq + 1) % 1000;
  return `s${now.toString(36)}${seq}`;
}

export function emptyDraft(now: number = Date.now()): CourseDraft {
  return { v: 1, days: [{ stops: [] }], updatedAt: now };
}

/** 시간 문자열 검증 — "HH:MM"(24h) 또는 빈 문자열만 허용. */
export function isValidTime(t: string): boolean {
  if (t === '') return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function touch(d: CourseDraft, now: number): CourseDraft {
  return { ...d, updatedAt: now };
}

export function addStop(
  d: CourseDraft, dayIdx: number, partial: Omit<CourseStop, 'id'>, now: number = Date.now(),
): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  if (d.days[dayIdx].stops.length >= COURSE_MAX_STOPS_PER_DAY) return d;
  const title = partial.title.trim();
  if (!title) return d;
  const stop: CourseStop = { ...partial, title, id: genStopId(now) };
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: [...day.stops, stop] } : day));
  return touch({ ...d, days }, now);
}

export function updateStop(
  d: CourseDraft, dayIdx: number, stopId: string, patch: Partial<Omit<CourseStop, 'id'>>, now: number = Date.now(),
): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  // title 을 빈 값으로 만드는 패치는 무시(제목 필수), time 형식 불량도 무시.
  if (patch.title !== undefined && !patch.title.trim()) return d;
  if (patch.time !== undefined && !isValidTime(patch.time)) return d;
  let changed = false;
  const days = d.days.map((day, i) => {
    if (i !== dayIdx) return day;
    return {
      stops: day.stops.map((s) => {
        if (s.id !== stopId) return s;
        changed = true;
        return { ...s, ...patch, title: patch.title !== undefined ? patch.title.trim() : s.title };
      }),
    };
  });
  return changed ? touch({ ...d, days }, now) : d;
}

export function removeStop(d: CourseDraft, dayIdx: number, stopId: string, now: number = Date.now()): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  const before = d.days[dayIdx].stops.length;
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: day.stops.filter((s) => s.id !== stopId) } : day));
  if (days[dayIdx].stops.length === before) return d;
  return touch({ ...d, days }, now);
}

/** Day 간 이동 — 원본 순서 유지, 대상 day 끝에 append. 같은 day 면 no-op. */
export function moveStopToDay(
  d: CourseDraft, fromDay: number, stopId: string, toDay: number, now: number = Date.now(),
): CourseDraft {
  if (fromDay === toDay) return d;
  if (fromDay < 0 || fromDay >= d.days.length || toDay < 0 || toDay >= d.days.length) return d;
  const stop = d.days[fromDay].stops.find((s) => s.id === stopId);
  if (!stop) return d;
  if (d.days[toDay].stops.length >= COURSE_MAX_STOPS_PER_DAY) return d;
  const days = d.days.map((day, i) => {
    if (i === fromDay) return { stops: day.stops.filter((s) => s.id !== stopId) };
    if (i === toDay) return { stops: [...day.stops, stop] };
    return day;
  });
  return touch({ ...d, days }, now);
}

export function addDay(d: CourseDraft, now: number = Date.now()): CourseDraft {
  if (d.days.length >= COURSE_MAX_DAYS) return d;
  return touch({ ...d, days: [...d.days, { stops: [] }] }, now);
}

/** Day 삭제 — 마지막 1개는 못 지움(빈 코스 방지), 스탑 있는 day 도 삭제 가능(UI 에서 confirm). */
export function removeDay(d: CourseDraft, dayIdx: number, now: number = Date.now()): CourseDraft {
  if (d.days.length <= 1) return d;
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  return touch({ ...d, days: d.days.filter((_, i) => i !== dayIdx) }, now);
}

// ── 공유 (mock URL — 백엔드 없이 코스를 URL 해시에 실음) ──────────────────

/** 코스 → base64url (URL 해시용). 유니코드 안전. */
export function encodeCourseForShare(d: CourseDraft): string {
  const json = JSON.stringify({ v: d.v, days: d.days });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → 코스. 불량 입력은 null (throw 금지 — URL 은 신뢰 불가 입력). */
export function decodeSharedCourse(encoded: string, now: number = Date.now()): CourseDraft | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed?.v !== 1 || !Array.isArray(parsed.days)) return null;
    const days: CourseDay[] = parsed.days.slice(0, COURSE_MAX_DAYS).map((day: unknown) => {
      const stops = Array.isArray((day as CourseDay)?.stops) ? (day as CourseDay).stops : [];
      return {
        stops: stops.slice(0, COURSE_MAX_STOPS_PER_DAY).flatMap((s) => {
          const title = typeof s?.title === 'string' ? s.title.trim() : '';
          if (!title) return [];
          return [{
            id: typeof s.id === 'string' && s.id ? s.id : genStopId(now),
            time: typeof s.time === 'string' && isValidTime(s.time) ? s.time : '',
            title: title.slice(0, 120),
            category: typeof s.category === 'string' ? s.category.slice(0, 20) : 'etc',
            memo: typeof s.memo === 'string' ? s.memo.slice(0, 500) : '',
            ...(typeof s.lat === 'number' && Number.isFinite(s.lat) ? { lat: s.lat } : {}),
            ...(typeof s.lng === 'number' && Number.isFinite(s.lng) ? { lng: s.lng } : {}),
          }];
        }),
      };
    });
    if (!days.length) return null;
    return { v: 1, days, updatedAt: now };
  } catch {
    return null;
  }
}

// ── useItinerary 호환 변환 (로그인 시 '내 계정에 저장') ──────────────────

/** CourseStop → ItinerarySlot shape (useItinerary.addSlot 의 slot 인자와 호환). */
export function toItinerarySlot(s: CourseStop): {
  productId: string; productType: 'planner'; name: string; timeStart?: string; notes?: string;
} {
  return {
    productId: `course-${s.id}`,
    productType: 'planner',
    name: s.title,
    ...(s.time ? { timeStart: s.time } : {}),
    ...(s.memo ? { notes: s.memo } : {}),
  };
}

// ── 지도 링크 (기존 패턴: naverMapSearchUrl / google maps search) ─────────

export function googleMapsUrl(s: Pick<CourseStop, 'title' | 'lat' | 'lng'>): string {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.title)}`;
}
