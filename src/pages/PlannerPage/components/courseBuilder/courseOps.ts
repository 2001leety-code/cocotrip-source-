/**
 * courseOps — 코스 빌더 순수 로직 (2026-07-04 CourseBuilderShell MVP화).
 *
 * UI(useCourseBuilder 훅)와 분리된 순수 함수 모음 — 잠금테스트 대상
 * (tests/unit/course-builder-ops.test.ts). 전부 불변(immutable) 갱신.
 *
 * 스키마는 useItinerary(ItinerarySlot/ItineraryDay)와 호환되게 설계 —
 * 로그인 시 toItinerarySlots() 로 그대로 Firestore 저장(users/{uid}/itineraries).
 */

/** 'fixed' = time 이 예약 등 확정 시각. 'window' = time~windowEnd 범위 내. 없으면 자유/메모성 시간. */
export type CourseTimeConstraint = 'fixed' | 'window';
export type CoursePlaceSource = 'cocotrip-attractions' | 'cocotrip-food';

export interface CourseStop {
  id: string;
  /** "09:30" — 빈 문자열 허용(시간 미정). timeConstraint 가 없으면 이 값은 사용자 메모성 자유시간일 뿐,
   *  reservation_required 등 어떤 필드도 이 값을 자동으로 확정 예약시각으로 승격하지 않는다. */
  time: string;
  title: string;
  /** 'food' | 'sight' | 'show' | 'stay' | 'etc' — UI 칩 표시용 */
  category: string;
  memo: string;
  lat?: number;
  lng?: number;
  /** 체류 시간(분), 1..1440 정수만 유효. (planner-trust-course, 2026-08-24, additive v1) */
  stayMinutes?: number;
  /** 'fixed'|'window' 만 유효. AI 재배치의 anchor 판정 기준. */
  timeConstraint?: CourseTimeConstraint;
  /** timeConstraint='window' 일 때만 의미 — "HH:MM", time(시작) 보다 늦어야 함. */
  windowEnd?: string;
  /** 서버 candidate catalog 의 candidateId 대응 — 추천에서 추가된 장소만 지님. */
  placeKey?: string;
  /** 서버가 identity 를 소유한 카탈로그 출처. */
  placeSource?: CoursePlaceSource;
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

/** "HH:MM"(24h), 빈 문자열 불허 — windowEnd 는 항상 구체 시각이어야 함. */
function isValidClock(t: unknown): t is string {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function isValidStayMinutes(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440;
}

export function isValidTimeConstraint(v: unknown): v is CourseTimeConstraint {
  return v === 'fixed' || v === 'window';
}

export function isValidPlaceSource(v: unknown): v is CoursePlaceSource {
  return v === 'cocotrip-attractions' || v === 'cocotrip-food';
}

/** placeKey 최대 길이 — candidate catalog key 는 짧은 slug 라 넉넉한 상한. */
const MAX_PLACE_KEY = 128;

/**
 * v1 확장필드(stayMinutes/timeConstraint/windowEnd/placeKey/placeSource) 검증 — 트러스트 경계
 * (외부에서 온 stop: 공유 링크 해시 디코드, 서버 API payload)에서 사용. 필드가 아예 없으면 통과
 * (구버전 링크/드래프트 호환) — "명시적으로 있는데 형식이 틀림"만 malformed 로 잡는다.
 *
 * 'fixed' 앵커는 확정 시각(time)이 있어야 하고, 'window' 앵커는 time(시작)~windowEnd(끝) 둘 다
 * 있어야 하며 windowEnd > time 이어야 한다. windowEnd 만 있고 timeConstraint!='window' 인
 * 불일치 상태도 malformed. placeKey/placeSource 는 반드시 짝으로 있어야 한다(한쪽만 있으면
 * malformed). 이 함수가 false 를 반환하면 호출부는 그 stop 을 자유시간으로 조용히 강등하지
 * 말고 fail-closed(드롭 또는 전체 payload 거부) 해야 한다.
 */
export function isValidStopConstraints(s: {
  time?: unknown; stayMinutes?: unknown; timeConstraint?: unknown; windowEnd?: unknown;
  placeKey?: unknown; placeSource?: unknown;
} | null | undefined): boolean {
  if (!s || typeof s !== 'object') return true; // 값 자체가 없음 — malformed 판정 대상 아님(null-safe)
  if (s.stayMinutes !== undefined && !isValidStayMinutes(s.stayMinutes)) return false;
  if (s.placeKey !== undefined || s.placeSource !== undefined) {
    if (typeof s.placeKey !== 'string' || !s.placeKey.trim() || s.placeKey.length > MAX_PLACE_KEY) return false;
    if (!isValidPlaceSource(s.placeSource)) return false;
  }
  if (s.timeConstraint === undefined) {
    // windowEnd 만 단독으로 있는 불일치 상태 방지
    if (s.windowEnd !== undefined) return false;
    return true;
  }
  if (!isValidTimeConstraint(s.timeConstraint)) return false;
  if (!isValidClock(s.time)) return false;
  if (s.timeConstraint === 'window') {
    if (!isValidClock(s.windowEnd)) return false;
    if ((s.windowEnd as string) <= (s.time as string)) return false;
  } else if (s.windowEnd !== undefined) {
    return false; // 'fixed' 인데 windowEnd 가 붙어있는 불일치 상태
  }
  return true;
}

/**
 * v1 확장필드 정합성 정리 — 순수함수(원본 불변, 새 객체 반환).
 *
 * mode='lenient'(기본, UI 입력 — addStop/addStops/updateStop 등) — 안 맞는 필드만 조용히
 *   제거하고 stop 은 항상 돌려준다(null 이 아님). 사용자가 폼에 잘못 입력해도 그 장소 자체가
 *   사라지면 안 되기 때문 — payload 전체·stop 하나를 거부하지 않는다.
 * mode='strict'(외부 신뢰 불가 입력 — 공유 링크 해시 디코드 등, isValidStopConstraints 의
 *   트러스트 경계와 동일) — 확장필드가 "명시적으로 있는데 형식이 틀림" 이면 stop 전체를
 *   버린다(null 반환) — 조용한 강등 금지, 호출부가 그 stop 을 드롭해야 한다.
 */
export function normalizeStopExtras(stop: CourseStop, mode: 'lenient' | 'strict' = 'lenient'): CourseStop | null {
  if (mode === 'strict') {
    return isValidStopConstraints(stop) ? stop : null;
  }
  const next = { ...stop };
  if (next.stayMinutes !== undefined && !isValidStayMinutes(next.stayMinutes)) delete next.stayMinutes;
  if (next.placeKey !== undefined || next.placeSource !== undefined) {
    const trimmedKey = typeof next.placeKey === 'string' ? next.placeKey.trim().slice(0, MAX_PLACE_KEY) : '';
    const pairOk = !!trimmedKey && isValidPlaceSource(next.placeSource);
    if (pairOk) next.placeKey = trimmedKey;
    else { delete next.placeKey; delete next.placeSource; }
  }
  if (!isValidStopConstraints(next)) { delete next.timeConstraint; delete next.windowEnd; }
  return next;
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
  const stop = normalizeStopExtras({ ...partial, title, id: genStopId(now) }) as CourseStop;
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: [...day.stops, stop] } : day));
  return touch({ ...d, days }, now);
}

/**
 * 검증 코스 같은 여러 장소를 한 Day 에 한 번에 넣는다. (2026-08-02)
 *
 * `addStop` 을 반복 호출하지 않는 이유: 하루 최대 개수에 걸리면 `addStop` 은 원본을
 * 그대로 돌려주므로, 몇 개가 실제로 들어갔는지 호출부가 알 수 없다. 여기서 남은 자리만큼
 * 잘라 넣고 결과를 한 번에 반환해야 "N곳 추가했어요" 를 정직하게 말할 수 있다.
 * 제목이 빈 장소는 `addStop` 과 똑같이 버린다.
 */
export function addStops(
  d: CourseDraft, dayIdx: number, partials: Omit<CourseStop, 'id'>[], now: number = Date.now(),
): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  if (!Array.isArray(partials)) return d;
  const remaining = COURSE_MAX_STOPS_PER_DAY - d.days[dayIdx].stops.length;
  if (remaining <= 0) return d;
  const additions = partials
    .map((partial) => ({ ...partial, title: String(partial?.title || '').trim() }))
    .filter((partial) => !!partial.title)
    .slice(0, remaining)
    .map((partial) => normalizeStopExtras({ ...partial, id: genStopId(now) }) as CourseStop);
  if (!additions.length) return d;
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: [...day.stops, ...additions] } : day));
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
        const merged = { ...s, ...patch, title: patch.title !== undefined ? patch.title.trim() : s.title };
        return normalizeStopExtras(merged) as CourseStop;
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

/**
 * Day 내 stop 순서 재정렬 (2026-07-05, AI 동선 최적화용).
 * orderedIds = 새 순서의 stop id 배열. 기존 stop 은 손실 없이 그 순서로 재배치하고,
 * orderedIds 에 없는 stop(누락/신규)은 원래 상대순서 유지하며 뒤에 붙인다(안전측: 절대 삭제 안 함).
 */
export function reorderStops(
  d: CourseDraft, dayIdx: number, orderedIds: string[], now: number = Date.now(),
): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  const stops = d.days[dayIdx].stops;
  const byId = new Map(stops.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const reordered: CourseStop[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s && !seen.has(id)) { reordered.push(s); seen.add(id); }
  }
  // orderedIds 에 빠진 stop 은 원래 순서대로 뒤에 (손실 방지)
  for (const s of stops) {
    if (!seen.has(s.id)) reordered.push(s);
  }
  // 순서가 실제로 안 바뀌면 no-op (불필요한 updatedAt 갱신 회피)
  const same = reordered.length === stops.length && reordered.every((s, i) => s.id === stops[i].id);
  if (same) return d;
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: reordered } : day));
  return touch({ ...d, days }, now);
}

/**
 * Day 내 stop 을 특정 인덱스로 옮긴다(드래그 1칸 이동 등 단일 재배치용).
 * reorderStops(전체 순서 배열 교체)와 달리 stopId + 목적 인덱스만 받는다.
 * toIndex 는 day 범위로 클램프. 이동이 실제로 없으면 no-op(동일 참조).
 */
export function moveStopWithinDay(
  d: CourseDraft, dayIdx: number, stopId: string, toIndex: number, now: number = Date.now(),
): CourseDraft {
  if (dayIdx < 0 || dayIdx >= d.days.length) return d;
  const stops = d.days[dayIdx].stops;
  const fromIndex = stops.findIndex((s) => s.id === stopId);
  if (fromIndex === -1) return d;
  const clamped = Math.max(0, Math.min(toIndex, stops.length - 1));
  if (clamped === fromIndex) return d;
  const next = [...stops];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, moved);
  const days = d.days.map((day, i) => (i === dayIdx ? { stops: next } : day));
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
          const candidate: CourseStop = {
            id: typeof s.id === 'string' && s.id ? s.id : genStopId(now),
            time: typeof s.time === 'string' && isValidTime(s.time) ? s.time : '',
            title: title.slice(0, 120),
            category: typeof s.category === 'string' ? s.category.slice(0, 20) : 'etc',
            memo: typeof s.memo === 'string' ? s.memo.slice(0, 500) : '',
            ...(typeof s.lat === 'number' && Number.isFinite(s.lat) ? { lat: s.lat } : {}),
            ...(typeof s.lng === 'number' && Number.isFinite(s.lng) ? { lng: s.lng } : {}),
            ...(s.stayMinutes !== undefined ? { stayMinutes: s.stayMinutes } : {}),
            ...(s.timeConstraint !== undefined ? { timeConstraint: s.timeConstraint } : {}),
            ...(s.windowEnd !== undefined ? { windowEnd: s.windowEnd } : {}),
            ...(s.placeKey !== undefined ? { placeKey: s.placeKey } : {}),
            ...(s.placeSource !== undefined ? { placeSource: s.placeSource } : {}),
          };
          // 외부 신뢰 불가 입력(공유 링크 해시) — 확장필드가 명시적으로 있는데 형식이
          // 틀리면 이 stop 전체를 fail-closed 로 드롭한다(조용한 강등 금지).
          const normalized = normalizeStopExtras(candidate, 'strict');
          return normalized ? [normalized] : [];
        }),
      };
    });
    if (!days.length) return null;
    return { v: 1, days, updatedAt: now };
  } catch {
    return null;
  }
}

// ── useItinerary 호환 변환 (로그인 시 '내 계정에 저장' ↔ '내 코스 불러오기') ──

/** 계정 저장 슬롯 shape — ItinerarySlot 호환 + 코스 복원용 확장 필드(category/lat/lng + v1 확장). */
export interface CourseSlotShape {
  productId: string;
  productType: 'planner';
  name: string;
  timeStart?: string;
  notes?: string;
  category?: string;
  lat?: number;
  lng?: number;
  stayMinutes?: number;
  timeConstraint?: CourseTimeConstraint;
  windowEnd?: string;
  placeKey?: string;
  placeSource?: CoursePlaceSource;
}

/** CourseStop → ItinerarySlot shape (useItinerary.createItineraryWithSlots 인자와 호환). */
export function toItinerarySlot(s: CourseStop): CourseSlotShape {
  const clean = normalizeStopExtras(s) as CourseStop;
  return {
    productId: `course-${clean.id}`,
    productType: 'planner',
    name: clean.title,
    ...(clean.time ? { timeStart: clean.time } : {}),
    ...(clean.memo ? { notes: clean.memo } : {}),
    ...(clean.category ? { category: clean.category } : {}),
    ...(typeof clean.lat === 'number' && Number.isFinite(clean.lat) ? { lat: clean.lat } : {}),
    ...(typeof clean.lng === 'number' && Number.isFinite(clean.lng) ? { lng: clean.lng } : {}),
    ...(clean.stayMinutes !== undefined ? { stayMinutes: clean.stayMinutes } : {}),
    ...(clean.timeConstraint !== undefined ? { timeConstraint: clean.timeConstraint } : {}),
    ...(clean.windowEnd !== undefined ? { windowEnd: clean.windowEnd } : {}),
    ...(clean.placeKey !== undefined ? { placeKey: clean.placeKey } : {}),
    ...(clean.placeSource !== undefined ? { placeSource: clean.placeSource } : {}),
  };
}

/** 복원 입력 최소 계약 — ItinerarySlot(charter/tour 포함 union)도 구조적으로 만족. */
export interface SlotLike {
  name?: string;
  timeStart?: string;
  notes?: string;
  category?: string;
  lat?: number;
  lng?: number;
  stayMinutes?: unknown;
  timeConstraint?: unknown;
  windowEnd?: unknown;
  placeKey?: unknown;
  placeSource?: unknown;
}

/**
 * 저장된 itinerary(days[].slots[]) → CourseDraft ('내 코스 → 플래너에서 열기').
 * 구버전/타 출처 슬롯(category 없음)도 안전 복원 — toItinerarySlot 과 라운드트립 잠금.
 */
export function fromItinerarySlots(
  slotsPerDay: SlotLike[][],
  now: number = Date.now(),
): CourseDraft {
  const days: CourseDay[] = slotsPerDay.slice(0, COURSE_MAX_DAYS).map((slots) => ({
    stops: (Array.isArray(slots) ? slots : []).slice(0, COURSE_MAX_STOPS_PER_DAY).flatMap((sl) => {
      const title = typeof sl?.name === 'string' ? sl.name.trim() : '';
      if (!title) return [];
      const candidate: CourseStop = {
        id: genStopId(now),
        time: typeof sl.timeStart === 'string' && isValidTime(sl.timeStart) ? sl.timeStart : '',
        title: title.slice(0, 120),
        category: typeof sl.category === 'string' && sl.category ? sl.category.slice(0, 20) : 'etc',
        memo: typeof sl.notes === 'string' ? sl.notes.slice(0, 500) : '',
        ...(typeof sl.lat === 'number' && Number.isFinite(sl.lat) ? { lat: sl.lat } : {}),
        ...(typeof sl.lng === 'number' && Number.isFinite(sl.lng) ? { lng: sl.lng } : {}),
        ...(sl.stayMinutes !== undefined ? { stayMinutes: sl.stayMinutes as number } : {}),
        ...(sl.timeConstraint !== undefined ? { timeConstraint: sl.timeConstraint as CourseTimeConstraint } : {}),
        ...(sl.windowEnd !== undefined ? { windowEnd: sl.windowEnd as string } : {}),
        ...(sl.placeKey !== undefined ? { placeKey: sl.placeKey as string } : {}),
        ...(sl.placeSource !== undefined ? { placeSource: sl.placeSource as CoursePlaceSource } : {}),
      };
      // 계정 저장본 — 손실 방지 우선(lenient): 확장필드가 안 맞아도 장소 자체는 복원한다.
      return [normalizeStopExtras(candidate) as CourseStop];
    }),
  }));
  if (!days.length) return emptyDraft(now);
  return { v: 1, days, updatedAt: now };
}

/** 외부(공유 조회/불러오기)에서 받은 코스를 draft 로 로컬 저장 — 다음 /planner 진입 시 로드됨. */
export function persistDraft(d: CourseDraft): boolean {
  try {
    localStorage.setItem(COURSE_STORAGE_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

// ── 지도 링크 (기존 패턴: naverMapSearchUrl / google maps search) ─────────

export function googleMapsUrl(s: Pick<CourseStop, 'title' | 'lat' | 'lng'>): string {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.title)}`;
}
