/**
 * 코스빌더 ← zone_courses 검증 하루 코스. (2026-08-02)
 *
 * 🔴 여기서 반드시 못박는 것:
 *   - published 가 아닌 문서는 손님 화면에 절대 안 나온다.
 *   - 좌표·4개 언어 이름·시간·카테고리가 손실 없이 옮겨진다.
 *   - Firestore 조회가 터져도 빈 목록으로 떨어지고 화면이 멈추지 않는다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchPublishedZoneCourses = vi.fn();
vi.mock('../../src/lib/zone-courses-firestore', () => ({
  fetchPublishedZoneCourses: (...a: unknown[]) => fetchPublishedZoneCourses(...a),
}));

import { addStops, COURSE_MAX_STOPS_PER_DAY, emptyDraft } from '../../src/pages/PlannerPage/components/courseBuilder/courseOps';
import {
  loadZoneCourseTemplates,
  toPublishedTemplate,
  zoneCourseTemplateToStops,
} from '../../src/pages/PlannerPage/components/courseBuilder/zoneCourseTemplates';
import type { ZoneCourseDoc } from '../../src/lib/zone-courses-firestore';

/** 운영 zone_courses 실제 문서 모양(실측 2026-08-02) 기준 픽스처. */
function makeDoc(over: Record<string, unknown> = {}) {
  return {
    id: 'SEOUL_DAY_JONGNO_STANDARD',
    status: 'published',
    city: 'seoul',
    zone: 'Jongno',
    theme: '전통 서울',
    theme_i18n: { en: 'Historic Seoul', ko: '전통 서울' },
    duration_min: 420,
    stops: [
      { order: 1, name: '경복궁', name_i18n: { ko: '경복궁', en: 'Gyeongbokgung', ja: '景福宮', zh: '景福宫' }, category: 'culture', address: '서울 종로구', lat: 37.57, lng: 126.98, start_time_offset_min: 0 },
      { order: 2, name: '광장시장', name_i18n: { ko: '광장시장', en: 'Gwangjang Market', ja: '広蔵市場', zh: '广藏市场' }, category: 'food', address: '서울 종로구', lat: 37.56, lng: 126.99, start_time_offset_min: 150 },
    ],
    ...over,
  } as unknown as ZoneCourseDoc;
}

beforeEach(() => { fetchPublishedZoneCourses.mockReset(); });

describe('toPublishedTemplate — 손님에게 보여도 되는 코스만 통과', () => {
  it('published 만 통과시킨다', () => {
    expect(toPublishedTemplate(makeDoc())?.id).toBe('SEOUL_DAY_JONGNO_STANDARD');
    expect(toPublishedTemplate(makeDoc({ status: 'draft' }))).toBeNull();
    expect(toPublishedTemplate(makeDoc({ status: 'archived' }))).toBeNull();
    expect(toPublishedTemplate(makeDoc({ status: undefined }))).toBeNull();
  });

  it('좌표 없는 장소는 버리고, 남은 장소가 2곳 미만이면 코스째 버린다', () => {
    const doc = makeDoc({
      stops: [
        { name: '좌표 있음', lat: 37.5, lng: 127, category: 'culture', address: 'a', start_time_offset_min: 0 },
        { name: '좌표 없음', lat: null, lng: null, category: 'food', address: 'b', start_time_offset_min: 60 },
      ],
    });
    // 유효한 장소가 1곳뿐 → 동선이 성립하지 않으므로 노출하지 않는다.
    expect(toPublishedTemplate(doc)).toBeNull();
  });
});

describe('zoneCourseTemplateToStops — 값 보존', () => {
  it('언어·시간·카테고리·좌표를 코스빌더 입력으로 그대로 옮긴다', () => {
    const template = toPublishedTemplate(makeDoc())!;
    expect(zoneCourseTemplateToStops(template, 'en')).toEqual([
      { title: 'Gyeongbokgung', time: '09:00', category: 'sight', memo: '서울 종로구', lat: 37.57, lng: 126.98 },
      { title: 'Gwangjang Market', time: '11:30', category: 'food', memo: '서울 종로구', lat: 37.56, lng: 126.99 },
    ]);
  });

  it('선택 언어 이름이 없으면 영어 → 한국어 원문 순으로 떨어진다', () => {
    const template = toPublishedTemplate(makeDoc({
      stops: [
        { name: '가나다', name_i18n: { en: 'Ganada' }, category: 'food', address: '', lat: 1, lng: 2, start_time_offset_min: 0 },
        { name: '라마바', name_i18n: {}, category: 'nature', address: '', lat: 3, lng: 4, start_time_offset_min: 30 },
      ],
    }))!;
    expect(zoneCourseTemplateToStops(template, 'ja').map((s) => s.title)).toEqual(['Ganada', '라마바']);
  });

  it('시간 오프셋이 이상해도 24시 같은 값이 나오지 않는다', () => {
    const template = toPublishedTemplate(makeDoc({
      stops: [
        { name: 'A', name_i18n: { en: 'A' }, category: 'food', address: '', lat: 1, lng: 2, start_time_offset_min: -60 },
        { name: 'B', name_i18n: { en: 'B' }, category: 'food', address: '', lat: 3, lng: 4, start_time_offset_min: 99999 },
      ],
    }))!;
    expect(zoneCourseTemplateToStops(template, 'en').map((s) => s.time)).toEqual(['09:00', '23:39']);
  });
});

describe('loadZoneCourseTemplates', () => {
  it('published 만 남기고 긴 코스 우선으로 최대 4개까지 준다', async () => {
    fetchPublishedZoneCourses.mockResolvedValue([
      makeDoc({ id: 'A', duration_min: 300 }),
      makeDoc({ id: 'B', duration_min: 480 }),
      makeDoc({ id: 'C', duration_min: 400 }),
      makeDoc({ id: 'D', duration_min: 200 }),
      makeDoc({ id: 'E', duration_min: 100 }),
      makeDoc({ id: 'SKIP', duration_min: 999, status: 'draft' }),
    ]);
    const templates = await loadZoneCourseTemplates('seoul');
    expect(templates.map((t) => t.id)).toEqual(['B', 'C', 'A', 'D']);
    expect(fetchPublishedZoneCourses).toHaveBeenCalledWith('seoul');
  });

  it('조회가 실패해도 예외를 던지지 않고 빈 목록을 준다', async () => {
    fetchPublishedZoneCourses.mockRejectedValue(new Error('permission-denied'));
    await expect(loadZoneCourseTemplates('busan')).resolves.toEqual([]);
  });

  it('도시가 없으면 Firestore 를 아예 읽지 않는다', async () => {
    await expect(loadZoneCourseTemplates('')).resolves.toEqual([]);
    expect(fetchPublishedZoneCourses).not.toHaveBeenCalled();
  });
});

describe('addStops — Day 최대 개수 보존', () => {
  const partial = { title: 'Place', time: '', category: 'sight', memo: '' };

  it('여러 장소를 한 번에 넣되 하루 최대 개수를 넘지 않는다', () => {
    const result = addStops(emptyDraft(1), 0, Array.from({ length: 25 }, (_, i) => ({ ...partial, title: `Place ${i}` })), 10);
    expect(result.days[0].stops).toHaveLength(COURSE_MAX_STOPS_PER_DAY);
    expect(result.days[0].stops[0].title).toBe('Place 0');
    // id 가 겹치면 React 렌더가 깨지고 삭제가 엉뚱한 장소를 지운다.
    expect(new Set(result.days[0].stops.map((s) => s.id)).size).toBe(COURSE_MAX_STOPS_PER_DAY);
  });

  it('제목이 빈 장소는 자리를 차지하지 않고 버려진다', () => {
    const input = [{ ...partial, title: '  ' }, { ...partial, title: '진짜 장소' }];
    const result = addStops(emptyDraft(1), 0, input, 10);
    expect(result.days[0].stops.map((s) => s.title)).toEqual(['진짜 장소']);
  });

  it('없는 Day·빈 입력이면 원본을 그대로 돌려준다', () => {
    const draft = emptyDraft(1);
    expect(addStops(draft, 5, [partial], 10)).toBe(draft);
    expect(addStops(draft, 0, [], 10)).toBe(draft);
  });
});
