/**
 * P159 (2026-05-22): pre-dawn stops auto-correct.
 *
 * 이전 회귀: customer 결제 후 UNREASONABLE_STOP_TIMES throw 500 → 환불 분쟁.
 * 본 fix: 04:30 같은 새벽 stops 를 09:00 cascade 로 재계산. quality_warning 박제.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { correctPreDawnStopTimes } from '../../api/_ai_core/planPersister.js';

describe('P159 correctPreDawnStopTimes', () => {
  it('Day3 04:30 lodging → 09:00 cascade 재계산', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          city: 'Busan',
          stops: [
            { category: 'lodging', name: '남포동 호텔', start_time: '04:30', stay_min: 0 },
            { category: 'food', name: '광안리 회센터', start_time: '06:00', stay_min: 60 },
            { category: 'attraction', name: '해운대 해변', start_time: '08:00', stay_min: 120 },
          ],
        },
      ],
    } as any;

    const corrected = correctPreDawnStopTimes(itinerary);

    expect(corrected).toBe(3);
    expect(itinerary.days[0].stops[0].start_time).toBe('09:00');
    // 09:00 + 0 (lodging stay) + 30 buffer = 09:30
    expect(itinerary.days[0].stops[1].start_time).toBe('09:30');
    // 09:30 + 60 (food stay) + 30 buffer = 11:00
    expect(itinerary.days[0].stops[2].start_time).toBe('11:00');
    expect(itinerary.quality_warnings).toHaveLength(1);
    expect(itinerary.quality_warnings[0].kind).toBe('predawn_auto_corrected');
  });

  it('정상 시각 (09:00) 은 건드리지 않음', () => {
    const itinerary = {
      days: [
        {
          day: 1,
          city: 'Seoul',
          stops: [
            { category: 'lodging', name: '명동 호텔', start_time: '09:00', stay_min: 0 },
            { category: 'food', name: '광장시장', start_time: '12:00', stay_min: 60 },
          ],
        },
      ],
    } as any;

    const corrected = correctPreDawnStopTimes(itinerary);
    expect(corrected).toBe(0);
    expect(itinerary.days[0].stops[0].start_time).toBe('09:00');
    expect(itinerary.days[0].stops[1].start_time).toBe('12:00');
    expect(itinerary.quality_warnings).toBeUndefined();
  });

  it('빈 stops Day 는 무시', () => {
    const itinerary = { days: [{ day: 1, city: 'Seoul', stops: [] }] } as any;
    expect(correctPreDawnStopTimes(itinerary)).toBe(0);
  });

  it('첫 stop 05:00 이상 (경계) 은 통과', () => {
    const itinerary = {
      days: [
        {
          day: 1, city: 'Seoul',
          stops: [{ category: 'lodging', name: '호텔', start_time: '05:00', stay_min: 0 }],
        },
      ],
    } as any;
    expect(correctPreDawnStopTimes(itinerary)).toBe(0);
  });

  it('end_time 동기화', () => {
    const itinerary = {
      days: [
        {
          day: 2, city: 'Busan',
          stops: [
            { category: 'lodging', name: '호텔', start_time: '03:00', stay_min: 0 },
            { category: 'food', name: '식당', start_time: '04:00', stay_min: 90 },
          ],
        },
      ],
    } as any;

    correctPreDawnStopTimes(itinerary);
    expect(itinerary.days[0].stops[0].end_time).toBe('09:00');
    // 09:00 + 0 + 30 = 09:30, stay_min=90 → end 11:00
    expect(itinerary.days[0].stops[1].start_time).toBe('09:30');
    expect(itinerary.days[0].stops[1].end_time).toBe('11:00');
  });

  it('23:30 cap — cascade 가 24h 넘어가면 23:30 으로 잘림', () => {
    const stops = [{ category: 'lodging', name: 'h', start_time: '02:00', stay_min: 0 }];
    // 10개 long stay 더해서 09:00 + 10*(60+30) = 09:00 + 900min = 24:00 overflow
    for (let i = 0; i < 12; i++) {
      stops.push({ category: 'food' as any, name: `f${i}`, start_time: '00:00', stay_min: 60 });
    }
    const itinerary = { days: [{ day: 1, city: 'Seoul', stops }] } as any;
    correctPreDawnStopTimes(itinerary);
    // 마지막 stop 이 23:30 으로 capped
    const lastStop = stops[stops.length - 1];
    expect(parseInt(String(lastStop.start_time).split(':')[0], 10)).toBeLessThanOrEqual(23);
  });

  it('quality_warnings 기존 항목 보존', () => {
    const itinerary = {
      days: [
        {
          day: 1, city: 'Busan',
          stops: [{ category: 'lodging', name: 'h', start_time: '02:00', stay_min: 0 }],
        },
      ],
      quality_warnings: [{ kind: 'existing', message: '기존 warning' }],
    } as any;
    correctPreDawnStopTimes(itinerary);
    expect(itinerary.quality_warnings).toHaveLength(2);
    expect(itinerary.quality_warnings[0].kind).toBe('existing');
    expect(itinerary.quality_warnings[1].kind).toBe('predawn_auto_corrected');
  });
});
