/**
 * zoneCourseTemplateToStops — stay_min 보존 잠금 (2026-08-24, planner-trust-course).
 *
 * zone_courses 운영자 검증 코스를 코스빌더에 넣을 때 stay_min(체류시간)이 stayMinutes 로
 * 그대로 전달돼야 한다. 범위 밖 값은 자유시간으로 떨어뜨린다(코스빌더가 다시 안전 검증하므로
 * 여기선 상한 컷만 확인).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));

const { zoneCourseTemplateToStops } =
  await import('../../src/pages/PlannerPage/components/courseBuilder/zoneCourseTemplates');
type ZoneCourseTemplate = Parameters<typeof zoneCourseTemplateToStops>[0];

function template(stayMin: unknown): ZoneCourseTemplate {
  return {
    id: 't1', city: 'seoul', zone: 'jongno', theme: '고궁 투어', duration_min: 180,
    stops: [{
      name: '경복궁',
      name_i18n: { en: 'Gyeongbokgung' },
      category: 'sight',
      address: '서울 종로구',
      lat: 37.58,
      lng: 126.98,
      start_time_offset_min: 0,
      stay_min: stayMin,
    }] as unknown as ZoneCourseTemplate['stops'],
  };
}

describe('zoneCourseTemplateToStops — stay_min → stayMinutes', () => {
  it('유효 stay_min 은 stayMinutes 로 보존', () => {
    const [s] = zoneCourseTemplateToStops(template(90), 'en');
    expect(s.stayMinutes).toBe(90);
  });

  it('범위 밖/비정수 stay_min 은 stayMinutes 생략(자유시간)', () => {
    expect('stayMinutes' in zoneCourseTemplateToStops(template(0), 'en')[0]).toBe(false);
    expect('stayMinutes' in zoneCourseTemplateToStops(template(1441), 'en')[0]).toBe(false);
    expect('stayMinutes' in zoneCourseTemplateToStops(template('90' as never), 'en')[0]).toBe(false);
  });
});
