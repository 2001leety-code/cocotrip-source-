/**
 * 코스빌더 ← zone_courses(운영자 검증 하루 코스) 어댑터. (2026-08-02)
 *
 * 검증된 동선을 손님이 한 번에 담을 수 있게 해서, 빈 화면에서 장소를 하나씩
 * 찾아 넣다 이탈하는 구간을 없애는 것이 목적이다.
 *
 * 원칙
 *   - published 문서만 읽는다(초안·보관본은 손님에게 노출 금지).
 *   - 좌표·4개 언어 이름·시간·카테고리를 손실 없이 코스빌더 입력으로 옮긴다.
 *   - Firestore 가 실패해도 화면이 멈추지 않는다 — 빈 목록으로 떨어진다.
 */
import type { Language } from '@/i18n';
import { fetchPublishedZoneCourses, type ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { isValidStayMinutes, type CourseStop } from './courseOps';

/** 화면에 한 번에 보여줄 검증 코스 개수. 목록이 길면 고르기가 더 어려워진다. */
const MAX_TEMPLATES = 4;

/** zone_courses 한 건을 코스빌더가 쓰는 최소 형태로 줄인 것. */
export interface ZoneCourseTemplate {
  id: string;
  city: string;
  zone: string;
  theme: string;
  theme_i18n?: Partial<Record<Language, string>>;
  duration_min: number;
  stops: NonNullable<ZoneCourseDoc['stops']>;
}

/**
 * zone_courses 카테고리를 코스빌더 칩 카테고리로 바꾼다.
 *
 * ⚠️ 운영 데이터에는 타입 유니온(`ZoneCourseStopCategory`)에 없는 값도 실제로 들어 있다
 *   (실측: cafe·photo·sports). 그래서 `string` 으로 받고 모르는 값은 'sight' 로 떨어뜨린다.
 */
function toCourseCategory(category: string): string {
  if (category === 'food' || category === 'cafe') return 'food';
  if (category === 'lodging') return 'stay';
  if (category === 'activity' || category === 'sports') return 'show';
  return 'sight';
}

/**
 * 좌표 한 개를 숫자로 읽는다. 읽을 수 없으면 null.
 *
 * 🔴 `Number.isFinite(Number(v))` 로만 검사하면 안 된다 — `Number(null)`·`Number('')` 은
 *   둘 다 0 이라 **좌표가 비어 있는 장소가 위도 0·경도 0(기니만 앞바다)으로 통과한다.**
 *   지도와 길찾기가 통째로 엉뚱한 곳을 가리키게 되므로 빈 값은 여기서 잘라낸다.
 */
function toCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 코스 시작(오전 9시) 기준 누적 분을 코스빌더의 HH:MM 표기로 바꾼다. */
function timeFromOffset(offset: unknown): string {
  const minutes = Math.max(0, Number(offset) || 0) + 9 * 60;
  // 하루를 넘기는 코스는 없지만, 데이터가 이상해도 24시 같은 값이 찍히지 않게 막는다.
  const hour = Math.min(23, Math.floor(minutes / 60));
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Firestore 문서가 손님에게 보여줄 수 있는 검증 코스인지 확인하고 변환한다.
 * 좌표 없는 장소는 지도·길찾기가 깨지므로 버리고, 남은 장소가 2곳 미만이면 코스 자체를 버린다.
 */
export function toPublishedTemplate(doc: ZoneCourseDoc): ZoneCourseTemplate | null {
  if (doc.status !== 'published') return null;
  if (!doc.id || !doc.city || !Array.isArray(doc.stops)) return null;
  const validStops = doc.stops.filter((stop) => (
    !!stop?.name && toCoord(stop.lat) !== null && toCoord(stop.lng) !== null
  ));
  if (validStops.length < 2) return null;
  return {
    id: String(doc.id),
    city: String(doc.city),
    zone: String(doc.zone || ''),
    theme: String(doc.theme || doc.zone || doc.city),
    theme_i18n: doc.theme_i18n,
    duration_min: Math.max(0, Number(doc.duration_min) || 0),
    stops: validStops,
  };
}

/**
 * 선택한 도시의 검증 코스를 긴 코스 우선으로 최대 4개 불러온다.
 * 조회가 실패하면 예외를 삼키고 빈 목록을 돌려준다 — 코스빌더 본 기능은 계속 써야 한다.
 */
export async function loadZoneCourseTemplates(city: string): Promise<ZoneCourseTemplate[]> {
  if (!city) return [];
  let docs: ZoneCourseDoc[] = [];
  try {
    docs = await fetchPublishedZoneCourses(city);
  } catch (error) {
    console.error('[zoneCourseTemplates] 검증 코스 조회 실패', error);
    return [];
  }
  return docs
    .map(toPublishedTemplate)
    .filter((template): template is ZoneCourseTemplate => !!template)
    .sort((a, b) => b.duration_min - a.duration_min || a.id.localeCompare(b.id))
    .slice(0, MAX_TEMPLATES);
}

/** 검증 코스의 장소들을 코스빌더에 그대로 넣을 입력값으로 바꾼다. */
export function zoneCourseTemplateToStops(
  template: ZoneCourseTemplate,
  language: Language,
): Omit<CourseStop, 'id'>[] {
  return template.stops.map((stop) => ({
    title: stop.name_i18n?.[language] || stop.name_i18n?.en || stop.name,
    time: timeFromOffset(stop.start_time_offset_min),
    category: toCourseCategory(String(stop.category || '')),
    memo: String(stop.address || '').slice(0, 500),
    // toPublishedTemplate 이 이미 걸러낸 장소들이라 null 이 나올 수 없다.
    lat: toCoord(stop.lat) as number,
    lng: toCoord(stop.lng) as number,
    // 운영자가 검증한 체류시간 — 범위 밖(0·음수·비정수)이면 자유시간으로 떨어뜨린다(코스빌더 쪽에서 다시 검증됨).
    ...(isValidStayMinutes(stop.stay_min) ? { stayMinutes: stop.stay_min } : {}),
  }));
}
