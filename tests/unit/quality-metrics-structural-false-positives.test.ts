/**
 * 회귀 잠금 (2026-08-03) — 품질 지표가 "정상 일정 구조"를 결함으로 세던 것.
 *
 * L3 Quality Monitor 가 24h 평균 79.8 < hard floor 80 으로 실패했다.
 * 운영 Firestore 플랜 25건 원본으로 추적한 결과 감점 20.34 중 16.7(82%)이
 * 오측정이었고, 일정 자체는 바뀐 게 없었다(7/28 가중치 재배분 후 같은 count/total
 * 인데 점수만 90.7 → 79.8). 같은 25건을 수정본으로 재채점하면 95.8 이 나온다.
 *
 * 여기서 잠그는 것: 되돌리면 다시 오탐이 나는 네 가지 경계.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeQualityScore } from '../../api/_ai_core/qualityMetrics.js';
import { SCHEDULE_BUFFER_MIN } from '../../api/_ai_core/constants.js';

const score = (itinerary: unknown, lang = 'ko') =>
  computeQualityScore(itinerary, null, 'seoul', [], { lang });

/** 숙소로 시작·종료하는 하루 (buildPrompt.js:375,390 이 강제하는 구조). */
function dayWithLodgingAnchor(overrides: Record<string, unknown> = {}) {
  return {
    days: [{
      day: 1,
      stops: [
        {
          name: '명동 지역 숙소', display_name: 'Myeongdong area stay', category: 'lodging',
          address: '서울 명동', start_time: '09:00', stay_min: 0,
        },
        {
          name: '경복궁', display_name: 'Gyeongbokgung', category: 'culture',
          address: '서울 종로구', lat: 37.5796, lng: 126.9770,
          start_time: '09:30', stay_min: 90, end_time: '11:00',
          transit_from_prev: { est_min: 14 },
        },
        {
          name: '익선동 한옥골목', display_name: 'Ikseondong', category: 'culture',
          address: '서울 종로구', lat: 37.5740, lng: 126.9910,
          start_time: '11:09', stay_min: 60, end_time: '12:09',
          transit_from_prev: { est_min: 4 },
        },
        {
          name: '명동 지역 숙소', display_name: 'Myeongdong area stay', category: 'lodging',
          address: '서울 명동', start_time: '12:30', stay_min: 0,
          transit_from_prev: { est_min: 16 },
        },
      ],
    }],
    ...overrides,
  };
}

describe('숙소 앵커를 결함으로 세지 않는다', () => {
  it('숙소에서 출발해 숙소로 복귀하는 것은 중복이 아니다', () => {
    const { metrics } = score(dayWithLodgingAnchor());
    expect(metrics.duplicate_stops.count).toBe(0);
    // 분모에서도 빠져야 한다 — 안 그러면 비율이 조용히 희석된다.
    expect(metrics.duplicate_stops.total).toBe(2);
  });

  it('관광지·식당이 다시 나오면 여전히 중복이다', () => {
    const it0 = dayWithLodgingAnchor();
    it0.days[0].stops.splice(3, 0, {
      name: '경복궁', display_name: 'Gyeongbokgung', category: 'culture',
      address: '서울 종로구', lat: 37.5796, lng: 126.9770,
      start_time: '12:20', stay_min: 30, end_time: '12:50',
      transit_from_prev: { est_min: 8 },
    });
    expect(score(it0).metrics.duplicate_stops.count).toBe(1);
  });

  it('좌표 없는 숙소는 필드 누락이 아니다 (손님 호텔 미지정 = 지역 placeholder)', () => {
    expect(score(dayWithLodgingAnchor()).metrics.field_completeness.count).toBe(0);
  });

  it('좌표 없는 일반 stop 은 여전히 필드 누락이다', () => {
    const it0 = dayWithLodgingAnchor();
    delete (it0.days[0].stops[1] as Record<string, unknown>).lat;
    expect(score(it0).metrics.field_completeness.count).toBe(1);
  });

  it('좌표 없는 숙소로 가는 구간은 경로 실패로 세지 않는다 (분모에서도 제외)', () => {
    const it0 = dayWithLodgingAnchor();
    delete (it0.days[0].stops[3] as Record<string, unknown>).transit_from_prev;
    const m = score(it0).metrics;
    expect(m.route_failure.count).toBe(0);
    expect(m.route_failure.total).toBe(2);
  });

  it('손님이 호텔을 특정해 좌표가 있으면 경로 실패를 계속 잡는다', () => {
    const it0 = dayWithLodgingAnchor();
    const back = it0.days[0].stops[3] as Record<string, unknown>;
    back.lat = 37.5636; back.lng = 126.9827;
    delete back.transit_from_prev;
    const m = score(it0).metrics;
    expect(m.route_failure.count).toBe(1);
    expect(m.route_failure.total).toBe(3);
  });
});

describe('tight_schedule 은 이동시간이 아니라 여유를 잰다', () => {
  it('짧은 이동(도보 4분)은 촉박이 아니다 — 잘 묶인 동선의 목표다', () => {
    const m = score(dayWithLodgingAnchor()).metrics;
    expect(m.tight_schedule.count).toBe(0);
    // 4분·14분·16분 이동이 전부 30분 미만인데 하나도 안 잡혀야 한다.
    expect(m.tight_schedule.total).toBe(3);
  });

  it('실제로 도착 못 하는 구간은 촉박이다 (출발 09:00 → 도착도 09:00, 이동 14분)', () => {
    const it0 = dayWithLodgingAnchor();
    (it0.days[0].stops[1] as Record<string, unknown>).start_time = '09:00';
    expect(score(it0).metrics.tight_schedule.count).toBe(1);
  });

  it('여유가 버퍼와 같으면 촉박이 아니고, 1분 모자라면 촉박이다', () => {
    const mk = (slack: number) => {
      const it0 = dayWithLodgingAnchor();
      const s1 = it0.days[0].stops[1] as Record<string, unknown>;
      const mins = 9 * 60 + 14 + slack; // 09:00 출발 + 이동 14분 + slack
      s1.start_time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      s1.end_time = undefined;
      return score(it0).metrics.tight_schedule.count;
    };
    expect(mk(SCHEDULE_BUFFER_MIN)).toBe(0);
    expect(mk(SCHEDULE_BUFFER_MIN - 1)).toBeGreaterThan(0);
  });

  it('90분 초과 이동만 loose 다 (짧은 이동은 loose 도 아니다)', () => {
    const it0 = dayWithLodgingAnchor();
    (it0.days[0].stops[2] as Record<string, unknown>).transit_from_prev = { est_min: 120 };
    const m = score(it0).metrics;
    expect(m.loose_schedule.count).toBe(1);
    expect(m.loose_schedule.total).toBe(3);
  });
});

describe('여유 버퍼는 단일 원천이다', () => {
  it('RouteAgent 가 버퍼 숫자를 다시 적지 않는다', () => {
    const code = readFileSync(join(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
    // 지표와 스케줄러가 서로 다른 값을 쓰면 tight 가 조용히 전건 오탐이 된다.
    expect(code).toContain('SCHEDULE_BUFFER_MIN');
    expect(code).not.toMatch(/const BUFFER_MIN = \d/);
  });
});
